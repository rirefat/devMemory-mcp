import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'

import { createProjectFiles } from './project-files.js'
import { createGitTools } from './git-tools.js'
import { createMemoryTools } from './memory-tools.js'

const rootInput = process.env.DEVMEMORY_PROJECT_ROOT || process.cwd()

const projectFiles = await createProjectFiles(rootInput)

const gitTools = createGitTools(projectFiles.projectRoot)

const memoryTools = createMemoryTools(projectFiles.projectRoot)

function textResponse (data) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }
    ]
  }
}

function errorResponse (error) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: error instanceof Error ? error.message : String(error)
      }
    ]
  }
}

async function safelyRun (operation) {
  try {
    const result = await operation()
    return textResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}

function createServer () {
  const server = new McpServer({
    name: 'devmemory',
    version: '1.0.0'
  })

  // ==========================================
  // PHASE 1: PROJECT EXPLORATION
  // ==========================================

  server.registerTool(
    'get_project_overview',
    {
      title: 'Get Project Overview',
      description:
        'Get an overview of the currently configured project, including its root directory and project structure.',
      inputSchema: {}
    },
    async () => safelyRun(() => projectFiles.getProjectOverview())
  )

  server.registerTool(
    'list_project_files',
    {
      title: 'List Project Files',
      description:
        'List files in the currently configured project. Excluded directories and files are filtered by DevMemory.',
      inputSchema: {
        directory: z
          .string()
          .optional()
          .describe('Optional project-relative directory to inspect.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Maximum number of files to return.')
      }
    },
    async ({ directory, limit }) =>
      safelyRun(() =>
        projectFiles.listProjectFiles({
          directory,
          limit
        })
      )
  )

  server.registerTool(
    'search_codebase',
    {
      title: 'Search Codebase',
      description: 'Search project files for a text string or code pattern.',
      inputSchema: {
        query: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .describe('Text or code pattern to search for.'),
        directory: z
          .string()
          .optional()
          .describe('Optional project-relative directory to search.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum number of matching results.')
      }
    },
    async ({ query, directory, limit }) =>
      safelyRun(() =>
        projectFiles.searchCodebase({
          query,
          directory,
          limit
        })
      )
  )

  server.registerTool(
    'read_project_file',
    {
      title: 'Read Project File',
      description:
        'Read a text file inside the configured project using a project-relative path.',
      inputSchema: {
        filePath: z
          .string()
          .trim()
          .min(1)
          .max(1000)
          .describe('Project-relative path of the file to read.')
      }
    },
    async ({ filePath }) =>
      safelyRun(() => projectFiles.readProjectFile({ filePath }))
  )

  // ==========================================
  // PHASE 2: GIT INTELLIGENCE
  // ==========================================

  server.registerTool(
    'get_git_status',
    {
      title: 'Get Git Status',
      description:
        'Get the current Git working-tree status, including changed and untracked files.',
      inputSchema: {}
    },
    async () => safelyRun(() => gitTools.getGitStatus())
  )

  server.registerTool(
    'get_git_log',
    {
      title: 'Get Git Log',
      description: 'Get recent Git commit history for the configured project.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Number of recent commits to return.')
      }
    },
    async ({ limit }) => safelyRun(() => gitTools.getGitLog({ limit }))
  )

  server.registerTool(
    'get_git_diff_summary',
    {
      title: 'Get Git Diff Summary',
      description:
        'Get a summary of current Git changes without modifying files or creating commits.',
      inputSchema: {}
    },
    async () => safelyRun(() => gitTools.getGitDiffSummary())
  )

  server.registerTool(
    'list_git_branches',
    {
      title: 'List Git Branches',
      description: 'List local Git branches and identify the current branch.',
      inputSchema: {}
    },
    async () => safelyRun(() => gitTools.listGitBranches())
  )

  // ==========================================
  // PHASE 3: PERSISTENT PROJECT MEMORY
  // ==========================================

  server.registerTool(
    'save_project_memory',
    {
      title: 'Save Project Memory',
      description:
        "Save a persistent note about project architecture, coding conventions, bugs, decisions, implementation details, or general project knowledge. Memory is stored in the configured project's .devmemory/memories.json file.",
      inputSchema: {
        title: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe('Short title for the memory.'),
        content: z
          .string()
          .trim()
          .min(1)
          .max(10000)
          .describe('Details to remember about the project.'),
        category: z
          .enum([
            'architecture',
            'convention',
            'bug',
            'decision',
            'implementation',
            'general'
          ])
          .optional()
          .describe('Category of the memory.'),
        tags: z
          .array(z.string().trim().min(1).max(50))
          .max(20)
          .optional()
          .describe('Optional tags for easier searching.')
      }
    },
    async ({ title, content, category, tags }) =>
      safelyRun(() =>
        memoryTools.saveProjectMemory({
          title,
          content,
          category: category ?? 'general',
          tags: tags ?? []
        })
      )
  )

  server.registerTool(
    'search_project_memory',
    {
      title: 'Search Project Memory',
      description:
        'Search saved project memories by matching words in their titles, content, categories, and tags.',
      inputSchema: {
        query: z.string().trim().min(1).max(200).describe('Search terms.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Maximum number of memories to return.')
      }
    },
    async ({ query, limit }) =>
      safelyRun(() =>
        memoryTools.searchProjectMemory({
          query,
          limit: limit ?? 10
        })
      )
  )

  server.registerTool(
    'list_project_memories',
    {
      title: 'List Project Memories',
      description:
        'List saved memories for the currently configured project, ordered from most recently updated to oldest.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Maximum number of memories to return.')
      }
    },
    async ({ limit }) =>
      safelyRun(() =>
        memoryTools.listProjectMemories({
          limit: limit ?? 50
        })
      )
  )

  server.registerTool(
    'delete_project_memory',
    {
      title: 'Delete Project Memory',
      description:
        'Permanently delete a saved project memory using its exact memory ID.',
      inputSchema: {
        id: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .describe('Exact ID of the memory to delete.')
      }
    },
    async ({ id }) => safelyRun(() => memoryTools.deleteProjectMemory({ id }))
  )

  return server
}

console.error(`[DevMemory] Project root: ${projectFiles.projectRoot}`)

await serveStdio(createServer, {
  onerror: error => {
    console.error('[DevMemory] Server error:', error)
  }
})
