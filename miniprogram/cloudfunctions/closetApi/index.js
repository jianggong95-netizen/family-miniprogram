const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { ok, fail } = require('./lib/utils');

const ROUTES = {
  'system.ping': require('./actions/system'),
  'system.init': require('./actions/init'),
  'system.tempUrls': require('./actions/files'),
  'gomoku.create': require('./actions/gomoku'),
  'gomoku.join': require('./actions/gomoku'),
  'gomoku.ready': require('./actions/gomoku'),
  'gomoku.get': require('./actions/gomoku'),
  'gomoku.move': require('./actions/gomoku'),
  'gomoku.resign': require('./actions/gomoku'),
  'gomoku.rematch': require('./actions/gomoku'),
  'score.create': require('./actions/score'),
  'score.join': require('./actions/score'),
  'score.get': require('./actions/score'),
  'score.adjust': require('./actions/score'),
  'score.finish': require('./actions/score'),
  'score.reopen': require('./actions/score'),
  'auth.login': require('./actions/auth'),
  'family.create': require('./actions/family'),
  'family.join': require('./actions/family'),
  'family.get': require('./actions/family'),
  'member.bind': require('./actions/member'),
  'member.add': require('./actions/member'),
  'member.update': require('./actions/member'),
  'clothes.list': require('./actions/clothes'),
  'clothes.get': require('./actions/clothes'),
  'clothes.create': require('./actions/clothes'),
  'clothes.update': require('./actions/clothes'),
  'clothes.delete': require('./actions/clothes'),
  'clothes.addImages': require('./actions/clothes'),
  'clothes.removeImage': require('./actions/clothes'),
  'stock.create': require('./actions/stock'),
  'stock.records': require('./actions/stock'),
  'stats.overview': require('./actions/stats'),
  'stats.report': require('./actions/report'),
  'game.getPerms': require('./actions/game'),
  'game.setPerm': require('./actions/game'),
  'dicts.get': require('./actions/dicts'),
  'dicts.add': require('./actions/dicts'),
  'dicts.remove': require('./actions/dicts'),
};

/**
 * 云函数入口：按 event.action 分发，统一返回 {code,data,message}
 * 各 action 模块导出 { [action名]: async (event, ctx) => result }
 * ctx = { openid, db, _ }
 */
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const ctx = {
    openid: wxContext.OPENID,
    db: cloud.database(),
    _: cloud.database().command,
  };

  const action = event && event.action;
  const mod = ROUTES[action];
  if (!mod || typeof mod[action] !== 'function') {
    return fail('接口不存在: ' + action);
  }

  try {
    return await mod[action](event, ctx);
  } catch (e) {
    console.error('[closetApi]', action, e);
    return fail(e.message || '服务异常');
  }
};
