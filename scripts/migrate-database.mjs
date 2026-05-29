import { spawnSync } from 'node:child_process'
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

validateInputs()

if (!execute) {
  console.log(`Database migration plan for ${environment}:`)
  console.log(`- Target database: ${maskConnectionString(databaseUrl)}`)
  console.log(`- Schema file: ${schemaPath}`)
  console.log('- Command: psql "$GOODS_COMM_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/db/schema.sql')
  const prodOptIn = environment === 'prod' ? ' and GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true' : ''
  console.log(`Run with --execute and GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-${environment}${prodOptIn} after credentials and psql are available.`)
  process.exit(0)
}

if (process.env.GOODS_COMM_DB_MIGRATE_CONFIRM !== `migrate-${environment}`) {
  throw new Error(`Refusing to migrate without GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-${environment}`)
}

if (environment === 'prod' && process.env.GOODS_COMM_DB_MIGRATE_ALLOW_PROD !== 'true') {
  throw new Error('Refusing to migrate prod without GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true')
}

assertCommandAvailable('psql')
run('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', schemaPath])

console.log(`Database migration completed for ${environment}`)

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

function assertCommandAvailable(command) {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore'
  })

  if (result.error || result.status !== 0) {
    throw new Error(`${command} is required for --execute database migration`)
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
