const { ok, fail } = require('../lib/utils');
const { getMember } = require('../lib/auth');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * stats.report（对应 GET /api/stats/report BI 报表）
 * 购买口径：purchase_price 非空且 purchase_date 非空，按 purchase_date 过滤；
 * 进销存口径：流水按 created_at 过滤。全量 total_* 不受时间过滤。
 */
async function report(event, ctx) {
  const member = await getMember(ctx);
  if (member.__authFail) return fail('未登录', 401);

  const familyId = member.family_id;
  const from = event.from && DATE_RE.test(event.from) ? event.from : null;
  const to = event.to && DATE_RE.test(event.to) ? event.to : null;

  const clothesRes = await ctx.db
    .collection('clothes')
    .where({ family_id: familyId, deleted_at: ctx._.exists(false) })
    .limit(1000)
    .get();
  const all = clothesRes.data;

  // 购买口径过滤
  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  const pur = all.filter(
    (c) => c.purchase_price != null && c.purchase_date && inRange(c.purchase_date)
  );

  const total = {
    items: all.length,
    pieces: all.reduce((s, c) => s + (c.quantity || 0), 0),
    value: all.reduce((s, c) => s + (c.purchase_price || 0) * (c.quantity || 0), 0),
  };
  const purSum = {
    cnt: pur.length,
    pieces: pur.reduce((s, c) => s + (c.quantity || 0), 0),
    amount: pur.reduce((s, c) => s + (c.purchase_price || 0) * (c.quantity || 0), 0),
  };

  // 成员名映射（by_owner / purchases 用）
  const memRes = await ctx.db
    .collection('members')
    .where({ family_id: familyId })
    .limit(100)
    .get();
  const memName = {};
  memRes.data.forEach((m) => { memName[m._id] = m.name; });

  const group = (rows, keyFn) => {
    const map = {};
    rows.forEach((c) => {
      const k = keyFn(c) || '';
      const g = (map[k] = map[k] || { cnt: 0, pieces: 0, amount: 0 });
      g.cnt++;
      g.pieces += c.quantity || 0;
      g.amount += (c.purchase_price || 0) * (c.quantity || 0);
    });
    return map;
  };

  const catMap = group(pur, (c) => c.category);
  const byCategory = Object.entries(catMap)
    .map(([category, r]) => ({ category, ...r, amount: money(r.amount) }))
    .sort((a, b) => b.amount - a.amount || b.cnt - a.cnt)
    .slice(0, 10);

  const seaMap = group(pur, (c) => c.season);
  const bySeason = Object.entries(seaMap)
    .map(([season, r]) => ({ season, ...r, amount: money(r.amount) }))
    .sort((a, b) => b.amount - a.amount);

  const ownMap = group(pur, (c) => c.owner_id);
  const byOwner = Object.entries(ownMap)
    .map(([ownerId, r]) => ({ name: memName[ownerId] || '', ...r, amount: money(r.amount) }))
    .sort((a, b) => b.amount - a.amount);

  const monMap = group(pur, (c) => (c.purchase_date || '').slice(0, 7));
  const trend = Object.entries(monMap)
    .map(([month, r]) => ({ month, ...r, amount: money(r.amount) }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  // 进销存（按流水 created_at 日期前缀过滤）
  const recWhere = { family_id: familyId };
  if (from || to) {
    if (from && to) recWhere.created_at = ctx._.gte(from).and(ctx._.lte(to + '\uffff'));
    else if (from) recWhere.created_at = ctx._.gte(from);
    else recWhere.created_at = ctx._.lte(to + '\uffff');
  }
  const stockMap = {};
  // 家庭流水总量小：分页取（上限 5000 条）
  for (let skip = 0; skip < 5000; skip += 1000) {
    const res = await ctx.db
      .collection('stock_records')
      .where(recWhere)
      .field({ type: true })
      .skip(skip)
      .limit(1000)
      .get();
    res.data.forEach((r) => { stockMap[r.type] = (stockMap[r.type] || 0) + 1; });
    if (res.data.length < 1000) break;
  }

  // 购买明细 top 50
  const purchases = [...pur]
    .sort((a, b) => {
      if (a.purchase_date !== b.purchase_date) return a.purchase_date < b.purchase_date ? 1 : -1;
      return a._id < b._id ? 1 : -1;
    })
    .slice(0, 50)
    .map((c) => ({
      id: c._id,
      name: c.name,
      category: c.category,
      brand: c.brand,
      purchase_price: c.purchase_price,
      quantity: c.quantity,
      purchase_date: c.purchase_date,
      owner_name: memName[c.owner_id] || '',
    }));

  return ok({
    from,
    to,
    total_items: total.items,
    total_pieces: total.pieces,
    total_value: money(total.value),
    purchased_count: purSum.cnt,
    purchased_pieces: purSum.pieces,
    purchased_amount: money(purSum.amount),
    by_category: byCategory,
    by_season: bySeason,
    by_owner: byOwner,
    trend,
    stock_in: stockMap['入库'] || 0,
    stock_out: (stockMap['出库'] || 0) + (stockMap['转赠'] || 0) + (stockMap['清理'] || 0),
    stock_borrow: stockMap['借出'] || 0,
    stock_return: stockMap['归还'] || 0,
    purchases,
  });
}

module.exports = { 'stats.report': report };
