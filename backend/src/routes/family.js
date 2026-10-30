const { q, getOrCreateFamily, createMember } = require('../db');
const { ok, fail } = require('../utils');

/**
 * POST /api/families  创建家庭（首个成员自动成为管理员）
 * 宽松鉴权：header X-Token = openid
 */
async function createFamily(req, reply) {
  const openid = req.openid;
  if (!openid) {
    return reply.send(fail('请先登录'));
  }
  const name = (req.body && req.body.name || '').trim();
  if (!name) {
    return reply.send(fail('请输入家庭名称'));
  }
  const family = getOrCreateFamily(name);
  const adminId = createMember({ familyId: family.id, name: '管理员', openid, role: 'admin' });
  const member = q.memberById.get(adminId);
  return reply.send(ok({ family, member }));
}

/**
 * GET /api/families/join?code=XXX  根据邀请码查家庭 + 未绑定成员列表
 * 宽松鉴权：用于首次加入家庭
 */
async function joinFamily(req, reply) {
  const code = (req.query.code || '').trim().toUpperCase();
  if (!code) {
    return reply.send(fail('请输入邀请码'));
  }
  const family = q.familyByCode.get(code);
  if (!family) {
    return reply.send(fail('邀请码无效'));
  }
  const members = q.unboundMembersByFamily.all(family.id);
  return reply.send(ok({ family, members }));
}

/**
 * PUT /api/members/:id/bind  把当前 openid 绑定到某个成员
 * 宽松鉴权：openid 必须未被占用；成员必须未绑定
 */
async function bindMember(req, reply) {
  const openid = req.openid;
  if (!openid) {
    return reply.send(fail('请先登录'));
  }
  const member = q.memberById.get(Number(req.params.id));
  if (!member || member.is_active !== 1) {
    return reply.send(fail('成员不存在'));
  }
  if (member.openid) {
    return reply.send(fail('该成员已被绑定，请联系管理员'));
  }
  const occupied = q.memberByOpenid.get(openid);
  if (occupied) {
    return reply.send(fail('当前微信已绑定其他成员'));
  }
  q.bindMember.run(openid, member.id);
  const updated = q.memberById.get(member.id);
  return reply.send(ok(updated));
}

/**
 * GET /api/family  当前家庭信息 + 成员列表（需登录）
 */
async function getFamily(req, reply) {
  const family = q.familyById.get(req.member.family_id);
  const members = q.membersByFamily.all(family.id);
  return reply.send(ok({ family, members }));
}

/**
 * POST /api/members  添加成员（管理员）
 * body: { name }
 */
async function addMember(req, reply) {
  const name = (req.body && req.body.name || '').trim();
  if (!name) {
    return reply.send(fail('请输入成员名字'));
  }
  const id = createMember({ familyId: req.member.family_id, name });
  return reply.send(ok(q.memberById.get(id)));
}

/**
 * PUT /api/members/:id  编辑成员（管理员可改名字/角色/停用；本人可改自己名字）
 * body: { name?, role?, is_active? }
 */
async function updateMember(req, reply) {
  const id = Number(req.params.id);
  const target = q.memberById.get(id);
  if (!target || target.family_id !== req.member.family_id) {
    return reply.send(fail('成员不存在'));
  }
  const isSelf = target.id === req.member.id;
  const isAdmin = req.member.role === 'admin';
  if (!isSelf && !isAdmin) {
    return reply.send(fail('没有权限'));
  }
  const body = req.body || {};
  let name = target.name;
  let role = target.role;
  let isActive = target.is_active;
  if (body.name !== undefined) {
    name = String(body.name).trim() || target.name;
  }
  if (isAdmin && body.role !== undefined) {
    role = body.role === 'admin' ? 'admin' : 'member';
  }
  if (isAdmin && body.is_active !== undefined) {
    isActive = body.is_active ? 1 : 0;
  }
  q.updateMember.run(name, role, isActive, id);
  return reply.send(ok(q.memberById.get(id)));
}

module.exports = async function familyRoutes(app) {
  app.post('/api/families', { preHandler: [require('../auth').openidOptional] }, createFamily);
  app.get('/api/families/join', { preHandler: [require('../auth').openidOptional] }, joinFamily);
  app.put('/api/members/:id/bind', { preHandler: [require('../auth').openidOptional] }, bindMember);
  app.get('/api/family', { preHandler: [require('../auth').authRequired] }, getFamily);
  app.post('/api/members', { preHandler: [require('../auth').authRequired] }, addMember);
  app.put('/api/members/:id', { preHandler: [require('../auth').authRequired] }, updateMember);
};
