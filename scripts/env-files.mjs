import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const VALID_ENVIRONMENTS = ['dev', 'test', 'pre', 'prod']

export function normalizeEnvironmentName(value = '') {
  const normalized = String(value || '').trim().toLowerCase()

  if (VALID_ENVIRONMENTS.includes(normalized)) {
    return normalized
  }

  throw new Error(`Environment must be one of ${VALID_ENVIRONMENTS.join('/')}, got ${value || 'empty'}`)
}

export function envFilePath(environment) {
  return resolve(process.cwd(), `.env.${normalizeEnvironmentName(environment)}`)
}

export function envLocalFilePath(environment) {
  return resolve(process.cwd(), `.env.${normalizeEnvironmentName(environment)}.local`)
}

export function smokeEnvLocalFilePath(environment) {
  return resolve(process.cwd(), `.env.smoke.${normalizeEnvironmentName(environment)}.local`)
}

export async function readEnvironmentFile(environment) {
  const filePath = envFilePath(environment)
  const raw = await readFile(filePath, 'utf8')
  const values = parseEnvFile(raw)

  try {
    const localRaw = await readFile(envLocalFilePath(environment), 'utf8')
    return {
      ...values,
      ...parseEnvFile(localRaw)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }

  return values
}

export async function readSmokeEnvironmentFile(environment) {
  try {
    const raw = await readFile(smokeEnvLocalFilePath(environment), 'utf8')
    return parseEnvFile(raw)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }

  return {}
}

export async function loadEnvironmentFile(environment, options = {}) {
  const values = await readEnvironmentFile(environment)

  for (const [key, value] of Object.entries(values)) {
    if (options.override || process.env[key] === undefined) {
      process.env[key] = value
    }
  }

  return values
}

export async function loadSmokeEnvironmentFile(environment, options = {}) {
  const values = await readSmokeEnvironmentFile(environment)

  for (const [key, value] of Object.entries(values)) {
    if (options.override || process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value
    }
  }

  return values
}

export function parseEnvFile(raw = '') {
  const values = {}

  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separatorIndex = trimmed.indexOf('=')

    if (separatorIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^"|"$/g, '')

    values[key] = value
  }

  return values
}

export function containsPlaceholder(value = '') {
  return /REPLACE_WITH|placeholder|example\.|touristappid/i.test(String(value || ''))
}

export function maskConnectionString(value = '') {
  return String(value || '').replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:***@')
}
