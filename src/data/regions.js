import { distanceInMeters } from '../utils/geo.js'

const SAMPLE_DESCRIPTION_MAX_DISTANCE_METERS = 8000

export const DEMO_REGIONS = [
  {
    communityId: 'sh-jingan-shimen',
    communityName: '石门二路社区',
    streetId: 'sh-jingan-nanjingxi',
    streetName: '南京西路街道',
    districtName: '静安区',
    cityName: '上海市',
    latitude: 31.22945,
    longitude: 121.45494,
    radiusMeters: 950,
    streetRadiusMeters: 3600
  },
  {
    communityId: 'sh-jingan-jiangning',
    communityName: '江宁里社区',
    streetId: 'sh-jingan-jiangninglu',
    streetName: '江宁路街道',
    districtName: '静安区',
    cityName: '上海市',
    latitude: 31.23648,
    longitude: 121.44373,
    radiusMeters: 1100,
    streetRadiusMeters: 4200
  },
  {
    communityId: 'sh-huangpu-ruijin',
    communityName: '瑞金二路社区',
    streetId: 'sh-huangpu-ruijiner',
    streetName: '瑞金二路街道',
    districtName: '黄浦区',
    cityName: '上海市',
    latitude: 31.21551,
    longitude: 121.46304,
    radiusMeters: 1000,
    streetRadiusMeters: 3900
  }
]

export function resolveRegionFromSamples(location) {
  if (!location) {
    return null
  }

  const ranked = DEMO_REGIONS
    .map((region) => ({
      ...region,
      distanceMeters: distanceInMeters(location, region)
    }))
    .filter((region) => region.distanceMeters !== null)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)

  const community = ranked.find((region) => region.distanceMeters <= region.radiusMeters)

  if (community) {
    return toResolvedRegion(community, 'community')
  }

  const street = ranked.find((region) => region.distanceMeters <= region.streetRadiusMeters)

  if (street) {
    return toResolvedRegion(street, 'street')
  }

  return null
}

export function describeLocationFromSamples(location) {
  if (!location) {
    return {
      displayName: '未确认当前位置',
      displayAddress: ''
    }
  }

  const ranked = DEMO_REGIONS
    .map((region) => ({
      ...region,
      distanceMeters: distanceInMeters(location, region)
    }))
    .filter((region) => region.distanceMeters !== null)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
  const nearest = ranked[0]

  if (!nearest || nearest.distanceMeters > SAMPLE_DESCRIPTION_MAX_DISTANCE_METERS) {
    return describeByRoughCity(location)
  }

  const region = resolveRegionFromSamples(location)

  if (region?.communityName) {
    return {
      displayName: region.communityName,
      displayAddress: `${nearest.cityName}${nearest.districtName}${region.streetName}`
    }
  }

  if (region?.streetName) {
    return {
      displayName: region.streetName,
      displayAddress: `${nearest.cityName}${nearest.districtName}`
    }
  }

  return {
    displayName: `${nearest.streetName}附近`,
    displayAddress: `${nearest.cityName}${nearest.districtName}，靠近${nearest.communityName}`
  }
}

function describeByRoughCity(location) {
  const latitude = Number(location.latitude)
  const longitude = Number(location.longitude)

  if (latitude >= 39.4 && latitude <= 41.1 && longitude >= 115.4 && longitude <= 117.6) {
    return {
      displayName: '北京市当前位置',
      displayAddress: '北京市，已获取当前位置'
    }
  }

  if (latitude >= 30.7 && latitude <= 31.9 && longitude >= 120.8 && longitude <= 122.2) {
    return {
      displayName: '上海市当前位置',
      displayAddress: '上海市，已获取当前位置'
    }
  }

  return {
    displayName: '当前位置已获取',
    displayAddress: '已获取当前位置'
  }
}

function toResolvedRegion(region, precision) {
  return {
    communityId: precision === 'community' ? region.communityId : '',
    communityName: precision === 'community' ? region.communityName : '',
    streetId: region.streetId,
    streetName: region.streetName,
    precision,
    distanceMeters: region.distanceMeters
  }
}
