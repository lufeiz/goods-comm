import assert from 'node:assert/strict'
import { CosObjectStore, createCosAuthorization } from '../backend/src/cos-object-store.mjs'
import { createContentSafetyClient } from '../backend/src/content-safety.mjs'

const mockSafety = createContentSafetyClient({
  environment: 'dev',
  contentSafetyProvider: 'mock'
})
const mockRejected = await mockSafety.reviewItemPayload({
  title: '违禁商品',
  description: '本地审核'
})
assert.equal(mockRejected.moderation.status, 'rejected')

assert.throws(() => createContentSafetyClient({
  environment: 'prod',
  contentSafetyProvider: 'mock'
}), /prod 环境不能使用 mock 内容安全/)

const wechatCalls = []
const wechatSafety = createContentSafetyClient({
  environment: 'prod',
  contentSafetyProvider: 'wechat',
  weixinAppId: 'wx-app-id',
  weixinAppSecret: 'wx-app-secret',
  fetcher: async (url, options) => {
    wechatCalls.push({ url: String(url), options })

    if (String(url).includes('/cgi-bin/token')) {
      return jsonResponse({
        access_token: 'access-token'
      })
    }

    if (String(url).includes('/wxa/msg_sec_check')) {
      const body = JSON.parse(options.body)
      assert.equal(body.content, '普通商品 干净描述')
      return jsonResponse({
        errcode: 0,
        result: {
          suggest: 'pass'
        }
      })
    }

    if (String(url).includes('/wxa/media_check_async')) {
      const body = JSON.parse(options.body)
      assert.equal(body.media_url, 'https://cdn.example.com/assets/items/1.png')
      return jsonResponse({
        errcode: 0,
        trace_id: 'trace-media'
      })
    }

    throw new Error(`unexpected url ${url}`)
  }
})
const wechatText = await wechatSafety.reviewItemPayload({
  title: '普通商品',
  description: '干净描述'
})
assert.equal(wechatText.moderation.status, 'approved_auto')

const wechatImage = await wechatSafety.reviewUploadedImage({
  url: 'https://cdn.example.com/assets/items/1.png',
  status: 'uploaded'
})
assert.equal(wechatImage.status, 'pending_review')
assert.equal(wechatImage.moderationStatus, 'pending_media_review')
assert.equal(wechatImage.traceId, 'trace-media')
assert.equal(wechatCalls.some((call) => call.url.includes('/wxa/media_check_async')), true)

await assert.rejects(
  () => createContentSafetyClient({
    environment: 'prod',
    contentSafetyProvider: 'wechat',
    weixinAppId: 'REPLACE_WITH_PROD_WECHAT_APP_ID',
    weixinAppSecret: 'REPLACE_WITH_PROD_WECHAT_APP_SECRET',
    fetcher: async () => jsonResponse({})
  }).reviewItemPayload({
    title: '普通商品'
  }),
  /内容安全配置未完成/
)

const authorization = createCosAuthorization({
  method: 'PUT',
  url: new URL('https://goods-comm-prod.cos.ap-shanghai.myqcloud.com/items/1.png'),
  secretId: 'AKID123',
  secretKey: 'SECRET',
  now: 1710000000
})
assert.match(authorization, /q-ak=AKID123/)
assert.match(authorization, /q-sign-algorithm=sha1/)
assert.match(authorization, /q-header-list=host/)

const cosCalls = []
const cosStore = new CosObjectStore({
  bucket: 'goods-comm-prod',
  region: 'ap-shanghai',
  secretId: 'AKID123',
  secretKey: 'SECRET',
  baseUrl: 'https://goods-comm-prod.cos.ap-shanghai.myqcloud.com',
  publicBaseUrl: 'https://cdn.goods-comm.test/assets',
  fetcher: async (url, options) => {
    cosCalls.push({ url: String(url), options })
    assert.equal(options.method, 'PUT')
    assert.equal(options.headers.host, 'goods-comm-prod.cos.ap-shanghai.myqcloud.com')
    assert.match(options.headers.authorization, /q-ak=AKID123/)

    return {
      ok: true,
      status: 200
    }
  }
})
const upload = await cosStore.saveItemImage({
  filename: 'item.png',
  mimeType: 'image/png',
  bytes: Buffer.from([137, 80, 78, 71])
})
assert.equal(upload.status, 'uploaded')
assert.equal(upload.url.startsWith('https://cdn.goods-comm.test/assets/items/'), true)
assert.equal(cosCalls.length, 1)

console.log('Storage and content safety smoke checks passed')

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  }
}
