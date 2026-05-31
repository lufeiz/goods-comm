import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const planPre = runPlan(['--env', 'pre'])
assert.equal(planPre.status, 0)
assertIncludesAll(planPre.stdout, [
  'Frontend deployment plan for pre:',
  'npm run build:h5:pre',
  'npm run build:weixin:pre',
  'npm run build:alipay:pre',
  'Verify pre frontend artifacts with artifact checks before upload.',
  'Targets: h5, mp-weixin, mp-alipay',
  'Missing preconditions:',
  '[pre] VITE_API_BASE_URL must be real before frontend deploy',
  '[pre] GOODS_COMM_CLOUDBASE_ENV_ID must be real before H5 deploy',
  '[pre] GOODS_COMM_WECHAT_APP_ID must be real before WeChat Mini Program upload',
  '[pre] GOODS_COMM_ALIPAY_APP_ID must be real before Alipay Mini Program upload',
  'GOODS_COMM_WECHAT_DEVTOOLS_CLI or WECHAT_DEVTOOLS_CLI',
  'GOODS_COMM_ALIPAY_MINI_CLI or ALIPAY_MINI_CLI'
])

const planProdH5 = runPlan(['--env', 'prod', '--target', 'h5', '--skip-build'])
assert.equal(planProdH5.status, 0)
assertIncludesAll(planProdH5.stdout, [
  'Frontend deployment plan for prod:',
  'Skip frontend builds because --skip-build or GOODS_COMM_FRONTEND_DEPLOY_SKIP_BUILD=true was provided.',
  'Targets: h5',
  'GOODS_COMM_DEPLOY_ALLOW_PROD=true is required for production frontend deploy'
])
assert.doesNotMatch(planProdH5.stdout, /build:weixin:prod/)
assert.doesNotMatch(planProdH5.stdout, /build:alipay:prod/)

const invalidTarget = runPlan(['--env', 'pre', '--target', 'desktop'])
assert.notEqual(invalidTarget.status, 0)
assert.match(invalidTarget.stderr, /Frontend deploy target must be/)

console.log('Frontend deploy plan smoke checks passed')

function runPlan(args) {
  return spawnSync(process.execPath, ['scripts/deploy-frontend.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })
}

function assertIncludesAll(content, snippets) {
  for (const snippet of snippets) {
    assert.ok(content.includes(snippet), `Expected frontend deploy plan to include: ${snippet}`)
  }
}
