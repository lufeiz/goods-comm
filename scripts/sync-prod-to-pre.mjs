import { spawnSync } from 'node:child_process'
import { appendFile, stat, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { readEnvironmentFile, containsPlaceholder, maskConnectionString } from './env-files.mjs'

const auto = process.argv.includes('--auto')
const execute = process.argv.includes('--execute') || auto
const prod = await readEnvironmentFile('prod')
const pre = await readEnvironmentFile('pre')
const prodUrl = prod.GOODS_COMM_DATABASE_URL
const preUrl = pre.GOODS_COMM_DATABASE_URL
const dumpPath = process.env.GOODS_COMM_SYNC_DUMP_PATH || '/private/tmp/goods-comm-prod-to-pre.dump'
const lockPath = process.env.GOODS_COMM_SYNC_LOCK_PATH || '/private/tmp/goods-comm-prod-to-pre.lock'
const auditPath = process.env.GOODS_COMM_SYNC_AUDIT_PATH || '/private/tmp/goods-comm-prod-to-pre-audit.jsonl'
const lockTtlMs = Number(process.env.GOODS_COMM_SYNC_LOCK_TTL_MS || 2 * 60 * 60 * 1000)
const runPreSmoke = process.env.GOODS_COMM_SYNC_RUN_PRE_SMOKE === 'true'
const runPreMainSmoke = process.env.GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE === 'true'
const preHealthSmokeAttempts = parsePositiveInteger(process.env.GOODS_COMM_SYNC_HEALTH_ATTEMPTS || '12', 'GOODS_COMM_SYNC_HEALTH_ATTEMPTS')
const preHealthSmokeIntervalMs = parsePositiveInteger(process.env.GOODS_COMM_SYNC_HEALTH_INTERVAL_MS || '10000', 'GOODS_COMM_SYNC_HEALTH_INTERVAL_MS')
const resetSql = resolve('backend/db/pre-sync-reset.sql')
const anonymizeSql = resolve('backend/db/pre-sync-anonymize.sql')
const syncStages = []
const PRE_PROD_TOPOLOGY_MATCH_KEYS = [
  'GOODS_COMM_TENCENT_REGION',
  'HOST',
  'PORT',
  'GOODS_COMM_MAX_IMAGE_BYTES',
  'GOODS_COMM_MAX_REQUEST_BYTES',
  'GOODS_COMM_RATE_LIMIT_MAX_REQUESTS',
  'GOODS_COMM_RATE_LIMIT_WINDOW_MS',
  'GOODS_COMM_DATABASE_SCHEMA',
  'GOODS_COMM_STATE_STORE',
  'GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS',
  'GOODS_COMM_POSTGRES_AUTO_SCHEMA',
  'GOODS_COMM_OBJECT_STORE',
  'GOODS_COMM_COS_REGION',
  'GOODS_COMM_MAP_PROVIDER',
  'GOODS_COMM_MAP_REGION_DATASET',
  'GOODS_COMM_TENCENT_MAP_GEOCODER_URL',
  'GOODS_COMM_CONTENT_SECURITY_PROVIDER',
  'GOODS_COMM_PLATFORM_AUTH_MODE',
  'GOODS_COMM_PLATFORM_NOTIFY_PROVIDER',
  'GOODS_COMM_OPS_LOGIN_MAX_FAILURES',
  'GOODS_COMM_OPS_LOGIN_WINDOW_MS',
  'GOODS_COMM_OPS_LOGIN_LOCK_MS',
  'GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_FIELDS',
  'GOODS_COMM_WECHAT_SUBSCRIBE_SEND_URL',
  'GOODS_COMM_ALIPAY_GATEWAY'
]

validateSyncInputs()

const plan = [
  '1. Dump prod database with pg_dump custom format.',
  '2. Truncate pre database business tables.',
  '3. Restore prod data into pre.',
  '4. Run pre anonymization SQL to revoke sessions and remove direct contact data.',
  '5. Write a sync audit record with per-stage timing and failure details for operational traceability.',
  '6. Run deployed pre health smoke when GOODS_COMM_SYNC_RUN_PRE_SMOKE=true.',
  '7. Run deployed pre main-flow smoke when GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE=true.'
]

if (!execute) {
  console.log('Prod to pre sync plan:')
  for (const step of plan) {
    console.log(`- ${step}`)
  }
  console.log(`Prod database: ${maskConnectionString(prodUrl)}`)
  console.log(`Pre database: ${maskConnectionString(preUrl)}`)
  console.log(`Dump path: ${dumpPath}`)
  console.log(`Lock path: ${lockPath}`)
  console.log(`Audit path: ${auditPath}`)
  console.log(`Run pre health smoke: ${runPreSmoke ? 'yes' : 'no'}`)
  console.log(`Pre health smoke attempts: ${preHealthSmokeAttempts}`)
  console.log(`Pre health smoke interval ms: ${preHealthSmokeIntervalMs}`)
  console.log(`Run pre main-flow smoke: ${runPreMainSmoke ? 'yes' : 'no'}`)
  console.log('Manual run: use --execute and GOODS_COMM_SYNC_CONFIRM=sync-prod-to-pre after credentials and pg tools are available.')
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

try {
  await runStage('acquire_lock', () => acquireSyncLock())
  lockAcquired = true

  await runStage('verify_toolchain', () => {
    for (const command of ['pg_dump', 'psql', 'pg_restore']) {
      assertCommandAvailable(command)
    }
  })

  await runStage('dump_prod', () => run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', dumpPath, prodUrl]))
  await runStage('reset_pre', () => run('psql', [preUrl, '-f', resetSql]))
  await runStage('restore_pre', () => run('pg_restore', ['--data-only', '--no-owner', '--no-privileges', '--dbname', preUrl, dumpPath]))
  await runStage('anonymize_pre', () => run('psql', [preUrl, '-f', anonymizeSql]))

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

  await appendSyncAudit({
    status: 'completed',
    startedAt,
    completedAt: new Date().toISOString()
  })

  console.log('Prod to pre sync completed')
} catch (error) {
  await appendSyncAudit({
    status: 'failed',
    startedAt,
    completedAt: new Date().toISOString(),
    error: error?.message || String(error)
  })
  throw error
} finally {
  if (lockAcquired) {
    await releaseSyncLock()
  }
}

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

async function appendSyncAudit(record) {
  const payload = {
    ...record,
    mode: auto ? 'auto' : 'manual',
    prodDatabase: maskConnectionString(prodUrl),
    preDatabase: maskConnectionString(preUrl),
    dumpPath,
    runPreSmoke,
    preHealthSmokeAttempts,
    preHealthSmokeIntervalMs,
    runPreMainSmoke,
    stages: syncStages
  }

  await appendFile(auditPath, `${JSON.stringify(payload)}\n`)
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

    syncStages.push({
      ...stage,
      status: 'completed',
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: completedAtMs - startedAtMs
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

function assertCommandAvailable(command) {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore'
  })

  if (result.error || result.status !== 0) {
    throw new Error(`${command} is required for --execute sync`)
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
