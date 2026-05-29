import { resolveRegionFromSamples } from '../../src/data/regions.js'

const PROTECTED_ENVIRONMENTS = new Set(['pre', 'prod'])
const TENCENT_GEOCODER_URL = 'https://apis.map.qq.com/ws/geocoder/v1/'

export function createRegionResolver(options = {}) {
  const environment = options.environment || process.env.GOODS_COMM_ENV || 'dev'
  const provider = normalizeMapProvider(options.mapProvider || process.env.GOODS_COMM_MAP_PROVIDER || defaultMapProvider(environment))
  const allowSample = options.allowSampleRegion || process.env.GOODS_COMM_ALLOW_SAMPLE_REGION_IN_PROTECTED_ENV === 'true'

  if (PROTECTED_ENVIRONMENTS.has(environment) && provider === 'mock' && !allowSample) {
    throw new Error(`${environment} 环境不能使用样例区域数据，请配置 GOODS_COMM_MAP_PROVIDER=tencent`)
  }

  return {
    provider,
    async resolveRegion(location = {}) {
      if (provider === 'mock') {
        const region = resolveRegionFromSamples(location)

        if (!region) {
          throw new Error('未能解析当前位置所属社区或街道')
        }

        return region
      }

      return resolveTencentRegion(location, createTencentMapConfig(options))
    }
  }
}

export function normalizeMapProvider(value = '') {
  const normalized = String(value || '').trim().toLowerCase()

  if (['mock', 'tencent'].includes(normalized)) {
    return normalized
  }

  throw new Error(`GOODS_COMM_MAP_PROVIDER 只能是 mock/tencent，当前为 ${value || '空'}`)
}

async function resolveTencentRegion(location = {}, config) {
  assertTencentConfigured(config)

  const latitude = Number(location.latitude)
  const longitude = Number(location.longitude)

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('无效定位坐标')
  }

  const url = new URL(config.endpoint)
  url.searchParams.set('location', `${latitude},${longitude}`)
  url.searchParams.set('key', config.key)
  url.searchParams.set('get_poi', '0')

  const response = await config.fetcher(url, {
    method: 'GET'
  })
  const body = await parseJsonResponse(response)

  if (!response.ok || Number(body.status) !== 0) {
    throw new Error(`腾讯地图逆地理编码失败：${body.message || body.status || response.status}`)
  }

  const component = body.result?.address_component || {}
  const adInfo = body.result?.ad_info || {}
  const streetName = component.street || component.town || adInfo.name || component.district || ''
  const streetCode = component.street_number || adInfo.adcode || component.adcode || ''
  const gridRegion = resolveRegionFromConfiguredGrid({
    latitude,
    longitude,
    streetName,
    adcode: adInfo.adcode || component.adcode || '',
    regionDataset: config.regionDataset
  })

  if (gridRegion) {
    return gridRegion
  }

  if (!streetName && !(adInfo.adcode || component.district)) {
    throw new Error('未能解析当前位置所属社区或街道')
  }

  return {
    communityId: '',
    communityName: '',
    streetId: normalizeRegionId(`tencent-${adInfo.adcode || streetCode || streetName}`),
    streetName: streetName || component.district || adInfo.name || '未知街道',
    precision: 'street',
    distanceMeters: null,
    source: 'tencent_geocoder',
    adcode: adInfo.adcode || component.adcode || ''
  }
}

function resolveRegionFromConfiguredGrid(context) {
  const dataset = parseRegionDataset(context.regionDataset)

  if (!dataset.length) {
    return null
  }

  const matched = dataset.find((region) => {
    if (region.adcode && context.adcode && String(region.adcode) === String(context.adcode)) {
      return true
    }

    return region.streetName && context.streetName && String(region.streetName) === String(context.streetName)
  })

  if (!matched) {
    return null
  }

  return {
    communityId: matched.communityId || '',
    communityName: matched.communityName || '',
    streetId: matched.streetId || normalizeRegionId(matched.streetName || matched.adcode),
    streetName: matched.streetName || context.streetName || '',
    precision: matched.communityId ? 'community' : 'street',
    distanceMeters: null,
    source: 'configured_grid',
    adcode: matched.adcode || context.adcode || ''
  }
}

function parseRegionDataset(value = '') {
  const raw = String(value || '').trim()

  if (!raw || !raw.startsWith('[')) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    return []
  }
}

function createTencentMapConfig(options = {}) {
  return {
    key: options.tencentMapKey || process.env.GOODS_COMM_TENCENT_MAP_KEY,
    endpoint: options.tencentMapEndpoint || process.env.GOODS_COMM_TENCENT_MAP_GEOCODER_URL || TENCENT_GEOCODER_URL,
    regionDataset: options.regionDataset || process.env.GOODS_COMM_MAP_REGION_DATASET || '',
    fetcher: options.fetcher || globalThis.fetch
  }
}

function assertTencentConfigured(config) {
  if (!config.fetcher) {
    throw new Error('地图服务配置未完成：当前运行时缺少 fetch')
  }

  if (!config.key || /REPLACE_WITH|placeholder|example\./i.test(String(config.key))) {
    throw new Error('地图服务配置未完成：腾讯地图 Key')
  }
}

async function parseJsonResponse(response) {
  const text = await response.text()

  try {
    return text ? JSON.parse(text) : {}
  } catch (error) {
    throw new Error('地图服务响应不是有效 JSON')
  }
}

function normalizeRegionId(value = '') {
  return String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown'
}

function defaultMapProvider(environment) {
  return PROTECTED_ENVIRONMENTS.has(environment) ? 'tencent' : 'mock'
}
