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
const deployFrontendScript = await readFile(resolve(root, 'scripts/deploy-frontend.mjs'), 'utf8')
const provisionDatabaseScript = await readFile(resolve(root, 'scripts/provision-database.mjs'), 'utf8')
const migrateDatabaseScript = await readFile(resolve(root, 'scripts/migrate-database.mjs'), 'utf8')
const releaseGateScript = await readFile(resolve(root, 'scripts/verify-release-gate.mjs'), 'utf8')

assertNoPullRequestTarget()
assertNode24ActionRuntimeOptIn()
assertCiReleaseGate()
assertReleaseGateProfileBoundary()
assertStrictReleaseGate()
assertProdToPreSyncWorkflow()
assertDirectBackendDeployProtection()
assertDirectFrontendDeployProtection()
assertDirectDatabaseProvisionProtection()
assertDirectDatabaseMigrationProtection()

console.log('Workflow smoke checks passed')

async function readWorkflow(name) {
  const path = resolve(root, '.github/workflows', name)
  const content = await readFile(path, 'utf8')

  assert.match(content, /^name:\s+.+$/m, `${name}: workflow name is missing`)
  assert.match(content, /^on:\s*$/m, `${name}: workflow triggers are missing`)
  assert.match(content, /^jobs:\s*$/m, `${name}: jobs block is missing`)
  assertNoAmbiguousPlainYamlScalars(name, content)

  return {
    name,
    content
  }
}

function assertNoAmbiguousPlainYamlScalars(name, content) {
  const lines = content.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    const ambiguous = line.match(/^\s*[a-zA-Z0-9_-]+:\s+([^'"[{|>&*!#].*:\s+.+)$/)

    assert.equal(
      Boolean(ambiguous),
      false,
      `${name}:${index + 1}: quote YAML scalar values that contain ": "`
    )
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

function assertNode24ActionRuntimeOptIn() {
  for (const workflow of Object.values(workflows)) {
    assertIncludesAll(workflow.name, workflow.content, [
      'env:',
      "FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: 'true'"
    ])
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
    'uses: actions/checkout@v5',
    'uses: actions/setup-node@v5',
    'node-version: 24',
    'run: npm ci',
    'run: npm run verify:release'
  ])

  assertNoDeprecatedNode20Actions('ci.yml', content)
}

function assertReleaseGateProfileBoundary() {
  assertIncludesAll('scripts/verify-release-gate.mjs', releaseGateScript, [
    "name: 'production readiness strict report'",
    "'--output'",
    "'docs/deployment-readiness-audit-strict.md'",
    "'--json-output'",
    "'docs/deployment-readiness-audit-strict.json'",
    "args: ['scripts/production-readiness-audit.mjs', '--check-only', '--require-deployed-smoke-inputs']",
    "args: ['scripts/production-readiness-audit.mjs']",
    "const planEnvironments = ['dev', 'test', 'pre', 'prod']",
    "if (profile !== 'release')",
    "'smoke:location-permissions'",
    "'smoke:environment-commands'",
    "'smoke:database-migration'",
    "'smoke:database-provision'",
    "'smoke:database-runbook'",
    "'smoke:cloud-deployment-runbook'",
    "'smoke:frontend-deploy'",
    "'smoke:mini-program-deploy-config'",
    "'smoke:main-flow-contract'",
    "steps.push(npmStep('test'))",
    "steps.push(npmStep('build:h5'))",
    "name: 'smoke:h5:render'",
    "name: `smoke:h5:protected-auth ${env}`",
    "'scripts/h5-render-smoke.mjs'",
    "'protected-auth'",
    "'dist/build/h5'",
    "`dist/build/${env}/h5`",
    "if (skipHttpBackend && profile !== 'quick')",
    '--skip-http-backend is only allowed for quick profile',
    'quick/full profiles are CI or release-candidate gates only',
    'do not fail on remaining production blockers',
    'Run npm run verify:release:strict before a real pre/prod release.'
  ])

  assertIncludesAll('scripts/verify-release-gate.mjs', releaseGateScript, [
    "name: `db provision plan ${env}`",
    "args: ['scripts/provision-database.mjs', '--env', env]",
    "name: `frontend deploy plan ${env}`",
    "args: ['scripts/deploy-frontend.mjs', '--env', env]"
  ])

  const strictReportIndex = releaseGateScript.indexOf("name: 'production readiness strict report'")
  const strictCheckIndex = releaseGateScript.indexOf("name: 'production readiness strict check'")

  assert.ok(
    strictReportIndex >= 0 && strictCheckIndex > strictReportIndex,
    'scripts/verify-release-gate.mjs: strict readiness artifacts must be written before the strict check can fail'
  )
}

function assertDirectFrontendDeployProtection() {
  assertIncludesAll('scripts/deploy-frontend.mjs', deployFrontendScript, [
    "run('npm', ['run', `env:check:${environment}`])",
    "run('npm', ['run', buildScriptName(target, environment)])",
    'createArtifactChecks',
    'verifyFrontendArtifacts',
    'verifyMiniProgramDeployConfig',
    'GOODS_COMM_FRONTEND_DEPLOY_CONFIRM=deploy-frontend-${environment}',
    'GOODS_COMM_DEPLOY_ALLOW_PROD=true',
    'VITE_API_BASE_URL',
    'GOODS_COMM_CLOUDBASE_ENV_ID',
    'GOODS_COMM_WECHAT_APP_ID',
    'GOODS_COMM_ALIPAY_APP_ID',
    'GOODS_COMM_WECHAT_DEVTOOLS_CLI',
    'GOODS_COMM_ALIPAY_MINI_CLI'
  ])

  const envCheckIndex = deployFrontendScript.indexOf("run('npm', ['run', `env:check:${environment}`])")
  const buildIndex = deployFrontendScript.indexOf("run('npm', ['run', buildScriptName(target, environment)])")
  const artifactSmokeIndex = deployFrontendScript.indexOf('await verifyFrontendArtifacts()')

  assert.ok(
    envCheckIndex >= 0 && buildIndex > envCheckIndex && artifactSmokeIndex > buildIndex,
    'scripts/deploy-frontend.mjs: env check, build, and artifact smoke must run in that order'
  )
}

function assertStrictReleaseGate() {
  const content = workflows.releaseStrict.content

  assertIncludesAll('release-strict.yml', content, [
    'workflow_dispatch:',
    'uses: actions/checkout@v5',
    'uses: actions/setup-node@v5',
    'target_environment:',
    'run_deployed_smoke:',
    'health_attempts:',
    'health_interval_ms:',
    'run_backend_deploy:',
    'run_db_provision:',
    'run_frontend_deploy:',
    'frontend_targets:',
    'frontend_release_version:',
    'allow_prod_deploy:',
    'allow_prod_mutation:',
    'GOODS_COMM_SMOKE_API_BASE_URL',
    'GOODS_COMM_SMOKE_SELLER_CODE',
    'GOODS_COMM_SMOKE_SELLER_PROVIDER',
    'GOODS_COMM_SMOKE_BUYER_CODE',
    'GOODS_COMM_SMOKE_BUYER_PROVIDER',
    'GOODS_COMM_SMOKE_LATITUDE',
    'GOODS_COMM_SMOKE_LONGITUDE',
    'GOODS_COMM_SMOKE_ACCURACY',
    'GOODS_COMM_SMOKE_CAPTURED_AT',
    'GOODS_COMM_SMOKE_SCOPE_TYPE',
    'GOODS_COMM_SMOKE_RADIUS_METERS',
    'GOODS_COMM_SMOKE_RUN_ID',
    'GOODS_COMM_SMOKE_APPROVED_IMAGE_STORAGE_KEY',
    'GOODS_COMM_SMOKE_APPROVED_IMAGE_SIZE',
    'GOODS_COMM_SMOKE_APPROVED_IMAGE_MIME_TYPE',
    'GOODS_COMM_SMOKE_APPROVED_IMAGE_CHECKSUM',
    'GOODS_COMM_SMOKE_HEALTH_ATTEMPTS',
    'GOODS_COMM_SMOKE_HEALTH_INTERVAL_MS',
    'GOODS_COMM_SMOKE_ACCOUNT_DELETE_PROVIDER',
    'GOODS_COMM_SMOKE_ACCOUNT_DELETE_CODE',
    'GOODS_COMM_SMOKE_ACCOUNT_DELETE_RELOGIN_CODE',
    'GOODS_COMM_DEPLOY_ALLOW_PROD',
    'GOODS_COMM_DB_PROVISION_ALLOW_PROD',
    'GOODS_COMM_DB_MIGRATE_ALLOW_PROD',
    'GOODS_COMM_FRONTEND_DEPLOY_TARGET',
    'GOODS_COMM_FRONTEND_RELEASE_VERSION',
    'GOODS_COMM_WECHAT_DEVTOOLS_CLI',
    'GOODS_COMM_ALIPAY_MINI_CLI',
    'TENCENTCLOUD_SECRET_ID',
    'TENCENTCLOUD_SECRET_KEY',
    'GOODS_COMM_PRE_ENV_LOCAL',
    'GOODS_COMM_PROD_ENV_LOCAL',
    'GOODS_COMM_PRE_SMOKE_ENV_LOCAL',
    'GOODS_COMM_PROD_SMOKE_ENV_LOCAL',
    'printf "%s\\n" "${GOODS_COMM_PRE_SMOKE_ENV_LOCAL}" > .env.smoke.pre.local',
    'printf "%s\\n" "${GOODS_COMM_PROD_SMOKE_ENV_LOCAL}" > .env.smoke.prod.local',
    'Check release input bundle',
    'id: release_inputs',
    'run: npm run release:inputs -- --check-only --output docs/release-input-readiness.md --json-output docs/release-input-readiness.json',
    "steps.release_inputs.outcome == 'success'",
    'run: npm run verify:release:strict',
    'continue-on-error: true',
    'run: npm run audit:production-readiness:strict',
    'Backend deployment requires run_deployed_smoke=true',
    'Database provisioning requires run_backend_deploy=true',
    'Database provisioning requires skip_db_migrate=false',
    'Backend deployment to prod requires allow_prod_deploy=true',
    'Database provisioning for prod requires allow_prod_deploy=true',
    'Frontend deployment to prod requires allow_prod_deploy=true',
    'Provision pre database',
    'Deploy pre backend',
    'Provision prod database',
    'Deploy prod backend',
    'Deploy pre frontend',
    'Deploy prod frontend',
    'export GOODS_COMM_DB_PROVISION_CONFIRM=provision-pre',
    'export GOODS_COMM_DB_PROVISION_CONFIRM=provision-prod',
    'node scripts/provision-database.mjs --env pre --execute',
    'node scripts/provision-database.mjs --env prod --execute',
    'args=(scripts/deploy-backend.mjs --env pre --provider',
    'args=(scripts/deploy-backend.mjs --env prod --provider',
    'node scripts/deploy-frontend.mjs --env pre --target',
    'node scripts/deploy-frontend.mjs --env prod --target',
    'GOODS_COMM_FRONTEND_DEPLOY_CONFIRM: deploy-frontend-pre',
    'GOODS_COMM_FRONTEND_DEPLOY_CONFIRM: deploy-frontend-prod',
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
    'docs/release-input-readiness.md',
    'docs/release-input-readiness.json',
    'Fail when release input bundle check failed',
    'Fail when strict gate failed'
  ])

  assertNoDeprecatedNode20Actions('release-strict.yml', content)

  assert.doesNotMatch(
    content,
    /postgresql-client/,
    'release-strict.yml: release workflow should use the project pg dependency instead of installing PostgreSQL client tools'
  )

  assertWorkflowStepOrder('release-strict.yml', content, [
    'Materialize protected env overrides',
    'Materialize deployed smoke inputs',
    'Check release input bundle',
    'Require backend deploy after database provisioning',
    'Require database migration after provisioning',
    'Provision pre database',
    'Deploy pre backend',
    'Run pre deployed health smoke',
    'Run pre deployed main-flow smoke',
    'Deploy pre frontend'
  ])

  assertWorkflowStepOrder('release-strict.yml', content, [
    'Materialize protected env overrides',
    'Materialize deployed smoke inputs',
    'Check release input bundle',
    'Require prod database provision opt-in',
    'Provision prod database',
    'Deploy prod backend',
    'Run prod deployed health smoke',
    'Require prod mutation opt-in for prod main-flow smoke',
    'Run prod deployed main-flow smoke',
    'Deploy prod frontend'
  ])
}

function assertProdToPreSyncWorkflow() {
  const content = workflows.prodToPreSync.content

  assertIncludesAll('prod-to-pre-sync.yml', content, [
    'workflow_dispatch:',
    'schedule:',
    "cron: '0 18 * * *'",
    'uses: actions/checkout@v5',
    'uses: actions/setup-node@v5',
    'concurrency:',
    'group: goods-comm-prod-to-pre-sync',
    'GOODS_COMM_SYNC_DUMP_PATH',
    'GOODS_COMM_SYNC_LOCK_PATH',
    'GOODS_COMM_SYNC_AUDIT_PATH',
    'GOODS_COMM_SYNC_RUN_PRE_SMOKE',
    'GOODS_COMM_SYNC_HEALTH_ATTEMPTS',
    'GOODS_COMM_SYNC_HEALTH_INTERVAL_MS',
    'GOODS_COMM_SYNC_RUN_PRE_MAIN_SMOKE',
    'GOODS_COMM_SYNC_CONFIRM',
    'GOODS_COMM_SYNC_AUTO_ENABLED',
    'GOODS_COMM_SMOKE_API_BASE_URL',
    'GOODS_COMM_SMOKE_SELLER_CODE',
    'GOODS_COMM_SMOKE_SELLER_PROVIDER',
    'GOODS_COMM_SMOKE_BUYER_CODE',
    'GOODS_COMM_SMOKE_BUYER_PROVIDER',
    'GOODS_COMM_SMOKE_LATITUDE',
    'GOODS_COMM_SMOKE_LONGITUDE',
    'GOODS_COMM_SMOKE_ACCURACY',
    'GOODS_COMM_SMOKE_CAPTURED_AT',
    'GOODS_COMM_SMOKE_SCOPE_TYPE',
    'GOODS_COMM_SMOKE_RADIUS_METERS',
    'GOODS_COMM_SMOKE_RUN_ID',
    'GOODS_COMM_SMOKE_APPROVED_IMAGE_URL',
    'GOODS_COMM_SMOKE_APPROVED_IMAGE_STORAGE_KEY',
    'GOODS_COMM_SMOKE_APPROVED_IMAGE_SIZE',
    'GOODS_COMM_SMOKE_APPROVED_IMAGE_MIME_TYPE',
    'GOODS_COMM_SMOKE_APPROVED_IMAGE_CHECKSUM',
    'GOODS_COMM_SMOKE_ACCOUNT_DELETE_PROVIDER',
    'GOODS_COMM_SMOKE_ACCOUNT_DELETE_CODE',
    'GOODS_COMM_SMOKE_ACCOUNT_DELETE_RELOGIN_CODE',
    'GOODS_COMM_PRE_ENV_LOCAL',
    'GOODS_COMM_PROD_ENV_LOCAL',
    'GOODS_COMM_PRE_SMOKE_ENV_LOCAL',
    'printf "%s\\n" "${GOODS_COMM_PRE_SMOKE_ENV_LOCAL}" > .env.smoke.pre.local',
    'health_attempts:',
    'health_interval_ms:',
    'run_pre_main_smoke:',
    'vars.GOODS_COMM_SYNC_HEALTH_ATTEMPTS',
    'vars.GOODS_COMM_SYNC_HEALTH_INTERVAL_MS',
    'run: npm run sync:prod-to-pre:plan',
    'run: npm run sync:prod-to-pre',
    'run: npm run sync:prod-to-pre:auto',
    'Scheduled prod-to-pre sync skipped',
    'name: prod-to-pre-sync-audit',
    'if-no-files-found: ignore'
  ])

  assertNoDeprecatedNode20Actions('prod-to-pre-sync.yml', content)

  assert.doesNotMatch(
    content,
    /path:\s*\$\{\{\s*runner\.temp\s*\}\/goods-comm-prod-to-pre\.dump/,
    'prod-to-pre-sync.yml: production dump must not be uploaded as an artifact'
  )

  assert.doesNotMatch(
    content,
    /^      GOODS_COMM_SYNC_(DUMP|LOCK|AUDIT)_PATH:\s+\$\{\{\s*runner\.temp\s*\}\}/m,
    'prod-to-pre-sync.yml: runner.temp is only available in step scope, not job-level env'
  )

  assert.doesNotMatch(
    content,
    /postgresql-client/,
    'prod-to-pre-sync.yml: prod-to-pre sync workflow should use the project pg dependency instead of installing PostgreSQL client tools'
  )
}

function assertNoDeprecatedNode20Actions(name, content) {
  assert.doesNotMatch(
    content,
    /uses:\s+actions\/(?:checkout|setup-node)@v4\b/,
    `${name}: actions/checkout and actions/setup-node must use Node 24 runtime tags`
  )
}

function assertDirectBackendDeployProtection() {
  assertIncludesAll('scripts/deploy-backend.mjs', deployBackendScript, [
    "run('npm', ['run', 'build:backend'])",
    "run('npm', ['run', 'smoke:backend:artifact'])",
    "'--attempts'",
    "'--interval-ms'",
    "run(process.execPath, ['scripts/deployed-main-flow-smoke.mjs', '--env', environment])",
    'Verify dist/backend with npm run smoke:backend:artifact.',
    'Run deployed health smoke with node scripts/deployed-health-smoke.mjs --env',
    'Main-flow deployed smoke is optional here',
    "run(process.execPath, ['scripts/migrate-database.mjs', '--env', environment, '--execute'])",
    'VITE_API_BASE_URL',
    'GOODS_COMM_ALLOWED_ORIGINS',
    'GOODS_COMM_OPS_SESSION_SECRET',
    'GOODS_COMM_OPS_ACCOUNTS',
    'GOODS_COMM_TRUSTED_PROXY_IPS',
    'GOODS_COMM_DEPLOY_ALLOW_PROD',
    'GOODS_COMM_DB_MIGRATE_ALLOW_PROD'
  ])

  const buildIndex = deployBackendScript.indexOf("run('npm', ['run', 'build:backend'])")
  const artifactSmokeIndex = deployBackendScript.indexOf("run('npm', ['run', 'smoke:backend:artifact'])")
  const migrationIndex = deployBackendScript.indexOf("run(process.execPath, ['scripts/migrate-database.mjs', '--env', environment, '--execute'])")

  assert.ok(
    buildIndex >= 0 && artifactSmokeIndex > buildIndex && migrationIndex > artifactSmokeIndex,
    'scripts/deploy-backend.mjs: build, artifact smoke, and migration must run in that order'
  )
}

function assertDirectDatabaseMigrationProtection() {
  assertIncludesAll('scripts/migrate-database.mjs', migrateDatabaseScript, [
    "GOODS_COMM_DB_MIGRATE_PG_MODULE",
    'await import(moduleName)',
    'await client.query(schemaSql)',
    'GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true',
    'Refusing to migrate prod without GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true',
    'GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-${environment}${prodOptIn}'
  ])
}

function assertDirectDatabaseProvisionProtection() {
  assertIncludesAll('scripts/provision-database.mjs', provisionDatabaseScript, [
    "GOODS_COMM_DATABASE_ADMIN_URL",
    "GOODS_COMM_DB_PROVISION_CONFIRM=provision-${environment}",
    "GOODS_COMM_DB_PROVISION_ALLOW_PROD=true",
    "GOODS_COMM_DB_PROVISION_ROTATE_PASSWORD",
    "CREATE ROLE ${quoteIdentifier(target.username)} WITH LOGIN PASSWORD",
    "CREATE DATABASE ${quoteIdentifier(target.database)} OWNER ${quoteIdentifier(target.username)}",
    'refusing to provision protected PostgreSQL database',
    'GOODS_COMM_STATE_STORE must be postgres before database provisioning'
  ])
}

function assertIncludesAll(label, content, snippets) {
  for (const snippet of snippets) {
    assert.ok(
      content.includes(snippet),
      `${label}: expected workflow snippet is missing: ${snippet}`
    )
  }
}

function assertWorkflowStepOrder(label, content, stepNames) {
  let previousIndex = -1

  for (const stepName of stepNames) {
    const index = content.indexOf(`- name: ${stepName}`)

    assert.ok(index >= 0, `${label}: expected workflow step is missing: ${stepName}`)
    assert.ok(index > previousIndex, `${label}: workflow step ${stepName} must run after the previous protected deployment step`)

    previousIndex = index
  }
}
