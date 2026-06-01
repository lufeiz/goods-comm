# goods-comm 数据库边界设计

更新日期：2026-05-31

本文件用于把 `src/bff/handler.js` 的内存状态和 `backend/src/file-state-store.mjs` 的本地文件状态迁移成真实数据库。核心原则：客户端只提交意图，身份、审核、位置裁决、交易状态必须由服务端持久化并在事务中更新。可执行 PostgreSQL / TencentDB DDL 已放在 `backend/db/schema.sql`。

四套环境数据库要求：

- `dev`、`test`、`pre`、`prod` 分别使用独立数据库连接串，见 `.env.dev`、`.env.test`、`.env.pre`、`.env.prod`。
- `pre` 与 `prod` 拓扑和 schema 必须一致，但必须是两套不同数据库。
- `prod` 数据支持自动或手动同步到 `pre`，同步入口为 `scripts/sync-prod-to-pre.mjs`；恢复到 `pre` 后会执行 `backend/db/pre-sync-anonymize.sql` 脱敏和吊销 session。
- 每次发布前先在 `pre` 连接 `goods_comm_pre` 验证，验证通过后再发布 `prod`。

当前后端已提供 PostgreSQL 事务边界：`backend/src/postgres-state-store.mjs` 会把 BFF 状态读写到下方规范化实体表，让 `pre/prod` 不再依赖文件 store 或单行 JSON 快照。需要注意：当前 store 仍以“加载完整状态 -> 在事务内写回规范化表”的桥接模式运行，不是最终的按聚合根增量 SQL 仓储；写事务会先获取 `GOODS_COMM_POSTGRES_ADVISORY_LOCK_KEY` 对应的 PostgreSQL transaction-level advisory lock，确保多实例 snapshot rewrite 不会并发覆盖。为避免真实数据规模超出该桥接模式的安全范围，`GOODS_COMM_POSTGRES_MAX_SNAPSHOT_ROWS` 默认限制为 `20000`；超过限制时写事务会失败，`/health/ready` 也会失败，并要求先迁移到增量 SQL 写入。`pre/prod` 还要求 `GOODS_COMM_POSTGRES_AUTO_SCHEMA=false`：schema 必须先由 `npm run db:migrate:pre` / `npm run db:migrate:prod` 显式初始化；后端 readiness 会检查 `schema_migrations`、所需基线迁移记录、所有规范化表和关键列是否齐全，防止迁移漏跑或漏列时启动探针误通过，并返回当前行数、限制、auto schema 状态和 snapshot write lock 类型。`bff_state_snapshots` 只保留为早期测试部署的迁移桥，新的部署不应写入该表。

本地 `FileStateStore` 和 PostgreSQL store 的事务语义保持一致：普通业务 callback 抛错时回滚，不保存部分状态。少数必须留痕但仍对客户端返回错误的业务拒绝，例如商品发布内容安全拒绝，会通过显式 `commitStateOnError` 标记提交 `moderation_events` 后继续返回错误，避免不同 store 对审核审计产生分叉。

## 1. 表清单

### `schema_migrations`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | string | 迁移版本，当前必需记录包括 `20260531_normalized_schema`、`20260531_auth_session_last_seen`、`20260531_location_risk_events`、`20260531_location_risk_review` 和 `20260531_account_deletion_tombstone` |
| `name` | string | 迁移名称 |
| `checksum` | string | 当前 schema 基线标识，后续可替换为真实文件校验值 |
| `source` | string | 迁移来源文件 |
| `applied_at` | datetime | 首次应用时间 |

`backend/db/schema.sql` 会创建该表并插入 `20260531_normalized_schema`、`20260531_auth_session_last_seen`、`20260531_location_risk_events`、`20260531_location_risk_review` 与 `20260531_account_deletion_tombstone`。`pre/prod` 后端 readiness 不只检查业务表和列，还会检查这些迁移记录，避免目标库停在旧 schema 或手工补表但未执行正式迁移。

### `users`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 业务用户 ID |
| `provider` | enum | `weixin` / `alipay` |
| `platform_id` | string | 微信 openid / 支付宝 user_id，服务端 code 换取 |
| `union_id` | string | 微信 unionid / 平台跨应用身份，缺失时为空 |
| `nickname` | string | 展示昵称 |
| `avatar_url` | string | 头像 |
| `contact_code` | string | 站内联系码或一次性联系码 |
| `status` | enum | `active` / `deleted` / `blocked` |
| `agreement_version` | string | 最近确认的用户协议 / 隐私政策版本 |
| `agreement_accepted_at` | datetime nullable | 最近确认协议时间 |
| `agreement_source` | string | 协议确认来源，如 `mine` / `legal:terms` / smoke |
| `block_reason` | string | 最近一次封禁原因 |
| `blocked_at` | datetime nullable | 最近一次封禁时间 |
| `blocked_by` | string | 最近一次封禁操作人 |
| `unblock_reason` | string | 最近一次解封原因 |
| `unblocked_at` | datetime nullable | 最近一次解封时间 |
| `unblocked_by` | string | 最近一次解封操作人 |
| `created_at` | datetime | 创建时间 |
| `deleted_at` | datetime nullable | 注销时间 |

索引：

- unique(`provider`, `platform_id`)
- index(`status`)
- partial index(`agreement_version`) where not empty

`pre/prod` 登录时服务端会要求新用户或未确认当前版本协议的用户提交当前 `agreement_version` 和 `agreement_accepted_at`，并把确认事实写入 `users` 表，避免只依赖端侧本地存储作为合规证据。

账号注销会保留 `users.id` 作为交易、评价和审计关联 tombstone，但会把 `platform_id` 改写为 `deleted_<hash>`、清空 `union_id`、昵称、头像和联系码；`20260531_account_deletion_tombstone` 迁移也会 backfill 已有 `deleted` 用户；后续同一平台身份登录会命中该 tombstone 并返回账号不可用，避免重新创建同 ID 用户或恢复已注销账号。

运营端可通过 `/ops/users/:id/status` 将用户调整为 `blocked` 或恢复为 `active`。封禁会吊销该用户所有 session、下架其活跃发布、把相关活跃交易转入争议，并写入 `moderation_events` 与 `ops_audit_events`。

### `auth_sessions`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | session ID |
| `user_id` | string / uuid | 业务用户 ID |
| `token_hash` | string | 基于 `GOODS_COMM_SESSION_SECRET` 的 HMAC-SHA256 token 哈希，生产环境不保存明文 token |
| `provider` | enum | `weixin` / `alipay` |
| `created_at` | datetime | 创建时间 |
| `expires_at` | datetime | 过期时间 |
| `revoked_at` | datetime nullable | 吊销时间 |
| `last_seen_at` | datetime nullable | 最近使用时间 |

索引：

- unique(`token_hash`)
- index(`user_id`, `expires_at`)
- index(`revoked_at`)

### `idempotency_records`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 幂等记录 ID |
| `scope` | string | 幂等作用域，当前为 `user:<user_id>` 或 `system` |
| `idempotency_key` | string | 端侧 / 调用方提交的幂等键 |
| `method` | string | HTTP 方法 |
| `path` | string | 请求路径 |
| `request_hash` | string | 方法、路径和请求体的稳定哈希 |
| `status` | enum/string | `completed` 表示成功响应已记录；`committed_error` 表示业务拒绝已提交审计并应回放首次错误 |
| `response` | json | 首次成功响应快照，或 `committed_error` 的错误消息快照，用于重复请求回放 |
| `created_at` | datetime | 首次创建时间 |
| `updated_at` | datetime | 最近更新时间 |
| `expires_at` | datetime nullable | 幂等记录过期时间，当前 BFF 默认 24 小时 |

索引：

- unique(`scope`, `idempotency_key`)
- index(`expires_at`)

当前端侧 service 会给发布商品、发起交易、交易状态变更、评价、举报等写请求生成 `Idempotency-Key`。服务端重复收到同一用户同一键且请求哈希一致的请求时，直接回放首次成功响应；同一键用于不同请求时返回 `409 CONFLICT`。

### `items`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 商品 ID |
| `seller_id` | string / uuid | 卖家用户 ID |
| `title` | string | 标题 |
| `price` | decimal | 售价 |
| `category` | string | 分类 |
| `condition` | string | 成色 |
| `description` | text | 描述 |
| `status` | enum | `pending_review` / `online` / `reserved` / `sold` / `removed` |
| `review_status` | enum | `pending_media_review` / `approved_auto` / `rejected` / `reported_removed` / `seller_deleted` |
| `review_reasons` | json | 审核原因 |
| `trade_scope_type` | enum | `community` / `street` |
| `trade_scope_radius_meters` | integer | 交易半径 |
| `latitude` | decimal | 卖家发布坐标，仅服务端使用 |
| `longitude` | decimal | 卖家发布坐标，仅服务端使用 |
| `community_id` | string | 服务端解析的社区编码 |
| `street_id` | string | 服务端解析的街道编码 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |

索引：

- index(`seller_id`, `created_at`)
- index(`status`, `category`, `created_at`)
- index(`community_id`, `status`)
- index(`street_id`, `status`)

### `item_images`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 图片 ID |
| `item_id` | string / uuid | 商品 ID |
| `owner_id` | string / uuid | 上传者 ID |
| `url` | string | CDN 地址 |
| `storage_key` | string | 对象存储 key |
| `original_name` | string | 用户上传原文件名 |
| `mime_type` | string | 图片 MIME |
| `size_bytes` | integer | 图片字节大小 |
| `checksum` | string | SHA-256 校验值 |
| `moderation_trace_id` | string | 微信异步图片审核 `trace_id`，用于回调定位图片 |
| `status` | enum | `uploaded` / `pending_review` / `approved` / `rejected` |
| `sort_order` | integer | 展示顺序 |
| `created_at` | datetime | 创建时间 |

索引：

- index(`item_id`, `sort_order`)
- index(`owner_id`, `created_at`)
- partial index(`moderation_trace_id`) where not empty

### `trade_intents`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 交易意向 ID |
| `item_id` | string / uuid | 商品 ID |
| `seller_id` | string / uuid | 卖家 ID |
| `buyer_id` | string / uuid | 买家 ID |
| `price_snapshot` | decimal | 发起交易时价格快照 |
| `status` | enum | `pending_seller_confirm` / `pending_meetup` / `completed` / `cancelled` / `disputed` |
| `contact_code_snapshot` | string | 卖家确认后生成的本次交易一次性联系码 |
| `contact_code_expires_at` | datetime nullable | 一次性联系码过期时间；交易进入完成、取消或争议时清空 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |

索引：

- index(`buyer_id`, `created_at`)
- index(`seller_id`, `created_at`)
- index(`item_id`, `status`)
- unique(`item_id`, `buyer_id`, `status`) 需按数据库能力实现“同一买家同一商品仅一个活跃交易”

### `trade_timeline`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 时间线 ID |
| `trade_id` | string / uuid | 交易 ID |
| `status` | enum | 流转后的交易状态 |
| `actor_id` | string / uuid | 操作人 |
| `label` | string | 展示文案 |
| `created_at` | datetime | 发生时间 |

索引：

- index(`trade_id`, `created_at`)

当前 `backend/src/postgres-state-store.mjs` 会从交易对象的 `timeline` 数组同步写入本表；`trade_intents.timeline` JSONB 字段仅作为兼容冗余。

### `trade_disputes`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 争议工单 ID |
| `trade_id` | string / uuid | 争议交易 ID |
| `item_id` | string / uuid | 商品 ID |
| `opener_id` | string / uuid nullable | 发起争议或触发风控的用户 |
| `source` | enum/string | `user` / `report` / `moderation` |
| `reason` | string | 争议原因或举报原因 |
| `description` | text | 用户补充说明或系统触发说明 |
| `report_id` | string nullable | 高风险举报触发时关联举报 ID |
| `status` | enum | `open` / `resolved` |
| `resolution` | enum/string | `release_item` / `complete_trade` / `remove_item` |
| `resolution_note` | text | 客服处理说明 |
| `resolver_id` | string / uuid nullable | 客服或后台处理人 |
| `item_title` | string | 商品标题快照 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |
| `resolved_at` | datetime nullable | 处理时间 |

索引：

- index(`trade_id`)
- index(`status`, `created_at`)
- partial unique(`trade_id`) where `status = 'open'`

当前 `backend/src/postgres-state-store.mjs` 会在用户发起争议、高风险举报或内容安全拒绝时写入本表；客服处理通过 `/moderation/disputes/:id/resolve` 事务化更新工单、交易、商品和通知。

### `trade_reviews`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 评价 ID |
| `trade_id` | string / uuid | 已完成交易 ID |
| `item_id` | string / uuid | 商品 ID |
| `reviewer_id` | string / uuid | 评价人，只能是买家或卖家 |
| `reviewee_id` | string / uuid | 被评价人，为交易对手方 |
| `item_title` | string | 商品标题快照 |
| `rating` | integer | 1 到 5 星 |
| `content` | text | 评价正文，当前限制 200 字 |
| `tags` | json | 评价标签 |
| `created_at` | datetime | 创建时间 |

索引：

- unique(`trade_id`, `reviewer_id`)
- index(`item_id`, `created_at`)
- index(`reviewee_id`, `created_at`)

当前 `backend/src/postgres-state-store.mjs` 会把完成交易后的评价写入本表；prod 同步到 pre 后会清空评价正文和标签，保留结构性状态用于预上线验证。

### `location_audits`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 审计 ID |
| `trade_id` | string / uuid | 交易 ID |
| `user_id` | string / uuid | 被校验用户 |
| `source` | enum | `server` / `gps` |
| `latitude` | decimal | 买家发起交易坐标 |
| `longitude` | decimal | 买家发起交易坐标 |
| `accuracy` | decimal nullable | GPS 精度 |
| `distance_meters` | decimal | 买卖双方距离 |
| `radius_meters` | integer | 规则半径 |
| `scope_type` | enum | `community` / `street` |
| `region_status` | enum | `match` / `mismatch` / `unknown` |
| `created_at` | datetime | 校验时间 |

索引：

- index(`trade_id`)
- index(`user_id`, `created_at`)

当前 `backend/src/postgres-state-store.mjs` 会从交易对象的 `locationAudit` 同步写入本表；`trade_intents.location_audit` JSONB 字段仅作为兼容冗余。

### `location_risk_events`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 位置风控事件 ID |
| `user_id` | string / uuid | 被审计用户 |
| `action` | string | 触发动作，当前为 `item_publish` / `trade_create` |
| `target_type` | string | 关联对象类型 |
| `target_id` | string | 关联对象 ID |
| `latitude` | decimal nullable | 服务端内部使用的本次定位纬度，公开响应不返回 |
| `longitude` | decimal nullable | 服务端内部使用的本次定位经度，公开响应不返回 |
| `accuracy` | decimal nullable | GPS 精度 |
| `region_community_id` | string | 服务端解析后的社区 ID |
| `region_street_id` | string | 服务端解析后的街道 ID |
| `captured_at` | datetime | 端侧定位采集时间 |
| `previous_event_id` | string nullable | 上一次同用户位置事件 |
| `distance_meters` | decimal nullable | 与上一次位置事件的距离 |
| `elapsed_ms` | integer nullable | 与上一次位置事件的时间差 |
| `speed_mps` | decimal nullable | 推算移动速度 |
| `risk_level` | enum/string | `normal` / `high` |
| `risk_code` | string | 风险码，例如 `IMPOSSIBLE_TRAVEL` |
| `review_status` | enum/string | `not_required` / `pending_review` / `confirmed_risk` / `false_positive` / `escalated` |
| `resolution` | string | 复核结论，通常等于 `review_status` |
| `resolution_note` | string | 复核说明，prod 同步到 pre 时会清空 |
| `reviewer_id` | string | 运营复核账号，prod 同步到 pre 时会清空 |
| `reviewed_at` | datetime nullable | 复核时间 |
| `created_at` | datetime | 服务端记录时间 |
| `updated_at` | datetime | 最近复核更新时间 |

索引：

- index(`user_id`, `created_at`)
- index(`risk_level`, `created_at`)
- partial index(`risk_code`, `created_at`) where `risk_code <> ''`
- index(`review_status`, `created_at`)

发布商品和发起交易成功后会写入该表。若同一用户 30 分钟内出现超过阈值的远距离高速切换，服务端会额外写一条脱敏 `client_events(type=location_risk, level=warn)`，供运营排障和风控复核；该机制先审计不拦截，避免真机定位漂移造成主链路误伤。高风险事件默认进入 `pending_review`，`20260531_location_risk_review` 迁移也会把尚未复核且无处理记录的历史高风险行 backfill 为 `pending_review`；运营可通过 `/ops/location-risk-events/:id/review` 标记为确认风险、误报关闭或升级处理，并写入 `ops_audit_events`。prod 同步到 pre 时会清空经纬度、精度、区域、速度、复核说明和复核账号字段，只保留结构性风险状态。

### `notifications`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 通知 ID |
| `user_id` | string / uuid | 收件用户 ID |
| `type` | enum/string | 通知类型，例如 `trade_created` / `trade_confirmed` / `trade_completed` / `trade_cancelled` / `trade_disputed` / `trade_dispute_resolved` / `trade_reviewed` |
| `title` | string | 通知标题 |
| `body` | string | 通知正文 |
| `target_type` | enum/string | 关联对象类型，当前主要为 `trade` |
| `target_id` | string / uuid | 关联对象 ID |
| `read_at` | datetime nullable | 已读时间，空值表示未读 |
| `created_at` | datetime | 创建时间 |

索引：

- index(`user_id`, `created_at`)
- partial index(`user_id`, `read_at`) where unread

### `notification_deliveries`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 平台通知投递记录 ID |
| `notification_id` | string / uuid | 关联站内通知 ID |
| `user_id` | string / uuid | 收件用户 ID |
| `type` | enum/string | 通知类型，与 `notifications.type` 对齐 |
| `provider` | enum/string | `mock` / `wechat` |
| `status` | enum/string | `pending` / `sent` / `mock_sent` / `failed` / `skipped` |
| `message` | text | 投递结果或失败原因 |
| `target_type` | enum/string | 关联对象类型，当前主要为 `trade` |
| `target_id` | string / uuid | 关联对象 ID |
| `attempt_count` | integer | 已尝试投递次数 |
| `trace_id` | string | 最近一次触发投递的请求 traceId |
| `last_attempt_at` | datetime nullable | 最近一次尝试时间 |
| `next_retry_at` | datetime nullable | 下一次可自动 / 手动重试时间 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |

索引：

- index(`status`, `next_retry_at`, `updated_at`)
- index(`notification_id`)

当前 Node HTTP 后端会在交易事务内创建 `pending` 投递记录；事务提交后调用平台通知适配器并回写投递状态。失败记录可通过 `/ops/notification-deliveries/retry` 重试。

### `reports`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 举报 ID |
| `reporter_id` | string / uuid | 举报人 |
| `target_type` | enum | `item` / `user` / `trade` |
| `target_id` | string / uuid | 被举报对象 |
| `reason` | enum | `prohibited` / `fraud` / `privacy` / `other` |
| `description` | text | 补充说明 |
| `status` | enum | `pending_review` / `resolved` / `rejected` |
| `resolution` | enum/string | `uphold_report` / `dismiss_report` |
| `resolution_note` | text | 运营处理说明 |
| `resolver_id` | string / uuid nullable | 处理人 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |
| `resolved_at` | datetime nullable | 处理时间 |

索引：

- index(`target_type`, `target_id`, `created_at`)
- index(`status`, `created_at`)
- index(`reporter_id`, `created_at`)
- unique(`reporter_id`, `target_type`, `target_id`, `reason`, `status`) 需按数据库能力实现“同一用户同一目标同一原因仅一个待处理举报”

### `moderation_events`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 审核事件 ID |
| `actor_id` | string / uuid nullable | 提交用户或审核操作人；系统审核来源不一定对应业务用户，可为空 |
| `target_type` | enum | `item_submission` / `item_image` / `item` / `report` |
| `target_id` | string nullable | 关联对象 ID，可为空 |
| `status` | enum | `pending_media_review` / `approved_auto` / `rejected` |
| `reasons` | json | 命中规则或审核原因 |
| `created_at` | datetime | 创建时间 |

索引：

- index(`actor_id`, `created_at`)
- index(`target_type`, `target_id`)
- index(`status`, `created_at`)

当前 `backend/src/postgres-state-store.mjs` 只在 `actor_id` 对应真实用户时写入外键；微信图片审核、云函数 worker 或后台系统账号这类非业务用户 actor 会落为 `NULL`，避免系统事件破坏用户表外键约束。

### `client_events`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 端侧事件 ID |
| `type` | string | 事件类型，如 `location_profile_failed` / `publish_submit_failed` |
| `level` | enum/string | `debug` / `info` / `warn` / `error` |
| `code` | string | 业务错误码或定位错误码 |
| `message` | text | 脱敏后的错误信息 |
| `route` | string | 端侧页面路由 |
| `user_id` | string / uuid nullable | 可识别用户；登录前事件可为空 |
| `platform` | string | 微信小程序 / 支付宝小程序 / H5 |
| `app_env` | string | dev / test / pre / prod |
| `trace_id` | string | 端侧或网关 trace |
| `context` | json | 脱敏后的排障上下文 |
| `created_at` | datetime | 发生时间 |

索引：

- index(`created_at`)
- index(`type`, `level`, `created_at`)
- index(`user_id`, `created_at`)

端侧上报时会过滤 token、密钥、联系方式、精确地址和经纬度，避免把隐私数据写入排障日志。运营可通过 `/ops/client-events` 查询最近端侧错误。

### `ops_audit_events`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 运营操作审计 ID |
| `actor_id` | string | 运营账号 ID；共享密钥调用会使用 `x-ops-actor-id` 或 `ops-shared-secret` |
| `action` | string | 操作类型，如 `ops.login` / `ops.report.resolve` / `ops.item.review` / `ops.dispute.resolve` / `ops.notification.retry` |
| `target_type` | string | 操作对象类型，如 `report` / `item` / `media` / `dispute` / `notification_delivery` |
| `target_id` | string | 操作对象 ID |
| `result` | string | `success` 或后续扩展的失败状态 |
| `message` | string | 脱敏后的操作摘要 |
| `trace_id` | string | 网关 trace |
| `source` | string | `session` / `account` / `shared-secret` |
| `context` | json | 脱敏后的操作上下文，如处理结论、幂等键和角色 |
| `created_at` | datetime | 创建时间 |

索引：

- index(`created_at`)
- index(`actor_id`, `created_at`)
- index(`action`, `created_at`)

运营登录、举报处理、商品 / 图片复核、争议裁决和通知重试会写入本表。`prod` 同步到 `pre` 后会清空 `trace_id`、`message` 和 `context`，保留动作、对象和时间用于预发排障。

### `account_deletions`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string / uuid | 注销记录 ID |
| `user_id` | string / uuid | 用户 ID |
| `reason` | string | 用户选择或客服记录的原因 |
| `created_at` | datetime | 注销时间 |

索引：

- unique(`user_id`)
- index(`created_at`)

## 2. 必须事务化的操作

1. 创建交易：校验商品 `online`、校验 LBS、创建 `trade_intents`、写入 `location_audits` 和 `location_risk_events`、商品置为 `reserved`、给卖家写 `notifications` 和 `notification_deliveries`。
2. 交易确认：交易置为 `pending_meetup`、生成一次性联系码、写 `trade_timeline`、给买家写 `notifications` 和 `notification_deliveries`。
3. 交易完成：交易置为 `completed`、清空一次性联系码、商品置为 `sold`、写 `trade_timeline`、`notifications` 和 `notification_deliveries`。
4. 交易取消：交易置为 `cancelled`、清空一次性联系码、若无其他活跃交易则商品回到 `online`、写 `trade_timeline`、`notifications` 和 `notification_deliveries`。
5. 高风险举报：创建 `reports`、商品置为 `removed`、活跃交易置为 `disputed`、清空一次性联系码、写 `moderation_events`、`trade_timeline`、`notifications` 和 `notification_deliveries`。
6. 争议创建：用户发起争议、高风险举报或内容安全拒绝时，交易置为 `disputed`、清空一次性联系码、创建 `trade_disputes`、写 `trade_timeline`、`notifications` 和 `notification_deliveries`。
7. 争议处理：校验工单 `open` 且交易仍为 `disputed`，按裁决结果把交易改为 `cancelled` 或 `completed`，商品恢复 `online`、变为 `sold` 或下架为 `removed`，写 `trade_disputes`、`trade_timeline`、`notifications` 和 `notification_deliveries`。
8. 交易评价：校验交易已完成、评价人属于该交易、同一交易同一评价人未评价，写 `trade_reviews`，并给对方写 `notifications` 和 `notification_deliveries`。
9. 账号注销：用户置为 `deleted`、伪匿名化 `platform_id`、清空 `union_id` / 昵称 / 头像 / 联系码、吊销 `auth_sessions`、下架用户活跃商品、取消用户活跃交易、匿名化该用户历史评价快照、写 `account_deletions`，并拒绝同一平台身份重新登录。
10. 退出登录：只吊销当前 `auth_sessions` 记录，不影响同一用户的其他有效 session。
11. 幂等写请求：执行业务写入和 `idempotency_records` 响应快照必须处于同一事务；成功请求记录 `completed`，已提交审计的业务拒绝记录 `committed_error`；重复请求不能再次追加商品、交易时间线、站内通知、审核事件或平台通知 outbox。请求身份不包含服务端注入的 `serverRegion` 和 `moderation` 字段，发布重试应在外部内容安全调用前先命中幂等重放。
12. 举报处理：运营通过 `uphold_report` 或 `dismiss_report` 处理 `pending_review` 举报；确认违规时下架商品并把活跃交易转争议，驳回误报时只在没有活跃 / 争议交易阻塞时恢复 `reported_removed` 商品为 `online`，同时写 `reports` 处理字段、`moderation_events` 和 `ops_audit_events`。
13. 客户端遥测与位置风控：端侧登录、定位、发布、交易、举报等失败事件写入 `client_events`；发布和交易的可信定位使用会写入 `location_risk_events`，短时间远距离跳变会额外生成脱敏 `client_events(type=location_risk)`。这些记录不参与交易事务裁决，但必须脱敏、可供运营排障查询，并能复核关闭或升级处置。

## 3. 服务端不变量

- 商品卖家只能来自 token 绑定用户，不能来自客户端 payload。
- 同一卖家同名 `pending_review`、`online`、`reserved` 商品不能重复创建。
- token 必须命中未过期、未吊销的 `auth_sessions`，且用户状态为 `active`。
- 同一作用域同一 `Idempotency-Key` 只能绑定一个方法、路径和请求体哈希；重复请求必须回放首次成功响应或首次 `committed_error` 错误，不得重复产生业务副作用。
- 退出登录后当前 token 必须立即失效；账号注销后该用户所有 token 必须立即失效。
- 创建交易前必须校验买家定位经纬度、`captured_at` 和 `accuracy`；过期或低精度定位不能创建交易。
- 商品发布坐标只供服务端解析区域、计算距离和交易裁决使用；公开商品响应不能返回卖家精确经纬度、POI 名称或详细地址。
- 公开列表只返回 `online` 商品；公开详情不返回 `pending_review` 或 `removed` 商品。
- `sold` 商品不能重新上架。
- `reserved` 商品不能被卖家手动下架或上架，必须由交易取消、完成或争议流程驱动。
- `reported_removed`、`seller_deleted`、`rejected` 等风控 / 审核状态不能被卖家手动重新上架。
- 买家不能购买自己发布的商品。
- 只有完成交易的买卖双方可以评价，且同一交易同一评价人只能评价一次。
- 用户不能举报自己发布的商品；举报原因、举报对象类型和目标状态必须由服务端校验。
- 同一用户、同一目标、同一原因的待处理举报必须幂等，不能重复追加风控记录。
- 每条 `pending_review` 举报必须能进入运营队列并被处理为 `resolved` 或 `rejected`，处理结果必须记录 `resolution`、处理人、处理时间和说明。
- `pre/prod` 禁止运行时自动建表；readiness 必须检查规范化表和关键列，缺表返回 `schema is not migrated`，缺列返回 `schema is outdated`，避免旧库漏迁移后在写请求中才失败。
- 高风险举报导致商品下架时，该商品的活跃交易必须进入 `disputed`，不能继续确认或完成。
- 同一交易只能存在一个开放争议工单；争议裁决后交易不能继续停留在 `disputed`。
- 每条需要平台通知的站内通知必须先创建一条 `notification_deliveries` outbox 记录；投递失败只能影响投递状态，不能回滚已提交的交易事实。
- 客户端遥测不能保存 token、密钥、联系方式、精确地址、经纬度或平台 openid/unionid。
- 同一商品同一买家只能有一个活跃交易。
- LBS 裁决以服务端解析的社区、街道和距离为准。
