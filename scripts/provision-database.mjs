import {
  containsPlaceholder,
  maskConnectionString,
  normalizeEnvironmentName,
  readEnvironmentFile
} from './env-files.mjs'

const execute = process.argv.includes('--execute')
const environment = getEnvironmentArg()
const values = await readEnvironmentFile(environment)
const databaseUrl = process.env.GOODS_COMM_DATABASE_URL || values.GOODS_COMM_DATABASE_URL || ''
const adminDatabaseUrl = process.env.GOODS_COMM_DATABASE_ADMIN_URL || values.GOODS_COMM_DATABASE_ADMIN_URL || ''
const rotatePassword = process.env.GOODS_COMM_DB_PROVISION_ROTATE_PASSWORD === 'true'
const target = parseDatabaseTarget(databaseUrl)

validateInputs()

if (!execute) {
  printPlan()
  process.exit(0)
}

if (process.env.GOODS_COMM_DB_PROVISION_CONFIRM !== `provision-${environment}`) {
  throw new Error(`Refusing to provision database without GOODS_COMM_DB_PROVISION_CONFIRM=provision-${environment}`)
}

if (environment === 'prod' && process.env.GOODS_COMM_DB_PROVISION_ALLOW_PROD !== 'true') {
  throw new Error('Refusing to provision prod database without GOODS_COMM_DB_PROVISION_ALLOW_PROD=true')
}

await provisionDatabase()

console.log(`Database provisioning completed for ${environment}: ${target.database}`)

function printPlan() {
  const prodOptIn = environment === 'prod' ? ' GOODS_COMM_DB_PROVISION_ALLOW_PROD=true' : ''

  console.log(`Database provisioning plan for ${environment}:`)
  console.log(`- Admin database: ${adminDatabaseUrl ? maskConnectionString(adminDatabaseUrl) : 'missing GOODS_COMM_DATABASE_ADMIN_URL'}`)
  console.log(`- Target database: ${maskConnectionString(databaseUrl)}`)
  console.log(`- Target database name: ${target.database || 'missing'}`)
  console.log(`- Application role: ${target.username || 'missing'}`)
  console.log('- Step 1: connect to the admin PostgreSQL/TencentDB database.')
  console.log('- Step 2: create the application role if it does not exist.')
  console.log('- Step 3: create the target database owned by the application role if it does not exist.')
  console.log('- Step 4: verify the application role can connect to the target database.')
  console.log('- Step 5: run db:migrate for this environment after provisioning completes.')
  console.log(`Run with --execute and GOODS_COMM_DB_PROVISION_CONFIRM=provision-${environment}${prodOptIn} after admin credentials are available.`)
}

async function provisionDatabase() {
  const Client = await loadPgClient()
  const adminClient = new Client({
    connectionString: adminDatabaseUrl,
    application_name: `goods-comm-provision-admin-${environment}`
  })

  await adminClient.connect()

  try {
    await ensureRole(adminClient)
    await ensureDatabase(adminClient)
  } finally {
    await adminClient.end()
  }

  const appClient = new Client({
    connectionString: databaseUrl,
    application_name: `goods-comm-provision-check-${environment}`
  })

  await appClient.connect()

  try {
    const result = await appClient.query('SELECT current_database() AS database, current_user AS username')
    const row = result.rows?.[0] || {}

    if (row.database && row.database !== target.database) {
      throw new Error(`Connected to database ${row.database}, expected ${target.database}`)
    }

    if (row.username && row.username !== target.username) {
      throw new Error(`Connected as role ${row.username}, expected ${target.username}`)
    }
  } finally {
    await appClient.end()
  }
}

async function ensureRole(client) {
  const existingRole = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [target.username])

  if (existingRole.rows?.length) {
    if (rotatePassword) {
      await client.query(`ALTER ROLE ${quoteIdentifier(target.username)} WITH LOGIN PASSWORD ${quoteLiteral(target.password)}`)
    }

    return
  }

  await client.query(`CREATE ROLE ${quoteIdentifier(target.username)} WITH LOGIN PASSWORD ${quoteLiteral(target.password)}`)
}

async function ensureDatabase(client) {
  const existingDatabase = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [target.database])

  if (existingDatabase.rows?.length) {
    return
  }

  await client.query(`CREATE DATABASE ${quoteIdentifier(target.database)} OWNER ${quoteIdentifier(target.username)} TEMPLATE template0 ENCODING 'UTF8'`)
}

async function loadPgClient() {
  const moduleName = process.env.GOODS_COMM_DB_PROVISION_PG_MODULE || 'pg'

  try {
    const pg = await import(moduleName)
    return pg.default?.Client || pg.Client
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('The pg package is required for --execute database provisioning; run npm install before provisioning')
    }

    throw error
  }
}

function validateInputs() {
  if (!databaseUrl) {
    throw new Error(`[${environment}] GOODS_COMM_DATABASE_URL is required`)
  }

  if (!target.valid) {
    throw new Error(`[${environment}] GOODS_COMM_DATABASE_URL is invalid: ${target.reason}`)
  }

  if (execute && containsPlaceholder(databaseUrl)) {
    throw new Error(`[${environment}] refusing to provision database while GOODS_COMM_DATABASE_URL still contains placeholders`)
  }

  if (execute && !adminDatabaseUrl) {
    throw new Error(`[${environment}] GOODS_COMM_DATABASE_ADMIN_URL is required for database provisioning`)
  }

  if (execute && containsPlaceholder(adminDatabaseUrl)) {
    throw new Error(`[${environment}] refusing to provision database while GOODS_COMM_DATABASE_ADMIN_URL still contains placeholders`)
  }

  if (execute && normalizeConnectionString(adminDatabaseUrl) === normalizeConnectionString(databaseUrl)) {
    throw new Error(`[${environment}] GOODS_COMM_DATABASE_ADMIN_URL must not be the same application connection as GOODS_COMM_DATABASE_URL`)
  }

  if (['pre', 'prod'].includes(environment) && values.GOODS_COMM_STATE_STORE !== 'postgres') {
    throw new Error(`[${environment}] GOODS_COMM_STATE_STORE must be postgres before database provisioning`)
  }

  if (['postgres', 'template0', 'template1'].includes(target.database)) {
    throw new Error(`[${environment}] refusing to provision protected PostgreSQL database ${target.database}`)
  }
}

function parseDatabaseTarget(value = '') {
  try {
    const url = new URL(value)
    const database = decodeURIComponent(url.pathname.replace(/^\//, '') || '')
    const username = decodeURIComponent(url.username || '')
    const password = decodeURIComponent(url.password || '')

    if (!/^postgres(ql)?:$/.test(url.protocol)) {
      return {
        valid: false,
        reason: `unsupported protocol ${url.protocol || 'empty'}`
      }
    }

    if (!url.hostname) {
      return {
        valid: false,
        reason: 'host is missing'
      }
    }

    if (!database) {
      return {
        valid: false,
        reason: 'database name is missing'
      }
    }

    if (!username) {
      return {
        valid: false,
        reason: 'application role is missing'
      }
    }

    if (!password) {
      return {
        valid: false,
        reason: 'application role password is missing'
      }
    }

    return {
      valid: true,
      database,
      username,
      password
    }
  } catch (error) {
    return {
      valid: false,
      reason: error.message
    }
  }
}

function quoteIdentifier(value = '') {
  return `"${String(value).replace(/"/g, '""')}"`
}

function quoteLiteral(value = '') {
  return `'${String(value).replace(/'/g, "''")}'`
}

function normalizeConnectionString(value = '') {
  return String(value || '').trim().replace(/\/$/, '')
}

function getEnvironmentArg() {
  const envIndex = process.argv.findIndex((arg) => arg === '--env')
  const value = envIndex >= 0
    ? process.argv[envIndex + 1]
    : process.argv.slice(2).find((arg) => !arg.startsWith('-'))

  return normalizeEnvironmentName(value || process.env.GOODS_COMM_ENV || 'pre')
}
