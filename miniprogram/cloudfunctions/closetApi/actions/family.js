const { ok, fail, genInviteCode, now, doc } = require('../lib/utils');
const { getMember, doc2member } = require('../lib/auth');
const { seedDicts } = require('../lib/db');

/** family.create：创建家庭 + admin 成员 + seed 字典（对应 POST /api/families） */
async function createFamily(event, ctx) {
  const name = String(event.name || '').trim();
  if (!name) return fail('请输入家庭名称');

  // 邀请码查重（碰撞则重生成，最多 3 次）
  let code = genInviteCode();
  for (let i = 0; i < 3; i++) {
    const dup = await ctx.db.collection('families').where({ invite_code: code }).count();
    if (!dup.total) break;
    code = genInviteCode();
  }

  const ts = now();
  const famRes = await ctx.db.collection('families').add({
    data: { name, invite_code: code, created_at: ts },
  });
  const familyId = famRes._id;

  await seedDicts(ctx.db, familyId);

  const memRes = await ctx.db.collection('members').add({
    data: {
      family_id: familyId, name: '管理员', openid: ctx.openid,
      role: 'admin', is_active: 1, created_at: ts,
    },
  });

  return ok({
    family: { id: familyId, name, invite_code: code, created_at: ts },
    member: doc2member({ _id: memRes._id, family_id: familyId, name: '管理员', openid: ctx.openid, role: 'admin', is_active: 1 }),
  });
}

/** family.join：按邀请码查家庭与未绑定成员（对应 GET /api/families/join） */
async function joinFamily(event, ctx) {
  const code = String(event.code || '').trim().toUpperCase();
  if (!code) return fail('请输入邀请码');

  const res = await ctx.db.collection('families').where({ invite_code: code }).limit(1).get();
  if (!res.data.length) return fail('邀请码无效');
  const family = doc(res.data[0]);

  const memRes = await ctx.db
    .collection('members')
    .where({ family_id: family.id, is_active: 1 })
    .limit(100)
    .get();
  const members = memRes.data
    .filter((m) => !m.openid)
    .map(doc2member);

  return ok({ family, members });
}

/** family.get：家庭信息与成员列表（含 clothing_count，对应 GET /api/family） */
async function getFamily(event, ctx) {
  const member = await getMember(ctx);
  if (member.__authFail) return fail('未登录', 401);

  const famRes = await ctx.db.collection('families').doc(member.family_id).get();
  const family = doc(famRes.data);

  const memRes = await ctx.db
    .collection('members')
    .where({ family_id: member.family_id })
    .limit(100)
    .get();

  // 内存统计各成员在库衣服数（替代原 JOIN 子查询）
  const clothesRes = await ctx.db
    .collection('clothes')
    .where({ family_id: member.family_id, deleted_at: ctx._.exists(false) })
    .field({ owner_id: true })
    .limit(1000)
    .get();
  const countMap = {};
  clothesRes.data.forEach((c) => {
    countMap[c.owner_id] = (countMap[c.owner_id] || 0) + 1;
  });

  const members = memRes.data
    .map(doc2member)
    .sort((a, b) => {
      const ra = a.role === 'admin' ? 0 : 1;
      const rb = b.role === 'admin' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.id < b.id ? -1 : 1;
    })
    .map((m) => ({ ...m, clothing_count: countMap[m.id] || 0 }));

  return ok({ family, members });
}

module.exports = {
  'family.create': createFamily,
  'family.join': joinFamily,
  'family.get': getFamily,
};
