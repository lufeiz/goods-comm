import assert from 'node:assert/strict'
import { createPlatformNotifier } from '../backend/src/platform-notifier.mjs'

assert.throws(() => createPlatformNotifier({
  environment: 'prod',
  notifyProvider: 'mock'
}), /prod 环境不能使用 mock 平台通知/)

const mockNotifier = createPlatformNotifier({
  environment: 'test',
  notifyProvider: 'mock'
})
const mockDeliveries = await mockNotifier.dispatchNotifications([{
  id: 'notification_mock_trade_created',
  userId: 'user_weixin_mock',
  type: 'trade_created',
  title: '新交易意向',
  body: '买家已发起交易',
  targetType: 'trade',
  targetId: 'trade_mock',
  createdAt: Date.now()
}], [])

assert.equal(mockNotifier.provider, 'mock')
assert.equal(mockDeliveries.length, 1)
assert.equal(mockDeliveries[0].status, 'mock_sent')
assert.equal(mockDeliveries[0].notificationId, 'notification_mock_trade_created')

const fetchCalls = []
const wechatNotifier = createPlatformNotifier({
  environment: 'pre',
  notifyProvider: 'wechat',
  weixinAppId: 'wx-test-app',
  weixinAppSecret: 'wx-test-secret',
  wechatSubscribeTemplateIds: 'trade_created:tmpl_trade_created,trade_confirmed:tmpl_trade_confirmed',
  wechatSubscribeTemplateFields: 'title:thing5,body:thing6,time:time7',
  fetcher: async (url, options = {}) => {
    fetchCalls.push({
      url: String(url),
      body: options.body ? JSON.parse(options.body) : null
    })

    if (String(url).includes('/cgi-bin/token')) {
      return jsonResponse({
        access_token: 'access-token-for-smoke'
      })
    }

    return jsonResponse({
      errcode: 0,
      errmsg: 'ok'
    })
  }
})

const wechatDeliveries = await wechatNotifier.dispatchNotifications([{
  id: 'notification_wechat_trade_created',
  userId: 'user_weixin_real',
  type: 'trade_created',
  title: '新交易意向',
  body: '买家已发起交易',
  targetType: 'trade',
  targetId: 'trade_wechat',
  createdAt: 1779950000000
}], [{
  id: 'user_weixin_real',
  provider: 'weixin',
  platformId: 'openid_weixin_real'
}], {
  traceId: 'trace_platform_notify_smoke'
})

assert.equal(wechatNotifier.provider, 'wechat')
assert.equal(wechatDeliveries.length, 1)
assert.equal(wechatDeliveries[0].status, 'sent')
assert.equal(fetchCalls.length, 2)
assert.equal(fetchCalls[1].body.touser, 'openid_weixin_real')
assert.equal(fetchCalls[1].body.template_id, 'tmpl_trade_created')
assert.equal(fetchCalls[1].body.page, 'pages/orders/orders')
assert.equal(fetchCalls[1].body.miniprogram_state, 'trial')
assert.equal(fetchCalls[1].body.data.thing5.value, '新交易意向')
assert.equal(fetchCalls[1].body.data.thing6.value, '买家已发起交易')
assert.match(fetchCalls[1].body.data.time7.value, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)

const skippedDeliveries = await wechatNotifier.dispatchNotifications([{
  id: 'notification_alipay_trade_created',
  userId: 'user_alipay',
  type: 'trade_created'
}], [{
  id: 'user_alipay',
  provider: 'alipay',
  platformId: 'alipay-user-id'
}])
assert.equal(skippedDeliveries[0].status, 'skipped')
assert.match(skippedDeliveries[0].message, /unsupported recipient provider/)

const failedNotifier = createPlatformNotifier({
  environment: 'pre',
  notifyProvider: 'wechat',
  weixinAppId: 'wx-test-app',
  weixinAppSecret: 'wx-test-secret',
  wechatSubscribeTemplateId: 'tmpl_default',
  wechatAccessToken: 'access-token-for-smoke',
  fetcher: async () => jsonResponse({
    errcode: 43101,
    errmsg: 'user refuse to accept the msg'
  })
})
const failedDeliveries = await failedNotifier.dispatchNotifications([{
  id: 'notification_wechat_failed',
  userId: 'user_weixin_real',
  type: 'trade_confirmed'
}], [{
  id: 'user_weixin_real',
  provider: 'weixin',
  platformId: 'openid_weixin_real'
}])
assert.equal(failedDeliveries[0].status, 'failed')
assert.match(failedDeliveries[0].message, /user refuse/)

await assert.rejects(() => createPlatformNotifier({
  environment: 'pre',
  notifyProvider: 'wechat',
  weixinAppId: 'REPLACE_WITH_PRE_WECHAT_APP_ID',
  weixinAppSecret: 'wx-test-secret',
  wechatSubscribeTemplateId: 'tmpl_default',
  fetcher: async () => jsonResponse({})
}).dispatchNotifications([{
  id: 'notification_bad_config',
  userId: 'user_weixin_real',
  type: 'trade_created'
}], [{
  id: 'user_weixin_real',
  provider: 'weixin',
  platformId: 'openid_weixin_real'
}]), /平台通知配置未完成/)

console.log('Platform notifier smoke checks passed')

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  }
}
