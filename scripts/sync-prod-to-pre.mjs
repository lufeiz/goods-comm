import { spawnSync } from 'node:child_process'
import { appendFile, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readEnvironmentFile, containsPlaceholder, maskConnectionString } from './env-files.mjs'
import { PRE_PROD_TOPOLOGY_MATCH_KEYS } from './environment-topology.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const auto = process.argv.includes('--auto')
const execute = process.argv.includes('--execute') || auto
const prod = await readEnvironmentFile('prod')
const pre = await readEnvironmentFile('pre')
const prodUrl = prod.GOODS_COMM_DATABASE_URL
const preUrl = pre.GOODS_COMM_DATABASE_URL
const legacyDumpPath = process.env.GOODS_COMM_SYNC_DUMP_PATH || '/private/tmp/goods-comm-prod-to-pre.dump'
const lockPath = process.env.GOODS_COMM_SYNC_LOCK_PATH || '/private/tmp/goods-comm-prod-to-pre.lock'
const auditPath = process.env.GOODS_COMM_SYNC_AUDIT_PATH || '/private/tmp/goods-comm-prod-to-pre-audit.jsonl'
const lockTtlMs = Number(process.env.GOODS_COMM_SYNC_LOCK_TTL_MS || 2 * 60 * 60 * 1000)
const runPreSmoke = process.env.GOODS_COMM_SYNC_RUN_PRE_SMOKE === 'true'
const runPreMainSmoke = process.env.GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE === 'true'
const preHealthSmokeAttempts = parsePositiveInteger(process.env.GOODS_COMM_SYNC_HEALTH_ATTEMPTS || '12', 'GOODS_COMM_SYNC_HEALTH_ATTEMPTS')
const preHealthSmokeIntervalMs = parsePositiveInteger(process.env.GOODS_COMM_SYNC_HEALTH_INTERVAL_MS || '10000', 'GOODS_COMM_SYNC_HEALTH_INTERVAL_MS')
const resetSqlPath = resolve(root, 'backend/db/pre-sync-reset.sql')
const anonymizeSqlPath = resolve(root, 'backend/db/pre-sync-anonymize.sql')
const resetSql = await readFile(resetSqlPath, 'utf8')
const anonymizeSql = await readFile(anonymizeSqlPath, 'utf8')
const syncStages = []
const syncTables = [
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
  'location_risk_events',
  'notifications',
  'notification_deliveries',
  'moderation_events',
  'client_events',
  'ops_audit_events',
  'account_deletions',
  'bff_state_snapshots'
]
let prodClient = null
let preClient = null
let prodTransactionStarted = false
let preTransactionStarted = false
validateSyncInputs()

const plan = [
  '1. Open prod and pre PostgreSQL connections with the project pg dependency.',
  '2. Start a repeatable-read read-only prod transaction and a pre write transaction.',
  '3. Truncate pre business tables with backend/db/pre-sync-reset.sql.',
  '4. Copy normalized business tables directly from prod to pre without writing a local production dump.',
  '5. Run backend/db/pre-sync-anonymize.sql before committing pre.',
  '6. Remove any legacy local dump path after sync completion or failure.',
  '7. Write a sync audit record with per-stage timing and failure details for operational traceability.',
  '8. Run deployed pre health smoke when GOODS_COMM_SYNC_RUN_PRE_SMOKE=true.',
  '9. Run deployed pre main-flow smoke when GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE=true.'
]

if (!execute) {
  console.log('Prod to pre sync plan:')
  for (const step of plan) {
    console.log(`- ${step}`)
  }
  console.log(`Prod database: ${maskConnectionString(prodUrl)}`)
  console.log(`Pre database: ${maskConnectionString(preUrl)}`)
  console.log(`Legacy dump cleanup path: ${legacyDumpPath}`)
  console.log(`Lock path: ${lockPath}`)
  console.log(`Audit path: ${auditPath}`)
  console.log(`Run pre health smoke: ${runPreSmoke ? 'yes' : 'no'}`)
  console.log(`Pre health smoke attempts: ${preHealthSmokeAttempts}`)
  console.log(`Pre health smoke interval ms: ${preHealthSmokeIntervalMs}`)
  console.log(`Run pre main-flow smoke: ${runPreMainSmoke ? 'yes' : 'no'}`)
  console.log('Manual run: use --execute and GOODS_COMM_SYNC_CONFIRM=sync-prod-to-pre after database credentials are available.')
  console.log('Automatic run: use --auto with GOODS_COMM_SYNC_AUTO_ENABLED=true from a trusted scheduler.')
  console.log('Main-flow smoke also needs GOODS_COMM_SMOKE_SELLER_CODE, GOODS_COMM_SMOKE_BUYER_CODE, GOODS_COMM_SMOKE_LATITUDE, and GOODS_COMM_SMOKE_LONGITUDE.')
  process.exit(0)
}

if (auto && process.env.GOODS_COMM_SYNC_AUTO_ENABLED !== 'true') {
  throw new Error('Refusing automatic sync without GOODS_COMM_SYNC_AUTO_ENABLED=true')
}

if (!auto && process.env.GOODS_COMM_SYNC_CONFIRM !== 'sync-prod-to-pre') {
  throw new Error('Refusing to execute sync without GOODS_COMM_SYNC_CONFIRM=sync-prod-to-pre')
}

validateSyncInputs({
  requireRealDatabases: true
})

const startedAt = new Date().toISOString()
let lockAcquired = false
let executionError = null

try {
  await runStage('acquire_lock', () => acquireSyncLock())
  lockAcquired = true

  await runStage('connect_databases', () => connectDatabaseClients())
  await runStage('begin_database_transactions', () => beginDatabaseTransactions())
  await runStage('reset_pre', () => preClient.query(stripTransactionControl(resetSql)))
  await runStage('copy_prod_to_pre', () => copyProdToPre())
  await runStage('anonymize_pre', () => preClient.query(stripTransactionControl(anonymizeSql)))
  await runStage('commit_database_transactions', () => commitDatabaseTransactions())

  if (runPreSmoke) {
    await runStage('smoke_pre_health', () => run('node', [
      'scripts/deployed-health-smoke.mjs',
      '--env',
      'pre',
      '--attempts',
      String(preHealthSmokeAttempts),
      '--interval-ms',
      String(preHealthSmokeIntervalMs)
    ]))
  }

  if (runPreMainSmoke) {
    await runStage('smoke_pre_main_flow', () => run('node', ['scripts/deployed-main-flow-smoke.mjs', '--env', 'pre']))
  }
} catch (error) {
  executionError = error
} finally {
  if (preTransactionStarted || prodTransactionStarted) {
    try {
      await runStage('rollback_database_transactions', () => rollbackDatabaseTransactions())
    } catch (error) {
      executionError = mergeExecutionErrors(executionError, error)
    }
  }

  if (prodClient || preClient) {
    try {
      await runStage('close_database_connections', () => closeDatabaseClients())
    } catch (error) {
      executionError = mergeExecutionErrors(executionError, error)
    }
  }

  if (lockAcquired) {
    try {
      await runStage('remove_prod_dump', () => removeLegacyDumpFile())
    } catch (error) {
      executionError = mergeExecutionErrors(executionError, error)
    }

    try {
      await releaseSyncLock()
    } catch (error) {
      executionError = mergeExecutionErrors(executionError, error)
    }
  }

  await appendSyncAudit({
    status: executionError ? 'failed' : 'completed',
    startedAt,
    completedAt: new Date().toISOString(),
    ...(executionError ? { error: executionError?.message || String(executionError) } : {})
  })
}

if (executionError) {
  throw executionError
}

console.log('Prod to pre sync completed')

function validateSyncInputs(options = {}) {
  if (!prodUrl || !preUrl) {
    throw new Error('Both prod and pre GOODS_COMM_DATABASE_URL values are required')
  }

  if (prodUrl === preUrl) {
    throw new Error('Prod and pre database URLs must be different')
  }

  if (pre.GOODS_COMM_ACCEPTS_PROD_SYNC !== 'true') {
    throw new Error('Pre environment must set GOODS_COMM_ACCEPTS_PROD_SYNC=true')
  }

  if (prod.GOODS_COMM_PROD_SYNC_EXPORT !== 'true') {
    throw new Error('Prod environment must set GOODS_COMM_PROD_SYNC_EXPORT=true')
  }

  const topologyMismatches = PRE_PROD_TOPOLOGY_MATCH_KEYS
    .filter((key) => pre[key] !== prod[key])
    .map((key) => `${key}: pre=${pre[key] || 'missing'} prod=${prod[key] || 'missing'}`)

  if (topologyMismatches.length) {
    throw new Error(`Pre and prod topology variables must match before sync: ${topologyMismatches.join('; ')}`)
  }

  if (options.requireRealDatabases && (containsPlaceholder(prodUrl) || containsPlaceholder(preUrl))) {
    throw new Error('Refusing to execute sync while database URLs still contain placeholders')
  }
}

async function acquireSyncLock() {
  await removeStaleLock()

  const payload = JSON.stringify({
    pid: process.pid,
    mode: auto ? 'auto' : 'manual',
    startedAt
  }, null, 2)

  try {
    await writeFile(lockPath, payload, {
      flag: 'wx'
    })
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`Prod to pre sync is already running or lock exists: ${lockPath}`)
    }

    throw error
  }
}

async function removeStaleLock() {
  try {
    const info = await stat(lockPath)
    const ageMs = Date.now() - info.mtimeMs

    if (Number.isFinite(lockTtlMs) && lockTtlMs > 0 && ageMs > lockTtlMs) {
      await unlink(lockPath)
      return
    }

    throw new Error(`Prod to pre sync lock exists and is not stale: ${lockPath}`)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return
    }

    throw error
  }
}

async function releaseSyncLock() {
  try {
    await unlink(lockPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
}

async function removeLegacyDumpFile() {
  try {
    await unlink(legacyDumpPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }
}

async function connectDatabaseClients() {
  const Client = await loadPgClient()
  prodClient = new Client({
    connectionString: prodUrl,
    application_name: 'goods-comm-sync-prod-to-pre-prod'
  })
  preClient = new Client({
    connectionString: preUrl,
    application_name: 'goods-comm-sync-prod-to-pre-pre'
  })

  await prodClient.connect()
  await preClient.connect()
}

async function beginDatabaseTransactions() {
  await prodClient.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  prodTransactionStarted = true
  await preClient.query('BEGIN')
  preTransactionStarted = true
}

async function commitDatabaseTransactions() {
  if (preTransactionStarted) {
    await preClient.query('COMMIT')
    preTransactionStarted = false
  }

  if (prodTransactionStarted) {
    await prodClient.query('COMMIT')
    prodTransactionStarted = false
  }
}

async function rollbackDatabaseTransactions() {
  if (preTransactionStarted) {
    await preClient.query('ROLLBACK')
    preTransactionStarted = false
  }

  if (prodTransactionStarted) {
    await prodClient.query('ROLLBACK')
    prodTransactionStarted = false
  }
}

async function closeDatabaseClients() {
  const clients = [prodClient, preClient].filter(Boolean)
  await Promise.all(clients.map((client) => client.end()))
  prodClient = null
  preClient = null
}

async function copyProdToPre() {
  const tableRows = {}
  let totalRows = 0

  for (const table of syncTables) {
    const result = await prodClient.query(`SELECT * FROM ${quoteIdentifier(table)}`)
    const rows = Array.isArray(result.rows) ? result.rows : []

    tableRows[table] = rows.length
    totalRows += rows.length

    for (const row of rows) {
      await insertRow(preClient, table, row)
    }
  }

  return {
    totalRows,
    tableRows
  }
}

async function insertRow(client, table, row) {
  const columns = Object.keys(row)

  if (!columns.length) {
    return
  }

  const placeholders = columns.map((_, index) => `$${index + 1}`)
  const sql = `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${placeholders.join(', ')})`
  const values = columns.map((column) => row[column])

  await client.query(sql, values)
}

async function loadPgClient() {
  const moduleSpecifier = process.env.GOODS_COMM_SYNC_PG_MODULE || 'pg'

  try {
    const pg = await import(moduleSpecifier)
    const Client = pg.default?.Client || pg.Client

    if (!Client) {
      throw new Error(`${moduleSpecifier} does not export a pg Client`)
    }

    return Client
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('The pg package is required for prod-to-pre sync; run npm install before syncing')
    }

    throw error
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function stripTransactionControl(sql) {
  return String(sql || '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(BEGIN|COMMIT);?\s*$/i.test(line))
    .join('\n')
}

async function appendSyncAudit(record) {
  const payload = {
    ...record,
    mode: auto ? 'auto' : 'manual',
    prodDatabase: maskConnectionString(prodUrl),
    preDatabase: maskConnectionString(preUrl),
    legacyDumpPath,
    runPreSmoke,
    preHealthSmokeAttempts,
    preHealthSmokeIntervalMs,
    runPreMainSmoke,
    stages: syncStages
  }

  await appendFile(auditPath, `${JSON.stringify(payload)}\n`)
}

function mergeExecutionErrors(primary, secondary) {
  if (!primary) {
    return secondary
  }

  const primaryMessage = primary?.message || String(primary)
  const secondaryMessage = secondary?.message || String(secondary)
  return new Error(`${primaryMessage}; cleanup failed: ${secondaryMessage}`)
}

async function runStage(name, callback) {
  const startedAtMs = Date.now()
  const stage = {
    name,
    status: 'running',
    startedAt: new Date(startedAtMs).toISOString()
  }

  try {
    const result = await callback()
    const completedAtMs = Date.now()
    const details = result && typeof result === 'object' && !Array.isArray(result)
      ? { details: result }
      : {}

    syncStages.push({
      ...stage,
      status: 'completed',
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: completedAtMs - startedAtMs,
      ...details
    })

    return result
  } catch (error) {
    const completedAtMs = Date.now()

    syncStages.push({
      ...stage,
      status: 'failed',
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: completedAtMs - startedAtMs,
      error: error?.message || String(error)
    })

    throw error
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit'
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`)
  }
}

function parsePositiveInteger(value = '', label) {
  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer, got ${value}`)
  }

  return parsed
}
