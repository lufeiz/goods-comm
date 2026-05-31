import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseEnvFile } from './env-files.mjs'

const REQUIRED_MAIN_FLOW_KEYS = [
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
  'GOODS_COMM_SMOKE_RUN_ID',
  'GOODS_COMM_SMOKE_APPROVED_IMAGE_URL',
  'GOODS_COMM_SMOKE_APPROVED_IMAGE_STORAGE_KEY',
  'GOODS_COMM_SMOKE_APPROVED_IMAGE_SIZE',
  'GOODS_COMM_SMOKE_APPROVED_IMAGE_MIME_TYPE',
  'GOODS_COMM_SMOKE_APPROVED_IMAGE_CHECKSUM',
  'GOODS_COMM_SMOKE_ACCOUNT_DELETE_PROVIDER',
  'GOODS_COMM_SMOKE_ACCOUNT_DELETE_CODE',
  'GOODS_COMM_SMOKE_ACCOUNT_DELETE_RELOGIN_CODE'
]

const REQUIRED_HEALTH_KEYS = [
  'GOODS_COMM_SMOKE_HEALTH_ATTEMPTS',
  'GOODS_COMM_SMOKE_HEALTH_INTERVAL_MS'
]

const environmentTemplates = {
  pre: '.env.smoke.pre.example',
  prod: '.env.smoke.prod.example'
}

for (const [environment, file] of Object.entries(environmentTemplates)) {
  const raw = await readFile(resolve(process.cwd(), file), 'utf8')
  const values = parseEnvFile(raw)

  assert.match(raw, new RegExp(`Copy to \\.env\\.smoke\\.${environment}\\.local`), `${file}: copy instruction is missing`)
  assert.match(raw, new RegExp(`Do not commit \\.env\\.smoke\\.${environment}\\.local\\.`), `${file}: secret warning is missing`)
  assert.match(raw, new RegExp(`Deployed smoke scripts auto-load \\.env\\.smoke\\.${environment}\\.local`), `${file}: auto-load instruction is missing`)

  for (const key of [...REQUIRED_MAIN_FLOW_KEYS, ...REQUIRED_HEALTH_KEYS]) {
    assert.ok(hasKey(values, key), `${file}: missing ${key}`)
  }

  assertHttpsUrl(values.GOODS_COMM_SMOKE_API_BASE_URL, `${file}: GOODS_COMM_SMOKE_API_BASE_URL`)
  assertHttpsUrl(values.GOODS_COMM_SMOKE_APPROVED_IMAGE_URL, `${file}: GOODS_COMM_SMOKE_APPROVED_IMAGE_URL`)
  assertProvider(values.GOODS_COMM_SMOKE_SELLER_PROVIDER, `${file}: GOODS_COMM_SMOKE_SELLER_PROVIDER`)
  assertProvider(values.GOODS_COMM_SMOKE_BUYER_PROVIDER, `${file}: GOODS_COMM_SMOKE_BUYER_PROVIDER`)
  assertProvider(values.GOODS_COMM_SMOKE_ACCOUNT_DELETE_PROVIDER, `${file}: GOODS_COMM_SMOKE_ACCOUNT_DELETE_PROVIDER`)
  assertRange(values.GOODS_COMM_SMOKE_LATITUDE, -90, 90, `${file}: GOODS_COMM_SMOKE_LATITUDE`)
  assertRange(values.GOODS_COMM_SMOKE_LONGITUDE, -180, 180, `${file}: GOODS_COMM_SMOKE_LONGITUDE`)
  assertPositiveNumber(values.GOODS_COMM_SMOKE_ACCURACY, `${file}: GOODS_COMM_SMOKE_ACCURACY`)
  assertPositiveInteger(values.GOODS_COMM_SMOKE_RADIUS_METERS, `${file}: GOODS_COMM_SMOKE_RADIUS_METERS`)
  assertPositiveInteger(values.GOODS_COMM_SMOKE_HEALTH_ATTEMPTS, `${file}: GOODS_COMM_SMOKE_HEALTH_ATTEMPTS`)
  assertPositiveInteger(values.GOODS_COMM_SMOKE_HEALTH_INTERVAL_MS, `${file}: GOODS_COMM_SMOKE_HEALTH_INTERVAL_MS`)
  assertPositiveInteger(values.GOODS_COMM_SMOKE_APPROVED_IMAGE_SIZE, `${file}: GOODS_COMM_SMOKE_APPROVED_IMAGE_SIZE`)
  assert.ok(['community', 'street'].includes(values.GOODS_COMM_SMOKE_SCOPE_TYPE), `${file}: GOODS_COMM_SMOKE_SCOPE_TYPE must be community or street`)
  assert.equal(values.GOODS_COMM_SMOKE_APPROVED_IMAGE_MIME_TYPE, 'image/jpeg', `${file}: approved image mime type should stay image/jpeg`)
  assert.notEqual(values.GOODS_COMM_SMOKE_SELLER_CODE, values.GOODS_COMM_SMOKE_BUYER_CODE, `${file}: seller and buyer code placeholders must differ`)
  assert.notEqual(values.GOODS_COMM_SMOKE_ACCOUNT_DELETE_CODE, values.GOODS_COMM_SMOKE_SELLER_CODE, `${file}: account delete code placeholder must differ from seller code`)
  assert.notEqual(values.GOODS_COMM_SMOKE_ACCOUNT_DELETE_CODE, values.GOODS_COMM_SMOKE_BUYER_CODE, `${file}: account delete code placeholder must differ from buyer code`)
  assert.notEqual(values.GOODS_COMM_SMOKE_ACCOUNT_DELETE_RELOGIN_CODE, values.GOODS_COMM_SMOKE_SELLER_CODE, `${file}: account delete relogin code placeholder must differ from seller code`)
  assert.notEqual(values.GOODS_COMM_SMOKE_ACCOUNT_DELETE_RELOGIN_CODE, values.GOODS_COMM_SMOKE_BUYER_CODE, `${file}: account delete relogin code placeholder must differ from buyer code`)
  assert.notEqual(values.GOODS_COMM_SMOKE_ACCOUNT_DELETE_RELOGIN_CODE, values.GOODS_COMM_SMOKE_ACCOUNT_DELETE_CODE, `${file}: account delete relogin code should be a second one-time code`)

  if (environment === 'prod') {
    assert.ok(hasKey(values, 'GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION'), `${file}: missing GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION`)
    assert.equal(values.GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION, 'false', `${file}: production mutation opt-in must default to false`)
  } else {
    assert.ok(!hasKey(values, 'GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION'), `${file}: non-production template should not include production mutation opt-in`)
  }
}

console.log('Deployed smoke input template checks passed')

function hasKey(values, key) {
  return Object.prototype.hasOwnProperty.call(values, key)
}

function assertHttpsUrl(value, label) {
  assert.ok(String(value || '').startsWith('https://'), `${label} must be an HTTPS URL`)
}

function assertProvider(value, label) {
  assert.ok(['weixin', 'alipay'].includes(value), `${label} must be weixin or alipay`)
}

function assertRange(value, min, max, label) {
  const numericValue = Number(value)

  assert.ok(Number.isFinite(numericValue), `${label} must be numeric`)
  assert.ok(numericValue >= min && numericValue <= max, `${label} must be between ${min} and ${max}`)
}

function assertPositiveNumber(value, label) {
  const numericValue = Number(value)

  assert.ok(Number.isFinite(numericValue) && numericValue > 0, `${label} must be a positive number`)
}

function assertPositiveInteger(value, label) {
  const numericValue = Number(value)

  assert.ok(Number.isSafeInteger(numericValue) && numericValue > 0, `${label} must be a positive integer`)
}
