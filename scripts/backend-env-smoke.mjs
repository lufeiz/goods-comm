import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGoodsCommServer } from '../backend/src/server.mjs'
import { FileStateStore } from '../backend/src/file-state-store.mjs'
import { createRuntimeStateStore } from '../backend/src/state-store.mjs'
import { normalizePostgresAutoSchema } from '../backend/src/postgres-state-store.mjs'

assert.equal(normalizePostgresAutoSchema('', 'dev'), true)
assert.equal(normalizePostgresAutoSchema('', 'test'), true)
assert.equal(normalizePostgresAutoSchema('', 'pre'), false)
assert.equal(normalizePostgresAutoSchema('false', 'prod'), false)
assert.throws(() => normalizePostgresAutoSchema('true', 'prod'), /GOODS_COMM_POSTGRES_AUTO_SCHEMA must be false/)
assert.throws(() => normalizePostgresAutoSchema('sometimes', 'dev'), /GOODS_COMM_POSTGRES_AUTO_SCHEMA must be true or false/)

const protectedPostgresStore = createRuntimeStateStore({
  environment: 'pre',
  storeType: 'postgres',
  databaseUrl: 'postgres://goods_comm_pre_app:secret@pre-pg.example.internal:5432/goods_comm_pre'
})
assert.equal(protectedPostgresStore.store.autoSchema, false)

const transactionDir = await mkdtemp(join(tmpdir(), 'goods-comm-file-store-'))
try {
  const fileStore = new FileStateStore(join(transactionDir, 'state.json'), {
    seedItems: []
  })

  await fileStore.transact(async (state) => {
    state.users.push({
      id: 'file-store-committed-user',
      provider: 'wechat',
      platformId: 'file-store-committed-openid',
      createdAt: Date.now()
    })

    return 'committed'
  })

  await assert.rejects(
    () => fileStore.transact(async (state) => {
      state.users.push({
        id: 'file-store-rolled-back-user',
        provider: 'wechat',
        platformId: 'file-store-rolled-back-openid',
        createdAt: Date.now()
      })

      throw new Error('rollback file store transaction')
    }),
    /rollback file store transaction/
  )

  const restoredState = await fileStore.load()
  assert.equal(restoredState.users.some((user) => user.id === 'file-store-committed-user'), true)
  assert.equal(restoredState.users.some((user) => user.id === 'file-store-rolled-back-user'), false)

  const committableError = new Error('commit rejected audit')
  committableError.commitStateOnError = true
  await assert.rejects(
    () => fileStore.transact(async (state) => {
      state.moderationEvents.push({
        id: 'file-store-rejected-audit',
        targetType: 'item_submission',
        title: 'file store rejected audit',
        status: 'rejected',
        reasons: ['content rejected'],
        createdAt: Date.now()
      })

      throw committableError
    }),
    /commit rejected audit/
  )

  const restoredCommittedErrorState = await fileStore.load()
  assert.equal(restoredCommittedErrorState.moderationEvents.some((event) =>
    event.id === 'file-store-rejected-audit' &&
    event.status === 'rejected'
  ), true)
} finally {
  await rm(transactionDir, {
    recursive: true,
    force: true
  })
}

assert.throws(() => createRuntimeStateStore({
  environment: 'prod',
  storeType: 'postgres',
  databaseUrl: 'postgres://goods_comm_prod_app:secret@prod-pg.example.internal:5432/goods_comm_prod',
  autoSchema: 'true'
}), /GOODS_COMM_POSTGRES_AUTO_SCHEMA must be false/)

assert.throws(() => createGoodsCommServer({
  environment: 'pre',
  storeType: 'file',
  statePath: '/private/tmp/goods-comm-unsafe-pre.json'
}), /pre 环境不能使用文件状态存储/)

assert.throws(() => createGoodsCommServer({
  environment: 'pre',
  store: {
    productionSafe: true,
    transact: async (callback) => callback({})
  },
  objectStore: {
    type: 'custom-object',
    productionSafe: true,
    saveItemImage: async (file) => file,
    readAsset: async () => ({
      bytes: Buffer.from(''),
      mimeType: 'application/octet-stream'
    })
  },
  platformAuth: {
    mode: 'platform',
    resolveLoginData: async (payload) => payload
  },
  contentSafety: {
    provider: 'wechat',
    reviewItemPayload: async (payload) => payload,
    reviewUploadedImage: async (file) => file
  },
  regionResolver: {
    provider: 'tencent',
    resolveRegion: async () => ({
      communityId: 'server-community',
      streetId: 'server-street',
      precision: 'community'
    })
  },
  platformNotifier: {
    provider: 'wechat',
    dispatchNotifications: async () => []
  }
}), /pre 环境不能使用 CORS wildcard/)

assert.throws(() => createGoodsCommServer({
  environment: 'prod',
  storeType: 'file',
  statePath: '/private/tmp/goods-comm-unsafe-prod.json'
}), /prod 环境不能使用文件状态存储/)

assert.throws(() => createGoodsCommServer({
  environment: 'pre',
  storeType: 'postgres',
  databaseUrl: ''
}), /GOODS_COMM_DATABASE_URL is required/)

assert.throws(() => createGoodsCommServer({
  environment: 'prod',
  store: {
    productionSafe: true,
    transact: async (callback) => callback({})
  },
  allowedOrigins: ['https://goods-comm.example.com'],
  authMode: 'demo'
}), /prod 环境不能使用演示登录/)

const safeCustomStore = {
  productionSafe: true,
  transact: async (callback) => callback({
    users: [],
    sessions: [],
    items: [],
    trades: [],
    uploads: [],
    reports: [],
    moderationEvents: [],
    accountDeletions: []
  })
}
const safeObjectStore = {
  type: 'custom-object',
  productionSafe: true,
  saveItemImage: async (file) => file,
  readAsset: async () => ({
    bytes: Buffer.from(''),
    mimeType: 'application/octet-stream'
  })
}
const safePlatformAuth = {
  mode: 'platform',
  resolveLoginData: async (payload) => payload
}
const safeContentSafety = {
  provider: 'wechat',
  reviewItemPayload: async (payload) => payload,
  reviewUploadedImage: async (file) => file
}
const safeRegionResolver = {
  provider: 'tencent',
  resolveRegion: async () => ({
    communityId: 'server-community',
    streetId: 'server-street',
    precision: 'community'
  })
}

assert.throws(() => createGoodsCommServer({
  environment: 'pre',
  store: safeCustomStore,
  allowedOrigins: ['https://pre.goods-comm.example.com'],
  platformAuth: safePlatformAuth,
  contentSafety: safeContentSafety,
  objectStore: {
    type: 'local'
  }
}), /pre 环境不能使用未声明 productionSafe 的对象存储/)

assert.throws(() => createGoodsCommServer({
  environment: 'prod',
  store: safeCustomStore,
  allowedOrigins: ['https://goods-comm.example.com'],
  platformAuth: safePlatformAuth,
  objectStore: safeObjectStore,
  contentSafetyProvider: 'mock'
}), /prod 环境不能使用 mock 内容安全/)

assert.throws(() => createGoodsCommServer({
  environment: 'pre',
  store: safeCustomStore,
  allowedOrigins: ['https://pre.goods-comm.example.com'],
  platformAuth: safePlatformAuth,
  objectStore: safeObjectStore,
  contentSafety: safeContentSafety,
  mapProvider: 'mock'
}), /pre 环境不能使用样例区域数据/)

assert.throws(() => createGoodsCommServer({
  environment: 'prod',
  store: safeCustomStore,
  allowedOrigins: ['https://goods-comm.example.com'],
  platformAuth: safePlatformAuth,
  objectStore: safeObjectStore,
  contentSafety: safeContentSafety,
  regionResolver: safeRegionResolver,
  notifyProvider: 'mock'
}), /prod 环境不能使用 mock 平台通知/)

const server = createGoodsCommServer({
  environment: 'prod',
  store: safeCustomStore,
  storeType: 'custom',
  allowedOrigins: ['https://goods-comm.example.com'],
  objectStore: safeObjectStore,
  platformAuth: safePlatformAuth,
  contentSafety: safeContentSafety,
  regionResolver: safeRegionResolver
})
await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen)
  server.listen(0, '127.0.0.1', () => {
    server.off('error', rejectListen)
    resolveListen()
  })
})

try {
  const address = server.address()
  const protectedWriteWithoutIdempotency = await fetch(`http://127.0.0.1:${address.port}/items`, {
    method: 'POST',
    headers: {
      origin: 'https://goods-comm.example.com',
      'content-type': 'application/json',
      authorization: 'Bearer missing-token'
    },
    body: JSON.stringify({})
  })
  const protectedWriteWithoutIdempotencyBody = await protectedWriteWithoutIdempotency.json()
  assert.equal(protectedWriteWithoutIdempotency.status, 422)
  assert.equal(protectedWriteWithoutIdempotencyBody.code, 'VALIDATION_ERROR')
  assert.match(protectedWriteWithoutIdempotencyBody.message, /Idempotency-Key/)
} finally {
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error)
        return
      }

      resolveClose()
    })
  })
}

console.log('Backend environment guard checks passed')
