import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createBffState,
  handleBffRequest,
  ITEM_STATUS,
  TRADE_STATUS
} from '../../src/bff/handler.js'
import { USER_AGREEMENT_VERSION } from '../../src/config/app.js'
import { DEMO_REGIONS } from '../../src/data/regions.js'
import {
  assertSnapshotRowLimit,
  countSerializedRows,
  deserializeRowsToState,
  serializeStateToRows
} from '../../backend/src/postgres-state-store.mjs'

describe('PostgreSQL normalized persistence main flow contract', () => {
  it('preserves login, location display, publish, sale, review, and idempotency through row round trips', async () => {
    const region = DEMO_REGIONS[0]
    const capturedAt = Date.now()
    let state = createBffState([])

    const seller = await login(state, 'persistence-seller-code', '持久化卖家', capturedAt)
    const upload = await uploadImage(state, seller.token)
    const publishPayload = createPublishPayload(upload, region, capturedAt)
    const publishRequest = {
      method: 'POST',
      token: seller.token,
      idempotencyKey: 'persistence_publish_item_key',
      data: publishPayload
    }
    const item = await handleBffRequest('/items', publishRequest, state)

    assert.equal(item.status, ITEM_STATUS.ONLINE)
    assertNoPublicCoordinates(item)
    assert.equal(item.seller.contactCode, undefined)

    state = roundTripState(state)

    const replayedItem = await handleBffRequest('/items', publishRequest, state)
    assert.equal(replayedItem.id, item.id)
    assert.equal(state.items.filter((candidate) => candidate.title === publishPayload.title).length, 1)

    const listed = await handleBffRequest('/items', {
      method: 'GET',
      data: preciseLocation(region, capturedAt + 1000)
    }, state)
    const listedItem = listed.items.find((candidate) => candidate.id === item.id)
    assert.ok(listedItem, 'published item should remain visible after PostgreSQL row round trip')
    assert.equal(listedItem.location.communityId, region.communityId)
    assert.equal(listedItem.location.streetId, region.streetId)
    assertNoPublicCoordinates(listedItem)
    assert.equal(listedItem.seller.contactCode, undefined)

    const buyer = await login(state, 'persistence-buyer-code', '持久化买家', capturedAt + 2000)
    const tradePayload = {
      itemId: item.id,
      buyerLocation: preciseLocation(region, capturedAt + 3000)
    }
    const tradeRequest = {
      method: 'POST',
      token: buyer.token,
      idempotencyKey: 'persistence_create_trade_key',
      data: tradePayload
    }
    const trade = await handleBffRequest('/trades', tradeRequest, state)

    assert.equal(trade.status, TRADE_STATUS.PENDING_SELLER_CONFIRM)
    assert.equal(trade.contactCode, '')
    assert.equal(trade.locationAudit.regionStatus, 'match')

    state = roundTripState(state)

    const replayedTrade = await handleBffRequest('/trades', tradeRequest, state)
    assert.equal(replayedTrade.id, trade.id)
    assert.equal(state.trades.filter((candidate) => candidate.itemId === item.id).length, 1)

    const confirmRequest = {
      method: 'PATCH',
      token: seller.token,
      idempotencyKey: 'persistence_confirm_trade_key',
      data: {
        status: TRADE_STATUS.PENDING_MEETUP
      }
    }
    const confirmed = await handleBffRequest(`/trades/${trade.id}/status`, confirmRequest, state)

    assert.equal(confirmed.status, TRADE_STATUS.PENDING_MEETUP)
    assert.match(confirmed.contactCode, /^GC-[A-F0-9]{6}-[A-Z0-9]{4}$/)
    assert.ok(Number(confirmed.contactCodeExpiresAt) > Date.now())

    state = roundTripState(state)

    const replayedConfirmed = await handleBffRequest(`/trades/${trade.id}/status`, confirmRequest, state)
    assert.equal(replayedConfirmed.id, trade.id)
    assert.equal(replayedConfirmed.contactCode, confirmed.contactCode)
    assert.equal(
      state.trades.find((candidate) => candidate.id === trade.id).timeline
        .filter((event) => event.status === TRADE_STATUS.PENDING_MEETUP).length,
      1
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

    const reviewRequest = {
      method: 'POST',
      token: buyer.token,
      idempotencyKey: 'persistence_review_trade_key',
      data: {
        rating: 5,
        content: '持久化主链路交易顺利',
        tags: ['准时', '物品一致']
      }
    }
    const review = await handleBffRequest(`/trades/${trade.id}/review`, reviewRequest, state)

    state = roundTripState(state)

    const replayedReview = await handleBffRequest(`/trades/${trade.id}/review`, reviewRequest, state)
    assert.equal(replayedReview.id, review.id)
    assert.equal(state.reviews.filter((candidate) => candidate.tradeId === trade.id).length, 1)

    const soldDetail = await handleBffRequest(`/items/${item.id}`, {
      method: 'GET',
      data: preciseLocation(region, capturedAt + 4000)
    }, state)
    assert.equal(soldDetail.status, ITEM_STATUS.SOLD)
    assertNoPublicCoordinates(soldDetail)
    assert.equal(soldDetail.seller.contactCode, undefined)

    const finalList = await handleBffRequest('/items', {
      method: 'GET',
      data: preciseLocation(region, capturedAt + 5000)
    }, state)
    assert.equal(finalList.items.some((candidate) => candidate.id === item.id), false)

    const buyerTrades = await handleBffRequest('/trades', {
      method: 'GET',
      token: buyer.token
    }, state)
    const buyerTrade = buyerTrades.trades.find((candidate) => candidate.id === trade.id)
    assert.equal(buyerTrade.status, TRADE_STATUS.COMPLETED)
    assert.equal(buyerTrade.contactCode, '')
    assert.equal(buyerTrade.contactCodeExpiresAt, null)

    await assert.rejects(
      () => handleBffRequest('/trades', {
        method: 'POST',
        token: buyer.token,
        data: {
          itemId: item.id,
          buyerLocation: preciseLocation(region, capturedAt + 6000)
        }
      }, state),
      /物品已完成交易/
    )
  })
})

async function login(state, code, nickname, acceptedAt) {
  return handleBffRequest('/auth/login', {
    method: 'POST',
    data: {
      provider: 'weixin',
      code,
      userInfo: {
        nickname,
        avatarUrl: ''
      },
      agreement: {
        version: USER_AGREEMENT_VERSION,
        acceptedAt,
        source: 'persistence-contract-test'
      }
    }
  }, state)
}

async function uploadImage(state, token) {
  return handleBffRequest('/uploads/items', {
    method: 'UPLOAD',
    token,
    data: {
      file: {
        id: 'persistence-uploaded-image',
        url: 'https://cdn.example.com/items/persistence.jpg',
        storageKey: 'items/persistence.jpg',
        size: 2048,
        mimeType: 'image/jpeg',
        originalName: 'persistence.jpg',
        checksum: 'checksum-persistence',
        status: 'uploaded',
        traceId: 'trace-persistence-image'
      }
    }
  }, state)
}

function createPublishPayload(upload, region, capturedAt) {
  return {
    title: '持久化主链路商品',
    price: 128,
    category: 'home',
    condition: 'good',
    description: '验证 PostgreSQL 规范化持久化后的登录定位发布售卖主链路',
    images: [upload],
    tradeScope: {
      type: 'community',
      label: '同社区',
      radiusMeters: region.radiusMeters
    },
    location: preciseLocation(region, capturedAt)
  }
}

function preciseLocation(region, capturedAt) {
  return {
    latitude: region.latitude,
    longitude: region.longitude,
    accuracy: 25,
    capturedAt,
    serverRegion: {
      communityId: region.communityId,
      communityName: region.communityName,
      streetId: region.streetId,
      streetName: region.streetName,
      precision: 'community',
      distanceMeters: 0
    },
    scopeType: 'community',
    radiusMeters: region.radiusMeters
  }
}

function roundTripState(state) {
  const rows = serializeStateToRows(state, [])
  const rowCount = countSerializedRows(rows)

  assert.ok(rowCount > 0, 'PostgreSQL normalized rows should include main-flow state')
  assert.doesNotThrow(() => assertSnapshotRowLimit(rows, rowCount))
  assert.equal(rows.sessions.every((session) => !session.token && /^[a-f0-9]{64}$/.test(session.tokenHash)), true)

  const restored = deserializeRowsToState(rows, [])
  const restoredRows = serializeStateToRows(restored, [])

  assert.equal(countSerializedRows(restoredRows), rowCount)

  return restored
}

function assertNoPublicCoordinates(item) {
  assert.equal(item.location.latitude, undefined)
  assert.equal(item.location.longitude, undefined)
  assert.equal(item.location.name, undefined)
  assert.equal(item.location.address, undefined)
}
