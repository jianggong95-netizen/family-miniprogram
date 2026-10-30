/** 统一响应格式：{ code, data, message }，code=0 表示成功 */

function ok(data) {
  return { code: 0, data: data ?? null, message: 'ok' };
}

function fail(message, code = 1) {
  return { code, data: null, message };
}

/** 6 位家庭邀请码 */
function genInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

/** 当前时间（YYYY-MM-DD HH:mm:ss） */
function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 只保留对象中的指定字段 */
function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

module.exports = { ok, fail, genInviteCode, now, pick };
