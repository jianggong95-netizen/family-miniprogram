const { ok, fail, now, pick, doc } = require('../lib/utils');
const { getMember, doc2member } = require('../lib/auth');

const BASE_FIELDS = [
  'owner_id', 'name', 'category', 'sub_category', 'color', 'season', 'size',
  'brand', 'material', 'quantity', 'location', 'purchase_price', 'purchase_date',
  'tags', 'note',
];

/** 校验登录 + 衣服归属；返回 {member, item} 或 {err} */
async function ownClothes(event, ctx) {
  const member = await getMember(ctx);
  if (member.__authFail) return { err: fail('未登录', 401) };
  const id = String(event.id || '');
  const res = await ctx.db.collection('clothes').doc(id).get().catch(() => null);
  const item = res && res.data ? doc(res.data) : null;
  if (!item || item.deleted_at || item.family_id !== member.family_id) {
    return { err: fail('衣服不存在') };
  }
  return { member, item };
}

/** 批量取一页衣服的 images（替代原 N+1 查询） */
async function imagesFor(ctx, clothingIds) {
  if (!clothingIds.length) return {};
  const res = await ctx.db
    .collection('clothing_images')
    .where({ clothing_id: ctx._.in(clothingIds) })
    .orderBy('sort', 'asc')
    .limit(1000)
    .get();
  const map = {};
  res.data.forEach((img) => {
    (map[img.clothing_id] = map[img.clothing_id] || []).push(doc(img));
  });
  return map;
}

/** clothes.list（对应 GET /api/clothes） */
async function listClothes(event, ctx) {
  const member = await getMember(ctx);
  if (member.__authFail) return fail('未登录', 401);

  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(event.page_size) || 20));

  const where = { family_id: member.family_id, deleted_at: ctx._.exists(false) };
  if (event.owner_id) where.owner_id = String(event.owner_id);
  if (event.category) where.category = event.category;
  if (event.color) where.color = event.color;
  if (event.season) where.season = event.season;
  if (event.status) where.status = event.status;

  let query = where;
  if (event.keyword) {
    const kw = String(event.keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = ctx.db.RegExp({ regexp: kw, options: 'i' });
    query = ctx._.and([
      where,
      ctx._.or([{ name: re }, { brand: re }, { tags: re }, { note: re }]),
    ]);
  }

  const cntRes = await ctx.db.collection('clothes').where(query).count();
  const total = cntRes.total;

  const listRes = await ctx.db
    .collection('clothes')
    .where(query)
    .orderBy('updated_at', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  const imgMap = await imagesFor(ctx, listRes.data.map((c) => c._id));
  const list = listRes.data.map((c) => ({ ...doc(c), images: imgMap[c._id] || [] }));

  return ok({ list, total, page, page_size: pageSize });
}

/** clothes.get（对应 GET /api/clothes/:id） */
async function getClothes(event, ctx) {
  const r = await ownClothes(event, ctx);
  if (r.err) return r.err;
  const { member, item } = r;

  const imgs = await imagesFor(ctx, [item.id]);
  let owner_name = '';
  const ownerRes = await ctx.db.collection('members').doc(item.owner_id).get().catch(() => null);
  if (ownerRes && ownerRes.data) owner_name = ownerRes.data.name;

  return ok({ ...item, owner_name, images: imgs[item.id] || [] });
}

/** clothes.create（对应 POST /api/clothes：初始入库流水） */
async function createClothes(event, ctx) {
  const member = await getMember(ctx);
  if (member.__authFail) return fail('未登录', 401);

  const body = pick(event.data || {}, BASE_FIELDS);
  const name = String(body.name || '').trim();
  if (!name) return fail('请输入衣服名称');
  const quantity = Math.max(1, Number(body.quantity) || 1);
  const ts = now();

  const ownerId = body.owner_id ? String(body.owner_id) : member.id;
  const price = body.purchase_price ? Number(body.purchase_price) : null;

  const addRes = await ctx.db.collection('clothes').add({
    data: {
      family_id: member.family_id,
      owner_id: ownerId,
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
      purchase_price: price,
      purchase_date: body.purchase_date || '',
      tags: body.tags || '',
      note: body.note || '',
      created_at: ts,
      updated_at: ts,
    },
  });

  await ctx.db.collection('stock_records').add({
    data: {
      clothing_id: addRes._id, family_id: member.family_id,
      type: '入库', quantity, price, counterparty: '',
      operator_id: member.id, note: '初始入库', created_at: ts,
    },
  });

  const created = await ctx.db.collection('clothes').doc(addRes._id).get();
  return ok({ ...doc(created.data), images: [] });
}

/** clothes.update（对应 PUT /api/clothes/:id：数量差值补流水+状态联动） */
async function updateClothes(event, ctx) {
  const r = await ownClothes(event, ctx);
  if (r.err) return r.err;
  const { member, item } = r;

  const body = pick(event.data || {}, BASE_FIELDS);
  if (body.name !== undefined && !String(body.name).trim()) return fail('请输入衣服名称');

  const oldQuantity = item.quantity;
  const newQuantity = body.quantity !== undefined ? Math.max(0, Number(body.quantity) || 0) : oldQuantity;
  const ts = now();

  const data = {
    name: body.name !== undefined ? String(body.name).trim() : item.name,
    owner_id: body.owner_id ? String(body.owner_id) : item.owner_id,
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
    updated_at: ts,
  };

  if (newQuantity !== oldQuantity) {
    const diff = newQuantity - oldQuantity;
    data.status = newQuantity <= 0 ? '已处理' : (item.status === '借出' ? '借出' : '在库');
    await ctx.db.collection('stock_records').add({
      data: {
        clothing_id: item.id, family_id: member.family_id,
        type: diff > 0 ? '入库' : '出库', quantity: Math.abs(diff), price: null,
        counterparty: '', operator_id: member.id, note: '编辑数量调整', created_at: ts,
      },
    });
  }

  await ctx.db.collection('clothes').doc(item.id).update({ data });

  const updated = await ctx.db.collection('clothes').doc(item.id).get();
  const imgs = await imagesFor(ctx, [item.id]);
  return ok({ ...doc(updated.data), images: imgs[item.id] || [] });
}

/** clothes.delete（对应 DELETE /api/clothes/:id：软删除） */
async function deleteClothes(event, ctx) {
  const r = await ownClothes(event, ctx);
  if (r.err) return r.err;
  const ts = now();
  await ctx.db.collection('clothes').doc(r.item.id).update({
    data: { deleted_at: ts, updated_at: ts },
  });
  return ok(true);
}

/** clothes.addImages：前端已直传云存储，这里入库（对应 POST /api/clothes/:id/images） */
async function addImages(event, ctx) {
  const r = await ownClothes(event, ctx);
  if (r.err) return r.err;
  const { member, item } = r;

  const fileIDs = Array.isArray(event.fileIDs) ? event.fileIDs.filter(Boolean) : [];
  if (!fileIDs.length) return fail('没有收到图片文件');

  const existRes = await ctx.db
    .collection('clothing_images')
    .where({ clothing_id: item.id })
    .count();
  let sort = existRes.total;

  for (const fileID of fileIDs) {
    await ctx.db.collection('clothing_images').add({
      data: {
        clothing_id: item.id,
        family_id: member.family_id,
        file_id: fileID,
        path: fileID, // 兼容旧字段：展示层统一读 path
        is_cover: sort === 0 ? 1 : 0,
        sort,
        created_at: now(),
      },
    });
    sort++;
  }

  const imgs = await imagesFor(ctx, [item.id]);
  return ok({ uploaded: fileIDs, images: imgs[item.id] || [] });
}

/** clothes.removeImage（对应 DELETE /api/clothes/:id/images/:imgId） */
async function removeImage(event, ctx) {
  const r = await ownClothes(event, ctx);
  if (r.err) return r.err;
  const { item } = r;

  const imgId = String(event.imgId || '');
  const imgRes = await ctx.db.collection('clothing_images').doc(imgId).get().catch(() => null);
  const img = imgRes && imgRes.data;
  if (!img || img.clothing_id !== item.id) return fail('图片不存在');

  await ctx.db.collection('clothing_images').doc(imgId).remove();
  if (img.file_id) {
    await cloudDelete(img.file_id);
  }

  const imgs = await imagesFor(ctx, [item.id]);
  return ok({ images: imgs[item.id] || [] });
}

/** 删除云存储文件（失败不阻断） */
async function cloudDelete(fileID) {
  try {
    const cloud = require('wx-server-sdk');
    await cloud.deleteFile({ fileList: [fileID] });
  } catch (e) {
    console.warn('deleteFile failed', e);
  }
}

module.exports = {
  'clothes.list': listClothes,
  'clothes.get': getClothes,
  'clothes.create': createClothes,
  'clothes.update': updateClothes,
  'clothes.delete': deleteClothes,
  'clothes.addImages': addImages,
  'clothes.removeImage': removeImage,
};
