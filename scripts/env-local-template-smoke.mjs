import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseEnvFile } from './env-files.mjs'

const REQUIRED_OVERRIDE_KEYS = [
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

const environmentTemplates = {
  pre: '.env.pre.local.example',
  prod: '.env.prod.local.example'
}

for (const [environment, file] of Object.entries(environmentTemplates)) {
  const raw = await readFile(resolve(process.cwd(), file), 'utf8')
  const values = parseEnvFile(raw)

  assert.match(raw, new RegExp(`Copy to \\.env\\.${environment}\\.local`), `${file}: copy instruction is missing`)
  assert.match(raw, /Do not commit \.env\..+\.local\./, `${file}: secret warning is missing`)

  for (const key of REQUIRED_OVERRIDE_KEYS) {
    assert.ok(values[key], `${file}: missing ${key}`)
  }

  assert.equal(values.GOODS_COMM_STATE_STORE, 'postgres', `${file}: protected env must use PostgreSQL store`)
  assert.equal(values.GOODS_COMM_POSTGRES_AUTO_SCHEMA, 'false', `${file}: protected env must disable auto schema`)
  assert.equal(values.GOODS_COMM_OBJECT_STORE, 'cos', `${file}: protected env must use COS`)
  assert.equal(values.GOODS_COMM_MAP_PROVIDER, 'tencent', `${file}: protected env must use Tencent Maps`)
  assert.equal(values.GOODS_COMM_CONTENT_SECURITY_PROVIDER, 'wechat', `${file}: protected env must use WeChat content security`)
  assert.equal(values.GOODS_COMM_ALERT_PROVIDER, 'webhook', `${file}: protected env must use webhook alerts`)
  assert.equal(values.GOODS_COMM_ACCESS_LOG_ENABLED, 'true', `${file}: protected env must keep access logs enabled`)
  assert.equal(values.GOODS_COMM_PLATFORM_AUTH_MODE, 'platform', `${file}: protected env must use platform auth`)
  assert.equal(values.GOODS_COMM_PLATFORM_NOTIFY_PROVIDER, 'wechat', `${file}: protected env must use WeChat platform notifications`)

  assert.doesNotMatch(values.VITE_API_BASE_URL, /goods-comm\.example\.com/, `${file}: API URL should not reuse committed placeholder domain`)
  assert.doesNotMatch(values.GOODS_COMM_ALLOWED_ORIGINS, /goods-comm\.example\.com/, `${file}: origin should not reuse committed placeholder domain`)
  assert.doesNotMatch(values.GOODS_COMM_DATABASE_URL, /example\.internal/, `${file}: database URL should not reuse committed placeholder host`)
  assert.doesNotMatch(values.GOODS_COMM_COS_BUCKET, /placeholder/, `${file}: bucket should not reuse committed placeholder bucket`)

  const regionDataset = JSON.parse(values.GOODS_COMM_MAP_REGION_DATASET)
  assert.ok(Array.isArray(regionDataset) && regionDataset.length > 0, `${file}: region dataset must be a non-empty JSON array`)
  assert.ok(regionDataset.every((entry) => entry.communityId && entry.streetId), `${file}: region entries must include communityId and streetId`)
}

console.log('Environment local template smoke checks passed')
