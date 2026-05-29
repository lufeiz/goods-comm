export function normalizeBffHttpError(error = {}) {
  const message = String(error.message || '')

  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 600) {
    return {
      status: error.status,
      code: error.code || 'BAD_REQUEST'
    }
  }

  if (
    /平台登录配置未完成/.test(message) ||
    /内容安全配置未完成/.test(message) ||
    /对象存储配置未完成/.test(message) ||
    /地图服务配置未完成/.test(message) ||
    /会话密钥配置未完成/.test(message)
  ) {
    return {
      status: 503,
      code: 'SERVICE_UNAVAILABLE'
    }
  }

  if (error?.code === 'ENOENT') {
    return {
      status: 404,
      code: 'NOT_FOUND'
    }
  }

  const rules = [
    {
      status: 401,
      code: 'UNAUTHENTICATED',
      patterns: [/登录态无效/, /需要先登录/, /平台登录失败/, /登录 code 无效/, /审核回调密钥/, /运营会话/, /运营账号或密码无效/]
    },
    {
      status: 403,
      code: 'FORBIDDEN',
      patterns: [/只能/, /不能购买自己/, /不能举报自己/, /当前账号不能/, /账号状态不可用/]
    },
    {
      status: 404,
      code: 'NOT_FOUND',
      patterns: [/接口不存在/, /不存在或已下架/, /交易意向不存在/, /争议工单不存在/, /举报记录不存在/]
    },
    {
      status: 409,
      code: 'CONFLICT',
      patterns: [/已存在/, /已有/, /已评价/, /已处理/, /已完成交易/, /已售/, /交易完成后/, /不允许/, /不能重新上架/, /不能手动/, /不能执行/, /幂等键/, /幂等请求/, /举报记录已处理/]
    },
    {
      status: 422,
      code: 'VALIDATION_ERROR',
      patterns: [/请/, /未能/, /无效/, /不能超过/, /需要提交/, /定位/, /商品未通过审核/, /举报信息不完整/, /举报原因无效/, /争议处理结果无效/, /举报处理结果无效/]
    }
  ]
  const matched = rules.find((rule) => rule.patterns.some((pattern) => pattern.test(message)))

  if (matched) {
    return matched
  }

  if (error instanceof SyntaxError) {
    return {
      status: 400,
      code: 'BAD_JSON'
    }
  }

  return {
    status: 400,
    code: 'BAD_REQUEST'
  }
}
