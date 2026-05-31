import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { readEnvironmentFile } from './env-files.mjs'
import { patchMiniProgramAppId } from './mini-program-deploy-config.mjs'

const mode = parseMode(process.argv.slice(2))
const tempOutDir = resolve(tmpdir(), `goods-comm-mp-weixin-build${mode ? `-${mode}` : ''}`)
const tempBuildDir = tempOutDir
const targetBuildDir = mode ? resolve('dist/build', mode, 'mp-weixin') : resolve('dist/build/mp-weixin')
const projectConfigFileName = 'project.config.json'
const uniBin = resolve('node_modules/.bin/uni')
const args = ['build', '-p', 'mp-weixin', '--outDir', tempOutDir]

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

if (!existsSync(tempBuildDir)) {
  console.error(`Build output not found: ${tempBuildDir}`)
  process.exit(1)
}

mkdirSync(targetBuildDir, { recursive: true })
cpSync(tempBuildDir, targetBuildDir, {
  recursive: true,
  filter: (source) => !source.endsWith(`/${projectConfigFileName}`)
})

const targetProjectConfigPath = resolve(targetBuildDir, projectConfigFileName)
const generatedProjectConfigPath = resolve(tempBuildDir, projectConfigFileName)

if (!existsSync(targetProjectConfigPath) && existsSync(generatedProjectConfigPath)) {
  cpSync(generatedProjectConfigPath, targetProjectConfigPath)
}

const values = mode ? await readEnvironmentFile(mode) : process.env
const appIdPatch = await patchMiniProgramAppId({
  platform: 'mp-weixin',
  directory: targetBuildDir,
  values
})

if (appIdPatch.patched) {
  console.log(`Weixin project.config.json appid set to ${appIdPatch.appid}`)
}

console.log(`Weixin build artifact copied to ${targetBuildDir}`)

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
