import { USER_AGREEMENT_LABEL, USER_AGREEMENT_VERSION } from '../config/app.js'

const AGREEMENT_KEY = 'goods.userAgreement'

export { USER_AGREEMENT_LABEL, USER_AGREEMENT_VERSION }

export function getUserAgreementAcceptance() {
  const record = typeof uni === 'undefined' ? null : uni.getStorageSync(AGREEMENT_KEY)

  if (!record || record.version !== USER_AGREEMENT_VERSION || !record.acceptedAt) {
    return null
  }

  return record
}

export function hasAcceptedUserAgreement() {
  return Boolean(getUserAgreementAcceptance())
}

export function acceptUserAgreement(options = {}) {
  const record = {
    version: USER_AGREEMENT_VERSION,
    acceptedAt: Date.now(),
    source: String(options.source || 'manual').slice(0, 40)
  }

  if (typeof uni !== 'undefined') {
    uni.setStorageSync(AGREEMENT_KEY, record)
  }

  return record
}

export function clearUserAgreementAcceptance() {
  if (typeof uni !== 'undefined') {
    uni.removeStorageSync(AGREEMENT_KEY)
  }
}

export function requireUserAgreement(message = `请先阅读并同意${USER_AGREEMENT_LABEL}`) {
  const agreement = getUserAgreementAcceptance()

  if (!agreement) {
    throw new Error(message)
  }

  return agreement
}

export function clearUserAgreementForTesting() {
  clearUserAgreementAcceptance()
}
