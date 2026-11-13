# Rules for AI agents in this repo

Context: TypeScript repository-inspector tool. src/cli.ts (CLI) and src/mcp-server.ts (MCP)
share src/core.ts. This is a timed hiring assessment: keep each change small and reviewable.

- Do not add npm dependencies. Use Node built-ins (node:util parseArgs, node:child_process,
  node:fs, node:path, node:os).
- Keep existing exports and names working: reviewRepository, markdownReport, changedFiles,
  runValidations, the review_repository MCP tool and its input names, and the existing CLI flags.
  New optional fields and new functions are fine.
- Run git only with execFileSync/spawn and an argument array. Never build a shell string for git.
- Never use `any`.
- Every fix needs a vitest test in test/. Tests that touch git create a real temporary repo
  in os.tmpdir() and delete it afterwards. Do not mock child_process or git.
- Commands used inside tests must work on Windows, macOS and Linux: use `node -e "..."`,
  not sleep, echo >&2 or exit.
- After each change run `npm run typecheck` and `npm test` and show the real output.
  Never say tests pass without running them. Never weaken or delete a test to make it pass.
- Do not edit SUBMISSION.md. Edit README.md only when asked.
- One change at a time. Do not refactor unrelated code.