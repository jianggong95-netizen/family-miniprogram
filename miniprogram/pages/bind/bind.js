const app = getApp();
const api = require('../../services/api');

Page({
  data: {
    mode: 'create',          // create | join
    familyName: '',
    inviteCode: '',
    joinResult: null,        // { family, members }
    selectedMemberId: null,
    submitting: false,
  },

  switchMode(e) {
    this.setData({
      mode: e.currentTarget.dataset.mode,
      joinResult: null,
      selectedMemberId: null,
    });
  },

  onFamilyNameInput(e) {
    this.setData({ familyName: e.detail.value });
  },

  onInviteInput(e) {
    this.setData({ inviteCode: e.detail.value.toUpperCase() });
  },

  async createFamily() {
    const name = this.data.familyName.trim();
    if (!name) {
      wx.showToast({ title: '请输入家庭名称', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      const res = await api.createFamily(name);
      app.setSession({ openid: app.globalData.openid, member: res.member, family: res.family });
      wx.showToast({ title: '创建成功', icon: 'success' });
      this.enter();
    } catch (e) {
      this.setData({ submitting: false });
    }
  },

  async searchFamily() {
    const code = this.data.inviteCode.trim();
    if (!code) {
      wx.showToast({ title: '请输入邀请码', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      const res = await api.joinFamily(code);
      this.setData({ joinResult: res, selectedMemberId: res.members[0] ? res.members[0].id : null, submitting: false });
    } catch (e) {
      this.setData({ submitting: false });
    }
  },

  pickMember(e) {
    this.setData({ selectedMemberId: e.currentTarget.dataset.id });
  },

  async bindMe() {
    if (!this.data.selectedMemberId) {
      wx.showToast({ title: '请选择你的名字', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      const member = await api.bindMember(this.data.selectedMemberId, app.globalData.openid);
      const family = this.data.joinResult.family;
      app.setSession({ openid: app.globalData.openid, member, family });
      wx.showToast({ title: '绑定成功', icon: 'success' });
      this.enter();
    } catch (e) {
      this.setData({ submitting: false });
    }
  },

  enter() {
    setTimeout(() => {
      wx.switchTab({ url: '/pages/dashboard/dashboard' });
    }, 600);
  },
});
