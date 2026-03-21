#!/usr/bin/env node

import { resolve } from "node:path";

import { evaluateDocuments, formatReport } from "./evaluator.js";

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
  });

  if (options.output === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatReport(result)}\n`);
}

function parseArgs(args) {
  const positional = [];
  let output = "text";
  let model;

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
  };
}

function printHelp(exitCode) {
  const message = `
Usage:
  doc-similarity <document-a> <document-b> [--json|--text] [--model <openrouter-model>]

Environment:
  OPENROUTER_API_KEY        Required
  OPENROUTER_DEFAULT_MODEL  Required unless --model is provided
  `.trim();

  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${message}\n`);
  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});
