import test from "node:test";
import assert from "node:assert/strict";

import { parseShellEnvText } from "../src/env.js";
import {
  aggregatePerspectiveRuns,
  aggregateEvaluationRuns,
  buildEvaluationPrompt,
  calibrateEvaluation,
  deriveVerdict,
  formatReport,
  parseEvaluationJson,
  parsePerspectiveJson,
  trimean,
} from "../src/evaluator.js";

test("buildEvaluationPrompt includes both documents", () => {
  const prompt = buildEvaluationPrompt({
    docAName: "a.txt",
    docAText: "Alpha",
    docBName: "b.txt",
    docBText: "Beta",
  });

  assert.match(prompt, /Document A: a\.txt/);
  assert.match(prompt, /Alpha/);
  assert.match(prompt, /Document B: b\.txt/);
  assert.match(prompt, /Beta/);
});

test("parseEvaluationJson accepts direct JSON", () => {
  const parsed = parseEvaluationJson(JSON.stringify(sampleEvaluation()));

  assert.equal(parsed.semantic_similarity, 88);
});

test("parseEvaluationJson extracts fenced JSON", () => {
  const parsed = parseEvaluationJson(`\`\`\`json\n${JSON.stringify(sampleEvaluation(), null, 2)}\n\`\`\``);

  assert.equal(parsed.information_amount_parity, 74);
  assert.equal(parsed.shared_points.length, 2);
});

test("parseEvaluationJson repairs stringly typed fields and missing arrays", () => {
  const parsed = parseEvaluationJson(JSON.stringify({
    overall_equivalence: 0,
    semantic_similarity: "88",
    information_amount_parity: "74",
    doc_a_coverage_by_doc_b: "79",
    doc_b_coverage_by_doc_a: "76",
    verdict: "mostly_equivalent",
    summary: "summary",
    shared_points: "shared fact",
    doc_a_only_points: null,
    doc_b_only_points: ["b-only"],
    information_gap_notes: undefined,
    confidence: "HIGH",
  }));

  assert.equal(parsed.semantic_similarity, 88);
  assert.deepEqual(parsed.shared_points, ["shared fact"]);
  assert.deepEqual(parsed.doc_a_only_points, []);
  assert.deepEqual(parsed.information_gap_notes, []);
  assert.equal(parsed.confidence, "high");
});

test("formatReport renders the core metrics", () => {
  const output = formatReport({
    model: "openai/gpt-4.1-mini",
    sampling: {
      sampleCount: 5,
      estimator: "trimean",
      representativeRun: 3,
    },
    documents: {
      a: { name: "a.md", charCount: 100, lineCount: 8 },
      b: { name: "b.md", charCount: 120, lineCount: 9 },
    },
    evaluation: sampleEvaluation(),
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  });

  assert.match(output, /Sampling: 5 runs \(trimean, representative run 3\)/);
  assert.match(output, /Overall equivalence: 81\/100/);
  assert.match(output, /Semantic similarity: 88\/100/);
  assert.match(output, /Information amount parity: 74\/100/);
  assert.match(output, /Shared points:/);
  assert.match(output, /Usage: prompt_tokens=10, completion_tokens=20, total_tokens=30/);
});

test("calibrateEvaluation derives stable overall score and verdict", () => {
  const calibrated = calibrateEvaluation({
    overall_equivalence: 0,
    semantic_similarity: 85.2,
    information_amount_parity: 80.1,
    doc_a_coverage_by_doc_b: 75.4,
    doc_b_coverage_by_doc_a: 95,
    verdict: "pending_calibration",
    summary: "summary",
    shared_points: ["one"],
    doc_a_only_points: ["two"],
    doc_b_only_points: [],
    information_gap_notes: ["gap"],
    confidence: "high",
  });

  assert.equal(calibrated.overall_equivalence, 84);
  assert.equal(calibrated.verdict, "mostly_equivalent");
});

test("deriveVerdict keeps partial overlap below mostly equivalent", () => {
  const verdict = deriveVerdict({
    overallEquivalence: 67,
    semanticSimilarity: 72,
    informationAmountParity: 82,
    docACoverageByDocB: 58,
    docBCoverageByDocA: 55,
  });

  assert.equal(verdict, "partially_equivalent");
});

test("trimean emphasizes the stable center of five samples", () => {
  assert.equal(trimean([10, 20, 50, 80, 100]), 50);
});

test("aggregateEvaluationRuns uses trimean and representative run", () => {
  const aggregated = aggregateEvaluationRuns([
    sampleRun(1, { semantic_similarity: 70, information_amount_parity: 85, doc_a_coverage_by_doc_b: 55, doc_b_coverage_by_doc_a: 55 }),
    sampleRun(2, { semantic_similarity: 72, information_amount_parity: 85, doc_a_coverage_by_doc_b: 60, doc_b_coverage_by_doc_a: 55 }),
    sampleRun(3, { semantic_similarity: 70, information_amount_parity: 80, doc_a_coverage_by_doc_b: 55, doc_b_coverage_by_doc_a: 45 }),
    sampleRun(4, { semantic_similarity: 75, information_amount_parity: 85, doc_a_coverage_by_doc_b: 60, doc_b_coverage_by_doc_a: 70 }),
    sampleRun(5, { semantic_similarity: 82, information_amount_parity: 90, doc_a_coverage_by_doc_b: 70, doc_b_coverage_by_doc_a: 76 }),
  ]);

  assert.equal(aggregated.evaluation.semantic_similarity, 72);
  assert.equal(aggregated.evaluation.information_amount_parity, 85);
  assert.equal(aggregated.evaluation.doc_a_coverage_by_doc_b, 59);
  assert.equal(aggregated.evaluation.doc_b_coverage_by_doc_a, 59);
  assert.equal(aggregated.sampling.sampleCount, 5);
  assert.equal(aggregated.sampling.estimator, "trimean");
  assert.equal(aggregated.sampling.representativeRun, 2);
  assert.equal(aggregated.usage.total_tokens, 100);
});

test("aggregateEvaluationRuns rejects an empty run list", () => {
  assert.throws(() => aggregateEvaluationRuns([]), /At least one evaluation run is required/);
});

test("parsePerspectiveJson accepts a semantic single-responsibility payload", () => {
  const parsed = parsePerspectiveJson(JSON.stringify({
    semantic_similarity: 91,
    summary: "Both documents describe the same launch decision.",
    shared_points: ["Same rollout date", "Same owner"],
    contradictions_or_scope_shifts: ["No contradiction"],
    confidence: "high",
  }), "semantic_similarity");

  assert.equal(parsed.semantic_similarity, 91);
  assert.equal(parsed.shared_points.length, 2);
});

test("parsePerspectiveJson repairs singleton and missing arrays", () => {
  const parsed = parsePerspectiveJson(JSON.stringify({
    doc_a_coverage_by_doc_b: "68",
    summary: "Document B misses several details from A.",
    covered_points: "Deadline retained",
    missing_points: null,
    information_gap_notes: "B drops operational safeguards.",
    confidence: "HIGH",
  }), "doc_a_coverage_by_doc_b");

  assert.equal(parsed.doc_a_coverage_by_doc_b, 68);
  assert.deepEqual(parsed.covered_points, ["Deadline retained"]);
  assert.deepEqual(parsed.missing_points, []);
  assert.deepEqual(parsed.information_gap_notes, ["B drops operational safeguards."]);
  assert.equal(parsed.confidence, "high");
});

test("aggregatePerspectiveRuns merges single-responsibility outputs into one evaluation", () => {
  const aggregated = aggregatePerspectiveRuns([
    perspectiveRun("semantic_similarity", {
      semantic_similarity: 88,
      summary: "Core meaning matches.",
      shared_points: ["Same migration goal", "Same deadline"],
      contradictions_or_scope_shifts: ["No contradiction"],
    }, "model/semantic"),
    perspectiveRun("information_amount_parity", {
      information_amount_parity: 72,
      summary: "Document A has more implementation detail.",
      doc_a_only_points: ["Document A lists rollback steps."],
      doc_b_only_points: ["Document B adds a short status note."],
      information_gap_notes: ["Overall detail is asymmetric."],
    }, "model/info"),
    perspectiveRun("doc_a_coverage_by_doc_b", {
      doc_a_coverage_by_doc_b: 68,
      summary: "Document B misses several details from A.",
      covered_points: ["Deadline retained"],
      missing_points: ["Rollback steps omitted"],
      information_gap_notes: ["B drops operational safeguards."],
    }, "model/a-coverage"),
    perspectiveRun("doc_b_coverage_by_doc_a", {
      doc_b_coverage_by_doc_a: 84,
      summary: "Document A covers most of B.",
      covered_points: ["Status note implied"],
      missing_points: ["Small wording-only nuance"],
      information_gap_notes: ["A captures most B facts."],
    }, "model/b-coverage"),
  ]);

  assert.equal(aggregated.model, "multi-model-ensemble");
  assert.equal(aggregated.evaluation.semantic_similarity, 88);
  assert.equal(aggregated.evaluation.information_amount_parity, 72);
  assert.equal(aggregated.evaluation.doc_a_coverage_by_doc_b, 68);
  assert.equal(aggregated.evaluation.doc_b_coverage_by_doc_a, 84);
  assert.equal(aggregated.evaluation.overall_equivalence, 81);
  assert.equal(aggregated.evaluation.verdict, "partially_equivalent");
  assert.match(aggregated.evaluation.summary, /Core meaning matches/);
  assert.match(aggregated.evaluation.summary, /Document A has more implementation detail/);
  assert.deepEqual(aggregated.ensemble.perspectives.map((item) => item.id), [
    "semantic_similarity",
    "information_amount_parity",
    "doc_a_coverage_by_doc_b",
    "doc_b_coverage_by_doc_a",
  ]);
  assert.equal(aggregated.usage.total_tokens, 80);
});

test("formatReport renders ensemble metadata", () => {
  const output = formatReport({
    model: "multi-model-ensemble",
    strategy: "single_responsibility_ensemble",
    ensemble: {
      perspectiveCount: 4,
      perspectives: [
        { id: "semantic_similarity", model: "model/semantic" },
        { id: "information_amount_parity", model: "model/info" },
      ],
    },
    sampling: null,
    documents: {
      a: { name: "a.md", charCount: 100, lineCount: 8 },
      b: { name: "b.md", charCount: 120, lineCount: 9 },
    },
    evaluation: sampleEvaluation(),
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  });

  assert.match(output, /Strategy: single_responsibility_ensemble/);
  assert.match(output, /Ensemble: 4 single-responsibility perspectives/);
  assert.match(output, /Perspective runs:/);
  assert.match(output, /semantic_similarity: model\/semantic/);
});

test("parseShellEnvText reads OpenRouter values from zshrc-style exports", () => {
  const parsed = parseShellEnvText(`
export OPENROUTER_API_KEY="key-from-zshrc"
OPENROUTER_DEFAULT_MODEL=openai/gpt-4.1-mini # preferred default
typeset -gx SOMETHING_ELSE=ignore-me
  `);

  assert.deepEqual(parsed, {
    OPENROUTER_API_KEY: "key-from-zshrc",
    OPENROUTER_DEFAULT_MODEL: "openai/gpt-4.1-mini",
  });
});

function sampleEvaluation() {
  return {
    overall_equivalence: 81,
    semantic_similarity: 88,
    information_amount_parity: 74,
    doc_a_coverage_by_doc_b: 79,
    doc_b_coverage_by_doc_a: 76,
    verdict: "mostly_equivalent",
    summary: "The documents reach the same main conclusion, but one is more detailed.",
    shared_points: ["Both describe the same policy change.", "Both mention the rollout date."],
    doc_a_only_points: ["Document A includes background context."],
    doc_b_only_points: ["Document B lists implementation owners."],
    information_gap_notes: ["Document B is missing some explanatory rationale from document A."],
    confidence: "high",
  };
}

function sampleRun(run, overrides = {}) {
  return {
    model: "test/model",
    evaluation: {
      ...sampleEvaluation(),
      ...overrides,
    },
    usage: {
      prompt_tokens: 10,
      completion_tokens: 10,
      total_tokens: 20,
      cost: 0,
    },
  };
}

function perspectiveRun(id, output, model = "test/model") {
  return {
    id,
    label: id,
    model,
    output: {
      confidence: "high",
      ...output,
    },
    usage: {
      prompt_tokens: 10,
      completion_tokens: 10,
      total_tokens: 20,
      cost: 0,
    },
  };
}
