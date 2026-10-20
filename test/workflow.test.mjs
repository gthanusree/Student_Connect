import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { createHmac } from 'node:crypto'
import { once } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse/sync'
import { createApp } from '../server.mjs'

const testDirectory = mkdtempSync(path.join(os.tmpdir(), 'student-connect-'))
const databasePath = path.join(testDirectory, 'test.sqlite')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const encryptionKey = Buffer.alloc(32, 11)
const sessionKey = Buffer.alloc(32, 22)
const appOptions = { dbPath: databasePath, encryptionKey, sessionKey, registrationLimit: 100 }
const testAdminPassword = randomBytes(24).toString('base64url')
const colleges = [
  'Northstar University',
  'Riverview College',
  'Eastbridge Institute of Technology',
  'Lakeside Arts & Science College',
  'Greenfield University',
]
const years = ['1st year', '2nd year', '3rd year', '4th year']
const registrations = parse(readFileSync(new URL('./fixtures/student-records.csv', import.meta.url)), { columns: true, skip_empty_lines: true })
  .map(({ id: _id, ...student }) => student)
const initialApp = createApp(appOptions)
let database = initialApp.database
let server = initialApp.app.listen(0, '127.0.0.1')
await once(server, 'listening')
const port = server.address().port
const baseUrl = `http://127.0.0.1:${port}`

after(async () => {
  if (server.listening) await new Promise((resolve) => server.close(resolve))
  database.close()
  rmSync(testDirectory, { recursive: true, force: true })
})

test('60 student registrations persist, categorize, filter, and track admin verification', async () => {
  assert.equal(registrations.length, 60, 'the CSV fixture must contain exactly 60 students')
  assert.ok(registrations.every((student) => colleges.includes(student.college) && years.includes(student.year)))
  const restricted = await fetch(`${baseUrl}/api/students`)
  assert.equal(restricted.status, 401, 'student records must require admin access')

  const setup = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: testAdminPassword }),
  })
  assert.equal(setup.status, 201)
  const cookie = setup.headers.get('set-cookie').split(';')[0]

  let successMessage = ''
  for (const [index, student] of registrations.entries()) {
    const response = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(student),
    })
    assert.equal(response.status, 201, `registration ${index + 1} should be accepted`)
    if (index === 0) successMessage = (await response.json()).message
    if (index === 0) {
      const firstDashboard = await fetch(`${baseUrl}/api/students`, { headers: { Cookie: cookie } })
      assert.equal((await firstDashboard.json()).total, 1, 'dashboard totals should include a newly saved registration')
    }
  }
  assert.match(successMessage, /Thank you for registering/)

  const dashboardResponse = await fetch(`${baseUrl}/api/students`, { headers: { Cookie: cookie } })
  assert.equal(dashboardResponse.status, 200)
  const dashboard = await dashboardResponse.json()
  assert.equal(dashboard.total, 60)
  assert.equal(dashboard.students.length, 60)
  assert.deepEqual(Object.fromEntries(dashboard.byCollege.map(({ college, count }) => [college, count])), Object.fromEntries(colleges.map((college) => [college, 12])))
  assert.deepEqual(Object.fromEntries(dashboard.byYear.map(({ year, count }) => [year, count])), Object.fromEntries(years.map((year) => [year, 15])))
  assert.ok(dashboard.students.every((student) => student.mobileStatus === 'pending' && student.emailStatus === 'not_sent'))
  assert.ok(dashboard.students.every((student) => Number.isFinite(Date.parse(`${student.createdAt.replace(' ', 'T')}Z`))))

  for (const college of colleges) {
    const response = await fetch(`${baseUrl}/api/students?college=${encodeURIComponent(college)}`, { headers: { Cookie: cookie } })
    const result = await response.json()
    assert.equal(result.students.length, 12, `college filter should return 12 records for ${college}`)
    assert.ok(result.students.every((student) => student.college === college))
  }

  for (const year of years) {
    const response = await fetch(`${baseUrl}/api/students?year=${encodeURIComponent(year)}`, { headers: { Cookie: cookie } })
    const result = await response.json()
    assert.equal(result.students.length, 15, `year filter should return 15 records for ${year}`)
    assert.ok(result.students.every((student) => student.year === year))
  }

  const filteredResponse = await fetch(`${baseUrl}/api/students?college=${encodeURIComponent(colleges[1])}&year=${encodeURIComponent(years[2])}`, { headers: { Cookie: cookie } })
  const filtered = await filteredResponse.json()
  const expectedMatches = registrations.filter((student) => student.college === colleges[1] && student.year === years[2])
  assert.equal(filtered.students.length, expectedMatches.length)
  assert.ok(filtered.students.every((student) => student.college === colleges[1] && student.year === years[2]))
  assert.equal(filtered.total, 60, 'overall total remains visible while filtered')

  const searchResponse = await fetch(`${baseUrl}/api/students?search=${encodeURIComponent('Synthetic Student 027')}`, { headers: { Cookie: cookie } })
  const searched = await searchResponse.json()
  assert.equal(searched.students.length, 1)
  assert.equal(searched.students[0].email, 'student027@example.edu')

  const target = dashboard.students[0]
  const statusResponse = await fetch(`${baseUrl}/api/students/${target.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ field: 'mobile', status: 'verified' }),
  })
  assert.equal(statusResponse.status, 200)
  const emailActivityResponse = await fetch(`${baseUrl}/api/students/${target.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ field: 'email', status: 'sent' }),
  })
  assert.equal(emailActivityResponse.status, 200)
  const invalidStatus = await fetch(`${baseUrl}/api/students/${target.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ field: 'mobile', status: 'sent' }),
  })
  assert.equal(invalidStatus.status, 400)

  const duplicate = await fetch(`${baseUrl}/api/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(registrations[0]),
  })
  assert.equal(duplicate.status, 409)
  const invalidCollege = await fetch(`${baseUrl}/api/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...registrations[0], email: 'new@example.edu', mobile: '+15559999999', college: 'Unlisted College' }),
  })
  assert.equal(invalidCollege.status, 400)

  const stored = database.prepare('SELECT name_enc, mobile_enc, email_enc FROM students').all()
  assert.equal(stored.length, 60)
  assert.ok(stored.every((row) => !row.name_enc.includes('Synthetic Student') && !row.email_enc.includes('@example.edu') && !row.mobile_enc.includes('+1555')))

  await new Promise((resolve) => server.close(resolve))
  database.close()
  const reopenedApp = createApp(appOptions)
  database = reopenedApp.database
  server = reopenedApp.app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const restartedUrl = `http://127.0.0.1:${server.address().port}`
  const afterRestartResponse = await fetch(`${restartedUrl}/api/students`, { headers: { Cookie: cookie } })
  assert.equal(afterRestartResponse.status, 200)
  const afterRestart = await afterRestartResponse.json()
  assert.equal(afterRestart.total, 60)
  assert.equal(afterRestart.students.length, 60)
  assert.equal(afterRestart.students.find((student) => student.id === target.id).mobileStatus, 'verified')
  assert.equal(afterRestart.students.find((student) => student.id === target.id).emailStatus, 'sent')
  assert.equal(afterRestart.students.find((student) => student.email === 'student060@example.edu').college, 'Greenfield University')
})

test('demo import adds 60 CSV rows once and preserves existing registrations', () => {
  const importDirectory = path.join(testDirectory, 'demo-import')
  const importDatabasePath = path.join(importDirectory, 'students.sqlite')
  const baselineApp = createApp({ dbPath: importDatabasePath, encryptionKey, sessionKey })
  const originals = [
    { name: 'Existing Student One', mobile: '+16660000001', email: 'existing.one@example.edu', college: 'Northstar University', year: '2nd year' },
    { name: 'Existing Student Two', mobile: '+16660000002', email: 'existing.two@example.edu', college: 'Riverview College', year: '3rd year' },
  ]
  const originalHashes = originals.map((student) => createHmac('sha256', encryptionKey).update(student.email).digest('hex'))
  assert.deepEqual(baselineApp.importStudents(originals), { imported: 2, skipped: 0, total: 2 })
  baselineApp.database.close()

  const environment = {
    ...process.env,
    DATA_DIR: importDirectory,
    SC_ENCRYPTION_KEY: encryptionKey.toString('base64'),
    SC_SESSION_SECRET: sessionKey.toString('base64'),
  }
  const importScript = path.join(projectRoot, 'scripts', 'import-demo-records.mjs')
  const firstRun = spawnSync(process.execPath, [importScript], { cwd: projectRoot, env: environment, encoding: 'utf8' })
  assert.equal(firstRun.status, 0, firstRun.stderr)
  assert.match(firstRun.stdout, /Imported 60; skipped 0 existing; database total 62\./)

  const secondRun = spawnSync(process.execPath, [importScript], { cwd: projectRoot, env: environment, encoding: 'utf8' })
  assert.equal(secondRun.status, 0, secondRun.stderr)
  assert.match(secondRun.stdout, /Imported 0; skipped 60 existing; database total 62\./)

  const database = new DatabaseSync(importDatabasePath)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM students').get().count, 62)
  for (const [index, emailHash] of originalHashes.entries()) {
    const existing = database.prepare('SELECT college, year FROM students WHERE email_hash = ?').get(emailHash)
    assert.ok(existing, `original registration ${index + 1} must remain`)
    assert.equal(existing.college, originals[index].college)
    assert.equal(existing.year, originals[index].year)
  }
  assert.deepEqual(Object.fromEntries(database.prepare('SELECT college, COUNT(*) AS count FROM students GROUP BY college').all().map(({ college, count }) => [college, count])), {
    'Eastbridge Institute of Technology': 12,
    'Greenfield University': 12,
    'Lakeside Arts & Science College': 12,
    'Northstar University': 13,
    'Riverview College': 13,
  })
  assert.deepEqual(Object.fromEntries(database.prepare('SELECT year, COUNT(*) AS count FROM students GROUP BY year').all().map(({ year, count }) => [year, count])), {
    '1st year': 15,
    '2nd year': 16,
    '3rd year': 16,
    '4th year': 15,
  })
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM students WHERE mobile_status != 'pending' OR email_status != 'not_sent'").get().count, 0)
  const fixtureEmails = registrations.map((student) => createHmac('sha256', encryptionKey).update(student.email).digest('hex'))
  for (const emailHash of fixtureEmails) {
    const statuses = database.prepare('SELECT mobile_status, email_status FROM students WHERE email_hash = ?').get(emailHash)
    assert.equal(statuses.mobile_status, 'pending')
    assert.equal(statuses.email_status, 'not_sent')
  }
  database.close()
})