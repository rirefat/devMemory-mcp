import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createMemoryTools } from '../memory-tools.js'

async function withTempProject (callback) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'devmemory-test-'))

  try {
    const memoryTools = createMemoryTools(projectRoot)
    await callback({ projectRoot, memoryTools })
  } finally {
    await rm(projectRoot, {
      recursive: true,
      force: true
    })
  }
}

test('saves a project memory', async () => {
  await withTempProject(async ({ projectRoot, memoryTools }) => {
    const result = await memoryTools.saveProjectMemory({
      title: 'Database architecture',
      content: 'The application uses MongoDB.',
      category: 'architecture',
      tags: ['database', 'mongodb']
    })

    assert.equal(result.success, true)
    assert.equal(result.memory.title, 'Database architecture')

    const stored = JSON.parse(
      await readFile(
        path.join(projectRoot, '.devmemory', 'memories.json'),
        'utf8'
      )
    )

    assert.equal(stored.length, 1)
    assert.equal(stored[0].content, 'The application uses MongoDB.')
  })
})

test('searches memories by keyword', async () => {
  await withTempProject(async ({ memoryTools }) => {
    await memoryTools.saveProjectMemory({
      title: 'Database architecture',
      content: 'The application uses MongoDB.',
      category: 'architecture',
      tags: ['database']
    })

    await memoryTools.saveProjectMemory({
      title: 'Frontend conventions',
      content: 'Use reusable React components.',
      category: 'convention'
    })

    const result = await memoryTools.searchProjectMemory({
      query: 'mongodb'
    })

    assert.equal(result.count, 1)
    assert.equal(result.memories[0].title, 'Database architecture')
  })
})

test('lists saved memories', async () => {
  await withTempProject(async ({ memoryTools }) => {
    await memoryTools.saveProjectMemory({
      title: 'Memory A',
      content: 'First note.'
    })

    await memoryTools.saveProjectMemory({
      title: 'Memory B',
      content: 'Second note.'
    })

    const result = await memoryTools.listProjectMemories()

    assert.equal(result.total, 2)
    assert.equal(result.memories.length, 2)
  })
})

test('deletes a memory by ID', async () => {
  await withTempProject(async ({ memoryTools }) => {
    const saved = await memoryTools.saveProjectMemory({
      title: 'Temporary note',
      content: 'This note will be deleted.'
    })

    const result = await memoryTools.deleteProjectMemory({
      id: saved.memory.id
    })

    assert.equal(result.success, true)

    const remaining = await memoryTools.listProjectMemories()
    assert.equal(remaining.total, 0)
  })
})

test('rejects an invalid memory category', async () => {
  await withTempProject(async ({ memoryTools }) => {
    await assert.rejects(
      memoryTools.saveProjectMemory({
        title: 'Invalid category',
        content: 'This should not be saved.',
        category: 'unknown'
      }),
      /Category must be one of/
    )
  })
})

test('rejects an empty search query', async () => {
  await withTempProject(async ({ memoryTools }) => {
    await assert.rejects(
      memoryTools.searchProjectMemory({ query: ' ' }),
      /Search query must contain/
    )
  })
})

test('keeps memories isolated between projects', async () => {
  const firstRoot = await mkdtemp(path.join(os.tmpdir(), 'devmemory-first-'))
  const secondRoot = await mkdtemp(path.join(os.tmpdir(), 'devmemory-second-'))

  try {
    const firstTools = createMemoryTools(firstRoot)
    const secondTools = createMemoryTools(secondRoot)

    await firstTools.saveProjectMemory({
      title: 'First project secret',
      content: 'This belongs only to the first test project.'
    })

    const secondMemories = await secondTools.listProjectMemories()

    assert.equal(secondMemories.total, 0)
  } finally {
    await Promise.all([
      rm(firstRoot, { recursive: true, force: true }),
      rm(secondRoot, { recursive: true, force: true })
    ])
  }
})

test('rejects malformed memory storage', async () => {
  await withTempProject(async ({ projectRoot, memoryTools }) => {
    const directory = path.join(projectRoot, '.devmemory')
    await mkdir(directory, { recursive: true })

    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(path.join(directory, 'memories.json'), '{ invalid JSON', 'utf8')
    )

    await assert.rejects(memoryTools.listProjectMemories(), /invalid JSON/)
  })
})
