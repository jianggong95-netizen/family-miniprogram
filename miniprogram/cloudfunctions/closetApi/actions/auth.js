const { ok } = require('../lib/utils');
const { doc2member } = require('../lib/auth');

/**
 * auth.login：不再 code2Session，身份直接取 OPENID
 * 返回 {needBind, openid, member?, family?}（与原后端一致）
 */
async function login(event, ctx) {
  const res = await ctx.db
    .collection('members')
    .where({ openid: ctx.openid, is_active: 1 })
    .limit(1)
    .get();

  if (!res.data.length) {
    return ok({ needBind: true, openid: ctx.openid });
  }

  const member = doc2member(res.data[0]);
  const famRes = await ctx.db.collection('families').doc(member.family_id).get();
  const family = famRes.data ? { id: member.family_id, ...famRes.data } : null;
  if (family) delete family._id;

  return ok({ needBind: false, openid: ctx.openid, member, family });
}

module.exports = { 'auth.login': login };
