import { DEFAULT_TRADE_SCOPES } from '../config/app.js'
import { distanceInMeters, formatDistance } from '../utils/geo.js'

export function getItemTradeScope(item) {
  const scopeType = item?.tradeScope?.type || item?.location?.scopeType || 'community'
  const fallback = DEFAULT_TRADE_SCOPES[scopeType] || DEFAULT_TRADE_SCOPES.community

  return {
    ...fallback,
    ...item?.tradeScope,
    type: scopeType,
    radiusMeters: Number(item?.tradeScope?.radiusMeters || item?.location?.radiusMeters || fallback.radiusMeters)
  }
}

export function verifyTradeEligibility({ item, userLocation, userRegion }) {
  if (!item) {
    return buildResult(false, 'ITEM_NOT_FOUND', '物品不存在或已下架')
  }

  if (!userLocation) {
    return buildResult(false, 'LOCATION_REQUIRED', '需要授权当前位置后才能判断交易资格')
  }

  const itemLocation = item.location

  if (!itemLocation) {
    return buildResult(false, 'ITEM_LOCATION_MISSING', '卖家未设置交易位置')
  }

  const scope = getItemTradeScope(item)
  const distanceMeters = distanceInMeters(userLocation, itemLocation)

  if (distanceMeters === null) {
    return buildResult(false, 'LOCATION_INVALID', '当前位置或交易位置无效')
  }

  const distanceOk = distanceMeters <= scope.radiusMeters
  const regionCheck = checkRegion(scope.type, itemLocation, userRegion)
  const regionOk = regionCheck.status === 'match' || regionCheck.status === 'not_required'
  const eligible = distanceOk && regionOk

  if (eligible) {
    return buildResult(
      true,
      'ELIGIBLE',
      `${scope.label}交易可发起，当前位置距卖家约 ${formatDistance(distanceMeters)}`,
      {
        distanceMeters,
        radiusMeters: scope.radiusMeters,
        scope,
        regionCheck
      }
    )
  }

  if (!distanceOk) {
    return buildResult(
      false,
      'OUT_OF_RANGE',
      `超出${scope.label}交易范围，当前约 ${formatDistance(distanceMeters)}，要求 ${formatDistance(scope.radiusMeters)} 内`,
      {
        distanceMeters,
        radiusMeters: scope.radiusMeters,
        scope,
        regionCheck
      }
    )
  }

  if (regionCheck.status === 'unknown') {
    return buildResult(
      false,
      'REGION_UNKNOWN',
      `未能解析当前位置所属${scope.label}，请重新定位后再试`,
      {
        distanceMeters,
        radiusMeters: scope.radiusMeters,
        scope,
        regionCheck
      }
    )
  }

  return buildResult(
    false,
    'REGION_MISMATCH',
    `当前位置不属于卖家设置的${scope.label}范围`,
    {
      distanceMeters,
      radiusMeters: scope.radiusMeters,
      scope,
      regionCheck
    }
  )
}

function checkRegion(scopeType, itemLocation, userRegion) {
  const requiredKey = scopeType === 'street' ? 'streetId' : 'communityId'
  const requiredId = itemLocation?.[requiredKey]
  const currentId = userRegion?.[requiredKey]

  if (!requiredId) {
    return {
      status: 'not_required',
      requiredKey,
      requiredId,
      currentId
    }
  }

  if (!currentId) {
    return {
      status: 'unknown',
      requiredKey,
      requiredId,
      currentId
    }
  }

  return {
    status: requiredId === currentId ? 'match' : 'mismatch',
    requiredKey,
    requiredId,
    currentId
  }
}

function buildResult(eligible, code, message, extra = {}) {
  return {
    eligible,
    code,
    message,
    ...extra
  }
}
