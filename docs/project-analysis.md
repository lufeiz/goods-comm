# 当前项目全面分析

分析日期：2026-05-25  
补充更新：2026-05-29
项目路径：`/Users/lufeiz/Downloads/项目/codexProject/goods-comm`  
项目名称：`goods-comm` / 邻里旧货

生产化补充：逐项问题解决方案与本轮落地状态见 `docs/production-hardening-plan.md`；BFF / 云函数接口契约见 `docs/api-contract.md`。

## 一、项目定位

这是一个基于 `uni-app + Vue 3` 的微信、支付宝双端通用小程序。业务目标是让同一社区或街道内的用户发布、浏览和交易二手物品，并通过 LBS 能力判断买家当前位置是否满足卖家设置的交易范围。

当前项目更接近 MVP/演示版：页面、发布、列表、详情、交易意向、定位权限、LBS 校验、微信头像授权登录和双端构建流程已经具备；但数据、用户、交易、社区归属仍主要依赖客户端本地存储和本地样例数据，距离正式上线还有后端可信校验、账号体系、安全风控和运营能力需要补齐。

## 二、技术栈

| 类别 | 当前实现 |
| --- | --- |
| 跨端框架 | `uni-app` |
| 前端框架 | `Vue 3` |
| 构建工具 | `Vite 5` + `@dcloudio/vite-plugin-uni` |
| 目标平台 | `mp-weixin`、`mp-alipay`，同时保留 `h5` 构建脚本 |
| 包管理 | `npm`，依赖锁定在 `package-lock.json` |
| 状态/数据 | 未引入状态管理库，使用页面本地状态 + `uni.setStorageSync` |
| LBS 坐标 | `gcj02` |
| 权限能力 | `getLocation`、`chooseLocation`、`openSetting`、微信 `chooseAvatar`、平台 `login` |
| 测试 | 自定义 smoke，覆盖领域层、service、BFF、Fetch 适配器和真实 HTTP 后端主链路 |
| 远端配置 | `VITE_API_BASE_URL` 指向 BFF / 云函数网关 |

核心依赖：

```json
{
  "@dcloudio/uni-app": "3.0.0-5000720260410001",
  "@dcloudio/uni-mp-weixin": "3.0.0-5000720260410001",
  "@dcloudio/uni-mp-alipay": "3.0.0-5000720260410001",
  "vue": "^3.4.0",
  "vite": "5.2.8"
}
```

## 三、目录结构

```text
goods-comm/
├── docs/
│   ├── architecture.md
│   └── project-analysis.md
├── scripts/
│   ├── build-weixin.mjs
│   └── smoke.mjs
├── src/
│   ├── components/
│   │   ├── EligibilityTag.vue
│   │   ├── GoodCard.vue
│   │   └── LocationGuard.vue
│   ├── config/
│   │   └── app.js
│   ├── data/
│   │   ├── regions.js
│   │   └── seed.js
│   ├── domain/
│   │   └── eligibility.js
│   ├── pages/
│   │   ├── detail/
│   │   ├── home/
│   │   ├── mine/
│   │   ├── orders/
│   │   └── publish/
│   ├── services/
│   │   ├── auth.js
│   │   ├── goods.js
│   │   ├── location.js
│   │   └── platform.js
│   ├── utils/
│   │   └── geo.js
│   ├── App.vue
│   ├── main.js
│   ├── manifest.json
│   ├── pages.json
│   └── uni.scss
├── package.json
├── vite.config.js
└── README.md
```

### 关键模块职责

- `src/pages.json`：页面注册、TabBar、导航栏样式。
- `src/manifest.json`：小程序名称、权限声明、微信/支付宝平台配置。
- `src/config/app.js`：应用名称、坐标类型、默认社区/街道交易半径。
- `src/utils/geo.js`：坐标归一化、Haversine 距离计算、距离格式化。
- `src/domain/eligibility.js`：交易资格纯领域逻辑，不依赖小程序运行时。
- `src/services/location.js`：定位权限、当前位置获取、区域解析、交易资格编排。
- `src/services/goods.js`：商品列表、发布商品、交易意向，本地存储实现。
- `src/services/auth.js`：平台登录、微信头像授权、用户信息缓存。
- `src/services/platform.js`：平台名称、设置页、Toast 的薄封装。
- `src/components/LocationGuard.vue`：定位状态展示和刷新/选择位置入口。
- `src/components/GoodCard.vue`：商品卡片和距离展示。
- `src/components/EligibilityTag.vue`：资格校验状态标签。

## 四、页面与路由

| 页面 | 路径 | 职责 |
| --- | --- | --- |
| 集市 | `pages/home/home` | 商品列表、搜索、分类、刷新定位、距离排序、进入详情 |
| 发布 | `pages/publish/publish` | 填写商品、选择交易范围、定位当前位置、发布商品 |
| 交易 | `pages/orders/orders` | 查看已经发起的交易意向 |
| 我的 | `pages/mine/mine` | 登录/退出、定位状态、交易规则和隐私说明 |
| 详情 | `pages/detail/detail` | 商品详情、交易资格校验、举报、发起交易 |

TabBar 当前包含：`集市`、`发布`、`交易`、`我的`。详情页不是 TabBar 页面，通过列表点击进入。

## 五、核心业务流程

### 1. 浏览附近商品

```text
进入集市页
  -> onShow 加载商品
  -> 静默刷新当前位置
  -> LocationGuard 展示当前定位状态
  -> listGoods 根据关键词、分类、当前位置过滤和排序
  -> GoodCard 展示价格、范围和距离
  -> 点击商品进入详情页
```

实现要点：

- 商品来源为 `services/goods.js`，初始数据来自 `data/seed.js`。
- 如果存在当前位置，列表会计算每个商品与当前位置的距离，并按距离升序排序。
- 如果没有授权定位，则距离文案显示为“授权后看距离”。

### 2. 刷新定位与区域解析

```text
点击刷新
  -> ensureLocationPermission
     -> 已授权：继续
     -> 未授权：调用 uni.authorize 拉起授权
     -> 已拒绝：返回 LOCATION_DENIED
  -> uni.getLocation({ type: 'gcj02', isHighAccuracy: true, geocode: true })
  -> 解析 name/address
  -> resolveCurrentRegion
     -> 远端 API 可用：通过 requestApi 请求 /lbs/resolve-region
     -> dev/test 远端 API 不可用或失败：回落本地样例区域
     -> pre/prod 远端 API 不可用或失败：直接报错，不使用样例区域
  -> 缓存 goods.lastLocationProfile
  -> 页面展示中文位置描述
```

当前定位刷新不会再自动打开位置选择器。`选择`按钮仍保留，用于用户主动选择校验位置或发布位置。

### 3. 发布商品

```text
进入发布页
  -> 刷新当前位置
  -> 填写名称、价格、分类、成色、描述
  -> 选择交易范围：同社区 / 同街道
  -> 调整允许距离
  -> submit
     -> 校验标题、价格、当前位置
     -> 读取登录用户缓存
     -> publishGoods 写入 goods.items
     -> 回到集市页
```

发布时保存的关键字段：

- `tradeScope.type`：`community` 或 `street`
- `tradeScope.radiusMeters`：允许交易半径
- `location.latitude/longitude`：发布时当前位置或选择位置
- `location.communityId/streetId`：当前解析出的社区/街道编码
- `seller.nickname/avatarUrl/contact`：来自登录缓存；未登录会在提交前被阻断并提示去“我的”页登录

### 4. 详情页交易资格校验

```text
进入详情页
  -> getGoodsItem 读取商品
  -> verifyTradeEligibility
     -> 读取缓存位置或刷新位置
     -> 计算买家到卖家距离
     -> 校验社区/街道 ID 是否匹配
     -> 校验距离是否在范围内
  -> 展示可交易/暂不可交易
  -> 发起交易
     -> 若未通过：弹窗说明原因
     -> 若通过：本地模式写入 goods.trades，远端模式调用 /trades 并由 BFF 重算资格
```

资格判断的核心规则位于 `src/domain/eligibility.js`：

- 没有物品：`ITEM_NOT_FOUND`
- 没有当前位置：`LOCATION_REQUIRED`
- 卖家位置缺失：`ITEM_LOCATION_MISSING`
- 坐标无效：`LOCATION_INVALID`
- 距离超出：`OUT_OF_RANGE`
- 当前位置行政区无法解析：`REGION_UNKNOWN`
- 社区/街道不匹配：`REGION_MISMATCH`
- 通过：`ELIGIBLE`

### 5. 微信/支付宝登录

当前登录实现分平台处理：

- 微信端：
  - 页面按钮使用 `open-type="chooseAvatar"`。
  - 用户选择头像后调用 `loginWithUserInfo`。
  - 内部再调用 `uni.login({ provider: 'weixin' })` 获取当前微信会话 code。
  - 用户缓存版本为 `5`，旧缓存会自动失效。
  - 昵称输入使用 `type="nickname"`，未填时回退为“社区用户”。
- 支付宝端：
  - 使用 `loginWithPlatformProfile`。
  - 先 `uni.login({ provider: 'alipay' })`，再获取平台用户资料。

注意：当前已有 `/auth/login`、`/auth/logout`、`/auth/delete-account` 契约和端侧退出/注销入口，BFF 示例也会维护 session、只保存 `tokenHash`、拒绝过期 token；退出登录会吊销当前 session，账号注销会吊销该用户所有 session。但没有真实后端 `code2Session`，所以微信端只能拿到登录 code，不能在客户端直接可信地产生 OpenID。正式用户身份需要服务端完成 code 换 session，并将用户与 session 持久化。

### 6. 交易意向

```text
详情页发起交易
  -> 必须通过最终 GPS 资格校验
  -> 创建 pending_seller_confirm 交易意向并锁定商品
  -> 卖家确认后进入 pending_meetup，才生成并展示本次交易的一次性联系码
  -> 可取消、完成或发起争议
  -> 完成后买卖双方可各评价一次
  -> 交易页 fetchTradeIntents 读取并展示
```

当前交易状态已覆盖 `pending_seller_confirm`、`pending_meetup`、`cancelled`、`completed`、`disputed`。详情页会按商品状态和当前用户身份禁用交易入口，已锁定商品显示交易处理中，已售商品显示已售出，自己的商品显示自己的物品；交易页在待确认阶段会明确提示“卖家确认后生成一次性联系码”，确认、完成、取消、争议等关键状态操作都会先二次确认；交易创建、确认、完成、取消、争议、争议处理和评价会写入站内通知，交易页能展示通知并标记已读；Node HTTP 后端会在事务内创建平台通知 outbox，事务提交后交给平台通知适配器，dev/test 用 mock，pre/prod 要求微信订阅消息，失败记录可通过 ops 接口查询和重试；发布、交易创建、交易状态更新、评价和举报已带 `Idempotency-Key`，重复提交会回放首次成功结果，不会重复追加商品、交易时间线或通知，联系码过期后的重复交易创建和交易确认重放也会脱敏；争议会生成开放工单，客服可裁决为释放商品、确认完成或下架商品；运营侧已补统一待处理队列、举报处理接口、用户封禁 / 解封、操作审计查询和轻量内部运营控制台，可用具名运营账号建立短期会话，把举报处理为确认违规或驳回误报，可处理待审商品、争议、用户风控和通知重试；完成交易后买卖双方可提交 1 到 5 星、标签和 200 字内评价，服务端拒绝未完成交易评价和重复评价；卖家上下架也受商品状态约束，不能手动绕过交易锁定、已售或风控下架状态。HTTP 后端 smoke 已验证登录、区域解析、发布、幂等发布回放、列表、发起交易、卖家确认幂等重放、联系码过期后重复创建 / 幂等重放脱敏、运营会话登录、运营队列、举报处理、用户封禁 / 解封、操作审计、争议裁决、完成售出、通知收件箱、平台通知 mock 投递、失败查询/重试、交易评价和退出登录主链路。仍没有支付、物流、真实微信订阅消息模板 ID 和完整独立客服后台。

## 六、数据模型概览

### GoodsItem

```js
{
  id,
  title,
  price,
  category,
  condition,
  description,
  seller: {
    id,
    nickname,
    avatarUrl
  },
  images,
  tradeScope: {
    type,
    label,
    radiusMeters
  },
  location: {
    latitude,
    longitude,
    communityId,
    communityName,
    streetId,
    streetName,
    scopeType,
    radiusMeters
  },
  status, // pending_review / online / reserved / sold / removed
  reviewStatus,
  createdAt
}
```

### LocationProfile

```js
{
  cacheVersion,
  location: {
    latitude,
    longitude,
    name,
    address,
    accuracy,
    capturedAt
  },
  region,
  displayName,
  displayAddress,
  source,
  error,
  updatedAt
}
```

### TradeIntent

```js
{
  id,
  itemId,
  itemTitle,
  price,
  seller,
  buyer,
  status,
  contactCode, // pending_meetup 后才返回
  eligibilityCode,
  eligibilityMessage,
  timeline,
  locationAudit: {
    source,
    capturedAt,
    accuracy,
    distanceMeters,
    radiusMeters,
    scopeType,
    regionStatus
  },
  createdAt
}
```

### TradeReview

```js
{
  id,
  tradeId,
  itemId,
  itemTitle,
  reviewer,
  reviewee,
  rating, // 1-5
  content, // <= 200 字
  tags,
  createdAt
}
```

## 七、构建与产物

`package.json` 中定义的主要脚本：

```bash
npm run dev:weixin
npm run dev:alipay
npm run build:weixin
npm run build:alipay
npm run build:h5
npm run build:backend
npm run smoke
npm run smoke:backend
```

当前构建产物目录：

- 微信：`dist/build/mp-weixin`
- 支付宝：`dist/build/mp-alipay`
- 后端：`dist/backend`

微信构建使用 `scripts/build-weixin.mjs` 包了一层：

1. 先构建到 `/private/tmp/goods-comm-mp-weixin-build`。
2. 再复制到 `dist/build/mp-weixin`。
3. 复制时跳过 `project.config.json`，避免覆盖微信开发者工具中已有 AppID。

当前检查到微信产物 AppID 为：

```text
wx17450fc9a94221e4
```

项目约束：不要修改 `project.config.json` 里的 AppID。

## 八、当前主要风险

### 1. 部署态 LBS 可信校验仍未落地

当前已补 `src/bff/handler.js`、`src/bff/fetch-adapter.js` 和 `backend/src/region-resolver.mjs`，区域解析统一走 API 边界；公开列表、发布商品和发起交易都会校验定位时间和精度，拒绝只带任意经纬度的探测式列表请求；发布商品时 HTTP 后端会根据坐标重算社区/街道并覆盖客户端传来的区域字段；公开商品响应只返回社区/街道等展示字段，带当前位置列表请求时由 BFF 计算 `distanceMeters`，不向端侧暴露卖家精确坐标；发起交易时 BFF 会先校验买家定位的经纬度、时间和精度，再重新解析买家位置、重算距离和社区/街道归属，并写入位置审计。pre/prod 会拒绝 mock 区域解析。真实上线仍必须把后端部署到云函数 / BFF runtime，接真实腾讯地图 Key 与社区网格，否则只停留在本地可执行契约。

建议优先级：P0。

### 2. 社区/街道归属已具备服务端适配器，但真实网格仍缺

`src/data/regions.js` 只有上海静安、黄浦附近的样例区域，并通过粗略经纬度范围兜底展示“北京市当前位置”或“上海市当前位置”。这能改善演示体验，但不能支撑真实社区/街道交易。当前后端已新增腾讯地图逆地址解析适配器，并支持用 `GOODS_COMM_MAP_REGION_DATASET` 把地图返回的行政区 / 街道映射为内部稳定编码；剩余问题是还没有真实腾讯地图 Key 和生产社区 / 街道网格数据。

建议优先级：P0。

### 3. 没有后端账号体系

微信端当前通过 `wx.login` code 表示当前会话，但没有服务端 `code2Session`，因此没有稳定可信的 `openid/unionid`。本地 `authUser.id` 不能作为正式用户 ID。

建议优先级：P0。

### 4. 本地/内存状态导致数据不可共享

端侧已经抽出远端 API 模式，BFF handler 也模拟了用户、幂等记录、商品、交易、交易评价、举报、审核事件和账号注销状态；本轮新增 `backend/src/server.mjs` HTTP 后端、`backend/src/file-state-store.mjs` 文件持久化 store、`backend/src/postgres-state-store.mjs` PostgreSQL 规范化表 store，并新增 `backend/db/schema.sql` 作为 PostgreSQL / TencentDB 建库脚本。真实上线仍需要接入真实云数据库实例并跑连接级 smoke，否则备份、并发锁、性能和审计能力仍没有被真实环境证明。

建议优先级：P0。

### 5. 发布身份仍未接真实平台身份

当前发布页已经通过 `requireStoredAuthUser()` 强制登录，且要求发布位置能解析到社区/街道；BFF 发布接口也会从未过期、未吊销的 session token hash 绑定卖家，不接受客户端伪造 seller，并要求发布定位未过期、带精度、满足精度阈值，再重算发布位置归属。session token 已改为服务端随机生成，服务端只持久化基于 `GOODS_COMM_SESSION_SECRET` 的 HMAC-SHA256 `tokenHash`，pre/prod 缺真实会话密钥时会拒绝签发 session。运营侧已补用户封禁 / 解封，封禁会吊销 session、下架活跃发布并把相关活跃交易转入争议。但本地环境仍没有真实平台 AppID/AppSecret、云端 openid/unionid 验证和真实数据库连接验证。正式环境下，发布记录仍必须绑定服务端用户 ID，并经过服务端审核和归属校验。

发布后的展示也已经和审核状态对齐：接口返回 `pending_review` 时，发布页提示“已提交审核”并引导到“我的发布”；只有公开上架的商品才提示“已发布”并回到集市，避免待审商品在公开列表不可见造成误解。

建议优先级：P1。

### 6. 联系方式保护仍需升级

详情页已经不再提供交易前复制联系码入口；BFF 商品响应会脱敏卖家用户级联系码和精确发布坐标，交易对象在 `pending_seller_confirm` 时也不返回 `contactCode`。卖家确认后现在生成本次交易的一次性联系码和过期时间，过期、交易完成、取消或争议后清空。剩余风险是它仍不是完整 IM，真实生产最好继续升级为站内 IM 或平台安全沟通能力。

建议优先级：P1。

### 7. 图片与内容审核需要接真实基础设施

商品卡片和详情页已支持图片展示，发布页强制至少 1 张图片；远端模式走 `/uploads/items`；Node HTTP 后端已支持 multipart 图片字节落盘、返回 `storageKey` / `size` / `mimeType` / `checksum` / `traceId`，并可通过 `/assets/...` 读取，资源缺失会返回 `404 NOT_FOUND`；发布时 `uploaded` 图片必须匹配当前卖家的上传记录，不能复用其他账号上传或客户端伪造的已审核 URL；BFF 和本地演示路径都会拒绝违禁词提交和同名活跃商品重复发布，BFF 还支持 `pending_review`、按微信图片 `trace_id` 回调审核、举报对象/原因/权限校验、重复举报幂等、写请求幂等键回放、高风险举报下架并将活跃交易转入争议，以及运营处理举报后恢复误报商品或确认下架。HTTP 发布入口已把服务端区域解析和幂等重放放在外部文本内容安全之前，同一幂等键的成功发布、审核拒绝重放或冲突重用都不会重复调用外部文本审核。真实生产仍需要把本地对象存储适配器替换为 COS / CloudBase storage，配置微信异步回调、图片压缩和后台复核台。

建议优先级：P1。

### 8. 权限和定位失败状态已补服务层分类

当前不仅能处理拒绝授权和打开设置，还会在 `src/services/location.js` 中统一输出 `LOCATION_DENIED`、`LOCATION_SYSTEM_DISABLED`、`LOCATION_TIMEOUT`、`LOCATION_NETWORK_FAILED`、`LOCATION_LOW_ACCURACY`、`LOCATION_EXPIRED`、`LOCATION_INVALID`、`LOCATION_REGION_FAILED`、`LOCATION_UNSUPPORTED`、`LOCATION_CANCELLED` 等稳定错误码。`LocationGuard` 会展示定位来源、精度和相对刷新时间；service 层 smoke 已 mock 覆盖权限拒绝、系统定位关闭、超时、网络失败、取消选择、精度不足和成功定位。剩余风险是不同真机、微信/支付宝容器和系统版本的 `errMsg` 仍需设备矩阵验证。

建议优先级：P1。

### 9. 缺少完整测试体系

当前 smoke 已覆盖领域层、本地 service、远端 service、BFF 契约、Fetch 适配、PostgreSQL store 和 HTTP 后端主链路；微信、支付宝、H5 和后端构建也能通过。现在已新增 `scripts/verify-release-gate.mjs`、`scripts/page-contract-smoke.mjs` 和 `.github/workflows/ci.yml`，CI / 发布候选门禁会运行语法检查、完整 smoke、HTTP 后端 smoke、页面契约 smoke、三端四环境构建、迁移 / 部署 / 同步 plan 和生产审计报告。2026-05-29 续做时还完成了一次本地 H5 Browser 渲染 QA，覆盖桌面首屏、搜索交互和移动视口。剩余缺口是可纳入 CI 的页面交互自动化、真机定位、开发者工具导入和设备矩阵验证。

建议优先级：P1。

### 10. H5 构建存在但业务未针对 H5 适配

`build:h5` 脚本存在，且 service 层已补浏览器 geolocation 定位兜底；dev/test 没有小程序登录 API 时可以生成本地 H5 演示登录态，用于浏览器联调和 smoke。端侧也已补用户协议 / 隐私政策页面和关键动作协议门禁，pre/prod 后端会持久化登录协议确认事实。正式对公网开放 H5 仍不能依赖本地身份，pre/prod 后端会继续拒绝演示登录，后续需要接正式 OAuth/SSO、合法 H5 域名、平台隐私配置和更完整的浏览器交互回归。

建议优先级：P2。

## 九、可以优化的地方

### P0：上线前必须补齐

1. 部署服务端或云函数 BFF。
   - 当前已有 `src/bff/handler.js` 契约处理器和 `backend/src/server.mjs` Node HTTP 后端。
   - 下一步是部署 `dist/backend`，并接入平台 `code2Session`、数据库、地图服务、对象存储和内容安全。

2. 服务端重构 LBS 校验闭环。
   - 客户端只做展示和预校验。
   - 发起交易时服务端重新获取或验证位置。
   - 服务端使用地图服务和社区网格数据解析行政区。
   - 对 `accuracy` 过大的定位拒绝或要求重试。

3. 建立正式用户模型。
   - 使用 `openid/unionid/userId` 作为平台身份。
   - 支持头像、昵称、手机号或站内联系能力。
   - 区分游客、已登录、受限、封禁用户。

4. 数据持久化。
   - 商品、用户、交易意向迁移到数据库。
   - 本地存储只保留 token、定位缓存和轻量偏好。

### P1：提高可用性和可维护性

1. 完善 API 层生产能力。
   - 当前已有 `src/services/api.js`、`src/services/goods.js`、`src/services/auth.js`、`src/services/reports.js`。
   - Node HTTP 后端已补 `traceId`、错误 `code`、HTTP 状态码映射和端侧遥测上报 / ops 查询；下一步补统一告警和外部观测平台接入。

2. 提升定位体验。
   - 已区分权限拒绝、系统定位关闭、定位超时、网络失败、低精度、过期、坐标无效和区域解析失败。
   - 定位结果已展示来源、精度和最近刷新时间。
   - 对 `accuracy` 大于阈值的结果已提示重新定位；下一步补真机权限矩阵和可纳入 CI 的页面自动化。

3. 完善发布身份和卖家管理。
   - 保留当前发布前登录阻断。
   - 发布记录绑定服务端真实用户 ID。
   - 增加卖家编辑、下架、重新上架和违规处理。

4. 完善商品生命周期。
   - 草稿、待审核、上架、下架、已交易、违规下架。
   - 支持卖家编辑、删除、重新上架。

5. 完善交易运营闭环。
   - 当前已有 `pending_seller_confirm`、`pending_meetup`、`cancelled`、`completed`、`disputed`。
   - 当前已有站内通知收件箱、平台通知适配器、通知失败重试、争议工单裁决、举报处理接口、轻量运营控制台、操作审计查询和完成交易后的双方评价；下一步补真实微信订阅消息模板 ID、独立客服后台和异常交易风控。

6. 增加平台差异适配层。
   - 微信头像昵称能力和支付宝资料能力分开维护。
   - 把 `#ifdef` 集中到 service 或 adapter，减少页面内条件编译。

### P2：体验与工程质量优化

1. 引入更系统的测试。
   - 领域层单元测试。
   - service 层已 mock `uni` 覆盖主要权限和定位分支，并已完成一次本地 H5 Browser 渲染 QA；下一步补可纳入 CI 的页面交互自动化和真机矩阵。
   - 页面关键流程 E2E 或小程序端手工回归清单。

2. 增加类型约束。
   - 可以逐步迁移到 TypeScript，优先覆盖领域模型、接口 DTO 和 LBS 结果。

3. 优化 UI 组件复用。
   - 表单字段、按钮、卡片、状态标签可组件化。
   - 统一 token：颜色、间距、字号、边框半径。

4. 图片与媒体能力。
   - 当前已有端侧图片选择、展示、远端上传边界、Node HTTP 本地对象存储适配器和图片审核 `trace_id` 回调入口。
   - 下一步补图片压缩、预览删除细节、COS / CloudBase storage、微信回调配置和后台复核台。

5. 增加运营能力。
   - 搜索热词、分类管理、举报、黑名单、后台审核、数据看板。

## 十、推荐后续架构

```text
小程序端
  ├── 页面展示与交互
  ├── 获取定位与授权
  ├── 本地预校验和距离展示
  └── 调用 BFF

BFF / 云函数
  ├── 平台登录 code2Session
  ├── 用户与 token 管理
  ├── LBS 逆地理编码
  ├── 交易资格最终校验
  ├── 商品发布和审核
  └── 交易意向状态流转

数据层
  ├── users
  ├── auth_sessions
  ├── items
  ├── item_images
  ├── idempotency_records
  ├── trade_intents
  ├── trade_disputes
  ├── trade_reviews
  ├── location_audits
  ├── reports
  ├── moderation_events
  └── account_deletions
```

建议服务端核心表：

| 表 | 用途 |
| --- | --- |
| `users` | 平台用户、头像、昵称、状态 |
| `auth_sessions` | 登录 token、过期时间和吊销状态 |
| `items` | 商品主体、价格、范围、审核状态 |
| `item_images` | 商品图片 |
| `trade_intents` | 交易意向和状态流转 |
| `idempotency_records` | 写请求幂等键、请求哈希和首次成功响应回放 |
| `trade_disputes` | 交易争议工单、客服裁决和处理结果 |
| `trade_reviews` | 完成交易后的买卖双方评价 |
| `location_audits` | 定位校验记录、距离、精度、结果码 |
| `reports` | 举报和审核 |
| `moderation_events` | 内容审核事件 |
| `account_deletions` | 账号注销记录 |

## 十一、当前项目质量判断

### 优点

- 模块拆分清晰，`domain`、`services`、`pages`、`components` 边界基本明确。
- LBS 资格校验被放在纯函数中，后续迁移到服务端成本低。
- 微信和支付宝双端构建已跑通。
- 定位权限、位置刷新、位置选择、资格校验形成了闭环。
- 商品图片、发布区域和发布定位质量校验、交易定位质量校验、交易状态机、交易操作二次确认、交易评价、卖家上下架约束、举报、账号注销、联系码延迟展示、Fetch BFF 适配器和 Node HTTP 后端已经补齐主路径。
- 微信 AppID 有保护脚本，避免构建覆盖开发者工具配置。
- 页面 UI 比较克制，适合社区交易工具型产品。

### 短板

- 已新增可运行 Node HTTP 后端、数据库 DDL 和 PostgreSQL 规范化表 store，但仍没有真实云部署和云数据库实例。
- 社区/街道解析不具备生产可用性。
- 登录已有 session 契约、过期校验、注销吊销和运营封禁 / 解封，但还不是完整账号体系，仍缺真实平台 `code2Session` 和真实库连接验证。
- 商品、交易、用户无法跨设备共享。
- 交易流程已有轻量状态机、站内通知、平台通知 outbox / 重试、争议工单裁决、举报处理、用户封禁和交易评价，但缺真实微信订阅消息模板 ID 和完整运营后台 UI。
- 自动化测试覆盖范围偏窄。

## 十二、建议实施路线

### 第 1 阶段：让核心交易可信

1. 将现有 BFF handler / Fetch adapter 挂载到后端/云函数。
2. 接入微信/支付宝登录换取稳定用户 ID。
3. 服务端实现 `resolve-region`、`create-trade`、`create-report`、`delete-account`。
4. 发起交易时服务端重算距离和社区/街道。

### 第 2 阶段：让商品发布可运营

1. 商品入库。
2. 图片上传从本地对象存储适配器替换为 COS / CloudBase storage。
3. 审核状态接内容安全和后台复核。
4. 卖家管理自己的商品。
5. 举报和下架。

### 第 3 阶段：让交易流程闭环

1. 一次性联系码已补；下一步接站内联系或平台 IM。
2. 站内交易通知、平台通知适配器、失败重试和完成交易评价已补；下一步配置真实微信订阅消息模板 ID。
3. 争议工单裁决、运营队列、举报处理接口、用户封禁 / 解封、轻量运营控制台和操作审计查询已补；下一步做独立客服后台。
4. 异常交易自动风控规则。

### 第 4 阶段：提升工程能力

1. TypeScript 迁移。
2. 单元测试和页面流程测试。
3. 平台 adapter 收敛条件编译。
4. CI 已接 `npm run verify:release` 和页面契约 smoke，会构建微信、支付宝、H5 和后端产物并检查关键配置；下一步补可纳入 CI 的页面 E2E 和真机矩阵。

## 十三、验证记录

本次补充分析期间执行：

```bash
node --check src/bff/handler.js
node --check src/services/goods.js
node --check backend/src/postgres-state-store.mjs
npm run smoke
npm run smoke:bff
npm run smoke:bff:fetch
npm run smoke:postgres-store
npm run smoke:backend
npm run smoke:backend:env
npm run smoke:platform-auth
npm run smoke:storage-content
npm run smoke:region
npm run env:check
npm run db:migrate:plan -- --env pre
npm run deploy:backend:pre:plan
npm run build:backend
npm run build:weixin
npm run build:weixin:dev
npm run build:alipay
npm run build:h5:dev
```

结果：

```text
Smoke checks passed
BFF smoke checks passed
BFF fetch smoke checks passed
PostgreSQL normalized store smoke checks passed
Backend HTTP smoke checks passed
Backend environment guard checks passed
Platform auth smoke checks passed
Storage and content safety smoke checks passed
Region resolver smoke checks passed
Environment check passed for dev, test, pre, prod
Database migration plan for pre
Backend deployment plan for pre
Backend artifact built at dist/backend
DONE  Build complete.  # Weixin
DONE  Build complete.  # Weixin dev
DONE  Build complete.  # Alipay
DONE  Build complete.  # H5 dev
```

同时检查微信构建产物中的 AppID：

```text
wx17450fc9a94221e4
```

没有修改 `project.config.json`。
