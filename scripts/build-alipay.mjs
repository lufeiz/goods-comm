import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { readEnvironmentFile } from './env-files.mjs'
import { patchMiniProgramAppId } from './mini-program-deploy-config.mjs'

const mode = parseMode(process.argv.slice(2))
const tempOutDir = resolve('/private/tmp', `goods-comm-mp-alipay-build${mode ? `-${mode}` : ''}`)
const targetBuildDir = mode ? resolve('dist/build', mode, 'mp-alipay') : resolve('dist/build/mp-alipay')
const uniBin = resolve('node_modules/.bin/uni')
const args = ['build', '-p', 'mp-alipay', '--outDir', tempOutDir]

if (mode) {
  args.push('--mode', mode)
}

rmSync(tempOutDir, { recursive: true, force: true })

const result = spawnSync(uniBin, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    ...(mode ? { GOODS_COMM_ENV: mode } : {})
  }
})

if (result.status !== 0) {
  process.exit(result.status || 1)
}

if (!existsSync(tempOutDir)) {
  console.error(`Build output not found: ${tempOutDir}`)
  process.exit(1)
}

rmSync(targetBuildDir, { recursive: true, force: true })
mkdirSync(targetBuildDir, { recursive: true })
cpSync(tempOutDir, targetBuildDir, {
  recursive: true
})

const values = mode ? await readEnvironmentFile(mode) : process.env
const appIdPatch = await patchMiniProgramAppId({
  platform: 'mp-alipay',
  directory: targetBuildDir,
  values
})

if (appIdPatch.patched) {
  console.log(`Alipay mini.project.json appid set to ${appIdPatch.appid}`)
}

console.log(`Alipay build artifact copied to ${targetBuildDir}`)

function parseMode(args) {
  const modeIndex = args.findIndex((arg) => arg === '--mode')
  const value = modeIndex >= 0 ? args[modeIndex + 1] : ''

  if (!value) {
    return ''
  }

  if (!['dev', 'test', 'pre', 'prod'].includes(value)) {
    console.error(`Invalid mode: ${value}`)
    process.exit(1)
  }

  return value
}
