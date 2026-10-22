import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'

import { createProjectFiles } from './project-files.js'

// --------------------------------------------------
// 1. Configure the project root
// --------------------------------------------------

const rootInput = process.env.DEVMEMORY_PROJECT_ROOT || process.cwd()

const projectFiles = await createProjectFiles(rootInput)

// --------------------------------------------------
// 2. Shared MCP response helpers
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
  console.error('DevMemory tool error:', error.message || error)

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: error.message || 'The operation failed.'
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
// 3. Create MCP server and register tools
// --------------------------------------------------

function createServer () {
  const server = new McpServer({
    name: 'devmemory-mcp',
    version: '1.0.0'
  })

  // -----------------------------------------------
  // Tool 1: Get project overview
  // -----------------------------------------------

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

  // -----------------------------------------------
  // Tool 2: List project files
  // -----------------------------------------------

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

  // -----------------------------------------------
  // Tool 3: Search codebase
  // -----------------------------------------------

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

  // -----------------------------------------------
  // Tool 4: Read a project file
  // -----------------------------------------------

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

  return server
}

// --------------------------------------------------
// 4. Start the MCP server
// --------------------------------------------------

console.error('DevMemory MCP starting.')
console.error(`Configured project root: ${projectFiles.projectRoot}`)

serveStdio(createServer, {
  onerror: error => {
    console.error('DevMemory MCP error:', error)
  }
})
