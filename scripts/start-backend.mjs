import { loadEnvironmentFile, normalizeEnvironmentName } from './env-files.mjs'

const environment = getEnvironmentArg()
await loadEnvironmentFile(environment)

const { startGoodsCommServer } = await import('../backend/src/server.mjs')
const runtime = await startGoodsCommServer({
  environment
})

console.log(`goods-comm backend (${environment}) listening on ${runtime.url}`)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    runtime.server.close(() => process.exit(0))
  })
}

function getEnvironmentArg() {
  const envIndex = process.argv.findIndex((arg) => arg === '--env')
  const value = envIndex >= 0 ? process.argv[envIndex + 1] : process.argv[2]

  return normalizeEnvironmentName(value || process.env.GOODS_COMM_ENV || 'dev')
}
