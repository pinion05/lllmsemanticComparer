import test from "node:test";
import assert from "node:assert/strict";

import { parseArgs } from "../src/cli.js";

test("parseArgs keeps sampling as the default strategy", () => {
  const parsed = parseArgs(["a.txt", "b.txt", "--json", "--model", "openai/gpt-4.1-mini"]);

  assert.deepEqual(parsed, {
    fileA: "a.txt",
    fileB: "b.txt",
    output: "json",
    model: "openai/gpt-4.1-mini",
    strategy: "sampling",
    perspectiveModels: {},
  });
});

test("parseArgs accepts single-responsibility ensemble perspective models", () => {
  const parsed = parseArgs([
    "a.txt",
    "b.txt",
    "--strategy",
    "single_responsibility_ensemble",
    "--perspective-model",
    "semantic=anthropic/claude-3.7-sonnet",
    "--perspective-model",
    "coverage_a=openai/gpt-4.1-mini",
  ]);

  assert.equal(parsed.strategy, "single_responsibility_ensemble");
  assert.deepEqual(parsed.perspectiveModels, {
    semantic_similarity: "anthropic/claude-3.7-sonnet",
    doc_a_coverage_by_doc_b: "openai/gpt-4.1-mini",
  });
});

test("parseArgs rejects unknown perspective aliases", () => {
  assert.throws(
    () => parseArgs(["a.txt", "b.txt", "--perspective-model", "unknown=model-x"]),
    /Unknown perspective/,
  );
});
