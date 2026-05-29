import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isIP } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  containsPlaceholder,
  maskConnectionString,
  normalizeEnvironmentName,
  readEnvironmentFile
} from './env-files.mjs'

const execute = process.argv.includes('--execute')
const environment = getEnvironmentArg()
const requestedProvider = getArgValue('--provider') || 'auto'
const skipDatabaseMigration = process.argv.includes('--skip-db-migrate') || process.env.GOODS_COMM_DEPLOY_SKIP_DB_MIGRATE === 'true'
const skipDeployedHealthSmoke = process.argv.includes('--skip-deployed-health-smoke') || process.env.GOODS_COMM_DEPLOY_SKIP_DEPLOYED_HEALTH_SMOKE === 'true'
const runDeployedMainSmoke = process.argv.includes('--run-main-smoke') || process.env.GOODS_COMM_DEPLOY_RUN_MAIN_SMOKE === 'true'
const values = await readEnvironmentFile(environment)
const cloudbaseCommand = firstAvailableCommand(['cloudbase', 'tcb'])
const dockerCommand = firstAvailableCommand(['docker'])
const tccliCommand = firstAvailableCommand(['tccli'])
const provider = resolveProvider()
const plan = createPlan(provider)
const REAL_BACKEND_DEPLOY_KEYS = [
  'VITE_API_BASE_URL',
  'GOODS_COMM_ALLOWED_ORIGINS',
  'GOODS_COMM_PUBLIC_ASSET_BASE_URL',
  'GOODS_COMM_DATABASE_URL',
  'GOODS_COMM_COS_BUCKET',
  'GOODS_COMM_COS_REGION',
  'GOODS_COMM_COS_SECRET_ID',
  'GOODS_COMM_COS_SECRET_KEY',
  'GOODS_COMM_COS_BASE_URL',
  'GOODS_COMM_CDN_BASE_URL',
  'GOODS_COMM_MAP_REGION_DATASET',
  'GOODS_COMM_TENCENT_MAP_KEY',
  'GOODS_COMM_MODERATION_WEBHOOK_SECRET',
  'GOODS_COMM_SESSION_SECRET',
  'GOODS_COMM_OPS_SESSION_SECRET',
  'GOODS_COMM_OPS_ACCOUNTS',
  'GOODS_COMM_TRUSTED_PROXY_IPS',
  'GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_IDS',
  'GOODS_COMM_WECHAT_APP_ID',
  'GOODS_COMM_WECHAT_APP_SECRET',
  'GOODS_COMM_ALIPAY_APP_ID',
  'GOODS_COMM_ALIPAY_PRIVATE_KEY'
]
const missing = findMissingPreconditions(provider)

if (!execute) {
  printPlan()
  process.exit(0)
}

if (process.env.GOODS_COMM_DEPLOY_CONFIRM !== `deploy-${environment}`) {
  throw new Error(`Refusing to deploy without GOODS_COMM_DEPLOY_CONFIRM=deploy-${environment}`)
}

if (missing.length) {
  throw new Error(`Cannot deploy ${environment}: ${missing.join('; ')}`)
}

run('npm', ['run', `env:check:${environment}`])
run('npm', ['run', 'build:backend'])
run('npm', ['run', 'smoke:backend:artifact'])

if (!skipDatabaseMigration) {
  run(process.execPath, ['scripts/migrate-database.mjs', '--env', environment, '--execute'])
}

if (provider === 'cloudbase') {
  loginCloudBaseIfConfigured()
  run(cloudbaseCommand, [
    'framework',
    'deploy',
    '--verbose',
    '--config',
    'backend/deploy/cloudbase.json',
    '--envId',
    values.GOODS_COMM_CLOUDBASE_ENV_ID
  ])
} else {
  run(dockerCommand, [
    'build',
    '-f',
    'backend/deploy/Dockerfile',
    '-t',
    values.GOODS_COMM_TENCENT_CONTAINER_IMAGE,
    'dist/backend'
  ])
  run(dockerCommand, ['push', values.GOODS_COMM_TENCENT_CONTAINER_IMAGE])
  run(tccliCommand, [
    'tem',
    'DeployApplication',
    '--Region',
    values.GOODS_COMM_TENCENT_REGION,
    '--ApplicationId',
    values.GOODS_COMM_TENCENT_CLOUD_RUN_SERVICE,
    '--DeployVersion',
    `${environment}-${Date.now()}`,
    '--ImgRepo',
    values.GOODS_COMM_TENCENT_CONTAINER_IMAGE
  ])
}

if (!skipDeployedHealthSmoke) {
  run(process.execPath, ['scripts/deployed-health-smoke.mjs', '--env', environment])
}

if (runDeployedMainSmoke) {
  run(process.execPath, ['scripts/deployed-main-flow-smoke.mjs', '--env', environment])
}

console.log(`Backend deploy command completed for ${environment} via ${provider}`)

function createPlan(targetProvider) {
  const lines = [
    `1. Validate .env.${environment} with npm run env:check:${environment}.`,
    '2. Build dist/backend with npm run build:backend.',
    '3. Verify dist/backend with npm run smoke:backend:artifact.',
    skipDatabaseMigration
      ? '4. Skip database migration because --skip-db-migrate or GOODS_COMM_DEPLOY_SKIP_DB_MIGRATE=true was provided.'
      : `4. Apply database schema with GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-${environment} node scripts/migrate-database.mjs --env ${environment} --execute.`,
    `5. Deploy provider: ${targetProvider}.`
  ]

  if (targetProvider === 'cloudbase') {
    lines.push(`6. Run CloudBase Framework deploy to env ${values.GOODS_COMM_CLOUDBASE_ENV_ID || 'missing'}.`)
  } else {
    lines.push(`6. Build and push container image ${values.GOODS_COMM_TENCENT_CONTAINER_IMAGE || 'missing'}.`)
    lines.push(`7. Ask Tencent CLI to deploy service ${values.GOODS_COMM_TENCENT_CLOUD_RUN_SERVICE || 'missing'} in ${values.GOODS_COMM_TENCENT_REGION || 'missing'}.`)
  }

  if (skipDeployedHealthSmoke) {
    lines.push('8. Skip deployed health smoke because --skip-deployed-health-smoke or GOODS_COMM_DEPLOY_SKIP_DEPLOYED_HEALTH_SMOKE=true was provided.')
  } else {
    lines.push(`8. Run deployed health smoke with node scripts/deployed-health-smoke.mjs --env ${environment}.`)
  }

  if (runDeployedMainSmoke) {
    lines.push(`9. Run deployed main-flow smoke with node scripts/deployed-main-flow-smoke.mjs --env ${environment}.`)
  } else {
    lines.push('9. Main-flow deployed smoke is optional here; enable it with --run-main-smoke or GOODS_COMM_DEPLOY_RUN_MAIN_SMOKE=true after providing seller/buyer codes and coordinates.')
  }

  return lines
}

function printPlan() {
  console.log(`Backend deployment plan for ${environment}:`)
  for (const step of plan) {
    console.log(`- ${step}`)
  }
  console.log(`Provider: ${provider}`)
  console.log(`Database: ${maskConnectionString(values.GOODS_COMM_DATABASE_URL || '')}`)

  if (missing.length) {
    console.log('Missing preconditions:')
    for (const item of missing) {
      console.log(`- ${item}`)
    }
  } else {
    const migrationConfirm = skipDatabaseMigration ? '' : `GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-${environment} `
    const mainSmokeFlag = runDeployedMainSmoke ? ' with deployed main-flow smoke' : ''
    console.log(`Ready to execute${mainSmokeFlag} with ${migrationConfirm}GOODS_COMM_DEPLOY_CONFIRM=deploy-${environment} and --execute.`)
  }
}

function resolveProvider() {
  if (['cloudbase', 'tencent'].includes(requestedProvider)) {
    return requestedProvider
  }

  if (!containsPlaceholder(values.GOODS_COMM_CLOUDBASE_ENV_ID || '')) {
    return 'cloudbase'
  }

  return 'tencent'
}

function findMissingPreconditions(targetProvider) {
  const missingItems = []

  for (const key of REAL_BACKEND_DEPLOY_KEYS) {
    if (!values[key] || containsPlaceholder(values[key])) {
      missingItems.push(`[${environment}] ${key} must be real before deploy`)
    }
  }

  const regionDataset = parseRegionDatasetSetting(values.GOODS_COMM_MAP_REGION_DATASET)
  if (!regionDataset.valid) {
    missingItems.push(`[${environment}] GOODS_COMM_MAP_REGION_DATASET must be a non-empty JSON array before deploy: ${regionDataset.reason}`)
  }

  if (values.GOODS_COMM_TRUSTED_PROXY_IPS && !containsPlaceholder(values.GOODS_COMM_TRUSTED_PROXY_IPS)) {
    const trustedProxyList = parseTrustedProxyListSetting(values.GOODS_COMM_TRUSTED_PROXY_IPS)
    if (!trustedProxyList.valid) {
      missingItems.push(`[${environment}] GOODS_COMM_TRUSTED_PROXY_IPS must be "none" or a comma-separated list of IPs/IPv4 CIDRs before deploy: ${trustedProxyList.reason}`)
    }
  }

  if (!skipDatabaseMigration) {
    if (process.env.GOODS_COMM_DB_MIGRATE_CONFIRM !== `migrate-${environment}`) {
      missingItems.push(`GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-${environment} is required because backend deploy applies database migration before starting the new backend`)
    }

    if (!commandAvailable('psql')) {
      missingItems.push('psql is required because backend deploy applies database migration before starting the new backend')
    }
  }

  if (runDeployedMainSmoke) {
    for (const key of [
      'GOODS_COMM_SMOKE_SELLER_CODE',
      'GOODS_COMM_SMOKE_BUYER_CODE',
      'GOODS_COMM_SMOKE_LATITUDE',
      'GOODS_COMM_SMOKE_LONGITUDE'
    ]) {
      if (!process.env[key]) {
        missingItems.push(`${key} is required when --run-main-smoke or GOODS_COMM_DEPLOY_RUN_MAIN_SMOKE=true is set`)
      }
    }

    if (environment === 'prod' && process.env.GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION !== 'true') {
      missingItems.push('GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION=true is required when running prod main-flow smoke')
    }
  }

  if (targetProvider === 'cloudbase') {
    if (!values.GOODS_COMM_CLOUDBASE_ENV_ID || containsPlaceholder(values.GOODS_COMM_CLOUDBASE_ENV_ID)) {
      missingItems.push(`[${environment}] GOODS_COMM_CLOUDBASE_ENV_ID must be real for WeChat CloudBase deploy`)
    }

    if (!cloudbaseCommand) {
      missingItems.push('cloudbase or tcb CLI is required for WeChat CloudBase deploy')
    }

    if (!hasTencentCloudApiCredential() && process.env.GOODS_COMM_DEPLOY_ALLOW_EXISTING_CLOUDBASE_LOGIN !== 'true') {
      missingItems.push('TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY are required for non-interactive CloudBase deploy; set GOODS_COMM_DEPLOY_ALLOW_EXISTING_CLOUDBASE_LOGIN=true only when the runner is already logged in')
    }
  } else {
    for (const key of [
      'GOODS_COMM_TENCENT_REGION',
      'GOODS_COMM_TENCENT_CLOUD_RUN_SERVICE',
      'GOODS_COMM_TENCENT_CONTAINER_IMAGE'
    ]) {
      if (!values[key] || containsPlaceholder(values[key])) {
        missingItems.push(`[${environment}] ${key} must be real for Tencent Cloud fallback deploy`)
      }
    }

    if (!dockerCommand) {
      missingItems.push('docker is required for Tencent Cloud fallback deploy')
    }

    if (!tccliCommand) {
      missingItems.push('tccli is required for Tencent Cloud fallback deploy')
    }

    if (!hasTencentCloudApiCredential() && !hasTccliCredentialFiles()) {
      missingItems.push('TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY or an existing ~/.tccli credential are required for Tencent Cloud fallback deploy')
    }
  }

  return missingItems
}

function loginCloudBaseIfConfigured() {
  const credential = getTencentCloudCredential()

  if (!credential.secretId || !credential.secretKey) {
    return
  }

  const args = [
    'login',
    '--apiKeyId',
    credential.secretId,
    '--apiKey',
    credential.secretKey
  ]

  if (credential.token) {
    args.push('--token', credential.token)
  }

  run(cloudbaseCommand, args)
}

function getEnvironmentArg() {
  const value = getArgValue('--env') || process.env.GOODS_COMM_ENV || 'pre'
  return normalizeEnvironmentName(value)
}

function getArgValue(name) {
  const index = process.argv.findIndex((arg) => arg === name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function firstAvailableCommand(commands) {
  for (const command of commands) {
    if (commandAvailable(command)) {
      return command
    }
  }

  return ''
}

function commandAvailable(command) {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore'
  })

  return !result.error && result.status === 0
}

function hasTencentCloudApiCredential() {
  const credential = getTencentCloudCredential()
  return Boolean(credential.secretId && credential.secretKey)
}

function getTencentCloudCredential() {
  return {
    secretId: process.env.TENCENTCLOUD_SECRET_ID || process.env.TENCENTCLOUD_SECRETID || '',
    secretKey: process.env.TENCENTCLOUD_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY || '',
    token: process.env.TENCENTCLOUD_SESSION_TOKEN || process.env.TENCENTCLOUD_SESSIONTOKEN || ''
  }
}

function hasTccliCredentialFiles() {
  const tccliDir = join(homedir(), '.tccli')
  return existsSync(join(tccliDir, 'default.credential')) && existsSync(join(tccliDir, 'default.configure'))
}

function parseRegionDatasetSetting(value = '') {
  const raw = String(value || '').trim()

  if (!raw) {
    return {
      valid: false,
      reason: 'value is empty'
    }
  }

  if (containsPlaceholder(raw)) {
    return {
      valid: false,
      reason: 'value still contains a placeholder'
    }
  }

  if (!raw.startsWith('[')) {
    return {
      valid: false,
      reason: 'value must be JSON array text, not a dataset label'
    }
  }

  try {
    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return {
        valid: false,
        reason: 'JSON value is not an array'
      }
    }

    if (!parsed.length) {
      return {
        valid: false,
        reason: 'array is empty'
      }
    }

    const invalidIndex = parsed.findIndex((entry) =>
      !entry ||
      typeof entry !== 'object' ||
      (!entry.adcode && !entry.streetName) ||
      (!entry.communityId && !entry.streetId)
    )

    if (invalidIndex >= 0) {
      return {
        valid: false,
        reason: `entry ${invalidIndex + 1} must include adcode or streetName plus communityId or streetId`
      }
    }

    return {
      valid: true,
      reason: ''
    }
  } catch (error) {
    return {
      valid: false,
      reason: 'value is not valid JSON'
    }
  }
}

function parseTrustedProxyListSetting(value = '') {
  const normalized = String(value || '').trim()

  if (!normalized || normalized.toLowerCase() === 'none') {
    return {
      valid: true,
      reason: ''
    }
  }

  if (containsPlaceholder(normalized)) {
    return {
      valid: false,
      reason: 'value still contains a placeholder'
    }
  }

  const entries = normalized.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const invalid = entries.find((entry) => !isTrustedProxyEntry(entry))

  if (invalid) {
    return {
      valid: false,
      reason: `invalid entry ${invalid}`
    }
  }

  return {
    valid: true,
    reason: ''
  }
}

function isTrustedProxyEntry(value = '') {
  if (value.includes('/')) {
    const [ip, prefixValue] = value.split('/')
    const prefix = Number(prefixValue)

    return ipv4ToNumber(ip) !== null && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32
  }

  return isIP(normalizeIpAddress(value)) !== 0
}

function normalizeIpAddress(value = '') {
  const normalized = String(value || '').trim()

  if (!normalized) {
    return ''
  }

  return normalized.startsWith('::ffff:')
    ? normalized.slice('::ffff:'.length)
    : normalized
}

function ipv4ToNumber(value = '') {
  const parts = String(value || '').trim().split('.')

  if (parts.length !== 4) {
    return null
  }

  let result = 0

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null
    }

    const octet = Number(part)

    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null
    }

    result = ((result << 8) | octet) >>> 0
  }

  return result
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
