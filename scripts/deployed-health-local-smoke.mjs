import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { startGoodsCommServer } from '../backend/src/server.mjs'

const runId = `local-deployed-health-${Date.now()}`
const statePath = resolve(tmpdir(), `goods-comm-${runId}.json`)
const objectRootDir = resolve(tmpdir(), `goods-comm-${runId}-objects`)

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
  await runDeployedHealthSmoke(runtime.url)
  console.log('Local deployed health smoke checks passed')
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

async function runDeployedHealthSmoke(apiBaseUrl) {
  const child = spawn(process.execPath, ['scripts/deployed-health-smoke.mjs', '--env', 'dev'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GOODS_COMM_SMOKE_API_BASE_URL: apiBaseUrl
    },
    stdio: 'inherit'
  })

  const status = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code))
  })

  if (status !== 0) {
    throw new Error(`deployed health smoke local run failed with exit code ${status}`)
  }
}
