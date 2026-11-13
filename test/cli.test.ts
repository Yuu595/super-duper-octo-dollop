import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

function createRepository(): { root: string; repositoryPath: string } {
  const root = mkdtempSync(join(tmpdir(), "inspector-cli-"));
  temporaryDirectories.push(root);
  const repositoryPath = join(root, "repository with spaces");
  mkdirSync(repositoryPath);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repositoryPath, stdio: "ignore" });

  git("init", "-b", "main");
  git("config", "user.email", "inspector-test@example.com");
  git("config", "user.name", "Inspector Test");
  writeFileSync(join(repositoryPath, "initial.txt"), "initial\n");
  git("add", "initial.txt");
  git("commit", "-m", "initial commit");
  git("checkout", "-b", "feature");
  writeFileSync(join(repositoryPath, "reviewed.md"), "reviewed\n");
  git("add", "reviewed.md");
  git("commit", "-m", "add reviewed file");

  return { root, repositoryPath };
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cliPath, "review", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("CLI", () => {
  it("writes parseable JSON for a repository path containing spaces", () => {
    const { repositoryPath } = createRepository();
    const result = runCli([
      "--repo",
      repositoryPath,
      "--base-ref",
      "main",
      "--format",
      "json",
      "--output",
      "-",
    ]);

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.repositoryPath).toBe(repositoryPath);
    expect(report.changedFiles).toEqual([{ path: "reviewed.md", status: "added" }]);
  });

  it("prints usage and exits 2 for an unknown flag", () => {
    const { repositoryPath } = createRepository();
    const result = runCli(["--repo", repositoryPath, "--unknown"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage: inspector review");
  });

  it.each([
    ["a missing --repo value", ["--repo"]],
    ["an invalid format", ["--repo", "unused path", "--format", "xml"]],
  ])("prints usage and exits 2 for %s", (_description, args) => {
    const result = runCli(args);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage: inspector review");
  });

  it("exits 1 and writes a report when a validation fails", () => {
    const { root, repositoryPath } = createRepository();
    const outputPath = join(root, "failed-review.json");
    const result = runCli([
      "--repo",
      repositoryPath,
      "--base-ref",
      "main",
      "--format",
      "json",
      "--validate",
      "node -e \"process.exit(17)\"",
      "--output",
      outputPath,
    ]);

    expect(result.status).toBe(1);
    const report = JSON.parse(readFileSync(outputPath, "utf8"));
    expect(report.validationResults).toContainEqual(
      expect.objectContaining({ status: "failed", exitCode: 17 }),
    );
  });
});
