export function getPlatformName() {
  const runtimePlatform = getRuntimePlatform()

  if (runtimePlatform === 'weixin') {
    return '微信小程序'
  }

  if (runtimePlatform === 'alipay') {
    return '支付宝小程序'
  }

  if (runtimePlatform === 'h5') {
    return 'H5'
  }

  // #ifdef MP-WEIXIN
  return '微信小程序'
  // #endif

  // #ifdef MP-ALIPAY
  return '支付宝小程序'
  // #endif

  // #ifdef H5
  return 'H5'
  // #endif

  return '通用小程序'
}

export function isBrowserRuntime() {
  return typeof window !== 'undefined' &&
    typeof navigator !== 'undefined'
}

export function getRuntimePlatform() {
  const uniPlatform = getUniPlatform()

  if (/mp-weixin|weixin/i.test(uniPlatform)) {
    return 'weixin'
  }

  if (/mp-alipay|alipay/i.test(uniPlatform)) {
    return 'alipay'
  }

  if (/web|h5/i.test(uniPlatform) || isBrowserRuntime()) {
    return 'h5'
  }

  return ''
}

function getUniPlatform() {
  if (typeof uni === 'undefined' || typeof uni.getSystemInfoSync !== 'function') {
    return ''
  }

  try {
    const info = uni.getSystemInfoSync()
    return String(info?.uniPlatform || info?.platform || '')
  } catch (error) {
    return ''
  }
}

export function openLocationSettings() {
  if (typeof uni === 'undefined' || !uni.openSetting) {
    return Promise.reject(new Error('当前平台不支持打开权限设置'))
  }

  return new Promise((resolve, reject) => {
    uni.openSetting({
      success: resolve,
      fail: reject
    })
  })
}

export function showToast(title, icon = 'none') {
  if (typeof uni === 'undefined') {
    return
  }

  uni.showToast({
    title,
    icon
  })
}
