import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createBffState } from '../../src/bff/handler.js'

export class FileStateStore {
  constructor(filePath, options = {}) {
    if (!filePath) {
      throw new Error('FileStateStore requires a file path')
    }

    this.filePath = filePath
    this.seedItems = options.seedItems
    this.queue = Promise.resolve()
  }

  async transact(callback) {
    const run = this.queue.then(async () => {
      const state = await this.load()
      let result
      let capturedError

      try {
        result = await callback(state)
      } catch (error) {
        if (!shouldCommitStateOnError(error)) {
          throw error
        }

        capturedError = error
      }

      await this.save(state)

      if (capturedError) {
        throw capturedError
      }

      return result
    })

    this.queue = run.catch(() => {})
    return run
  }

  async check() {
    await this.load()
    return {
      ok: true,
      type: 'file'
    }
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return normalizeState(JSON.parse(raw), this.seedItems)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }

      return createBffState(this.seedItems)
    }
  }

  async save(state) {
    await mkdir(dirname(this.filePath), {
      recursive: true
    })

    const tmpPath = `${this.filePath}.${process.pid}.tmp`
    await writeFile(tmpPath, JSON.stringify(normalizeState(state, this.seedItems), null, 2))
    await rename(tmpPath, this.filePath)
  }
}

function shouldCommitStateOnError(error = {}) {
  return error?.commitStateOnError === true
}

export function normalizeState(state = {}, seedItems) {
  const initial = createBffState(seedItems)

  return {
    users: Array.isArray(state.users) ? state.users : initial.users,
    sessions: Array.isArray(state.sessions) ? state.sessions : initial.sessions,
    idempotencyRecords: Array.isArray(state.idempotencyRecords) ? state.idempotencyRecords : initial.idempotencyRecords,
    items: Array.isArray(state.items) ? state.items : initial.items,
    trades: Array.isArray(state.trades) ? state.trades : initial.trades,
    disputeCases: Array.isArray(state.disputeCases) ? state.disputeCases : initial.disputeCases,
    reviews: Array.isArray(state.reviews) ? state.reviews : initial.reviews,
    notifications: Array.isArray(state.notifications) ? state.notifications : initial.notifications,
    notificationDeliveries: Array.isArray(state.notificationDeliveries) ? state.notificationDeliveries : initial.notificationDeliveries,
    uploads: Array.isArray(state.uploads) ? state.uploads : initial.uploads,
    reports: Array.isArray(state.reports) ? state.reports : initial.reports,
    locationRiskEvents: Array.isArray(state.locationRiskEvents) ? state.locationRiskEvents : initial.locationRiskEvents,
    moderationEvents: Array.isArray(state.moderationEvents) ? state.moderationEvents : initial.moderationEvents,
    clientEvents: Array.isArray(state.clientEvents) ? state.clientEvents : initial.clientEvents,
    opsAuditEvents: Array.isArray(state.opsAuditEvents) ? state.opsAuditEvents : initial.opsAuditEvents,
    accountDeletions: Array.isArray(state.accountDeletions) ? state.accountDeletions : initial.accountDeletions
  }
}
