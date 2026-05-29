const EARTH_RADIUS_METERS = 6371008.8

export function normalizeLocation(location) {
  if (!location) {
    return null
  }

  const latitude = Number(location.latitude ?? location.lat)
  const longitude = Number(location.longitude ?? location.lng)

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null
  }

  return {
    latitude,
    longitude
  }
}

export function distanceInMeters(from, to) {
  const start = normalizeLocation(from)
  const end = normalizeLocation(to)

  if (!start || !end) {
    return null
  }

  const startLat = toRadians(start.latitude)
  const endLat = toRadians(end.latitude)
  const deltaLat = toRadians(end.latitude - start.latitude)
  const deltaLng = toRadians(end.longitude - start.longitude)

  const haversine =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(startLat) * Math.cos(endLat) *
      Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2)

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

export function isWithinRadius(from, to, radiusMeters) {
  const distance = distanceInMeters(from, to)
  const radius = Number(radiusMeters)

  return {
    distanceMeters: distance,
    within: distance !== null && Number.isFinite(radius) && distance <= radius
  }
}

export function formatDistance(distanceMeters) {
  const value = Number(distanceMeters)

  if (!Number.isFinite(value)) {
    return '距离未知'
  }

  if (value < 1000) {
    return `${Math.max(1, Math.round(value))}m`
  }

  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}km`
}

function toRadians(degrees) {
  return degrees * Math.PI / 180
}
