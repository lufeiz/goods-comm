import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const root = process.cwd()
const profile = getArgValue('--profile') || 'full'
const validProfiles = new Set(['quick', 'full', 'release'])

if (!validProfiles.has(profile)) {
  throw new Error(`Unknown release gate profile: ${profile}`)
}

const skipHttpBackend = process.argv.includes('--skip-http-backend')
const startedAt = Date.now()
const steps = []

await addSyntaxChecks()
addCoreSmokes()
addPlanChecks()
addBuildChecks()
addArtifactSmokeChecks()

if (profile === 'release') {
  steps.push({
    name: 'production readiness strict check',
    command: process.execPath,
    args: ['scripts/production-readiness-audit.mjs', '--check-only', '--require-deployed-smoke-inputs']
  })
} else {
  steps.push({
    name: 'production readiness report',
    command: process.execPath,
    args: ['scripts/production-readiness-audit.mjs']
  })
}

for (const [index, step] of steps.entries()) {
  runStep(index + 1, steps.length, step)
}

console.log(`Release gate ${profile} profile completed in ${Math.round((Date.now() - startedAt) / 1000)}s`)

async function addSyntaxChecks() {
  const files = [
    ...(await listJavaScriptFiles(resolve(root, 'backend'))),
    ...(await listJavaScriptFiles(resolve(root, 'scripts'))),
    ...(await listJavaScriptFiles(resolve(root, 'src'))),
    resolve(root, 'vite.config.js')
  ]

  for (const file of files) {
    steps.push({
      name: `syntax ${relative(root, file)}`,
      command: process.execPath,
      args: ['--check', file]
    })
  }
}

function addCoreSmokes() {
  for (const script of [
    'env:check',
    'smoke:ops-auth',
    'smoke:platform-auth',
    'smoke:platform-notifier',
    'smoke:storage-content',
    'smoke:region',
    'smoke:postgres-store',
    'smoke:prod-sync',
    'smoke:workflows',
    'smoke:pages',
    'smoke:backend:env',
    'smoke',
    'smoke:bff',
    'smoke:bff:fetch'
  ]) {
    steps.push(npmStep(script))
  }

  if (!skipHttpBackend) {
    steps.push(npmStep('smoke:backend'))

    if (profile !== 'quick') {
      steps.push(npmStep('smoke:deployed:local-health'))
      steps.push(npmStep('smoke:deployed:local-main'))
    }
  }
}

function addPlanChecks() {
  if (profile === 'quick') {
    return
  }

  for (const env of ['pre', 'prod']) {
    steps.push({
      name: `db migration plan ${env}`,
      command: process.execPath,
      args: ['scripts/migrate-database.mjs', '--env', env]
    })
    steps.push({
      name: `backend deploy plan ${env}`,
      command: process.execPath,
      args: ['scripts/deploy-backend.mjs', '--env', env]
    })
  }

  steps.push({
    name: 'prod to pre sync plan',
    command: process.execPath,
    args: ['scripts/sync-prod-to-pre.mjs']
  })
}

function addBuildChecks() {
  steps.push(npmStep('build:backend'))
  steps.push(npmStep('smoke:backend:artifact'))

  if (profile === 'quick') {
    for (const script of ['build:h5', 'build:weixin', 'build:alipay']) {
      steps.push(npmStep(script))
    }
    return
  }

  for (const env of ['dev', 'test', 'pre', 'prod']) {
    for (const target of ['h5', 'weixin', 'alipay']) {
      steps.push(npmStep(`build:${target}:${env}`))
    }
  }
}

function addArtifactSmokeChecks() {
  steps.push({
    name: 'smoke:artifacts',
    command: process.execPath,
    args: ['scripts/artifact-smoke.mjs', '--profile', profile]
  })
}

async function listJavaScriptFiles(dir) {
  const entries = await readdir(dir, {
    withFileTypes: true
  })
  const files = []

  for (const entry of entries) {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (['node_modules', 'dist'].includes(entry.name)) {
        continue
      }

      files.push(...await listJavaScriptFiles(path))
      continue
    }

    if (entry.isFile() && /\.(mjs|js)$/.test(entry.name)) {
      files.push(path)
    }
  }

  return files.sort()
}

function npmStep(script) {
  return {
    name: script,
    command: 'npm',
    args: ['run', script]
  }
}

function runStep(index, total, step) {
  console.log(`\n[${index}/${total}] ${step.name}`)
  const result = spawnSync(step.command, step.args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${step.name} failed with exit code ${result.status}`)
  }
}

function getArgValue(name) {
  const index = process.argv.findIndex((arg) => arg === name)
  return index >= 0 ? process.argv[index + 1] : ''
}
