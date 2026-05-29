import assert from 'node:assert/strict'
import { createPlatformAuthResolver } from '../backend/src/platform-auth.mjs'

const demo = createPlatformAuthResolver({
  environment: 'dev',
  authMode: 'demo'
})
const demoLogin = await demo.resolveLoginData({
  provider: 'weixin',
  code: 'demo-code'
})
assert.equal(demoLogin.platformIdentity.provider, 'weixin')
assert.equal(demoLogin.platformIdentity.platformId.startsWith('demo_weixin_'), true)
assert.equal(demoLogin.platformIdentity.authSource, 'demo')
const h5DemoLogin = await demo.resolveLoginData({
  provider: 'h5',
  code: 'h5-demo-code'
})
assert.equal(h5DemoLogin.platformIdentity.provider, 'h5')
assert.equal(h5DemoLogin.platformIdentity.platformId.startsWith('demo_h5_'), true)
assert.equal(h5DemoLogin.platformIdentity.authSource, 'demo')

assert.throws(() => createPlatformAuthResolver({
  environment: 'pre',
  authMode: 'demo'
}), /pre 环境不能使用演示登录/)

const weixinCalls = []
const weixin = createPlatformAuthResolver({
  environment: 'prod',
  authMode: 'platform',
  weixinAppId: 'wx-app-id',
  weixinAppSecret: 'wx-app-secret',
  fetcher: async (url, options) => {
    weixinCalls.push({ url: String(url), options })
    return jsonResponse({
      openid: 'wx-openid-1',
      unionid: 'wx-union-1',
      session_key: 'server-secret-session-key'
    })
  }
})
const weixinLogin = await weixin.resolveLoginData({
  provider: 'weixin',
  code: 'wx-code'
})
assert.equal(weixinLogin.platformIdentity.platformId, 'wx-openid-1')
assert.equal(weixinLogin.platformIdentity.unionId, 'wx-union-1')
assert.equal(weixinLogin.platformIdentity.authSource, 'weixin_jscode2session')
assert.match(weixinCalls[0].url, /jscode2session/)
assert.match(weixinCalls[0].url, /js_code=wx-code/)

const alipayCalls = []
const alipay = createPlatformAuthResolver({
  environment: 'prod',
  authMode: 'platform',
  alipayAppId: 'ali-app-id',
  alipayPrivateKey: 'ali-private-key',
  signAlipayParams: (params) => {
    assert.equal(params.method, 'alipay.system.oauth.token')
    assert.equal(params.grant_type, 'authorization_code')
    assert.equal(params.code, 'ali-code')
    return 'mock-sign'
  },
  fetcher: async (url, options) => {
    alipayCalls.push({ url: String(url), options })
    assert.equal(String(options.body).includes('sign=mock-sign'), true)
    return jsonResponse({
      alipay_system_oauth_token_response: {
        code: '10000',
        user_id: 'ali-user-1',
        access_token: 'access-token'
      }
    })
  }
})
const alipayLogin = await alipay.resolveLoginData({
  provider: 'alipay',
  code: 'ali-code'
})
assert.equal(alipayLogin.platformIdentity.platformId, 'ali-user-1')
assert.equal(alipayLogin.platformIdentity.authSource, 'alipay_system_oauth_token')
assert.equal(alipayCalls[0].url, 'https://openapi.alipay.com/gateway.do')

await assert.rejects(
  () => createPlatformAuthResolver({
    environment: 'prod',
    authMode: 'platform',
    weixinAppId: 'REPLACE_WITH_PROD_WECHAT_APP_ID',
    weixinAppSecret: 'REPLACE_WITH_PROD_WECHAT_APP_SECRET',
    fetcher: async () => jsonResponse({})
  }).resolveLoginData({
    provider: 'weixin',
    code: 'wx-code'
  }),
  /平台登录配置未完成/
)

await assert.rejects(
  () => createPlatformAuthResolver({
    environment: 'prod',
    authMode: 'platform',
    fetcher: async () => jsonResponse({})
  }).resolveLoginData({
    provider: 'h5',
    code: 'h5-code'
  }),
  /不支持的平台登录类型/
)

console.log('Platform auth smoke checks passed')

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  }
}
