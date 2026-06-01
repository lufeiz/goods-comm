import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  createBffState,
  handleBffRequest,
  ITEM_STATUS,
  TRADE_STATUS
} from '../../src/bff/handler.js'
import { USER_AGREEMENT_VERSION } from '../../src/config/app.js'

const nearLocation = {
  latitude: 31.2301,
  longitude: 121.4556,
  accuracy: 60,
  capturedAt: Date.now()
}

describe('BFF contract main flow', () => {
  let state

  beforeEach(() => {
    state = createBffState([])
  })

  it('enforces protected login agreement and session secret contracts', async () => {
    const originalEnv = process.env.GOODS_COMM_ENV
    const originalSecret = process.env.GOODS_COMM_SESSION_SECRET

    try {
      process.env.GOODS_COMM_ENV = 'prod'
      process.env.GOODS_COMM_SESSION_SECRET = 'contract-session-secret'

      await assert.rejects(
        () => login('missing-agreement', '缺协议用户'),
        /用户协议和隐私政策/
      )

      delete process.env.GOODS_COMM_SESSION_SECRET

      await assert.rejects(
        () => login('missing-session-secret', '缺密钥用户', { agreement: true }),
        /会话密钥配置未完成/
      )

      process.env.GOODS_COMM_SESSION_SECRET = 'contract-session-secret'
      const session = await login('protected-login-ok', '协议用户', { agreement: true })

      assert.match(session.token, /^session_/)
      assert.equal(session.user.agreementVersion, USER_AGREEMENT_VERSION)
      assert.equal(state.sessions.every((record) => !record.token && /^[a-f0-9]{64}$/.test(record.tokenHash)), true)
    } finally {
      restoreEnv('GOODS_COMM_ENV', originalEnv)
      restoreEnv('GOODS_COMM_SESSION_SECRET', originalSecret)
    }
  })

  it('publishes only authenticated, fresh, precise, server-resolved items', async () => {
    const seller = await login('seller-publish-contract', '契约卖家', { agreement: true })
    const upload = await uploadItemImage(seller.token)
    const region = await resolveRegion()

    await assert.rejects(
      () => publishItem(seller.token, upload, {
        title: '过期定位商品',
        location: sellerLocation({
          capturedAt: Date.now() - 6 * 60 * 1000
        })
      }),
      /当前位置已过期/
    )

    await assert.rejects(
      () => publishItem(seller.token, upload, {
        title: '低精度定位商品',
        location: sellerLocation({
          accuracy: 260
        })
      }),
      /定位精度约 260m/
    )

    const idempotentPublishLocation = sellerLocation({
      communityId: 'client-spoofed-community',
      streetId: 'client-spoofed-street'
    })
    const item = await publishItem(seller.token, upload, {
      title: '契约发布商品',
      idempotencyKey: 'contract_item_publish_key',
      location: idempotentPublishLocation
    })
    const replayedItem = await publishItem(seller.token, upload, {
      title: '契约发布商品',
      idempotencyKey: 'contract_item_publish_key',
      location: idempotentPublishLocation
    })

    assert.equal(item.id, replayedItem.id)
    assert.equal(item.status, ITEM_STATUS.ONLINE)
    assert.equal(item.seller.id, seller.user.id)
    assert.equal(item.seller.contactCode, undefined)
    assert.equal(item.location.communityId, region.communityId)
    assert.equal(item.location.streetId, region.streetId)
    assertNoPublicCoordinates(item)
    assert.equal(state.items.filter((candidate) => candidate.title === '契约发布商品').length, 1)

    const listed = await handleBffRequest('/items', {
      method: 'GET',
      data: nearLocation
    }, state)

    assert.equal(listed.items.some((candidate) => candidate.id === item.id), true)
    assert.equal(listed.items.find((candidate) => candidate.id === item.id).seller.contactCode, undefined)
  })

  it('protects trade creation, confirmation, completion, review, and idempotent replays', async () => {
    const seller = await login('seller-trade-contract', '交易卖家', { agreement: true })
    const buyer = await login('buyer-trade-contract', '交易买家', { agreement: true })
    const upload = await uploadItemImage(seller.token)
    const item = await publishItem(seller.token, upload, {
      title: '契约交易商品'
    })

    await assert.rejects(
      () => handleBffRequest('/trades', {
        method: 'POST',
        token: buyer.token,
        data: {
          itemId: item.id,
          buyerLocation: {
            ...nearLocation,
            capturedAt: Date.now() - 6 * 60 * 1000
          }
        }
      }, state),
      /当前位置已过期/
    )

    const trade = await createTrade(buyer.token, item.id)
    const duplicateTrade = await createTrade(buyer.token, item.id)

    assert.equal(duplicateTrade.id, trade.id)
    assert.equal(trade.status, TRADE_STATUS.PENDING_SELLER_CONFIRM)
    assert.equal(trade.contactCode, '')
    assert.equal(trade.locationAudit.regionStatus, 'match')

    const confirmed = await handleBffRequest(`/trades/${trade.id}/status`, {
      method: 'PATCH',
      token: seller.token,
      idempotencyKey: 'contract_trade_confirm_key',
      data: {
        status: TRADE_STATUS.PENDING_MEETUP
      }
    }, state)
    const replayedConfirmed = await handleBffRequest(`/trades/${trade.id}/status`, {
      method: 'PATCH',
      token: seller.token,
      idempotencyKey: 'contract_trade_confirm_key',
      data: {
        status: TRADE_STATUS.PENDING_MEETUP
      }
    }, state)

    assert.equal(confirmed.status, TRADE_STATUS.PENDING_MEETUP)
    assert.match(confirmed.contactCode, /^GC-[A-F0-9]{6}-[A-Z0-9]{4}$/)
    assert.equal(replayedConfirmed.contactCode, confirmed.contactCode)
    assert.equal(state.trades.find((candidate) => candidate.id === trade.id).timeline.filter((event) => event.status === TRADE_STATUS.PENDING_MEETUP).length, 1)

    await assert.rejects(
      () => handleBffRequest(`/trades/${trade.id}/review`, {
        method: 'POST',
        token: buyer.token,
        data: {
          rating: 5,
          content: '未完成前不能评价'
        }
      }, state),
      /交易完成后才能评价/
    )

    const completed = await handleBffRequest(`/trades/${trade.id}/status`, {
      method: 'PATCH',
      token: buyer.token,
      data: {
        status: TRADE_STATUS.COMPLETED
      }
    }, state)

    assert.equal(completed.status, TRADE_STATUS.COMPLETED)
    assert.equal(completed.contactCode, '')
    assert.equal(completed.contactCodeExpiresAt, null)

    const reviewPayload = {
      rating: 5,
      content: '契约交易顺利',
      tags: ['准时', '物品一致']
    }
    const review = await handleBffRequest(`/trades/${trade.id}/review`, {
      method: 'POST',
      token: buyer.token,
      idempotencyKey: 'contract_trade_review_key',
      data: reviewPayload
    }, state)
    const replayedReview = await handleBffRequest(`/trades/${trade.id}/review`, {
      method: 'POST',
      token: buyer.token,
      idempotencyKey: 'contract_trade_review_key',
      data: reviewPayload
    }, state)

    assert.equal(review.id, replayedReview.id)
    assert.equal(review.tradeId, trade.id)
    assert.equal(review.reviewer.id, buyer.user.id)
    assert.equal(review.reviewee.id, seller.user.id)
    assert.equal(state.reviews.filter((candidate) => candidate.tradeId === trade.id && candidate.reviewer?.id === buyer.user.id).length, 1)

    const soldItem = await handleBffRequest(`/items/${item.id}`, {
      method: 'GET',
      data: nearLocation
    }, state)

    assert.equal(soldItem.status, ITEM_STATUS.SOLD)
    assertNoPublicCoordinates(soldItem)
  })

  async function login(code, nickname, options = {}) {
    return handleBffRequest('/auth/login', {
      method: 'POST',
      data: withAgreement({
        provider: 'weixin',
        code,
        userInfo: {
          nickname,
          avatarUrl: ''
        }
      }, options.agreement)
    }, state)
  }

  async function resolveRegion() {
    return handleBffRequest('/lbs/resolve-region', {
      method: 'POST',
      data: {
        latitude: nearLocation.latitude,
        longitude: nearLocation.longitude,
        coordType: 'gcj02'
      }
    }, state)
  }

  async function uploadItemImage(token) {
    return handleBffRequest('/uploads/items', {
      method: 'UPLOAD',
      token,
      filePath: '/tmp/contract-item.jpg'
    }, state)
  }

  async function publishItem(token, upload, options = {}) {
    return handleBffRequest('/items', {
      method: 'POST',
      token,
      idempotencyKey: options.idempotencyKey,
      data: {
        title: options.title || '契约商品',
        price: 128,
        category: 'home',
        condition: 'good',
        description: 'BFF contract item',
        images: [upload],
        tradeScope: {
          type: 'community',
          label: '同社区',
          radiusMeters: 1200
        },
        location: options.location || sellerLocation()
      }
    }, state)
  }

  async function createTrade(token, itemId) {
    return handleBffRequest('/trades', {
      method: 'POST',
      token,
      data: {
        itemId,
        buyerLocation: {
          ...nearLocation,
          capturedAt: Date.now()
        }
      }
    }, state)
  }
})

function sellerLocation(overrides = {}) {
  return {
    latitude: 31.22945,
    longitude: 121.45494,
    accuracy: 60,
    capturedAt: Date.now(),
    communityId: 'sh-jingan-shimen',
    streetId: 'sh-jingan-nanjingxi',
    ...overrides
  }
}

function withAgreement(data, accepted = false) {
  if (!accepted) {
    return data
  }

  return {
    ...data,
    agreement: {
      version: USER_AGREEMENT_VERSION,
      acceptedAt: Date.now(),
      source: 'contract-test'
    }
  }
}

function assertNoPublicCoordinates(item) {
  assert.equal(item.location.latitude, undefined)
  assert.equal(item.location.longitude, undefined)
  assert.equal(item.location.name, undefined)
  assert.equal(item.location.address, undefined)
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name]
    return
  }

  process.env[name] = value
}
