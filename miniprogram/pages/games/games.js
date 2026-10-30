const { check, fetchPerms } = require('../../utils/perms');

// 游戏 key → 名称（与云函数 GAME_KEYS 对应）
const GAMES = { gomoku: '五子棋', tetris: '俄罗斯方块', plane: '飞机大战', benben: '蹦蹦大陆', bomber: '炸弹小子', score: '打牌积分' };

Page({
  data: {
    isAdmin: false,
    locked: {}, // { gomoku: true } 表示被管理员禁用
  },

  onShow() {
    fetchPerms(true).then((c) => {
      const locked = {};
      Object.keys(GAMES).forEach((k) => {
        if (!c.isAdmin && c.perms && c.perms[k] === false) locked[k] = true;
      });
      this.setData({ isAdmin: c.isAdmin, locked });
    });
  },

  enter(e) {
    const key = e.currentTarget.dataset.key;
    if (this.data.locked[key]) {
      return wx.showToast({ title: GAMES[key] + '已被管理员禁用，请联系管理员开通', icon: 'none' });
    }
    check(key).then((r) => {
      if (!r.allowed) {
        this.setData({ locked: Object.assign({}, this.data.locked, { [key]: true }) });
        return wx.showToast({ title: GAMES[key] + '已被管理员禁用', icon: 'none' });
      }
      wx.navigateTo({ url: '/pages/games/' + key + '/' + key });
    });
  },

  goPerms() {
    wx.navigateTo({ url: '/pages/games/perms/perms' });
  },
});
