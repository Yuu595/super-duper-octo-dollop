#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { parseArgs as parseNodeArgs } from "node:util";
import { collectReview, formatReview } from "./core.js";

const USAGE =
  "Usage: inspector review --repo <path> [--base-ref <ref>] [--format <markdown|json>] [--validate <command> ...] [--output <file|->] [--help]";

class UsageError extends Error {}

type CliArgs = {
  repositoryPath: string;
  baseRef?: string;
  format: "markdown" | "json";
  validationCommands: string[];
  outputPath?: string;
  help: boolean;
};

function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseNodeArgs({
    args: argv,
    options: {
      repo: { type: "string" },
      "base-ref": { type: "string" },
      format: { type: "string", default: "markdown" },
      validate: { type: "string", multiple: true },
      output: { type: "string" },
      help: { type: "boolean" },
    },
    strict: true,
    allowPositionals: true,
  });

  if (values.help) {
    return {
      repositoryPath: "",
      format: "markdown",
      validationCommands: [],
      help: true,
    };
  }
  if (positionals.length !== 1 || positionals[0] !== "review") {
    throw new UsageError("Expected the review command.");
  }
  if (!values.repo) {
    throw new UsageError("Missing required option --repo.");
  }
  if (values.format !== "markdown" && values.format !== "json") {
    throw new UsageError(`Invalid value for --format: ${values.format}.`);
  }

  return {
    repositoryPath: values.repo,
    baseRef: values["base-ref"],
    format: values.format,
    validationCommands: values.validate ?? [],
    outputPath: values.output,
    help: false,
  };
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ");
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${errorMessage(error)}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    console.log(USAGE);
    return;
  }

  try {
    const review = await collectReview({
      repositoryPath: args.repositoryPath,
      baseRef: args.baseRef,
      validationCommands: args.validationCommands,
      format: args.format,
    });
    const report = formatReview(review, args.format);
    const outputPath =
      args.outputPath ?? (args.format === "json" ? "review-report.json" : "review-report.md");

    if (outputPath === "-") {
      process.stdout.write(report);
    } else {
      writeFileSync(outputPath, report, "utf8");
    }

    process.exitCode = review.validationResults.every((result) => result.status === "passed")
      ? 0
      : 1;
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 2;
  }
}

void main();
