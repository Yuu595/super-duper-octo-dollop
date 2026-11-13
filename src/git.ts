import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import type { ChangedFile } from "./types.js";

function git(repositoryPath: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repositoryPath,
    encoding: "utf8",
    timeout: 30_000,
  }).trim();
}

function resolveCommit(repositoryPath: string, ref: string): string | undefined {
  try {
    return git(repositoryPath, [
      "rev-parse",
      "--verify",
      "--quiet",
      "--end-of-options",
      `${ref}^{commit}`,
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      "status" in error &&
      typeof error.status === "number"
    ) {
      return undefined;
    }
    throw error;
  }
}

export function changedFiles(repositoryPath: string, baseRef?: string): ChangedFile[] {
  if (!existsSync(repositoryPath)) {
    throw new Error(`Repository path does not exist: ${repositoryPath}`);
  }
  if (!statSync(repositoryPath).isDirectory()) {
    throw new Error(`Repository path is not a directory: ${repositoryPath}`);
  }

  let isInsideWorkTree: string;
  try {
    isInsideWorkTree = git(repositoryPath, ["rev-parse", "--is-inside-work-tree"]);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("Git executable was not found. Ensure Git is installed and available on PATH.");
    }
    throw new Error(`Path is not inside a Git working tree: ${repositoryPath}`);
  }
  if (isInsideWorkTree !== "true") {
    throw new Error(`Path is not inside a Git working tree: ${repositoryPath}`);
  }

  let base: string | undefined;
  if (baseRef !== undefined) {
    if (baseRef.startsWith("-")) {
      throw new Error(`Invalid base ref "${baseRef}": refs must not start with "-".`);
    }
    base = resolveCommit(repositoryPath, baseRef);
    if (base === undefined) {
      throw new Error(`Base ref "${baseRef}" does not resolve to a commit.`);
    }
  } else {
    for (const candidate of ["origin/HEAD", "main", "master"]) {
      base = resolveCommit(repositoryPath, candidate);
      if (base !== undefined) {
        break;
      }
    }
    if (base === undefined) {
      throw new Error("Unable to determine a base ref. Pass --base-ref <ref>.");
    }
  }

  const output = git(repositoryPath, ["diff", "--name-status", `${base}...HEAD`]);

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [code, ...pathParts] = line.split("\t");
      const status = code === "A" ? "added" : code === "D" ? "deleted" : "modified";
      return { path: pathParts.join("\t"), status };
    });
}