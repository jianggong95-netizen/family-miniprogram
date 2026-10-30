const app = getApp();
const api = require('../../services/api');

const TYPE_CLASS = { '入库': 'in', '出库': 'out', '借出': 'borrow', '归还': 'return', '转赠': 'gift', '清理': 'clean' };

Page({
  data: {
    member: null,
    family: null,
    overview: null,
    loading: true,
    error: '',
  },

  onShow() {
    this.init();
  },

  async init() {
    try {
      const member = await app.ensureLogin();
      if (!member) {
        this.setData({ loading: false, error: '请先绑定身份' });
        return;
      }
      this.setData({ member, family: app.globalData.family, error: '' });
      this.loadOverview();
    } catch (e) {
      this.setData({ loading: false, error: '网络错误，请检查后端是否启动' });
    }
  },

  async loadOverview() {
    try {
      const overview = await api.getOverview();
      if (overview && overview.recent) {
        overview.recent = overview.recent.map((r) => ({ ...r, typeCls: TYPE_CLASS[r.type] || '' }));
      }
      this.setData({ overview, loading: false });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  onPullDownRefresh() {
    this.loadOverview().finally(() => wx.stopPullDownRefresh());
  },

  goCloset() {
    wx.switchTab({ url: '/pages/closet/closet' });
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/edit/edit' });
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` });
  },

  goMembers() {
    wx.navigateTo({ url: '/pages/members/members' });
  },

  goReport() {
    wx.switchTab({ url: '/pages/report/report' });
  },
});
