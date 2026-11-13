import type { ChangedFile, ValidationResult } from "./types.js";

type ReportInput = {
  repositoryPath: string;
  changedFiles: ChangedFile[];
  validationResults: ValidationResult[];
};

function escapeMarkdown(value: string): string {
  return value.replace(/[!"#$%&'()*+,;:<=>?@[\]\\^_`{|}~]/g, "\\$&");
}

export function markdownReport(input: ReportInput): string {
  const passedCount = input.validationResults.filter(
    (result) => result.status === "passed",
  ).length;
  const lines = [
    `# Review Report: ${escapeMarkdown(input.repositoryPath)}`,
    "",
    "## Summary",
    `Changed files: ${input.changedFiles.length}`,
    `${passedCount} of ${input.validationResults.length} validations passed`,
    "",
    "## Changed files",
  ];
  if (input.changedFiles.length === 0) {
    lines.push("No changed files.");
  } else {
    for (const file of input.changedFiles) {
      lines.push(`- ${escapeMarkdown(file.path)} (${file.status})`);
    }
  }
  lines.push("", "## Validation output");
  if (input.validationResults.length === 0) {
    lines.push("No validations run.");
  } else {
    for (const result of input.validationResults) {
      const heading = result.timedOut
        ? `### FAIL: ${escapeMarkdown(result.command)} (timed out)`
        : result.status === "passed"
          ? `### PASS: ${escapeMarkdown(result.command)}`
          : `### FAIL: ${escapeMarkdown(result.command)} (exit ${result.exitCode ?? 1})`;
      const longestBacktickRun =
        result.output.match(/`+/g)?.reduce((longest, run) => Math.max(longest, run.length), 0) ??
        0;
      const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
      lines.push(heading, fence, result.output, fence);
    }
  }
  return `${lines.join("\n")}\n`;
}