/**
 * 工具函数（移植自 backend/src/utils.js）
 */

function ok(data) {
  return { code: 0, data: data ?? null, message: 'ok' };
}

function fail(message, code = 1) {
  return { code, data: null, message };
}

function genInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

/**
 * 当前时间字符串（云函数容器为 UTC，固定按 UTC+8 输出，与家庭使用场景一致）
 */
function now() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** 近 N 天起始日期字符串（YYYY-MM-DD，UTC+8） */
function daysAgoStr(days) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 - days * 24 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/** 文档 → 对外对象：_id 别名为 id */
function doc(docRow) {
  if (!docRow) return null;
  const { _id, ...rest } = docRow;
  return { id: _id, ...rest };
}

function docs(list) {
  return (list || []).map(doc);
}

module.exports = { ok, fail, genInviteCode, now, daysAgoStr, pick, doc, docs };
