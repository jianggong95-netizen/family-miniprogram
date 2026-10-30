const { ok, fail, now } = require('../lib/utils');

function genScoreCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 位纯数字
}

/** 集合不存在时自动创建（自愈） */
async function ensureCollection(ctx, name) {
  try {
    await ctx.db.collection(name).count();
  } catch (e) {
    try { await ctx.db.createCollection(name); } catch (e2) {}
  }
}

async function findRoom(ctx, code) {
  let res;
  try {
    res = await ctx.db
      .collection('score_rooms')
      .where({ code: String(code || '').trim() })
      .limit(1)
      .get();
  } catch (e) {
    return null;
  }
  return res.data[0] || null;
}

function publicRoom(room, openid) {
  return {
    code: room.code,
    status: room.status,
    host: room.host && room.host.name,
    players: (room.players || []).map((p) => ({
      id: p.openid,
      name: p.name,
      score: p.score,
      isHost: !!(room.host && room.host.openid === p.openid),
      isMe: p.openid === openid,
    })),
    logs: (room.logs || []).slice(-80).reverse(), // 最新在前
    round: room.round || 1,
  };
}

/** score.create：创建积分房间 */
async function create(event, ctx) {
  await ensureCollection(ctx, 'score_rooms');
  const name = String(event.name || '玩家').trim();

  let code = genScoreCode();
  for (let i = 0; i < 5; i++) {
    const dup = await ctx.db.collection('score_rooms').where({ code }).count();
    if (!dup.total) break;
    code = genScoreCode();
  }

  const ts = now();
  await ctx.db.collection('score_rooms').add({
    data: {
      code,
      host: { openid: ctx.openid, name },
      players: [{ openid: ctx.openid, name, score: 0 }],
      logs: [],
      status: 'playing',
      round: 1,
      created_at: ts,
      updated_at: ts,
    },
  });
  return ok({ code });
}

/** score.join：凭 6 位数字码加入 */
async function join(event, ctx) {
  const room = await findRoom(ctx, event.code);
  if (!room) return fail('房间不存在');
  const me = (room.players || []).find((p) => p.openid === ctx.openid);
  if (me) return ok(publicRoom(room, ctx.openid)); // 断线重连

  const name = String(event.name || '玩家').trim();
  if ((room.players || []).length >= 8) return fail('房间人数已满（8 人）');

  await ctx.db.collection('score_rooms').doc(room._id).update({
    data: {
      players: (room.players || []).concat([{ openid: ctx.openid, name, score: 0 }]),
      updated_at: now(),
    },
  });
  const again = await findRoom(ctx, event.code);
  return ok(publicRoom(again, ctx.openid));
}

/** score.get：房间快照 */
async function get(event, ctx) {
  const room = await findRoom(ctx, event.code);
  if (!room) return fail('房间不存在');
  const me = (room.players || []).some((p) => p.openid === ctx.openid);
  if (!me) return fail('你不在该房间中');
  return ok(publicRoom(room, ctx.openid));
}

/** score.adjust：麻将式转账 —— 我给对方 N 分，自己扣 N 分（零和） */
async function adjust(event, ctx) {
  const room = await findRoom(ctx, event.code);
  if (!room) return fail('房间不存在');
  if (room.status !== 'playing') return fail('本局已结束');
  const players = room.players || [];
  const me = players.find((p) => p.openid === ctx.openid);
  if (!me) return fail('你不在该房间中');

  const target = players.find((p) => p.openid === event.targetId);
  if (!target) return fail('玩家不存在');
  if (target.openid === me.openid) return fail('不能给自己记分');

  const amount = Math.round(Number(event.amount));
  if (!amount || amount <= 0 || amount > 9999) return fail('请输入大于 0 的分值');

  const reason = String(event.reason || '').trim().slice(0, 30);
  const next = players.map((p) => {
    if (p.openid === target.openid) return Object.assign({}, p, { score: p.score + amount });
    if (p.openid === me.openid) return Object.assign({}, p, { score: p.score - amount });
    return p;
  });
  const logs = (room.logs || []).concat([
    {
      time: now(),
      by: me.name,
      target: target.name,
      delta: amount,
      fromScore: me.score - amount,
      toScore: target.score + amount,
      reason,
    },
  ]).slice(-200);

  await ctx.db.collection('score_rooms').doc(room._id).update({
    data: { players: next, logs, updated_at: now() },
  });
  return ok(true);
}

/** score.finish：结束本局（房主），可再来一局 */
async function finish(event, ctx) {
  const room = await findRoom(ctx, event.code);
  if (!room) return fail('房间不存在');
  if (room.host && room.host.openid !== ctx.openid) return fail('只有房主能结束本局');

  await ctx.db.collection('score_rooms').doc(room._id).update({
    data: { status: 'ended', updated_at: now() },
  });
  return ok(true);
}

/** score.reopen：再来一局，全员清零（房主） */
async function reopen(event, ctx) {
  const room = await findRoom(ctx, event.code);
  if (!room) return fail('房间不存在');
  if (room.host && room.host.openid !== ctx.openid) return fail('只有房主能开新局');

  const players = (room.players || []).map((p) => Object.assign({}, p, { score: 0 }));
  await ctx.db.collection('score_rooms').doc(room._id).update({
    data: {
      players,
      logs: [{ time: now(), by: '系统', target: '-', delta: 0, score: 0, reason: '第 ' + ((room.round || 1) + 1) + ' 局开始，分数清零' }],
      status: 'playing',
      round: (room.round || 1) + 1,
      updated_at: now(),
    },
  });
  return ok(true);
}

module.exports = {
  'score.create': create,
  'score.join': join,
  'score.get': get,
  'score.adjust': adjust,
  'score.finish': finish,
  'score.reopen': reopen,
};
