const app = getApp();
const api = require('../../services/api');

Page({
  data: {
    members: [],
    isAdmin: false,
    newName: '',
    family: null,
  },

  onShow() {
    this.load();
  },

  async load() {
    const member = app.globalData.member;
    if (!member) return;
    this.setData({ isAdmin: member.role === 'admin', family: app.globalData.family });
    try {
      const res = await api.getFamily();
      this.setData({ members: res.members, family: res.family });
    } catch (e) {}
  },

  onNameInput(e) {
    this.setData({ newName: e.detail.value });
  },

  async addMember() {
    const name = this.data.newName.trim();
    if (!name) {
      wx.showToast({ title: '请输入名字', icon: 'none' });
      return;
    }
    try {
      await api.addMember(name);
      this.setData({ newName: '' });
      wx.showToast({ title: '已添加', icon: 'success' });
      this.load();
    } catch (e) {}
  },

  toggleActive(e) {
    const { id, active, name } = e.currentTarget.dataset;
    wx.showModal({
      title: active ? '停用该成员？' : '恢复该成员？',
      content: `${name}${active ? '将无法登录使用' : '恢复后需重新绑定微信'}`,
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.updateMember(id, { is_active: active ? 0 : 1 });
          this.load();
        } catch (err) {}
      },
    });
  },

  goCloset() {
    wx.switchTab({ url: '/pages/closet/closet' });
  },
});
