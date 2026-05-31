import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createArtifactChecks } from './artifact-checks.mjs'
import {
  containsPlaceholder,
  normalizeEnvironmentName,
  readEnvironmentFile
} from './env-files.mjs'
import {
  isRealMiniProgramAppId,
  readMiniProgramAppId
} from './mini-program-deploy-config.mjs'

const VALID_TARGETS = ['h5', 'mp-weixin', 'mp-alipay']
const execute = process.argv.includes('--execute')
const skipBuild = process.argv.includes('--skip-build') || process.env.GOODS_COMM_FRONTEND_DEPLOY_SKIP_BUILD === 'true'
const skipArtifactSmoke = process.argv.includes('--skip-artifact-smoke') || process.env.GOODS_COMM_FRONTEND_DEPLOY_SKIP_ARTIFACT_SMOKE === 'true'
const environment = getEnvironmentArg()
const targets = getTargets()
const releaseVersion = getArgValue('--version') || process.env.GOODS_COMM_FRONTEND_RELEASE_VERSION || `${environment}-${Date.now()}`
const releaseDescription = getArgValue('--description') || process.env.GOODS_COMM_FRONTEND_RELEASE_DESCRIPTION || `goods-comm ${environment} ${releaseVersion}`
const values = await readEnvironmentFile(environment)
const cloudbaseCommand = firstAvailableCommand(['cloudbase', 'tcb'])
const wechatDevtoolsCommand = process.env.GOODS_COMM_WECHAT_DEVTOOLS_CLI || process.env.WECHAT_DEVTOOLS_CLI || ''
const alipayMiniCommand = process.env.GOODS_COMM_ALIPAY_MINI_CLI || process.env.ALIPAY_MINI_CLI || ''
const missing = findMissingPreconditions()
const plan = createPlan()

if (!execute) {
  printPlan()
  process.exit(0)
}

if (process.env.GOODS_COMM_FRONTEND_DEPLOY_CONFIRM !== `deploy-frontend-${environment}`) {
  throw new Error(`Refusing to deploy frontend without GOODS_COMM_FRONTEND_DEPLOY_CONFIRM=deploy-frontend-${environment}`)
}

if (environment === 'prod' && process.env.GOODS_COMM_DEPLOY_ALLOW_PROD !== 'true') {
  throw new Error('Refusing to deploy frontend prod without GOODS_COMM_DEPLOY_ALLOW_PROD=true')
}

if (missing.length) {
  throw new Error(`Cannot deploy frontend ${environment}: ${missing.join('; ')}`)
}

run('npm', ['run', `env:check:${environment}`])

if (!skipBuild) {
  for (const target of targets) {
    run('npm', ['run', buildScriptName(target, environment)])
  }
}

if (!skipArtifactSmoke) {
  await verifyFrontendArtifacts()
}

await verifyMiniProgramDeployConfig()

if (targets.includes('h5')) {
  run(cloudbaseCommand, [
    'hosting',
    'deploy',
    artifactDirectory('h5', environment),
    '-e',
    values.GOODS_COMM_CLOUDBASE_ENV_ID
  ])
}

if (targets.includes('mp-weixin')) {
  run(wechatDevtoolsCommand, [
    'upload',
    '--project',
    artifactDirectory('mp-weixin', environment),
    '-v',
    releaseVersion,
    '-d',
    releaseDescription
  ])
}

if (targets.includes('mp-alipay')) {
  run(alipayMiniCommand, [
    'upload',
    '--project',
    artifactDirectory('mp-alipay', environment),
    '--app-id',
    values.GOODS_COMM_ALIPAY_APP_ID,
    '--version',
    releaseVersion
  ])
}

console.log(`Frontend deploy command completed for ${environment}: ${targets.join(', ')}`)

function createPlan() {
  const lines = [
    `1. Validate .env.${environment} with npm run env:check:${environment}.`,
    skipBuild
      ? '2. Skip frontend builds because --skip-build or GOODS_COMM_FRONTEND_DEPLOY_SKIP_BUILD=true was provided.'
      : `2. Build frontend artifacts: ${targets.map((target) => `npm run ${buildScriptName(target, environment)}`).join(', ')}.`,
    skipArtifactSmoke
      ? '3. Skip artifact smoke because --skip-artifact-smoke or GOODS_COMM_FRONTEND_DEPLOY_SKIP_ARTIFACT_SMOKE=true was provided.'
      : `3. Verify ${environment} frontend artifacts with artifact checks before upload.`,
    `4. Verify mini-program artifact AppID values against real ${environment} AppID configuration when provided.`,
    `5. Release version: ${releaseVersion}.`
  ]

  if (targets.includes('h5')) {
    lines.push(`6. Deploy H5 artifact ${artifactDirectory('h5', environment)} to CloudBase static hosting env ${values.GOODS_COMM_CLOUDBASE_ENV_ID || 'missing'}.`)
  }

  if (targets.includes('mp-weixin')) {
    lines.push(`7. Upload WeChat Mini Program artifact ${artifactDirectory('mp-weixin', environment)} with the WeChat DevTools CLI.`)
  }

  if (targets.includes('mp-alipay')) {
    lines.push(`8. Upload Alipay Mini Program artifact ${artifactDirectory('mp-alipay', environment)} with the Alipay mini program CLI.`)
  }

  return lines
}

function printPlan() {
  console.log(`Frontend deployment plan for ${environment}:`)

  for (const step of plan) {
    console.log(`- ${step}`)
  }

  console.log(`Targets: ${targets.join(', ')}`)
  console.log(`API base URL: ${values.VITE_API_BASE_URL || 'missing'}`)

  if (missing.length) {
    console.log('Missing preconditions:')
    for (const item of missing) {
      console.log(`- ${item}`)
    }
    return
  }

  const prodDeployOptIn = environment === 'prod' ? ' GOODS_COMM_DEPLOY_ALLOW_PROD=true' : ''
  console.log(`Ready to execute with GOODS_COMM_FRONTEND_DEPLOY_CONFIRM=deploy-frontend-${environment}${prodDeployOptIn} and --execute.`)
}

function findMissingPreconditions() {
  const missingItems = []

  for (const key of [
    'VITE_API_BASE_URL'
  ]) {
    if (!values[key] || containsPlaceholder(values[key])) {
      missingItems.push(`[${environment}] ${key} must be real before frontend deploy`)
    }
  }

  if (targets.includes('h5')) {
    for (const key of [
      'GOODS_COMM_CLOUDBASE_ENV_ID',
      'GOODS_COMM_ALLOWED_ORIGINS'
    ]) {
      if (!values[key] || containsPlaceholder(values[key])) {
        missingItems.push(`[${environment}] ${key} must be real before H5 deploy`)
      }
    }

    if (!cloudbaseCommand) {
      missingItems.push('cloudbase or tcb CLI is required for H5 CloudBase static hosting deploy')
    }

    if (!hasTencentCloudApiCredential() && process.env.GOODS_COMM_DEPLOY_ALLOW_EXISTING_CLOUDBASE_LOGIN !== 'true') {
      missingItems.push('TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY are required for non-interactive H5 CloudBase deploy; set GOODS_COMM_DEPLOY_ALLOW_EXISTING_CLOUDBASE_LOGIN=true only when the runner is already logged in')
    }
  }

  if (targets.includes('mp-weixin')) {
    if (!isRealMiniProgramAppId(values.GOODS_COMM_WECHAT_APP_ID)) {
      missingItems.push(`[${environment}] GOODS_COMM_WECHAT_APP_ID must be real before WeChat Mini Program upload`)
    }

    if (!wechatDevtoolsCommand) {
      missingItems.push('GOODS_COMM_WECHAT_DEVTOOLS_CLI or WECHAT_DEVTOOLS_CLI must point to the WeChat DevTools CLI for upload')
    } else if (!uploadCommandAvailable(wechatDevtoolsCommand)) {
      missingItems.push(`WeChat DevTools CLI command is not executable: ${wechatDevtoolsCommand}`)
    }
  }

  if (targets.includes('mp-alipay')) {
    if (!isRealMiniProgramAppId(values.GOODS_COMM_ALIPAY_APP_ID)) {
      missingItems.push(`[${environment}] GOODS_COMM_ALIPAY_APP_ID must be real before Alipay Mini Program upload`)
    }

    if (!alipayMiniCommand) {
      missingItems.push('GOODS_COMM_ALIPAY_MINI_CLI or ALIPAY_MINI_CLI must point to the Alipay mini program CLI for upload')
    } else if (!uploadCommandAvailable(alipayMiniCommand)) {
      missingItems.push(`Alipay mini program CLI command is not executable: ${alipayMiniCommand}`)
    }
  }

  if (environment === 'prod' && process.env.GOODS_COMM_DEPLOY_ALLOW_PROD !== 'true') {
    missingItems.push('GOODS_COMM_DEPLOY_ALLOW_PROD=true is required for production frontend deploy')
  }

  return missingItems
}

async function verifyFrontendArtifacts() {
  const artifactChecks = await createArtifactChecks({
    root: process.cwd(),
    profile: 'full',
    environments: [environment]
  })
  const selectedTargets = artifactChecks.targets.filter((target) => targets.includes(target.platform))

  for (const target of selectedTargets) {
    await artifactChecks.verifyTarget(target)
  }

  console.log(`Frontend deploy artifact checks passed for ${selectedTargets.length} ${environment} targets`)
}

async function verifyMiniProgramDeployConfig() {
  if (targets.includes('mp-weixin') && isRealMiniProgramAppId(values.GOODS_COMM_WECHAT_APP_ID)) {
    const appid = await readMiniProgramAppId({
      platform: 'mp-weixin',
      directory: artifactDirectory('mp-weixin', environment)
    })
    if (appid !== values.GOODS_COMM_WECHAT_APP_ID) {
      throw new Error(`[${environment}] WeChat artifact appid ${appid || 'missing'} does not match GOODS_COMM_WECHAT_APP_ID`)
    }
  }

  if (targets.includes('mp-alipay') && isRealMiniProgramAppId(values.GOODS_COMM_ALIPAY_APP_ID)) {
    const appid = await readMiniProgramAppId({
      platform: 'mp-alipay',
      directory: artifactDirectory('mp-alipay', environment)
    })
    if (appid !== values.GOODS_COMM_ALIPAY_APP_ID) {
      throw new Error(`[${environment}] Alipay artifact appid ${appid || 'missing'} does not match GOODS_COMM_ALIPAY_APP_ID`)
    }
  }
}

function getEnvironmentArg() {
  const value = getArgValue('--env') || process.env.GOODS_COMM_ENV || 'pre'
  return normalizeEnvironmentName(value)
}

function getTargets() {
  const raw = getArgValue('--target') || process.env.GOODS_COMM_FRONTEND_DEPLOY_TARGET || 'all'
  const normalized = String(raw).trim().toLowerCase()

  if (normalized === 'all') {
    return [...VALID_TARGETS]
  }

  const requestedTargets = normalized.split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeTargetName)

  if (!requestedTargets.length) {
    throw new Error('Frontend deploy target must not be empty')
  }

  const unknownTarget = requestedTargets.find((target) => !VALID_TARGETS.includes(target))

  if (unknownTarget) {
    throw new Error(`Frontend deploy target must be all, h5, mp-weixin, mp-alipay, weixin, or alipay; got ${unknownTarget}`)
  }

  return Array.from(new Set(requestedTargets))
}

function normalizeTargetName(value) {
  if (value === 'weixin') {
    return 'mp-weixin'
  }

  if (value === 'alipay') {
    return 'mp-alipay'
  }

  return value
}

function artifactDirectory(target, targetEnvironment) {
  return resolve(process.cwd(), 'dist/build', targetEnvironment, target)
}

function buildScriptName(target, targetEnvironment) {
  if (target === 'h5') {
    return `build:h5:${targetEnvironment}`
  }

  if (target === 'mp-weixin') {
    return `build:weixin:${targetEnvironment}`
  }

  return `build:alipay:${targetEnvironment}`
}

function getArgValue(name) {
  const index = process.argv.findIndex((arg) => arg === name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function firstAvailableCommand(commands) {
  for (const command of commands) {
    if (commandAvailable(command)) {
      return command
    }
  }

  return ''
}

function commandAvailable(command) {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore'
  })

  return !result.error && result.status === 0
}

function uploadCommandAvailable(command) {
  if (command.includes('/')) {
    return existsSync(command)
  }

  return commandAvailable(command)
}

function hasTencentCloudApiCredential() {
  return Boolean(
    (process.env.TENCENTCLOUD_SECRET_ID || process.env.TENCENTCLOUD_SECRETID) &&
    (process.env.TENCENTCLOUD_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY)
  )
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit'
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`)
  }
}
