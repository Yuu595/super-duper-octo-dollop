# Submission

## What did you investigate first, and why?

I read every file first (with Claude) and reproduced bugs against throwaway Git repos before changing anything, so I would fix confirmed problems rather than guesses. I started with the MCP adapter and the validation runner because they sit on the trust boundary: the MCP handler read `input.repoPath` while the schema declared `repo_path`, so it silently reviewed the server's own folder, and it passed agent-supplied strings straight to a shell. The validation runner was next because any failing command crashed the run and produced no report, so the most useful information (a failing test) was lost.

## What did you choose to implement or fix?

One commit per fix, in priority order:

1. **Validation** (`2e14d4c`): failing commands resolve as `failed` with exit code; stdout and stderr are both kept; 120 s timeout; 10 MB buffer; output capped to the last 20,000 characters.
2. **Report** (`23f873b`): summary line; PASS / FAIL (exit code or timed out) per validation; Markdown escaping for paths and commands; code fences that backticks in output can't break; empty-state messages.
3. **MCP** (`9354504`, `771e024`): handler reads `repo_path`; input typed from the zod schema (no `any`); the repo path must resolve (realpath) inside `INSPECTOR_ALLOWED_ROOTS`; validation commands run only on an exact match with `INSPECTOR_ALLOWED_VALIDATIONS`; errors return `isError` instead of throwing; fails closed when no roots are configured. Split into `createServer()` so it is tested through a real MCP client (InMemoryTransport).
4. **Git** (`5a0572d`): a base ref starting with `-` is rejected (`--output=<file>` let git write files) and refs are verified with `rev-parse --verify --end-of-options`; default base is origin/HEAD → main → master; clear errors for a missing path or a non-repo; 30 s timeout. Also covered by an MCP regression test.
5. **CLI** (`0abde98`): strict `node:util` parseArgs; paths with spaces; real `--format json`; `--output` (`-` = stdout); exit codes 0 / 1 / 2; one-line errors. `collectReview` and `formatReview` in core are shared by both adapters; `reviewRepository` keeps its signature.
6. **Test setup** (`vitest.config.ts`): CI runs `npm run build` before `npm test`, and Vitest 4 also ran the compiled tests in `dist/`. Limited Vitest to `test/` so CI is green again.

Tests went from 1 to 25.

## What did you intentionally not do?

- Rename and non-ASCII path parsing (`git diff -z`) and listing uncommitted or untracked files: real bugs, but lower impact than the security and crash fixes.
- The `bin` path in package.json (`./dist/cli.js`, but tsc emits `dist/src/cli.js`).
- Structured JSON output for MCP; it returns Markdown text.
- Killing the whole process tree on timeout.
- New dependencies: everything uses Node built-ins.

## Interface decision

- Decision: **hybrid**, with one shared core.
- Primary user and execution environment: developers running the CLI in a terminal or CI, and AI coding agents calling the MCP tool from an IDE on the same machine.
- Trust boundary and allowed capabilities: the CLI user is trusted (they type the command), so `--validate` accepts any command and any path. The MCP caller is not fully trusted, because an agent can be steered by content in the repository it is reviewing (prompt injection). So MCP can only read repos inside operator-configured roots, only runs validation commands the operator allowlisted exactly, rejects option-like refs, and refuses everything if no roots are configured. An allowlisted `npm test` still runs the repo's own scripts, so roots should only contain repos the operator trusts.
- Reliability, discoverability, latency/context, and output tradeoffs: timeouts on git (30 s) and validations (120 s) so an agent never hangs; validation output capped at 20,000 characters to protect the agent's context window; errors come back as `isError` messages instead of crashes. The CLI has `--help`, strict flag parsing and exit codes (0 passed, 1 validation failed, 2 usage or setup error) so it works in CI. JSON for machines, Markdown for people.
- How supported interfaces remain consistent: both adapters call the same `collectReview` / `reviewRepository` in core, so changed files, validation results and report format are identical; only the trust policy differs, and it lives in the MCP adapter. Tests exercise both: the CLI as a child process, MCP through an SDK client.
- Evidence that would change this decision: if usage data showed almost all runs come from CI, I would go CLI-first; if agents were the only users, MCP-first with structured JSON output. A need to run validations in untrusted repos would push toward sandboxing (a container) instead of an allowlist.

## How did you use an AI coding agent?

I used Claude (chat) to read the repo, reproduce bugs and plan a prioritised list of prompts, and GitHub Copilot agent mode in VS Code to implement one fix per prompt, guided by an `AGENTS.md` rules file (no new dependencies, keep existing exports, real temp-repo tests, run typecheck and tests). After each prompt I read the diff, ran typecheck and tests myself, ran a manual check against sample repos, then committed. Claude also reviewed my pushed commits.

## Where did you check, correct, or reject an AI suggestion? (required)

- **P1:** Copilot made the new `ValidationResult` fields required and edited the existing report test so it compiled. I had it make them optional and restore the original test, so existing callers keep working. Checked with `git diff test/report.test.ts` (empty) and `npm test`.
- **P3:** Claude's plan defaulted the MCP allowed root to the server's working directory. On review this fails open: MCP clients can start servers from `/` or the home folder, which would allow every repo on the machine. I changed it to fail closed, with tests (`771e024`).
- **P3:** Copilot edited README.md although `AGENTS.md` said not to unless asked. I reviewed the text and kept it, because the docs had to match the new MCP contract.

## Commands used to verify the result, with outcomes

- Baseline: `npm run typecheck` passed; `npm test` 1 passed.
- After each fix: typecheck passed; tests grew 6 → 10 → 14 → 20 → 25, all passing.
- Failing validation (`--validate "node -e \"console.error('boom');process.exit(1)\""`): before, crash and no report; after, report written with `boom` and FAIL (exit 1), exit code 1.
- `--base-ref "--output=/tmp/pwned.txt"`: before, git wrote `/tmp/pwned.txt...HEAD`; after, rejected, and `ls /tmp/pwned.txt*` found nothing.
- `--repo /tmp/master-only` (no main branch): works without `--base-ref`.
- `--repo /tmp/does-not-exist`: before, `spawnSync git ENOENT`; after, "Repository path does not exist", exit code 2.
- `--repo "/tmp/my repo" --format json --output -`: valid JSON from a path with a space.
- `--nope`: usage text, exit code 2.
- GitHub Actions: passed for the first five commits, then failed after the CLI fix. CI runs `npm run build` before `npm test`, and Vitest 4 also ran the compiled tests in `dist/`, where the CLI test couldn't find `src/cli.ts`. Reproduced locally with `npm run build && npm test` (5 failures, all in `dist/test/cli.test.js`), fixed with `vitest.config.ts`, then 25/25 passing.

## A blocker you hit and how you approached it

My first manual check failed with `spawnSync git ENOENT`, which looked like git was missing. The real cause was that my sample repo folder didn't exist yet: the tool reported a missing path as a git error. I created the sample repos, reran the check, and fixed the misleading message in the Git commit.

After the CLI fix, CI went red even though tests passed on my machine. I reproduced it by running the same steps as CI (`npm run build && npm test`): compiled test copies in `dist/` were being run, and the CLI test couldn't find `src/cli.ts` from there. I limited Vitest to `test/`, confirmed 25/25 locally, and pushed the fix.

## Known limitations and the next three things you would do

Known limitations: renamed files show as `old<TAB>new (modified)` and non-ASCII names come out quoted; uncommitted and untracked changes are ignored; a timeout kills only the shell, not its child processes; a command that passes but prints more than 10 MB is reported as failed; the `bin` entry points to a file the build doesn't produce; MCP returns Markdown only.

Next three:

1. Parse `git diff -z -M` (renames, non-ASCII names) and optionally include uncommitted and untracked files.
2. Return structured JSON from MCP (`structuredContent` with an output schema) so agents don't parse Markdown, with a total response size cap.
3. Fix the `bin` path in package.json and kill the whole process group on timeout.

## Approximate focused-work time

- Start: 22:10
- Finish: 23:20, plus about 15 minutes (23:25–23:40) after first pushing SUBMISSION.md, to fix the CI failure I found then.