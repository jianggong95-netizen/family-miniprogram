const config = require('./config');
const { q } = require('./db');

/**
 * wx.login 的 code 换 openid。
 * 开发模式（未配置 WX_APPID/WX_SECRET）下直接把 code 当作 openid，
 * 方便在没有微信凭证时本地联调。
 */
async function code2Session(code) {
  if (config.devMode) {
    return { openid: `dev_${code || 'devuser'}` };
  }
  const url =
    'https://api.weixin.qq.com/sns/jscode2session' +
    `?appid=${config.wxAppid}&secret=${config.wxSecret}` +
    `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.openid) {
    throw new Error(`微信登录失败: ${data.errmsg || '未知错误'}`);
  }
  return data;
}

/**
 * 鉴权中间件：要求已绑定成员的登录态（header: X-Token = openid）
 */
async function authRequired(req, reply) {
  const openid = req.headers['x-token'];
  if (!openid) {
    return reply.code(401).send({ code: 401, data: null, message: '未登录' });
  }
  const member = q.memberByOpenid.get(openid);
  if (!member) {
    return reply.code(401).send({ code: 401, data: null, message: '账号未绑定家庭成员' });
  }
  req.member = member;
}

/**
 * 宽松鉴权：只要有 openid 就挂到 req.openid（用于首次绑定/创建家庭）
 */
function openidOptional(req, reply, done) {
  const openid = req.headers['x-token'];
  if (openid) {
    const member = q.memberByOpenid.get(openid);
    if (member) {
      req.member = member;
    } else {
      req.openid = openid;
    }
  }
  done();
}

module.exports = { code2Session, authRequired, openidOptional };
