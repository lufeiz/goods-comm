# goods-comm BFF / 云函数接口契约

更新日期：2026-05-28

端侧已经通过 `src/services/api.js`、`src/services/goods.js`、`src/services/auth.js`、`src/services/reports.js` 对齐以下接口。`src/bff/handler.js` 提供无依赖纯函数处理器，`src/bff/fetch-adapter.js` 提供 Fetch Runtime / 边缘函数适配器，`backend/src/server.mjs` 已将同一套契约挂载为可运行的 Node HTTP 后端；`backend/db/schema.sql` 提供 PostgreSQL / TencentDB 建表脚本。

端侧通过 `VITE_API_BASE_URL` 配置远端 BFF 地址；dev/test 未配置时可回落本地演示存储和样例区域数据，pre/prod 必须配置服务端区域解析。

## 0. 写请求幂等

生产端侧对发布商品、商品状态变更、发起交易、交易状态变更、提交评价、标记通知已读、举报和后台复核 / 争议处理等写请求，必须携带 `Idempotency-Key` 或 `X-Idempotency-Key`；pre/prod HTTP 后端会拒绝缺少幂等键的核心写请求。当前 `src/services/api.js` 和业务 service 已为主要端侧写请求生成稳定幂等键。

服务端行为：

- 同一用户、同一幂等键、同一 HTTP 方法、同一路径和同一请求体哈希，重复提交时直接返回首次成功响应；对已经提交审计的业务拒绝，例如商品发布内容安全拒绝，重复提交会回放首次错误。
- 同一用户复用同一幂等键提交不同请求时返回 `409 CONFLICT`，避免错误复用键导致状态串写。
- 幂等记录当前保留 24 小时，并持久化到 `idempotency_records`；prod 同步到 pre 时会清空该表，避免预上线环境继承生产请求重放缓存。
- 幂等默认只覆盖成功结果；业务校验失败仍按原错误码返回。例外是带 `commitStateOnError` 的业务拒绝，这类请求已经写入审核 / 风控留痕，因此会记录为 `committed_error` 并回放首次错误，避免弱网重试重复追加审核事件。
- 这层保护用于抵御弱网重试、端侧重复点击和平台网关重放，不能替代数据库唯一索引和交易状态机。

## 1. 认证

### `POST /auth/login`

请求：

```json
{
  "provider": "weixin",
  "code": "platform-login-code",
  "userInfo": {
    "nickname": "社区用户",
    "avatarUrl": "https://..."
  },
  "agreement": {
    "version": "2026-05-28",
    "acceptedAt": 1770000000000,
    "source": "mine-checkbox"
  }
}
```

响应：

```json
{
  "provider": "weixin",
  "token": "session_xxx",
  "sessionExpiresAt": 1770000000000,
  "user": {
    "id": "user_xxx",
    "provider": "weixin",
    "platformId": "platform-login-code",
    "nickname": "社区用户",
    "avatarUrl": "https://...",
    "contactCode": "weixin-xxxx"
  }
}
```

生产要求：

- 服务端必须使用平台 code 换取 `openid/unionid`，不能信任客户端生成的 ID。
- Node HTTP 后端会在进入 BFF handler 前执行平台身份解析：`dev/test` 默认 `GOODS_COMM_PLATFORM_AUTH_MODE=demo` 便于 smoke；`pre/prod` 必须为 `platform`，并使用微信 `jscode2session` 或支付宝 `alipay.system.oauth.token` 换取平台身份。
- BFF `login` 只用服务端注入的 `platformIdentity.platformId` 作为正式平台身份；没有该身份时仅用于本地/测试演示。
- token 必须写入服务端 session 记录，可过期、可吊销，并绑定用户状态。
- 服务端 session 记录只保存 `tokenHash`，登录响应只返回一次明文 token；当前 BFF 使用随机 session token，并以 `GOODS_COMM_SESSION_SECRET` 计算 HMAC-SHA256 后持久化。
- BFF 示例已维护 `sessions` 状态；`requireUser` 会按 token hash 查找 session，并拒绝不存在、已过期、已吊销或用户状态非 `active` 的 token。`pre/prod` 缺失真实 `GOODS_COMM_SESSION_SECRET` 时不得签发 session。
- 端侧登录前必须确认用户协议和隐私政策；`pre/prod` 服务端会拒绝未提交当前协议版本的新用户或未确认当前版本协议的用户，并把 `agreement` 版本、确认时间和来源落到 `users` 表作为账号合规审计字段。

### `POST /auth/logout`

请求需带 `Authorization: Bearer <token>`。

响应：

```json
{
  "ok": true,
  "revokedAt": 1770000000000
}
```

生产要求：

- 退出登录必须吊销当前 session，不能只清端侧缓存。
- 退出后旧 token 再访问任何需登录接口都必须返回登录态无效。
- 账号注销仍应吊销该用户所有 session；普通退出只吊销当前 session。

### `POST /auth/delete-account`

请求需带 `Authorization: Bearer <token>`。

请求：

```json
{
  "reason": "user_requested"
}
```

响应：

```json
{
  "ok": true,
  "deletedAt": 1770000000000
}
```

生产要求：

- 账号注销后 token 必须立即失效。
- 账号注销时必须吊销该用户所有未过期 session。
- 用户在售 / 锁定 / 审核中的商品必须下架，活跃交易必须取消。
- 如果注销用户是买家，因其交易取消而锁定的商品应在没有其他活跃交易时回到 `online`。
- 用户昵称、头像、联系码等可识别字段需要脱敏或删除，保留必要审计记录。

## 2. 位置解析

### `POST /lbs/resolve-region`

请求：

```json
{
  "latitude": 31.22945,
  "longitude": 121.45494,
  "coordType": "gcj02"
}
```

响应：

```json
{
  "communityId": "sh-jingan-shimen",
  "communityName": "石门二路社区",
  "streetId": "sh-jingan-nanjingxi",
  "streetName": "南京西路街道",
  "precision": "community"
}
```

生产要求：

- 服务端必须接地图服务或社区网格库，返回标准社区/街道编码。Node HTTP 后端已提供 `backend/src/region-resolver.mjs`，`dev/test` 可用 mock，`pre/prod` 必须使用 `GOODS_COMM_MAP_PROVIDER=tencent`。
- `GOODS_COMM_MAP_REGION_DATASET` 用于把腾讯地图行政区 / 街道结果映射成内部稳定 `communityId` / `streetId`，避免业务直接依赖外部展示文案；pre/prod 必须配置为非空 JSON 数组，不能只是数据集版本标签。
- 发布商品和发起交易时服务端都必须重新解析，不使用客户端传来的行政区字段作为最终裁决。
- 端侧定位 profile 会归一化失败状态：`LOCATION_DENIED`、`LOCATION_SYSTEM_DISABLED`、`LOCATION_TIMEOUT`、`LOCATION_NETWORK_FAILED`、`LOCATION_LOW_ACCURACY`、`LOCATION_EXPIRED`、`LOCATION_INVALID`、`LOCATION_REGION_FAILED`、`LOCATION_UNSUPPORTED`、`LOCATION_CANCELLED`。页面必须据此区分去设置、重新定位、检查系统定位或稍后重试，而不是统一显示“定位失败”。

## 3. 图片上传

### `POST /uploads/items`

上传字段：

```text
file: 图片文件
usage: item_image
```

响应：

```json
{
  "id": "upload_xxx",
  "url": "https://cdn.example.com/items/xxx.jpg",
  "storageKey": "items/xxx.jpg",
  "size": 123456,
  "mimeType": "image/jpeg",
  "originalName": "chair.jpg",
  "checksum": "sha256-hex",
  "status": "uploaded",
  "traceId": "wechat_trace_id"
}
```

生产要求：

- 上传后应进入内容安全扫描。
- 商品发布前至少需要 1 张图片。
- Node HTTP 后端本地环境会将 multipart 图片字节写入 `GOODS_COMM_OBJECT_DIR`，返回 `/assets/...` URL，并保留 `storageKey`、大小、MIME、原文件名和 SHA-256 校验值。
- `/assets/...` 读取缺失对象时返回 HTTP `404` 和错误码 `NOT_FOUND`，避免客户端把资源缺失误判为请求参数错误。
- `pre/prod` 必须使用 `GOODS_COMM_OBJECT_STORE=cos`，本地对象存储会被后端启动保护拒绝；COS 适配器会上传到腾讯 COS，并返回 CDN URL、`storageKey`、大小、MIME、原文件名和 SHA-256 校验值。
- `pre/prod` 必须使用 `GOODS_COMM_CONTENT_SECURITY_PROVIDER=wechat`；上传图片会提交微信异步图片审核并保留 `traceId`，返回 `pending_review` 时商品不会进入公开列表。

## 4. 商品

商品状态：

| 状态 | 含义 | 是否公开展示 |
| --- | --- | --- |
| `pending_review` | 内容或图片仍在审核中 | 否，仅卖家可在“我的发布”看到 |
| `online` | 在售 | 是 |
| `reserved` | 已有活跃交易意向，暂时锁定 | 详情可见，列表默认不展示 |
| `sold` | 已完成交易 | 详情可见，列表默认不展示 |
| `removed` | 已下架、违规下架或账号注销下架 | 否 |

### `GET /items`

查询参数：

```json
{
  "keyword": "折叠椅",
  "category": "home",
  "latitude": 31.23,
  "longitude": 121.45
}
```

响应：

```json
{
  "items": [
    {
      "id": "item_xxx",
      "title": "九成新折叠椅",
      "seller": {
        "id": "user_xxx",
        "nickname": "社区用户",
        "avatarUrl": "https://..."
      },
      "location": {
        "communityId": "sh-jingan-shimen",
        "communityName": "石门二路社区",
        "streetId": "sh-jingan-nanjingxi",
        "streetName": "南京西路街道",
        "regionPrecision": "community"
      }
    }
  ]
}
```

响应要求：

- `seller` 只能返回展示字段，不能在商品列表或公开详情中返回 `contactCode`、手机号、微信号等联系信息。
- 公开商品响应的 `location` 只能返回社区/街道等展示字段，不能返回卖家发布的精确 `latitude` / `longitude`、POI 名称或详细地址。
- 列表展示必须带 `latitude` / `longitude`；端侧没有有效当前位置时直接返回空列表，不请求远端 `/items`；Node HTTP 后端会先用服务端地图解析当前位置，再复用交易资格规则过滤同社区 / 同街道和半径范围，只返回当前用户可发起交易范围内的在线商品。本地 fallback 也保持同一规则，无当前位置时不展示公开商品。
- BFF 可在响应中返回顶层 `distanceMeters`，端侧不能依赖公开商品坐标自行计算距离。

### `POST /items`

请求需带 `Authorization: Bearer <token>`。

请求：

```json
{
  "title": "九成新折叠椅",
  "price": 58,
  "category": "home",
  "condition": "good",
  "description": "自提优先",
  "images": [
    {
      "url": "https://cdn.example.com/items/xxx.jpg",
      "status": "uploaded"
    }
  ],
  "tradeScope": {
    "type": "community",
    "label": "同社区",
    "radiusMeters": 1200
  },
  "location": {
    "latitude": 31.22945,
    "longitude": 121.45494,
    "accuracy": 50,
    "capturedAt": 1770000000000,
    "communityId": "sh-jingan-shimen",
    "streetId": "sh-jingan-nanjingxi"
  }
}
```

生产要求：

- 服务端从 token 绑定卖家，不接受客户端伪造 seller。
- `location` 必须来自新鲜、带精度的实时 GPS；过期、缺少精度或低精度坐标必须拒绝发布。
- `location` 的经纬度可用于服务端解析；`communityId`、`streetId` 等行政区字段只能作为展示初值，最终归属必须由服务端重算并覆盖。
- 商品创建成功后的公开响应也必须复用商品脱敏规则：卖家联系码和精确发布坐标不返回，服务端保留坐标用于交易校验和距离计算。
- 同一卖家存在同名 `pending_review` / `online` / `reserved` 商品时，服务端必须拒绝重复发布，避免刷屏和重复审核。
- 端侧重复提交同一次发布请求时应使用相同幂等键，服务端必须返回首次创建的商品，不能重复写入商品和审核队列。
- 无法解析到社区 / 街道时必须拒绝发布，避免生成不可交易商品。
- 文本命中违禁词时直接拒绝，记录审核事件，不写入普通商品表。
- 本地演示路径也执行同样的违禁词拒绝语义，避免无远端 API 时绕过内容审核。
- Node HTTP 后端会在 `/items` 发布前执行内容安全适配器：`dev/test` 使用 mock，`pre/prod` 使用微信内容安全；审核拒绝时返回 `422 VALIDATION_ERROR`，待复核时返回 `pending_review`。
- 审核拒绝虽然对客户端返回错误，但必须保留 `moderation_events` 审计记录；BFF 使用显式 `commitStateOnError` 标记让 file/PostgreSQL store 提交审核拒绝事件后继续返回 `422`，不能依赖本地文件 store 的异常落盘副作用。
- 图片未完成服务端上传 / 审核时，商品进入 `pending_review`，不进入公开列表或公开详情。
- 图片和文本通过自动审核时，当前 BFF 示例返回 `online` + `reviewStatus: approved_auto`；生产环境可按策略改为人工或异步审核后再上架。

### `GET /items/mine`

返回当前登录用户发布的商品。

### `GET /items/:id`

返回商品详情。

响应要求：

- 公开详情仍不能返回卖家联系码。交易对象进入 `pending_meetup` 后只返回本次交易的一次性联系码，不直接返回用户级联系码。
- 公开详情仍不能返回卖家精确经纬度；交易资格最终由 `/trades` 使用服务端保存的商品坐标和买家实时 GPS 重算。

### `PATCH /items/:id/status`

请求：

```json
{
  "status": "removed"
}
```

生产要求：

- 只能卖家本人操作。
- 已售商品不能被重新上架。
- 交易中的商品不能由卖家手动下架或手动恢复，必须通过交易取消、完成或争议流程流转。
- `pending_review`、`reported_removed`、`seller_deleted`、`rejected` 等审核 / 风控状态不能由卖家手动上架。
- 普通卖家下架的 `removed` 商品可以重新上架；违规或账号注销导致的 `removed` 商品不能重新上架。

## 5. 举报

### `POST /reports`

请求需带 `Authorization: Bearer <token>`。

请求：

```json
{
  "targetType": "item",
  "targetId": "item_xxx",
  "reason": "prohibited",
  "description": "疑似违禁物品"
}
```

响应：

```json
{
  "id": "report_xxx",
  "targetType": "item",
  "targetId": "item_xxx",
  "reason": "prohibited",
  "status": "pending_review",
  "createdAt": 1770000000000
}
```

生产要求：

- 举报记录必须持久化，不能只作为前端提示。
- 服务端必须校验 `targetType`、`targetId` 和 `reason`；无效原因、不存在或已下架的目标必须拒绝。
- 用户不能举报自己发布的商品，该限制必须由服务端执行，不能只依赖详情页拦截。
- `prohibited`、`fraud`、`privacy` 等高风险原因应触发先下架再复核，并把该商品的活跃交易转入 `disputed`，避免继续完成交易。
- 同一用户对同一目标、同一原因的待处理举报必须幂等返回原举报，不能重复追加记录。
- 重复举报、恶意举报、被举报对象状态变化都要进入后台审核队列。

### `POST /ops/login`

运营控制台登录接口。生产环境建议配置 `GOODS_COMM_OPS_ACCOUNTS` 和 `GOODS_COMM_OPS_SESSION_SECRET`，用具名账号换取短期运营 token；未配置运营账号时可用 `GOODS_COMM_MODERATION_WEBHOOK_SECRET` 作为兼容登录密钥。后端会按账号统计失败登录，超过 `GOODS_COMM_OPS_LOGIN_MAX_FAILURES` 后在 `GOODS_COMM_OPS_LOGIN_LOCK_MS` 时间内返回 `429 TOO_MANY_REQUESTS`；Node HTTP 层也有基础客户端限流，真实公网仍应在网关 / WAF 层叠加边缘限流。

请求：

```json
{
  "accountId": "support_user",
  "password": "ops-password"
}
```

响应：

```json
{
  "token": "ops-session-token",
  "expiresAt": 1770000000000,
  "operator": {
    "id": "support_user",
    "roles": ["moderation", "support"],
    "source": "account"
  }
}
```

后续运营请求优先携带 `x-ops-session-token`，后端会把 token 中的 operator id 注入举报处理、商品复核和争议处理的 `actorId`，并把登录、举报处理、审核、争议处理和通知重试写入 `ops_audit_events`。`x-moderation-secret` 仍保留给微信审核回调、内部 worker 和兼容脚本。

### `GET /ops/moderation-queue`

请求需带 `x-ops-session-token` 或 `x-moderation-secret: <GOODS_COMM_MODERATION_WEBHOOK_SECRET>`。返回运营待处理队列，不面向普通端侧用户。

响应：

```json
{
  "counts": {
    "pendingItems": 1,
    "pendingReports": 2,
    "openDisputes": 1,
    "failedDeliveries": 0
  },
  "pendingItems": [],
  "reports": [],
  "disputes": [],
  "notificationDeliveries": []
}
```

### `GET /ops/reports`

请求需带 `x-ops-session-token` 或 `x-moderation-secret`。支持用 `status`、`targetId`、`reporterId` 和 `limit` 查询举报记录。

### `GET /ops/users`

请求需带 `x-ops-session-token` 或 `x-moderation-secret`，并具备 `risk` 或 `support` 角色。支持用 `status`、`query` 和 `limit` 查询用户风控状态。返回会脱敏平台 ID，避免运营页面直接暴露完整 openid / user_id。

示例响应：

```json
{
  "counts": {
    "active": 125,
    "blocked": 2,
    "deleted": 1
  },
  "users": [
    {
      "id": "user_...",
      "provider": "weixin",
      "platformId": "wx-o***9a31",
      "nickname": "社区用户",
      "status": "blocked",
      "blockReason": "疑似批量违规发布",
      "blockedAt": 1779980000000,
      "blockedBy": "risk-operator"
    }
  ]
}
```

### `POST|PATCH /ops/reports/:id/resolve`

请求需带 `x-ops-session-token` 或 `x-moderation-secret`。用于运营处理举报。

请求：

```json
{
  "resolution": "dismiss_report",
  "actorId": "support_user",
  "note": "举报不成立，恢复商品"
}
```

允许的 `resolution`：

| 值 | 效果 |
| --- | --- |
| `dismiss_report` | 举报状态改为 `rejected`；如果商品只是被高风险举报下架且没有活跃 / 争议交易阻塞，则恢复为 `online` |
| `uphold_report` | 举报状态改为 `resolved`；商品下架为 `report_resolved_removed`，活跃交易转入 `disputed` |

生产要求：

- 处理结果必须写入 `reports.resolution`、`resolution_note`、`resolver_id` 和 `resolved_at`。
- 同一举报只能处理一次。
- 处理动作必须写入 `moderation_events` 和 `ops_audit_events`，方便后续审计和客服追责。
- `dismiss_report` 不能绕过交易争议；如果该商品还有 `pending_*` 或 `disputed` 交易，商品不能直接恢复公开。

### `POST|PATCH /ops/users/:id/status`

请求需带 `x-ops-session-token` 或 `x-moderation-secret`，并具备 `risk` 或 `support` 角色。用于运营封禁或解封用户。

请求示例：

```json
{
  "status": "blocked",
  "reason": "疑似批量违规发布"
}
```

生产要求：

- `status` 只能是 `blocked` 或 `active`；注销账号不能被恢复。
- 封禁必须填写原因，服务端写入 `users.block_reason`、`blocked_at` 和 `blocked_by`。
- 封禁必须吊销该用户所有 session，后续普通接口应返回 `401 UNAUTHENTICATED`。
- 封禁卖家时，该用户处于 `pending_review` / `online` / `reserved` 的商品必须下架为 `removed`，`review_status=user_blocked`。
- 封禁买家或卖家时，该用户相关活跃交易必须进入 `disputed`，清空一次性联系码，并写入争议工单和站内通知。
- 解封只恢复账号状态，不自动恢复已下架商品或已冻结交易，避免绕过风控复核。
- 操作必须写入 `ops_audit_events(action=ops.user.status)`，并支持 `Idempotency-Key` 防止重复封禁产生重复时间线或通知。

## 6. 审核回调与后台复核

### `POST|PATCH /moderation/items/:id/review`

请求需带 `x-moderation-secret: <GOODS_COMM_MODERATION_WEBHOOK_SECRET>`。该接口给后台复核任务按商品 ID 处理，不面向普通端侧用户。

### `POST|PATCH /moderation/media/:traceId/review`

请求需带同一个 `x-moderation-secret`。该接口给微信图片异步审核回调或云函数审核 worker 使用，按微信返回的图片 `trace_id` 定位单张图片，再更新关联商品状态。

请求：

```json
{
  "status": "approved",
  "actorId": "wechat-media-check",
  "reasons": []
}
```

`status` 允许值：

| 状态 | 行为 |
| --- | --- |
| `approved` | 仅当商品仍是 `pending_review` 时进入 `online`，非拒绝图片标记为 `uploaded` |
| `pending_media_review` | `online` 或 `pending_review` 商品进入 / 保持 `pending_review`，继续不公开展示 |
| `rejected` | 商品进入 `removed`，图片标记为 `rejected`，关联活跃交易转入 `disputed` |

生产要求：

- `pre/prod` 必须配置 `GOODS_COMM_MODERATION_WEBHOOK_SECRET`；无密钥或密钥不匹配返回 `401 UNAUTHENTICATED`。
- 审核回调不能信任端侧用户 token，应只接受云平台回调、审核 worker 或后台服务带来的共享密钥。
- 微信图片异步审核应优先使用 `/moderation/media/:traceId/review`，避免只靠商品 ID 时无法区分多图审核结果。
- `actorId` 可以是系统来源，不一定是业务用户；PostgreSQL store 会在有真实用户时保留外键，否则写入 `NULL`，避免系统 actor 破坏外键约束。
- 迟到的审核通过回调不能复活已经被卖家下架、举报下架、账号注销下架或其他业务流程终止的商品；`reserved`、`sold` 等状态也不能被审核通过回调改回 `online`。
- 审核拒绝必须和商品下架、图片拒绝、交易转争议在同一状态事务中完成。
- 审核通过后的商品响应仍复用公开商品脱敏规则，不返回精确坐标和卖家联系码。

## 7. 交易

### `GET /trades`

返回当前登录用户相关的买入/卖出交易。

### `POST /trades`

请求需带 `Authorization: Bearer <token>`。

请求：

```json
{
  "itemId": "item_xxx",
  "buyerLocation": {
    "latitude": 31.2301,
    "longitude": 121.4556,
    "accuracy": 60,
    "capturedAt": 1770000000000
  }
}
```

生产要求：

- `buyerLocation` 必须包含有效经纬度、`capturedAt` 和 `accuracy`。
- `capturedAt` 不能过期，`accuracy` 不能超过平台配置阈值；否则服务端必须拒绝交易创建。
- 服务端重新解析 `buyerLocation` 的社区/街道。
- 服务端重新计算买卖双方距离与区域匹配。
- 买家不能购买自己发布的物品。
- 交易创建后商品进入锁定状态；同一买家重复提交会先清理已过期的一次性联系码再返回原交易，其他买家不能再发起新交易。
- 弱网或平台重试导致同一次交易创建重复到达时，`Idempotency-Key` 应返回首次交易响应，不能重复生成站内通知或平台通知 outbox。
- 新建交易处于 `pending_seller_confirm` 时不得返回 `contactCode`；卖家确认进入 `pending_meetup` 后才返回本次交易的一次性 `contactCode` 和 `contactCodeExpiresAt`。`contactCodeExpiresAt` 过期后列表响应、重复创建响应和幂等重放响应都必须隐藏并清理联系码；交易完成、取消或争议后也必须清空。

### `PATCH /trades/:id/status`

请求：

```json
{
  "status": "pending_meetup"
}
```

允许流转：

| 当前状态 | 操作人 | 目标状态 |
| --- | --- | --- |
| `pending_seller_confirm` | 卖家 | `pending_meetup` |
| `pending_seller_confirm` / `pending_meetup` | 买家或卖家 | `cancelled` |
| `pending_meetup` | 买家或卖家 | `completed` |
| `pending_meetup` | 买家或卖家 | `disputed` |

生产要求：

- 状态更新必须在服务端事务里同步商品状态。
- 同一状态操作带相同幂等键重复提交时必须返回首次结果，不能重复追加 `trade_timeline` 或重复发送通知。
- `completed` 后商品变为 `sold`。
- `cancelled` 且无其他活跃交易时商品回到 `online`。
- `disputed` 会保持商品锁定，并创建开放状态的争议工单。
- 交易创建、卖家确认、完成、取消、争议、争议处理和评价都必须写入站内通知，供买卖双方在交易页收件箱查看。

## 8. 争议工单与客服处理

### `GET /disputes`

请求需带 `Authorization: Bearer <token>`。返回当前登录用户参与交易相关的争议工单，按创建时间倒序。

响应：

```json
{
  "disputes": [
    {
      "id": "dispute_xxx",
      "tradeId": "trade_xxx",
      "itemId": "item_xxx",
      "source": "user",
      "reason": "user_dispute",
      "status": "open",
      "resolution": "",
      "createdAt": 1770000000000,
      "resolvedAt": null
    }
  ]
}
```

### `POST|PATCH /moderation/disputes/:id/resolve`

后台 / 客服处理接口。Node HTTP 后端要求带 `x-moderation-secret`，与审核回调密钥一致；客户端小程序不能直接调用。

请求：

```json
{
  "resolution": "release_item",
  "note": "双方协商取消，商品恢复在售",
  "actorId": "support_user"
}
```

允许的 `resolution`：

| 值 | 效果 |
| --- | --- |
| `release_item` | 交易改为 `cancelled`，商品从 `reserved` 恢复为 `online` |
| `complete_trade` | 交易改为 `completed`，商品改为 `sold` |
| `remove_item` | 交易改为 `cancelled`，商品改为 `removed`，`reviewStatus` 记为 `dispute_removed` |

生产要求：

- 同一交易同一时间只允许一个 `open` 争议工单。
- 用户发起争议、高风险举报和内容安全拒绝都会创建工单。
- 争议处理必须在服务端事务里同时更新 `trade_disputes`、`trade_intents`、`items`、`trade_timeline` 和 `notifications`。
- 争议处理完成后给买卖双方写入 `trade_dispute_resolved` 站内通知。

## 9. 交易评价

### `POST /trades/:id/review`

请求需带 `Authorization: Bearer <token>`。只有该交易买家或卖家能评价，且交易必须已经 `completed`；同一交易同一评价人只能评价一次。

请求：

```json
{
  "rating": 5,
  "content": "交易顺利，物品和描述一致",
  "tags": ["准时", "物品一致"]
}
```

响应：

```json
{
  "id": "review_xxx",
  "tradeId": "trade_xxx",
  "itemId": "item_xxx",
  "reviewer": {
    "id": "user_buyer",
    "nickname": "买家"
  },
  "reviewee": {
    "id": "user_seller",
    "nickname": "卖家"
  },
  "rating": 5,
  "content": "交易顺利，物品和描述一致",
  "tags": ["准时", "物品一致"],
  "createdAt": 1770000000000
}
```

生产要求：

- `rating` 必须是 1 到 5 的整数。
- `content` 当前限制 200 字以内。
- 创建评价后写入 `trade_reviewed` 站内通知给交易对手方。
- `GET /trades` 会为当前用户返回 `reviewedByMe`，交易页据此控制评价入口。

### `GET /reviews?itemId=<item_id>`

公开返回指定商品的评价列表，按创建时间倒序。商品必须仍可公开访问：`online`、`reserved` 或 `sold` 可以查询，`pending_review` 和 `removed` 不可查询。

## 10. 站内通知

所有交易关键事件先写入 `notifications`，Node HTTP 后端会在事务提交后捕获新增通知并交给平台通知适配器：

- `dev/test` 默认使用 `GOODS_COMM_PLATFORM_NOTIFY_PROVIDER=mock`，便于 smoke 验证。
- `pre/prod` 必须使用 `GOODS_COMM_PLATFORM_NOTIFY_PROVIDER=wechat`，否则后端启动会拒绝 mock 平台通知。
- 微信订阅消息模板通过 `GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_IDS` 配置，例如 `trade_created:tmpl1,trade_confirmed:tmpl2`。
- 模板字段通过 `GOODS_COMM_WECHAT_SUBSCRIBE_TEMPLATE_FIELDS` 配置，默认兼容 `title:thing1,body:thing2,time:time3`。
- 平台通知投递失败不回滚已提交的交易状态和站内通知；后端会先写 `notification_deliveries` outbox，再投递并回写 `sent` / `mock_sent` / `failed` / `skipped` 状态。

### `GET /notifications`

请求需带 `Authorization: Bearer <token>`。返回当前登录用户的站内通知，按创建时间倒序。

响应：

```json
{
  "notifications": [
    {
      "id": "notification_xxx",
      "type": "trade_confirmed",
      "title": "卖家已确认交易",
      "body": "已确认可交易，可在交易页查看一次性联系码。",
      "targetType": "trade",
      "targetId": "trade_xxx",
      "readAt": null,
      "createdAt": 1770000000000
    }
  ]
}
```

### `PATCH /notifications/:id/read`

请求需带 `Authorization: Bearer <token>`。只能标记当前用户自己的通知为已读。

### `GET /ops/notification-deliveries`

请求需带 `x-moderation-secret: <GOODS_COMM_MODERATION_WEBHOOK_SECRET>`。返回平台通知投递记录，可用 `status`、`notificationId`、`userId` 和 `limit` 查询。该接口面向运营 / 后台任务，不面向普通用户。

示例：

```http
GET /ops/notification-deliveries?status=failed&limit=20
```

响应：

```json
{
  "deliveries": [
    {
      "id": "notification_delivery_xxx",
      "notificationId": "notification_xxx",
      "userId": "user_xxx",
      "type": "trade_reviewed",
      "provider": "wechat",
      "status": "failed",
      "message": "user refuse to accept the msg",
      "targetType": "trade",
      "targetId": "trade_xxx",
      "attemptCount": 1,
      "traceId": "trace_xxx",
      "lastAttemptAt": 1770000000000,
      "nextRetryAt": 1770000060000,
      "createdAt": 1770000000000,
      "updatedAt": 1770000000000
    }
  ]
}
```

### `POST|PATCH /ops/notification-deliveries/retry`

请求需带 `x-moderation-secret: <GOODS_COMM_MODERATION_WEBHOOK_SECRET>`。默认重试 `failed` 和 `pending` 且到达 `nextRetryAt` 的投递记录；也可以传 `ids` 和 `force: true` 指定立即重试。

请求：

```json
{
  "ids": ["notification_delivery_xxx"],
  "force": true,
  "limit": 20
}
```

响应：

```json
{
  "retried": 1,
  "deliveries": [
    {
      "id": "notification_delivery_xxx",
      "status": "sent",
      "attemptCount": 2
    }
  ]
}
```

## 11. 客户端遥测

### `POST /telemetry/client-events`

端侧上报登录、定位、发布、交易、举报和注销等关键失败事件。请求可带 `Authorization: Bearer <token>`，有合法 token 时服务端会关联 `userId`；无 token 时仍接收匿名事件，便于排查登录前或定位前失败。

请求：

```json
{
  "type": "location_profile_failed",
  "level": "warn",
  "code": "LOCATION_TIMEOUT",
  "message": "定位超时，请检查网络或到开阔位置后重试",
  "route": "pages/publish/publish",
  "platform": "微信小程序",
  "appEnv": "pre",
  "context": {
    "source": "gps"
  }
}
```

响应：

```json
{
  "accepted": 1
}
```

服务端会过滤 `token`、`secret`、联系方式、精确地址和经纬度等敏感字段，只保存排障所需上下文。

### `GET /ops/client-events`

请求需带 `x-ops-session-token` 或 `x-moderation-secret`，会校验 `telemetry` 或 `support` 角色。支持用 `level`、`type`、`userId` 和 `limit` 查询端侧事件。

示例：

```http
GET /ops/client-events?level=error&limit=50
```

### `GET /ops/audit-events`

请求需带 `x-ops-session-token` 或 `x-moderation-secret`，会校验 `telemetry` 或 `support` 角色。支持用 `actorId`、`action`、`targetType`、`targetId` 和 `limit` 查询运营操作审计。

示例：

```http
GET /ops/audit-events?action=ops.report.resolve&limit=50
```

响应：

```json
{
  "events": [
    {
      "id": "ops_audit_...",
      "actorId": "support_user",
      "action": "ops.report.resolve",
      "targetType": "report",
      "targetId": "report_...",
      "result": "success",
      "traceId": "trace_...",
      "source": "session",
      "context": {
        "resolution": "dismiss_report"
      },
      "createdAt": 1770000000000
    }
  ]
}
```

## 12. Fetch Runtime 适配

`createBffFetchHandler(state)` 可将同一套契约挂载到支持标准 `Request` / `Response` 的运行时，例如边缘函数、部分云函数网关或本地测试 harness。

生产边界：轻量 Fetch adapter 只用于 `dev/test`、本地 harness 和契约 smoke。它不会执行 Node HTTP 后端里的平台身份交换、真实对象存储、内容安全、腾讯地图区域解析、运营角色会话和持久化依赖就绪检查；因此在 `pre/prod` 会默认返回 HTTP `503 SERVICE_UNAVAILABLE`，要求部署 `backend/src/server.mjs` 这条完整后端链路。只有未来补齐同等级运行时前置能力后，才能重新评估 Fetch Runtime 是否可进入受保护环境。

验证命令：

```bash
npm run smoke:bff:fetch
```

适配要求：

- 成功 JSON 请求返回 `{ "data": ... }`。
- Fetch Runtime 与 Node HTTP 后端共用错误映射，错误响应返回 `{ "code": "...", "message": "..." }`，并使用同一组 `401/403/404/409/422/503` 语义状态码。
- `pre/prod` 下直接访问轻量 Fetch adapter 会返回 `503 SERVICE_UNAVAILABLE`，避免被误部署为生产 BFF。
- `/uploads/items` 的 HTTP `POST` 会映射到核心 handler 的 `UPLOAD` 方法。
- `Authorization: Bearer <token>` 透传给核心鉴权逻辑。
- `/ops/*` 和 `/moderation/*` 在 Fetch Runtime 仍使用 `x-moderation-secret` 保护；Node HTTP 后端接受运营会话或 `x-moderation-secret`，缺失或不匹配时返回 `401 UNAUTHENTICATED`。Node HTTP 后端额外校验 `GOODS_COMM_OPS_ACCOUNTS` 中的角色，`moderation` 处理审核，`support` 处理举报 / 争议，`notifications` 处理通知重试，`telemetry` 查询端侧事件和操作审计，`risk` 处理用户封禁 / 解封。
- `OPTIONS` 返回 CORS 预检响应，便于 H5 或网关调试；`allowedOrigins` / `GOODS_COMM_ALLOWED_ORIGINS` 可限制合法 Origin，未配置时本地开发默认 `*`。`pre/prod` 后端启动时拒绝空值或 `*`，非法 Origin 返回 HTTP `403` 和 `FORBIDDEN`。
- Node HTTP 后端按客户端 IP 执行基础进程内请求限流，默认 `GOODS_COMM_RATE_LIMIT_MAX_REQUESTS=300` / `GOODS_COMM_RATE_LIMIT_WINDOW_MS=60000`，超限返回 HTTP `429` 和 `TOO_MANY_REQUESTS`。服务位于 CloudBase、CDN、WAF 或负载均衡后方时，只有 `GOODS_COMM_TRUSTED_PROXY_IPS` 命中的直连代理才能提供 `x-forwarded-for`；未命中时后端忽略该头并按 socket 远端地址限流。该能力用于降低裸服务暴露风险，真实公网仍应叠加云网关 / WAF 限流。
- CORS 允许头包含 `x-moderation-secret`、`x-ops-session-token` 和 `x-ops-actor-id`，供受控 H5 / 内部运营入口调用运营接口。

## 13. Node HTTP 后端与部署产物

本仓库新增 `backend/` 后端项目：

- `backend/src/server.mjs`：Node HTTP 入口，支持 `/health`、`/health/ready`、业务接口和带密钥的审核回调接口，并返回统一 `traceId`、错误 `code` 和 HTTP 状态码。
- `backend/src/file-state-store.mjs`：本地 smoke 用文件状态存储，保证 HTTP 请求之间状态可持久化。
- `backend/src/postgres-state-store.mjs`：pre/prod 用 PostgreSQL 状态存储，将 BFF 状态读写到规范化表并用事务提交。
- `backend/src/local-object-store.mjs`：本地 smoke / 预发用对象存储适配器，支持 multipart 图片落盘和 `/assets/...` 读取。
- `backend/src/content-safety.mjs`：服务端内容安全适配器，dev/test 使用 mock，pre/prod 使用微信内容安全并禁止 mock。
- `backend/src/region-resolver.mjs`：服务端区域解析适配器，dev/test 使用样例数据，pre/prod 使用腾讯地图并禁止 mock。
- `backend/db/schema.sql`：生产数据库 DDL。
- `backend/deploy/Dockerfile`：腾讯云 / 云托管容器构建入口。
- `scripts/build-backend.mjs`：生成 `dist/backend` 后端部署产物。
- `scripts/backend-artifact-smoke.mjs`：检查后端部署包中的 server、BFF、PostgreSQL store、schema、Dockerfile、启动脚本、artifact lockfile 和容器 `npm ci` 生产依赖安装步骤。

验证命令：

```bash
npm run smoke:backend
npm run smoke:postgres-store
npm run build:backend
npm run smoke:backend:artifact
```

生产要求：

- 文件状态存储只用于本地 smoke；`pre/prod` 必须使用 PostgreSQL / TencentDB 事务存储，并在真实数据库上验证主链路。
- `/health` 用于进程存活检查；`/health/ready` 会检查状态存储依赖，生产网关和发布平台应使用 readiness 判断是否可接流量。
- 本地对象存储和样例区域只用于本地 smoke；`pre/prod` 后端已禁止本地对象存储、mock 内容安全和 mock 区域解析，部署环境必须配置 COS、微信内容安全、腾讯地图 Key 和社区 / 街道网格数据。
- 小程序端 `VITE_API_BASE_URL` 必须指向 HTTPS 后端域名，并在微信 / 支付宝平台配置合法 request/upload 域名。
- 浏览器 / H5 调用时必须配置 `GOODS_COMM_ALLOWED_ORIGINS`，并与平台合法域名保持一致；小程序原生请求或服务端请求无 `Origin` 时不会被 CORS 拦截。
- 登录接口已提供真实微信 / 支付宝 code 换身份的后端适配入口；当前 `.env.*` 仍使用占位凭据，替换真实 AppID / AppSecret / 支付宝私钥后才能在 `pre/prod` 通过真实平台登录。
- `src/pages/ops/ops.vue` 提供轻量内部运营控制台，可用运营账号建立短期会话后处理待审商品、举报、争议和通知重试；生产发布仍建议放在受控 H5 / 内部后台域名，并继续补细粒度 RBAC、操作审计查询和客服后台导航。

HTTP 错误响应：

```json
{
  "code": "UNAUTHENTICATED",
  "message": "登录态无效，请重新登录",
  "trace": {
    "traceId": "trace_xxx",
    "durationMs": 12
  }
}
```

当前 Node 后端会按语义映射：

| 状态码 | code | 场景 |
| --- | --- | --- |
| `401` | `UNAUTHENTICATED` | token 缺失、过期、吊销或用户状态不可用 |
| `403` | `FORBIDDEN` | 非本人管理、购买自己商品、举报自己商品等权限问题 |
| `404` | `NOT_FOUND` | 接口、商品、交易不存在或不可公开访问 |
| `409` | `CONFLICT` | 重复发布、商品已锁定、状态流转冲突 |
| `422` | `VALIDATION_ERROR` | 参数缺失、定位质量不合格、内容审核不通过 |

每个响应都会带 `x-trace-id`；如果请求带合法 `x-trace-id`，后端会透传，便于端侧日志、网关日志和后端日志关联。
