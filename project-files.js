import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

const MAX_RESULTS = 100
const MAX_FILE_SIZE = 200_000
const MAX_SEARCH_FILES = 5_000

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.cache',
  'vendor'
])

const IGNORED_FILES = new Set(['.env', 'id_rsa', 'id_ed25519'])

const TEXT_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.html',
  '.css',
  '.scss',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.php',
  '.rb',
  '.sql',
  '.yml',
  '.yaml',
  '.toml',
  '.sh',
  '.bash',
  '.zsh',
  '.xml',
  '.svg',
  '.txt',
  '.gitignore',
  '.example'
])

function isIgnoredFile (name) {
  return (
    IGNORED_FILES.has(name) ||
    /^\.env(?:\.|$)/i.test(name) ||
    /\.(pem|key|p12|pfx|log)$/i.test(name)
  )
}

function isTextFile (filePath) {
  const name = path.basename(filePath)

  if (isIgnoredFile(name)) return false

  return (
    TEXT_EXTENSIONS.has(path.extname(name).toLowerCase()) ||
    name === 'Dockerfile' ||
    name === 'Makefile'
  )
}

export async function createProjectFiles (rootInput) {
  const projectRoot = await realpath(rootInput)

  async function resolveProjectPath (relativePath = '.') {
    if (typeof relativePath !== 'string') {
      throw new Error('Path must be a string.')
    }

    if (path.isAbsolute(relativePath)) {
      throw new Error('Absolute paths are not allowed.')
    }

    const candidate = path.resolve(projectRoot, relativePath)

    if (
      candidate !== projectRoot &&
      !candidate.startsWith(projectRoot + path.sep)
    ) {
      throw new Error('Path is outside the project root.')
    }

    const resolved = await realpath(candidate)

    if (
      resolved !== projectRoot &&
      !resolved.startsWith(projectRoot + path.sep)
    ) {
      throw new Error('Resolved path is outside the project root.')
    }

    return resolved
  }

  async function collectFiles (relativePath = '.') {
    const startPath = await resolveProjectPath(relativePath)
    const startInfo = await stat(startPath)

    if (startInfo.isFile()) {
      return isTextFile(startPath) ? [startPath] : []
    }

    if (!startInfo.isDirectory()) {
      throw new Error('Path must be a file or directory.')
    }

    const files = []
    const queue = [startPath]
    let scanned = 0

    while (queue.length > 0 && scanned < MAX_SEARCH_FILES) {
      const current = queue.shift()
      const entries = await readdir(current, {
        withFileTypes: true
      })

      for (const entry of entries) {
        if (scanned >= MAX_SEARCH_FILES) break

        if (entry.isSymbolicLink()) continue

        const fullPath = path.join(current, entry.name)

        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) {
            queue.push(fullPath)
          }
          continue
        }

        if (entry.isFile() && isTextFile(fullPath)) {
          files.push(fullPath)
          scanned++
        }
      }
    }

    return files
  }

  function relativeName (filePath) {
    return path.relative(projectRoot, filePath) || '.'
  }

  async function listProjectFiles ({ directory = '.', limit = 50 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULTS) {
      throw new Error('limit must be an integer from 1 to 100.')
    }

    const files = await collectFiles(directory)

    return {
      directory,
      totalFound: files.length,
      files: files.slice(0, limit).map(relativeName),
      truncated: files.length > limit
    }
  }

  async function readProjectFile ({ filePath, startLine = 1, maxLines = 200 }) {
    if (
      !Number.isInteger(startLine) ||
      startLine < 1 ||
      !Number.isInteger(maxLines) ||
      maxLines < 1 ||
      maxLines > 300
    ) {
      throw new Error('Invalid line range.')
    }

    const resolved = await resolveProjectPath(filePath)
    const info = await stat(resolved)

    if (!info.isFile()) {
      throw new Error('Path is not a file.')
    }

    if (!isTextFile(resolved)) {
      throw new Error('This file type is excluded from reading.')
    }

    if (info.size > MAX_FILE_SIZE) {
      throw new Error('File exceeds the 200 KB read limit.')
    }

    const content = await readFile(resolved, 'utf8')
    const lines = content.split(/\r?\n/)
    const start = startLine - 1

    return {
      file: relativeName(resolved),
      totalLines: lines.length,
      startLine,
      lines: lines.slice(start, start + maxLines).map((text, index) => ({
        line: start + index + 1,
        text: text.slice(0, 2000)
      })),
      truncated: start + maxLines < lines.length
    }
  }

  async function searchCodebase ({ query, directory = '.', limit = 30 }) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200) {
      throw new Error('query must contain 1–200 characters.')
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULTS) {
      throw new Error('limit must be an integer from 1 to 100.')
    }

    const files = await collectFiles(directory)
    const needle = query.toLowerCase()
    const matches = []
    let filesSearched = 0
    let truncated = false

    for (const filePath of files) {
      if (matches.length >= limit) {
        truncated = true
        break
      }

      const info = await stat(filePath)
      if (info.size > MAX_FILE_SIZE) continue

      const content = await readFile(filePath, 'utf8')
      filesSearched++

      const lines = content.split(/\r?\n/)

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          matches.push({
            file: relativeName(filePath),
            line: i + 1,
            text: lines[i].slice(0, 500)
          })

          if (matches.length >= limit) {
            truncated = true
            break
          }
        }
      }

      if (truncated) break
    }

    return {
      query,
      filesSearched,
      matchCount: matches.length,
      truncated,
      matches
    }
  }

  async function getProjectOverview () {
    const files = await collectFiles('.')
    const entries = await readdir(projectRoot, {
      withFileTypes: true
    })

    const importantNames = new Set([
      'package.json',
      'README.md',
      'AGENTS.md',
      'index.js',
      'next.config.js',
      'next.config.mjs',
      'vite.config.js',
      'tsconfig.json',
      'pyproject.toml',
      'requirements.txt',
      'Dockerfile'
    ])

    return {
      projectRoot,
      topLevelDirectories: entries
        .filter(entry => entry.isDirectory() && !IGNORED_DIRS.has(entry.name))
        .map(entry => entry.name)
        .sort(),
      scannedTextFiles: files.length,
      importantFiles: files
        .filter(file => importantNames.has(path.basename(file)))
        .map(relativeName)
        .slice(0, 50)
    }
  }

  return {
    projectRoot,
    listProjectFiles,
    readProjectFile,
    searchCodebase,
    getProjectOverview
  }
}
