import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()

const runbook = await read('docs/cloud-deployment-runbook.md')
const readme = await read('README.md')
const missingInfo = await read('docs/deployment-missing-info.md')
const remediationMatrix = await read('docs/production-remediation-matrix-20260601.md')
const releaseWorkflow = await read('.github/workflows/release-strict.yml')
const backendDeploy = await read('scripts/deploy-backend.mjs')
const frontendDeploy = await read('scripts/deploy-frontend.mjs')

assertIncludesAll('docs/cloud-deployment-runbook.md', runbook, [
  'npm run release:inputs -- --check-only',
  'npm run verify:release:strict',
  'GOODS_COMM_PRE_ENV_LOCAL',
  'GOODS_COMM_PROD_ENV_LOCAL',
  'GOODS_COMM_PRE_SMOKE_ENV_LOCAL',
  'GOODS_COMM_PROD_SMOKE_ENV_LOCAL',
  'TENCENTCLOUD_SECRET_ID',
  'TENCENTCLOUD_SECRET_KEY',
  'npm run deploy:backend:pre:plan',
  'GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre GOODS_COMM_DEPLOY_CONFIRM=deploy-pre npm run deploy:backend:pre',
  'GOODS_COMM_FRONTEND_DEPLOY_CONFIRM=deploy-frontend-pre npm run deploy:frontend:pre',
  'run_backend_deploy',
  'run_deployed_smoke',
  'allow_prod_deploy',
  'allow_prod_mutation',
  'GOODS_COMM_SMOKE_ALLOW_PROD_MUTATION=true npm run smoke:deployed:prod:main',
  '--health-attempts',
  '--health-interval-ms',
  'GOODS_COMM_DEPLOY_ALLOW_EXISTING_CLOUDBASE_LOGIN=true'
])

assertIncludesAll('README.md', readme, [
  'docs/cloud-deployment-runbook.md',
  '.github/workflows/release-strict.yml',
  'TENCENTCLOUD_SECRET_ID',
  'run_backend_deploy=true',
  'run_deployed_smoke=true'
])

assertIncludesAll('docs/deployment-missing-info.md', missingInfo, [
  'docs/cloud-deployment-runbook.md',
  'TENCENTCLOUD_SECRET_ID',
  'TENCENTCLOUD_SECRET_KEY',
  'GOODS_COMM_PRE_ENV_LOCAL',
  'GOODS_COMM_PRE_SMOKE_ENV_LOCAL'
])

assertIncludesAll('docs/production-remediation-matrix-20260601.md', remediationMatrix, [
  'docs/cloud-deployment-runbook.md',
  'deploy:backend:pre',
  'smoke:deployed:pre',
  'TENCENTCLOUD_SECRET_ID/KEY'
])

assertIncludesAll('.github/workflows/release-strict.yml', releaseWorkflow, [
  'Install release toolchain',
  'npm install -g @cloudbase/cli',
  'python -m pip install --user tccli',
  'Check release input bundle',
  'npm run verify:release:strict',
  'Require deployed smoke after backend deploy',
  'Deploy pre backend',
  'Deploy prod backend',
  'Run pre deployed health smoke',
  'Run pre deployed main-flow smoke',
  'Deploy pre frontend',
  'Deploy prod frontend'
])

assertIncludesAll('scripts/deploy-backend.mjs', backendDeploy, [
  'GOODS_COMM_DEPLOY_CONFIRM=deploy-${environment}',
  'GOODS_COMM_DEPLOY_ALLOW_PROD',
  'scripts/migrate-database.mjs',
  'scripts/deployed-health-smoke.mjs',
  'scripts/deployed-main-flow-smoke.mjs',
  'cloudbase',
  'docker',
  'tccli'
])

assertIncludesAll('scripts/deploy-frontend.mjs', frontendDeploy, [
  'GOODS_COMM_FRONTEND_DEPLOY_CONFIRM=deploy-frontend-${environment}',
  'GOODS_COMM_DEPLOY_ALLOW_PROD',
  'hosting',
  'upload',
  'GOODS_COMM_WECHAT_DEVTOOLS_CLI',
  'GOODS_COMM_ALIPAY_MINI_CLI'
])

console.log('Cloud deployment runbook smoke checks passed')

async function read(path) {
  return readFile(resolve(root, path), 'utf8')
}

function assertIncludesAll(name, content, needles) {
  for (const needle of needles) {
    assert.ok(
      content.includes(needle),
      `${name}: expected to include ${needle}`
    )
  }
}
