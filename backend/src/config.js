const path = require('path');

/**
 * 全局配置
 * 所有路径均可通过环境变量覆盖（docker-compose 中配置）
 */
const config = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'closet.db'),
  imagesDir: process.env.IMAGES_DIR || path.join(__dirname, '..', 'images'),

  // 微信小程序凭证（登录鉴权用）
  // 未配置时进入开发模式：wx.login 的 code 直接当作 openid，方便本地调试
  wxAppid: process.env.WX_APPID || '',
  wxSecret: process.env.WX_SECRET || '',
  get devMode() {
    return !(this.wxAppid && this.wxSecret);
  },
};

module.exports = config;
