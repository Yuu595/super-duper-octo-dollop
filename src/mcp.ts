import { realpathSync } from "node:fs";
import { isAbsolute, relative, sep, delimiter } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { reviewRepository } from "./core.js";

export type ServerOptions = {
  allowedRoots?: string[];
  allowedValidations?: string[];
};

const reviewInputSchema = z.object({
  repo_path: z.string().describe("Repository path to inspect."),
  baseRef: z.string().optional(),
  validationCommands: z.array(z.string()).optional(),
});

type ReviewInput = z.infer<typeof reviewInputSchema>;

function getDefaultRoots(): string[] {
  const configuredRoots = process.env.INSPECTOR_ALLOWED_ROOTS;
  return configuredRoots
    ? configuredRoots.split(delimiter).filter((root) => root.length > 0)
    : [];
}

function getDefaultValidations(): string[] {
  const configuredValidations = process.env.INSPECTOR_ALLOWED_VALIDATIONS;
  if (configuredValidations === undefined) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(configuredValidations);
  } catch {
    throw new Error("INSPECTOR_ALLOWED_VALIDATIONS must be a JSON array of strings.");
  }
  if (!Array.isArray(parsed) || !parsed.every((command) => typeof command === "string")) {
    throw new Error("INSPECTOR_ALLOWED_VALIDATIONS must be a JSON array of strings.");
  }
  return parsed;
}

function isWithinRoot(repositoryPath: string, root: string): boolean {
  const pathFromRoot = relative(root, repositoryPath);
  return (
    pathFromRoot === "" ||
    (!isAbsolute(pathFromRoot) &&
      pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`))
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createServer(options: ServerOptions = {}): McpServer {
  const allowedRoots = options.allowedRoots ?? getDefaultRoots();
  const allowedValidations = options.allowedValidations ?? getDefaultValidations();
  const server = new McpServer({ name: "repository-inspector", version: "2.0.0" });

  server.registerTool(
    "review_repository",
    {
      description: "Inspects a Git repository and returns a review report.",
      inputSchema: reviewInputSchema,
    },
    async (input: ReviewInput) => {
      try {
        if (allowedRoots.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "No allowed roots configured. Set INSPECTOR_ALLOWED_ROOTS to the folders this server may inspect.",
              },
            ],
          };
        }

        const resolvedAllowedRoots = allowedRoots.map((root) => {
          try {
            return realpathSync(root);
          } catch (error) {
            throw new Error(
              `Unable to resolve configured allowed root "${root}": ${errorMessage(error)}`,
            );
          }
        });
        const repositoryPath = realpathSync(input.repo_path);
        if (!resolvedAllowedRoots.some((root) => isWithinRoot(repositoryPath, root))) {
          return {
            isError: true,
            content: [{ type: "text", text: "Repository path is outside the allowed roots." }],
          };
        }

        const validationCommands = input.validationCommands ?? [];
        const disallowedCommand = validationCommands.find(
          (command) => !allowedValidations.includes(command),
        );
        if (disallowedCommand !== undefined) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Validation command is not allowed: ${JSON.stringify(disallowedCommand)}`,
              },
            ],
          };
        }

        const report = await reviewRepository({
          repositoryPath,
          baseRef: input.baseRef,
          validationCommands,
        });
        return { content: [{ type: "text", text: report }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: errorMessage(error) }],
        };
      }
    },
  );

  return server;
}
