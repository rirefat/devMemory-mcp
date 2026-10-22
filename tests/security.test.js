import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createProjectFiles } from '../project-files.js'

async function createFixture () {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devmemory-test-'))

  await mkdir(path.join(root, 'src'))

  await writeFile(path.join(root, 'package.json'), '{"name":"test-project"}')

  await writeFile(
    path.join(root, 'src', 'app.js'),
    'const message = "hello DevMemory";\nconsole.log(message);\n'
  )

  await writeFile(path.join(root, '.env'), 'SECRET_TOKEN=do-not-read')

  await writeFile(path.join(root, '.env.example'), 'EXAMPLE_TOKEN=placeholder')

  await writeFile(path.join(root, 'private.pem'), 'PRIVATE KEY CONTENT')

  return {
    root,
    files: await createProjectFiles(root),
    cleanup: () => rm(root, { recursive: true, force: true })
  }
}

test('lists project files without exposing secret files', async t => {
  const fixture = await createFixture()
  t.after(fixture.cleanup)

  const result = await fixture.files.listProjectFiles()

  assert.ok(result.files.includes('package.json'))
  assert.ok(result.files.includes('src/app.js'))
  assert.ok(!result.files.includes('.env'))
  assert.ok(!result.files.includes('.env.example'))
  assert.ok(!result.files.includes('private.pem'))
})

test('blocks paths outside the project root', async t => {
  const fixture = await createFixture()
  t.after(fixture.cleanup)

  await assert.rejects(
    () =>
      fixture.files.readProjectFile({
        filePath: '../outside.js'
      }),
    /outside the project root|ENOENT/
  )
})

test('refuses to read environment files', async t => {
  const fixture = await createFixture()
  t.after(fixture.cleanup)

  await assert.rejects(
    () =>
      fixture.files.readProjectFile({
        filePath: '.env'
      }),
    /excluded from reading/
  )
})

test('searches source code case-insensitively', async t => {
  const fixture = await createFixture()
  t.after(fixture.cleanup)

  const result = await fixture.files.searchCodebase({
    query: 'HELLO DEVMEMORY'
  })

  assert.equal(result.matchCount, 1)
  assert.equal(result.matches[0].file, 'src/app.js')
  assert.equal(result.matches[0].line, 1)
})

test('reads the requested line range', async t => {
  const fixture = await createFixture()
  t.after(fixture.cleanup)

  const result = await fixture.files.readProjectFile({
    filePath: 'src/app.js',
    startLine: 2,
    maxLines: 1
  })

  assert.equal(result.startLine, 2)
  assert.equal(result.lines.length, 1)
  assert.equal(result.lines[0].text, 'console.log(message);')
})

test('rejects invalid search limits', async t => {
  const fixture = await createFixture()
  t.after(fixture.cleanup)

  await assert.rejects(
    () =>
      fixture.files.searchCodebase({
        query: 'hello',
        limit: 101
      }),
    /limit must be an integer/
  )
})

test('does not follow symbolic links outside the project', async t => {
  const fixture = await createFixture()
  t.after(fixture.cleanup)

  const outsideRoot = await mkdtemp(
    path.join(os.tmpdir(), 'devmemory-outside-')
  )

  t.after(() => rm(outsideRoot, { recursive: true, force: true }))

  const secretFile = path.join(outsideRoot, 'secret.js')

  await writeFile(secretFile, 'OUTSIDE_SECRET = true')

  try {
    await symlink(outsideRoot, path.join(fixture.root, 'external-link'), 'dir')
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip('Symbolic links are unavailable in this environment.')
      return
    }
    throw error
  }

  const result = await fixture.files.listProjectFiles()

  assert.ok(!result.files.some(file => file.startsWith('external-link/')))
})
