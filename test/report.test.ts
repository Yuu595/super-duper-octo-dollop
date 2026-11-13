import { describe, expect, it } from "vitest";
import { markdownReport } from "../src/report.js";

describe("markdownReport", () => {
  it("lists changed files and validation output", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [{ path: "src/index.ts", status: "modified" }],
      validationResults: [{ command: "npm test", status: "passed", output: "ok" }],
    });

    expect(report).toContain("src/index.ts (modified)");
    expect(report).toContain("npm test");
    expect(report).toContain("ok");
  });

  it("shows each validation result in its heading and summarizes totals", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [{ path: "src/index.ts", status: "modified" }],
      validationResults: [
        { command: "npm test", status: "passed", output: "ok" },
        { command: "npm run lint", status: "failed", exitCode: 2, output: "error" },
        { command: "npm run build", status: "failed", timedOut: true, output: "" },
      ],
    });

    expect(report).toContain("Changed files: 1");
    expect(report).toContain("1 of 3 validations passed");
    expect(report).toContain("### PASS: npm test");
    expect(report).toContain("### FAIL: npm run lint (exit 2)");
    expect(report).toContain("### FAIL: npm run build (timed out)");
  });

  it("uses a code fence longer than any backtick run in output", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [],
      validationResults: [
        { command: "npm test", status: "passed", output: "before ``` after" },
      ],
    });

    expect(report).toContain("````\nbefore ``` after\n````");
  });

  it("escapes Markdown punctuation in paths and commands", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [{ path: "[click](evil.example).md", status: "added" }],
      validationResults: [
        { command: "run [check](evil.example)", status: "passed", output: "" },
      ],
    });

    expect(report).toContain("- \\[click\\]\\(evil.example\\).md (added)");
    expect(report).toContain("### PASS: run \\[check\\]\\(evil.example\\)");
  });

  it("reports empty lists and ends with a newline", () => {
    const report = markdownReport({
      repositoryPath: "/work/sample",
      changedFiles: [],
      validationResults: [],
    });

    expect(report).toContain("No changed files.");
    expect(report).toContain("No validations run.");
    expect(report.endsWith("\n")).toBe(true);
  });
});