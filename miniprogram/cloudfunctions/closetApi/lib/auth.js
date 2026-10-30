/**
 * 鉴权（复刻 backend/src/auth.js 的 authRequired / openidOptional）
 * 身份一律取云函数上下文 OPENID，前端传参不可信。
 */
const { fail } = require('./utils');

/** 取当前登录成员（对应 authRequired）；未登录/未绑定返回 {__authFail:true} */
async function getMember(ctx) {
  const res = await ctx.db
    .collection('members')
    .where({ openid: ctx.openid, is_active: 1 })
    .limit(1)
    .get();
  if (!res.data.length) {
    return { __authFail: true };
  }
  return doc2member(res.data[0]);
}

function doc2member(d) {
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
}

/** 云数据库集合名与工具 */
module.exports = { getMember, doc2member, fail };
