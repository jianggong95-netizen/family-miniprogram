const { ok, fail, now, genInviteCode } = require('../lib/utils');

const SIZE = 15;

function colorOf(room, openid) {
  if (room.host && room.host.openid === openid) return room.host_color || 'black';
  if (room.guest && room.guest.openid === openid) return room.host_color === 'white' ? 'black' : 'white';
  return null;
}

function checkWin(moves, r, c) {
  const board = new Map();
  moves.forEach((m) => board.set(m.r + ',' + m.c, m.w));
  const who = board.get(r + ',' + c);
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let n = 1;
    for (let k = 1; k < 5; k++) {
      const rr = r + dr * k, cc = c + dc * k;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || board.get(rr + ',' + cc) !== who) break;
      n++;
    }
    for (let k = 1; k < 5; k++) {
      const rr = r - dr * k, cc = c - dc * k;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || board.get(rr + ',' + cc) !== who) break;
      n++;
    }
    if (n >= 5) return true;
  }
  return false;
}

/** 集合不存在时自动创建（自愈，避免忘记跑 system.init） */
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
      .collection('gomoku_rooms')
      .where({ code: String(code || '').trim() })
      .limit(1)
      .get();
  } catch (e) {
    return null; // 集合不存在 → 视为无房间
  }
  return res.data[0] || null;
}

function genRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000)); // 4 位纯数字
}

/** gomoku.create：创建房间（房主默认执黑） */
async function create(event, ctx) {
  await ensureCollection(ctx, 'gomoku_rooms');
  // 顺手清理 7 天前的旧房间
  const cutoff = now().slice(0, 10);
  ctx.db.collection('gomoku_rooms').where({ created_at: ctx._.lt(cutoff) }).remove().catch(() => {});

  let code = genRoomCode();
  for (let i = 0; i < 5; i++) {
    const dup = await ctx.db.collection('gomoku_rooms').where({ code }).count();
    if (!dup.total) break;
    code = genRoomCode();
  }

  const name = String(event.name || '玩家').trim();
  const ts = now();
  await ctx.db.collection('gomoku_rooms').add({
    data: {
      code,
      host: { openid: ctx.openid, name },
      guest: {},
      host_color: 'black',
      moves: [],
      turn: 'black',
      status: 'waiting',
      host_ready: false,
      guest_ready: false,
      winner: null,
      created_at: ts,
      updated_at: ts,
    },
  });
  return ok({ code, color: 'black' });
}

/** gomoku.join：凭房间码加入（客人执白） */
async function join(event, ctx) {
  const room = await findRoom(ctx, event.code);
  if (!room) return fail('房间不存在');
  if (room.host && room.host.openid === ctx.openid) return fail('不能加入自己创建的房间');
  if (room.guest && room.guest.openid === ctx.openid) {
    return ok({ code: room.code, color: colorOf(room, ctx.openid) }); // 断线重连
  }
  if (room.guest && room.guest.openid) return fail('房间已满员');
  if (room.status !== 'waiting' && room.status !== 'playing') return fail('房间已结束');
  // 兼容：status 已是 playing 但 guest 缺失（上次写入失败留下的坏状态），允许补位加入

  const name = String(event.name || '玩家').trim();
  // 旧房间 guest 可能为 null，先归一化为空对象再写入（update 对 null 合并子字段会报错）
  if (!room.guest) {
    await ctx.db.collection('gomoku_rooms').doc(room._id).update({ data: { guest: {} } });
  }
  await ctx.db.collection('gomoku_rooms').doc(room._id).update({
    data: {
      guest: { openid: ctx.openid, name },
      guest_ready: false,
      // 双方到齐 → 进入 ready（各自点"开始"后才 playing）
      status: room.status === 'playing' ? 'playing' : 'ready',
      updated_at: now(),
    },
  });
  return ok({ code: room.code, color: room.host_color === 'black' ? 'white' : 'black' });
}

/** gomoku.ready：点击"开始"；双方都准备好则开局 */
async function ready(event, ctx) {
  const room = await findRoom(ctx, event.code);
  if (!room) return fail('房间不存在');
  const isHost = room.host && room.host.openid === ctx.openid;
  const isGuest = room.guest && room.guest.openid === ctx.openid;
  if (!isHost && !isGuest) return fail('你不在该房间中');
  if (!room.guest || !room.guest.openid) return fail('等待对手加入');

  const data = { updated_at: now() };
  if (isHost) data.host_ready = true;
  if (isGuest) data.guest_ready = true;
  if (room.status === 'waiting') data.status = 'ready';
  await ctx.db.collection('gomoku_rooms').doc(room._id).update({ data });

  const hReady = isHost ? true : !!room.host_ready;
  const gReady = isGuest ? true : !!room.guest_ready;
  if (hReady && gReady && room.status !== 'playing') {
    await ctx.db.collection('gomoku_rooms').doc(room._id).update({
      data: { status: 'playing', turn: 'black', moves: [], winner: null, updated_at: now() },
    });
  }
  return ok(true);
}

/** gomoku.move：服务端校验轮次/落点，追加棋谱并判胜 */
async function move(event, ctx) {
  const room = await findRoom(ctx, event.code);
  if (!room) return fail('房间不存在');
  if (room.status !== 'playing') return fail('当前不能落子');

  const myColor = colorOf(room, ctx.openid);
  if (!myColor) return fail('你不在该房间中');
  if (myColor !== room.turn) return fail('还没轮到你');

  const r = Number(event.r), c = Number(event.c);
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= SIZE || c < 0 || c >= SIZE) {
    return fail('落点无效');
  }
  const moves = room.moves || [];
  if (moves.some((m) => m.r === r && m.c === c)) return fail('该位置已有棋子');

  const next = moves.concat([{ r, c, w: myColor }]);
  const data = { moves: next, updated_at: now() };
  let winner = null;
  if (checkWin(next, r, c)) {
    data.status = 'ended';
    data.winner = myColor;
    winner = myColor;
  } else if (next.length >= SIZE * SIZE) {
    data.status = 'ended';
    data.winner = 'draw';
    winner = 'draw';
  } else {
    data.turn = myColor === 'black' ? 'white' : 'black';
  }
  await ctx.db.collection('gomoku_rooms').doc(room._id).update({ data });
  // 直接返回最新快照，客户端免一次 get 往返（降低落子延迟）
  return ok({
    code: room.code,
    host: room.host && room.host.name,
    guest: room.guest && room.guest.name,
    moves: next,
    turn: data.turn || room.turn,
    status: data.status || room.status,
    hostReady: !!room.host_ready,
    guestReady: !!room.guest_ready,
    winner,
    myColor,
    isHost: !!(room.host && room.host.openid === ctx.openid),
  });
}

/** gomoku.resign：认输，对方胜 */
async function resign(event, ctx) {
  const room = await findRoom(ctx, event.code);
  if (!room) return fail('房间不存在');
  if (room.status !== 'playing') return fail('对局未进行中');
  const myColor = colorOf(room, ctx.openid);
  if (!myColor) return fail('你不在该房间中');

  await ctx.db.collection('gomoku_rooms').doc(room._id).update({
    data: {
      status: 'ended',
      winner: myColor === 'black' ? 'white' : 'black',
      updated_at: now(),
    },
  });
  return ok(true);
}

/** gomoku.rematch：再来一局（交换黑白） */
async function rematch(event, ctx) {
  const room = await findRoom(ctx, event.code);
  if (!room) return fail('房间不存在');
  const myColor = colorOf(room, ctx.openid);
  if (!myColor) return fail('你不在该房间中');

  await ctx.db.collection('gomoku_rooms').doc(room._id).update({
    data: {
      moves: [],
      turn: 'black',
      status: 'playing',
      host_ready: false,
      guest_ready: false,
      winner: null,
      host_color: room.host_color === 'black' ? 'white' : 'black',
      updated_at: now(),
    },
  });
  return ok(true);
}

/** gomoku.get：读取房间快照（watch 建立前的初始状态 / 断线重连） */
async function get(event, ctx) {
  const room = await findRoom(ctx, event.code);
  if (!room) return fail('房间不存在');
  const myColor = colorOf(room, ctx.openid);
  return ok({
    code: room.code,
    host: room.host && room.host.name,
    guest: room.guest && room.guest.name,
    moves: room.moves || [],
    turn: room.turn,
    status: room.status,
    hostReady: !!room.host_ready,
    guestReady: !!room.guest_ready,
    winner: room.winner || null,
    myColor,
    isHost: !!(room.host && room.host.openid === ctx.openid),
  });
}

module.exports = {
  'gomoku.get': get,
  'gomoku.create': create,
  'gomoku.join': join,
  'gomoku.ready': ready,
  'gomoku.move': move,
  'gomoku.resign': resign,
  'gomoku.rematch': rematch,
};
