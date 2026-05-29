import assert from 'node:assert/strict'
import { createRegionResolver } from '../backend/src/region-resolver.mjs'

const mock = createRegionResolver({
  environment: 'dev',
  mapProvider: 'mock'
})
const sample = await mock.resolveRegion({
  latitude: 31.22945,
  longitude: 121.45494
})
assert.equal(sample.communityId, 'sh-jingan-shimen')

assert.throws(() => createRegionResolver({
  environment: 'prod',
  mapProvider: 'mock'
}), /prod 环境不能使用样例区域数据/)

const calls = []
const tencent = createRegionResolver({
  environment: 'prod',
  mapProvider: 'tencent',
  tencentMapKey: 'tencent-key',
  regionDataset: JSON.stringify([
    {
      adcode: '310106',
      communityId: 'grid-community',
      communityName: '网格社区',
      streetId: 'grid-street',
      streetName: '南京西路街道'
    }
  ]),
  fetcher: async (url, options) => {
    calls.push({ url: String(url), options })

    return jsonResponse({
      status: 0,
      result: {
        address_component: {
          street: '南京西路街道'
        },
        ad_info: {
          adcode: '310106',
          name: '静安区'
        }
      }
    })
  }
})
const resolved = await tencent.resolveRegion({
  latitude: 31.22945,
  longitude: 121.45494
})
assert.equal(resolved.communityId, 'grid-community')
assert.equal(resolved.streetId, 'grid-street')
assert.equal(resolved.source, 'configured_grid')
assert.match(calls[0].url, /geocoder\/v1/)
assert.match(calls[0].url, /location=31\.22945%2C121\.45494/)
assert.match(calls[0].url, /key=tencent-key/)

const streetOnly = createRegionResolver({
  environment: 'prod',
  mapProvider: 'tencent',
  tencentMapKey: 'tencent-key',
  fetcher: async () => jsonResponse({
    status: 0,
    result: {
      address_component: {
        street: '没有网格的街道'
      },
      ad_info: {
        adcode: '310000',
        name: '上海市'
      }
    }
  })
})
const street = await streetOnly.resolveRegion({
  latitude: 31.2,
  longitude: 121.4
})
assert.equal(street.precision, 'street')
assert.equal(street.communityId, '')
assert.equal(street.streetName, '没有网格的街道')

await assert.rejects(
  () => createRegionResolver({
    environment: 'prod',
    mapProvider: 'tencent',
    tencentMapKey: 'REPLACE_WITH_PROD_TENCENT_MAP_KEY',
    fetcher: async () => jsonResponse({})
  }).resolveRegion({
    latitude: 31.2,
    longitude: 121.4
  }),
  /地图服务配置未完成/
)

console.log('Region resolver smoke checks passed')

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  }
}
