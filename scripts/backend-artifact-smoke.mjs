import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = process.cwd()
const artifactRoot = resolve(root, 'dist/backend')

const requiredFiles = [
  'package.json',
  'package-lock.json',
  'backend/src/server.mjs',
  'backend/src/state-store.mjs',
  'backend/src/postgres-state-store.mjs',
  'backend/src/platform-auth.mjs',
  'backend/src/platform-notifier.mjs',
  'backend/src/content-safety.mjs',
  'backend/src/region-resolver.mjs',
  'backend/src/object-store.mjs',
  'backend/src/cos-object-store.mjs',
  'backend/db/schema.sql',
  'backend/db/pre-sync-anonymize.sql',
  'backend/deploy/Dockerfile',
  'backend/deploy/cloudbase.json',
  'src/bff/handler.js',
  'src/bff/http-error.js',
  'src/config/app.js',
  'src/data/regions.js',
  'src/domain/eligibility.js',
  'src/services/goods.js',
  'src/services/auth.js',
  'src/services/location.js',
  'src/services/media.js',
  'src/services/ops.js',
  'src/services/reports.js',
  'src/services/telemetry.js',
  'src/utils/geo.js'
]

for (const file of requiredFiles) {
  await assertFileExists(join(artifactRoot, file), `backend artifact is missing ${file}`)
}

const packageJson = JSON.parse(await readFile(join(artifactRoot, 'package.json'), 'utf8'))
const packageLock = JSON.parse(await readFile(join(artifactRoot, 'package-lock.json'), 'utf8'))

assert.equal(packageJson.type, 'module')
assert.equal(packageJson.scripts?.start, 'node backend/src/server.mjs')
assert.ok(packageJson.dependencies?.pg, 'backend artifact package.json must include pg dependency')
assert.ok(packageJson.engines?.node?.includes('>=20'), 'backend artifact must require Node >=20')
assert.equal(packageLock.name, packageJson.name, 'backend artifact package-lock name must match package.json')
assert.equal(packageLock.packages?.['']?.dependencies?.pg, packageJson.dependencies.pg, 'backend artifact package-lock must lock pg from the root package')
assert.ok(packageLock.packages?.['node_modules/pg']?.version, 'backend artifact package-lock must include pg package')

const dockerfile = await readFile(join(artifactRoot, 'backend/deploy/Dockerfile'), 'utf8')

for (const token of [
  'FROM node:20-alpine',
  'WORKDIR /app',
  'COPY . .',
  'ENV NODE_ENV=production',
  'RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force',
  'EXPOSE 8787',
  'CMD ["node", "backend/src/server.mjs"]'
]) {
  assert.ok(dockerfile.includes(token), `backend Dockerfile must contain: ${token}`)
}

const schema = await readFile(join(artifactRoot, 'backend/db/schema.sql'), 'utf8')

for (const table of [
  'users',
  'auth_sessions',
  'idempotency_records',
  'items',
  'item_images',
  'trade_intents',
  'trade_timeline',
  'trade_disputes',
  'trade_reviews',
  'location_audits',
  'reports',
  'moderation_events',
  'notifications',
  'notification_deliveries',
  'client_events',
  'ops_audit_events',
  'account_deletions'
]) {
  assert.ok(
    schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`),
    `backend schema artifact must define ${table}`
  )
}

for (const file of [
  'backend/src/server.mjs',
  'backend/src/postgres-state-store.mjs',
  'src/bff/handler.js'
]) {
  runNodeCheck(join(artifactRoot, file))
}

console.log('Backend artifact smoke checks passed')

async function assertFileExists(path, message) {
  try {
    await access(path)
  } catch {
    throw new Error(message)
  }
}

function runNodeCheck(file) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: artifactRoot,
    stdio: 'pipe',
    encoding: 'utf8'
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`node --check failed for ${file}: ${result.stderr || result.stdout}`)
  }
}
