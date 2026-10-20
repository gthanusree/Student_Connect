import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse/sync'
import { createApp } from '../server.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const csvPath = path.join(projectRoot, 'test', 'fixtures', 'student-records.csv')
const records = parse(readFileSync(csvPath), { columns: true, skip_empty_lines: true, bom: true })

if (records.length !== 60) throw new Error(`Expected exactly 60 demo records; found ${records.length}.`)

const { database, importStudents } = createApp()
try {
  const result = importStudents(records)
  console.log(`Imported ${result.imported}; skipped ${result.skipped} existing; database total ${result.total}.`)
} finally {
  database.close()
}
