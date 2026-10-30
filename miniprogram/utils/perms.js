/**
 * 家庭小游戏 / 学习小园地 权限工具
 * 权限由管理员在「游戏权限管理」中配置，存于 members.game_perms。
 * 默认全部开放；本地缓存 60 秒，避免每次进页面都调云函数。
 */
const { call } = require('./request');

let cache = null; // { perms, isAdmin, ts }
const TTL = 60 * 1000;

function fetchPerms(force) {
  if (cache && !force && Date.now() - cache.ts < TTL) return Promise.resolve(cache);
  return call('game.getPerms')
    .then((d) => {
      cache = { perms: d.perms || {}, isAdmin: !!d.isAdmin, ts: Date.now() };
      return cache;
    })
    .catch(() => cache || { perms: {}, isAdmin: false, ts: 0 });
}

/** 返回 { allowed, isAdmin }；未登录/异常时默认放行（由云函数二次把关） */
function check(key) {
  return fetchPerms().then((c) => ({
    allowed: c.isAdmin || !(c.perms && c.perms[key] === false),
    isAdmin: c.isAdmin,
  }));
}

function invalidate() { cache = null; }

module.exports = { fetchPerms, check, invalidate };
