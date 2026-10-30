const { q, db } = require('../db');
const { ok, fail, now, pick } = require('../utils');
const { saveImage, deleteImage, addImageRecord } = require('../upload');

const BASE_FIELDS = [
  'owner_id', 'name', 'category', 'sub_category', 'color', 'season', 'size',
  'brand', 'material', 'quantity', 'location', 'purchase_price', 'purchase_date',
  'tags', 'note',
];

function enrich(item, images) {
  return { ...item, images: images || [] };
}

/**
 * GET /api/clothes  列表（支持组合筛选 + 分页 + 搜索）
 * query: owner_id, category, color, season, status, keyword, page, page_size
 */
async function listClothes(req, reply) {
  const { owner_id, category, color, season, status, keyword } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 20));

  const where = ['family_id = ?', 'deleted_at IS NULL'];
  const params = [req.member.family_id];

  if (owner_id) { where.push('owner_id = ?'); params.push(Number(owner_id)); }
  if (category) { where.push('category = ?'); params.push(category); }
  if (color) { where.push('color = ?'); params.push(color); }
  if (season) { where.push('season = ?'); params.push(season); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (keyword) {
    where.push('(name LIKE ? OR brand LIKE ? OR tags LIKE ? OR note LIKE ?)');
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw, kw);
  }

  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM clothes WHERE ${whereSql}`).get(...params).cnt;
  const list = db.prepare(
    `SELECT * FROM clothes WHERE ${whereSql} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize);

  const items = list.map((item) => {
    const images = q.imagesByClothing.all(item.id);
    return enrich(item, images);
  });

  return reply.send(ok({ list: items, total, page, page_size: pageSize }));
}

/**
 * GET /api/clothes/:id  详情
 */
async function getClothes(req, reply) {
  const item = q.clothesById.get(Number(req.params.id));
  if (!item || item.family_id !== req.member.family_id) {
    return reply.send(fail('衣服不存在'));
  }
  const images = q.imagesByClothing.all(item.id);
  const owner = q.memberById.get(item.owner_id);
  return reply.send(ok(enrich({ ...item, owner_name: owner ? owner.name : '' }, images)));
}

/**
 * POST /api/clothes  新增（自动生成一条"入库"流水）
 */
async function createClothes(req, reply) {
  const body = pick(req.body || {}, BASE_FIELDS);
  const name = (body.name || '').trim();
  if (!name) {
    return reply.send(fail('请输入衣服名称'));
  }
  const quantity = Math.max(1, Number(body.quantity) || 1);
  const ts = now();

  const info = q.insertClothes.run({
    family_id: req.member.family_id,
    owner_id: body.owner_id || req.member.id,
    name,
    category: body.category || '',
    sub_category: body.sub_category || '',
    color: body.color || '',
    season: body.season || '四季通用',
    size: body.size || '',
    brand: body.brand || '',
    material: body.material || '',
    quantity,
    status: '在库',
    location: body.location || '',
    purchase_price: body.purchase_price ? Number(body.purchase_price) : null,
    purchase_date: body.purchase_date || '',
    tags: body.tags || '',
    note: body.note || '',
    created_at: ts,
    updated_at: ts,
  });

  const id = Number(info.lastInsertRowid);
  // 初始入库流水
  q.insertStock.run(id, '入库', quantity, body.purchase_price ? Number(body.purchase_price) : null, '', req.member.id, '初始入库', ts);

  const item = q.clothesById.get(id);
  return reply.send(ok(enrich(item, q.imagesByClothing.all(id))));
}

/**
 * PUT /api/clothes/:id  编辑（数量变更会补一条流水说明，保证可追溯）
 */
async function updateClothes(req, reply) {
  const id = Number(req.params.id);
  const item = q.clothesById.get(id);
  if (!item || item.family_id !== req.member.family_id) {
    return reply.send(fail('衣服不存在'));
  }
  const body = pick(req.body || {}, BASE_FIELDS);
  if (body.name !== undefined && !String(body.name).trim()) {
    return reply.send(fail('请输入衣服名称'));
  }
  const oldQuantity = item.quantity;
  const newQuantity = body.quantity !== undefined ? Math.max(0, Number(body.quantity) || 0) : oldQuantity;

  q.updateClothes.run({
    id,
    family_id: req.member.family_id,
    name: body.name !== undefined ? String(body.name).trim() : item.name,
    owner_id: body.owner_id || item.owner_id,
    category: body.category !== undefined ? body.category : item.category,
    sub_category: body.sub_category !== undefined ? body.sub_category : item.sub_category,
    color: body.color !== undefined ? body.color : item.color,
    season: body.season !== undefined ? body.season : item.season,
    size: body.size !== undefined ? body.size : item.size,
    brand: body.brand !== undefined ? body.brand : item.brand,
    material: body.material !== undefined ? body.material : item.material,
    quantity: newQuantity,
    location: body.location !== undefined ? body.location : item.location,
    purchase_price: body.purchase_price !== undefined ? (body.purchase_price ? Number(body.purchase_price) : null) : item.purchase_price,
    purchase_date: body.purchase_date !== undefined ? body.purchase_date : item.purchase_date,
    tags: body.tags !== undefined ? body.tags : item.tags,
    note: body.note !== undefined ? body.note : item.note,
    updated_at: now(),
  });

  // 数量变化 → 补流水
  if (newQuantity !== oldQuantity) {
    const diff = newQuantity - oldQuantity;
    q.insertStock.run(
      id,
      diff > 0 ? '入库' : '出库',
      Math.abs(diff),
      null,
      '',
      req.member.id,
      '编辑数量调整',
      now()
    );
    // 更新状态
    const finalStatus = newQuantity <= 0 ? '已处理' : (item.status === '借出' ? '借出' : '在库');
    q.updateQuantity.run(newQuantity, finalStatus, now(), id);
  }

  const updated = q.clothesById.get(id);
  return reply.send(ok(enrich(updated, q.imagesByClothing.all(id))));
}

/**
 * DELETE /api/clothes/:id  软删除
 */
async function deleteClothes(req, reply) {
  const id = Number(req.params.id);
  const item = q.clothesById.get(id);
  if (!item || item.family_id !== req.member.family_id) {
    return reply.send(fail('衣服不存在'));
  }
  q.softDeleteClothes.run(now(), now(), id, req.member.family_id);
  return reply.send(ok(true));
}

/**
 * POST /api/clothes/:id/images  上传图片（multipart, 字段名 file，可多图）
 */
async function uploadImages(req, reply) {
  const id = Number(req.params.id);
  const item = q.clothesById.get(id);
  if (!item || item.family_id !== req.member.family_id) {
    return reply.send(fail('衣服不存在'));
  }
  const parts = req.parts();
  const saved = [];
  for await (const part of parts) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) continue; // 单张限 10MB
      const urlPath = saveImage(buffer, part.filename);
      addImageRecord(id, urlPath);
      saved.push(urlPath);
    }
  }
  if (saved.length === 0) {
    return reply.send(fail('没有收到图片文件'));
  }
  return reply.send(ok({ uploaded: saved, images: q.imagesByClothing.all(id) }));
}

/**
 * DELETE /api/clothes/:id/images/:imgId  删除单张图片
 */
async function removeImage(req, reply) {
  const id = Number(req.params.id);
  const imgId = Number(req.params.imgId);
  const item = q.clothesById.get(id);
  if (!item || item.family_id !== req.member.family_id) {
    return reply.send(fail('衣服不存在'));
  }
  if (!deleteImage(imgId, id)) {
    return reply.send(fail('图片不存在'));
  }
  return reply.send(ok({ images: q.imagesByClothing.all(id) }));
}

module.exports = async function clothesRoutes(app) {
  app.get('/api/clothes', { preHandler: [require('../auth').authRequired] }, listClothes);
  app.get('/api/clothes/:id', { preHandler: [require('../auth').authRequired] }, getClothes);
  app.post('/api/clothes', { preHandler: [require('../auth').authRequired] }, createClothes);
  app.put('/api/clothes/:id', { preHandler: [require('../auth').authRequired] }, updateClothes);
  app.delete('/api/clothes/:id', { preHandler: [require('../auth').authRequired] }, deleteClothes);
  app.post('/api/clothes/:id/images', { preHandler: [require('../auth').authRequired] }, uploadImages);
  app.delete('/api/clothes/:id/images/:imgId', { preHandler: [require('../auth').authRequired] }, removeImage);
};
