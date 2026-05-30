import { spawnSync } from 'node:child_process'
import { access, mkdir, stat, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { dirname, resolve } from 'node:path'
import { createArtifactChecks } from './artifact-checks.mjs'
import {
  VALID_ENVIRONMENTS,
  containsPlaceholder,
  envLocalFilePath,
  maskConnectionString,
  normalizeEnvironmentName,
  readEnvironmentFile
} from './env-files.mjs'

const REQUIRED_KEYS = [
  'GOODS_COMM_ENV',
  'VITE_APP_ENV',
  'VITE_API_BASE_URL',
  'GOODS_COMM_CLOUDBASE_ENV_ID',
  'GOODS_COMM_TENCENT_REGION',
  'GOODS_COMM_TENCENT_CLOUD_RUN_SERVICE',
  'GOODS_COMM_TENCENT_CONTAINER_IMAGE',
  'GOODS_COMM_ALLOWED_ORIGINS',
  'HOST',
  'PORT',
  'GOODS_COMM_STATE_PATH',
  'GOODS_COMM_OBJECT_DIR',
  'GOODS_COMM_PUBLIC_ASSET_BASE_URL',
  'GOODS_COMM_MAX_IMAGE_BYTES',
  'GOODS_COMM_MAX_REQUEST_BYTES',
  'GOODS_COMM_RATE_LIMIT_MAX_REQUESTS',
  'GOODS_COMM_RATE_LIMIT_WINDOW_MS',
  'GOODS_COMM_TRUSTED_PROXY_IPS',
  'GOODS_COMM_OBJECT_STORE',
  'GOODS_COMM_DATABASE_URL',
  'GOODS_COMM_DATABASE_SCHEMA',
  'GOODS_COMM_STATE_STORE',
  'GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS',
  'GOODS_COMM_POSTGRES_AUTO_SCHEMA',
  'GOODS_COMM_COS_BUCKET',
  'GOODS_COMM_COS_REGION',
  'GOODS_COMM_COS_SECRET_ID',
  'GOODS_COMM_COS_SECRET_KEY',
  'GOODS_COMM_COS_BASE_URL',
  'GOODS_COMM_CDN_BASE_URL',
  'GOODS_COMM_MAP_PROVIDER',
  'GOODS_COMM_MAP_REGION_DATASET',
  'GOODS_COMM_TENCENT_MAP_KEY',
  'GOODS_COMM_TENCENT_MAP_GEOCODER_URL',
  'GOODS_COMM_CONTENT_SECURITY_PROVIDER',
  'GOODS_COMM_MODERATION_WEBHOOK_SECRET',
  'GOODS_COMM_SESSION_SECRET',
  'GOODS_COMM_OPS_SESSION_SECRET',
  'GOODS_COMM_OPS_ACCOUNTS',
  'GOODS_COMM_OPS_LOGIN_MAX_FAILURES',
  'GOODS_COMM_OPS_LOGIN_WINDOW_MS',
  'GOODS_COMM_OPS_LOGIN_LOCK_MS',
  'GOODS_COMM_PLATFORM_AUTH_MODE',
  'GOODS_COMM_PLATFORM_NOTIFY_PROVIDER',
  'GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_IDS',
  'GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_FIELDS',
  'GOODS_COMM_WECHAT_SUBSCRIBE_SEND_URL',
  'GOODS_COMM_WECHAT_APP_ID',
  'GOODS_COMM_WECHAT_APP_SECRET',
  'GOODS_COMM_ALIPAY_APP_ID',
  'GOODS_COMM_ALIPAY_PRIVATE_KEY',
  'GOODS_COMM_ALIPAY_GATEWAY'
]

const PRODUCTION_MODE_EXPECTATIONS = {
  GOODS_COMM_STATE_STORE: 'postgres',
  GOODS_COMM_OBJECT_STORE: 'cos',
  GOODS_COMM_MAP_PROVIDER: 'tencent',
  GOODS_COMM_CONTENT_SECURITY_PROVIDER: 'wechat',
  GOODS_COMM_PLATFORM_AUTH_MODE: 'platform',
  GOODS_COMM_PLATFORM_NOTIFY_PROVIDER: 'wechat'
}

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

const POSTGRES_SNAPSHOT_LIMIT_KEY = 'GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS'
const POSTGRES_AUTO_SCHEMA_KEY = 'GOODS_COMM_POSTGRES_AUTO_SCHEMA'

const REAL_VALUE_KEYS = [
  'VITE_API_BASE_URL',
  'GOODS_COMM_ALLOWED_ORIGINS',
  'GOODS_COMM_DATABASE_URL',
  'GOODS_COMM_COS_BUCKET',
  'GOODS_COMM_COS_REGION',
  'GOODS_COMM_COS_SECRET_ID',
  'GOODS_COMM_COS_SECRET_KEY',
  'GOODS_COMM_COS_BASE_URL',
  'GOODS_COMM_CDN_BASE_URL',
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

const checkOnly = process.argv.includes('--check-only')
const requireDeployedSmokeInputs = process.argv.includes('--require-deployed-smoke-inputs')
const outputPath = resolve(process.cwd(), getArgValue('--output') || 'docs/deployment-readiness-audit.md')
const jsonOutputPath = resolve(process.cwd(), getArgValue('--json-output') || defaultJsonOutputPath(outputPath))
const environments = getRequestedEnvironments()
const commandStatus = inspectCommands()
const audit = await createAudit()
const markdown = renderAudit(audit)
const machineReadableAudit = createMachineReadableAudit(audit)

if (checkOnly) {
  console.log(renderConsoleSummary(audit))
} else {
  await mkdir(dirname(outputPath), {
    recursive: true
  })
  await writeFile(outputPath, markdown)
  await mkdir(dirname(jsonOutputPath), {
    recursive: true
  })
  await writeFile(jsonOutputPath, `${JSON.stringify(machineReadableAudit, null, 2)}\n`)
  console.log(`Production readiness audit written to ${outputPath}`)
  console.log(`Production readiness audit JSON written to ${jsonOutputPath}`)
  console.log(renderConsoleSummary(audit))
}

if (checkOnly && audit.blockerCount > 0) {
  process.exitCode = 1
}

async function createAudit() {
  const environmentReports = []
  const valuesByEnvironment = new Map()

  for (const environment of environments) {
    try {
      const values = await readEnvironmentFile(environment)
      valuesByEnvironment.set(environment, values)
      environmentReports.push(await auditEnvironment(environment, values))
    } catch (error) {
      environmentReports.push({
        environment,
        localOverrideLoaded: false,
        blockers: [`Cannot read .env.${environment}: ${error.message}`],
        warnings: [],
        passes: []
      })
    }
  }

  const crossEnvironment = auditCrossEnvironment(valuesByEnvironment)
  const artifactReport = await auditArtifacts(environments)
  const toolReport = auditTools()
  const smokeReport = auditSmokeInputs(environments, valuesByEnvironment)
  const blockerCount = countItems(toolReport.blockers) +
    countItems(environmentReports.flatMap((report) => report.blockers)) +
    countItems(crossEnvironment.blockers) +
    countItems(artifactReport.blockers) +
    countItems(smokeReport.blockers)
  const warningCount = countItems(toolReport.warnings) +
    countItems(environmentReports.flatMap((report) => report.warnings)) +
    countItems(crossEnvironment.warnings) +
    countItems(artifactReport.warnings) +
    countItems(smokeReport.warnings)

  return {
    generatedAt: new Date().toISOString(),
    environments,
    toolReport,
    environmentReports,
    crossEnvironment,
    artifactReport,
    smokeReport,
    blockerCount,
    warningCount
  }
}

async function auditEnvironment(environment, values) {
  const blockers = []
  const warnings = []
  const passes = []
  const localOverrideLoaded = await pathExists(envLocalFilePath(environment))
  const productionLike = ['pre', 'prod'].includes(environment)

  for (const key of REQUIRED_KEYS) {
    if (!values[key]) {
      blockers.push(`${key} is missing`)
    }
  }

  if (values.GOODS_COMM_ENV !== environment) {
    blockers.push(`GOODS_COMM_ENV must equal ${environment}`)
  }

  if (values.VITE_APP_ENV !== environment) {
    blockers.push(`VITE_APP_ENV must equal ${environment}`)
  }

  if (['test', 'pre', 'prod'].includes(environment) && !startsWithHttps(values.VITE_API_BASE_URL)) {
    blockers.push('VITE_API_BASE_URL must be HTTPS outside dev')
  }

  if (values[POSTGRES_SNAPSHOT_LIMIT_KEY]) {
    const snapshotLimit = parseNonNegativeInteger(values[POSTGRES_SNAPSHOT_LIMIT_KEY])

    if (!snapshotLimit.valid) {
      blockers.push(`${POSTGRES_SNAPSHOT_LIMIT_KEY} must be a non-negative integer`)
    } else if (productionLike && values.GOODS_COMM_STATE_STORE === 'postgres' && snapshotLimit.value <= 0) {
      blockers.push(`${POSTGRES_SNAPSHOT_LIMIT_KEY} must be greater than 0 for pre/prod PostgreSQL store`)
    } else if (values.GOODS_COMM_STATE_STORE === 'postgres') {
      passes.push(`${POSTGRES_SNAPSHOT_LIMIT_KEY} limits PostgreSQL snapshot rewrites to ${snapshotLimit.value} rows`)
    }
  }

  if (values[POSTGRES_AUTO_SCHEMA_KEY]) {
    const autoSchema = parseBooleanSetting(values[POSTGRES_AUTO_SCHEMA_KEY])

    if (!autoSchema.valid) {
      blockers.push(`${POSTGRES_AUTO_SCHEMA_KEY} must be true or false`)
    } else if (productionLike && values.GOODS_COMM_STATE_STORE === 'postgres' && autoSchema.value !== false) {
      blockers.push(`${POSTGRES_AUTO_SCHEMA_KEY} must be false for pre/prod PostgreSQL store; run explicit database migration before backend startup`)
    } else if (values.GOODS_COMM_STATE_STORE === 'postgres') {
      passes.push(`${POSTGRES_AUTO_SCHEMA_KEY} is ${autoSchema.value ? 'enabled' : 'disabled'} for PostgreSQL store`)
    }
  }

  for (const key of ['GOODS_COMM_OPS_LOGIN_MAX_FAILURES', 'GOODS_COMM_OPS_LOGIN_WINDOW_MS', 'GOODS_COMM_OPS_LOGIN_LOCK_MS']) {
    const parsed = parseNonNegativeInteger(values[key])

    if (!parsed.valid || parsed.value <= 0) {
      blockers.push(`${key} must be a positive integer`)
    } else {
      passes.push(`${key} is ${parsed.value}`)
    }
  }

  for (const key of ['GOODS_COMM_RATE_LIMIT_MAX_REQUESTS', 'GOODS_COMM_RATE_LIMIT_WINDOW_MS']) {
    const parsed = parseNonNegativeInteger(values[key])

    if (!parsed.valid || parsed.value <= 0) {
      blockers.push(`${key} must be a positive integer`)
    } else {
      passes.push(`${key} is ${parsed.value}`)
    }
  }

  if (values.GOODS_COMM_TRUSTED_PROXY_IPS && !containsPlaceholder(values.GOODS_COMM_TRUSTED_PROXY_IPS)) {
    const trustedProxyList = parseTrustedProxyListSetting(values.GOODS_COMM_TRUSTED_PROXY_IPS)

    if (!trustedProxyList.valid) {
      blockers.push(`GOODS_COMM_TRUSTED_PROXY_IPS must be "none" or a comma-separated list of IPs/IPv4 CIDRs: ${trustedProxyList.reason}`)
    } else if (trustedProxyList.count > 0) {
      passes.push(`GOODS_COMM_TRUSTED_PROXY_IPS contains ${trustedProxyList.count} trusted proxy rules`)
    } else if (productionLike) {
      warnings.push('GOODS_COMM_TRUSTED_PROXY_IPS is none; ensure the backend directly sees client IPs or edge WAF handles per-client rate limits')
    } else {
      passes.push('GOODS_COMM_TRUSTED_PROXY_IPS is disabled for direct local traffic')
    }
  }

  if (productionLike) {
    for (const [key, expected] of Object.entries(PRODUCTION_MODE_EXPECTATIONS)) {
      if (values[key] !== expected) {
        blockers.push(`${key} must be ${expected}`)
      }
    }

    for (const key of REAL_VALUE_KEYS) {
      if (!hasRealValue(values[key])) {
        blockers.push(`${key} must be replaced with a real production value`)
      }
    }

    if (!startsWithHttps(values.GOODS_COMM_PUBLIC_ASSET_BASE_URL)) {
      blockers.push('GOODS_COMM_PUBLIC_ASSET_BASE_URL must be HTTPS')
    }

    if (!startsWithHttps(values.GOODS_COMM_CDN_BASE_URL)) {
      blockers.push('GOODS_COMM_CDN_BASE_URL must be HTTPS')
    }

    if (!allOriginsAreHttps(values.GOODS_COMM_ALLOWED_ORIGINS)) {
      blockers.push('GOODS_COMM_ALLOWED_ORIGINS must use HTTPS origins')
    }

    if (values.GOODS_COMM_MAP_PROVIDER === 'tencent') {
      const regionDataset = parseRegionDatasetSetting(values.GOODS_COMM_MAP_REGION_DATASET)

      if (!regionDataset.valid) {
        blockers.push(`GOODS_COMM_MAP_REGION_DATASET must be a non-empty JSON array for pre/prod Tencent map mapping: ${regionDataset.reason}`)
      } else {
        passes.push(`GOODS_COMM_MAP_REGION_DATASET contains ${regionDataset.count} configured region mappings`)
      }
    }

    if (hasRealValue(values.GOODS_COMM_SESSION_SECRET) && values.GOODS_COMM_SESSION_SECRET.length < 32) {
      blockers.push('GOODS_COMM_SESSION_SECRET should be at least 32 characters')
    }

    if (hasRealValue(values.GOODS_COMM_OPS_SESSION_SECRET) && values.GOODS_COMM_OPS_SESSION_SECRET.length < 32) {
      blockers.push('GOODS_COMM_OPS_SESSION_SECRET should be at least 32 characters')
    }

    const deployPath = evaluateDeployPath(values)
    if (!deployPath.ready) {
      blockers.push(deployPath.reason)
    } else {
      passes.push(deployPath.reason)
    }
  }

  const placeholderKeys = Object.entries(values)
    .filter(([, value]) => containsPlaceholder(value))
    .map(([key]) => key)

  if (placeholderKeys.length) {
    warnings.push(`Placeholder-like values remain: ${placeholderKeys.join(', ')}`)
  } else {
    passes.push('No placeholder-like values detected in loaded env file')
  }

  if (localOverrideLoaded) {
    passes.push(`Loaded .env.${environment}.local overrides`)
  }

  return {
    environment,
    localOverrideLoaded,
    blockers,
    warnings,
    passes
  }
}

function auditCrossEnvironment(valuesByEnvironment) {
  const blockers = []
  const warnings = []
  const passes = []
  const pre = valuesByEnvironment.get('pre')
  const prod = valuesByEnvironment.get('prod')

  if (!pre || !prod) {
    warnings.push('pre/prod isolation was not fully checked because one environment was outside the audit scope')
    return {
      blockers,
      warnings,
      passes
    }
  }

  auditDistinctRealValues({
    label: 'database URLs',
    preValue: pre.GOODS_COMM_DATABASE_URL,
    prodValue: prod.GOODS_COMM_DATABASE_URL,
    mask: maskConnectionString,
    blockers,
    warnings,
    passes
  })

  auditDistinctRealValues({
    label: 'COS buckets',
    preValue: pre.GOODS_COMM_COS_BUCKET,
    prodValue: prod.GOODS_COMM_COS_BUCKET,
    blockers,
    warnings,
    passes
  })

  auditMatchingTopologyValues(pre, prod, blockers, passes)

  if (pre.GOODS_COMM_ACCEPTS_PROD_SYNC !== 'true') {
    blockers.push('pre must set GOODS_COMM_ACCEPTS_PROD_SYNC=true for prod-to-pre sync')
  } else {
    passes.push('pre accepts controlled prod-to-pre sync')
  }

  if (prod.GOODS_COMM_PROD_SYNC_EXPORT !== 'true') {
    blockers.push('prod must set GOODS_COMM_PROD_SYNC_EXPORT=true for prod-to-pre sync export')
  } else {
    passes.push('prod export flag is enabled for controlled prod-to-pre sync')
  }

  return {
    blockers,
    warnings,
    passes
  }
}

function auditDistinctRealValues({ label, preValue, prodValue, mask = (value) => value, blockers, warnings, passes }) {
  if (preValue === prodValue) {
    blockers.push(`pre and prod ${label} must be different`)
    return
  }

  if (!hasRealValue(preValue) || !hasRealValue(prodValue)) {
    warnings.push(`pre/prod ${label} are configured as different placeholders; isolation is not proven until both values are real`)
    return
  }

  passes.push(`pre/prod ${label} are different: ${mask(preValue)} vs ${mask(prodValue)}`)
}

function auditMatchingTopologyValues(pre, prod, blockers, passes) {
  const mismatches = PRE_PROD_TOPOLOGY_MATCH_KEYS
    .filter((key) => pre[key] !== prod[key])
    .map((key) => `${key}: pre=${pre[key] || 'missing'} prod=${prod[key] || 'missing'}`)

  if (mismatches.length) {
    blockers.push(`pre/prod topology variables must match: ${mismatches.join('; ')}`)
    return
  }

  passes.push(`pre/prod topology variables match: ${PRE_PROD_TOPOLOGY_MATCH_KEYS.join(', ')}`)
}

async function auditArtifacts(targetEnvironments) {
  const blockers = []
  const warnings = []
  const passes = []
  const backendPackage = 'dist/backend/package.json'
  let missingArtifactDirectory = false

  if (await pathExists(resolve(process.cwd(), backendPackage))) {
    passes.push(`${backendPackage} exists`)

    const backendArtifactSmoke = spawnSync(process.execPath, ['scripts/backend-artifact-smoke.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe'
    })

    if (backendArtifactSmoke.status === 0) {
      passes.push('dist/backend artifact includes server, BFF, PostgreSQL store, schema, Dockerfile, start script, package-lock, and npm ci production dependency install check')
    } else {
      const detail = (backendArtifactSmoke.stderr || backendArtifactSmoke.stdout || 'unknown error').trim()
      warnings.push(`dist/backend artifact smoke failed: ${detail}`)
    }
  } else {
    warnings.push(`${backendPackage} is missing; run npm run build:backend before backend deployment`)
  }

  for (const environment of targetEnvironments) {
    for (const platform of ['mp-weixin', 'mp-alipay', 'h5']) {
      const directory = `dist/build/${environment}/${platform}`

      if (await isDirectory(resolve(process.cwd(), directory))) {
        passes.push(`${directory} exists`)
      } else {
        warnings.push(`${directory} is missing; run the ${platform} build for ${environment} before client release`)
        missingArtifactDirectory = true
      }
    }
  }

  if (!missingArtifactDirectory) {
    const artifactChecks = await createArtifactChecks({
      root: process.cwd(),
      profile: 'full',
      environments: targetEnvironments
    })

    for (const target of artifactChecks.targets) {
      try {
        await artifactChecks.verifyTarget(target)
        passes.push(`${target.label} artifact includes core pages, tabBar, key components, rendered test anchors, H5 route chunks, and runtime environment config`)
      } catch (error) {
        warnings.push(`${target.label} artifact content check failed: ${error.message}`)
      }
    }
  }

  return {
    blockers,
    warnings,
    passes
  }
}

function auditTools() {
  const blockers = []
  const warnings = []
  const passes = []

  if (commandStatus.cloudbase.availableCommand) {
    passes.push(`CloudBase deploy CLI available: ${commandStatus.cloudbase.availableCommand}`)
  } else {
    warnings.push('CloudBase deploy CLI is missing: install cloudbase or tcb if using WeChat CloudBase')
  }

  if (commandStatus.docker.available && commandStatus.tccli.available) {
    passes.push('Tencent fallback deploy tools are available: docker and tccli')
  } else {
    warnings.push('Tencent fallback deploy tools are incomplete: docker and tccli are both required')
  }

  if (commandStatus.psql.available) {
    passes.push('psql is available for database migration')
  } else {
    blockers.push('psql is required to execute database migration locally')
  }

  if (commandStatus.pgDump.available && commandStatus.pgRestore.available && commandStatus.psql.available) {
    passes.push('pg_dump, pg_restore, and psql are available for prod-to-pre sync')
  } else {
    blockers.push('pg_dump, pg_restore, and psql are required to execute prod-to-pre sync locally')
  }

  if (!commandStatus.cloudbase.availableCommand && !(commandStatus.docker.available && commandStatus.tccli.available)) {
    blockers.push('No backend deployment toolchain is currently executable: need cloudbase/tcb or docker+tccli')
  }

  if (hasTencentCloudApiCredential()) {
    passes.push('Tencent Cloud API credentials are present for non-interactive CloudBase/Tencent deploy')
  } else {
    blockers.push('TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY are required for non-interactive CloudBase/Tencent deployment in CI')
  }

  return {
    blockers,
    warnings,
    passes
  }
}

function auditSmokeInputs(targetEnvironments, valuesByEnvironment) {
  const blockers = []
  const warnings = []
  const passes = []
  const requiredRuntimeInputs = [
    'GOODS_COMM_SMOKE_SELLER_CODE',
    'GOODS_COMM_SMOKE_BUYER_CODE',
    'GOODS_COMM_SMOKE_LATITUDE',
    'GOODS_COMM_SMOKE_LONGITUDE'
  ]

  for (const environment of targetEnvironments) {
    const values = valuesByEnvironment.get(environment)

    if (!values) {
      continue
    }

    if (containsPlaceholder(values.VITE_API_BASE_URL || '')) {
      blockers.push(`[${environment}] deployed smoke cannot run until VITE_API_BASE_URL points to a real API`)
    }

    const missingRuntimeInputs = requiredRuntimeInputs.filter((key) => !process.env[key])
    if (missingRuntimeInputs.length) {
      const message = `[${environment}] main-flow deployed smoke still needs shell inputs: ${missingRuntimeInputs.join(', ')}`

      if (requireDeployedSmokeInputs) {
        blockers.push(message)
      } else {
        warnings.push(message)
      }
    } else {
      passes.push(`[${environment}] main-flow smoke runtime inputs are present in current shell`)
    }

    if (environment === 'prod' && process.env.GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION !== 'true') {
      warnings.push('[prod] production main-flow smoke is protected by GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION=true')
    }
  }

  return {
    blockers,
    warnings,
    passes
  }
}

function evaluateDeployPath(values) {
  const cloudbaseConfigReady = hasRealValue(values.GOODS_COMM_CLOUDBASE_ENV_ID)
  const cloudbaseToolReady = Boolean(commandStatus.cloudbase.availableCommand)
  const tencentConfigReady = [
    'GOODS_COMM_TENCENT_REGION',
    'GOODS_COMM_TENCENT_CLOUD_RUN_SERVICE',
    'GOODS_COMM_TENCENT_CONTAINER_IMAGE'
  ].every((key) => hasRealValue(values[key]))
  const tencentToolsReady = commandStatus.docker.available && commandStatus.tccli.available

  if (cloudbaseConfigReady && cloudbaseToolReady) {
    return {
      ready: true,
      reason: `CloudBase deploy path is ready via ${commandStatus.cloudbase.availableCommand}`
    }
  }

  if (tencentConfigReady && tencentToolsReady) {
    return {
      ready: true,
      reason: 'Tencent fallback deploy path is ready via docker + tccli'
    }
  }

  const missing = []

  if (!cloudbaseConfigReady) {
    missing.push('real GOODS_COMM_CLOUDBASE_ENV_ID')
  }

  if (!cloudbaseToolReady) {
    missing.push('cloudbase/tcb CLI')
  }

  if (!tencentConfigReady) {
    missing.push('real Tencent fallback service/image config')
  }

  if (!tencentToolsReady) {
    missing.push('docker+tccli')
  }

  return {
    ready: false,
    reason: `No deploy path is ready; missing ${missing.join(', ')}`
  }
}

function inspectCommands() {
  return {
    cloudbase: {
      id: 'cloudbase/tcb',
      label: 'CloudBase deploy',
      availableCommand: firstAvailableCommand(['cloudbase', 'tcb'])
    },
    docker: inspectCommand('docker', 'Tencent fallback image build/push'),
    tccli: inspectCommand('tccli', 'Tencent fallback deploy'),
    psql: inspectCommand('psql', 'Database migration and sync'),
    pgDump: inspectCommand('pg_dump', 'Prod-to-pre export'),
    pgRestore: inspectCommand('pg_restore', 'Prod-to-pre restore')
  }
}

function inspectCommand(command, label) {
  return {
    id: command,
    label,
    available: commandAvailable(command)
  }
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
  return Boolean(
    (process.env.TENCENTCLOUD_SECRET_ID || process.env.TENCENTCLOUD_SECRETID) &&
    (process.env.TENCENTCLOUD_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY)
  )
}

function renderAudit(report) {
  return [
    '# goods-comm production readiness audit',
    '',
    `Generated: ${report.generatedAt}`,
    `Scope: ${report.environments.join(', ')}`,
    `Result: ${report.blockerCount === 0 ? 'READY' : 'BLOCKED'} (${report.blockerCount} blockers, ${report.warningCount} warnings)`,
    '',
    'This report is generated from `.env.*` plus optional `.env.*.local` overrides. It does not execute deployment, database migration, or production data sync.',
    '',
    `Machine-readable JSON: \`${relativePath(jsonOutputPath)}\``,
    '',
    '## Summary',
    '',
    renderSummaryTable(report),
    '',
    '## Toolchain',
    '',
    renderToolTable(),
    renderSection('Tool blockers', report.toolReport.blockers),
    renderSection('Tool warnings', report.toolReport.warnings),
    renderSection('Tool passes', report.toolReport.passes),
    '',
    '## Environment details',
    '',
    ...report.environmentReports.flatMap(renderEnvironmentReport),
    '## Cross-environment isolation',
    '',
    renderSection('Blockers', report.crossEnvironment.blockers),
    renderSection('Warnings', report.crossEnvironment.warnings),
    renderSection('Passes', report.crossEnvironment.passes),
    '',
    '## Build artifacts',
    '',
    renderSection('Blockers', report.artifactReport.blockers),
    renderSection('Warnings', report.artifactReport.warnings),
    renderSection('Passes', report.artifactReport.passes),
    '',
    '## Deployed smoke readiness',
    '',
    renderSection('Blockers', report.smokeReport.blockers),
    renderSection('Warnings', report.smokeReport.warnings),
    renderSection('Passes', report.smokeReport.passes),
    '',
    '## Release gate commands',
    '',
    '```bash',
    'npm run env:check',
    'npm run audit:production-readiness -- --check-only',
    'npm run audit:production-readiness:strict-check',
    'npm run db:migrate:plan -- --env pre',
    'GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre npm run db:migrate:pre',
    'npm run deploy:backend:pre:plan',
    'GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre GOODS_COMM_DEPLOY_CONFIRM=deploy-pre npm run deploy:backend:pre',
    'npm run smoke:deployed:pre',
    'npm run smoke:deployed:pre:main',
    'npm run sync:prod-to-pre:plan',
    'GOODS_COMM_SYNC_RUN_PRE_SMOKE=true GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE=true GOODS_COMM_SYNC_AUTO_ENABLED=true npm run sync:prod-to-pre:auto',
    '```',
    ''
  ].join('\n')
}

function createMachineReadableAudit(report) {
  const status = report.blockerCount === 0 ? 'READY' : 'BLOCKED'
  const areas = {
    tools: {
      status: statusLabel(report.toolReport),
      ...normalizeAuditGroup(report.toolReport, 'tools')
    },
    environments: Object.fromEntries(report.environmentReports.map((environmentReport) => [
      environmentReport.environment,
      {
        status: statusLabel(environmentReport),
        localOverrideLoaded: environmentReport.localOverrideLoaded,
        ...normalizeAuditGroup(environmentReport, `environment.${environmentReport.environment}`)
      }
    ])),
    crossEnvironment: {
      status: statusLabel(report.crossEnvironment),
      ...normalizeAuditGroup(report.crossEnvironment, 'cross_environment')
    },
    buildArtifacts: {
      status: statusLabel(report.artifactReport),
      ...normalizeAuditGroup(report.artifactReport, 'build_artifacts')
    },
    deployedSmoke: {
      status: statusLabel(report.smokeReport),
      ...normalizeAuditGroup(report.smokeReport, 'deployed_smoke')
    }
  }

  return {
    generatedAt: report.generatedAt,
    scope: report.environments,
    status,
    blockerCount: report.blockerCount,
    warningCount: report.warningCount,
    toolchain: renderToolchainStatus(),
    areas,
    blockers: flattenIssues(areas, 'blockers'),
    warnings: flattenIssues(areas, 'warnings'),
    passes: flattenIssues(areas, 'passes')
  }
}

function normalizeAuditGroup(group, area) {
  return {
    blockers: normalizeIssueItems(group.blockers, area, 'blocker'),
    warnings: normalizeIssueItems(group.warnings, area, 'warning'),
    passes: normalizeIssueItems(group.passes, area, 'pass')
  }
}

function normalizeIssueItems(items = [], area, severity) {
  return items.map((message, index) => ({
    id: `${area}.${severity}.${index + 1}.${slugify(message)}`,
    area,
    severity,
    message
  }))
}

function flattenIssues(areas, property) {
  const issues = []

  for (const [areaName, areaReport] of Object.entries(areas)) {
    if (areaName === 'environments') {
      for (const environmentReport of Object.values(areaReport)) {
        issues.push(...environmentReport[property])
      }
      continue
    }

    issues.push(...areaReport[property])
  }

  return issues
}

function renderToolchainStatus() {
  return [
    {
      tool: 'cloudbase/tcb',
      requiredFor: 'WeChat CloudBase deploy',
      status: commandStatus.cloudbase.availableCommand || 'missing'
    },
    {
      tool: 'docker',
      requiredFor: 'Tencent fallback image build/push',
      status: commandStatus.docker.available ? 'available' : 'missing'
    },
    {
      tool: 'tccli',
      requiredFor: 'Tencent fallback deploy',
      status: commandStatus.tccli.available ? 'available' : 'missing'
    },
    {
      tool: 'TENCENTCLOUD_SECRET_ID/KEY',
      requiredFor: 'non-interactive CloudBase/Tencent deploy',
      status: hasTencentCloudApiCredential() ? 'present' : 'missing'
    },
    {
      tool: 'psql',
      requiredFor: 'database migration and sync',
      status: commandStatus.psql.available ? 'available' : 'missing'
    },
    {
      tool: 'pg_dump',
      requiredFor: 'prod-to-pre export',
      status: commandStatus.pgDump.available ? 'available' : 'missing'
    },
    {
      tool: 'pg_restore',
      requiredFor: 'prod-to-pre restore',
      status: commandStatus.pgRestore.available ? 'available' : 'missing'
    }
  ]
}

function renderSummaryTable(report) {
  const rows = [
    ['Area', 'Status', 'Notes'],
    ['Tools', statusLabel(report.toolReport), `${report.toolReport.blockers.length} blockers, ${report.toolReport.warnings.length} warnings`],
    ['Environments', statusLabel({
      blockers: report.environmentReports.flatMap((item) => item.blockers),
      warnings: report.environmentReports.flatMap((item) => item.warnings)
    }), `${report.environmentReports.length} environments checked`],
    ['pre/prod isolation', statusLabel(report.crossEnvironment), `${report.crossEnvironment.blockers.length} blockers, ${report.crossEnvironment.warnings.length} warnings`],
    ['Build artifacts', statusLabel(report.artifactReport), `${report.artifactReport.blockers.length} blockers, ${report.artifactReport.warnings.length} warnings`],
    ['Deployed smoke', statusLabel(report.smokeReport), `${report.smokeReport.blockers.length} blockers, ${report.smokeReport.warnings.length} warnings`]
  ]

  return renderTable(rows)
}

function renderToolTable() {
  const rows = [
    ['Tool', 'Required for', 'Status'],
    ['cloudbase/tcb', 'WeChat CloudBase deploy', commandStatus.cloudbase.availableCommand || 'missing'],
    ['docker', 'Tencent fallback image build/push', commandStatus.docker.available ? 'available' : 'missing'],
    ['tccli', 'Tencent fallback deploy', commandStatus.tccli.available ? 'available' : 'missing'],
    ['TENCENTCLOUD_SECRET_ID/KEY', 'non-interactive CloudBase/Tencent deploy', hasTencentCloudApiCredential() ? 'present' : 'missing'],
    ['psql', 'database migration and sync', commandStatus.psql.available ? 'available' : 'missing'],
    ['pg_dump', 'prod-to-pre export', commandStatus.pgDump.available ? 'available' : 'missing'],
    ['pg_restore', 'prod-to-pre restore', commandStatus.pgRestore.available ? 'available' : 'missing']
  ]

  return renderTable(rows)
}

function renderEnvironmentReport(report) {
  return [
    `### ${report.environment}`,
    '',
    `Local override: ${report.localOverrideLoaded ? 'loaded' : 'not present'}`,
    '',
    renderSection('Blockers', report.blockers),
    renderSection('Warnings', report.warnings),
    renderSection('Passes', report.passes),
    ''
  ]
}

function renderSection(title, items) {
  if (!items.length) {
    return `### ${title}\n\n- None`
  }

  return [
    `### ${title}`,
    '',
    ...items.map((item) => `- ${item}`)
  ].join('\n')
}

function renderTable(rows) {
  return rows
    .map((row, index) => {
      const escaped = row.map((cell) => String(cell).replace(/\|/g, '\\|'))

      if (index === 0) {
        return `${renderTableRow(escaped)}\n${renderTableRow(row.map(() => '---'))}`
      }

      return renderTableRow(escaped)
    })
    .join('\n')
}

function renderTableRow(row) {
  return `| ${row.join(' | ')} |`
}

function renderConsoleSummary(report) {
  const result = report.blockerCount === 0 ? 'READY' : 'BLOCKED'
  return `Production readiness audit: ${result} (${report.blockerCount} blockers, ${report.warningCount} warnings)`
}

function statusLabel(report) {
  if (report.blockers.length) {
    return 'BLOCKED'
  }

  if (report.warnings.length) {
    return 'WARN'
  }

  return 'PASS'
}

function getRequestedEnvironments() {
  if (process.argv.includes('--all')) {
    return VALID_ENVIRONMENTS
  }

  const requested = []

  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === '--env' && process.argv[index + 1]) {
      requested.push(...process.argv[index + 1].split(','))
    }
  }

  const values = requested.length ? requested : ['pre', 'prod']
  return [...new Set(values.map((value) => normalizeEnvironmentName(value)))]
}

function getArgValue(name) {
  const index = process.argv.findIndex((arg) => arg === name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function defaultJsonOutputPath(markdownPath) {
  return /\.md$/i.test(markdownPath)
    ? markdownPath.replace(/\.md$/i, '.json')
    : `${markdownPath}.json`
}

function relativePath(path) {
  return path.replace(`${process.cwd()}/`, '')
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item'
}

function hasRealValue(value) {
  return Boolean(value) && !containsPlaceholder(value)
}

function startsWithHttps(value = '') {
  return String(value || '').startsWith('https://')
}

function allOriginsAreHttps(value = '') {
  return String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .every((origin) => origin.startsWith('https://'))
}

function parseNonNegativeInteger(value = '') {
  const normalized = String(value || '').trim()

  if (!/^\d+$/.test(normalized)) {
    return {
      valid: false,
      value: 0
    }
  }

  const parsed = Number(normalized)

  return {
    valid: Number.isSafeInteger(parsed) && parsed >= 0,
    value: parsed
  }
}

function parseBooleanSetting(value = '') {
  const normalized = String(value || '').trim().toLowerCase()

  if (normalized === 'true') {
    return {
      valid: true,
      value: true
    }
  }

  if (normalized === 'false') {
    return {
      valid: true,
      value: false
    }
  }

  return {
    valid: false,
    value: false
  }
}

function parseRegionDatasetSetting(value = '') {
  const raw = String(value || '').trim()

  if (!raw) {
    return {
      valid: false,
      reason: 'value is empty',
      count: 0
    }
  }

  if (containsPlaceholder(raw)) {
    return {
      valid: false,
      reason: 'value still contains a placeholder',
      count: 0
    }
  }

  if (!raw.startsWith('[')) {
    return {
      valid: false,
      reason: 'value must be JSON array text, not a dataset label',
      count: 0
    }
  }

  try {
    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return {
        valid: false,
        reason: 'JSON value is not an array',
        count: 0
      }
    }

    if (!parsed.length) {
      return {
        valid: false,
        reason: 'array is empty',
        count: 0
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
        reason: `entry ${invalidIndex + 1} must include adcode or streetName plus communityId or streetId`,
        count: parsed.length
      }
    }

    return {
      valid: true,
      reason: '',
      count: parsed.length
    }
  } catch (error) {
    return {
      valid: false,
      reason: 'value is not valid JSON',
      count: 0
    }
  }
}

function parseTrustedProxyListSetting(value = '') {
  const normalized = String(value || '').trim()

  if (!normalized || normalized.toLowerCase() === 'none') {
    return {
      valid: true,
      reason: '',
      count: 0
    }
  }

  if (containsPlaceholder(normalized)) {
    return {
      valid: true,
      reason: '',
      count: normalized.split(',').map((entry) => entry.trim()).filter(Boolean).length
    }
  }

  const entries = normalized.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const invalid = entries.find((entry) => !isTrustedProxyEntry(entry))

  if (invalid) {
    return {
      valid: false,
      reason: `invalid entry ${invalid}`,
      count: entries.length
    }
  }

  return {
    valid: true,
    reason: '',
    count: entries.length
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

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function isDirectory(path) {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

function countItems(items) {
  return items.length
}
