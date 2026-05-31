import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { startGoodsCommServer } from '../backend/src/server.mjs'

const runId = `local-deployed-main-${Date.now()}`
const statePath = resolve(`/private/tmp/goods-comm-${runId}.json`)
const objectRootDir = resolve(`/private/tmp/goods-comm-${runId}-objects`)

await rm(statePath, {
  force: true
})
await rm(objectRootDir, {
  recursive: true,
  force: true
})

const runtime = await startGoodsCommServer({
  port: 0,
  environment: 'dev',
  statePath,
  objectRootDir,
  allowedOrigins: ['http://127.0.0.1:5173', 'http://127.0.0.1:8787']
})

try {
  await runDeployedMainFlowSmoke(runtime.url, runId)
  console.log('Local deployed main-flow smoke checks passed')
} finally {
  await new Promise((resolveClose) => runtime.server.close(resolveClose))
  await rm(statePath, {
    force: true
  })
  await rm(objectRootDir, {
    recursive: true,
    force: true
  })
}

async function runDeployedMainFlowSmoke(apiBaseUrl, smokeRunId) {
  const child = spawn(process.execPath, ['scripts/deployed-main-flow-smoke.mjs', '--env', 'dev'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GOODS_COMM_SMOKE_API_BASE_URL: apiBaseUrl,
      GOODS_COMM_SMOKE_SELLER_CODE: `${smokeRunId}:seller`,
      GOODS_COMM_SMOKE_BUYER_CODE: `${smokeRunId}:buyer`,
      GOODS_COMM_SMOKE_LATITUDE: '31.22945',
      GOODS_COMM_SMOKE_LONGITUDE: '121.45494',
      GOODS_COMM_SMOKE_ACCURACY: '35',
      GOODS_COMM_SMOKE_CAPTURED_AT: String(Date.now()),
      GOODS_COMM_SMOKE_ACCOUNT_DELETE_CODE: `${smokeRunId}:account-delete:one-time:delete`,
      GOODS_COMM_SMOKE_ACCOUNT_DELETE_RELOGIN_CODE: `${smokeRunId}:account-delete:one-time:relogin`,
      GOODS_COMM_SMOKE_RUN_ID: smokeRunId
    },
    stdio: 'inherit'
  })

  const status = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code))
  })

  if (status !== 0) {
    throw new Error(`deployed main-flow smoke local run failed with exit code ${status}`)
  }
}
