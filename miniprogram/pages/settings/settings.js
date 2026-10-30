const app = getApp();
const api = require('../../services/api');

const TYPES = [
  { key: 'category', label: '种类' },
  { key: 'color', label: '颜色' },
  { key: 'season', label: '季节' },
  { key: 'location', label: '存放位置' },
];

Page({
  data: {
    isAdmin: false,
    types: TYPES,
    dicts: {},
    activeType: 'category',
    activeLabel: '种类',
    newName: '',
  },

  onShow() {
    this.load();
  },

  async load() {
    const member = app.globalData.member;
    if (!member) return;
    this.setData({ isAdmin: member.role === 'admin' });
    try {
      const dicts = await app.loadDicts(true);
      this.setData({ dicts });
    } catch (e) {}
  },

  switchType(e) {
    const key = e.currentTarget.dataset.key;
    const t = TYPES.find((t) => t.key === key);
    this.setData({ activeType: key, activeLabel: t ? t.label : '', newName: '' });
  },

  onNameInput(e) {
    this.setData({ newName: e.detail.value });
  },

  async addItem() {
    const name = this.data.newName.trim();
    if (!name) {
      wx.showToast({ title: '请输入名称', icon: 'none' });
      return;
    }
    try {
      await api.addDict(this.data.activeType, name);
      this.setData({ newName: '' });
      wx.showToast({ title: '已添加', icon: 'success' });
      this.load();
    } catch (e) {}
  },

  removeItem(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除该选项？',
      content: `删除「${name}」后，已用该分类的衣服不受影响`,
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteDict(id);
          this.load();
        } catch (err) {}
      },
    });
  },
});
