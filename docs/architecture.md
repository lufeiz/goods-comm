# 社区二手交易小程序架构

## 目标

构建一套同时支持微信小程序和支付宝小程序的二手交易应用，让同一社区或街道内的用户发布、浏览、联系和发起线下交易。交易资格必须通过 LBS 判断：买家当前位置需要满足卖家设置的同社区或同街道范围。

## 端侧方案

- 技术栈：`uni-app + Vue 3`
- 编译目标：`mp-weixin`、`mp-alipay`
- 坐标系：使用 `gcj02`，便于国内地图服务和小程序地图能力一致
- 权限：在 `src/manifest.json` 中声明定位用途
- 端侧职责：
  - 展示商品、发布商品、展示交易意向
  - 获取当前位置
  - 本地计算距离和展示预校验结果
  - 调用服务端完成最终资格校验
- 远端配置：通过 `VITE_API_BASE_URL` 指向 BFF / 云函数网关；未配置时回落本地演示数据

## 核心领域模型

```text
GoodsItem
  id
  title
  price
  category
  seller
  tradeScope: community | street
  location:
    latitude
    longitude
    communityId
    streetId
    radiusMeters

UserLocation
  latitude
  longitude
  accuracy
  capturedAt

ResolvedRegion
  communityId
  communityName
  streetId
  streetName
  precision
```

## LBS 校验规则

1. 买家授权当前位置。
2. 服务端根据当前位置逆地理编码，得到社区和街道编码。
3. 读取物品发布位置和交易范围。
4. 计算当前位置到卖家发布位置的球面距离。
5. `同社区`：社区编码一致，并且距离小于等于物品半径。
6. `同街道`：街道编码一致，并且距离小于等于物品半径。
7. 校验通过才允许创建交易意向。

当前实现位于 `src/domain/eligibility.js`，页面和服务端都可以复用这套输入输出结构。

## BFF / 云函数入口

当前仓库提供两层可迁移实现：

- `src/bff/handler.js`：无依赖核心契约处理器，适合迁移到任意 Node / 云函数 runtime。
- `src/bff/fetch-adapter.js`：标准 `Request` / `Response` 适配器，适合 Fetch Runtime、边缘函数或本地 HTTP harness。
- `backend/src/server.mjs`：Node HTTP 后端入口，直接挂载同一套 BFF handler。
- `backend/src/file-state-store.mjs`：本地 / 预发 smoke 用文件持久化，生产环境应替换为数据库适配器。
- `backend/db/schema.sql`：PostgreSQL / TencentDB 建表与索引 DDL。
- `idempotency_records`：发布、交易、评价、举报等写请求的幂等键和首次成功响应回放，防止弱网重试重复产生业务副作用。
- `/ops/login`、`/ops/moderation-queue`、`/ops/reports/:id/resolve`、`/ops/users/:id/status`、`/ops/audit-events`、`/ops/notification-deliveries/retry` 和 `/moderation/disputes/:id/resolve`：运营侧登录、待处理队列、举报处理、用户封禁 / 解封、操作审计查询、通知重试和争议裁决接口；具名运营账号换取短期 token，微信回调和内部任务仍可用共享密钥保护；`src/pages/ops/ops.vue` 提供轻量内部运营控制台。

验证命令：

```bash
npm run smoke:bff
npm run smoke:bff:fetch
npm run smoke:backend
npm run build:backend
```

## 推荐后端接口

```http
POST /lbs/resolve-region
Content-Type: application/json

{
  "latitude": 31.22945,
  "longitude": 121.45494,
  "coordType": "gcj02"
}
```

```json
{
  "communityId": "sh-jingan-shimen",
  "communityName": "石门二路社区",
  "streetId": "sh-jingan-nanjingxi",
  "streetName": "南京西路街道",
  "precision": "community"
}
```

```http
POST /trades
Content-Type: application/json

{
  "itemId": "item_1001",
  "buyerLocation": {
    "latitude": 31.2301,
    "longitude": 121.4556,
    "accuracy": 35
  }
}
```

服务端应返回是否可交易、距离、原因码和交易意向 ID。

## 风控与隐私

- 不信任客户端传入的行政区字段，服务端必须重算。
- 限制定位精度过低的请求，例如 `accuracy > 200m` 时要求重新定位。
- 对同一用户短时间内频繁切换城市或异常坐标做风控。
- 前端只展示社区/街道名称，不展示卖家精确经纬度。
- 商品详情可展示近似距离，不展示坐标。
- 联系方式建议使用平台内 IM 或一次性联系码，避免公开手机号。
- 登录、发布、发起交易和举报前必须确认用户协议与隐私政策；当前端侧已提供协议页面和同意状态，pre/prod 登录会由服务端校验并持久化协议审计字段。真实上线前需要替换为法务审核后的正式文本并在平台后台完成隐私配置。

## 后续扩展

- 将现有 Node 后端部署到微信云托管或腾讯云，并在真实 TencentDB / PostgreSQL 上验证规范化表 state store。
- 使用已新增的腾讯地图区域解析适配器，接入真实腾讯地图 Key 和社区 / 街道网格数据做标准化。
- 继续完善图片压缩、自动黑名单规则、实名认证、真实订阅消息模板配置，并将当前轻量运营控制台升级为完整客服后台。
- 增加后台审核，过滤违禁品、重复发布和异常交易；现有写请求幂等只能防重复提交，不能替代运营风控。
