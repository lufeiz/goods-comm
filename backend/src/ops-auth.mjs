import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const OPS_SESSION_TTL_MS = 8 * 60 * 60 * 1000
const ALL_OPS_ROLES = ['moderation', 'support', 'notifications', 'telemetry', 'risk']
const OPS_LOGIN_MAX_FAILURES = 5
const OPS_LOGIN_WINDOW_MS = 15 * 60 * 1000
const OPS_LOGIN_LOCK_MS = 15 * 60 * 1000

export function createOpsAuth(options = {}) {
  const environment = options.environment || process.env.GOODS_COMM_ENV || 'dev'
  const moderationSecret = options.moderationSecret || process.env.GOODS_COMM_MODERATION_WEBHOOK_SECRET || ''
  const sessionSecret = options.opsSessionSecret ||
    process.env.GOODS_COMM_OPS_SESSION_SECRET ||
    process.env.GOODS_COMM_SESSION_SECRET ||
    moderationSecret
  const sessionTtlMs = Number(options.opsSessionTtlMs || process.env.GOODS_COMM_OPS_SESSION_TTL_MS || OPS_SESSION_TTL_MS)
  const loginMaxFailures = normalizePositiveInteger(options.opsLoginMaxFailures ?? process.env.GOODS_COMM_OPS_LOGIN_MAX_FAILURES, OPS_LOGIN_MAX_FAILURES)
  const loginWindowMs = normalizePositiveInteger(options.opsLoginWindowMs ?? process.env.GOODS_COMM_OPS_LOGIN_WINDOW_MS, OPS_LOGIN_WINDOW_MS)
  const loginLockMs = normalizePositiveInteger(options.opsLoginLockMs ?? process.env.GOODS_COMM_OPS_LOGIN_LOCK_MS, OPS_LOGIN_LOCK_MS)
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const loginFailures = new Map()
  const accounts = parseOpsAccounts(options.opsAccounts ?? process.env.GOODS_COMM_OPS_ACCOUNTS)

  return {
    mode: accounts.length ? 'accounts' : 'shared-secret',
    login(payload = {}) {
      const accountId = normalizeActorId(payload.accountId || payload.actorId || 'ops-console')
      const password = String(payload.password || payload.secret || '').trim()
      const currentTime = now()
      assertOpsLoginAllowed(loginFailures, accountId, currentTime, {
        loginWindowMs
      })
      let operator

      try {
        operator = accounts.length
          ? authenticateAccount(accounts, accountId, password)
          : authenticateSharedSecret(accountId, password, moderationSecret, environment)
      } catch (error) {
        const lockError = recordOpsLoginFailure(loginFailures, accountId, currentTime, {
          loginMaxFailures,
          loginWindowMs,
          loginLockMs
        })

        if (lockError) {
          throw lockError
        }

        throw error
      }

      loginFailures.delete(accountId)
      const expiresAt = currentTime + normalizeSessionTtl(sessionTtlMs)

      return {
        token: signOpsSession({
          actorId: operator.id,
          roles: operator.roles,
          iat: currentTime,
          exp: expiresAt
        }, sessionSecret),
        expiresAt,
        operator
      }
    },
    authenticateRequest(request, url) {
      const token = getOpsSessionToken(request)

      if (token) {
        return verifyOpsSession(token, sessionSecret)
      }

      const secretActor = authenticateSecretRequest(request, url, moderationSecret, environment)

      return {
        actorId: secretActor.id,
        roles: secretActor.roles,
        source: 'shared-secret'
      }
    },
    check() {
      assertConfiguredSecret(sessionSecret, '运营会话签名密钥', environment)

      if (accounts.length) {
        return {
          ok: true,
          mode: 'accounts',
          accounts: accounts.length,
          loginMaxFailures,
          loginWindowMs,
          loginLockMs
        }
      }

      assertConfiguredSecret(moderationSecret, '运营共享密钥', environment)

      return {
        ok: true,
        mode: 'shared-secret',
        accounts: 0,
        loginMaxFailures,
        loginWindowMs,
        loginLockMs
      }
    }
  }
}

export function parseOpsAccounts(value = '') {
  const raw = typeof value === 'string' ? value.trim() : value

  if (!raw) {
    return []
  }

  if (Array.isArray(raw)) {
    return raw.map(normalizeOpsAccount).filter(Boolean)
  }

  if (String(raw).startsWith('[')) {
    return JSON.parse(raw).map(normalizeOpsAccount).filter(Boolean)
  }

  return String(raw)
    .split(',')
    .map((entry) => {
      const [id, password, roles = 'moderation|support|notifications|telemetry'] = entry.split(':')

      return normalizeOpsAccount({
        id,
        password,
        roles: roles.split('|')
      })
    })
    .filter(Boolean)
}

function authenticateAccount(accounts, accountId, password) {
  const account = accounts.find((candidate) => candidate.id === accountId)

  if (!account || !password) {
    throw new Error('运营账号或密码无效')
  }

  const passwordOk = account.passwordHash
    ? safeEqual(sha256(password), account.passwordHash)
    : safeEqual(password, account.password)

  if (!passwordOk) {
    throw new Error('运营账号或密码无效')
  }

  return {
    id: account.id,
    roles: account.roles,
    source: 'account'
  }
}

function authenticateSharedSecret(accountId, password, moderationSecret, environment) {
  assertConfiguredSecret(moderationSecret, '运营共享密钥', environment)

  if (!password || !safeEqual(password, moderationSecret)) {
    throw new Error('运营账号或密码无效')
  }

  return {
    id: accountId,
    roles: ALL_OPS_ROLES,
    source: 'shared-secret'
  }
}

function authenticateSecretRequest(request, url, moderationSecret, environment) {
  const actual = request.headers['x-moderation-secret'] || url.searchParams.get('secret') || ''

  assertConfiguredSecret(moderationSecret, '运营共享密钥', environment)

  if (!actual || !safeEqual(actual, moderationSecret)) {
    throw new Error('审核回调密钥无效')
  }

  return {
    id: normalizeActorId(request.headers['x-ops-actor-id'] || url.searchParams.get('actorId') || 'ops-shared-secret'),
    roles: ALL_OPS_ROLES
  }
}

function signOpsSession(payload, secret) {
  const body = base64UrlEncode(JSON.stringify(payload))
  const signature = createHmac('sha256', assertTokenSecret(secret))
    .update(body)
    .digest('base64url')

  return `${body}.${signature}`
}

function verifyOpsSession(token, secret) {
  const [body, signature] = String(token || '').split('.')

  if (!body || !signature) {
    throw new Error('运营会话无效')
  }

  const expected = createHmac('sha256', assertTokenSecret(secret))
    .update(body)
    .digest('base64url')

  if (!safeEqual(signature, expected)) {
    throw new Error('运营会话无效')
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))

  if (!payload.actorId || Number(payload.exp) <= Date.now()) {
    throw new Error('运营会话已过期')
  }

  return {
    actorId: normalizeActorId(payload.actorId),
    roles: normalizeRoles(payload.roles),
    source: 'session'
  }
}

function getOpsSessionToken(request) {
  const authorization = String(request.headers.authorization || '')

  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim()
  }

  return request.headers['x-ops-session-token'] || ''
}

function normalizeOpsAccount(account = {}) {
  const id = normalizeActorId(account.id || account.accountId)
  const password = String(account.password || '').trim()
  const passwordHash = String(account.passwordHash || '').trim().toLowerCase()
  const roles = normalizeRoles(account.roles)

  if (!id || (!password && !passwordHash)) {
    return null
  }

  return {
    id,
    password,
    passwordHash,
    roles: roles.length ? roles : ALL_OPS_ROLES
  }
}

function normalizeActorId(value = '') {
  return String(value || '').trim().replace(/[^\w.-]/g, '').slice(0, 64)
}

function normalizeRoles(value = []) {
  const roles = Array.isArray(value)
    ? value
    : String(value || '').split(/[|,\s]+/)

  return roles
    .map((role) => String(role || '').trim())
    .filter((role) => ALL_OPS_ROLES.includes(role))
}

function normalizeSessionTtl(value) {
  return Number.isFinite(value) && value > 0 ? value : OPS_SESSION_TTL_MS
}

function normalizePositiveInteger(value, fallback) {
  const normalized = Number(value)

  if (Number.isInteger(normalized) && normalized > 0) {
    return normalized
  }

  return fallback
}

function assertOpsLoginAllowed(loginFailures, accountId, now, options = {}) {
  const entry = getActiveLoginFailureEntry(loginFailures, accountId, now, options.loginWindowMs)

  if (entry?.lockedUntil && entry.lockedUntil > now) {
    throw createOpsLoginLockError(entry.lockedUntil)
  }
}

function recordOpsLoginFailure(loginFailures, accountId, now, options = {}) {
  const entry = getActiveLoginFailureEntry(loginFailures, accountId, now, options.loginWindowMs) || {
    count: 0,
    firstFailedAt: now,
    lockedUntil: 0
  }
  const next = {
    ...entry,
    count: entry.count + 1,
    firstFailedAt: entry.firstFailedAt || now,
    lockedUntil: entry.lockedUntil || 0
  }

  if (next.count >= options.loginMaxFailures) {
    next.lockedUntil = now + options.loginLockMs
    loginFailures.set(accountId, next)
    return createOpsLoginLockError(next.lockedUntil)
  }

  loginFailures.set(accountId, next)
  return null
}

function getActiveLoginFailureEntry(loginFailures, accountId, now, loginWindowMs = OPS_LOGIN_WINDOW_MS) {
  const entry = loginFailures.get(accountId)

  if (!entry) {
    return null
  }

  if (entry.lockedUntil && entry.lockedUntil > now) {
    return entry
  }

  if (entry.firstFailedAt && now - entry.firstFailedAt <= loginWindowMs) {
    return {
      ...entry,
      lockedUntil: 0
    }
  }

  loginFailures.delete(accountId)
  return null
}

function createOpsLoginLockError(lockedUntil) {
  const error = new Error('运营登录失败次数过多，请稍后再试')
  error.status = 429
  error.code = 'TOO_MANY_REQUESTS'
  error.lockedUntil = lockedUntil
  return error
}

function assertConfiguredSecret(secret, label, environment) {
  if (!secret || /REPLACE_WITH|placeholder|example\./i.test(String(secret))) {
    throw new Error(`${environment} 环境${label}未配置`)
  }
}

function assertTokenSecret(secret) {
  if (!secret) {
    throw new Error('运营会话签名密钥未配置')
  }

  return secret
}

function safeEqual(left = '', right = '') {
  const leftValue = Buffer.from(String(left))
  const rightValue = Buffer.from(String(right))

  if (leftValue.length !== rightValue.length) {
    return false
  }

  return timingSafeEqual(leftValue, rightValue)
}

function sha256(value = '') {
  return createHash('sha256').update(String(value)).digest('hex')
}

function base64UrlEncode(value = '') {
  return Buffer.from(String(value), 'utf8').toString('base64url')
}
