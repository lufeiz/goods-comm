import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const migrateScriptPath = resolve(process.cwd(), 'scripts/migrate-database.mjs')

const plan = runMigration([])
assert.equal(plan.status, 0)
assert.match(plan.stdout, /Database migration plan for pre/)
assert.match(plan.stdout, /backend\/db\/schema\.sql/)
assert.match(plan.stdout, /GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre/)

const executeWithPlaceholders = runMigration(['--execute'], {
  GOODS_COMM_DB_MIGRATE_CONFIRM: 'migrate-pre'
})
assert.notEqual(executeWithPlaceholders.status, 0)
assert.match(executeWithPlaceholders.stderr, /GOODS_COMM_DATABASE_URL still contains placeholders/)

const fakePg = await createFakePgModule()

try {
  const executed = await runMigrationWithTemporaryEnv(['--execute'], {
    pre: {
      GOODS_COMM_DATABASE_URL: 'postgres://goods_comm_pre_app:secret@pre-pg.internal:5432/goods_comm_pre'
    }
  }, {
    GOODS_COMM_DB_MIGRATE_CONFIRM: 'migrate-pre',
    GOODS_COMM_DB_MIGRATE_PG_MODULE: fakePg.moduleUrl,
    GOODS_COMM_DB_MIGRATE_FAKE_PG_LOG: fakePg.logPath
  })
  assert.equal(executed.status, 0, executed.stderr || executed.stdout)
  assert.match(executed.stdout, /Database migration completed for pre/)

  const queryLog = await readFile(fakePg.logPath, 'utf8')
  assert.match(queryLog, /connect/)
  assert.match(queryLog, /BEGIN/)
  assert.match(queryLog, /CREATE TABLE IF NOT EXISTS users/)
  assert.match(queryLog, /schema_migrations/)
  assert.match(queryLog, /COMMIT/)

  const prodWithoutAllow = await runMigrationWithTemporaryEnv(['--execute'], {
    prod: {
      GOODS_COMM_DATABASE_URL: 'postgres://goods_comm_prod_app:secret@prod-pg.internal:5432/goods_comm_prod'
    }
  }, {
    GOODS_COMM_DB_MIGRATE_CONFIRM: 'migrate-prod',
    GOODS_COMM_DB_MIGRATE_PG_MODULE: fakePg.moduleUrl,
    GOODS_COMM_DB_MIGRATE_FAKE_PG_LOG: fakePg.logPath
  }, 'prod')
  assert.notEqual(prodWithoutAllow.status, 0)
  assert.match(prodWithoutAllow.stderr, /GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true/)
} finally {
  await rm(fakePg.directory, {
    recursive: true,
    force: true
  })
}

console.log('Database migration smoke checks passed')

function runMigration(args, env = {}) {
  return spawnSync(process.execPath, [
    migrateScriptPath,
    ...args
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env
    }
  })
}

async function runMigrationWithTemporaryEnv(args, overrides = {}, env = {}, environment = 'pre') {
  const directory = await mkdtemp(join(tmpdir(), `goods-comm-db-migrate-smoke-${process.pid}-`))

  try {
    for (const targetEnvironment of ['pre', 'prod']) {
      await writeFile(
        join(directory, `.env.${targetEnvironment}`),
        applyEnvOverrides(await readFile(`.env.${targetEnvironment}`, 'utf8'), overrides[targetEnvironment] || {})
      )
    }

    return spawnSync(process.execPath, [
      migrateScriptPath,
      '--env',
      environment,
      ...args
    ], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
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

async function createFakePgModule() {
  const directory = await mkdtemp(join(tmpdir(), `goods-comm-db-migrate-pg-${process.pid}-`))
  const logPath = join(directory, 'queries.log')
  const modulePath = join(directory, 'fake-pg.mjs')

  await writeFile(logPath, '')
  await writeFile(modulePath, `
import { appendFileSync } from 'node:fs'

export class Client {
  async connect() {
    this.log('connect')
  }

  async end() {
    this.log('end')
  }

  async query(sql) {
    this.log(String(sql))
    return { rows: [], rowCount: 0 }
  }

  log(sql) {
    appendFileSync(process.env.GOODS_COMM_DB_MIGRATE_FAKE_PG_LOG, \`\${sql}\\n\`)
  }
}

export default { Client }
`)

  return {
    directory,
    logPath,
    moduleUrl: pathToFileURL(modulePath).href
  }
}
