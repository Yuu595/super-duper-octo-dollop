import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changedFiles } from "../src/git.js";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "inspector-git-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createRepository(root: string, branch: string): string {
  const repositoryPath = join(root, "repository");
  mkdirSync(repositoryPath);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repositoryPath, stdio: "ignore" });

  git("init", "-b", branch);
  git("config", "user.email", "inspector-test@example.com");
  git("config", "user.name", "Inspector Test");
  writeFileSync(join(repositoryPath, "initial.txt"), "initial\n");
  git("add", "initial.txt");
  git("commit", "-m", "initial commit");

  return repositoryPath;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("changedFiles", () => {
  it("rejects a base ref starting with a dash without creating its output file", () => {
    const root = createTemporaryDirectory();
    const repositoryPath = createRepository(root, "main");
    const outputPath = join(root, "unexpected-output");

    expect(() => changedFiles(repositoryPath, `--output=${outputPath}`)).toThrow(
      /must not start with "-"/,
    );
    expect(existsSync(outputPath)).toBe(false);
  });

  it("uses master as the default base when it is the only branch", () => {
    const root = createTemporaryDirectory();
    const repositoryPath = createRepository(root, "master");
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repositoryPath, encoding: "utf8" }).trim();

    git("checkout", "--detach");
    writeFileSync(join(repositoryPath, "reviewed.md"), "reviewed\n");
    git("add", "reviewed.md");
    git("commit", "-m", "add reviewed file");

    expect(git("for-each-ref", "--format=%(refname:short)", "refs/heads")).toBe("master");
    expect(changedFiles(repositoryPath)).toEqual([{ path: "reviewed.md", status: "added" }]);
  });

  it("reports a clear error for a missing repository path", () => {
    const root = createTemporaryDirectory();
    const missingPath = join(root, "missing");

    expect(() => changedFiles(missingPath)).toThrow(
      `Repository path does not exist: ${missingPath}`,
    );
  });
});
