import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

const lockPath = `/private/tmp/goods-comm-prod-sync-smoke-${process.pid}.lock`
const auditPath = `/private/tmp/goods-comm-prod-sync-smoke-${process.pid}.jsonl`
const dumpPath = `/private/tmp/goods-comm-prod-sync-smoke-${process.pid}.dump`
const syncScriptPath = resolve(process.cwd(), 'scripts/sync-prod-to-pre.mjs')
const anonymizeSqlPath = resolve(process.cwd(), 'backend/db/pre-sync-anonymize.sql')
const resetSqlPath = resolve(process.cwd(), 'backend/db/pre-sync-reset.sql')

await cleanup()
await assertPreSyncAnonymizeSql()
await assertPreSyncResetSql()

const plan = runSyncScript([])
assert.equal(plan.status, 0)
assert.match(plan.stdout, /Prod to pre sync plan/)
assert.match(plan.stdout, /Automatic run/)
assert.match(plan.stdout, /Audit path/)
assert.match(plan.stdout, /Run pre health smoke: no/)
assert.match(plan.stdout, /Pre health smoke attempts: 12/)
assert.match(plan.stdout, /Pre health smoke interval ms: 10000/)
assert.match(plan.stdout, /Run pre main-flow smoke: no/)
assert.match(plan.stdout, /GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE=true/)

const planWithHealthRetry = runSyncScript([], {
  GOODS_COMM_SYNC_RUN_PRE_SMOKE: 'true',
  GOODS_COMM_SYNC_HEALTH_ATTEMPTS: '3',
  GOODS_COMM_SYNC_HEALTH_INTERVAL_MS: '250'
})
assert.equal(planWithHealthRetry.status, 0)
assert.match(planWithHealthRetry.stdout, /Run pre health smoke: yes/)
assert.match(planWithHealthRetry.stdout, /Pre health smoke attempts: 3/)
assert.match(planWithHealthRetry.stdout, /Pre health smoke interval ms: 250/)

const planWithInvalidHealthRetry = runSyncScript([], {
  GOODS_COMM_SYNC_HEALTH_ATTEMPTS: '0'
})
assert.notEqual(planWithInvalidHealthRetry.status, 0)
assert.match(planWithInvalidHealthRetry.stderr, /GOODS_COMM_SYNC_HEALTH_ATTEMPTS must be a positive integer/)

const planWithMainSmoke = runSyncScript([], {
  GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE: 'true'
})
assert.equal(planWithMainSmoke.status, 0)
assert.match(planWithMainSmoke.stdout, /Run pre main-flow smoke: yes/)
assert.match(planWithMainSmoke.stdout, /GOODS_COMM_SMOKE_SELLER_CODE/)

const topologyMismatch = await runSyncScriptWithTemporaryEnv([], {
  pre: {
    GOODS_COMM_CONTENT_SECURITY_PROVIDER: 'mock'
  }
})
assert.notEqual(topologyMismatch.status, 0)
assert.match(topologyMismatch.stderr, /topology variables must match/)
assert.match(topologyMismatch.stderr, /GOODS_COMM_CONTENT_SECURITY_PROVIDER/)

const routeRateLimitTopologyMismatch = await runSyncScriptWithTemporaryEnv([], {
  pre: {
    GOODS_COMM_ROUTE_RATE_LIMIT_MAX_REQUESTS: '999'
  }
})
assert.notEqual(routeRateLimitTopologyMismatch.status, 0)
assert.match(routeRateLimitTopologyMismatch.stderr, /topology variables must match/)
assert.match(routeRateLimitTopologyMismatch.stderr, /GOODS_COMM_ROUTE_RATE_LIMIT_MAX_REQUESTS/)

const userRateLimitTopologyMismatch = await runSyncScriptWithTemporaryEnv([], {
  prod: {
    GOODS_COMM_USER_RATE_LIMIT_WINDOW_MS: '120000'
  }
})
assert.notEqual(userRateLimitTopologyMismatch.status, 0)
assert.match(userRateLimitTopologyMismatch.stderr, /topology variables must match/)
assert.match(userRateLimitTopologyMismatch.stderr, /GOODS_COMM_USER_RATE_LIMIT_WINDOW_MS/)

const advisoryLockTopologyMismatch = await runSyncScriptWithTemporaryEnv([], {
  prod: {
    GOODS_COMM_POSTGRES_ADVISORY_LOCK_KEY: 'goods-comm-prod-lock'
  }
})
assert.notEqual(advisoryLockTopologyMismatch.status, 0)
assert.match(advisoryLockTopologyMismatch.stderr, /topology variables must match/)
assert.match(advisoryLockTopologyMismatch.stderr, /GOODS_COMM_POSTGRES_ADVISORY_LOCK_KEY/)

const autoWithoutEnable = runSyncScript(['--auto'])
assert.notEqual(autoWithoutEnable.status, 0)
assert.match(autoWithoutEnable.stderr, /GOODS_COMM_SYNC_AUTO_ENABLED=true/)

const autoWithPlaceholders = runSyncScript(['--auto'], {
  GOODS_COMM_SYNC_AUTO_ENABLED: 'true'
})
assert.notEqual(autoWithPlaceholders.status, 0)
assert.match(autoWithPlaceholders.stderr, /placeholders/)

const manualWithoutConfirm = runSyncScript(['--execute'])
assert.notEqual(manualWithoutConfirm.status, 0)
assert.match(manualWithoutConfirm.stderr, /GOODS_COMM_SYNC_CONFIRM=sync-prod-to-pre/)

const manualWithPlaceholders = runSyncScript(['--execute'], {
  GOODS_COMM_SYNC_CONFIRM: 'sync-prod-to-pre'
})
assert.notEqual(manualWithPlaceholders.status, 0)
assert.match(manualWithPlaceholders.stderr, /placeholders/)

const fakeTools = await createFakePostgresTools()

try {
  await cleanup()

  const successfulManual = await runSyncScriptWithTemporaryEnv(['--execute'], {
    pre: {
      GOODS_COMM_DATABASE_URL: 'postgres://goods_comm_pre_app:secret@pre-db.internal:5432/goods_comm_pre'
    },
    prod: {
      GOODS_COMM_DATABASE_URL: 'postgres://goods_comm_prod_app:secret@prod-db.internal:5432/goods_comm_prod'
    }
  }, {
    GOODS_COMM_SYNC_CONFIRM: 'sync-prod-to-pre',
    GOODS_COMM_SYNC_FAKE_TOOL_LOG: fakeTools.logPath,
    PATH: `${fakeTools.binPath}${delimiter}${process.env.PATH || ''}`
  })
  assert.equal(successfulManual.status, 0)

  const audit = await readLatestAuditRecord()
  assert.equal(audit.status, 'completed')
  assert.deepEqual(audit.stages.map((stage) => stage.name), [
    'acquire_lock',
    'verify_toolchain',
    'dump_prod',
    'reset_pre',
    'restore_pre',
    'anonymize_pre',
    'remove_prod_dump'
  ])
  assert.ok(audit.stages.every((stage) => stage.status === 'completed'))
  assert.ok(audit.stages.every((stage) => Number.isSafeInteger(stage.durationMs) && stage.durationMs >= 0))
  await assertPathMissing(dumpPath)

  const toolLog = await readFile(fakeTools.logPath, 'utf8')
  assert.match(toolLog, /pg_dump --format=custom --no-owner --no-privileges --file/)
  assert.match(toolLog, /pg_restore --data-only --no-owner --no-privileges --dbname/)

  await cleanup()

  const failedManual = await runSyncScriptWithTemporaryEnv(['--execute'], {
    pre: {
      GOODS_COMM_DATABASE_URL: 'postgres://goods_comm_pre_app:secret@pre-db.internal:5432/goods_comm_pre'
    },
    prod: {
      GOODS_COMM_DATABASE_URL: 'postgres://goods_comm_prod_app:secret@prod-db.internal:5432/goods_comm_prod'
    }
  }, {
    GOODS_COMM_SYNC_CONFIRM: 'sync-prod-to-pre',
    GOODS_COMM_SYNC_FAKE_TOOL_LOG: fakeTools.logPath,
    GOODS_COMM_SYNC_FAKE_FAIL_COMMAND: 'pg_restore',
    PATH: `${fakeTools.binPath}${delimiter}${process.env.PATH || ''}`
  })
  assert.notEqual(failedManual.status, 0)

  const failedAudit = await readLatestAuditRecord()
  assert.equal(failedAudit.status, 'failed')
  const failedRestoreStage = failedAudit.stages.find((stage) => stage.name === 'restore_pre')
  assert.equal(failedRestoreStage.status, 'failed')
  assert.match(failedRestoreStage.error, /pg_restore failed/)
  assert.equal(failedAudit.stages.at(-1).name, 'remove_prod_dump')
  assert.equal(failedAudit.stages.at(-1).status, 'completed')
  await assertPathMissing(dumpPath)
} finally {
  await rm(fakeTools.directory, {
    recursive: true,
    force: true
  })
}

await cleanup()

console.log('Prod to pre sync smoke checks passed')

function runSyncScript(args, env = {}) {
  return spawnSync(process.execPath, [
    syncScriptPath,
    ...args
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      GOODS_COMM_SYNC_LOCK_PATH: lockPath,
      GOODS_COMM_SYNC_AUDIT_PATH: auditPath,
      GOODS_COMM_SYNC_DUMP_PATH: dumpPath,
      ...env
    }
  })
}

async function runSyncScriptWithTemporaryEnv(args, overrides = {}, env = {}) {
  const directory = await mkdtemp(join(tmpdir(), `goods-comm-sync-smoke-${process.pid}-`))

  try {
    await writeFile(join(directory, '.env.pre'), applyEnvOverrides(await readFile('.env.pre', 'utf8'), overrides.pre || {}))
    await writeFile(join(directory, '.env.prod'), applyEnvOverrides(await readFile('.env.prod', 'utf8'), overrides.prod || {}))

    return spawnSync(process.execPath, [
      syncScriptPath,
      ...args
    ], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        GOODS_COMM_SYNC_LOCK_PATH: lockPath,
        GOODS_COMM_SYNC_AUDIT_PATH: auditPath,
        GOODS_COMM_SYNC_DUMP_PATH: dumpPath,
        ...env
      }
    })
  } finally {
    await rm(directory, {
      recursive: true,
      force: true
    })
  }
}

function applyEnvOverrides(raw, overrides = {}) {
  let next = raw

  for (const [key, value] of Object.entries(overrides)) {
    const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm')
    const line = `${key}=${value}`

    next = pattern.test(next)
      ? next.replace(pattern, line)
      : `${next.trimEnd()}\n${line}\n`
  }

  return next
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function createFakePostgresTools() {
  const directory = await mkdtemp(join(tmpdir(), `goods-comm-sync-tools-${process.pid}-`))
  const logPath = join(directory, 'commands.log')
  const script = `#!/bin/sh
name=$(basename "$0")
if [ "$1" = "--version" ]; then
  echo "$name fake"
  exit 0
fi
printf "%s %s\\n" "$name" "$*" >> "$GOODS_COMM_SYNC_FAKE_TOOL_LOG"
if [ "$GOODS_COMM_SYNC_FAKE_FAIL_COMMAND" = "$name" ]; then
  exit 23
fi
if [ "$name" = "pg_dump" ]; then
  dump_file=""
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--file" ]; then
      shift
      dump_file="$1"
      break
    fi
    shift
  done
  if [ -n "$dump_file" ]; then
    printf "fake production dump\\n" > "$dump_file"
  fi
fi
exit 0
`

  await writeFile(logPath, '')

  await Promise.all(['pg_dump', 'psql', 'pg_restore'].map(async (command) => {
    const path = join(directory, command)
    await writeFile(path, script)
    await chmod(path, 0o755)
  }))

  return {
    directory,
    binPath: directory,
    logPath
  }
}

async function assertPreSyncAnonymizeSql() {
  const sql = await readFile(anonymizeSqlPath, 'utf8')

  assert.match(sql, /DELETE FROM bff_state_snapshots/)
  assert.match(sql, /platform_id = 'pre_platform_' \|\| substr\(md5\(id \|\| ':platform'\), 1, 16\)/)
  assert.match(sql, /union_id = ''/)
  assert.match(sql, /UPDATE items[\s\S]*title = '预上线商品_'/)
  assert.match(sql, /location = location - 'latitude' - 'longitude' - 'accuracy' - 'capturedAt'/)
  assert.match(sql, /UPDATE trade_intents[\s\S]*item_title = '预上线交易商品'[\s\S]*location_audit = location_audit - 'latitude' - 'longitude' - 'accuracy' - 'capturedAt'/)
  assert.match(sql, /UPDATE location_audits[\s\S]*latitude = NULL[\s\S]*longitude = NULL[\s\S]*accuracy = NULL/)
  assert.match(sql, /UPDATE location_risk_events[\s\S]*latitude = NULL[\s\S]*longitude = NULL[\s\S]*accuracy = NULL[\s\S]*distance_meters = NULL[\s\S]*speed_mps = NULL[\s\S]*resolution_note = ''[\s\S]*reviewer_id = ''/)
  assert.match(sql, /UPDATE item_images[\s\S]*url = ''[\s\S]*storage_key = ''[\s\S]*checksum = ''[\s\S]*moderation_trace_id = ''/)
  assert.match(sql, /original_name = ''/)
  assert.match(sql, /UPDATE moderation_events[\s\S]*SET title = ''/)
  assert.match(sql, /UPDATE account_deletions[\s\S]*SET reason = ''/)
}

async function assertPreSyncResetSql() {
  const sql = await readFile(resetSqlPath, 'utf8')

  assert.match(sql, /TRUNCATE TABLE[\s\S]*bff_state_snapshots[\s\S]*RESTART IDENTITY CASCADE/)
  assert.match(sql, /TRUNCATE TABLE[\s\S]*location_risk_events/)
}

async function readLatestAuditRecord() {
  const raw = await readFile(auditPath, 'utf8')
  const lines = raw.trim().split(/\r?\n/)
  return JSON.parse(lines.at(-1))
}

async function cleanup() {
  for (const path of [lockPath, auditPath, dumpPath]) {
    try {
      await unlink(path)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
    }
  }
}

async function assertPathMissing(path) {
  try {
    await stat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return
    }

    throw error
  }

  throw new Error(`${path} should not exist`)
}
