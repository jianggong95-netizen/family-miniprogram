const { ok, daysAgoStr } = require('../lib/utils');
const { getMember } = require('../lib/auth');

/**
 * stats.overview（对应 GET /api/stats/overview）
 * 家庭数据量小：取全量未删衣服 + 近 30 天流水，内存分组统计。
 */
async function overview(event, ctx) {
  const member = await getMember(ctx);
  if (member.__authFail) return fail401();

  const familyId = member.family_id;

  const clothesRes = await ctx.db
    .collection('clothes')
    .where({ family_id: familyId, deleted_at: ctx._.exists(false) })
    .limit(1000)
    .get();
  const clothes = clothesRes.data;

  const totalPieces = clothes.reduce((s, c) => s + (c.quantity || 0), 0);
  const statusMap = {};
  const seasonMap = {};
  const categoryMap = {};
  const colorMap = {};
  const ownerMap = {};
  clothes.forEach((c) => {
    statusMap[c.status] = (statusMap[c.status] || 0) + 1;
    if (c.season) seasonMap[c.season] = (seasonMap[c.season] || 0) + 1;
    if (c.category) categoryMap[c.category] = (categoryMap[c.category] || 0) + 1;
    if (c.color) colorMap[c.color] = (colorMap[c.color] || 0) + 1;
    ownerMap[c.owner_id] = (ownerMap[c.owner_id] || 0) + 1;
  });

  const topN = (map, field, n) =>
    Object.entries(map)
      .map(([k, cnt]) => ({ [field]: k, cnt }))
      .sort((a, b) => b.cnt - a.cnt)
      .slice(0, n);

  const byCategory = topN(categoryMap, 'category', 8);
  const byColor = topN(colorMap, 'color', 8);
  const bySeason = Object.entries(seasonMap).map(([season, cnt]) => ({ season, cnt }));

  // by_owner：active 成员 + 计数，按 cnt 降序
  const memRes = await ctx.db
    .collection('members')
    .where({ family_id: familyId, is_active: 1 })
    .limit(100)
    .get();
  const byOwner = memRes.data
    .map((m) => ({ id: m._id, name: m.name, cnt: ownerMap[m._id] || 0 }))
    .sort((a, b) => b.cnt - a.cnt);

  // 近 30 天进出（流水按 created_at 前缀日期比较）
  const monthAgo = daysAgoStr(30);
  const inCnt = await ctx.db
    .collection('stock_records')
    .where({ family_id: familyId, type: '入库', created_at: ctx._.gte(monthAgo) })
    .count();
  const outCnt = await ctx.db
    .collection('stock_records')
    .where({
      family_id: familyId,
      type: ctx._.in(['出库', '转赠', '清理']),
      created_at: ctx._.gte(monthAgo),
    })
    .count();

  // recent 15 条流水（内存关联衣服名/操作人名）
  const recRes = await ctx.db
    .collection('stock_records')
    .where({ family_id: familyId })
    .orderBy('created_at', 'desc')
    .limit(15)
    .get();
  const clothNameMap = {};
  clothes.forEach((c) => { clothNameMap[c._id] = c.name; });
  const memNameMap = {};
  memRes.data.forEach((m) => { memNameMap[m._id] = m.name; });

  const recent = recRes.data.map((r) => ({
    id: r._id,
    type: r.type,
    quantity: r.quantity,
    clothing_name: clothNameMap[r.clothing_id] || '',
    operator_name: memNameMap[r.operator_id] || '',
    counterparty: r.counterparty || '',
    created_at: r.created_at,
  }));

  return ok({
    total_pieces: totalPieces,
    total_items: clothes.length,
    in_stock: statusMap['在库'] || 0,
    borrowed: statusMap['借出'] || 0,
    disposed: statusMap['已处理'] || 0,
    month_in: inCnt.total,
    month_out: outCnt.total,
    by_owner: byOwner,
    by_season: bySeason,
    by_category: byCategory,
    by_color: byColor,
    recent,
  });
}

function fail401() { return { code: 401, data: null, message: '未登录' }; }

module.exports = { 'stats.overview': overview };
