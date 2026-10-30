const { q, db } = require('../db');
const { ok, fail, now } = require('../utils');

/**
 * 进销存类型 → 对库存/状态的影响
 */
const TYPE_RULES = {
  入库: { delta: 1 },
  归还: { delta: 1 },
  出库: { delta: -1 },
  转赠: { delta: -1 },
  清理: { delta: -1 },
  借出: { delta: -1, status: '借出' },
};

/**
 * POST /api/clothes/:id/stock  记一笔流水并联动库存
 * body: { type, quantity=1, price?, counterparty?, note? }
 */
async function createStock(req, reply) {
  const id = Number(req.params.id);
  const item = q.clothesById.get(id);
  if (!item || item.family_id !== req.member.family_id) {
    return reply.send(fail('衣服不存在'));
  }
  const body = req.body || {};
  const type = String(body.type || '').trim();
  const rule = TYPE_RULES[type];
  if (!rule) {
    return reply.send(fail('无效的流水类型'));
  }
  const quantity = Math.max(1, Number(body.quantity) || 1);
  const newQuantity = item.quantity + rule.delta * quantity;
  if (newQuantity < 0) {
    return reply.send(fail(`库存不足：当前库存 ${item.quantity} 件`));
  }

  const ts = now();
  // 同事务：写流水 + 更新库存状态
  const tx = db.transaction(() => {
    q.insertStock.run(
      id,
      type,
      quantity,
      body.price !== undefined && body.price !== '' ? Number(body.price) : null,
      (body.counterparty || '').trim(),
      req.member.id,
      (body.note || '').trim(),
      ts
    );
    let status = item.status;
    if (type === '借出') {
      status = '借出';
    } else if (type === '归还') {
      status = newQuantity > 0 ? '在库' : '已处理';
    } else if (newQuantity <= 0) {
      status = '已处理';
    } else if (rule.delta < 0 && status !== '借出') {
      status = '在库';
    }
    q.updateQuantity.run(newQuantity, status, ts, id);
  });
  tx();

  const updated = q.clothesById.get(id);
  return reply.send(ok({ quantity: updated.quantity, status: updated.status }));
}

/**
 * GET /api/clothes/:id/records  该衣服的流水（倒序）
 */
async function listStock(req, reply) {
  const id = Number(req.params.id);
  const item = q.clothesById.get(id);
  if (!item || item.family_id !== req.member.family_id) {
    return reply.send(fail('衣服不存在'));
  }
  return reply.send(ok(q.stockByClothing.all(id)));
}

module.exports = async function stockRoutes(app) {
  app.post('/api/clothes/:id/stock', { preHandler: [require('../auth').authRequired] }, createStock);
  app.get('/api/clothes/:id/records', { preHandler: [require('../auth').authRequired] }, listStock);
};
