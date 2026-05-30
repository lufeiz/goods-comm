import {
  containsPlaceholder,
  normalizeEnvironmentName,
  readEnvironmentFile
} from './env-files.mjs'

const environment = getEnvironmentArg()
const values = await readEnvironmentFile(environment)
const apiBaseUrl = normalizeBaseUrl(process.env.GOODS_COMM_SMOKE_API_BASE_URL || values.VITE_API_BASE_URL)
const attempts = parsePositiveInteger(getArgValue('--attempts') || process.env.GOODS_COMM_SMOKE_HEALTH_ATTEMPTS || '1', 'GOODS_COMM_SMOKE_HEALTH_ATTEMPTS')
const intervalMs = parsePositiveInteger(getArgValue('--interval-ms') || process.env.GOODS_COMM_SMOKE_HEALTH_INTERVAL_MS || '5000', 'GOODS_COMM_SMOKE_HEALTH_INTERVAL_MS')

validateInputs()
await waitForHealthy()

console.log(`Deployed backend health smoke passed for ${environment}: ${apiBaseUrl}`)

async function waitForHealthy() {
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await assertHealthy()
      return
    } catch (error) {
      lastError = error

      if (attempt >= attempts) {
        break
      }

      console.warn(`Deployed health smoke attempt ${attempt}/${attempts} failed: ${error.message}; retrying in ${intervalMs}ms`)
      await sleep(intervalMs)
    }
  }

  throw lastError
}

async function assertHealthy() {
  const health = await getJson('/health')
  assertSecurityHeaders(health.headers, '/health')
  assertEqual(health.data.environment, environment, 'health.environment')

  if (['pre', 'prod'].includes(environment)) {
    assertEqual(health.data.stateStore, 'postgres', 'health.stateStore')
    assertEqual(health.data.objectStore, 'cos', 'health.objectStore')
    assertEqual(health.data.contentSafety, 'wechat', 'health.contentSafety')
    assertEqual(health.data.mapProvider, 'tencent', 'health.mapProvider')
    assertEqual(health.data.platformNotify, 'wechat', 'health.platformNotify')
    assertEqual(health.data.opsAlert, 'webhook', 'health.opsAlert')
    assertEqual(health.data.accessLog?.enabled, true, 'health.accessLog.enabled')
  }

  const ready = await getJson('/health/ready')
  assertSecurityHeaders(ready.headers, '/health/ready')
  assertEqual(ready.data.ok, true, 'ready.ok')
  assertEqual(ready.data.environment, environment, 'ready.environment')

  if (['pre', 'prod'].includes(environment)) {
    assertEqual(ready.data.stateStore, 'postgres', 'ready.stateStore')
    assertEqual(ready.data.objectStore, 'cos', 'ready.objectStore')
    assertEqual(ready.data.contentSafety, 'wechat', 'ready.contentSafety')
    assertEqual(ready.data.mapProvider, 'tencent', 'ready.mapProvider')
    assertEqual(ready.data.platformNotify, 'wechat', 'ready.platformNotify')
    assertEqual(ready.data.opsAlert, 'webhook', 'ready.opsAlert')
    assertEqual(ready.data.accessLog?.enabled, true, 'ready.accessLog.enabled')
    assertEqual(ready.data.opsAlertReadiness?.ok, true, 'ready.opsAlertReadiness.ok')
    assertEqual(ready.data.opsAlertReadiness?.provider, 'webhook', 'ready.opsAlertReadiness.provider')
    assertPostgresReadiness(ready.data.readiness)
  }
}

function validateInputs() {
  if (!apiBaseUrl) {
    throw new Error(`[${environment}] VITE_API_BASE_URL is required for deployed health smoke`)
  }

  if (containsPlaceholder(apiBaseUrl)) {
    throw new Error(`[${environment}] VITE_API_BASE_URL still contains a placeholder`)
  }

  if (['test', 'pre', 'prod'].includes(environment) && !apiBaseUrl.startsWith('https://')) {
    throw new Error(`[${environment}] deployed health smoke requires HTTPS VITE_API_BASE_URL`)
  }
}

async function getJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      Accept: 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`)
  }

  const body = await response.json()

  if (!body?.data) {
    throw new Error(`${path} response did not include data`)
  }

  return {
    data: body.data,
    headers: response.headers
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual}`)
  }
}

function assertPostgresReadiness(readiness = {}) {
  assertEqual(readiness.mode, 'normalized_snapshot_rewrite', 'ready.readiness.mode')
  assertEqual(readiness.autoSchema, false, 'ready.readiness.autoSchema')
  assertEqual(readiness.snapshotWriteLock, 'pg_advisory_xact_lock', 'ready.readiness.snapshotWriteLock')

  const snapshotRowLimit = Number(readiness.snapshotRowLimit)
  if (!Number.isSafeInteger(snapshotRowLimit) || snapshotRowLimit <= 0) {
    throw new Error(`ready.readiness.snapshotRowLimit must be a positive integer, got ${readiness.snapshotRowLimit}`)
  }

  const currentRowCount = Number(readiness.currentRowCount)
  if (!Number.isSafeInteger(currentRowCount) || currentRowCount < 0) {
    throw new Error(`ready.readiness.currentRowCount must be a non-negative integer, got ${readiness.currentRowCount}`)
  }

  if (currentRowCount > snapshotRowLimit) {
    throw new Error(`ready.readiness.currentRowCount ${currentRowCount} exceeds snapshotRowLimit ${snapshotRowLimit}`)
  }

  if (!readiness.rowCounts || Array.isArray(readiness.rowCounts) || typeof readiness.rowCounts !== 'object') {
    throw new Error('ready.readiness.rowCounts must be an object')
  }

  const rowCountTotal = Object.values(readiness.rowCounts).reduce((total, value) => {
    const numericValue = Number(value)

    if (!Number.isSafeInteger(numericValue) || numericValue < 0) {
      throw new Error(`ready.readiness.rowCounts must contain non-negative integers, got ${value}`)
    }

    return total + numericValue
  }, 0)

  if (rowCountTotal !== currentRowCount) {
    throw new Error(`ready.readiness.rowCounts total ${rowCountTotal} does not equal currentRowCount ${currentRowCount}`)
  }
}

function assertSecurityHeaders(headers, path) {
  assertEqual(headers.get('x-content-type-options'), 'nosniff', `${path}.headers.x-content-type-options`)
  assertEqual(headers.get('x-frame-options'), 'DENY', `${path}.headers.x-frame-options`)
  assertEqual(headers.get('referrer-policy'), 'no-referrer', `${path}.headers.referrer-policy`)
  assertRequiredHeaderDirectives(headers.get('permissions-policy') || '', [
    'geolocation=()',
    'camera=()',
    'microphone=()'
  ], `${path}.headers.permissions-policy`)

  const strictTransportSecurity = headers.get('strict-transport-security') || ''

  if (['pre', 'prod'].includes(environment)) {
    if (!/max-age=15552000\b/i.test(strictTransportSecurity) || !/includeSubDomains/i.test(strictTransportSecurity)) {
      throw new Error(`${path}.headers.strict-transport-security must include max-age=15552000 and includeSubDomains`)
    }
  } else if (strictTransportSecurity) {
    throw new Error(`${path}.headers.strict-transport-security should only be set for pre/prod, got ${strictTransportSecurity}`)
  }
}

function assertRequiredHeaderDirectives(value = '', directives = [], label) {
  for (const directive of directives) {
    if (!value.split(',').some((entry) => entry.trim() === directive)) {
      throw new Error(`${label} must include ${directive}, got ${value || 'empty'}`)
    }
  }
}

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '')
}

function parsePositiveInteger(value = '', label) {
  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer, got ${value}`)
  }

  return parsed
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getEnvironmentArg() {
  const envIndex = process.argv.findIndex((arg) => arg === '--env')
  const value = envIndex >= 0 ? process.argv[envIndex + 1] : process.argv[2]

  return normalizeEnvironmentName(value || process.env.GOODS_COMM_ENV || 'pre')
}

function getArgValue(name) {
  const index = process.argv.findIndex((arg) => arg === name)
  return index >= 0 ? process.argv[index + 1] : ''
}
