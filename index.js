import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'

import { createProjectFiles } from './project-files.js'
import { createGitTools } from './git-tools.js'

// --------------------------------------------------
// 1. Configure the project root
// --------------------------------------------------

const rootInput = process.env.DEVMEMORY_PROJECT_ROOT || process.cwd()

const projectFiles = await createProjectFiles(rootInput)
const gitTools = createGitTools(projectFiles.projectRoot)

// --------------------------------------------------
// 2. Response helpers
// --------------------------------------------------

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
  const message =
    error instanceof Error ? error.message : 'The operation failed.'

  console.error('DevMemory tool error:', message)

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: message
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

// --------------------------------------------------
// 3. Create and register MCP tools
// --------------------------------------------------

function createServer () {
  const server = new McpServer({
    name: 'devmemory-mcp',
    version: '1.0.0'
  })

  // ----------------------------------------------
  // CODEBASE TOOL 1: Project overview
  // ----------------------------------------------

  server.registerTool(
    'get_project_overview',
    {
      title: 'Get Project Overview',
      description:
        "Summarize the configured project's structure and identify important files.",
      inputSchema: {}
    },
    async () => safelyRun(() => projectFiles.getProjectOverview())
  )

  // ----------------------------------------------
  // CODEBASE TOOL 2: List project files
  // ----------------------------------------------

  server.registerTool(
    'list_project_files',
    {
      title: 'List Project Files',
      description:
        'List readable source and documentation files in a project directory.',
      inputSchema: {
        directory: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional()
      }
    },
    async ({ directory, limit }) =>
      safelyRun(() =>
        projectFiles.listProjectFiles({
          directory: directory ?? '.',
          limit: limit ?? 50
        })
      )
  )

  // ----------------------------------------------
  // CODEBASE TOOL 3: Search codebase
  // ----------------------------------------------

  server.registerTool(
    'search_codebase',
    {
      title: 'Search Codebase',
      description:
        'Search readable source and documentation files for literal text, ignoring letter case.',
      inputSchema: {
        query: z.string().trim().min(1).max(200),
        directory: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional()
      }
    },
    async ({ query, directory, limit }) =>
      safelyRun(() =>
        projectFiles.searchCodebase({
          query,
          directory: directory ?? '.',
          limit: limit ?? 30
        })
      )
  )

  // ----------------------------------------------
  // CODEBASE TOOL 4: Read project file
  // ----------------------------------------------

  server.registerTool(
    'read_project_file',
    {
      title: 'Read Project File',
      description:
        'Read a text source or documentation file within the configured project root.',
      inputSchema: {
        filePath: z.string().min(1),
        startLine: z.number().int().min(1).optional(),
        maxLines: z.number().int().min(1).max(300).optional()
      }
    },
    async ({ filePath, startLine, maxLines }) =>
      safelyRun(() =>
        projectFiles.readProjectFile({
          filePath,
          startLine: startLine ?? 1,
          maxLines: maxLines ?? 200
        })
      )
  )

  // ----------------------------------------------
  // GIT TOOL 1: Git status
  // ----------------------------------------------

  server.registerTool(
    'get_git_status',
    {
      title: 'Get Git Status',
      description:
        'Inspect the current Git branch and working-tree changes without modifying files.',
      inputSchema: {}
    },
    async () => safelyRun(() => gitTools.getGitStatus())
  )

  // ----------------------------------------------
  // GIT TOOL 2: Git commit history
  // ----------------------------------------------

  server.registerTool(
    'get_git_log',
    {
      title: 'Get Git Log',
      description:
        'Read recent Git commits, including hashes, authors, dates, and messages.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional()
      }
    },
    async ({ limit }) =>
      safelyRun(() =>
        gitTools.getGitLog({
          limit: limit ?? 10
        })
      )
  )

  // ----------------------------------------------
  // GIT TOOL 3: Git diff summary
  // ----------------------------------------------

  server.registerTool(
    'get_git_diff_summary',
    {
      title: 'Get Git Diff Summary',
      description:
        'Summarize staged and unstaged tracked-file changes without modifying the repository.',
      inputSchema: {}
    },
    async () => safelyRun(() => gitTools.getGitDiffSummary())
  )

  // ----------------------------------------------
  // GIT TOOL 4: List Git branches
  // ----------------------------------------------

  server.registerTool(
    'list_git_branches',
    {
      title: 'List Git Branches',
      description: 'List local Git branches and identify the current branch.',
      inputSchema: {}
    },
    async () => safelyRun(() => gitTools.listGitBranches())
  )

  return server
}

// --------------------------------------------------
// 4. Start the MCP server over stdio
// --------------------------------------------------

console.error('DevMemory MCP starting.')
console.error(`Configured project root: ${projectFiles.projectRoot}`)

serveStdio(createServer, {
  onerror: error => {
    console.error('DevMemory MCP error:', error)
  }
})
