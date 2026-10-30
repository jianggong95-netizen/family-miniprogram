const { q } = require('../db');
const { ok } = require('../utils');

/**
 * GET /api/stats/overview  看板统计
 */
async function overview(req, reply) {
  const familyId = req.member.family_id;

  const total = q.statsTotal.get(familyId);
  const byStatus = q.statsByStatus.all(familyId);
  const byOwner = q.statsByOwner.all(familyId);
  const bySeason = q.statsBySeason.all(familyId);
  const byCategory = q.statsByCategory.all(familyId);
  const byColor = q.statsByColor.all(familyId);

  // 本月（近 30 天）入/出库次数
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const monthIn = q.monthIn.get(familyId, monthAgo).cnt;
  const monthOut = q.monthOut.get(familyId, monthAgo).cnt;

  const statusMap = {};
  byStatus.forEach((r) => { statusMap[r.status] = r.cnt; });

  const recent = q.recentStock.all(familyId).map((r) => ({
    id: r.id,
    type: r.type,
    quantity: r.quantity,
    clothing_name: r.clothing_name,
    operator_name: r.operator_name,
    counterparty: r.counterparty,
    created_at: r.created_at,
  }));

  return reply.send(ok({
    total_pieces: total.pieces,        // 全部件数（含数量）
    total_items: total.total,          // 衣服条目数
    in_stock: statusMap['在库'] || 0,
    borrowed: statusMap['借出'] || 0,
    disposed: statusMap['已处理'] || 0,
    month_in: monthIn,
    month_out: monthOut,
    by_owner: byOwner,
    by_season: bySeason,
    by_category: byCategory,
    by_color: byColor,
    recent,
  }));
}

module.exports = async function statsRoutes(app) {
  app.get('/api/stats/overview', { preHandler: [require('../auth').authRequired] }, overview);
};
