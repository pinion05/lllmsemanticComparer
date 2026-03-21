#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { evaluateDocuments } from "../src/evaluator.js";

async function main() {
  const manifestPath = resolve("./examples/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const summaries = [];

  for (const entry of manifest) {
    const result = await evaluateDocuments({
      fileA: resolve(entry.fileA),
      fileB: resolve(entry.fileB),
    });

    summaries.push({
      id: entry.id,
      description: entry.description,
      verdict: result.evaluation.verdict,
      overall: result.evaluation.overall_equivalence,
      semantic: result.evaluation.semantic_similarity,
      infoParity: result.evaluation.information_amount_parity,
      aToB: result.evaluation.doc_a_coverage_by_doc_b,
      bToA: result.evaluation.doc_b_coverage_by_doc_a,
      summary: result.evaluation.summary,
      model: result.model,
      totalTokens: result.usage?.total_tokens ?? null,
    });
  }

  process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), summaries }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});
