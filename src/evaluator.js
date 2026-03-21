import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { createOpenRouterCompletion } from "./openrouter.js";

const DEFAULT_SAMPLE_COUNT = 5;
const DEFAULT_EVALUATION_STRATEGY = "sampling";
const AGGREGATION_METHOD = "trimean";
const SAMPLE_ATTEMPT_LIMIT = 3;
const CONFIDENCE_LEVELS = new Set(["low", "medium", "high"]);

const SYSTEM_PROMPT = `
You evaluate whether two documents express the same meaning and contain a comparable amount of information.
Return strict JSON only. Do not wrap the JSON in markdown.

Evaluation rules:
- Compare meaning and factual content, not writing style.
- Break each document into atomic facts such as actor, action, object, date, quantity, owner, metric, scope, constraint, and outcome.
- Treat paraphrases as the same fact if they preserve the same real-world meaning.
- Treat changed entities, numbers, dates, scope, success metrics, or opposite decisions as different facts.
- Penalize omitted material facts in coverage. Penalize opposite claims heavily in semantic similarity.
- Keep scoring conservative on boundary cases. If overlap is partial, do not round up to a stronger verdict.

Score anchors:
- semantic_similarity
  - 95-100: same event/decision/facts with only paraphrase-level wording differences
  - 80-94: same core meaning with minor fact differences or minor omissions
  - 60-79: same topic and some shared meaning, but notable scope/metric/fact differences
  - 30-59: partial overlap only
  - 0-29: opposite claims or mostly unrelated content
- information_amount_parity
  - 95-100: nearly the same amount of material information
  - 80-94: one side is somewhat more detailed, but still broadly similar in informational density
  - 60-79: one side clearly contains materially more detail
  - 30-59: strong mismatch in amount of information
  - 0-29: one side is almost empty relative to the other
- doc_a_coverage_by_doc_b / doc_b_coverage_by_doc_a
  - 95-100: almost all material facts are covered
  - 80-94: one minor material omission
  - 60-79: some material omissions
  - 30-59: many missing material facts
  - 0-29: almost none of the material facts are covered

Output rules:
- Use only the required JSON fields.
- Keep shared_points and unique-point lists short and factual.
- confidence should reflect ambiguity in the source text, not your own writing confidence.
- Set overall_equivalence to 0 temporarily and verdict to "pending_calibration". They will be recalculated deterministically after parsing.

Required JSON shape:
{
  "overall_equivalence": number,
  "semantic_similarity": number,
  "information_amount_parity": number,
  "doc_a_coverage_by_doc_b": number,
  "doc_b_coverage_by_doc_a": number,
  "verdict": string,
  "summary": string,
  "shared_points": string[],
  "doc_a_only_points": string[],
  "doc_b_only_points": string[],
  "information_gap_notes": string[],
  "confidence": "low" | "medium" | "high"
}
`.trim();

export const EVALUATION_STRATEGIES = Object.freeze({
  SAMPLING: DEFAULT_EVALUATION_STRATEGY,
  SINGLE_RESPONSIBILITY_ENSEMBLE: "single_responsibility_ensemble",
});

const PERSPECTIVE_DEFINITIONS = [
  {
    id: "semantic_similarity",
    label: "semantic similarity",
    systemPrompt: `
You are a single-responsibility evaluator for semantic similarity only.
Return strict JSON only. Do not wrap the JSON in markdown.

Task:
- Judge whether Document A and Document B express the same real-world meaning.
- Focus on actor, action, object, date, quantity, scope, constraint, success metric, outcome, and polarity.
- Ignore writing style.
- Penalize contradictions, swapped entities, changed numbers, changed dates, or changed scope heavily.
- Be conservative on boundary cases.

Score anchor for semantic_similarity:
- 95-100: same facts and meaning, only paraphrase-level wording differences
- 80-94: same core meaning with minor factual differences or omissions
- 60-79: same topic with notable scope/fact differences
- 30-59: partial overlap only
- 0-29: opposite claims or mostly unrelated content

Required JSON shape:
{
  "semantic_similarity": number,
  "summary": string,
  "shared_points": string[],
  "contradictions_or_scope_shifts": string[],
  "confidence": "low" | "medium" | "high"
}
`.trim(),
    requiredNumberFields: ["semantic_similarity"],
    requiredStringFields: ["summary", "confidence"],
    requiredArrayFields: ["shared_points", "contradictions_or_scope_shifts"],
  },
  {
    id: "information_amount_parity",
    label: "information amount parity",
    systemPrompt: `
You are a single-responsibility evaluator for information amount parity only.
Return strict JSON only. Do not wrap the JSON in markdown.

Task:
- Judge whether the two documents contain roughly the same amount of material information.
- Compare informational density, number of material facts, constraints, metrics, owners, dates, and exceptions.
- Do not over-penalize harmless wording changes.
- Be conservative when one side is clearly more detailed.

Score anchor for information_amount_parity:
- 95-100: nearly the same amount of material information
- 80-94: somewhat different detail level, but still broadly similar
- 60-79: one side clearly contains materially more detail
- 30-59: strong mismatch in amount of information
- 0-29: one side is almost empty relative to the other

Required JSON shape:
{
  "information_amount_parity": number,
  "summary": string,
  "doc_a_only_points": string[],
  "doc_b_only_points": string[],
  "information_gap_notes": string[],
  "confidence": "low" | "medium" | "high"
}
`.trim(),
    requiredNumberFields: ["information_amount_parity"],
    requiredStringFields: ["summary", "confidence"],
    requiredArrayFields: ["doc_a_only_points", "doc_b_only_points", "information_gap_notes"],
  },
  {
    id: "doc_a_coverage_by_doc_b",
    label: "Document A coverage by Document B",
    systemPrompt: `
You are a single-responsibility evaluator for how well Document B covers Document A.
Return strict JSON only. Do not wrap the JSON in markdown.

Task:
- Treat Document A as the source of truth.
- Score how much of Document A's material information is present in Document B.
- Focus on omissions in Document B relative to Document A.
- Material facts include actor, action, object, date, quantity, owner, scope, constraint, exception, and outcome.
- Be conservative. Missing a material fact should lower the score.

Score anchor for doc_a_coverage_by_doc_b:
- 95-100: almost all material facts from A are covered by B
- 80-94: one minor material omission
- 60-79: some material omissions
- 30-59: many missing material facts
- 0-29: almost none of A is covered by B

Required JSON shape:
{
  "doc_a_coverage_by_doc_b": number,
  "summary": string,
  "covered_points": string[],
  "missing_points": string[],
  "information_gap_notes": string[],
  "confidence": "low" | "medium" | "high"
}
`.trim(),
    requiredNumberFields: ["doc_a_coverage_by_doc_b"],
    requiredStringFields: ["summary", "confidence"],
    requiredArrayFields: ["covered_points", "missing_points", "information_gap_notes"],
  },
  {
    id: "doc_b_coverage_by_doc_a",
    label: "Document B coverage by Document A",
    systemPrompt: `
You are a single-responsibility evaluator for how well Document A covers Document B.
Return strict JSON only. Do not wrap the JSON in markdown.

Task:
- Treat Document B as the source of truth.
- Score how much of Document B's material information is present in Document A.
- Focus on omissions in Document A relative to Document B.
- Material facts include actor, action, object, date, quantity, owner, scope, constraint, exception, and outcome.
- Be conservative. Missing a material fact should lower the score.

Score anchor for doc_b_coverage_by_doc_a:
- 95-100: almost all material facts from B are covered by A
- 80-94: one minor material omission
- 60-79: some material omissions
- 30-59: many missing material facts
- 0-29: almost none of B is covered by A

Required JSON shape:
{
  "doc_b_coverage_by_doc_a": number,
  "summary": string,
  "covered_points": string[],
  "missing_points": string[],
  "information_gap_notes": string[],
  "confidence": "low" | "medium" | "high"
}
`.trim(),
    requiredNumberFields: ["doc_b_coverage_by_doc_a"],
    requiredStringFields: ["summary", "confidence"],
    requiredArrayFields: ["covered_points", "missing_points", "information_gap_notes"],
  },
];

const PERSPECTIVE_DEFINITION_MAP = new Map(
  PERSPECTIVE_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function buildEvaluationPrompt({
  docAName,
  docAText,
  docBName,
  docBText,
}) {
  return `
Compare the following two documents.
Focus on:
1. Whether they mean the same thing.
2. Whether they contain roughly the same amount of information.
3. What meaningful points are shared or missing in either direction.

Document A: ${docAName}
"""
${docAText}
"""

Document B: ${docBName}
"""
${docBText}
"""
  `.trim();
}

export async function loadDocument(filePath) {
  const text = await readFile(filePath, "utf8");

  return {
    path: filePath,
    name: basename(filePath),
    text,
    charCount: text.length,
    lineCount: text === "" ? 0 : text.split(/\r?\n/).length,
  };
}

export async function evaluateDocuments({
  fileA,
  fileB,
  model,
  apiKey,
  fetchImpl,
  sampleCount = DEFAULT_SAMPLE_COUNT,
  sampleAttemptLimit = SAMPLE_ATTEMPT_LIMIT,
  strategy = DEFAULT_EVALUATION_STRATEGY,
  perspectiveModels = {},
}) {
  const [docA, docB] = await Promise.all([loadDocument(fileA), loadDocument(fileB)]);
  const prompt = buildEvaluationPrompt({
    docAName: docA.name,
    docAText: docA.text,
    docBName: docB.name,
    docBText: docB.text,
  });

  let aggregated;

  if (strategy === EVALUATION_STRATEGIES.SINGLE_RESPONSIBILITY_ENSEMBLE) {
    aggregated = await evaluateWithSingleResponsibilityEnsemble({
      prompt,
      model,
      perspectiveModels,
      apiKey,
      fetchImpl,
      sampleAttemptLimit,
    });
  } else if (strategy === EVALUATION_STRATEGIES.SAMPLING) {
    aggregated = await evaluateWithSampling({
      prompt,
      model,
      apiKey,
      fetchImpl,
      sampleCount,
      sampleAttemptLimit,
    });
  } else {
    throw new Error(`Unsupported evaluation strategy: ${strategy}`);
  }

  return {
    model: aggregated.model,
    strategy,
    documents: {
      a: {
        path: docA.path,
        name: docA.name,
        charCount: docA.charCount,
        lineCount: docA.lineCount,
      },
      b: {
        path: docB.path,
        name: docB.name,
        charCount: docB.charCount,
        lineCount: docB.lineCount,
      },
    },
    evaluation: aggregated.evaluation,
    sampling: aggregated.sampling ?? null,
    ensemble: aggregated.ensemble ?? null,
    usage: aggregated.usage,
  };
}

async function evaluateWithSampling({
  prompt,
  model,
  apiKey,
  fetchImpl,
  sampleCount,
  sampleAttemptLimit,
}) {
  const runs = [];

  for (let index = 0; index < sampleCount; index += 1) {
    runs.push(await collectSuccessfulRun({
      prompt,
      model,
      apiKey,
      fetchImpl,
      sampleAttemptLimit,
    }));
  }

  return aggregateEvaluationRuns(runs);
}

async function evaluateWithSingleResponsibilityEnsemble({
  prompt,
  model,
  perspectiveModels,
  apiKey,
  fetchImpl,
  sampleAttemptLimit,
}) {
  const perspectiveRuns = await Promise.all(
    PERSPECTIVE_DEFINITIONS.map(async (definition) => {
      const perspectiveModel = perspectiveModels[definition.id] ?? model;
      const result = await collectSuccessfulPerspectiveRun({
        prompt,
        systemPrompt: definition.systemPrompt,
        model: perspectiveModel,
        apiKey,
        fetchImpl,
        sampleAttemptLimit,
        perspectiveId: definition.id,
      });

      return {
        ...result,
        id: definition.id,
        label: definition.label,
      };
    }),
  );

  return aggregatePerspectiveRuns(perspectiveRuns);
}

async function collectSuccessfulRun({
  prompt,
  model,
  apiKey,
  fetchImpl,
  sampleAttemptLimit,
}) {
  let lastError = null;

  for (let attempt = 0; attempt < sampleAttemptLimit; attempt += 1) {
    try {
      const completion = await createOpenRouterCompletion({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: prompt,
        model,
        apiKey,
        fetchImpl,
      });

      const content = completion?.choices?.[0]?.message?.content;

      if (typeof content !== "string" || content.trim() === "") {
        throw new Error("OpenRouter response did not include a JSON message content.");
      }

      return {
        model: completion.model ?? model ?? process.env.OPENROUTER_DEFAULT_MODEL,
        evaluation: calibrateEvaluation(parseEvaluationJson(content)),
        usage: completion.usage ?? null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function collectSuccessfulPerspectiveRun({
  prompt,
  systemPrompt,
  model,
  apiKey,
  fetchImpl,
  sampleAttemptLimit,
  perspectiveId,
}) {
  let lastError = null;

  for (let attempt = 0; attempt < sampleAttemptLimit; attempt += 1) {
    try {
      const completion = await createOpenRouterCompletion({
        systemPrompt,
        userPrompt: prompt,
        model,
        apiKey,
        fetchImpl,
      });

      const content = completion?.choices?.[0]?.message?.content;

      if (typeof content !== "string" || content.trim() === "") {
        throw new Error("OpenRouter response did not include a JSON message content.");
      }

      return {
        model: completion.model ?? model ?? process.env.OPENROUTER_DEFAULT_MODEL,
        output: parsePerspectiveJson(content, perspectiveId),
        usage: completion.usage ?? null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export function parseEvaluationJson(rawContent) {
  const sanitized = extractJsonObject(rawContent);
  const parsed = normalizeParsedObject(JSON.parse(sanitized), {
    requiredNumberFields: [
      "semantic_similarity",
      "information_amount_parity",
      "doc_a_coverage_by_doc_b",
      "doc_b_coverage_by_doc_a",
    ],
    requiredStringFields: ["verdict", "summary", "confidence"],
    requiredArrayFields: [
      "shared_points",
      "doc_a_only_points",
      "doc_b_only_points",
      "information_gap_notes",
    ],
  });

  assertJsonShape(parsed, {
    requiredNumberFields: [
      "semantic_similarity",
      "information_amount_parity",
      "doc_a_coverage_by_doc_b",
      "doc_b_coverage_by_doc_a",
    ],
    requiredStringFields: ["verdict", "summary", "confidence"],
    requiredArrayFields: [
      "shared_points",
      "doc_a_only_points",
      "doc_b_only_points",
      "information_gap_notes",
    ],
  });

  return parsed;
}

export function parsePerspectiveJson(rawContent, perspectiveId) {
  const definition = PERSPECTIVE_DEFINITION_MAP.get(perspectiveId);

  if (!definition) {
    throw new Error(`Unsupported perspective: ${perspectiveId}`);
  }

  const sanitized = extractJsonObject(rawContent);
  const parsed = normalizeParsedObject(JSON.parse(sanitized), definition);

  assertJsonShape(parsed, definition);

  return parsed;
}

function normalizeParsedObject(parsed, {
  requiredNumberFields,
  requiredStringFields,
  requiredArrayFields,
}) {
  const normalized = { ...parsed };

  for (const field of requiredNumberFields) {
    if (typeof normalized[field] === "string" && normalized[field].trim() !== "") {
      const numericValue = Number(normalized[field]);
      if (Number.isFinite(numericValue)) {
        normalized[field] = numericValue;
      }
    }
  }

  for (const field of requiredStringFields) {
    if (field === "confidence") {
      normalized[field] = normalizeConfidence(normalized[field]);
      continue;
    }

    if (normalized[field] !== undefined && normalized[field] !== null && typeof normalized[field] !== "string") {
      normalized[field] = String(normalized[field]);
    }
  }

  for (const field of requiredArrayFields) {
    normalized[field] = normalizeStringArray(normalized[field]);
  }

  return normalized;
}

function normalizeConfidence(value) {
  if (typeof value !== "string") {
    return "medium";
  }

  const normalized = value.trim().toLowerCase();
  return CONFIDENCE_LEVELS.has(normalized) ? normalized : "medium";
}

function normalizeStringArray(value) {
  if (value === undefined || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeStringArray(item))
      .filter((item) => item !== "");
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized === "" ? [] : [normalized];
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  return [];
}

function assertJsonShape(parsed, {
  requiredNumberFields,
  requiredStringFields,
  requiredArrayFields,
}) {
  for (const field of requiredNumberFields) {
    if (typeof parsed[field] !== "number" || Number.isNaN(parsed[field])) {
      throw new Error(`Expected numeric field: ${field}`);
    }
  }

  for (const field of requiredStringFields) {
    if (typeof parsed[field] !== "string" || parsed[field].trim() === "") {
      throw new Error(`Expected non-empty string field: ${field}`);
    }
  }

  for (const field of requiredArrayFields) {
    if (!Array.isArray(parsed[field]) || !parsed[field].every((item) => typeof item === "string")) {
      throw new Error(`Expected string[] field: ${field}`);
    }
  }

  if (!CONFIDENCE_LEVELS.has(parsed.confidence)) {
    throw new Error("Expected confidence to be one of: low, medium, high");
  }
}

export function calibrateEvaluation(parsed) {
  const semanticSimilarity = clampScore(parsed.semantic_similarity);
  const informationAmountParity = clampScore(parsed.information_amount_parity);
  const docACoverageByDocB = clampScore(parsed.doc_a_coverage_by_doc_b);
  const docBCoverageByDocA = clampScore(parsed.doc_b_coverage_by_doc_a);

  const overallEquivalence = clampScore(
    Math.round(
      (semanticSimilarity * 0.5) +
      (informationAmountParity * 0.15) +
      (docACoverageByDocB * 0.175) +
      (docBCoverageByDocA * 0.175),
    ),
  );

  return {
    ...parsed,
    semantic_similarity: semanticSimilarity,
    information_amount_parity: informationAmountParity,
    doc_a_coverage_by_doc_b: docACoverageByDocB,
    doc_b_coverage_by_doc_a: docBCoverageByDocA,
    overall_equivalence: overallEquivalence,
    verdict: deriveVerdict({
      overallEquivalence,
      semanticSimilarity,
      informationAmountParity,
      docACoverageByDocB,
      docBCoverageByDocA,
    }),
  };
}

export function aggregateEvaluationRuns(runs) {
  if (!Array.isArray(runs) || runs.length === 0) {
    throw new Error("At least one evaluation run is required for aggregation.");
  }

  const semanticSimilarity = aggregateScore(runs, "semantic_similarity");
  const informationAmountParity = aggregateScore(runs, "information_amount_parity");
  const docACoverageByDocB = aggregateScore(runs, "doc_a_coverage_by_doc_b");
  const docBCoverageByDocA = aggregateScore(runs, "doc_b_coverage_by_doc_a");
  const confidence = aggregateConfidence(runs.map((run) => run.evaluation.confidence));

  const representativeRunIndex = selectRepresentativeRunIndex(runs, {
    semantic_similarity: semanticSimilarity,
    information_amount_parity: informationAmountParity,
    doc_a_coverage_by_doc_b: docACoverageByDocB,
    doc_b_coverage_by_doc_a: docBCoverageByDocA,
  });

  const representativeEvaluation = runs[representativeRunIndex].evaluation;
  const evaluation = calibrateEvaluation({
    ...representativeEvaluation,
    semantic_similarity: semanticSimilarity,
    information_amount_parity: informationAmountParity,
    doc_a_coverage_by_doc_b: docACoverageByDocB,
    doc_b_coverage_by_doc_a: docBCoverageByDocA,
    confidence,
  });

  return {
    model: runs[0].model,
    evaluation,
    usage: aggregateUsage(runs.map((run) => run.usage)),
    sampling: {
      sampleCount: runs.length,
      estimator: AGGREGATION_METHOD,
      representativeRun: representativeRunIndex + 1,
      runs: runs.map((run, index) => ({
        run: index + 1,
        evaluation: run.evaluation,
        usage: run.usage,
      })),
    },
  };
}

export function aggregatePerspectiveRuns(perspectiveRuns) {
  if (!Array.isArray(perspectiveRuns) || perspectiveRuns.length === 0) {
    throw new Error("At least one perspective run is required for aggregation.");
  }

  const outputsById = Object.fromEntries(
    perspectiveRuns.map((run) => [run.id, run.output]),
  );

  for (const definition of PERSPECTIVE_DEFINITIONS) {
    if (!outputsById[definition.id]) {
      throw new Error(`Missing perspective run: ${definition.id}`);
    }
  }

  const evaluation = calibrateEvaluation({
    overall_equivalence: 0,
    semantic_similarity: outputsById.semantic_similarity.semantic_similarity,
    information_amount_parity: outputsById.information_amount_parity.information_amount_parity,
    doc_a_coverage_by_doc_b: outputsById.doc_a_coverage_by_doc_b.doc_a_coverage_by_doc_b,
    doc_b_coverage_by_doc_a: outputsById.doc_b_coverage_by_doc_a.doc_b_coverage_by_doc_a,
    verdict: "pending_calibration",
    summary: combinePerspectiveSummaries(perspectiveRuns),
    shared_points: uniqueStrings([
      ...outputsById.semantic_similarity.shared_points,
      ...outputsById.doc_a_coverage_by_doc_b.covered_points,
      ...outputsById.doc_b_coverage_by_doc_a.covered_points,
    ], 6),
    doc_a_only_points: uniqueStrings([
      ...outputsById.information_amount_parity.doc_a_only_points,
      ...outputsById.doc_a_coverage_by_doc_b.missing_points,
    ], 6),
    doc_b_only_points: uniqueStrings([
      ...outputsById.information_amount_parity.doc_b_only_points,
      ...outputsById.doc_b_coverage_by_doc_a.missing_points,
    ], 6),
    information_gap_notes: uniqueStrings([
      ...outputsById.semantic_similarity.contradictions_or_scope_shifts,
      ...outputsById.information_amount_parity.information_gap_notes,
      ...outputsById.doc_a_coverage_by_doc_b.information_gap_notes,
      ...outputsById.doc_b_coverage_by_doc_a.information_gap_notes,
    ], 8),
    confidence: aggregateConfidence(perspectiveRuns.map((run) => run.output.confidence)),
  });

  const uniqueModels = [...new Set(perspectiveRuns.map((run) => run.model))];

  return {
    model: uniqueModels.length === 1 ? uniqueModels[0] : "multi-model-ensemble",
    evaluation,
    usage: aggregateUsage(perspectiveRuns.map((run) => run.usage)),
    ensemble: {
      perspectiveCount: perspectiveRuns.length,
      aggregation: "single_responsibility",
      perspectives: perspectiveRuns.map((run) => ({
        id: run.id,
        label: run.label,
        model: run.model,
        output: run.output,
        usage: run.usage,
      })),
    },
  };
}

function combinePerspectiveSummaries(perspectiveRuns) {
  return uniqueStrings(
    perspectiveRuns.map((run) => run.output.summary),
    perspectiveRuns.length,
  ).join(" ");
}

function uniqueStrings(values, limit = values.length) {
  const seen = new Set();
  const unique = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const normalized = value.trim();

    if (normalized === "") {
      continue;
    }

    const key = normalized.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(normalized);

    if (unique.length >= limit) {
      break;
    }
  }

  return unique;
}

export function deriveVerdict({
  overallEquivalence,
  semanticSimilarity,
  informationAmountParity,
  docACoverageByDocB,
  docBCoverageByDocA,
}) {
  const minCoverage = Math.min(docACoverageByDocB, docBCoverageByDocA);

  if (
    semanticSimilarity >= 92 &&
    informationAmountParity >= 90 &&
    minCoverage >= 90
  ) {
    return "highly_equivalent";
  }

  if (
    semanticSimilarity >= 80 &&
    overallEquivalence >= 74 &&
    informationAmountParity >= 70 &&
    minCoverage >= 75
  ) {
    return "mostly_equivalent";
  }

  if (
    semanticSimilarity >= 40 &&
    overallEquivalence >= 35
  ) {
    return "partially_equivalent";
  }

  return "materially_different";
}

export function trimean(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("trimean requires at least one value.");
  }

  const sorted = [...values].sort((left, right) => left - right);

  if (sorted.length === 1) {
    return sorted[0];
  }

  if (sorted.length < 5) {
    return mean(values);
  }

  const q1 = sorted[1];
  const median = sorted[2];
  const q3 = sorted[3];

  return (q1 + (2 * median) + q3) / 4;
}

function aggregateScore(runs, field) {
  return clampScore(
    Math.round(trimean(runs.map((run) => run.evaluation[field]))),
  );
}

function aggregateConfidence(confidences) {
  const ranks = { low: 1, medium: 2, high: 3 };
  const counts = confidences.reduce((accumulator, confidence) => {
    accumulator[confidence] = (accumulator[confidence] ?? 0) + 1;
    return accumulator;
  }, {});

  return Object.entries(counts)
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return ranks[right[0]] - ranks[left[0]];
    })[0]?.[0] ?? "medium";
}

function selectRepresentativeRunIndex(runs, target) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < runs.length; index += 1) {
    const evaluation = runs[index].evaluation;
    const distance =
      Math.abs(evaluation.semantic_similarity - target.semantic_similarity) +
      Math.abs(evaluation.information_amount_parity - target.information_amount_parity) +
      Math.abs(evaluation.doc_a_coverage_by_doc_b - target.doc_a_coverage_by_doc_b) +
      Math.abs(evaluation.doc_b_coverage_by_doc_a - target.doc_b_coverage_by_doc_a);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function aggregateUsage(usages) {
  const aggregated = {};

  for (const field of ["prompt_tokens", "completion_tokens", "total_tokens", "cost"]) {
    const values = usages
      .map((usage) => usage?.[field])
      .filter((value) => typeof value === "number");

    if (values.length > 0) {
      aggregated[field] = values.reduce((sum, value) => sum + value, 0);
    }
  }

  return Object.keys(aggregated).length > 0 ? aggregated : null;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function extractJsonObject(rawContent) {
  const trimmed = rawContent.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("Could not find a JSON object in the model response.");
}

export function formatReport(result) {
  const { evaluation, documents, model, usage, sampling, ensemble, strategy } = result;

  const lines = [
    `Model: ${model}`,
    strategy ? `Strategy: ${strategy}` : null,
    sampling
      ? `Sampling: ${sampling.sampleCount} runs (${sampling.estimator}, representative run ${sampling.representativeRun})`
      : null,
    ensemble
      ? `Ensemble: ${ensemble.perspectiveCount} single-responsibility perspectives`
      : null,
    `Verdict: ${evaluation.verdict} (confidence: ${evaluation.confidence})`,
    `Overall equivalence: ${evaluation.overall_equivalence}/100`,
    `Semantic similarity: ${evaluation.semantic_similarity}/100`,
    `Information amount parity: ${evaluation.information_amount_parity}/100`,
    `Coverage A->B: ${evaluation.doc_a_coverage_by_doc_b}/100`,
    `Coverage B->A: ${evaluation.doc_b_coverage_by_doc_a}/100`,
    "",
    `Document A: ${documents.a.name} (${documents.a.charCount} chars, ${documents.a.lineCount} lines)`,
    `Document B: ${documents.b.name} (${documents.b.charCount} chars, ${documents.b.lineCount} lines)`,
    "",
    "Summary:",
    evaluation.summary,
  ];

  if (ensemble) {
    lines.push("");
    lines.push("Perspective runs:");
    for (const perspective of ensemble.perspectives) {
      lines.push(`- ${perspective.id}: ${perspective.model}`);
    }
  }

  appendSection(lines, "Shared points", evaluation.shared_points);
  appendSection(lines, "A-only points", evaluation.doc_a_only_points);
  appendSection(lines, "B-only points", evaluation.doc_b_only_points);
  appendSection(lines, "Information gap notes", evaluation.information_gap_notes);

  if (usage) {
    lines.push("");
    lines.push(
      `Usage: prompt_tokens=${usage.prompt_tokens ?? "?"}, completion_tokens=${usage.completion_tokens ?? "?"}, total_tokens=${usage.total_tokens ?? "?"}`,
    );
  }

  return lines.filter(Boolean).join("\n");
}

function appendSection(lines, title, values) {
  lines.push("");
  lines.push(`${title}:`);

  if (values.length === 0) {
    lines.push("- none");
    return;
  }

  for (const value of values) {
    lines.push(`- ${value}`);
  }
}
