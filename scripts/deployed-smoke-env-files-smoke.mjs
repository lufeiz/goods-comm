import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadSmokeEnvironmentFile,
  readSmokeEnvironmentFile,
  smokeEnvLocalFilePath
} from './env-files.mjs'

const originalCwd = process.cwd()
const touchedEnvKeys = [
  'GOODS_COMM_SMOKE_SELLER_CODE',
  'GOODS_COMM_SMOKE_BUYER_CODE',
  'GOODS_COMM_SMOKE_LATITUDE',
  'GOODS_COMM_SMOKE_LONGITUDE'
]
const originalEnv = Object.fromEntries(touchedEnvKeys.map((key) => [key, process.env[key]]))
const tempRoot = await mkdtemp(join(tmpdir(), 'goods-comm-smoke-env-'))

try {
  process.chdir(tempRoot)
  await writeFile('.env.smoke.pre.local', [
    'GOODS_COMM_SMOKE_SELLER_CODE=file-seller-code',
    'GOODS_COMM_SMOKE_BUYER_CODE=file-buyer-code',
    'GOODS_COMM_SMOKE_LATITUDE=31.22945',
    'GOODS_COMM_SMOKE_LONGITUDE=121.45494'
  ].join('\n'))

  assert.equal(smokeEnvLocalFilePath('pre'), join(process.cwd(), '.env.smoke.pre.local'))

  const values = await readSmokeEnvironmentFile('pre')
  assert.equal(values.GOODS_COMM_SMOKE_SELLER_CODE, 'file-seller-code')
  assert.equal(values.GOODS_COMM_SMOKE_BUYER_CODE, 'file-buyer-code')

  process.env.GOODS_COMM_SMOKE_SELLER_CODE = 'shell-seller-code'
  process.env.GOODS_COMM_SMOKE_BUYER_CODE = ''
  await loadSmokeEnvironmentFile('pre')

  assert.equal(process.env.GOODS_COMM_SMOKE_SELLER_CODE, 'shell-seller-code')
  assert.equal(process.env.GOODS_COMM_SMOKE_BUYER_CODE, 'file-buyer-code')
  assert.equal(process.env.GOODS_COMM_SMOKE_LATITUDE, '31.22945')
  assert.equal(process.env.GOODS_COMM_SMOKE_LONGITUDE, '121.45494')
  assert.deepEqual(await readSmokeEnvironmentFile('prod'), {})
} finally {
  process.chdir(originalCwd)

  for (const key of touchedEnvKeys) {
    if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }

  await rm(tempRoot, {
    recursive: true,
    force: true
  })
}

console.log('Deployed smoke env file checks passed')
