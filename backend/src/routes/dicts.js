const { q } = require('../db');
const { ok, fail, now } = require('../utils');

/**
 * GET /api/dicts  返回家庭全部字典（分类/颜色/季节/位置）
 */
async function getDicts(req, reply) {
  const rows = q.dictsByFamily.all(req.member.family_id);
  const grouped = { category: [], color: [], season: [], location: [] };
  rows.forEach((r) => {
    if (!grouped[r.dict_type]) grouped[r.dict_type] = [];
    grouped[r.dict_type].push({ id: r.id, name: r.name });
  });
  return reply.send(ok(grouped));
}

/**
 * POST /api/dicts  新增字典项（管理员）
 * body: { dict_type, name }
 */
async function addDict(req, reply) {
  if (req.member.role !== 'admin') {
    return reply.send(fail('仅管理员可维护字典'));
  }
  const { dict_type, name } = req.body || {};
  const type = String(dict_type || '').trim();
  const n = String(name || '').trim();
  if (!['category', 'color', 'season', 'location'].includes(type)) {
    return reply.send(fail('无效的字典类型'));
  }
  if (!n) {
    return reply.send(fail('请输入名称'));
  }
  const exists = q.dictsByFamily.all(req.member.family_id)
    .find((d) => d.dict_type === type && d.name === n);
  if (exists) {
    return reply.send(fail('该名称已存在'));
  }
  const maxSort = q.dictsByFamily.all(req.member.family_id)
    .filter((d) => d.dict_type === type)
    .reduce((m, d) => Math.max(m, d.sort), -1);
  q.db.prepare('INSERT INTO dicts (family_id, dict_type, name, sort) VALUES (?, ?, ?, ?)')
    .run(req.member.family_id, type, n, maxSort + 1);
  return reply.send(ok(true));
}

/**
 * DELETE /api/dicts/:id  删除字典项（管理员）
 */
async function removeDict(req, reply) {
  if (req.member.role !== 'admin') {
    return reply.send(fail('仅管理员可维护字典'));
  }
  const id = Number(req.params.id);
  const row = q.dictById.get(id, req.member.family_id);
  if (!row) {
    return reply.send(fail('字典项不存在'));
  }
  q.deleteDict.run(id, req.member.family_id);
  return reply.send(ok(true));
}

module.exports = async function dictRoutes(app) {
  app.get('/api/dicts', { preHandler: [require('../auth').authRequired] }, getDicts);
  app.post('/api/dicts', { preHandler: [require('../auth').authRequired] }, addDict);
  app.delete('/api/dicts/:id', { preHandler: [require('../auth').authRequired] }, removeDict);
};
