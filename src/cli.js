#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { EVALUATION_STRATEGIES, evaluateDocuments, formatReport } from "./evaluator.js";

const PERSPECTIVE_ALIASES = new Map([
  ["semantic", "semantic_similarity"],
  ["semantic_similarity", "semantic_similarity"],
  ["meaning", "semantic_similarity"],
  ["info", "information_amount_parity"],
  ["information", "information_amount_parity"],
  ["information_amount_parity", "information_amount_parity"],
  ["coverage_a", "doc_a_coverage_by_doc_b"],
  ["a_coverage", "doc_a_coverage_by_doc_b"],
  ["doc_a_coverage_by_doc_b", "doc_a_coverage_by_doc_b"],
  ["coverage_b", "doc_b_coverage_by_doc_a"],
  ["b_coverage", "doc_b_coverage_by_doc_a"],
  ["doc_b_coverage_by_doc_a", "doc_b_coverage_by_doc_a"],
]);

async function main() {
  const args = process.argv.slice(2);
  const wantsHelp = args.includes("--help");

  if (wantsHelp || args.length < 2) {
    printHelp(wantsHelp ? 0 : 1);
    return;
  }

  const options = parseArgs(args);
  const result = await evaluateDocuments({
    fileA: resolve(options.fileA),
    fileB: resolve(options.fileB),
    model: options.model,
    strategy: options.strategy,
    perspectiveModels: options.perspectiveModels,
  });

  if (options.output === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatReport(result)}\n`);
}

export function parseArgs(args) {
  const positional = [];
  let output = "text";
  let model;
  let strategy = EVALUATION_STRATEGIES.SAMPLING;
  const perspectiveModels = {};

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === "--json") {
      output = "json";
      continue;
    }

    if (value === "--text") {
      output = "text";
      continue;
    }

    if (value === "--model") {
      model = args[index + 1];
      if (!model || model.startsWith("--")) {
        throw new Error("--model requires a model id.");
      }
      index += 1;
      continue;
    }

    if (value === "--strategy") {
      strategy = args[index + 1];
      if (!strategy || strategy.startsWith("--")) {
        throw new Error("--strategy requires a value.");
      }
      if (!Object.values(EVALUATION_STRATEGIES).includes(strategy)) {
        throw new Error(`Unsupported strategy: ${strategy}`);
      }
      index += 1;
      continue;
    }

    if (value === "--perspective-model") {
      const spec = args[index + 1];
      if (!spec || spec.startsWith("--")) {
        throw new Error("--perspective-model requires <perspective>=<model>.");
      }

      const [perspectiveKey, ...modelParts] = spec.split("=");
      const perspective = PERSPECTIVE_ALIASES.get(perspectiveKey);
      const perspectiveModel = modelParts.join("=");

      if (!perspective) {
        throw new Error(`Unknown perspective for --perspective-model: ${perspectiveKey}`);
      }

      if (!perspectiveModel) {
        throw new Error("--perspective-model requires <perspective>=<model>.");
      }

      perspectiveModels[perspective] = perspectiveModel;
      index += 1;
      continue;
    }

    positional.push(value);
  }

  if (positional.length < 2) {
    throw new Error("Two document paths are required.");
  }

  return {
    fileA: positional[0],
    fileB: positional[1],
    output,
    model,
    strategy,
    perspectiveModels,
  };
}

function printHelp(exitCode) {
  const message = `
Usage:
  doc-similarity <document-a> <document-b> [--json|--text] [--model <openrouter-model>] [--strategy <sampling|single_responsibility_ensemble>] [--perspective-model <perspective=model> ...]

Perspective keys:
  semantic | info | coverage_a | coverage_b

Environment:
  OPENROUTER_API_KEY        Required
  OPENROUTER_DEFAULT_MODEL  Required unless --model is provided
  `.trim();

  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${message}\n`);
  process.exitCode = exitCode;
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
