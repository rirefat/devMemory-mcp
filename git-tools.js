import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const MAX_LOG_LIMIT = 50
const MAX_OUTPUT_SIZE = 1_000_000
const COMMAND_TIMEOUT_MS = 10_000

export function createGitTools (projectRoot) {
  if (typeof projectRoot !== 'string' || !projectRoot.trim()) {
    throw new Error('A valid project root is required.')
  }

  async function runGit (args) {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: projectRoot,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_SIZE,
        windowsHide: true,
        shell: false
      })

      return stdout.trim()
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('Git is not installed or is not available in PATH.')
      }

      if (error.code === 'ETIMEDOUT') {
        throw new Error('The Git command timed out.')
      }

      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        throw new Error('Git output exceeded the allowed size.')
      }

      if (error.code === 'ENOBUFS') {
        throw new Error('Git output exceeded the allowed size.')
      }

      const message = String(error.stderr || error.message || '')

      if (
        message.includes('not a git repository') ||
        message.includes('not a git directory')
      ) {
        throw new Error(
          `The configured project is not a Git repository: ${projectRoot}`
        )
      }

      throw new Error(`Git command failed: ${message.trim()}`)
    }
  }

  async function getGitStatus () {
    const [root, status] = await Promise.all([
      runGit(['rev-parse', '--show-toplevel']),
      runGit(['status', '--short', '--branch'])
    ])

    return {
      projectRoot: root,
      status: status || 'Working tree is clean.',
      note: 'Read-only Git status. No files were changed.'
    }
  }

  async function getGitLog ({ limit = 10 } = {}) {
    const safeLimit = Math.min(
      Math.max(Number.isInteger(limit) ? limit : 10, 1),
      MAX_LOG_LIMIT
    )

    const [root, output] = await Promise.all([
      runGit(['rev-parse', '--show-toplevel']),
      runGit([
        'log',
        `-${safeLimit}`,
        '--date=iso-strict',
        '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s'
      ])
    ])

    const commits = output
      ? output.split('\n').map(line => {
          const [hash, shortHash, author, date, ...subject] = line.split('\x1f')

          return {
            hash,
            shortHash,
            author,
            date,
            message: subject.join('\x1f')
          }
        })
      : []

    return {
      projectRoot: root,
      count: commits.length,
      commits
    }
  }

  async function getGitDiffSummary () {
    const [root, unstaged, staged] = await Promise.all([
      runGit(['rev-parse', '--show-toplevel']),
      runGit(['diff', '--stat']),
      runGit(['diff', '--cached', '--stat'])
    ])

    return {
      projectRoot: root,
      unstagedChanges: unstaged || 'No unstaged tracked-file changes.',
      stagedChanges: staged || 'No staged tracked-file changes.',
      note: 'Shows tracked-file diff summaries only. Untracked files are reported by get_git_status.'
    }
  }

  async function listGitBranches () {
    const [root, currentBranch, output] = await Promise.all([
      runGit(['rev-parse', '--show-toplevel']),
      runGit(['branch', '--show-current']),
      runGit([
        'branch',
        '--format=%(HEAD)%09%(refname:short)%09%(objectname:short)'
      ])
    ])

    const branches = output
      ? output.split('\n').map(line => {
          const [head, name, commit] = line.split('\t')

          return {
            name,
            commit,
            current: head === '*'
          }
        })
      : []

    return {
      projectRoot: root,
      currentBranch: currentBranch || '(detached HEAD)',
      branches
    }
  }

  return {
    getGitStatus,
    getGitLog,
    getGitDiffSummary,
    listGitBranches
  }
}
