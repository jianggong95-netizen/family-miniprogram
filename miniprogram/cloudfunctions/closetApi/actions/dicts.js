const { ok, fail } = require('../lib/utils');
const { getMember } = require('../lib/auth');

const DICT_TYPES = ['category', 'color', 'season', 'location'];

/** dicts.get（对应 GET /api/dicts：按 dict_type 分组） */
async function getDicts(event, ctx) {
  const member = await getMember(ctx);
  if (member.__authFail) return fail('未登录', 401);

  const res = await ctx.db
    .collection('dicts')
    .where({ family_id: member.family_id })
    .orderBy('dict_type', 'asc')
    .orderBy('sort', 'asc')
    .limit(1000)
    .get();

  const grouped = { category: [], color: [], season: [], location: [] };
  res.data.forEach((d) => {
    if (!grouped[d.dict_type]) grouped[d.dict_type] = [];
    grouped[d.dict_type].push({ id: d._id, name: d.name });
  });
  return ok(grouped);
}

/** dicts.add（对应 POST /api/dicts：admin + 查重 + maxSort+1） */
async function addDict(event, ctx) {
  const member = await getMember(ctx);
  if (member.__authFail) return fail('未登录', 401);
  if (member.role !== 'admin') return fail('仅管理员可维护字典');

  const type = String(event.dict_type || '').trim();
  const name = String(event.name || '').trim();
  if (!DICT_TYPES.includes(type)) return fail('无效的字典类型');
  if (!name) return fail('请输入名称');

  const rows = await ctx.db
    .collection('dicts')
    .where({ family_id: member.family_id, dict_type: type })
    .limit(500)
    .get();

  if (rows.data.some((d) => d.name === name)) return fail('该名称已存在');
  const maxSort = rows.data.reduce((m, d) => Math.max(m, d.sort), -1);

  await ctx.db.collection('dicts').add({
    data: { family_id: member.family_id, dict_type: type, name, sort: maxSort + 1 },
  });
  return ok(true);
}

/** dicts.remove（对应 DELETE /api/dicts/:id：admin） */
async function removeDict(event, ctx) {
  const member = await getMember(ctx);
  if (member.__authFail) return fail('未登录', 401);
  if (member.role !== 'admin') return fail('仅管理员可维护字典');

  const id = String(event.id || '');
  const res = await ctx.db.collection('dicts').doc(id).get().catch(() => null);
  const row = res && res.data;
  if (!row || row.family_id !== member.family_id) return fail('字典项不存在');

  await ctx.db.collection('dicts').doc(id).remove();
  return ok(true);
}

module.exports = { 'dicts.get': getDicts, 'dicts.add': addDict, 'dicts.remove': removeDict };
