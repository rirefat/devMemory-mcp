
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import {
  readdir,
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";

// --------------------------------------------------
// Configuration
// --------------------------------------------------

const MAX_RESULTS = 100;
const MAX_FILE_SIZE = 200_000;
const MAX_SEARCH_FILES = 5_000;

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  "vendor",
]);

const IGNORED_FILES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "id_rsa",
  "id_ed25519",
]);

const TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".mdx",
  ".html", ".css", ".scss",
  ".py", ".java", ".go", ".rs",
  ".php", ".rb", ".sql",
  ".yml", ".yaml", ".toml",
  ".sh", ".bash", ".zsh",
  ".xml", ".svg", ".txt",
  ".gitignore", ".example",
]);

const configuredRoot =
  process.env.DEVMEMORY_PROJECT_ROOT || process.cwd();

// Resolve and validate the configured project root.
const projectRoot = await realpath(configuredRoot);

// --------------------------------------------------
// Shared helper functions
// --------------------------------------------------

function response(data) {
  return {
    content: [
      {
        type: "text",
        text:
          typeof data === "string"
            ? data
            : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResponse(message) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: message,
      },
    ],
  };
}

async function safelyRun(operation) {
  try {
    return await operation();
  } catch (error) {
    console.error("DevMemory tool error:", error.message);

    return errorResponse(
      error.message || "An unexpected error occurred."
    );
  }
}

function isIgnoredFile(name) {
  return (
    IGNORED_FILES.has(name) ||
    name.startsWith(".env.") ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    name.endsWith(".p12") ||
    name.endsWith(".pfx") ||
    name.endsWith(".log")
  );
}

function isTextFile(filePath) {
  const name = path.basename(filePath);

  if (isIgnoredFile(name)) {
    return false;
  }

  return (
    TEXT_EXTENSIONS.has(path.extname(name).toLowerCase()) ||
    name === ".gitignore" ||
    name === "Dockerfile" ||
    name === "Makefile"
  );
}

function relativeName(filePath) {
  return path.relative(projectRoot, filePath) || ".";
}

async function resolveProjectPath(relativePath = ".") {
  if (typeof relativePath !== "string") {
    throw new Error("Path must be a string.");
  }

  if (path.isAbsolute(relativePath)) {
    throw new Error("Absolute paths are not allowed.");
  }

  const candidate = path.resolve(projectRoot, relativePath);

  if (
    candidate !== projectRoot &&
    !candidate.startsWith(projectRoot + path.sep)
  ) {
    throw new Error(
      "Path is outside the configured project root."
    );
  }

  const resolved = await realpath(candidate);

  // Prevent access through symlinks outside the project.
  if (
    resolved !== projectRoot &&
    !resolved.startsWith(projectRoot + path.sep)
  ) {
    throw new Error(
      "Resolved path is outside the project root."
    );
  }

  return resolved;
}

async function collectFiles(relativePath = ".") {
  const startPath = await resolveProjectPath(relativePath);
  const startInfo = await stat(startPath);

  if (startInfo.isFile()) {
    return isTextFile(startPath) ? [startPath] : [];
  }

  if (!startInfo.isDirectory()) {
    throw new Error(
      "The requested path is not a file or directory."
    );
  }

  const files = [];
  const queue = [startPath];

  while (
    queue.length > 0 &&
    files.length < MAX_SEARCH_FILES
  ) {
    const current = queue.shift();

    const entries = await readdir(current, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (files.length >= MAX_SEARCH_FILES) {
        break;
      }

      // Do not follow symbolic links.
      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          queue.push(fullPath);
        }

        continue;
      }

      if (entry.isFile() && isTextFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

// --------------------------------------------------
// MCP server factory
// --------------------------------------------------

function createServer() {
  const server = new McpServer({
    name: "devmemory-mcp",
    version: "1.0.0",
  });

  // -----------------------------------------------
  // Tool 1: Get project overview
  // -----------------------------------------------

  server.registerTool(
    "get_project_overview",
    {
      title: "Get Project Overview",
      description:
        "Summarize the configured project's structure and identify important configuration files.",
      inputSchema: {},
    },
    async () =>
      safelyRun(async () => {
        const files = await collectFiles(".");

        const topLevel = await readdir(projectRoot, {
          withFileTypes: true,
        });

        const directories = topLevel
          .filter(
            (entry) =>
              entry.isDirectory() &&
              !IGNORED_DIRS.has(entry.name)
          )
          .map((entry) => entry.name)
          .sort();

        const importantNames = new Set([
          "package.json",
          "README.md",
          "AGENTS.md",
          "index.js",
          "next.config.js",
          "next.config.mjs",
          "vite.config.js",
          "tsconfig.json",
          "pyproject.toml",
          "requirements.txt",
          "Dockerfile",
        ]);

        const importantFiles = files
          .filter((file) =>
            importantNames.has(path.basename(file))
          )
          .map(relativeName)
          .slice(0, 50);

        return response({
          projectRoot,
          topLevelDirectories: directories,
          scannedTextFiles: files.length,
          scanLimitReached:
            files.length >= MAX_SEARCH_FILES,
          importantFiles,
          note:
            "This overview is based on filenames, not a complete semantic understanding of the project.",
        });
      })
  );

  // -----------------------------------------------
  // Tool 2: List project files
  // -----------------------------------------------

  server.registerTool(
    "list_project_files",
    {
      title: "List Project Files",
      description:
        "List readable source and documentation files under a project directory.",
      inputSchema: {
        directory: z.string().optional(),
        limit: z.number().int().min(1).max(MAX_RESULTS).optional(),
      },
    },
    async ({ directory, limit }) =>
      safelyRun(async () => {
        const files = await collectFiles(directory ?? ".");
        const pageSize = limit ?? 50;

        return response({
          directory: directory ?? ".",
          totalFound: files.length,
          files: files
            .slice(0, pageSize)
            .map(relativeName),
          truncated: files.length > pageSize,
        });
      })
  );

  // -----------------------------------------------
  // Tool 3: Search codebase
  // -----------------------------------------------

  server.registerTool(
    "search_codebase",
    {
      title: "Search Codebase",
      description:
        "Search readable project files for a literal, case-insensitive text query.",
      inputSchema: {
        query: z.string().trim().min(1).max(200),
        directory: z.string().optional(),
        limit: z.number().int().min(1).max(MAX_RESULTS).optional(),
      },
    },
    async ({ query, directory, limit }) =>
      safelyRun(async () => {
        const files = await collectFiles(directory ?? ".");
        const matches = [];
        const needle = query.toLowerCase();
        const pageSize = limit ?? 30;

        let filesSearched = 0;
        let truncated = false;

        for (const filePath of files) {
          if (matches.length >= pageSize) {
            truncated = true;
            break;
          }

          const info = await stat(filePath);

          if (info.size > MAX_FILE_SIZE) {
            continue;
          }

          const content = await readFile(filePath, "utf8");
          filesSearched++;

          const lines = content.split(/\r?\n/);

          for (let i = 0; i < lines.length; i++) {
            if (
              lines[i].toLowerCase().includes(needle)
            ) {
              matches.push({
                file: relativeName(filePath),
                line: i + 1,
                text: lines[i].slice(0, 500),
              });

              if (matches.length >= pageSize) {
                truncated = true;
                break;
              }
            }
          }

          if (truncated) {
            break;
          }
        }

        return response({
          query,
          filesSearched,
          matchCount: matches.length,
          truncated,
          matches,
          note:
            "Search uses literal text matching, not semantic search. Large files and excluded paths are skipped.",
        });
      })
  );

  // -----------------------------------------------
  // Tool 4: Read a project file
  // -----------------------------------------------

  server.registerTool(
    "read_project_file",
    {
      title: "Read Project File",
      description:
        "Read a text source or documentation file within the configured project root.",
      inputSchema: {
        filePath: z.string().min(1),
        startLine: z.number().int().min(1).optional(),
        maxLines: z.number().int().min(1).max(300).optional(),
      },
    },
    async ({ filePath, startLine, maxLines }) =>
      safelyRun(async () => {
        const resolved = await resolveProjectPath(filePath);
        const info = await stat(resolved);

        if (!info.isFile()) {
          throw new Error(
            "The requested path is not a file."
          );
        }

        if (!isTextFile(resolved)) {
          throw new Error(
            "This file type is excluded from reading."
          );
        }

        if (info.size > MAX_FILE_SIZE) {
          throw new Error(
            "File is too large to read (maximum 200 KB)."
          );
        }

        const content = await readFile(resolved, "utf8");
        const lines = content.split(/\r?\n/);

        const start = (startLine ?? 1) - 1;
        const count = maxLines ?? 200;

        return response({
          file: relativeName(resolved),
          totalLines: lines.length,
          startLine: start + 1,
          lines: lines
            .slice(start, start + count)
            .map((text, index) => ({
              line: start + index + 1,
              text: text.slice(0, 2_000),
            })),
          truncated: start + count < lines.length,
        });
      })
  );

  return server;
}

// --------------------------------------------------
// Start MCP server using the SDK factory pattern
// --------------------------------------------------

console.error("DevMemory MCP starting.");
console.error(`Configured project root: ${projectRoot}`);

serveStdio(createServer, {
  onerror: (error) => {
    console.error("DevMemory MCP error:", error);
  },
});
