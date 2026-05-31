import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const provisionScriptPath = resolve(process.cwd(), 'scripts/provision-database.mjs')

const plan = runProvision([])
assert.equal(plan.status, 0)
assert.match(plan.stdout, /Database provisioning plan for pre/)
assert.match(plan.stdout, /missing GOODS_COMM_DATABASE_ADMIN_URL/)
assert.match(plan.stdout, /GOODS_COMM_DB_PROVISION_CONFIRM=provision-pre/)
assert.match(plan.stdout, /run db:migrate for this environment/)

const invalidDatabaseUrl = await runProvisionWithTemporaryEnv([], {
  pre: {
    GOODS_COMM_DATABASE_URL: 'not-a-postgres-url'
  }
})
assert.notEqual(invalidDatabaseUrl.status, 0)
assert.match(invalidDatabaseUrl.stderr, /GOODS_COMM_DATABASE_URL is invalid/)

const protectedDatabaseName = await runProvisionWithTemporaryEnv([], {
  pre: {
    GOODS_COMM_DATABASE_URL: 'postgres://goods_comm_pre_app:secret@pre-pg.internal:5432/postgres'
  }
})
assert.notEqual(protectedDatabaseName.status, 0)
assert.match(protectedDatabaseName.stderr, /refusing to provision protected PostgreSQL database postgres/)

const executeWithoutAdminUrl = await runProvisionWithTemporaryEnv(['--execute'], {
  pre: {
    GOODS_COMM_DATABASE_URL: 'postgres://goods_comm_pre_app:secret@pre-pg.internal:5432/goods_comm_pre'
  }
}, {
  GOODS_COMM_DB_PROVISION_CONFIRM: 'provision-pre'
})
assert.notEqual(executeWithoutAdminUrl.status, 0)
assert.match(executeWithoutAdminUrl.stderr, /GOODS_COMM_DATABASE_ADMIN_URL is required/)

const executeWithPlaceholders = runProvision(['--execute'], {
  GOODS_COMM_DB_PROVISION_CONFIRM: 'provision-pre',
  GOODS_COMM_DATABASE_ADMIN_URL: 'postgres://postgres:secret@admin-pg.internal:5432/postgres'
})
assert.notEqual(executeWithPlaceholders.status, 0)
assert.match(executeWithPlaceholders.stderr, /GOODS_COMM_DATABASE_URL still contains placeholders/)

const fakePg = await createFakePgModule()

try {
  const successfulProvision = await runProvisionWithTemporaryEnv(['--execute'], {
    pre: {
      GOODS_COMM_DATABASE_URL: 'postgres://goods_comm_pre_app:secret@pre-pg.internal:5432/goods_comm_pre'
    }
  }, {
    GOODS_COMM_DB_PROVISION_CONFIRM: 'provision-pre',
    GOODS_COMM_DATABASE_ADMIN_URL: 'postgres://postgres:admin-secret@pre-pg.internal:5432/postgres',
    GOODS_COMM_DB_PROVISION_PG_MODULE: fakePg.moduleUrl,
    GOODS_COMM_DB_PROVISION_FAKE_PG_LOG: fakePg.logPath
  })
  assert.equal(successfulProvision.status, 0, successfulProvision.stderr || successfulProvision.stdout)
  assert.match(successfulProvision.stdout, /Database provisioning completed for pre: goods_comm_pre/)

  const queryLog = await readFile(fakePg.logPath, 'utf8')
  assert.match(queryLog, /admin SELECT 1 FROM pg_roles WHERE rolname = \$1 \["goods_comm_pre_app"\]/)
  assert.match(queryLog, /admin CREATE ROLE "goods_comm_pre_app" WITH LOGIN PASSWORD/)
  assert.match(queryLog, /admin SELECT 1 FROM pg_database WHERE datname = \$1 \["goods_comm_pre"\]/)
  assert.match(queryLog, /admin CREATE DATABASE "goods_comm_pre" OWNER "goods_comm_pre_app" TEMPLATE template0 ENCODING 'UTF8'/)
  assert.match(queryLog, /app SELECT current_database\(\) AS database, current_user AS username/)

  const prodWithoutAllow = await runProvisionWithTemporaryEnv(['--execute'], {
    prod: {
      GOODS_COMM_DATABASE_URL: 'postgres://goods_comm_prod_app:secret@prod-pg.internal:5432/goods_comm_prod'
    }
  }, {
    GOODS_COMM_DB_PROVISION_CONFIRM: 'provision-prod',
    GOODS_COMM_DATABASE_ADMIN_URL: 'postgres://postgres:admin-secret@prod-pg.internal:5432/postgres',
    GOODS_COMM_DB_PROVISION_PG_MODULE: fakePg.moduleUrl,
    GOODS_COMM_DB_PROVISION_FAKE_PG_LOG: fakePg.logPath
  }, 'prod')
  assert.notEqual(prodWithoutAllow.status, 0)
  assert.match(prodWithoutAllow.stderr, /GOODS_COMM_DB_PROVISION_ALLOW_PROD=true/)
} finally {
  await rm(fakePg.directory, {
    recursive: true,
    force: true
  })
}

console.log('Database provisioning smoke checks passed')

function runProvision(args, env = {}) {
  return spawnSync(process.execPath, [
    provisionScriptPath,
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

async function runProvisionWithTemporaryEnv(args, overrides = {}, env = {}, environment = 'pre') {
  const directory = await mkdtemp(join(tmpdir(), `goods-comm-db-provision-smoke-${process.pid}-`))

  try {
    for (const targetEnvironment of ['pre', 'prod']) {
      await writeFile(
        join(directory, `.env.${targetEnvironment}`),
        applyEnvOverrides(await readFile(`.env.${targetEnvironment}`, 'utf8'), overrides[targetEnvironment] || {})
      )
    }

    return spawnSync(process.execPath, [
      provisionScriptPath,
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
  const directory = await mkdtemp(join(tmpdir(), `goods-comm-db-provision-pg-${process.pid}-`))
  const logPath = join(directory, 'queries.log')
  const modulePath = join(directory, 'fake-pg.mjs')

  await writeFile(logPath, '')
  await writeFile(modulePath, `
import { appendFileSync } from 'node:fs'

export class Client {
  constructor(options = {}) {
    this.connectionString = options.connectionString || ''
    this.role = this.connectionString.includes('postgres:admin-secret') ? 'admin' : 'app'
  }

  async connect() {
    this.log('connect')
  }

  async end() {
    this.log('end')
  }

  async query(sql, params = []) {
    const text = String(sql)
    this.log(text, params)

    if (text.includes('pg_roles') || text.includes('pg_database')) {
      return { rows: [] }
    }

    if (text.includes('current_database()')) {
      return {
        rows: [{
          database: this.connectionString.includes('prod') ? 'goods_comm_prod' : 'goods_comm_pre',
          username: this.connectionString.includes('prod') ? 'goods_comm_prod_app' : 'goods_comm_pre_app'
        }]
      }
    }

    return { rows: [], rowCount: 0 }
  }

  log(sql, params = []) {
    appendFileSync(process.env.GOODS_COMM_DB_PROVISION_FAKE_PG_LOG, \`\${this.role} \${sql} \${JSON.stringify(params)}\\n\`)
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
