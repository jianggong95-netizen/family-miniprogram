const api = require('./services/api');
const { CLOUD_ENV_ID } = require('./utils/config');

App({
  globalData: {
    openid: '',
    member: null,
    family: null,
    dicts: null,
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true });
    }
    this.globalData.openid = wx.getStorageSync('openid') || '';
    this.globalData.member = wx.getStorageSync('member') || null;
    this.globalData.family = wx.getStorageSync('family') || null;
  },

  /**
   * 确保登录并返回 member；未绑定则跳转到绑定页
   * 云开发模式：身份由云函数上下文 OPENID 确定，无需 wx.login code
   */
  async ensureLogin() {
    if (this.globalData.member) return this.globalData.member;

    const data = await api.login();

    wx.setStorageSync('openid', data.openid);
    this.globalData.openid = data.openid;

    if (data.needBind) {
      wx.redirectTo({ url: '/pages/bind/bind' });
      return null;
    }

    this.setSession(data);
    return this.globalData.member;
  },

  /** 保存登录态（登录/绑定成功后调用） */
  setSession(data) {
    wx.setStorageSync('openid', data.openid);
    wx.setStorageSync('member', data.member);
    wx.setStorageSync('family', data.family);
    this.globalData.openid = data.openid;
    this.globalData.member = data.member;
    this.globalData.family = data.family;
  },

  /** 拉取字典并缓存到 globalData */
  async loadDicts(force) {
    if (this.globalData.dicts && !force) return this.globalData.dicts;
    const dicts = await api.getDicts();
    this.globalData.dicts = dicts;
    return dicts;
  },

  /** 退出（清理本地缓存） */
  clearSession() {
    wx.removeStorageSync('openid');
    wx.removeStorageSync('member');
    wx.removeStorageSync('family');
    this.globalData.openid = '';
    this.globalData.member = null;
    this.globalData.family = null;
  },
});
