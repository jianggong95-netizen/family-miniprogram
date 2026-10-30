const { ok } = require('../lib/utils');

/** 联调验证：返回云函数上下文里的真实 OPENID */
async function ping(event, ctx) {
  return ok({ openid: ctx.openid, time: new Date().toISOString() });
}

module.exports = { 'system.ping': ping };
