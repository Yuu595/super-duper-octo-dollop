import { describe, expect, it } from "vitest";
import { runValidation } from "../src/validation.js";

describe("runValidation", () => {
  it("resolves with a passing command result", async () => {
    const result = await runValidation(`node -e "process.stdout.write('ok')"`, process.cwd());

    expect(result).toMatchObject({
      status: "passed",
      output: "ok",
      exitCode: 0,
      timedOut: false,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("resolves with output and exit code for a failing command", async () => {
    const result = await runValidation(
      `node -e "process.stdout.write('partial'); process.exit(7)"`,
      process.cwd(),
    );

    expect(result).toMatchObject({
      status: "failed",
      output: "partial",
      exitCode: 7,
      timedOut: false,
    });
  });

  it("captures stderr even when stdout is non-empty", async () => {
    const result = await runValidation(
      `node -e "process.stdout.write('stdout'); process.stderr.write('stderr')"`,
      process.cwd(),
    );

    expect(result.status).toBe("passed");
    expect(result.output).toContain("stdout");
    expect(result.output).toContain("stderr");
  });

  it("keeps the last 20,000 output characters and marks truncation", async () => {
    const result = await runValidation(
      `node -e "process.stdout.write('x'.repeat(20001))"`,
      process.cwd(),
    );

    expect(result.output).toBe(
      `[Output truncated; showing the last 20000 characters]\n${"x".repeat(20000)}`,
    );
  });

  it("resolves timed-out commands as failed", async () => {
    const result = await runValidation(
      `node -e "setTimeout(()=>{},5000)"`,
      process.cwd(),
      500,
    );

    expect(result.status).toBe("failed");
    expect(result.timedOut).toBe(true);
  });
});
