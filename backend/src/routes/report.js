const { db } = require('../db');
const { ok } = require('../utils');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 归一化金额：四舍五入保留两位小数
 */
function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * GET /api/stats/report  BI / 数据分析
 * query: from, to（YYYY-MM-DD），可选；按 purchase_date 过滤"购买/金额"统计，
 *        按 created_at 过滤"进销存"统计。
 */
async function report(req, reply) {
  const familyId = req.member.family_id;

  const from = req.query.from && DATE_RE.test(req.query.from) ? req.query.from : null;
  const to = req.query.to && DATE_RE.test(req.query.to) ? req.query.to : null;

  // ---- 购买口径：有购入价且有购入日期的衣服条目 ----
  const pf = ['family_id = ?', 'deleted_at IS NULL', 'purchase_price IS NOT NULL', "purchase_date != ''"];
  const pp = [familyId];
  if (from) { pf.push('purchase_date >= ?'); pp.push(from); }
  if (to) { pf.push('purchase_date <= ?'); pp.push(to); }
  const PF = pf.join(' AND ');

  // ---- 进销存口径：按流水 created_at 过滤 ----
  const tf = ['c.family_id = ?'];
  const tp = [familyId];
  if (from) { tf.push('s.created_at >= ?'); tp.push(from); }
  if (to) { tf.push('s.created_at <= ?'); tp.push(to); }
  const TF = tf.join(' AND ');

  // 全量衣橱（不受时间过滤）
  const total = db.prepare(
    "SELECT COUNT(*) AS items, COALESCE(SUM(quantity),0) AS pieces, COALESCE(SUM(purchase_price*quantity),0) AS value FROM clothes WHERE family_id = ? AND deleted_at IS NULL"
  ).get(familyId);

  // 过滤期内购买汇总
  const pur = db.prepare(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(quantity),0) AS pieces, COALESCE(SUM(purchase_price*quantity),0) AS amount FROM clothes WHERE ${PF}`
  ).get(...pp);

  // 分布
  const byCategory = db.prepare(
    `SELECT category, COUNT(*) cnt, COALESCE(SUM(quantity),0) pieces, COALESCE(SUM(purchase_price*quantity),0) amount
       FROM clothes WHERE ${PF} GROUP BY category ORDER BY amount DESC, cnt DESC LIMIT 10`
  ).all(...pp);
  const bySeason = db.prepare(
    `SELECT season, COUNT(*) cnt, COALESCE(SUM(quantity),0) pieces, COALESCE(SUM(purchase_price*quantity),0) amount
       FROM clothes WHERE ${PF} GROUP BY season ORDER BY amount DESC`
  ).all(...pp);
  // 归属分布需要联表，family_id 需限定在 clothes 侧
  const PF_OWNER = PF.replace(/\bfamily_id\b/g, 'c.family_id');
  const byOwner = db.prepare(
    `SELECT m.name, COUNT(c.id) cnt, COALESCE(SUM(c.quantity),0) pieces, COALESCE(SUM(c.purchase_price*c.quantity),0) amount
       FROM clothes c JOIN members m ON m.id = c.owner_id
      WHERE ${PF_OWNER} GROUP BY m.id, m.name ORDER BY amount DESC`
  ).all(...pp);

  // 月度趋势
  const trend = db.prepare(
    `SELECT substr(purchase_date,1,7) month, COUNT(*) cnt, COALESCE(SUM(quantity),0) pieces, COALESCE(SUM(purchase_price*quantity),0) amount
       FROM clothes WHERE ${PF} GROUP BY substr(purchase_date,1,7) ORDER BY month ASC`
  ).all(...pp);

  // 进销存（按流水时间）
  const stockRows = db.prepare(
    `SELECT s.type, COUNT(*) cnt FROM stock_records s JOIN clothes c ON c.id = s.clothing_id WHERE ${TF} GROUP BY s.type`
  ).all(...tp);
  const stockMap = {};
  stockRows.forEach((r) => { stockMap[r.type] = r.cnt; });

  // 购买明细
  const purchases = db.prepare(
    `SELECT c.id, c.name, c.category, c.brand, c.purchase_price, c.quantity, c.purchase_date, m.name owner_name
       FROM clothes c LEFT JOIN members m ON m.id = c.owner_id
      WHERE ${PF_OWNER} ORDER BY c.purchase_date DESC, c.id DESC LIMIT 50`
  ).all(...pp);

  return reply.send(ok({
    from,
    to,
    // 全量
    total_items: total.items,
    total_pieces: total.pieces,
    total_value: money(total.value),
    // 过滤期购买
    purchased_count: pur.cnt,
    purchased_pieces: pur.pieces,
    purchased_amount: money(pur.amount),
    // 分布
    by_category: byCategory.map((r) => ({ ...r, amount: money(r.amount) })),
    by_season: bySeason.map((r) => ({ ...r, amount: money(r.amount) })),
    by_owner: byOwner.map((r) => ({ ...r, amount: money(r.amount) })),
    // 趋势
    trend: trend.map((r) => ({ ...r, amount: money(r.amount) })),
    // 进销存
    stock_in: stockMap['入库'] || 0,
    stock_out: (stockMap['出库'] || 0) + (stockMap['转赠'] || 0) + (stockMap['清理'] || 0),
    stock_borrow: stockMap['借出'] || 0,
    stock_return: stockMap['归还'] || 0,
    // 明细
    purchases,
  }));
}

module.exports = async function reportRoutes(app) {
  app.get('/api/stats/report', { preHandler: [require('../auth').authRequired] }, report);
};