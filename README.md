# 家庭衣橱 · 微信小程序

全家衣服进销存 + 家庭小游戏合集的微信小程序：

- **衣橱管理**：按成员 / 种类 / 颜色 / 春夏秋冬分类，多图上传，入库、出库、借出、归还全流水可追溯，含看板与分析。
- **家庭小游戏**：五子棋（双人联机 / 人机）、俄罗斯方块、飞机大战、蹦蹦大陆、打牌积分、炸弹小子，管理员可按成员逐项授权开关。
- **学习小园地**：三年级语文 / 英语小练习（阅读理解、生字组词、英语单词）。

## 技术架构

- 前端：微信原生小程序（`miniprogram/`，4 个 tab：看板 / 衣橱 / 分析 / 我的）
- 后端：**微信云开发**——唯一云函数 `miniprogram/cloudfunctions/closetApi/`（action 路由网关），数据库为云开发 MongoDB 集合，图片存云存储
- 鉴权：openid 自动识别家庭成员；权限体系见 `docs/games.md`
- 历史方案（飞牛OS 自建后端 `backend/`、`deploy/`）**已废弃**，仅作存档，勿在其上改动

详细文档见 [docs/](docs/README.md)：架构、部署、游戏、学习园地。

## 项目结构

```
├── miniprogram/                  小程序前端（微信开发者工具打开此目录）
│   ├── pages/                    看板 / 衣橱 / 详情 / 新增编辑 / 我的 / 成员 / 设置 / 绑定 / 学习园地
│   ├── pages/games/              游戏大厅 + 各游戏页面（gomoku/tetris/plane/benben/score/bomber/perms）
│   ├── cloudfunctions/closetApi/ 唯一云函数（所有接口与数据库操作）
│   └── utils/                    request 封装 / perms 权限缓存 / config 云环境 ID
├── docs/                         架构 / 部署 / 游戏 / 学习园地文档
└── backend/ deploy/              旧自建后端遗留（已废弃）
```

## 快速上手

1. [微信公众平台](https://mp.weixin.qq.com) 注册小程序，拿到 `AppID`。
2. 开通**云开发**，创建环境，把环境 ID 填入 `miniprogram/utils/config.js` 的 `CLOUD_ENV_ID`。
3. 微信开发者工具导入 `miniprogram/` 目录，右键 `cloudfunctions/closetApi` → **上传并部署（云端安装依赖）**。
4. 小程序内进入「我的」页触发 `system.init` 初始化集合与种子数据（或按 `docs/deployment.md` 操作）。
5. 后台 → 成员管理 → 添加家人为**体验成员** → 上传代码设为体验版 → 家人扫码使用。
6. 家庭内使用建议只走体验版；正式版需 HTTPS + 备案域名，按需评估。

## 游戏一览

| 游戏 | 玩法 |
|---|---|
| 五子棋 | 创建房间双人对战 / 人机对战 |
| 俄罗斯方块 | 经典消除，下一块预览，消行闪光，背景音乐 |
| 飞机大战 | 10 大闯关，波次编队 / 关底 BOSS，道具升级，激光大招 |
| 蹦蹦大陆 | 横屏平台跳跃，动态摇杆，踩怪 / 顶箱 / 吃星币 / 连杀 |
| 打牌积分 | 创建房间牌友各自加入，点人加减分，日志实时同步 |
| 炸弹小子 | 竖屏炸弹人闯关：放弹 / 十字爆 / 链爆 / 炸砖掉道具，全灭怪物后进入 🚪 出口过关 |

游戏音效与背景音乐均为 WebAudio 实时合成，关卡图形为 Canvas 矢量绘制，**零外部资源文件**。

## License

**全公开（[The Unlicense](LICENSE)，公有领域）。**

To the extent possible under law, the authors of this project dedicate all copyright and related or neighboring rights to it to the public domain. Anyone may copy, modify, distribute, and use this code, for any purpose, commercial or otherwise, without attribution, under any terms they like.
