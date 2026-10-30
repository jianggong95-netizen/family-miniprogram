const { call } = require('../../../utils/request');
const { invalidate } = require('../../../utils/perms');

const ITEMS = [
  { key: 'gomoku', name: '五子棋' },
  { key: 'tetris', name: '俄罗斯方块' },
  { key: 'plane', name: '飞机大战' },
  { key: 'benben', name: '蹦蹦大陆' },
  { key: 'bomber', name: '炸弹小子' },
  { key: 'score', name: '打牌积分' },
  { key: 'study', name: '学习小园地' },
];

Page({
  data: {
    loading: true,
    members: [], // { id, name, role, cells: [{key,name,allowed}] }
  },

  onLoad() { this.load(); },
  onShow() { if (!this.data.loading) this.load(); },

  load() {
    call('game.getPerms')
      .then((d) => {
        if (!d.isAdmin) {
          this.setData({ loading: false, members: [] });
          wx.showToast({ title: '只有管理员可管理权限', icon: 'none' });
          setTimeout(() => wx.navigateBack(), 1200);
          return;
        }
        const members = (d.members || []).map((m) => ({
          id: m.id,
          name: m.name,
          role: m.role,
          cells: ITEMS.map((it) => ({ key: it.key, name: it.name, allowed: m.perms[it.key] !== false })),
        }));
        this.setData({ members, loading: false });
      })
      .catch(() => this.setData({ loading: false }));
  },

  toggle(e) {
    const { mid, key } = e.currentTarget.dataset;
    const members = this.data.members.map((m) => {
      if (m.id !== mid) return m;
      return Object.assign({}, m, {
        cells: m.cells.map((c) => (c.key === key ? Object.assign({}, c, { allowed: !c.allowed }) : c)),
      });
    });
    const target = members.find((m) => m.id === mid);
    const cell = target.cells.find((c) => c.key === key);
    this.setData({ members });
    invalidate();
    call('game.setPerm', { id: mid, key, allowed: cell.allowed }).catch(() => {
      this.load(); // 失败回滚为服务端状态
    });
  },
});
