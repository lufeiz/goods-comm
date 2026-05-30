import assert from 'node:assert/strict'
import { createOpsAlertClient } from '../backend/src/ops-alerts.mjs'

assert.throws(() => createOpsAlertClient({
  alertProvider: 'email'
}), /GOODS_COMM_ALERT_PROVIDER/)

const disabledAlerts = createOpsAlertClient({
  environment: 'test',
  alertProvider: 'none'
})
const disabledReadiness = await disabledAlerts.check()
const skippedAlert = await disabledAlerts.alert({
  type: 'platform_notification_failed'
})
assert.equal(disabledAlerts.provider, 'none')
assert.equal(disabledReadiness.ok, true)
assert.equal(disabledReadiness.configured, false)
assert.equal(skippedAlert.status, 'skipped')

await assert.rejects(() => createOpsAlertClient({
  environment: 'prod',
  alertProvider: 'none'
}).check(), /prod 环境必须配置 GOODS_COMM_ALERT_PROVIDER=webhook/)

const capturedCalls = []
const webhookAlerts = createOpsAlertClient({
  environment: 'pre',
  alertProvider: 'webhook',
  alertWebhookUrl: 'https://alerts.internal.invalid/webhooks/goods-comm',
  alertWebhookToken: 'ops-alert-token-for-smoke',
  alertTimeoutMs: 500,
  fetcher: async (url, options = {}) => {
    capturedCalls.push({
      url: String(url),
      method: options.method,
      headers: options.headers,
      body: JSON.parse(options.body)
    })

    return jsonResponse({
      ok: true
    }, 202)
  }
})

const webhookReadiness = await webhookAlerts.check()
const webhookResult = await webhookAlerts.alert({
  level: 'warn',
  type: 'platform_notification_failed',
  traceId: 'trace_ops_alert_smoke',
  secretToken: 'must-not-leak',
  deliveries: [{
    id: 'notification_delivery_smoke',
    userId: 'user_smoke',
    type: 'trade_reviewed',
    status: 'failed',
    message: 'smoke forced failure'
  }]
})

assert.equal(webhookAlerts.provider, 'webhook')
assert.equal(webhookReadiness.ok, true)
assert.equal(webhookReadiness.configured, true)
assert.equal(webhookReadiness.timeoutMs, 500)
assert.equal(webhookResult.sent, true)
assert.equal(webhookResult.statusCode, 202)
assert.equal(capturedCalls.length, 1)
assert.equal(capturedCalls[0].url, 'https://alerts.internal.invalid/webhooks/goods-comm')
assert.equal(capturedCalls[0].method, 'POST')
assert.equal(capturedCalls[0].headers.authorization, 'Bearer ops-alert-token-for-smoke')
assert.equal(capturedCalls[0].body.service, 'goods-comm-backend')
assert.equal(capturedCalls[0].body.environment, 'pre')
assert.equal(capturedCalls[0].body.type, 'platform_notification_failed')
assert.equal(capturedCalls[0].body.traceId, 'trace_ops_alert_smoke')
assert.equal(capturedCalls[0].body.secretToken, undefined)
assert.equal(capturedCalls[0].body.deliveries[0].id, 'notification_delivery_smoke')

await assert.rejects(() => createOpsAlertClient({
  environment: 'pre',
  alertProvider: 'webhook',
  alertWebhookUrl: 'https://pre-alerts.goods-comm.example.com/webhooks/goods-comm',
  alertWebhookToken: 'ops-alert-token-for-smoke'
}).check(), /生产告警配置未完成：生产告警 Webhook URL/)

await assert.rejects(() => createOpsAlertClient({
  environment: 'prod',
  alertProvider: 'webhook',
  alertWebhookUrl: 'http://alerts.internal.invalid/webhooks/goods-comm',
  alertWebhookToken: 'ops-alert-token-for-smoke'
}).check(), /pre\/prod 告警 Webhook 必须使用 HTTPS/)

await assert.rejects(() => createOpsAlertClient({
  environment: 'prod',
  alertProvider: 'webhook',
  alertWebhookUrl: 'https://alerts.internal.invalid/webhooks/goods-comm',
  fetcher: async () => jsonResponse({})
}).check(), /生产告警配置未完成：生产告警 Webhook Token/)

await assert.rejects(() => createOpsAlertClient({
  environment: 'pre',
  alertProvider: 'webhook',
  alertWebhookUrl: 'https://alerts.internal.invalid/webhooks/goods-comm',
  alertWebhookToken: 'ops-alert-token-for-smoke',
  fetcher: async () => jsonResponse({
    error: 'webhook rejected'
  }, 500)
}).alert({
  type: 'platform_notification_failed'
}), /生产告警 Webhook 返回 HTTP 500/)

console.log('Ops alerts smoke checks passed')

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  }
}
