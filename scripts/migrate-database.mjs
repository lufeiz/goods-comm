import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  containsPlaceholder,
  maskConnectionString,
  normalizeEnvironmentName,
  readEnvironmentFile
} from './env-files.mjs'

const execute = process.argv.includes('--execute')
const environment = getEnvironmentArg()
const values = await readEnvironmentFile(environment)
const databaseUrl = values.GOODS_COMM_DATABASE_URL
const schemaPath = resolve('backend/db/schema.sql')
const schemaSql = await readFile(schemaPath, 'utf8')

validateInputs()

if (!execute) {
  console.log(`Database migration plan for ${environment}:`)
  console.log(`- Target database: ${maskConnectionString(databaseUrl)}`)
  console.log(`- Schema file: ${schemaPath}`)
  console.log('- Executor: Node pg client using backend/db/schema.sql inside one transaction')
  const prodOptIn = environment === 'prod' ? ' and GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true' : ''
  console.log(`Run with --execute and GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-${environment}${prodOptIn} after database credentials are available.`)
  process.exit(0)
}

if (process.env.GOODS_COMM_DB_MIGRATE_CONFIRM !== `migrate-${environment}`) {
  throw new Error(`Refusing to migrate without GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-${environment}`)
}

if (environment === 'prod' && process.env.GOODS_COMM_DB_MIGRATE_ALLOW_PROD !== 'true') {
  throw new Error('Refusing to migrate prod without GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true')
}

await runMigration()

console.log(`Database migration completed for ${environment}`)

async function runMigration() {
  const { Client } = await loadPgClient()
  const client = new Client({
    connectionString: databaseUrl,
    application_name: `goods-comm-migrate-${environment}`
  })

  await client.connect()

  try {
    await client.query('BEGIN')
    await client.query(schemaSql)
    await client.query('COMMIT')
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Keep the original migration error; rollback failure is secondary here.
    }

    throw error
  } finally {
    await client.end()
  }
}

async function loadPgClient() {
  try {
    const pg = await import('pg')
    return pg.default?.Client || pg.Client
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('The pg package is required for --execute database migration; run npm install before migrating')
    }

    throw error
  }
}

function validateInputs() {
  if (!databaseUrl) {
    throw new Error(`[${environment}] GOODS_COMM_DATABASE_URL is required`)
  }

  if (execute && containsPlaceholder(databaseUrl)) {
    throw new Error(`[${environment}] refusing to execute migration while GOODS_COMM_DATABASE_URL still contains placeholders`)
  }

  if (['pre', 'prod'].includes(environment) && values.GOODS_COMM_STATE_STORE !== 'postgres') {
    throw new Error(`[${environment}] GOODS_COMM_STATE_STORE must be postgres before database migration`)
  }
}

function getEnvironmentArg() {
  const envIndex = process.argv.findIndex((arg) => arg === '--env')
  const value = envIndex >= 0 ? process.argv[envIndex + 1] : process.argv[2]

  return normalizeEnvironmentName(value || process.env.GOODS_COMM_ENV || 'pre')
}
