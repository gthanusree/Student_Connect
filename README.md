# Student Connect

A student community registration page with a password-protected admin dashboard. Student records are stored in SQLite; names, mobile numbers, and email addresses are encrypted at rest. Email and mobile verification states are tracked separately.

The bundled campus photo is from [Unsplash](https://images.unsplash.com/photo-1523240795612-9a054b0db644).

## Run locally

Requires Node.js 24 or later.

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite. The development command starts both the React app and its API. The first time you open **Admin dashboard**, create an admin password with at least 12 characters. Local records and generated encryption/session keys are kept in the ignored `data/` directory.

## Admin dashboard

The dashboard shows total submissions, college and study-year breakdowns, searchable student records, registration dates, and college/year filters. It refreshes records and counts every five seconds while open. Admins can update mobile status (`Pending` or `Verified`) and email activity (`Not sent`, `Email sent`, or `Verified`). These status changes are manual: this project does not send email or SMS messages or validate an OTP.

## Import demo records

Run `npm run import:demo` to load the 60 synthetic rows from `test/fixtures/student-records.csv` into the persistent `data/students.sqlite` database. The importer uses the same validation, encryption, keyed duplicate detection, and pending verification defaults as registrations. Existing records are preserved; rerunning the command skips records already imported. The first run adds 60 records to the dashboard total.

## Data and deployment

The API validates college/year choices, normalizes contact details, rejects duplicate emails and mobile numbers, and encrypts name/mobile/email fields with AES-256-GCM. Keyed hashes are used for duplicate detection. Admin passwords are stored as scrypt hashes; dashboard access uses an HTTP-only, SameSite cookie. Registration and login endpoints are rate-limited, and Helmet security headers are enabled.

For a deployment, set `SC_ENCRYPTION_KEY` and `SC_SESSION_SECRET` to independent, persistent, base64-encoded 32-byte random keys before starting the API. Protect and back up the SQLite database and both keys together; losing the encryption key makes encrypted contact details unreadable. Serve production traffic over HTTPS so the admin cookie is secure. Keep admin credentials and data backups private.

PowerShell can generate each key with:

```powershell
node -p "require('node:crypto').randomBytes(32).toString('base64')"
```

Set each result in the host's secret manager as `SC_ENCRYPTION_KEY` and `SC_SESSION_SECRET`; do not commit either value.

## Checks

```powershell
npm test
npm run lint
npm run build
```

The exact 60-row synthetic fixture is `test/fixtures/student-records.csv`. Run `npm test` to submit those records through the API and test the repeatable import against temporary SQLite databases. The test checks success responses, dashboard counts, college/year aggregates and filters, search, registration dates, duplicate rejection, admin-only access, status defaults/updates, encrypted field storage, import idempotency and preservation of two existing records, and records/statuses after database reopen. Tests do not add sample records to the local application database; only `npm run import:demo` does that.