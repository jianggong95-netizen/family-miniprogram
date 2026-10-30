const { ok, fail, now, doc } = require('../lib/utils');
const { getMember } = require('../lib/auth');

const TYPE_RULES = {
  入库: { delta: 1 },
  归还: { delta: 1 },
  出库: { delta: -1 },
  转赠: { delta: -1 },
  清理: { delta: -1 },
  借出: { delta: -1, status: '借出' },
};

/** stock.create（对应 POST /api/clothes/:id/stock：库存联动+状态机） */
async function createStock(event, ctx) {
  const member = await getMember(ctx);
  if (member.__authFail) return fail('未登录', 401);

  const id = String(event.id || '');
  const cRes = await ctx.db.collection('clothes').doc(id).get().catch(() => null);
  const item = cRes && cRes.data ? doc(cRes.data) : null;
  if (!item || item.deleted_at || item.family_id !== member.family_id) return fail('衣服不存在');

  const body = event.data || {};
  const type = String(body.type || '').trim();
  const rule = TYPE_RULES[type];
  if (!rule) return fail('无效的流水类型');

  const quantity = Math.max(1, Number(body.quantity) || 1);
  const newQuantity = item.quantity + rule.delta * quantity;
  if (newQuantity < 0) return fail(`库存不足：当前库存 ${item.quantity} 件`);

  const ts = now();
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

  await ctx.db.collection('stock_records').add({
    data: {
      clothing_id: id, family_id: member.family_id,
      type, quantity,
      price: body.price !== undefined && body.price !== '' ? Number(body.price) : null,
      counterparty: String(body.counterparty || '').trim(),
      operator_id: member.id,
      note: String(body.note || '').trim(),
      created_at: ts,
    },
  });
  await ctx.db.collection('clothes').doc(id).update({
    data: { quantity: newQuantity, status, updated_at: ts },
  });

  return ok({ quantity: newQuantity, status });
}

/** stock.records（对应 GET /api/clothes/:id/records：倒序+操作人名） */
async function listStock(event, ctx) {
  const member = await getMember(ctx);
  if (member.__authFail) return fail('未登录', 401);

  const id = String(event.id || '');
  const cRes = await ctx.db.collection('clothes').doc(id).get().catch(() => null);
  const item = cRes && cRes.data ? doc(cRes.data) : null;
  if (!item || item.family_id !== member.family_id) return fail('衣服不存在');

  const res = await ctx.db
    .collection('stock_records')
    .where({ clothing_id: id })
    .orderBy('created_at', 'desc')
    .limit(200)
    .get();

  // 内存关联操作人名（替代 LEFT JOIN）
  const opIds = [...new Set(res.data.map((r) => r.operator_id).filter(Boolean))];
  const nameMap = {};
  if (opIds.length) {
    const memRes = await ctx.db
      .collection('members')
      .where({ _id: ctx._.in(opIds) })
      .limit(100)
      .get();
    memRes.data.forEach((m) => { nameMap[m._id] = m.name; });
  }

  const list = res.data.map((r) => ({
    ...doc(r),
    operator_name: nameMap[r.operator_id] || null,
  }));
  return ok(list);
}

module.exports = { 'stock.create': createStock, 'stock.records': listStock };
