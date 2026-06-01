import assert from 'node:assert/strict'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  envLocalFilePath,
  maskConnectionString,
  normalizeEnvironmentName,
  parseEnvFile,
  smokeEnvLocalFilePath
} from './env-files.mjs'

const PROTECTED_ENVIRONMENTS = ['pre', 'prod']
const SELF_TEST = process.argv.includes('--self-test')
const CHECK_ONLY = process.argv.includes('--check-only')
const environments = getRequestedEnvironments()
const outputPath = getArgValue('--output')
const jsonOutputPath = getArgValue('--json-output') || defaultJsonOutputPath(outputPath)

const PROTECTED_REQUIRED_KEYS = [
  'VITE_API_BASE_URL',
  'GOODS_COMM_CLOUDBASE_ENV_ID',
  'GOODS_COMM_TENCENT_REGION',
  'GOODS_COMM_TENCENT_CLOUD_RUN_SERVICE',
  'GOODS_COMM_TENCENT_CONTAINER_IMAGE',
  'GOODS_COMM_ALLOWED_ORIGINS',
  'GOODS_COMM_DATABASE_URL',
  'GOODS_COMM_DATABASE_ADMIN_URL',
  'GOODS_COMM_DATABASE_SCHEMA',
  'GOODS_COMM_STATE_STORE',
  'GOODS_COMM_POSTGRES_AUTO_SCHEMA',
  'GOODS_COMM_OBJECT_STORE',
  'GOODS_COMM_PUBLIC_ASSET_BASE_URL',
  'GOODS_COMM_COS_BUCKET',
  'GOODS_COMM_COS_REGION',
  'GOODS_COMM_COS_SECRET_ID',
  'GOODS_COMM_COS_SECRET_KEY',
  'GOODS_COMM_COS_BASE_URL',
  'GOODS_COMM_CDN_BASE_URL',
  'GOODS_COMM_MAP_PROVIDER',
  'GOODS_COMM_TENCENT_MAP_KEY',
  'GOODS_COMM_MAP_REGION_DATASET',
  'GOODS_COMM_CONTENT_SECURITY_PROVIDER',
  'GOODS_COMM_MODERATION_WEBHOOK_SECRET',
  'GOODS_COMM_SESSION_SECRET',
  'GOODS_COMM_OPS_SESSION_SECRET',
  'GOODS_COMM_OPS_ACCOUNTS',
  'GOODS_COMM_TRUSTED_PROXY_IPS',
  'GOODS_COMM_ALERT_PROVIDER',
  'GOODS_COMM_ALERT_WEBHOOK_URL',
  'GOODS_COMM_ALERT_WEBHOOK_TOKEN',
  'GOODS_COMM_ACCESS_LOG_ENABLED',
  'GOODS_COMM_PLATFORM_AUTH_MODE',
  'GOODS_COMM_WECHAT_APP_ID',
  'GOODS_COMM_WECHAT_APP_SECRET',
  'GOODS_COMM_ALIPAY_APP_ID',
  'GOODS_COMM_ALIPAY_PRIVATE_KEY',
  'GOODS_COMM_PLATFORM_NOTIFY_PROVIDER',
  'GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_IDS'
]

const PROTECTED_REAL_VALUE_KEYS = [
  'VITE_API_BASE_URL',
  'GOODS_COMM_CLOUDBASE_ENV_ID',
  'GOODS_COMM_TENCENT_CLOUD_RUN_SERVICE',
  'GOODS_COMM_TENCENT_CONTAINER_IMAGE',
  'GOODS_COMM_ALLOWED_ORIGINS',
  'GOODS_COMM_DATABASE_URL',
  'GOODS_COMM_DATABASE_ADMIN_URL',
  'GOODS_COMM_PUBLIC_ASSET_BASE_URL',
  'GOODS_COMM_COS_BUCKET',
  'GOODS_COMM_COS_SECRET_ID',
  'GOODS_COMM_COS_SECRET_KEY',
  'GOODS_COMM_COS_BASE_URL',
  'GOODS_COMM_CDN_BASE_URL',
  'GOODS_COMM_TENCENT_MAP_KEY',
  'GOODS_COMM_MAP_REGION_DATASET',
  'GOODS_COMM_MODERATION_WEBHOOK_SECRET',
  'GOODS_COMM_SESSION_SECRET',
  'GOODS_COMM_OPS_SESSION_SECRET',
  'GOODS_COMM_OPS_ACCOUNTS',
  'GOODS_COMM_TRUSTED_PROXY_IPS',
  'GOODS_COMM_ALERT_WEBHOOK_URL',
  'GOODS_COMM_ALERT_WEBHOOK_TOKEN',
  'GOODS_COMM_WECHAT_APP_ID',
  'GOODS_COMM_WECHAT_APP_SECRET',
  'GOODS_COMM_ALIPAY_APP_ID',
  'GOODS_COMM_ALIPAY_PRIVATE_KEY',
  'GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_IDS'
]

const PRODUCTION_EXPECTATIONS = {
  GOODS_COMM_STATE_STORE: 'postgres',
  GOODS_COMM_POSTGRES_AUTO_SCHEMA: 'false',
  GOODS_COMM_OBJECT_STORE: 'cos',
  GOODS_COMM_MAP_PROVIDER: 'tencent',
  GOODS_COMM_CONTENT_SECURITY_PROVIDER: 'wechat',
  GOODS_COMM_ALERT_PROVIDER: 'webhook',
  GOODS_COMM_ACCESS_LOG_ENABLED: 'true',
  GOODS_COMM_PLATFORM_AUTH_MODE: 'platform',
  GOODS_COMM_PLATFORM_NOTIFY_PROVIDER: 'wechat'
}

const SMOKE_REQUIRED_KEYS = [
  'GOODS_COMM_SMOKE_API_BASE_URL',
  'GOODS_COMM_SMOKE_SELLER_PROVIDER',
  'GOODS_COMM_SMOKE_SELLER_CODE',
  'GOODS_COMM_SMOKE_BUYER_PROVIDER',
  'GOODS_COMM_SMOKE_BUYER_CODE',
  'GOODS_COMM_SMOKE_LATITUDE',
  'GOODS_COMM_SMOKE_LONGITUDE',
  'GOODS_COMM_SMOKE_ACCURACY',
  'GOODS_COMM_SMOKE_SCOPE_TYPE',
  'GOODS_COMM_SMOKE_RADIUS_METERS',
  'GOODS_COMM_SMOKE_HEALTH_ATTEMPTS',
  'GOODS_COMM_SMOKE_HEALTH_INTERVAL_MS'
]

const SMOKE_OPTIONAL_KEYS = [
  'GOODS_COMM_SMOKE_RUN_ID',
  'GOODS_COMM_SMOKE_APPROVED_IMAGE_URL',
  'GOODS_COMM_SMOKE_APPROVED_IMAGE_STORAGE_KEY',
  'GOODS_COMM_SMOKE_APPROVED_IMAGE_SIZE',
  'GOODS_COMM_SMOKE_APPROVED_IMAGE_MIME_TYPE',
  'GOODS_COMM_SMOKE_APPROVED_IMAGE_CHECKSUM',
  'GOODS_COMM_SMOKE_ACCOUNT_DELETE_PROVIDER',
  'GOODS_COMM_SMOKE_ACCOUNT_DELETE_CODE',
  'GOODS_COMM_SMOKE_ACCOUNT_DELETE_RELOGIN_CODE',
  'GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION'
]

const REQUIRED_CI_SECRET_KEYS = [
  'TENCENTCLOUD_SECRET_ID',
  'TENCENTCLOUD_SECRET_KEY'
]

const OPTIONAL_CI_SECRET_KEYS = [
  'TENCENTCLOUD_SESSION_TOKEN',
  'GOODS_COMM_WECHAT_DEVTOOLS_CLI',
  'GOODS_COMM_ALIPAY_MINI_CLI'
]

if (SELF_TEST) {
  runSelfTest()
  console.log('Release input check self-test passed')
} else {
  const sourceBundle = await readReleaseInputSources(environments, process.env)
  const report = buildReleaseInputsReport(sourceBundle, process.env)
  const renderedReport = renderReport(report)

  await writeOptionalReport(outputPath, renderedReport)
  await writeOptionalReport(jsonOutputPath, `${JSON.stringify(createMachineReadableReport(report), null, 2)}\n`)
  console.log(renderedReport)

  if (CHECK_ONLY && report.blockerCount > 0) {
    process.exitCode = 1
  }
}

async function readReleaseInputSources(targetEnvironments, runtimeEnv) {
  const protectedSources = new Map()
  const smokeSources = new Map()

  for (const environment of targetEnvironments) {
    protectedSources.set(environment, await readProtectedEnvironmentSource(environment, runtimeEnv))
    smokeSources.set(environment, await readSmokeInputSource(environment, runtimeEnv))
  }

  return {
    environments: targetEnvironments,
    protectedSources,
    smokeSources
  }
}

async function readProtectedEnvironmentSource(environment, runtimeEnv) {
  const basePath = resolve(process.cwd(), `.env.${environment}`)
  const baseValues = await readOptionalEnvFile(basePath)
  const localPath = envLocalFilePath(environment)
  const localValues = await readOptionalEnvFile(localPath)
  const multilineKey = `GOODS_COMM_${environment.toUpperCase()}_ENV_LOCAL`
  const multilineValues = parseOptionalEnvBlock(runtimeEnv[multilineKey])
  const directValues = pickRuntimeValues(runtimeEnv, PROTECTED_REQUIRED_KEYS)
  const sources = [`.env.${environment}`]

  if (Object.keys(localValues).length) {
    sources.push(`.env.${environment}.local`)
  }

  if (Object.keys(multilineValues).length) {
    sources.push(`$${multilineKey}`)
  }

  if (Object.keys(directValues).length) {
    sources.push(`shell env (${Object.keys(directValues).length} keys)`)
  }

  return {
    environment,
    values: {
      ...baseValues,
      ...localValues,
      ...multilineValues,
      ...directValues
    },
    sources,
    hasOverride: Object.keys(localValues).length > 0 ||
      Object.keys(multilineValues).length > 0 ||
      Object.keys(directValues).length > 0,
    expectedLocalPath: `.env.${environment}.local`,
    expectedMultilineSecret: multilineKey
  }
}

async function readSmokeInputSource(environment, runtimeEnv) {
  const localValues = await readOptionalEnvFile(smokeEnvLocalFilePath(environment))
  const multilineKey = `GOODS_COMM_${environment.toUpperCase()}_SMOKE_ENV_LOCAL`
  const multilineValues = parseOptionalEnvBlock(runtimeEnv[multilineKey])
  const directValues = pickRuntimeValues(runtimeEnv, [...SMOKE_REQUIRED_KEYS, ...SMOKE_OPTIONAL_KEYS])
  const sources = []

  if (Object.keys(localValues).length) {
    sources.push(`.env.smoke.${environment}.local`)
  }

  if (Object.keys(multilineValues).length) {
    sources.push(`$${multilineKey}`)
  }

  if (Object.keys(directValues).length) {
    sources.push(`shell env (${Object.keys(directValues).length} keys)`)
  }

  return {
    environment,
    values: {
      ...localValues,
      ...multilineValues,
      ...directValues
    },
    sources,
    hasOverride: sources.length > 0,
    expectedLocalPath: `.env.smoke.${environment}.local`,
    expectedMultilineSecret: multilineKey
  }
}

async function readOptionalEnvFile(filePath) {
  try {
    await access(filePath)
    return parseEnvFile(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {}
    }

    throw error
  }
}

function parseOptionalEnvBlock(raw = '') {
  if (!String(raw || '').trim()) {
    return {}
  }

  return parseEnvFile(raw)
}

function pickRuntimeValues(runtimeEnv, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => runtimeEnv[key] !== undefined && runtimeEnv[key] !== '')
      .map((key) => [key, runtimeEnv[key]])
  )
}

function buildReleaseInputsReport(sourceBundle, runtimeEnv) {
  const protectedReports = sourceBundle.environments.map((environment) =>
    evaluateProtectedEnvironment(sourceBundle.protectedSources.get(environment))
  )
  const smokeReports = sourceBundle.environments.map((environment) =>
    evaluateSmokeInputs(sourceBundle.smokeSources.get(environment))
  )
  const crossEnvironmentReport = evaluateCrossEnvironment(sourceBundle.protectedSources)
  const ciReport = evaluateCiInputs(runtimeEnv)
  const groups = [
    ...protectedReports,
    ...smokeReports,
    crossEnvironmentReport,
    ciReport
  ]
  const blockerCount = groups.reduce((total, group) => total + group.blockers.length, 0)
  const warningCount = groups.reduce((total, group) => total + group.warnings.length, 0)

  return {
    status: blockerCount > 0 ? 'BLOCKED' : 'PASS',
    blockerCount,
    warningCount,
    protectedReports,
    smokeReports,
    crossEnvironmentReport,
    ciReport
  }
}

function evaluateProtectedEnvironment(source) {
  const blockers = []
  const warnings = []
  const passes = []
  const values = source.values || {}
  const missingKeys = PROTECTED_REQUIRED_KEYS.filter((key) => !values[key])
  const placeholderKeys = PROTECTED_REAL_VALUE_KEYS.filter((key) => values[key] && !hasRealReleaseValue(values[key]))

  if (!source.hasOverride) {
    blockers.push(`[${source.environment}] no protected override source loaded; create ${source.expectedLocalPath} or set ${source.expectedMultilineSecret}`)
  }

  if (missingKeys.length) {
    blockers.push(`[${source.environment}] missing protected runtime keys: ${missingKeys.join(', ')}`)
  }

  if (placeholderKeys.length) {
    blockers.push(`[${source.environment}] protected runtime values still look like placeholders: ${placeholderKeys.join(', ')}`)
  }

  for (const [key, expected] of Object.entries(PRODUCTION_EXPECTATIONS)) {
    if (values[key] !== expected) {
      blockers.push(`[${source.environment}] ${key} must be ${expected}`)
    }
  }

  if (values.VITE_API_BASE_URL && !startsWithHttps(values.VITE_API_BASE_URL)) {
    blockers.push(`[${source.environment}] VITE_API_BASE_URL must be HTTPS`)
  }

  if (values.GOODS_COMM_ALLOWED_ORIGINS && !allOriginsAreHttps(values.GOODS_COMM_ALLOWED_ORIGINS)) {
    blockers.push(`[${source.environment}] GOODS_COMM_ALLOWED_ORIGINS must contain only HTTPS origins`)
  }

  if (hasRealReleaseValue(values.GOODS_COMM_DATABASE_URL) && !isPostgresConnectionString(values.GOODS_COMM_DATABASE_URL)) {
    blockers.push(`[${source.environment}] GOODS_COMM_DATABASE_URL must be a PostgreSQL connection string`)
  }

  if (hasRealReleaseValue(values.GOODS_COMM_DATABASE_ADMIN_URL) && !isPostgresConnectionString(values.GOODS_COMM_DATABASE_ADMIN_URL)) {
    blockers.push(`[${source.environment}] GOODS_COMM_DATABASE_ADMIN_URL must be a PostgreSQL connection string`)
  }

  if (
    hasRealReleaseValue(values.GOODS_COMM_DATABASE_URL) &&
    hasRealReleaseValue(values.GOODS_COMM_DATABASE_ADMIN_URL) &&
    normalizeConnectionString(values.GOODS_COMM_DATABASE_URL) === normalizeConnectionString(values.GOODS_COMM_DATABASE_ADMIN_URL)
  ) {
    blockers.push(`[${source.environment}] GOODS_COMM_DATABASE_ADMIN_URL must not equal GOODS_COMM_DATABASE_URL`)
  }

  const regionDataset = parseRegionDataset(values.GOODS_COMM_MAP_REGION_DATASET)
  if (!regionDataset.valid) {
    blockers.push(`[${source.environment}] GOODS_COMM_MAP_REGION_DATASET must be a non-empty JSON array: ${regionDataset.reason}`)
  } else {
    passes.push(`[${source.environment}] region dataset includes ${regionDataset.count} mappings`)
  }

  for (const key of ['GOODS_COMM_SESSION_SECRET', 'GOODS_COMM_OPS_SESSION_SECRET']) {
    if (hasRealReleaseValue(values[key]) && String(values[key]).length < 32) {
      blockers.push(`[${source.environment}] ${key} should be at least 32 characters`)
    }
  }

  if (source.environment === 'pre' && values.GOODS_COMM_ACCEPTS_PROD_SYNC !== 'true') {
    blockers.push('[pre] GOODS_COMM_ACCEPTS_PROD_SYNC=true is required for prod-to-pre sync')
  }

  if (source.environment === 'prod' && values.GOODS_COMM_PROD_SYNC_EXPORT !== 'true') {
    blockers.push('[prod] GOODS_COMM_PROD_SYNC_EXPORT=true is required for prod-to-pre sync export')
  }

  if (!blockers.length) {
    passes.push(`[${source.environment}] protected runtime input bundle is complete`)
  }

  if (!source.sources.some((item) => item.includes('.local') || item.startsWith('$') || item.startsWith('shell env'))) {
    warnings.push(`[${source.environment}] only committed .env.${source.environment} was loaded`)
  }

  return {
    label: `Protected env ${source.environment}`,
    sources: source.sources,
    blockers,
    warnings,
    passes
  }
}

function evaluateSmokeInputs(source) {
  const blockers = []
  const warnings = []
  const passes = []
  const values = source.values || {}
  const missingKeys = SMOKE_REQUIRED_KEYS.filter((key) => !values[key])
  const placeholderKeys = SMOKE_REQUIRED_KEYS.filter((key) => values[key] && !hasRealReleaseValue(values[key]))

  if (!source.hasOverride) {
    blockers.push(`[${source.environment}] no deployed smoke input source loaded; create ${source.expectedLocalPath} or set ${source.expectedMultilineSecret}`)
  }

  if (missingKeys.length) {
    blockers.push(`[${source.environment}] missing deployed smoke keys: ${missingKeys.join(', ')}`)
  }

  if (placeholderKeys.length) {
    blockers.push(`[${source.environment}] deployed smoke values still look like placeholders: ${placeholderKeys.join(', ')}`)
  }

  if (values.GOODS_COMM_SMOKE_API_BASE_URL && !startsWithHttps(values.GOODS_COMM_SMOKE_API_BASE_URL)) {
    blockers.push(`[${source.environment}] GOODS_COMM_SMOKE_API_BASE_URL must be HTTPS`)
  }

  validateProvider(values.GOODS_COMM_SMOKE_SELLER_PROVIDER, `[${source.environment}] GOODS_COMM_SMOKE_SELLER_PROVIDER`, blockers)
  validateProvider(values.GOODS_COMM_SMOKE_BUYER_PROVIDER, `[${source.environment}] GOODS_COMM_SMOKE_BUYER_PROVIDER`, blockers)
  validateCoordinate(values.GOODS_COMM_SMOKE_LATITUDE, -90, 90, `[${source.environment}] GOODS_COMM_SMOKE_LATITUDE`, blockers)
  validateCoordinate(values.GOODS_COMM_SMOKE_LONGITUDE, -180, 180, `[${source.environment}] GOODS_COMM_SMOKE_LONGITUDE`, blockers)
  validatePositiveNumber(values.GOODS_COMM_SMOKE_ACCURACY, `[${source.environment}] GOODS_COMM_SMOKE_ACCURACY`, blockers)
  validatePositiveNumber(values.GOODS_COMM_SMOKE_RADIUS_METERS, `[${source.environment}] GOODS_COMM_SMOKE_RADIUS_METERS`, blockers)
  validatePositiveInteger(values.GOODS_COMM_SMOKE_HEALTH_ATTEMPTS, `[${source.environment}] GOODS_COMM_SMOKE_HEALTH_ATTEMPTS`, blockers)
  validatePositiveInteger(values.GOODS_COMM_SMOKE_HEALTH_INTERVAL_MS, `[${source.environment}] GOODS_COMM_SMOKE_HEALTH_INTERVAL_MS`, blockers)

  if (values.GOODS_COMM_SMOKE_SCOPE_TYPE && !['community', 'street'].includes(values.GOODS_COMM_SMOKE_SCOPE_TYPE)) {
    blockers.push(`[${source.environment}] GOODS_COMM_SMOKE_SCOPE_TYPE must be community or street`)
  }

  if (
    hasRealReleaseValue(values.GOODS_COMM_SMOKE_SELLER_CODE) &&
    hasRealReleaseValue(values.GOODS_COMM_SMOKE_BUYER_CODE) &&
    values.GOODS_COMM_SMOKE_SELLER_PROVIDER === values.GOODS_COMM_SMOKE_BUYER_PROVIDER &&
    values.GOODS_COMM_SMOKE_SELLER_CODE === values.GOODS_COMM_SMOKE_BUYER_CODE
  ) {
    blockers.push(`[${source.environment}] seller and buyer smoke codes must be different one-time login codes`)
  }

  if (values.GOODS_COMM_SMOKE_APPROVED_IMAGE_URL) {
    if (!hasRealReleaseValue(values.GOODS_COMM_SMOKE_APPROVED_IMAGE_URL) || !startsWithHttps(values.GOODS_COMM_SMOKE_APPROVED_IMAGE_URL)) {
      blockers.push(`[${source.environment}] GOODS_COMM_SMOKE_APPROVED_IMAGE_URL must be a real HTTPS URL when provided`)
    } else {
      passes.push(`[${source.environment}] approved smoke image fallback is configured`)
    }
  } else {
    warnings.push(`[${source.environment}] approved smoke image fallback is not configured; async image moderation may block publish smoke`)
  }

  if (values.GOODS_COMM_SMOKE_APPROVED_IMAGE_SIZE) {
    validatePositiveNumber(values.GOODS_COMM_SMOKE_APPROVED_IMAGE_SIZE, `[${source.environment}] GOODS_COMM_SMOKE_APPROVED_IMAGE_SIZE`, blockers)
  }

  if (values.GOODS_COMM_SMOKE_APPROVED_IMAGE_MIME_TYPE && values.GOODS_COMM_SMOKE_APPROVED_IMAGE_MIME_TYPE !== 'image/jpeg') {
    blockers.push(`[${source.environment}] GOODS_COMM_SMOKE_APPROVED_IMAGE_MIME_TYPE must be image/jpeg when provided`)
  }

  if (source.environment === 'prod' && values.GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION !== 'true') {
    warnings.push('[prod] main-flow smoke will not mutate production until GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION=true or workflow allow_prod_mutation=true')
  }

  if (!blockers.length) {
    passes.push(`[${source.environment}] deployed smoke input bundle is complete`)
  }

  return {
    label: `Deployed smoke ${source.environment}`,
    sources: source.sources.length ? source.sources : ['none'],
    blockers,
    warnings,
    passes
  }
}

function evaluateCrossEnvironment(protectedSources) {
  const blockers = []
  const warnings = []
  const passes = []
  const pre = protectedSources.get('pre')?.values || {}
  const prod = protectedSources.get('prod')?.values || {}

  if (!pre.GOODS_COMM_DATABASE_URL || !prod.GOODS_COMM_DATABASE_URL) {
    warnings.push('pre/prod database isolation cannot be checked until both connection strings are present')
  } else if (pre.GOODS_COMM_DATABASE_URL === prod.GOODS_COMM_DATABASE_URL) {
    blockers.push('pre and prod must not use the same GOODS_COMM_DATABASE_URL')
  } else if (hasRealReleaseValue(pre.GOODS_COMM_DATABASE_URL) && hasRealReleaseValue(prod.GOODS_COMM_DATABASE_URL)) {
    passes.push(`pre/prod database URLs are distinct: ${maskConnectionString(pre.GOODS_COMM_DATABASE_URL)} vs ${maskConnectionString(prod.GOODS_COMM_DATABASE_URL)}`)
  } else {
    warnings.push('pre/prod database URLs differ, but at least one still looks like a placeholder')
  }

  if (!pre.GOODS_COMM_COS_BUCKET || !prod.GOODS_COMM_COS_BUCKET) {
    warnings.push('pre/prod COS bucket isolation cannot be checked until both bucket names are present')
  } else if (pre.GOODS_COMM_COS_BUCKET === prod.GOODS_COMM_COS_BUCKET) {
    blockers.push('pre and prod must not use the same GOODS_COMM_COS_BUCKET')
  } else if (hasRealReleaseValue(pre.GOODS_COMM_COS_BUCKET) && hasRealReleaseValue(prod.GOODS_COMM_COS_BUCKET)) {
    passes.push('pre/prod COS buckets are distinct')
  } else {
    warnings.push('pre/prod COS buckets differ, but at least one still looks like a placeholder')
  }

  return {
    label: 'Cross environment isolation',
    sources: ['pre/prod protected inputs'],
    blockers,
    warnings,
    passes
  }
}

function evaluateCiInputs(runtimeEnv) {
  const blockers = []
  const warnings = []
  const passes = []
  const missingRequired = REQUIRED_CI_SECRET_KEYS.filter((key) => !hasRealReleaseValue(runtimeEnv[key]))

  if (missingRequired.length) {
    blockers.push(`missing CI deploy secrets: ${missingRequired.join(', ')}`)
  } else {
    passes.push('Tencent Cloud API credentials are present for non-interactive deploy')
  }

  const missingOptional = OPTIONAL_CI_SECRET_KEYS.filter((key) => !hasRealReleaseValue(runtimeEnv[key]))
  if (missingOptional.length) {
    warnings.push(`optional CI inputs are absent unless needed for this release path: ${missingOptional.join(', ')}`)
  }

  return {
    label: 'CI and deploy credentials',
    sources: ['current shell / GitHub Actions env'],
    blockers,
    warnings,
    passes
  }
}

function renderReport(report) {
  const lines = [
    `Release input readiness: ${report.status} (${report.blockerCount} blockers, ${report.warningCount} warnings)`,
    '',
    'This report prints presence and quality only; secret values are never shown.',
    ''
  ]

  for (const group of [
    ...report.protectedReports,
    ...report.smokeReports,
    report.crossEnvironmentReport,
    report.ciReport
  ]) {
    lines.push(renderGroup(group))
  }

  lines.push('Next steps:')
  lines.push('- Fill .env.pre.local / .env.prod.local or GitHub GOODS_COMM_PRE_ENV_LOCAL / GOODS_COMM_PROD_ENV_LOCAL.')
  lines.push('- Fill .env.smoke.pre.local / .env.smoke.prod.local or GitHub GOODS_COMM_PRE_SMOKE_ENV_LOCAL / GOODS_COMM_PROD_SMOKE_ENV_LOCAL.')
  lines.push('- Re-run npm run release:inputs -- --check-only before verify:release:strict or release-strict.yml.')

  return lines.join('\n')
}

async function writeOptionalReport(path, content) {
  if (!path) {
    return
  }

  const resolvedPath = resolve(process.cwd(), path)
  await mkdir(dirname(resolvedPath), {
    recursive: true
  })
  await writeFile(resolvedPath, content)
}

function createMachineReadableReport(report) {
  return {
    generatedAt: new Date().toISOString(),
    status: report.status,
    blockerCount: report.blockerCount,
    warningCount: report.warningCount,
    groups: [
      ...report.protectedReports,
      ...report.smokeReports,
      report.crossEnvironmentReport,
      report.ciReport
    ].map((group) => ({
      label: group.label,
      sources: group.sources,
      blockers: group.blockers,
      warnings: group.warnings,
      passes: group.passes
    }))
  }
}

function renderGroup(group) {
  const lines = [
    `## ${group.label}`,
    `Sources: ${group.sources.join(', ')}`
  ]

  appendItems(lines, 'Blockers', group.blockers)
  appendItems(lines, 'Warnings', group.warnings)
  appendItems(lines, 'Passes', group.passes)

  return `${lines.join('\n')}\n`
}

function appendItems(lines, label, items) {
  if (!items.length) {
    lines.push(`${label}: none`)
    return
  }

  lines.push(`${label}:`)
  for (const item of items) {
    lines.push(`- ${item}`)
  }
}

function hasRealReleaseValue(value = '') {
  const normalized = String(value || '').trim()

  if (!normalized) {
    return false
  }

  return !/REPLACE_WITH|placeholder|touristappid|your-|example\b|example\.|ONE_TIME|OPTIONAL|YYYYMMDD/i.test(normalized)
}

function startsWithHttps(value = '') {
  return String(value || '').trim().startsWith('https://')
}

function isPostgresConnectionString(value = '') {
  return /^postgres(?:ql)?:\/\//.test(String(value || '').trim())
}

function normalizeConnectionString(value = '') {
  const raw = String(value || '').trim()

  try {
    const url = new URL(raw)

    url.username = ''
    url.password = ''

    return url.toString()
  } catch {
    return raw
  }
}

function allOriginsAreHttps(value = '') {
  return String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .every((origin) => origin.startsWith('https://'))
}

function parseRegionDataset(value = '') {
  if (!hasRealReleaseValue(value)) {
    return {
      valid: false,
      reason: 'missing or placeholder dataset'
    }
  }

  try {
    const parsed = JSON.parse(value)

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return {
        valid: false,
        reason: 'dataset must be a non-empty array'
      }
    }

    if (!parsed.every((entry) => entry.communityId && entry.streetId)) {
      return {
        valid: false,
        reason: 'every entry must include communityId and streetId'
      }
    }

    return {
      valid: true,
      count: parsed.length
    }
  } catch (error) {
    return {
      valid: false,
      reason: error.message
    }
  }
}

function validateProvider(value, label, blockers) {
  if (value && !['weixin', 'alipay'].includes(value)) {
    blockers.push(`${label} must be weixin or alipay`)
  }
}

function validateCoordinate(value, min, max, label, blockers) {
  if (!value) {
    return
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    blockers.push(`${label} must be between ${min} and ${max}`)
  }
}

function validatePositiveNumber(value, label, blockers) {
  if (!value) {
    return
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    blockers.push(`${label} must be a positive number`)
  }
}

function validatePositiveInteger(value, label, blockers) {
  if (!value) {
    return
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    blockers.push(`${label} must be a positive integer`)
  }
}

function getRequestedEnvironments() {
  const requested = getArgValue('--env') || 'pre,prod'

  if (requested.trim() === 'both') {
    return [...PROTECTED_ENVIRONMENTS]
  }

  return requested
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => normalizeEnvironmentName(item))
    .filter((item) => {
      if (!PROTECTED_ENVIRONMENTS.includes(item)) {
        throw new Error('release input checks only support pre/prod')
      }

      return true
    })
}

function getArgValue(name) {
  const index = process.argv.findIndex((arg) => arg === name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function defaultJsonOutputPath(markdownPath) {
  if (!markdownPath) {
    return ''
  }

  return /\.md$/i.test(markdownPath)
    ? markdownPath.replace(/\.md$/i, '.json')
    : `${markdownPath}.json`
}

function runSelfTest() {
  const sourceBundle = {
    environments: ['pre', 'prod'],
    protectedSources: new Map([
      ['pre', createSyntheticProtectedSource('pre')],
      ['prod', createSyntheticProtectedSource('prod')]
    ]),
    smokeSources: new Map([
      ['pre', createSyntheticSmokeSource('pre')],
      ['prod', createSyntheticSmokeSource('prod')]
    ])
  }
  const runtimeEnv = {
    TENCENTCLOUD_SECRET_ID: 'tc-secret-id',
    TENCENTCLOUD_SECRET_KEY: 'tc-secret-key'
  }
  const report = buildReleaseInputsReport(sourceBundle, runtimeEnv)

  assert.equal(report.status, 'PASS')
  assert.equal(report.blockerCount, 0)
  assert.match(renderReport(report), /Release input readiness: PASS/)
  assert.doesNotMatch(renderReport(report), /tc-secret-key|postgres-secret|session-secret/)
  assert.doesNotMatch(JSON.stringify(createMachineReadableReport(report)), /tc-secret-key|postgres-secret|session-secret/)

  const blockedBundle = {
    environments: ['pre'],
    protectedSources: new Map([
      ['pre', {
        environment: 'pre',
        values: {},
        sources: ['.env.pre'],
        hasOverride: false,
        expectedLocalPath: '.env.pre.local',
        expectedMultilineSecret: 'GOODS_COMM_PRE_ENV_LOCAL'
      }]
    ]),
    smokeSources: new Map([
      ['pre', {
        environment: 'pre',
        values: {},
        sources: [],
        hasOverride: false,
        expectedLocalPath: '.env.smoke.pre.local',
        expectedMultilineSecret: 'GOODS_COMM_PRE_SMOKE_ENV_LOCAL'
      }]
    ])
  }
  const blockedReport = buildReleaseInputsReport(blockedBundle, {})

  assert.equal(blockedReport.status, 'BLOCKED')
  assert.ok(blockedReport.blockerCount > 0)

  const unsafeAdminBundle = {
    environments: ['pre'],
    protectedSources: new Map([
      ['pre', createSyntheticProtectedSource('pre')]
    ]),
    smokeSources: new Map([
      ['pre', createSyntheticSmokeSource('pre')]
    ])
  }
  const unsafeValues = unsafeAdminBundle.protectedSources.get('pre').values
  unsafeValues.GOODS_COMM_DATABASE_ADMIN_URL = unsafeValues.GOODS_COMM_DATABASE_URL
  const unsafeAdminReport = buildReleaseInputsReport(unsafeAdminBundle, runtimeEnv)

  assert.equal(unsafeAdminReport.status, 'BLOCKED')
  assert.match(renderReport(unsafeAdminReport), /GOODS_COMM_DATABASE_ADMIN_URL must not equal GOODS_COMM_DATABASE_URL/)

  unsafeValues.GOODS_COMM_DATABASE_ADMIN_URL = 'mysql://root:secret@pre-db.internal:3306/mysql'
  const nonPostgresAdminReport = buildReleaseInputsReport(unsafeAdminBundle, runtimeEnv)

  assert.equal(nonPostgresAdminReport.status, 'BLOCKED')
  assert.match(renderReport(nonPostgresAdminReport), /GOODS_COMM_DATABASE_ADMIN_URL must be a PostgreSQL connection string/)
}

function createSyntheticProtectedSource(environment) {
  return {
    environment,
    values: createSyntheticProtectedValues(environment),
    sources: [`.env.${environment}`, `.env.${environment}.local`],
    hasOverride: true,
    expectedLocalPath: `.env.${environment}.local`,
    expectedMultilineSecret: `GOODS_COMM_${environment.toUpperCase()}_ENV_LOCAL`
  }
}

function createSyntheticProtectedValues(environment) {
  const values = Object.fromEntries(PROTECTED_REQUIRED_KEYS.map((key) => [key, `real-${environment}-${key.toLowerCase()}`]))

  Object.assign(values, {
    VITE_API_BASE_URL: `https://${environment}-api.goods-comm.local`,
    GOODS_COMM_CLOUDBASE_ENV_ID: `${environment}-cloudbase`,
    GOODS_COMM_TENCENT_REGION: 'ap-shanghai',
    GOODS_COMM_TENCENT_CLOUD_RUN_SERVICE: `goods-comm-${environment}`,
    GOODS_COMM_TENCENT_CONTAINER_IMAGE: `ccr.ccs.tencentyun.com/goods-comm/${environment}:latest`,
    GOODS_COMM_ALLOWED_ORIGINS: `https://${environment}.goods-comm.local`,
    GOODS_COMM_DATABASE_URL: `postgres://goods_comm_${environment}:postgres-secret@${environment}-pg.internal:5432/goods_comm_${environment}`,
    GOODS_COMM_DATABASE_ADMIN_URL: `postgres://postgres:postgres-secret@${environment}-pg.internal:5432/postgres`,
    GOODS_COMM_STATE_STORE: 'postgres',
    GOODS_COMM_POSTGRES_AUTO_SCHEMA: 'false',
    GOODS_COMM_OBJECT_STORE: 'cos',
    GOODS_COMM_PUBLIC_ASSET_BASE_URL: `https://${environment}-cdn.goods-comm.local/assets`,
    GOODS_COMM_COS_BUCKET: `goods-comm-${environment}-bucket`,
    GOODS_COMM_COS_REGION: 'ap-shanghai',
    GOODS_COMM_COS_BASE_URL: `https://goods-comm-${environment}.cos.ap-shanghai.myqcloud.com`,
    GOODS_COMM_CDN_BASE_URL: `https://${environment}-cdn.goods-comm.local/assets`,
    GOODS_COMM_MAP_PROVIDER: 'tencent',
    GOODS_COMM_MAP_REGION_DATASET: `[{"adcode":"310106","streetName":"nanjing-west-road","communityId":"${environment}-community","streetId":"${environment}-street"}]`,
    GOODS_COMM_CONTENT_SECURITY_PROVIDER: 'wechat',
    GOODS_COMM_SESSION_SECRET: `session-secret-${environment}-12345678901234567890`,
    GOODS_COMM_OPS_SESSION_SECRET: `ops-session-secret-${environment}-12345678901234567890`,
    GOODS_COMM_ALERT_PROVIDER: 'webhook',
    GOODS_COMM_ALERT_WEBHOOK_URL: `https://${environment}-alerts.goods-comm.local/webhook`,
    GOODS_COMM_ACCESS_LOG_ENABLED: 'true',
    GOODS_COMM_PLATFORM_AUTH_MODE: 'platform',
    GOODS_COMM_PLATFORM_NOTIFY_PROVIDER: 'wechat'
  })

  if (environment === 'pre') {
    values.GOODS_COMM_ACCEPTS_PROD_SYNC = 'true'
  }

  if (environment === 'prod') {
    values.GOODS_COMM_PROD_SYNC_EXPORT = 'true'
  }

  return values
}

function createSyntheticSmokeSource(environment) {
  return {
    environment,
    values: {
      GOODS_COMM_SMOKE_API_BASE_URL: `https://${environment}-api.goods-comm.local`,
      GOODS_COMM_SMOKE_SELLER_PROVIDER: 'weixin',
      GOODS_COMM_SMOKE_SELLER_CODE: `${environment}-seller-code`,
      GOODS_COMM_SMOKE_BUYER_PROVIDER: 'weixin',
      GOODS_COMM_SMOKE_BUYER_CODE: `${environment}-buyer-code`,
      GOODS_COMM_SMOKE_LATITUDE: '31.22945',
      GOODS_COMM_SMOKE_LONGITUDE: '121.45494',
      GOODS_COMM_SMOKE_ACCURACY: '30',
      GOODS_COMM_SMOKE_SCOPE_TYPE: 'community',
      GOODS_COMM_SMOKE_RADIUS_METERS: '1200',
      GOODS_COMM_SMOKE_HEALTH_ATTEMPTS: '12',
      GOODS_COMM_SMOKE_HEALTH_INTERVAL_MS: '10000',
      GOODS_COMM_SMOKE_APPROVED_IMAGE_URL: `https://${environment}-cdn.goods-comm.local/assets/smoke.jpg`,
      GOODS_COMM_SMOKE_APPROVED_IMAGE_SIZE: '1',
      GOODS_COMM_SMOKE_APPROVED_IMAGE_MIME_TYPE: 'image/jpeg',
      GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION: environment === 'prod' ? 'true' : ''
    },
    sources: [`.env.smoke.${environment}.local`],
    hasOverride: true,
    expectedLocalPath: `.env.smoke.${environment}.local`,
    expectedMultilineSecret: `GOODS_COMM_${environment.toUpperCase()}_SMOKE_ENV_LOCAL`
  }
}
