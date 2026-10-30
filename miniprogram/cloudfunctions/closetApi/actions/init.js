const cloud = require('wx-server-sdk');
const { ok } = require('../lib/utils');

const COLLECTIONS = ['families', 'members', 'clothes', 'clothing_images', 'stock_records', 'dicts', 'gomoku_rooms', 'score_rooms'];

/**
 * system.init：幂等初始化——创建全部集合（已存在则跳过）。
 * 部署云函数后调用一次即可，无需去控制台手动建集合。
 */
async function init(event, ctx) {
  const db = cloud.database();
  const result = {};
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name);
      result[name] = 'created';
    } catch (e) {
      // -501001 / "already exists"：集合已存在，视为成功
      const msg = String((e && (e.errMsg || e.message)) || '');
      result[name] = /exist|已存在|501001/i.test(msg) ? 'exists' : 'error: ' + msg;
    }
  }
  return ok(result);
}

module.exports = { 'system.init': init };
