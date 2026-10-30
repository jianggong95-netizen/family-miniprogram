const { ok, fail, now } = require('../lib/utils');
const { getMember, doc2member } = require('../lib/auth');

/** member.bind：把当前微信绑定到未绑定成员（对应 PUT /api/members/:id/bind） */
async function bindMember(event, ctx) {
  const id = String(event.id || '');
  const targetRes = await ctx.db.collection('members').doc(id).get().catch(() => null);
  const target = targetRes && targetRes.data ? doc2member(targetRes.data) : null;
  if (!target || target.is_active !== 1) return fail('成员不存在');
  if (target.openid) return fail('该成员已被绑定，请联系管理员');

  const occupied = await ctx.db
    .collection('members')
    .where({ openid: ctx.openid, is_active: 1 })
    .count();
  if (occupied.total) return fail('当前微信已绑定其他成员');

  await ctx.db.collection('members').doc(id).update({ data: { openid: ctx.openid } });
  const updated = await ctx.db.collection('members').doc(id).get();
  return ok(doc2member(updated.data));
}

/** member.add：管理员/成员添加家庭成员（对应 POST /api/members） */
async function addMember(event, ctx) {
  const member = await getMember(ctx);
  if (member.__authFail) return fail('未登录', 401);

  const name = String(event.name || '').trim();
  if (!name) return fail('请输入成员名字');

  const res = await ctx.db.collection('members').add({
    data: {
      family_id: member.family_id, name, openid: '',
      role: 'member', is_active: 1, created_at: now(),
    },
  });
  const created = await ctx.db.collection('members').doc(res._id).get();
  return ok(doc2member(created.data));
}

/** member.update：本人改名 / admin 改角色与停用（对应 PUT /api/members/:id） */
async function updateMember(event, ctx) {
  const me = await getMember(ctx);
  if (me.__authFail) return fail('未登录', 401);

  const id = String(event.id || '');
  const tRes = await ctx.db.collection('members').doc(id).get().catch(() => null);
  const target = tRes && tRes.data ? doc2member(tRes.data) : null;
  if (!target || target.family_id !== me.family_id) return fail('成员不存在');

  const isSelf = target.id === me.id;
  const isAdmin = me.role === 'admin';
  if (!isSelf && !isAdmin) return fail('没有权限');

  const body = event.data || {};
  let name = target.name;
  let role = target.role;
  let isActive = target.is_active;
  if (body.name !== undefined) name = String(body.name).trim() || target.name;
  if (isAdmin && body.role !== undefined) role = body.role === 'admin' ? 'admin' : 'member';
  if (isAdmin && body.is_active !== undefined) isActive = body.is_active ? 1 : 0;

  await ctx.db.collection('members').doc(id).update({
    data: { name, role, is_active: isActive },
  });
  const updated = await ctx.db.collection('members').doc(id).get();
  return ok(doc2member(updated.data));
}

module.exports = {
  'member.bind': bindMember,
  'member.add': addMember,
  'member.update': updateMember,
};
