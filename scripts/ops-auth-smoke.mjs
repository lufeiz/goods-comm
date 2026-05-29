import assert from 'node:assert/strict'
import { createOpsAuth, parseOpsAccounts } from '../backend/src/ops-auth.mjs'

const accounts = parseOpsAccounts('support:secret-1:moderation|support|risk,observer:secret-2:telemetry')
assert.equal(accounts.length, 2)
assert.equal(accounts[0].id, 'support')
assert.deepEqual(accounts[0].roles, ['moderation', 'support', 'risk'])
assert.deepEqual(accounts[1].roles, ['telemetry'])

const auth = createOpsAuth({
  environment: 'prod',
  moderationSecret: 'moderation-secret',
  opsSessionSecret: 'ops-session-secret',
  opsAccounts: 'support:secret-1:moderation|support|risk'
})
const session = auth.login({
  accountId: 'support',
  password: 'secret-1'
})
assert.equal(session.operator.id, 'support')
assert.deepEqual(session.operator.roles, ['moderation', 'support', 'risk'])
const requestAuth = auth.authenticateRequest({
  headers: {
    'x-ops-session-token': session.token
  }
}, new URL('https://api.example.com/ops/reports'))
assert.equal(requestAuth.actorId, 'support')
assert.equal(requestAuth.source, 'session')

await assert.rejects(
  async () => auth.login({
    accountId: 'support',
    password: 'bad-secret'
  }),
  /运营账号或密码无效/
)

const lockedAuth = createOpsAuth({
  environment: 'prod',
  moderationSecret: 'moderation-secret',
  opsSessionSecret: 'ops-session-secret',
  opsAccounts: 'support:secret-1:moderation|support|risk',
  opsLoginMaxFailures: 2,
  opsLoginWindowMs: 60_000,
  opsLoginLockMs: 60_000
})
await assert.rejects(
  async () => lockedAuth.login({
    accountId: 'support',
    password: 'bad-secret-1'
  }),
  /运营账号或密码无效/
)
await assert.rejects(
  async () => lockedAuth.login({
    accountId: 'support',
    password: 'bad-secret-2'
  }),
  (error) => {
    assert.equal(error.status, 429)
    assert.equal(error.code, 'TOO_MANY_REQUESTS')
    assert.match(error.message, /运营登录失败次数过多/)
    return true
  }
)
await assert.rejects(
  async () => lockedAuth.login({
    accountId: 'support',
    password: 'secret-1'
  }),
  /运营登录失败次数过多/
)

const sharedSecretAuth = createOpsAuth({
  environment: 'dev',
  moderationSecret: 'shared-secret',
  opsSessionSecret: 'ops-session-secret'
})
const sharedSession = sharedSecretAuth.login({
  accountId: 'ops-console',
  password: 'shared-secret'
})
assert.equal(sharedSession.operator.id, 'ops-console')
assert.equal(sharedSecretAuth.authenticateRequest({
  headers: {
    'x-moderation-secret': 'shared-secret',
    'x-ops-actor-id': 'support-worker'
  }
}, new URL('https://api.example.com/ops/reports')).actorId, 'support-worker')

console.log('Ops auth smoke checks passed')
