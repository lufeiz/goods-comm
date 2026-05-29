import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const lockPath = `/private/tmp/goods-comm-prod-sync-smoke-${process.pid}.lock`
const auditPath = `/private/tmp/goods-comm-prod-sync-smoke-${process.pid}.jsonl`
const syncScriptPath = resolve(process.cwd(), 'scripts/sync-prod-to-pre.mjs')

await cleanup()

const plan = runSyncScript([])
assert.equal(plan.status, 0)
assert.match(plan.stdout, /Prod to pre sync plan/)
assert.match(plan.stdout, /Automatic run/)
assert.match(plan.stdout, /Audit path/)
assert.match(plan.stdout, /Run pre health smoke: no/)
assert.match(plan.stdout, /Run pre main-flow smoke: no/)
assert.match(plan.stdout, /GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE=true/)

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
      ...env
    }
  })
}

async function runSyncScriptWithTemporaryEnv(args, overrides = {}) {
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
        GOODS_COMM_SYNC_AUDIT_PATH: auditPath
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

async function cleanup() {
  for (const path of [lockPath, auditPath]) {
    try {
      await unlink(path)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
    }
  }
}
