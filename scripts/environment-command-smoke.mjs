import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { VALID_ENVIRONMENTS } from './env-files.mjs'

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const scripts = packageJson.scripts || {}

for (const environment of VALID_ENVIRONMENTS) {
  assertScript(`env:check:${environment}`, `node scripts/check-environments.mjs ${environment}`)
  assertScript(`backend:start:${environment}`, `node scripts/start-backend.mjs ${environment}`)
  assertScript(`build:h5:${environment}`, `uni build -p h5 --mode ${environment} --outDir dist/build/${environment}/h5`)
  assertScript(`build:weixin:${environment}`, `node scripts/build-weixin.mjs --mode ${environment}`)
  assertScript(`build:alipay:${environment}`, `node scripts/build-alipay.mjs --mode ${environment}`)
  assertScript(`db:provision:${environment}:plan`, `node scripts/provision-database.mjs --env ${environment}`)
  assertScript(`db:provision:${environment}`, `node scripts/provision-database.mjs --env ${environment} --execute`)
  assertScript(`db:migrate:${environment}:plan`, `node scripts/migrate-database.mjs --env ${environment}`)
  assertScript(`db:migrate:${environment}`, `node scripts/migrate-database.mjs --env ${environment} --execute`)
  assertScript(`deploy:backend:${environment}:plan`, `node scripts/deploy-backend.mjs --env ${environment}`)
  assertScript(`deploy:backend:${environment}`, `node scripts/deploy-backend.mjs --env ${environment} --execute`)
  assertScript(`deploy:frontend:${environment}:plan`, `node scripts/deploy-frontend.mjs --env ${environment}`)
  assertScript(`deploy:frontend:${environment}`, `node scripts/deploy-frontend.mjs --env ${environment} --execute`)
  assertScript(`smoke:deployed:${environment}`, `node scripts/deployed-health-smoke.mjs --env ${environment}`)
  assertScript(`smoke:deployed:${environment}:main`, `node scripts/deployed-main-flow-smoke.mjs --env ${environment}`)
}

assertScript('db:provision:plan', 'node scripts/provision-database.mjs')
assertScript('db:migrate:plan', 'node scripts/migrate-database.mjs')
assertScript('sync:prod-to-pre:plan', 'node scripts/sync-prod-to-pre.mjs')
assertScript('sync:prod-to-pre', 'node scripts/sync-prod-to-pre.mjs --execute')
assertScript('sync:prod-to-pre:auto', 'node scripts/sync-prod-to-pre.mjs --auto')

console.log(`Environment command smoke checks passed for ${VALID_ENVIRONMENTS.length} environments`)

function assertScript(name, expected) {
  assert.equal(scripts[name], expected, `package.json: script ${name} must be ${expected}`)
}
