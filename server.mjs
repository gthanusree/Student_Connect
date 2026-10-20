import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { DatabaseSync } from 'node:sqlite'

const root = path.dirname(fileURLToPath(import.meta.url))
const dataDirectory = process.env.DATA_DIR || path.join(root, 'data')
const colleges = [
  'Northstar University',
  'Riverview College',
  'Eastbridge Institute of Technology',
  'Lakeside Arts & Science College',
  'Greenfield University',
  'Other',
]
const years = ['1st year', '2nd year', '3rd year', '4th year']

function loadKey(filename, environmentName) {
  const configured = process.env[environmentName]
  if (configured) {
    const key = Buffer.from(configured, 'base64')
    if (key.length !== 32) throw new Error(`${environmentName} must be a base64-encoded 32-byte key`)
    return key
  }

  fs.mkdirSync(dataDirectory, { recursive: true })
  const filePath = path.join(dataDirectory, filename)
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' })
  return fs.readFileSync(filePath)
}

function encrypt(value, key) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`
}

function decrypt(value, key) {
  const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part, 'base64url'))
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

function fingerprint(value, key) {
  return crypto.createHmac('sha256', key).update(value).digest('hex')
}

function normalizeStudent(input) {
  const name = typeof input?.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : ''
  const mobile = typeof input?.mobile === 'string' ? input.mobile.replace(/[\s()-]/g, '') : ''
  const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (name.length < 2 || name.length > 100) throw new Error('Enter a name between 2 and 100 characters.')
  if (!/^\+?[0-9]{8,15}$/.test(mobile)) throw new Error('Enter a valid mobile number with 8 to 15 digits.')
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.')
  if (!colleges.includes(input.college)) throw new Error('Select a college from the list.')
  if (!years.includes(input.year)) throw new Error('Select your current year of study.')
  return { name, mobile, email, college: input.college, year: input.year }
}

function saveStudent(database, student, encryptionKey) {
  const emailHash = fingerprint(student.email, encryptionKey)
  const mobileHash = fingerprint(student.mobile, encryptionKey)
  const duplicate = database.prepare('SELECT 1 FROM students WHERE email_hash = ? OR mobile_hash = ?').get(emailHash, mobileHash)
  if (duplicate) return false
  database.prepare(`INSERT INTO students (name_enc, mobile_enc, email_enc, mobile_hash, email_hash, college, year)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(encrypt(student.name, encryptionKey), encrypt(student.mobile, encryptionKey), encrypt(student.email, encryptionKey), mobileHash, emailHash, student.college, student.year)
  return true
}

function createSessionToken(key) {
  const payload = Buffer.from(JSON.stringify({ expires: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url')
  const signature = crypto.createHmac('sha256', key).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function isValidSession(token, key) {
  if (!token) return false
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false
  const expected = crypto.createHmac('sha256', key).update(payload).digest()
  let actual
  try {
    actual = Buffer.from(signature, 'base64url')
  } catch {
    return false
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).expires > Date.now()
  } catch {
    return false
  }
}

export function createApp({ dbPath = path.join(dataDirectory, 'students.sqlite'), encryptionKey, sessionKey, registrationLimit = 20 } = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const piiKey = encryptionKey || loadKey('encryption.key', 'SC_ENCRYPTION_KEY')
  const signingKey = sessionKey || loadKey('session.key', 'SC_SESSION_SECRET')
  const database = new DatabaseSync(dbPath)
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_enc TEXT NOT NULL,
      mobile_enc TEXT NOT NULL,
      email_enc TEXT NOT NULL,
      mobile_hash TEXT NOT NULL UNIQUE,
      email_hash TEXT NOT NULL UNIQUE,
      college TEXT NOT NULL,
      year TEXT NOT NULL,
      mobile_status TEXT NOT NULL DEFAULT 'pending',
      email_status TEXT NOT NULL DEFAULT 'not_sent',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );
  `)

  function importStudents(records) {
    if (!Array.isArray(records)) throw new TypeError('Student import must be an array of records.')
    const normalizedRecords = records.map(normalizeStudent)
    let imported = 0
    let skipped = 0
    database.exec('BEGIN IMMEDIATE')
    try {
      for (const student of normalizedRecords) {
        if (saveStudent(database, student, piiKey)) imported += 1
        else skipped += 1
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    const total = database.prepare('SELECT COUNT(*) AS count FROM students').get().count
    return { imported, skipped, total }
  }

  const app = express()
  app.disable('x-powered-by')
  app.use(helmet())
  app.use(express.json({ limit: '16kb' }))

  const requireAdmin = (request, response, next) => {
    const token = request.headers.cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith('sc_admin='))?.slice('sc_admin='.length)
    if (!isValidSession(token, signingKey)) return response.status(401).json({ error: 'Admin sign-in required.' })
    next()
  }

  app.get('/api/colleges', (_request, response) => response.json({ colleges, years }))
  app.get('/api/auth/status', (_request, response) => {
    response.json({ configured: Boolean(database.prepare('SELECT id FROM admins WHERE id = 1').get()) })
  })

  app.post('/api/auth/setup', rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false }), (request, response) => {
    if (database.prepare('SELECT id FROM admins WHERE id = 1').get()) return response.status(409).json({ error: 'Admin account is already configured.' })
    const password = request.body?.password
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      return response.status(400).json({ error: 'Choose a password between 12 and 128 characters.' })
    }
    const salt = crypto.randomBytes(16)
    const passwordHash = crypto.scryptSync(password, salt, 64)
    database.prepare('INSERT INTO admins (id, salt, password_hash) VALUES (1, ?, ?)').run(salt.toString('hex'), passwordHash.toString('hex'))
    response.cookie('sc_admin', createSessionToken(signingKey), { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000, path: '/' })
    response.status(201).json({ authenticated: true })
  })

  app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false }), (request, response) => {
    const admin = database.prepare('SELECT salt, password_hash FROM admins WHERE id = 1').get()
    const password = request.body?.password
    if (!admin || typeof password !== 'string' || password.length > 128) return response.status(401).json({ error: 'Email or password is incorrect.' })
    const candidate = crypto.scryptSync(password, Buffer.from(admin.salt, 'hex'), 64)
    if (!crypto.timingSafeEqual(candidate, Buffer.from(admin.password_hash, 'hex'))) return response.status(401).json({ error: 'Email or password is incorrect.' })
    response.cookie('sc_admin', createSessionToken(signingKey), { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000, path: '/' })
    response.json({ authenticated: true })
  })

  app.post('/api/auth/logout', (_request, response) => {
    response.clearCookie('sc_admin', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' })
    response.status(204).end()
  })

  app.post('/api/students', rateLimit({ windowMs: 60 * 60 * 1000, limit: registrationLimit, standardHeaders: true, legacyHeaders: false }), (request, response) => {
    let student
    try {
      student = normalizeStudent(request.body)
    } catch (error) {
      return response.status(400).json({ error: error.message })
    }
    if (!saveStudent(database, student, piiKey)) return response.status(409).json({ error: 'A registration already exists with that email or mobile number.' })
    response.status(201).json({ message: 'Thank you for registering. Your contact details are not yet verified.' })
  })

  app.get('/api/students', requireAdmin, (request, response) => {
    const college = colleges.includes(request.query.college) ? request.query.college : null
    const year = years.includes(request.query.year) ? request.query.year : null
    const search = typeof request.query.search === 'string' ? request.query.search.trim().slice(0, 120).toLowerCase() : ''
    const conditions = []
    const parameters = []
    if (college) { conditions.push('college = ?'); parameters.push(college) }
    if (year) { conditions.push('year = ?'); parameters.push(year) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = database.prepare(`SELECT id, name_enc, mobile_enc, email_enc, college, year, mobile_status, email_status, created_at FROM students ${where} ORDER BY id DESC`).all(...parameters)
    const students = rows.map((row) => ({
      id: row.id,
      name: decrypt(row.name_enc, piiKey),
      mobile: decrypt(row.mobile_enc, piiKey),
      email: decrypt(row.email_enc, piiKey),
      college: row.college,
      year: row.year,
      mobileStatus: row.mobile_status,
      emailStatus: row.email_status,
      createdAt: row.created_at,
    })).filter((student) => !search || `${student.name} ${student.email} ${student.mobile}`.toLowerCase().includes(search))
    const total = database.prepare('SELECT COUNT(*) AS count FROM students').get().count
    const byCollege = database.prepare('SELECT college, COUNT(*) AS count FROM students GROUP BY college').all()
    const byYear = database.prepare('SELECT year, COUNT(*) AS count FROM students GROUP BY year').all()
    response.json({ students, total, byCollege, byYear })
  })

  app.patch('/api/students/:id/status', requireAdmin, (request, response) => {
    const { field, status } = request.body || {}
    const columns = { mobile: 'mobile_status', email: 'email_status' }
    const validStatuses = { mobile: ['pending', 'verified'], email: ['not_sent', 'sent', 'verified'] }
    if (!columns[field] || !validStatuses[field].includes(status)) return response.status(400).json({ error: 'Invalid verification status.' })
    const result = database.prepare(`UPDATE students SET ${columns[field]} = ? WHERE id = ?`).run(status, Number(request.params.id))
    if (!result.changes) return response.status(404).json({ error: 'Student record not found.' })
    response.json({ updated: true })
  })

  app.use('/api', (_request, response) => response.status(404).json({ error: 'API route not found.' }))
  return { app, database, importStudents }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app } = createApp()
  const port = Number(process.env.PORT || 3001)
  app.listen(port, () => console.log(`Student Connect API listening on http://localhost:${port}`))
}