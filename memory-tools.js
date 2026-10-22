
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MEMORY_DIRECTORY = ".devmemory";
const MEMORY_FILENAME = "memories.json";

const MAX_MEMORIES = 1000;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 10_000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;
const MAX_SEARCH_LENGTH = 200;

const ALLOWED_CATEGORIES = [
  "architecture",
  "convention",
  "bug",
  "decision",
  "implementation",
  "general",
];

export function createMemoryTools(projectRoot) {
  if (typeof projectRoot !== "string" || !projectRoot.trim()) {
    throw new Error("A valid project root is required.");
  }

  const absoluteRoot = path.resolve(projectRoot);
  const memoryDirectory = path.join(
    absoluteRoot,
    MEMORY_DIRECTORY,
  );
  const memoryFile = path.join(
    memoryDirectory,
    MEMORY_FILENAME,
  );

  async function readMemories() {
    let raw;

    try {
      raw = await readFile(memoryFile, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return [];
      }

      throw error;
    }

    let memories;

    try {
      memories = JSON.parse(raw);
    } catch {
      throw new Error(
        "Memory storage contains invalid JSON. Back up the file before repairing it.",
      );
    }

    if (!Array.isArray(memories)) {
      throw new Error(
        "Memory storage must contain a JSON array.",
      );
    }

    for (const memory of memories) {
      if (
        !memory ||
        typeof memory.id !== "string" ||
        typeof memory.title !== "string" ||
        typeof memory.content !== "string" ||
        typeof memory.category !== "string" ||
        !Array.isArray(memory.tags) ||
        typeof memory.createdAt !== "string" ||
        typeof memory.updatedAt !== "string"
      ) {
        throw new Error(
          "Memory storage contains an invalid record.",
        );
      }
    }

    return memories;
  }

  async function writeMemories(memories) {
    await mkdir(memoryDirectory, {
      recursive: true,
      mode: 0o700,
    });

    const temporaryFile = path.join(
      memoryDirectory,
      `memories-${randomUUID()}.tmp`,
    );

    try {
      await writeFile(
        temporaryFile,
        JSON.stringify(memories, null, 2),
        {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        },
      );

      await rename(temporaryFile, memoryFile);
    } catch (error) {
      await unlink(temporaryFile).catch(() => {});
      throw error;
    }
  }

  function validateText(value, field, maxLength) {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.trim().length > maxLength
    ) {
      throw new Error(
        `${field} must contain 1-${maxLength} characters.`,
      );
    }

    return value.trim();
  }

  async function saveProjectMemory({
    title,
    content,
    category = "general",
    tags = [],
  }) {
    const safeTitle = validateText(
      title,
      "Title",
      MAX_TITLE_LENGTH,
    );

    const safeContent = validateText(
      content,
      "Content",
      MAX_CONTENT_LENGTH,
    );

    if (!ALLOWED_CATEGORIES.includes(category)) {
      throw new Error(
        `Category must be one of: ${ALLOWED_CATEGORIES.join(", ")}.`,
      );
    }

    if (
      !Array.isArray(tags) ||
      tags.length > MAX_TAGS ||
      tags.some(
        (tag) =>
          typeof tag !== "string" ||
          !tag.trim() ||
          tag.trim().length > MAX_TAG_LENGTH,
      )
    ) {
      throw new Error(
        `Tags must contain up to ${MAX_TAGS} non-empty strings, each at most ${MAX_TAG_LENGTH} characters.`,
      );
    }

    const memories = await readMemories();

    if (memories.length >= MAX_MEMORIES) {
      throw new Error(
        "Memory limit reached. Delete an old memory first.",
      );
    }

    const now = new Date().toISOString();

    const memory = {
      id: randomUUID(),
      title: safeTitle,
      content: safeContent,
      category,
      tags: [...new Set(tags.map((tag) => tag.trim()))],
      createdAt: now,
      updatedAt: now,
    };

    memories.push(memory);
    await writeMemories(memories);

    return {
      success: true,
      projectRoot: absoluteRoot,
      memory,
    };
  }

  async function searchProjectMemory({ query, limit = 10 }) {
    const safeQuery = validateText(
      query,
      "Search query",
      MAX_SEARCH_LENGTH,
    );

    const safeLimit = Math.min(
      Math.max(Number.isInteger(limit) ? limit : 10, 1),
      50,
    );

    const memories = await readMemories();
    const terms = safeQuery.toLowerCase().split(/\s+/);

    const results = memories
      .map((memory) => {
        const searchableText = [
          memory.title,
          memory.content,
          memory.category,
          ...memory.tags,
        ]
          .join(" ")
          .toLowerCase();

        const score = terms.reduce(
          (total, term) =>
            total + (searchableText.includes(term) ? 1 : 0),
          0,
        );

        return { memory, score };
      })
      .filter((item) => item.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.memory.updatedAt.localeCompare(
            a.memory.updatedAt,
          ),
      )
      .slice(0, safeLimit)
      .map((item) => item.memory);

    return {
      projectRoot: absoluteRoot,
      query: safeQuery,
      count: results.length,
      memories: results,
    };
  }

  async function listProjectMemories({ limit = 50 } = {}) {
    const safeLimit = Math.min(
      Math.max(Number.isInteger(limit) ? limit : 50, 1),
      100,
    );

    const memories = await readMemories();

    return {
      projectRoot: absoluteRoot,
      total: memories.length,
      memories: memories
        .slice()
        .sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        )
        .slice(0, safeLimit),
    };
  }

  async function deleteProjectMemory({ id }) {
    const safeId = validateText(id, "Memory ID", 100);
    const memories = await readMemories();

    const index = memories.findIndex(
      (memory) => memory.id === safeId,
    );

    if (index === -1) {
      throw new Error(
        `No memory found with ID: ${safeId}`,
      );
    }

    const [deletedMemory] = memories.splice(index, 1);
    await writeMemories(memories);

    return {
      success: true,
      projectRoot: absoluteRoot,
      deletedMemory,
    };
  }

  return {
    saveProjectMemory,
    searchProjectMemory,
    listProjectMemories,
    deleteProjectMemory,
  };
}
