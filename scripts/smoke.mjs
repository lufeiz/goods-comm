import assert from 'node:assert/strict'
import { verifyTradeEligibility } from '../src/domain/eligibility.js'
import {
  getLocationErrorView,
  getLocationProfile,
  getLocationQualityText,
  isFinalTradeLocationProfile,
  isLocationAccuracyUsable,
  isLocationExpired,
  normalizeLocationError,
  resolveCurrentRegion
} from '../src/services/location.js'
import {
  createTradeIntent,
  canReviewTrade,
  changeTradeStatus,
  DISPUTE_RESOLUTION,
  fetchGoodsList,
  fetchDisputeCases,
  fetchItemReviews,
  fetchMyGoods,
  fetchNotifications,
  fetchTradeIntents,
  getTradeActionConfirmOptions,
  getTradeContactText,
  getGoodsItem,
  isGoodsTradeAvailable,
  ITEM_STATUS,
  deleteUserOwnedData,
  listGoods,
  listTradeIntents,
  markNotificationRead,
  publishGoods,
  submitGoods,
  submitTradeIntent,
  submitTradeReview,
  resolveTradeDispute,
  TRADE_STATUS,
  updateGoodsStatus,
  updateTradeStatus
} from '../src/services/goods.js'
import {
  clearApiTransportForTesting,
  setApiTransportForTesting
} from '../src/services/api.js'
import { uploadItemImages } from '../src/services/media.js'
import { deleteAuthAccount, loginWithPlatformProfile, logoutAuthSession, normalizeAuthSession } from '../src/services/auth.js'
import {
  acceptUserAgreement,
  clearUserAgreementForTesting,
  hasAcceptedUserAgreement,
  requireUserAgreement
} from '../src/services/compliance.js'
import {
  fetchClientEvents,
  fetchNotificationDeliveries,
  fetchOpsModerationQueue,
  fetchOpsReports,
  resolveOpsReport,
  retryNotificationDeliveries,
  reviewOpsItem
} from '../src/services/ops.js'
import { getLocalClientEvents, trackClientEvent } from '../src/services/telemetry.js'
import { submitReport } from '../src/services/reports.js'
import { createBffState, handleBffRequest } from '../src/bff/handler.js'
import { distanceInMeters } from '../src/utils/geo.js'

const storage = new Map()

globalThis.uni = {
  getStorageSync(key) {
    return storage.get(key)
  },
  setStorageSync(key, value) {
    storage.set(key, value)
  },
  removeStorageSync(key) {
    storage.delete(key)
  }
}

clearUserAgreementForTesting()
assert.equal(hasAcceptedUserAgreement(), false)
assert.throws(() => requireUserAgreement(), /用户协议和隐私政策/)
acceptUserAgreement({
  source: 'smoke'
})
assert.equal(hasAcceptedUserAgreement(), true)

function installLocationUni(options = {}) {
  globalThis.uni.getSetting = ({ success }) => {
    success({
      authSetting: {
        'scope.userLocation': options.authStatus
      }
    })
  }
  globalThis.uni.authorize = ({ success, fail }) => {
    if (options.authorizeFail) {
      fail?.({
        errMsg: 'authorize:fail auth deny'
      })
      return
    }

    success?.()
  }
  globalThis.uni.getLocation = ({ success, fail }) => {
    if (options.locationError) {
      fail?.(options.locationError)
      return
    }

    success?.({
      latitude: options.locationResult?.latitude,
      longitude: options.locationResult?.longitude,
      accuracy: options.locationResult?.accuracy,
      name: options.locationResult?.name || '',
      address: options.locationResult?.address || ''
    })
  }
}

function installH5Runtime(options = {}) {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const originalUni = {
    getSetting: globalThis.uni.getSetting,
    authorize: globalThis.uni.authorize,
    getLocation: globalThis.uni.getLocation,
    chooseLocation: globalThis.uni.chooseLocation,
    login: globalThis.uni.login,
    getUserProfile: globalThis.uni.getUserProfile,
    getUserInfo: globalThis.uni.getUserInfo,
    getSystemInfoSync: globalThis.uni.getSystemInfoSync
  }
  const browserStorage = new Map()

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem(key) {
          return browserStorage.get(key) || null
        },
        setItem(key, value) {
          browserStorage.set(key, String(value))
        }
      }
    }
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        getCurrentPosition(success) {
          success({
            coords: {
              latitude: nearUser.latitude,
              longitude: nearUser.longitude,
              accuracy: 35
            }
          })
        }
      }
    }
  })

  globalThis.uni.getSetting = undefined
  globalThis.uni.authorize = undefined
  globalThis.uni.getLocation = options.exposeUnsupportedUniLocation
    ? ({ fail }) => fail?.({ errMsg: 'getLocation:fail translate coordinate system faild, map provider not configured or not supported' })
    : undefined
  globalThis.uni.chooseLocation = undefined
  globalThis.uni.login = options.exposeUnsupportedUniAuth
    ? ({ fail }) => fail?.({ errMsg: 'login:fail provider h5 is not supported by this runtime' })
    : undefined
  globalThis.uni.getUserProfile = options.exposeUnsupportedUniAuth
    ? ({ fail }) => fail?.({ errMsg: 'getUserProfile:fail unsupported in h5 runtime' })
    : undefined
  globalThis.uni.getUserInfo = options.exposeUnsupportedUniAuth
    ? ({ fail }) => fail?.({ errMsg: 'getUserInfo:fail unsupported in h5 runtime' })
    : undefined
  globalThis.uni.getSystemInfoSync = () => ({
    uniPlatform: 'web'
  })

  return () => {
    restoreGlobalProperty('window', windowDescriptor)
    restoreGlobalProperty('navigator', navigatorDescriptor)
    Object.assign(globalThis.uni, originalUni)
  }
}

function restoreGlobalProperty(key, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor)
    return
  }

  delete globalThis[key]
}

const normalizedRemoteSession = normalizeAuthSession({
  provider: 'weixin',
  token: 'remote-token',
  sessionExpiresAt: Date.now() + 60000,
  user: {
    id: 'user-remote',
    platformId: 'server-openid-smoke',
    nickname: '远端用户',
    avatarUrl: ''
  }
}, {
  provider: 'weixin',
  code: 'client-code-should-not-be-cached'
})
assert.equal(normalizedRemoteSession.platformId, 'server-openid-smoke')

const sellerLocation = {
  latitude: 31.22945,
  longitude: 121.45494,
  accuracy: 50,
  capturedAt: Date.now(),
  communityId: 'sh-jingan-shimen',
  communityName: '石门二路社区',
  streetId: 'sh-jingan-nanjingxi',
  streetName: '南京西路街道'
}

const item = {
  id: 'item_test',
  title: '测试物品',
  tradeScope: {
    type: 'community',
    label: '同社区',
    radiusMeters: 1200
  },
  location: sellerLocation
}

const nearUser = {
  latitude: 31.2301,
  longitude: 121.4556,
  accuracy: 60,
  capturedAt: Date.now()
}

const farUser = {
  latitude: 31.264,
  longitude: 121.51,
  accuracy: 60,
  capturedAt: Date.now()
}

const region = {
  communityId: 'sh-jingan-shimen',
  streetId: 'sh-jingan-nanjingxi'
}

assert.equal(Math.round(distanceInMeters(sellerLocation, sellerLocation)), 0)

const allowed = verifyTradeEligibility({
  item,
  userLocation: nearUser,
  userRegion: region
})

assert.equal(allowed.eligible, true)
assert.equal(allowed.code, 'ELIGIBLE')

const deniedByDistance = verifyTradeEligibility({
  item,
  userLocation: farUser,
  userRegion: region
})

assert.equal(deniedByDistance.eligible, false)
assert.equal(deniedByDistance.code, 'OUT_OF_RANGE')

const deniedByRegion = verifyTradeEligibility({
  item,
  userLocation: nearUser,
  userRegion: {
    communityId: 'sh-huangpu-ruijin',
    streetId: 'sh-huangpu-ruijiner'
  }
})

assert.equal(deniedByRegion.eligible, false)
assert.equal(deniedByRegion.code, 'REGION_MISMATCH')

const deniedByUnknownRegion = verifyTradeEligibility({
  item,
  userLocation: nearUser,
  userRegion: null
})

assert.equal(deniedByUnknownRegion.eligible, false)
assert.equal(deniedByUnknownRegion.code, 'REGION_UNKNOWN')

assert.equal(isLocationExpired({ capturedAt: Date.now() - 6 * 60 * 1000 }), true)
assert.equal(isLocationExpired({ capturedAt: Date.now() }), false)
assert.equal(isLocationAccuracyUsable({ accuracy: 300 }), false)
assert.equal(isLocationAccuracyUsable({ accuracy: 80 }), true)
assert.equal(isLocationAccuracyUsable({}), false)
assert.equal(isLocationAccuracyUsable({}, { allowMissingAccuracy: true }), true)
assert.equal(isFinalTradeLocationProfile({
  source: 'gps',
  location: {
    ...nearUser,
    accuracy: 50,
    capturedAt: Date.now()
  },
  region
}), true)
assert.equal(isFinalTradeLocationProfile({
  source: 'chosen',
  location: {
    ...nearUser,
    capturedAt: Date.now()
  },
  region
}), false)
assert.equal(normalizeLocationError({
  errMsg: 'getLocation:fail system permission denied'
}).code, 'LOCATION_SYSTEM_DISABLED')
assert.equal(normalizeLocationError({
  errMsg: 'getLocation:fail timeout'
}).code, 'LOCATION_TIMEOUT')
assert.equal(normalizeLocationError({
  errMsg: 'getLocation:fail network error'
}).code, 'LOCATION_NETWORK_FAILED')
assert.equal(normalizeLocationError({
  errMsg: 'chooseLocation:fail cancel'
}).code, 'LOCATION_CANCELLED')

installLocationUni({
  authStatus: false
})
const deniedLocationProfile = await getLocationProfile()
assert.equal(deniedLocationProfile.error.code, 'LOCATION_DENIED')
assert.equal(getLocationErrorView(deniedLocationProfile.error).canOpenSetting, true)
assert.equal(storage.has('goods.lastLocationProfile'), false)

installLocationUni({
  authStatus: true,
  locationResult: {
    latitude: nearUser.latitude,
    longitude: nearUser.longitude,
    accuracy: 260
  }
})
const lowAccuracyProfile = await getLocationProfile()
assert.equal(lowAccuracyProfile.error.code, 'LOCATION_LOW_ACCURACY')
assert.match(lowAccuracyProfile.error.message, /定位精度约 260m/)

installLocationUni({
  authStatus: true,
  locationResult: {
    latitude: nearUser.latitude,
    longitude: nearUser.longitude,
    accuracy: 60
  }
})
const goodLocationProfile = await getLocationProfile()
assert.equal(goodLocationProfile.error, null)
assert.equal(goodLocationProfile.source, 'gps')
assert.equal(goodLocationProfile.region.communityId, region.communityId)
assert.match(getLocationQualityText(goodLocationProfile, goodLocationProfile.updatedAt), /GPS 实时定位/)
assert.match(getLocationQualityText(goodLocationProfile, goodLocationProfile.updatedAt), /刚刚/)

const restoreH5Runtime = installH5Runtime()
try {
  const h5LocationProfile = await getLocationProfile()
  assert.equal(h5LocationProfile.error, null)
  assert.equal(h5LocationProfile.source, 'gps')
  assert.equal(h5LocationProfile.location.accuracy, 35)
  assert.equal(h5LocationProfile.region.communityId, region.communityId)

  const h5User = await loginWithPlatformProfile()
  assert.equal(h5User.provider, 'h5')
  assert.equal(h5User.nickname, 'H5 用户')
  assert.equal(h5User.token.startsWith('local_token_'), true)
} finally {
  restoreH5Runtime()
  storage.delete('goods.authUser')
}

const restoreH5UnsupportedUniAuthRuntime = installH5Runtime({
  exposeUnsupportedUniAuth: true,
  exposeUnsupportedUniLocation: true
})
try {
  const h5LocationProfile = await getLocationProfile()
  assert.equal(h5LocationProfile.error, null)
  assert.equal(h5LocationProfile.source, 'gps')
  assert.equal(h5LocationProfile.location.accuracy, 35)
  assert.equal(h5LocationProfile.region.communityId, region.communityId)

  const h5User = await loginWithPlatformProfile()
  assert.equal(h5User.provider, 'h5')
  assert.equal(h5User.nickname, 'H5 用户')
  assert.equal(h5User.token.startsWith('local_token_'), true)
} finally {
  restoreH5UnsupportedUniAuthRuntime()
  storage.delete('goods.authUser')
}

const seller = {
  id: 'seller_1',
  nickname: '卖家',
  avatarUrl: '',
  contactCode: 'seller-contact-code'
}
const buyer = {
  id: 'buyer_1',
  nickname: '买家',
  avatarUrl: ''
}
const secondBuyer = {
  id: 'buyer_2',
  nickname: '另一个买家',
  avatarUrl: ''
}

assert.throws(() => publishGoods({
  title: '缺少区域商品',
  price: 20,
  category: 'home',
  condition: 'good',
  description: '缺少社区编码时不能发布',
  images: ['local://missing-region'],
  tradeScope: item.tradeScope,
  location: {
    latitude: sellerLocation.latitude,
    longitude: sellerLocation.longitude,
    accuracy: 50,
    capturedAt: Date.now()
  }
}, seller), /未能确认发布位置所属社区/)

assert.throws(() => publishGoods({
  title: '过期定位商品',
  price: 20,
  category: 'home',
  condition: 'good',
  description: '发布位置必须是新鲜实时定位',
  images: ['local://stale-location'],
  tradeScope: item.tradeScope,
  location: {
    ...sellerLocation,
    capturedAt: Date.now() - 6 * 60 * 1000
  }
}, seller), /当前位置已过期/)

assert.throws(() => publishGoods({
  title: '低精度定位商品',
  price: 20,
  category: 'home',
  condition: 'good',
  description: '发布位置必须有足够精度',
  images: ['local://low-accuracy-location'],
  tradeScope: item.tradeScope,
  location: {
    ...sellerLocation,
    accuracy: 260,
    capturedAt: Date.now()
  }
}, seller), /定位精度约 260m/)

assert.throws(() => publishGoods({
  title: '违禁本地商品',
  price: 20,
  category: 'home',
  condition: 'good',
  description: '本地路径也应拦截违禁内容',
  images: ['local://blocked-content'],
  tradeScope: item.tradeScope,
  location: sellerLocation
}, seller), /商品未通过审核/)
assert.equal(storage.get('goods.moderationEvents')?.length, 1)
assert.equal(Boolean(storage.get('goods.items')?.some((goods) => goods.title === '违禁本地商品')), false)

const published = publishGoods({
  title: '烟测商品',
  price: 88,
  category: 'home',
  condition: 'good',
  description: '用于 smoke 的商品',
  images: ['local://smoke-image'],
  tradeScope: item.tradeScope,
  location: sellerLocation
}, seller)

assert.equal(published.status, ITEM_STATUS.ONLINE)
assert.equal(published.reviewStatus, 'approved_auto')
assert.equal(published.images.length, 1)
assert.equal(isGoodsTradeAvailable(published, seller), false)
assert.equal(isGoodsTradeAvailable(published, buyer), true)
assert.equal(listGoods({}).some((goods) => goods.id === published.id), false)
assert.equal(listGoods({ currentLocation: null }).some((goods) => goods.id === published.id), false)
assert.equal(listGoods({ currentLocation: undefined }).some((goods) => goods.id === published.id), false)
assert.equal(listGoods({ currentLocation: nearUser }).some((goods) => goods.id === published.id), true)
assert.equal(listGoods({ currentLocation: farUser }).some((goods) => goods.id === published.id), false)
assert.throws(() => publishGoods({
  title: '烟测商品',
  price: 91,
  category: 'home',
  condition: 'good',
  description: '同一卖家不能重复发布同名活跃商品',
  images: ['local://smoke-image-duplicate'],
  tradeScope: item.tradeScope,
  location: sellerLocation
}, seller), /已存在同名在售或审核中的商品/)

const removableItem = publishGoods({
  title: '可上下架商品',
  price: 45,
  category: 'home',
  condition: 'good',
  description: '用于上下架 smoke',
  images: ['local://smoke-relist-image'],
  tradeScope: item.tradeScope,
  location: sellerLocation
}, seller)
const removedBySeller = updateGoodsStatus(removableItem.id, ITEM_STATUS.REMOVED, seller)
assert.equal(removedBySeller.status, ITEM_STATUS.REMOVED)
const relistedBySeller = updateGoodsStatus(removableItem.id, ITEM_STATUS.ONLINE, seller)
assert.equal(relistedBySeller.status, ITEM_STATUS.ONLINE)

const smokeEligibility = {
  ...allowed,
  profile: {
    source: 'gps',
    location: {
      ...nearUser,
      accuracy: 60,
      capturedAt: Date.now()
    },
    region
  }
}
const trade = createTradeIntent(published, smokeEligibility, buyer)

assert.equal(trade.status, TRADE_STATUS.PENDING_SELLER_CONFIRM)
assert.equal(trade.contactCode, '')
assert.equal(getTradeContactText(trade), '卖家确认后生成一次性联系码')
const sellerNotifications = await fetchNotifications({
  user: seller
})
assert.equal(sellerNotifications.length, 1)
assert.equal(sellerNotifications[0].type, 'trade_created')
assert.equal(sellerNotifications[0].targetId, trade.id)
const readSellerNotification = await markNotificationRead(sellerNotifications[0].id, seller)
assert.equal(Boolean(readSellerNotification.readAt), true)
assert.equal(getTradeActionConfirmOptions(TRADE_STATUS.PENDING_MEETUP).confirmText, '确认')
assert.equal(getGoodsItem(published.id).status, ITEM_STATUS.RESERVED)
assert.equal(createTradeIntent(published, smokeEligibility, buyer).id, trade.id)
assert.throws(() => createTradeIntent(published, smokeEligibility, secondBuyer), /物品已有交易处理中/)
assert.throws(() => updateGoodsStatus(published.id, ITEM_STATUS.REMOVED, seller), /交易中的商品不能手动下架/)

const confirmed = updateTradeStatus(trade.id, TRADE_STATUS.PENDING_MEETUP, seller)
assert.equal(confirmed.status, TRADE_STATUS.PENDING_MEETUP)
assert.match(confirmed.contactCode, /^GC-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
assert.notEqual(confirmed.contactCode, seller.contactCode)
assert.equal(confirmed.contactCodeExpiresAt > Date.now(), true)
assert.equal(getTradeContactText(confirmed), `一次性联系码：${confirmed.contactCode}`)
assert.equal(getTradeContactText({
  ...confirmed,
  contactCodeExpiresAt: Date.now() - 1
}), '一次性联系码已过期，请取消后重新发起交易')
storage.set('goods.trades', storage.get('goods.trades').map((candidate) =>
  candidate.id === confirmed.id
    ? {
        ...candidate,
        contactCodeExpiresAt: Date.now() - 1
      }
    : candidate
))
const expiredDuplicateTrade = createTradeIntent(published, smokeEligibility, buyer)
assert.equal(expiredDuplicateTrade.id, confirmed.id)
assert.equal(expiredDuplicateTrade.contactCode, '')
assert.equal(expiredDuplicateTrade.contactCodeExpiresAt, null)
assert.equal(getTradeContactText(expiredDuplicateTrade), '一次性联系码已过期，请取消后重新发起交易')
const expiredContactTrade = listTradeIntents({
  user: buyer
}).find((candidate) => candidate.id === confirmed.id)
assert.equal(expiredContactTrade.contactCode, '')
assert.equal(expiredContactTrade.contactCodeExpiresAt, null)
assert.equal(getTradeContactText(expiredContactTrade), '一次性联系码已过期，请取消后重新发起交易')
const buyerNotifications = await fetchNotifications({
  user: buyer
})
assert.equal(buyerNotifications[0].type, 'trade_confirmed')
assert.equal(buyerNotifications[0].targetId, trade.id)
assert.equal(getTradeActionConfirmOptions(TRADE_STATUS.COMPLETED).confirmText, '标记完成')
assert.equal(getTradeActionConfirmOptions('unknown_status'), null)

const completed = updateTradeStatus(trade.id, TRADE_STATUS.COMPLETED, buyer)
assert.equal(completed.status, TRADE_STATUS.COMPLETED)
assert.equal(completed.contactCode, '')
assert.equal(completed.contactCodeExpiresAt, null)
const sellerNotificationsAfterComplete = await fetchNotifications({
  user: seller
})
assert.equal(sellerNotificationsAfterComplete.some((notification) => notification.type === 'trade_completed'), true)
assert.equal(getGoodsItem(published.id).status, ITEM_STATUS.SOLD)
assert.equal(isGoodsTradeAvailable(getGoodsItem(published.id)), false)
assert.equal(listGoods({}).some((goods) => goods.id === published.id), false)
assert.equal(canReviewTrade({
  ...completed,
  reviewedByMe: false
}, buyer), true)
const localReview = await submitTradeReview(trade.id, {
  rating: 5,
  content: '交易顺利',
  tags: ['准时', '沟通顺畅']
}, buyer)
assert.equal(localReview.tradeId, trade.id)
assert.equal(localReview.reviewee.id, seller.id)
assert.equal(localReview.rating, 5)
assert.equal((await fetchItemReviews(published.id))[0].id, localReview.id)
assert.equal(listTradeIntents({ user: buyer }).find((candidate) => candidate.id === trade.id).reviewedByMe, true)
assert.equal(canReviewTrade(listTradeIntents({ user: buyer }).find((candidate) => candidate.id === trade.id), buyer), false)
await assert.rejects(
  () => submitTradeReview(trade.id, {
    rating: 4,
    content: '重复评价'
  }, buyer),
  /不能重复评价/
)
assert.equal((await fetchNotifications({ user: seller })).some((notification) => notification.type === 'trade_reviewed'), true)
assert.throws(() => updateGoodsStatus(published.id, ITEM_STATUS.ONLINE, seller), /已售商品不能重新上架/)
assert.throws(() => updateGoodsStatus(published.id, ITEM_STATUS.REMOVED, seller), /已售商品不能手动下架/)

const cancellableItem = publishGoods({
  title: '可取消商品',
  price: 66,
  category: 'home',
  condition: 'good',
  description: '用于取消交易 smoke',
  images: ['local://smoke-image-2'],
  tradeScope: item.tradeScope,
  location: sellerLocation
}, seller)
const cancellableTrade = createTradeIntent(cancellableItem, smokeEligibility, buyer)
assert.equal(getGoodsItem(cancellableItem.id).status, ITEM_STATUS.RESERVED)
assert.equal(isGoodsTradeAvailable(getGoodsItem(cancellableItem.id)), false)
const cancelled = updateTradeStatus(cancellableTrade.id, TRADE_STATUS.CANCELLED, buyer)
assert.equal(cancelled.status, TRADE_STATUS.CANCELLED)
assert.equal(getGoodsItem(cancellableItem.id).status, ITEM_STATUS.ONLINE)
assert.equal(isGoodsTradeAvailable(getGoodsItem(cancellableItem.id)), true)

const disputedItem = publishGoods({
  title: '争议商品',
  price: 77,
  category: 'home',
  condition: 'good',
  description: '用于争议交易 smoke',
  images: ['local://smoke-image-3'],
  tradeScope: item.tradeScope,
  location: sellerLocation
}, seller)
const disputedTrade = createTradeIntent(disputedItem, smokeEligibility, buyer)
updateTradeStatus(disputedTrade.id, TRADE_STATUS.PENDING_MEETUP, seller)
const disputed = updateTradeStatus(disputedTrade.id, TRADE_STATUS.DISPUTED, buyer)
assert.equal(disputed.status, TRADE_STATUS.DISPUTED)
assert.equal(disputed.disputeCase.status, 'open')
assert.equal(getGoodsItem(disputedItem.id).status, ITEM_STATUS.RESERVED)
const buyerDisputes = await fetchDisputeCases({
  user: buyer
})
const buyerDispute = buyerDisputes.find((candidate) => candidate.tradeId === disputedTrade.id)
assert.equal(buyerDispute.status, 'open')
const resolvedDispute = await resolveTradeDispute(buyerDispute.id, {
  resolution: DISPUTE_RESOLUTION.RELEASE_ITEM,
  note: '本地客服 smoke：释放商品'
}, {
  id: 'support-smoke'
})
assert.equal(resolvedDispute.status, 'resolved')
assert.equal(resolvedDispute.resolution, DISPUTE_RESOLUTION.RELEASE_ITEM)
const releasedDisputeTrade = listTradeIntents({ user: buyer }).find((candidate) => candidate.id === disputedTrade.id)
assert.equal(releasedDisputeTrade.status, TRADE_STATUS.CANCELLED)
assert.equal(releasedDisputeTrade.disputeCase.status, 'resolved')
assert.equal(getGoodsItem(disputedItem.id).status, ITEM_STATUS.ONLINE)
assert.equal((await fetchNotifications({ user: buyer })).some((notification) => notification.type === 'trade_dispute_resolved'), true)

const reportableItem = publishGoods({
  title: '本地举报商品',
  price: 55,
  category: 'home',
  condition: 'good',
  description: '用于本地举报 smoke',
  images: ['local://smoke-image-4'],
  tradeScope: item.tradeScope,
  location: sellerLocation
}, seller)
await assert.rejects(
  () => submitReport({
    targetType: 'item',
    targetId: reportableItem.id,
    reason: 'other',
    description: '不能举报自己'
  }, seller),
  /不能举报自己发布的物品/
)
await assert.rejects(
  () => submitReport({
    targetType: 'item',
    targetId: reportableItem.id,
    reason: 'bogus',
    description: '无效举报原因'
  }, buyer),
  /举报原因无效/
)
const localReport = await submitReport({
  targetType: 'item',
  targetId: reportableItem.id,
  reason: 'prohibited',
  description: '疑似违禁'
}, buyer)
assert.equal(localReport.status, 'pending_review')
const duplicateLocalReport = await submitReport({
  targetType: 'item',
  targetId: reportableItem.id,
  reason: 'prohibited',
  description: '重复本地举报应幂等'
}, buyer)
assert.equal(duplicateLocalReport.id, localReport.id)
assert.equal(getGoodsItem(reportableItem.id), null)
assert.throws(() => updateGoodsStatus(reportableItem.id, ITEM_STATUS.ONLINE, seller), /违规或注销下架的商品不能重新上架/)

const reportLockedItem = publishGoods({
  title: '举报锁定商品',
  price: 71,
  category: 'home',
  condition: 'good',
  description: '举报后进行中交易应转争议',
  images: ['local://smoke-image-report-trade'],
  tradeScope: item.tradeScope,
  location: sellerLocation
}, seller)
const reportLockedTrade = createTradeIntent(reportLockedItem, smokeEligibility, buyer)
await submitReport({
  targetType: 'item',
  targetId: reportLockedItem.id,
  reason: 'fraud',
  description: '高风险举报应冻结交易'
}, secondBuyer)
const disputedByReport = listTradeIntents({ user: buyer }).find((candidate) => candidate.id === reportLockedTrade.id)
assert.equal(disputedByReport.status, TRADE_STATUS.DISPUTED)
assert.equal(getGoodsItem(reportLockedItem.id), null)

const deleteBuyerItem = publishGoods({
  title: '买家注销释放商品',
  price: 61,
  category: 'home',
  condition: 'good',
  description: '用于本地账号注销 smoke',
  images: ['local://smoke-image-5'],
  tradeScope: item.tradeScope,
  location: sellerLocation
}, seller)
const deleteBuyerTrade = createTradeIntent(deleteBuyerItem, smokeEligibility, secondBuyer)
assert.equal(getGoodsItem(deleteBuyerItem.id).status, ITEM_STATUS.RESERVED)
const localDeletion = await deleteAuthAccount(secondBuyer)
assert.equal(localDeletion.ok, true)
const localDeletionSummary = deleteUserOwnedData(secondBuyer)
assert.equal(localDeletionSummary.cancelledTrades, 1)
assert.equal(getGoodsItem(deleteBuyerItem.id).status, ITEM_STATUS.ONLINE)

const bffState = createBffState([])
const remoteCalls = []

const sellerSession = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: {
    provider: 'weixin',
    code: 'seller-code',
    userInfo: seller
  }
}, bffState)
const buyerSession = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: {
    provider: 'weixin',
    code: 'buyer-code',
    userInfo: buyer
  }
}, bffState)
const logoutSession = await handleBffRequest('/auth/login', {
  method: 'POST',
  data: {
    provider: 'weixin',
    code: 'logout-code',
    userInfo: {
      nickname: '远端退出用户',
      avatarUrl: ''
    }
  }
}, bffState)
const remoteSeller = {
  ...sellerSession.user,
  token: sellerSession.token
}
const remoteBuyer = {
  ...buyerSession.user,
  token: buyerSession.token
}
const remoteLogoutUser = {
  ...logoutSession.user,
  token: logoutSession.token
}

setApiTransportForTesting((path, options = {}) => {
  remoteCalls.push({
    path,
    method: options.method || 'GET',
    header: options.header || {},
    idempotencyKey: options.idempotencyKey || ''
  })

  return handleBffRequest(path, options, bffState)
})

const remoteRegion = await resolveCurrentRegion(sellerLocation)
assert.equal(remoteRegion.communityId, sellerLocation.communityId)
assert.equal(remoteCalls.some((call) => call.path === '/lbs/resolve-region' && call.method === 'POST'), true)

const remoteLogout = await logoutAuthSession(remoteLogoutUser)
assert.equal(remoteLogout.ok, true)
await assert.rejects(
  () => fetchMyGoods(remoteLogoutUser),
  /登录态无效/
)
assert.equal(remoteCalls.some((call) => call.path === '/auth/logout' && call.method === 'POST'), true)

const uploadedImages = await uploadItemImages(['local://remote-image.jpg'], remoteSeller)
assert.equal(uploadedImages[0].status, 'uploaded')

const remoteItem = await submitGoods({
  title: '远端商品',
  price: 99,
  category: 'home',
  condition: 'good',
  description: '远端发布验证',
  images: uploadedImages,
  tradeScope: item.tradeScope,
  location: {
    ...sellerLocation,
    communityId: 'client-spoofed-community',
    streetId: 'client-spoofed-street'
  }
}, remoteSeller)
assert.equal(remoteItem.seller.id, remoteSeller.id)
assert.equal(remoteItem.seller.contactCode, '')
assert.equal(remoteItem.location.communityId, sellerLocation.communityId)
assert.equal(remoteItem.location.streetId, sellerLocation.streetId)
assertNoPublicCoordinates(remoteItem)

const remoteGoodsWithoutLocation = await fetchGoodsList({})
assert.equal(remoteGoodsWithoutLocation.length, 0)
assert.equal(remoteCalls.some((call) => call.path === '/items' && call.method === 'GET'), false)

const remoteGoods = await fetchGoodsList({
  currentLocation: nearUser
})
assert.equal(remoteGoods.length, 1)
assert.equal(remoteGoods[0].id, remoteItem.id)
assertNoPublicCoordinates(remoteGoods[0])
assert.equal(Number.isFinite(Number(remoteGoods[0].distanceMeters)), true)

const remoteMine = await fetchMyGoods(remoteSeller)
assert.equal(remoteMine[0].seller.id, remoteSeller.id)

const remoteTrade = await submitTradeIntent(remoteItem, smokeEligibility, remoteBuyer)
assert.equal(remoteTrade.buyer.id, remoteBuyer.id)
assert.equal(remoteTrade.contactCode, '')
const remoteSellerNotifications = await fetchNotifications({
  user: remoteSeller
})
assert.equal(remoteSellerNotifications[0].type, 'trade_created')
assert.equal(remoteSellerNotifications[0].targetId, remoteTrade.id)
const remoteReadNotification = await markNotificationRead(remoteSellerNotifications[0].id, remoteSeller)
assert.equal(Boolean(remoteReadNotification.readAt), true)

const remoteTrades = await fetchTradeIntents({
  user: remoteBuyer
})
assert.equal(remoteTrades.length, 1)

const remoteConfirmed = await changeTradeStatus(remoteTrade.id, TRADE_STATUS.PENDING_MEETUP, remoteSeller)
assert.equal(remoteConfirmed.status, TRADE_STATUS.PENDING_MEETUP)
assert.match(remoteConfirmed.contactCode, /^GC-[A-Z0-9]{4,6}-[A-Z0-9]{4}$/)
assert.notEqual(remoteConfirmed.contactCode, remoteSeller.contactCode)
assert.equal(remoteConfirmed.contactCodeExpiresAt > Date.now(), true)
const remoteBuyerNotifications = await fetchNotifications({
  user: remoteBuyer
})
assert.equal(remoteBuyerNotifications[0].type, 'trade_confirmed')
assert.equal(remoteBuyerNotifications[0].targetId, remoteTrade.id)
const remoteCompleted = await changeTradeStatus(remoteTrade.id, TRADE_STATUS.COMPLETED, remoteBuyer)
assert.equal(remoteCompleted.status, TRADE_STATUS.COMPLETED)
const remoteReview = await submitTradeReview(remoteTrade.id, {
  rating: 4,
  content: '远端交易顺利',
  tags: ['物品一致']
}, remoteBuyer)
assert.equal(remoteReview.tradeId, remoteTrade.id)
assert.equal(remoteReview.reviewee.id, remoteSeller.id)
assert.equal((await fetchItemReviews(remoteItem.id))[0].id, remoteReview.id)
await assert.rejects(
  () => submitTradeReview(remoteTrade.id, {
    rating: 4,
    content: '远端重复评价'
  }, remoteBuyer),
  /不能重复评价/
)
const remoteSellerNotificationsAfterReview = await fetchNotifications({
  user: remoteSeller
})
assert.equal(remoteSellerNotificationsAfterReview.some((notification) => notification.type === 'trade_reviewed'), true)
await assert.rejects(
  () => submitReport({
    targetType: 'item',
    targetId: remoteItem.id,
    reason: 'other',
    description: '远端不能举报自己'
  }, remoteSeller),
  /不能举报自己发布的物品/
)
await assert.rejects(
  () => submitReport({
    targetType: 'item',
    targetId: remoteItem.id,
    reason: 'bogus',
    description: '远端无效举报原因'
  }, remoteBuyer),
  /举报原因无效/
)
const remoteReport = await submitReport({
  targetType: 'item',
  targetId: remoteItem.id,
  reason: 'fraud',
  description: '远端举报验证'
}, remoteBuyer)
assert.equal(remoteReport.status, 'pending_review')
const duplicateRemoteReport = await submitReport({
  targetType: 'item',
  targetId: remoteItem.id,
  reason: 'fraud',
  description: '重复远端举报应幂等'
}, remoteBuyer)
assert.equal(duplicateRemoteReport.id, remoteReport.id)
const opsQueue = await fetchOpsModerationQueue('ops-secret')
assert.equal(opsQueue.reports.some((candidate) => candidate.id === remoteReport.id), true)
const resolvedRemoteReport = await resolveOpsReport(remoteReport.id, {
  resolution: 'dismiss_report',
  actorId: 'ops-smoke',
  note: '运营 smoke 驳回举报'
}, 'ops-secret')
assert.equal(resolvedRemoteReport.status, 'rejected')
assert.equal(resolvedRemoteReport.resolution, 'dismiss_report')
const rejectedReports = await fetchOpsReports('ops-secret', {
  status: 'rejected'
})
assert.equal(rejectedReports.reports.some((candidate) => candidate.id === remoteReport.id), true)
const trackedClientEvent = await trackClientEvent('trade_create_failed', {
  level: 'error',
  code: 'LOCATION_LOW_ACCURACY',
  message: 'smoke event',
  user: remoteBuyer,
  context: {
    itemId: remoteItem.id,
    latitude: 31.2,
    safeField: 'kept'
  }
})
assert.equal(trackedClientEvent.accepted, 1)
assert.equal(getLocalClientEvents()[0].type, 'trade_create_failed')
const clientEvents = await fetchClientEvents('ops-secret', {
  level: 'error'
})
assert.equal(clientEvents.events.some((event) =>
  event.type === 'trade_create_failed' &&
  event.userId === remoteBuyer.id &&
  event.context.safeField === 'kept' &&
  event.context.latitude === undefined
), true)
assert.equal(remoteCalls.some((call) => call.path === '/uploads/items' && call.method === 'UPLOAD'), true)
assert.equal(remoteCalls.some((call) => call.path === '/items' && call.method === 'POST'), true)
assert.equal(remoteCalls.some((call) => call.path === '/trades' && call.method === 'POST'), true)
assert.equal(remoteCalls.some((call) => call.path === '/reports' && call.method === 'POST'), true)
assert.equal(remoteCalls.some((call) => call.path === '/ops/moderation-queue' && call.header['x-moderation-secret'] === 'ops-secret'), true)
assert.equal(remoteCalls.some((call) =>
  call.path === `/ops/reports/${remoteReport.id}/resolve` &&
  call.method === 'POST' &&
  call.header['x-moderation-secret'] === 'ops-secret' &&
  call.idempotencyKey
), true)
assert.equal(remoteCalls.some((call) => call.path === '/telemetry/client-events' && call.method === 'POST'), true)
assert.equal(remoteCalls.some((call) => call.path === '/ops/client-events' && call.header['x-moderation-secret'] === 'ops-secret'), true)
clearApiTransportForTesting()

const opsDeliveryCalls = []
setApiTransportForTesting((path, options = {}) => {
  opsDeliveryCalls.push({
    path,
    method: options.method || 'GET',
    header: options.header || {},
    data: options.data || {},
    idempotencyKey: options.idempotencyKey || ''
  })

  if (path === '/moderation/items/item-smoke/review') {
    return {
      id: 'item-smoke',
      status: 'online'
    }
  }

  if (path === '/ops/notification-deliveries') {
    return {
      deliveries: [
        {
          id: 'delivery-smoke',
          status: 'failed'
        }
      ]
    }
  }

  if (path === '/ops/notification-deliveries/retry') {
    return {
      retried: 1,
      deliveries: [
        {
          id: 'delivery-smoke',
          status: 'sent'
        }
      ]
    }
  }

  throw new Error(`unexpected ops delivery path: ${path}`)
})
const reviewedOpsItem = await reviewOpsItem('item-smoke', {
  status: 'approved',
  actorId: 'ops-smoke'
}, 'ops-secret')
assert.equal(reviewedOpsItem.id, 'item-smoke')
const failedDeliveries = await fetchNotificationDeliveries('ops-secret', {
  status: 'failed'
})
assert.equal(failedDeliveries.deliveries[0].id, 'delivery-smoke')
const retryResult = await retryNotificationDeliveries('ops-secret', {
  ids: ['delivery-smoke'],
  force: true,
  limit: 1
})
assert.equal(retryResult.retried, 1)
assert.equal(opsDeliveryCalls.some((call) =>
  call.path === '/moderation/items/item-smoke/review' &&
  call.method === 'POST' &&
  call.header['x-moderation-secret'] === 'ops-secret' &&
  call.idempotencyKey
), true)
assert.equal(opsDeliveryCalls.some((call) =>
  call.path === '/ops/notification-deliveries' &&
  call.method === 'GET' &&
  call.header['x-moderation-secret'] === 'ops-secret' &&
  call.data.status === 'failed'
), true)
assert.equal(opsDeliveryCalls.some((call) =>
  call.path === '/ops/notification-deliveries/retry' &&
  call.method === 'POST' &&
  call.header['x-moderation-secret'] === 'ops-secret' &&
  call.data.force === true
), true)
clearApiTransportForTesting()

console.log('Smoke checks passed')

function assertNoPublicCoordinates(item) {
  assert.equal(item.location.latitude, undefined)
  assert.equal(item.location.longitude, undefined)
  assert.equal(item.location.name, undefined)
  assert.equal(item.location.address, undefined)
}
