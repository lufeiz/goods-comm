import { isIP } from 'node:net'
import { readEnvironmentFile, VALID_ENVIRONMENTS, normalizeEnvironmentName, containsPlaceholder, maskConnectionString } from './env-files.mjs'

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
const environments = requested.length ? requested.map(normalizeEnvironmentName) : VALID_ENVIRONMENTS
const requiredKeys = [
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

const loaded = new Map()
const errors = []
const warnings = []

for (const environment of environments) {
  let values

  try {
    values = await readEnvironmentFile(environment)
  } catch (error) {
    errors.push(`[${environment}] cannot read .env.${environment}: ${error.message}`)
    continue
  }

  loaded.set(environment, values)

  for (const key of requiredKeys) {
    if (!values[key]) {
      errors.push(`[${environment}] missing ${key}`)
    }
  }

  if (values.GOODS_COMM_ENV !== environment) {
    errors.push(`[${environment}] GOODS_COMM_ENV must equal ${environment}`)
  }

  if (values.VITE_APP_ENV !== environment) {
    errors.push(`[${environment}] VITE_APP_ENV must equal ${environment}`)
  }

  if (['test', 'pre', 'prod'].includes(environment) && !values.VITE_API_BASE_URL?.startsWith('https://')) {
    errors.push(`[${environment}] VITE_API_BASE_URL must be HTTPS outside dev`)
  }

  if (['pre', 'prod'].includes(environment) && !values.GOODS_COMM_PUBLIC_ASSET_BASE_URL?.startsWith('https://')) {
    errors.push(`[${environment}] GOODS_COMM_PUBLIC_ASSET_BASE_URL must be HTTPS`)
  }

  if (!['file', 'postgres'].includes(values.GOODS_COMM_STATE_STORE)) {
    errors.push(`[${environment}] GOODS_COMM_STATE_STORE must be file or postgres`)
  }

  if (['pre', 'prod'].includes(environment) && values.GOODS_COMM_STATE_STORE !== 'postgres') {
    errors.push(`[${environment}] GOODS_COMM_STATE_STORE must be postgres`)
  }

  if (!isNonNegativeInteger(values.GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS)) {
    errors.push(`[${environment}] GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS must be a non-negative integer`)
  }

  if (!isPositiveInteger(values.GOODS_COMM_MAX_REQUEST_BYTES)) {
    errors.push(`[${environment}] GOODS_COMM_MAX_REQUEST_BYTES must be a positive integer`)
  }

  for (const key of ['GOODS_COMM_RATE_LIMIT_MAX_REQUESTS', 'GOODS_COMM_RATE_LIMIT_WINDOW_MS']) {
    if (!isPositiveInteger(values[key])) {
      errors.push(`[${environment}] ${key} must be a positive integer`)
    }
  }

  if (!containsPlaceholder(values.GOODS_COMM_TRUSTED_PROXY_IPS) && !isTrustedProxyListValue(values.GOODS_COMM_TRUSTED_PROXY_IPS)) {
    errors.push(`[${environment}] GOODS_COMM_TRUSTED_PROXY_IPS must be "none" or a comma-separated list of IPs/IPv4 CIDRs`)
  }

  for (const key of ['GOODS_COMM_OPS_LOGIN_MAX_FAILURES', 'GOODS_COMM_OPS_LOGIN_WINDOW_MS', 'GOODS_COMM_OPS_LOGIN_LOCK_MS']) {
    if (!isPositiveInteger(values[key])) {
      errors.push(`[${environment}] ${key} must be a positive integer`)
    }
  }

  if (!isBooleanString(values.GOODS_COMM_POSTGRES_AUTO_SCHEMA)) {
    errors.push(`[${environment}] GOODS_COMM_POSTGRES_AUTO_SCHEMA must be true or false`)
  }

  if (['pre', 'prod'].includes(environment) && values.GOODS_COMM_STATE_STORE === 'postgres' && values.GOODS_COMM_POSTGRES_AUTO_SCHEMA !== 'false') {
    errors.push(`[${environment}] GOODS_COMM_POSTGRES_AUTO_SCHEMA must be false; run database migration before backend startup`)
  }

  if (!['local', 'cos'].includes(values.GOODS_COMM_OBJECT_STORE)) {
    errors.push(`[${environment}] GOODS_COMM_OBJECT_STORE must be local or cos`)
  }

  if (['pre', 'prod'].includes(environment) && values.GOODS_COMM_OBJECT_STORE !== 'cos') {
    errors.push(`[${environment}] GOODS_COMM_OBJECT_STORE must be cos`)
  }

  if (['pre', 'prod'].includes(environment) && !values.GOODS_COMM_CDN_BASE_URL?.startsWith('https://')) {
    errors.push(`[${environment}] GOODS_COMM_CDN_BASE_URL must be HTTPS`)
  }

  if (!['mock', 'wechat'].includes(values.GOODS_COMM_CONTENT_SECURITY_PROVIDER)) {
    errors.push(`[${environment}] GOODS_COMM_CONTENT_SECURITY_PROVIDER must be mock or wechat`)
  }

  if (['pre', 'prod'].includes(environment) && values.GOODS_COMM_CONTENT_SECURITY_PROVIDER !== 'wechat') {
    errors.push(`[${environment}] GOODS_COMM_CONTENT_SECURITY_PROVIDER must be wechat`)
  }

  if (!['mock', 'tencent'].includes(values.GOODS_COMM_MAP_PROVIDER)) {
    errors.push(`[${environment}] GOODS_COMM_MAP_PROVIDER must be mock or tencent`)
  }

  if (['pre', 'prod'].includes(environment) && values.GOODS_COMM_MAP_PROVIDER !== 'tencent') {
    errors.push(`[${environment}] GOODS_COMM_MAP_PROVIDER must be tencent`)
  }

  if (!['demo', 'platform'].includes(values.GOODS_COMM_PLATFORM_AUTH_MODE)) {
    errors.push(`[${environment}] GOODS_COMM_PLATFORM_AUTH_MODE must be demo or platform`)
  }

  if (['pre', 'prod'].includes(environment) && values.GOODS_COMM_PLATFORM_AUTH_MODE !== 'platform') {
    errors.push(`[${environment}] GOODS_COMM_PLATFORM_AUTH_MODE must be platform`)
  }

  if (!['mock', 'wechat'].includes(values.GOODS_COMM_PLATFORM_NOTIFY_PROVIDER)) {
    errors.push(`[${environment}] GOODS_COMM_PLATFORM_NOTIFY_PROVIDER must be mock or wechat`)
  }

  if (['pre', 'prod'].includes(environment) && values.GOODS_COMM_PLATFORM_NOTIFY_PROVIDER !== 'wechat') {
    errors.push(`[${environment}] GOODS_COMM_PLATFORM_NOTIFY_PROVIDER must be wechat`)
  }

  for (const [key, value] of Object.entries(values)) {
    if (containsPlaceholder(value)) {
      warnings.push(`[${environment}] ${key} still uses a placeholder: ${maskValue(key, value)}`)
    }
  }
}

const pre = loaded.get('pre')
const prod = loaded.get('prod')

if (pre && prod) {
  if (pre.GOODS_COMM_DATABASE_URL === prod.GOODS_COMM_DATABASE_URL) {
    errors.push('[pre/prod] GOODS_COMM_DATABASE_URL must point to two different databases')
  }

  if (pre.GOODS_COMM_COS_BUCKET === prod.GOODS_COMM_COS_BUCKET) {
    errors.push('[pre/prod] GOODS_COMM_COS_BUCKET must be separate buckets')
  }
}

if (warnings.length) {
  console.warn('Environment warnings:')
  for (const warning of warnings) {
    console.warn(`- ${warning}`)
  }
}

if (errors.length) {
  console.error('Environment check failed:')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log(`Environment check passed for ${environments.join(', ')}`)

function maskValue(key, value) {
  if (/DATABASE_URL/i.test(key)) {
    return maskConnectionString(value)
  }

  return value
}

function isBooleanString(value = '') {
  return ['true', 'false'].includes(String(value || '').trim().toLowerCase())
}

function isNonNegativeInteger(value = '') {
  return /^\d+$/.test(String(value || '').trim())
}

function isPositiveInteger(value = '') {
  return /^[1-9]\d*$/.test(String(value || '').trim())
}

function isTrustedProxyListValue(value = '') {
  const normalized = String(value || '').trim()

  if (!normalized || normalized.toLowerCase() === 'none') {
    return true
  }

  return normalized.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .every(isTrustedProxyEntry)
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
