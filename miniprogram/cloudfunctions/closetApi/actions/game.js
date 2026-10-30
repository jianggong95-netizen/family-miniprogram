const { ok, fail } = require('../lib/utils');
const { getMember } = require('../lib/auth');

// 可授权项目（家庭小游戏 + 学习小园地）
const GAME_KEYS = ['gomoku', 'tetris', 'plane', 'benben', 'bomber', 'score', 'study'];

function normalizePerms(p) {
  const out = {};
  GAME_KEYS.forEach((k) => { out[k] = !(p && p[k] === false); }); // 默认全部开放
  return out;
}

/** game.getPerms：任意成员查自己的权限；管理员可带全员列表 */
async function getPerms(event, ctx) {
  const me = await getMember(ctx);
  if (me.__authFail) return fail('未登录', 401);

  const res = await ctx.db
    .collection('members')
    .where({ family_id: me.family_id, is_active: 1 })
    .limit(100)
    .get();
  const isAdmin = me.role === 'admin';

  const items = res.data.map((m) => ({
    id: m._id,
    name: m.name,
    role: m.role,
    perms: normalizePerms(m.game_perms),
  }));
  const mine = items.find((m) => m.id === me.id) || { perms: normalizePerms(null) };

  return ok({ isAdmin, perms: mine.perms, members: isAdmin ? items : undefined });
}

/** game.setPerm：仅管理员，为某成员开/关某个项目的权限 */
async function setPerm(event, ctx) {
  const me = await getMember(ctx);
  if (me.__authFail) return fail('未登录', 401);
  if (me.role !== 'admin') return fail('只有管理员可以管理权限');

  const key = String(event.key || '');
  if (!GAME_KEYS.includes(key)) return fail('未知项目');
  const id = String(event.id || '');

  const tRes = await ctx.db.collection('members').doc(id).get().catch(() => null);
  if (!tRes || !tRes.data || tRes.data.family_id !== me.family_id) return fail('成员不存在');

  const perms = Object.assign({}, tRes.data.game_perms || {});
  perms[key] = !!event.allowed;
  await ctx.db.collection('members').doc(id).update({ data: { game_perms: perms } });
  return ok(true);
}

module.exports = {
  'game.getPerms': getPerms,
  'game.setPerm': setPerm,
};
