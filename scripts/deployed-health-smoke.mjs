import {
  containsPlaceholder,
  normalizeEnvironmentName,
  readEnvironmentFile
} from './env-files.mjs'

const environment = getEnvironmentArg()
const values = await readEnvironmentFile(environment)
const apiBaseUrl = normalizeBaseUrl(process.env.GOODS_COMM_SMOKE_API_BASE_URL || values.VITE_API_BASE_URL)

validateInputs()

const health = await getJson('/health')
assertEqual(health.environment, environment, 'health.environment')

if (['pre', 'prod'].includes(environment)) {
  assertEqual(health.stateStore, 'postgres', 'health.stateStore')
  assertEqual(health.objectStore, 'cos', 'health.objectStore')
  assertEqual(health.contentSafety, 'wechat', 'health.contentSafety')
  assertEqual(health.mapProvider, 'tencent', 'health.mapProvider')
  assertEqual(health.platformNotify, 'wechat', 'health.platformNotify')
}

const ready = await getJson('/health/ready')
assertEqual(ready.ok, true, 'ready.ok')
assertEqual(ready.environment, environment, 'ready.environment')

if (['pre', 'prod'].includes(environment)) {
  assertEqual(ready.stateStore, 'postgres', 'ready.stateStore')
  assertEqual(ready.objectStore, 'cos', 'ready.objectStore')
  assertEqual(ready.contentSafety, 'wechat', 'ready.contentSafety')
  assertEqual(ready.mapProvider, 'tencent', 'ready.mapProvider')
  assertEqual(ready.platformNotify, 'wechat', 'ready.platformNotify')
  assertPostgresReadiness(ready.readiness)
}

console.log(`Deployed backend health smoke passed for ${environment}: ${apiBaseUrl}`)

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

  return body.data
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual}`)
  }
}

function assertPostgresReadiness(readiness = {}) {
  assertEqual(readiness.mode, 'normalized_snapshot_rewrite', 'ready.readiness.mode')
  assertEqual(readiness.autoSchema, false, 'ready.readiness.autoSchema')

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

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '')
}

function getEnvironmentArg() {
  const envIndex = process.argv.findIndex((arg) => arg === '--env')
  const value = envIndex >= 0 ? process.argv[envIndex + 1] : process.argv[2]

  return normalizeEnvironmentName(value || process.env.GOODS_COMM_ENV || 'pre')
}
