import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()

const runbook = await read('docs/database-provisioning-runbook.md')
const readme = await read('README.md')
const environmentMatrix = await read('docs/environment-matrix.md')
const missingInfo = await read('docs/deployment-missing-info.md')
const remediationMatrix = await read('docs/production-remediation-matrix-20260601.md')
const readinessAudit = await read('docs/deployment-readiness-audit.md')
const strictReadinessAudit = await read('docs/deployment-readiness-audit-strict.md')
const readinessAuditJson = JSON.parse(await read('docs/deployment-readiness-audit.json'))

assertIncludesAll('docs/database-provisioning-runbook.md', runbook, [
  'GOODS_COMM_DATABASE_URL',
  'GOODS_COMM_DATABASE_ADMIN_URL',
  'npm run db:provision:pre:plan',
  'GOODS_COMM_DB_PROVISION_CONFIRM=provision-pre npm run db:provision:pre',
  'GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre npm run db:migrate:pre',
  'npm run smoke:deployed:pre:main',
  'GOODS_COMM_DB_PROVISION_ALLOW_PROD=true',
  'GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true',
  'GOODS_COMM_DEPLOY_ALLOW_PROD=true',
  'GOODS_COMM_SYNC_AUTO_ENABLED=true npm run sync:prod-to-pre:auto'
])

assertIncludesAll('README.md', readme, [
  'docs/database-provisioning-runbook.md',
  'GOODS_COMM_DATABASE_URL',
  'GOODS_COMM_DATABASE_ADMIN_URL',
  'npm run db:provision:pre:plan',
  'npm run db:migrate:pre:plan',
  'npm run sync:prod-to-pre:plan'
])

assertIncludesAll('docs/environment-matrix.md', environmentMatrix, [
  'GOODS_COMM_DATABASE_ADMIN_URL',
  'npm run db:provision:pre:plan',
  'GOODS_COMM_DB_PROVISION_CONFIRM=provision-pre',
  'GOODS_COMM_DB_PROVISION_ALLOW_PROD=true',
  'docs/database-provisioning-runbook.md'
])

assertIncludesAll('docs/deployment-missing-info.md', missingInfo, [
  'GOODS_COMM_DATABASE_ADMIN_URL',
  'docs/database-provisioning-runbook.md',
  'npm run db:provision:pre:plan',
  'GOODS_COMM_DB_PROVISION_CONFIRM=provision-pre npm run db:provision:pre'
])

assertIncludesAll('docs/production-remediation-matrix-20260601.md', remediationMatrix, [
  'docs/database-provisioning-runbook.md',
  'GOODS_COMM_DATABASE_ADMIN_URL',
  'GOODS_COMM_DATABASE_URL',
  'npm run db:provision:pre',
  'npm run db:migrate:pre',
  '/health/ready'
])

for (const [name, content] of [
  ['docs/deployment-readiness-audit.md', readinessAudit],
  ['docs/deployment-readiness-audit-strict.md', strictReadinessAudit]
]) {
  assertIncludesAll(name, content, [
    'npm run db:provision:pre:plan',
    'GOODS_COMM_DB_PROVISION_CONFIRM=provision-pre npm run db:provision:pre',
    'GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre npm run db:migrate:pre',
    'npm run db:provision:prod:plan',
    'GOODS_COMM_DB_PROVISION_CONFIRM=provision-prod GOODS_COMM_DB_PROVISION_ALLOW_PROD=true npm run db:provision:prod',
    'GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-prod GOODS_COMM_DB_MIGRATE_ALLOW_PROD=true npm run db:migrate:prod'
  ])

  assertOrder(name, content, [
    'npm run db:provision:pre:plan',
    'GOODS_COMM_DB_PROVISION_CONFIRM=provision-pre npm run db:provision:pre',
    'GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre npm run db:migrate:pre',
    'GOODS_COMM_DB_MIGRATE_CONFIRM=migrate-pre GOODS_COMM_DEPLOY_CONFIRM=deploy-pre npm run deploy:backend:pre'
  ])
}

assert.deepEqual(
  readinessAuditJson.releaseGateCommands?.filter((command) => command.includes('db:provision')),
  [
    'npm run db:provision:pre:plan',
    'GOODS_COMM_DB_PROVISION_CONFIRM=provision-pre npm run db:provision:pre',
    'npm run db:provision:prod:plan',
    'GOODS_COMM_DB_PROVISION_CONFIRM=provision-prod GOODS_COMM_DB_PROVISION_ALLOW_PROD=true npm run db:provision:prod'
  ],
  'docs/deployment-readiness-audit.json: releaseGateCommands must include protected pre/prod database provisioning'
)

console.log('Database runbook smoke checks passed')

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

function assertOrder(name, content, snippets) {
  let previousIndex = -1

  for (const snippet of snippets) {
    const index = content.indexOf(snippet)

    assert.ok(index >= 0, `${name}: expected ordered snippet is missing: ${snippet}`)
    assert.ok(index > previousIndex, `${name}: expected ${snippet} to appear after the previous release command`)

    previousIndex = index
  }
}
