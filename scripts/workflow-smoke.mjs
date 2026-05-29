import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()

const workflows = {
  ci: await readWorkflow('ci.yml'),
  releaseStrict: await readWorkflow('release-strict.yml'),
  prodToPreSync: await readWorkflow('prod-to-pre-sync.yml')
}
const deployBackendScript = await readFile(resolve(root, 'scripts/deploy-backend.mjs'), 'utf8')

assertNoPullRequestTarget()
assertCiReleaseGate()
assertStrictReleaseGate()
assertProdToPreSyncWorkflow()
assertDirectBackendDeployProtection()

console.log('Workflow smoke checks passed')

async function readWorkflow(name) {
  const path = resolve(root, '.github/workflows', name)
  const content = await readFile(path, 'utf8')

  assert.match(content, /^name:\s+.+$/m, `${name}: workflow name is missing`)
  assert.match(content, /^on:\s*$/m, `${name}: workflow triggers are missing`)
  assert.match(content, /^jobs:\s*$/m, `${name}: jobs block is missing`)

  return {
    name,
    content
  }
}

function assertNoPullRequestTarget() {
  for (const workflow of Object.values(workflows)) {
    assert.doesNotMatch(
      workflow.content,
      /\bpull_request_target\b/,
      `${workflow.name}: pull_request_target is not allowed for this repository gate`
    )
  }
}

function assertCiReleaseGate() {
  const content = workflows.ci.content

  assertIncludesAll('ci.yml', content, [
    'pull_request:',
    'push:',
    'branches:',
    '- main',
    '- master',
    'node-version: 24',
    'run: npm ci',
    'run: npm run verify:release'
  ])
}

function assertStrictReleaseGate() {
  const content = workflows.releaseStrict.content

  assertIncludesAll('release-strict.yml', content, [
    'workflow_dispatch:',
    'target_environment:',
    'run_deployed_smoke:',
    'run_backend_deploy:',
    'allow_prod_deploy:',
    'allow_prod_mutation:',
    'GOODS_COMM_SMOKE_SELLER_CODE',
    'GOODS_COMM_SMOKE_BUYER_CODE',
    'GOODS_COMM_SMOKE_LATITUDE',
    'GOODS_COMM_SMOKE_LONGITUDE',
    'TENCENTCLOUD_SECRET_ID',
    'TENCENTCLOUD_SECRET_KEY',
    'GOODS_COMM_PRE_ENV_LOCAL',
    'GOODS_COMM_PROD_ENV_LOCAL',
    'run: npm run verify:release:strict',
    'continue-on-error: true',
    'run: npm run audit:production-readiness:strict',
    'Backend deployment requires run_deployed_smoke=true',
    'Backend deployment to prod requires allow_prod_deploy=true',
    'Prod deployed main-flow smoke requires allow_prod_mutation=true',
    'run: npm run smoke:deployed:pre',
    'run: npm run smoke:deployed:pre:main',
    'run: npm run smoke:deployed:prod',
    'run: npm run smoke:deployed:prod:main',
    'run: npm run audit:production-readiness',
    'docs/deployment-readiness-audit.md',
    'docs/deployment-readiness-audit.json',
    'docs/deployment-readiness-audit-strict.md',
    'docs/deployment-readiness-audit-strict.json',
    'Fail when strict gate failed'
  ])
}

function assertProdToPreSyncWorkflow() {
  const content = workflows.prodToPreSync.content

  assertIncludesAll('prod-to-pre-sync.yml', content, [
    'workflow_dispatch:',
    'schedule:',
    "cron: '0 18 * * *'",
    'concurrency:',
    'group: goods-comm-prod-to-pre-sync',
    'GOODS_COMM_SYNC_DUMP_PATH',
    'GOODS_COMM_SYNC_LOCK_PATH',
    'GOODS_COMM_SYNC_AUDIT_PATH',
    'GOODS_COMM_SYNC_RUN_PRE_SMOKE',
    'GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE',
    'GOODS_COMM_SYNC_CONFIRM',
    'GOODS_COMM_SYNC_AUTO_ENABLED',
    'GOODS_COMM_SMOKE_SELLER_CODE',
    'GOODS_COMM_SMOKE_BUYER_CODE',
    'GOODS_COMM_SMOKE_LATITUDE',
    'GOODS_COMM_SMOKE_LONGITUDE',
    'GOODS_COMM_SMOKE_APPROVED_IMAGE_URL',
    'GOODS_COMM_PRE_ENV_LOCAL',
    'GOODS_COMM_PROD_ENV_LOCAL',
    'run_pre_main_smoke:',
    'run: npm run sync:prod-to-pre:plan',
    'run: npm run sync:prod-to-pre',
    'run: npm run sync:prod-to-pre:auto',
    'Scheduled prod-to-pre sync skipped',
    'name: prod-to-pre-sync-audit',
    'if-no-files-found: ignore'
  ])

  assert.doesNotMatch(
    content,
    /path:\s*\$\{\{\s*runner\.temp\s*\}\/goods-comm-prod-to-pre\.dump/,
    'prod-to-pre-sync.yml: production dump must not be uploaded as an artifact'
  )
}

function assertDirectBackendDeployProtection() {
  assertIncludesAll('scripts/deploy-backend.mjs', deployBackendScript, [
    "run('npm', ['run', 'build:backend'])",
    "run('npm', ['run', 'smoke:backend:artifact'])",
    'Verify dist/backend with npm run smoke:backend:artifact.',
    "run(process.execPath, ['scripts/migrate-database.mjs', '--env', environment, '--execute'])"
  ])

  const buildIndex = deployBackendScript.indexOf("run('npm', ['run', 'build:backend'])")
  const artifactSmokeIndex = deployBackendScript.indexOf("run('npm', ['run', 'smoke:backend:artifact'])")
  const migrationIndex = deployBackendScript.indexOf("run(process.execPath, ['scripts/migrate-database.mjs', '--env', environment, '--execute'])")

  assert.ok(
    buildIndex >= 0 && artifactSmokeIndex > buildIndex && migrationIndex > artifactSmokeIndex,
    'scripts/deploy-backend.mjs: build, artifact smoke, and migration must run in that order'
  )
}

function assertIncludesAll(label, content, snippets) {
  for (const snippet of snippets) {
    assert.ok(
      content.includes(snippet),
      `${label}: expected workflow snippet is missing: ${snippet}`
    )
  }
}
