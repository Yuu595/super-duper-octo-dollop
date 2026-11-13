import { exec, type ExecException } from "node:child_process";
import type { ValidationResult } from "./types.js";

const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 20_000;
const DEFAULT_TIMEOUT_MS = 120_000;

export function runValidation(
  command: string,
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ValidationResult> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const finish = (
      error: ExecException | null,
      stdout: string,
      stderr: string,
    ) => {
      const combinedOutput = stdout + (stdout && stderr ? "\n" : "") + stderr;
      const truncated = combinedOutput.length > MAX_OUTPUT_CHARS;
      const output = truncated
        ? `[Output truncated; showing the last ${MAX_OUTPUT_CHARS} characters]\n${combinedOutput.slice(-MAX_OUTPUT_CHARS)}`
        : combinedOutput;

      resolve({
        command,
        status: error ? "failed" : "passed",
        output,
        exitCode: typeof error?.code === "number" ? error.code : error ? null : 0,
        timedOut: Boolean(error?.killed && error.signal === "SIGTERM"),
        durationMs: Date.now() - startedAt,
      });
    };

    try {
      exec(
        command,
        { cwd, timeout: timeoutMs, maxBuffer: MAX_BUFFER_BYTES, encoding: "utf8" },
        finish,
      );
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)), "", "");
    }
  });
}

export async function runValidations(commands: string[], cwd: string): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  for (const command of commands) {
    results.push(await runValidation(command, cwd));
  }
  return results;
}