import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type ServerOptions } from "../src/mcp.js";

const temporaryDirectories: string[] = [];
let originalAllowedRoots: string | undefined;

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "inspector-mcp-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createGitRepository(root: string): string {
  const repositoryPath = join(root, "repository");
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

  return repositoryPath;
}

async function connectClient(options: ServerOptions) {
  const server = createServer(options);
  const client = new Client({ name: "inspector-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

beforeEach(() => {
  originalAllowedRoots = process.env.INSPECTOR_ALLOWED_ROOTS;
  delete process.env.INSPECTOR_ALLOWED_ROOTS;
});

afterEach(() => {
  if (originalAllowedRoots === undefined) {
    delete process.env.INSPECTOR_ALLOWED_ROOTS;
  } else {
    process.env.INSPECTOR_ALLOWED_ROOTS = originalAllowedRoots;
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("MCP review_repository", () => {
  it("fails closed when no allowed roots are configured", async () => {
    const root = createTemporaryDirectory();
    const repositoryPath = createGitRepository(root);
    const { client, close } = await connectClient({});

    try {
      const result = await client.callTool({
        name: "review_repository",
        arguments: { repo_path: repositoryPath },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContainEqual(
        expect.objectContaining({
          type: "text",
          text: "No allowed roots configured. Set INSPECTOR_ALLOWED_ROOTS to the folders this server may inspect.",
        }),
      );
    } finally {
      await close();
    }
  });

  it("reports a configured allowed root that does not exist", async () => {
    const root = createTemporaryDirectory();
    const repositoryPath = createGitRepository(root);
    const missingRoot = join(root, "missing-root");
    const { client, close } = await connectClient({ allowedRoots: [missingRoot] });

    try {
      const result = await client.callTool({
        name: "review_repository",
        arguments: { repo_path: repositoryPath },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContainEqual(
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining(missingRoot),
        }),
      );
      expect(result.content).toContainEqual(
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Unable to resolve configured allowed root"),
        }),
      );
    } finally {
      await close();
    }
  });

  it("reviews a repository inside an allowed root", async () => {
    const root = createTemporaryDirectory();
    const repositoryPath = createGitRepository(root);
    const { client, close } = await connectClient({ allowedRoots: [root] });

    try {
      const result = await client.callTool({
        name: "review_repository",
        arguments: { repo_path: repositoryPath, baseRef: "main" },
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContainEqual(
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("reviewed.md (added)"),
        }),
      );
    } finally {
      await close();
    }
  });

  it("rejects a base ref starting with a dash without creating its output file", async () => {
    const root = createTemporaryDirectory();
    const repositoryPath = createGitRepository(root);
    const outputPath = join(root, "unexpected-output");
    const { client, close } = await connectClient({ allowedRoots: [root] });

    try {
      const result = await client.callTool({
        name: "review_repository",
        arguments: { repo_path: repositoryPath, baseRef: `--output=${outputPath}` },
      });

      expect(result.isError).toBe(true);
      expect(existsSync(outputPath)).toBe(false);
    } finally {
      await close();
    }
  });

  it("rejects a repository outside the allowed roots", async () => {
    const allowedRoot = createTemporaryDirectory();
    const outsideRoot = createTemporaryDirectory();
    const outsideRepository = createGitRepository(outsideRoot);
    const { client, close } = await connectClient({ allowedRoots: [allowedRoot] });

    try {
      const result = await client.callTool({
        name: "review_repository",
        arguments: { repo_path: outsideRepository },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContainEqual(
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("outside the allowed roots"),
        }),
      );
    } finally {
      await close();
    }
  });

  it("rejects validation commands that are not allowlisted", async () => {
    const root = createTemporaryDirectory();
    const repositoryPath = createGitRepository(root);
    const { client, close } = await connectClient({ allowedRoots: [root] });

    try {
      const result = await client.callTool({
        name: "review_repository",
        arguments: {
          repo_path: repositoryPath,
          baseRef: "main",
          validationCommands: ["node -e \"process.exit(17)\""],
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContainEqual(
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Validation command is not allowed"),
        }),
      );
    } finally {
      await close();
    }
  });

  it("runs an allowlisted validation command", async () => {
    const root = createTemporaryDirectory();
    const repositoryPath = createGitRepository(root);
    const command = `${JSON.stringify(process.execPath)} -e "process.stdout.write('allowed-validation-ran')"`;
    const { client, close } = await connectClient({
      allowedRoots: [root],
      allowedValidations: [command],
    });

    try {
      const result = await client.callTool({
        name: "review_repository",
        arguments: {
          repo_path: repositoryPath,
          baseRef: "main",
          validationCommands: [command],
        },
      });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContainEqual(
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("allowed-validation-ran"),
        }),
      );
    } finally {
      await close();
    }
  });
});
