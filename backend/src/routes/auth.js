const { code2Session } = require('../auth');
const { q } = require('../db');
const { ok, fail } = require('../utils');

/**
 * POST /api/auth/login
 * body: { code }  （wx.login 返回的 code）
 * 返回：needBind=false 时带 member+family；needBind=true 时只带 openid
 */
async function login(req, reply) {
  const { code } = req.body || {};
  if (!code) {
    return reply.send(fail('缺少 code'));
  }
  try {
    const session = await code2Session(code);
    const openid = session.openid;
    const member = q.memberByOpenid.get(openid);
    if (!member) {
      return reply.send(ok({ needBind: true, openid }));
    }
    const family = q.familyById.get(member.family_id);
    return reply.send(ok({ needBind: false, openid, member, family }));
  } catch (e) {
    return reply.send(fail(e.message || '登录失败'));
  }
}

module.exports = async function authRoutes(app) {
  app.post('/api/auth/login', login);
};
