import { changedFiles } from "./git.js";
import { markdownReport } from "./report.js";
import type { ChangedFile, ReviewRequest, ValidationResult } from "./types.js";
import { runValidations } from "./validation.js";

export type CollectedReview = {
  repositoryPath: string;
  baseRef?: string;
  changedFiles: ChangedFile[];
  validationResults: ValidationResult[];
};

export async function collectReview(request: ReviewRequest): Promise<CollectedReview> {
  const changedFilesResult = changedFiles(request.repositoryPath, request.baseRef);
  const validationResults = await runValidations(
    request.validationCommands ?? [],
    request.repositoryPath,
  );
  return {
    repositoryPath: request.repositoryPath,
    baseRef: request.baseRef,
    changedFiles: changedFilesResult,
    validationResults,
  };
}

export function formatReview(
  review: CollectedReview,
  format: ReviewRequest["format"] = "markdown",
): string {
  if (format === "json") {
    return `${JSON.stringify(review, null, 2)}\n`;
  }
  return markdownReport(review);
}

export async function reviewRepository(request: ReviewRequest): Promise<string> {
  return formatReview(await collectReview(request), request.format);
}