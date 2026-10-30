# 家庭衣橱 · 架构设计（微信云开发版）

> 版本 v2.0 · 2026-10-02 · 部署环境：微信云开发 · 使用范围：仅家人

## 一、架构总览

项目最初为「飞牛OS 自建 Node 后端 + 局域网 HTTP + 体验版」（见 [history/architecture-v1-自建后端.md](history/architecture-v1-自建后端.md)），
已于 2026-10 整体迁移到**微信云开发**：不再有服务器、IP、域名、隧道等运维负担，正式版小程序即可直接发布使用。

```
┌────────────────────────────────────────────┐
│ 微信小程序（家人手机 · 正式版/体验版均可）        │
│ 看板/衣橱/分析/我的 · 游戏 · 学习小园地          │
└───────┬────────────────────────┬───────────┘
        │ wx.cloud.callFunction  │ wx.cloud.uploadFile
┌───────▼───────────┐    ┌───────▼───────────┐
│ 云函数 closetApi    │    │ 云存储             │
│ 网关式 action 路由   │    │ 衣服图片 fileID     │
│ （39 个接口）        │    │ （临时链接换取）      │
├───────────────────┤    └───────────────────┘
│ 云数据库（8 集合）    │
│ families/members/… │
└───────────────────┘
```

**技术栈**：微信原生小程序（WXML/WXSS/JS）+ wx-server-sdk 云函数 + 云数据库（文档型）+ 云存储。

## 二、关键设计决策

### 1. 单云函数网关（closetApi）

所有业务接口收敛为一个云函数 `cloudfunctions/closetApi`，按 `event.action` 分发（见 [index.js](../miniprogram/cloudfunctions/closetApi/index.js) 的 ROUTES 表）：

- 只需部署/更新**一个**云函数，免得多函数间版本漂移
- 统一返回契约 `{ code, data, message }`，`code=0` 成功、`401` 未绑定（前端自动跳绑定页）
- 各业务模块在 `actions/*.js`：auth / family / member / clothes / stock / stats / report / dicts / files / system / init / gomoku / score / game

### 2. 鉴权：身份只信云函数上下文

- 云函数内 `cloud.getWXContext().OPENID` 是唯一可信身份，**前端传参一律不可信**（[lib/auth.js](../miniprogram/cloudfunctions/closetApi/lib/auth.js)）
- `auth.login` 用 openid 查 `members` 集合：查到返回成员+家庭；查不到返回 `needBind: true`，前端跳 `pages/bind/bind` 创建家庭或输邀请码加入
- 无 token、无 session，绑定即登录

### 3. 数据模型（云数据库集合）

| 集合 | 用途 | 关键字段 |
|---|---|---|
| families | 家庭 | name, invite_code |
| members | 成员 | family_id, openid, name, role(admin/member), is_active, **game_perms** |
| clothes | 衣服 | family_id, owner_id, name, category/color/season/size…, quantity, status |
| clothing_images | 图片 | clothing_id, fileID(云存储), is_cover, sort |
| stock_records | 进销存流水 | clothing_id, type(入库/出库/借出/归还/转赠/清理), quantity, operator_id |
| dicts | 自定义字典 | family_id, dict_type, name（新家庭自动播种种子字典，见 [lib/db.js](../miniprogram/cloudfunctions/closetApi/lib/db.js)） |
| gomoku_rooms | 五子棋联机房间 | code(4位), host/guest{openid,name}, moves[], turn, status, host_ready/guest_ready |
| score_rooms | 打牌记分房间 | code, players[], scores, logs[], status |

> 注意：云数据库 ID 为字符串 `_id`，业务代码中**不要**对 id 做 `Number()` 转换。

### 4. 图片：云存储 + 云函数换临时链接

- 上传：`wx.cloud.uploadFile` 直传云存储，记录 fileID
- 展示：fileID 换 https 临时链接走云函数 `system.tempUrls`（云函数有管理员权限，**不受存储"仅创建者可读写"限制**，家庭成员互相可见图片——这是踩过的坑，勿改回前端直连换链）
- 前端 [utils/request.js](../miniprogram/utils/request.js) 的 `imageFileUrl()` 带 100 分钟缓存与并发去重（临时链接约 2 小时过期）

### 5. 实时同步（联机游戏）

见 [games.md](games.md)：数据库 watch 监听 + 1 秒轮询兜底 + 本地乐观渲染。

## 三、前端结构

```
miniprogram/
├── app.js / app.json / app.wxss     # 4 个 tab：看板/衣橱/分析/我的
├── cloudfunctions/closetApi/        # 唯一云函数（网关）
├── utils/
│   ├── config.js                    # CLOUD_ENV_ID（换环境只改这里）
│   ├── request.js                   # call(action,data) 封装 + 图片换链
│   └── perms.js                     # 游戏/学习权限查询（60s 缓存）
├── services/api.js                  # 全部业务接口方法
├── components/                      # clothing-card / filter-bar
└── pages/
    ├── dashboard/ closet/ report/ mine/   # tab 页
    ├── bind/        # 首次进入：创建家庭/邀请码加入
    ├── detail/ edit/ members/ settings/   # 衣服详情/编辑/成员/字典
    ├── games/       # 游戏大厅 + gomoku/tetris/plane/score/perms
    └── study/       # 学习小园地（题库 data.js）
```

## 四、权限体系（管理员授权）

- `members.game_perms` 存每个成员对 5 个项目（gomoku/tetris/plane/score/study）的开关，默认全开
- 云函数 `game.getPerms` / `game.setPerm`（仅 admin 可改）；前端各游戏页 `onLoad` 用 `perms.check()` 守卫，禁用项在大厅显示「已禁用」
- 管理入口：游戏大厅底部「游戏权限管理」（仅管理员可见）

## 五、遗留与边界

- `backend/`、`deploy/`、`deploy.sh`、`one-click-deploy.sh`、`update_ip.py` 等为 **v1 自建后端时代遗留**，云开发版不再使用，仅作历史参考（新改动不要提交到这些文件）
- 云开发环境 ID 在 `utils/config.js`；免费额度对家庭场景（7 人内）绰绰有余
- 学习小园地积分存本机 `wx.setStorageSync('study_score')`，不跨设备同步（刻意设计，避免云端集合污染）
