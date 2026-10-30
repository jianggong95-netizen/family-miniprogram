# 文档索引

| 文档 | 内容 | 什么时候看 |
|---|---|---|
| [architecture.md](architecture.md) | 现行架构（微信云开发版 v2.0）：云函数网关、数据模型、鉴权、图片、权限体系 | 理解项目全貌、改代码前 |
| [deployment.md](deployment.md) | 部署指南：环境 ID、云函数上传、`system.init` 初始化、发布体验版/正式版、故障排查 | 首次部署、云函数改动后、线上出问题时 |
| [games.md](games.md) | 家庭小游戏：管理员授权、五子棋联机同步、打牌记分、飞机大战、新增授权项目步骤 | 做游戏相关需求时 |
| [study.md](study.md) | 学习小园地（三年级）：四大模块、玩法机制、加题指南 | 扩充题库时 |
| [history/architecture-v1-自建后端.md](history/architecture-v1-自建后端.md) | 历史存档：飞牛OS + 局域网自建后端架构（已废弃） | 追溯旧方案时 |

## 项目速览

- 小程序前端：`miniprogram/`（原生小程序，4 tab：看板/衣橱/分析/我的）
- 唯一云函数：`miniprogram/cloudfunctions/closetApi/`（action 路由，39 个接口）
- 旧自建后端遗留：`backend/`、`deploy/`、`deploy.sh` 等——**已不再使用，勿在其上改动**
- 云开发环境 ID：`miniprogram/utils/config.js` → `CLOUD_ENV_ID`
