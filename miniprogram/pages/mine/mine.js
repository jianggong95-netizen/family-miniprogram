const app = getApp();
const api = require('../../services/api');

Page({
  data: {
    member: null,
    family: null,
  },

  onShow() {
    this.setData({
      member: app.globalData.member,
      family: app.globalData.family,
    });
  },

  goMembers() {
    wx.navigateTo({ url: '/pages/members/members' });
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  goGames() {
    wx.navigateTo({ url: '/pages/games/games' });
  },

  goStudy() {
    wx.navigateTo({ url: '/pages/study/study' });
  },

  goCloset() {
    wx.switchTab({ url: '/pages/closet/closet' });
  },

  onShareAppMessage() {
    return { title: '我的家庭衣橱' };
  },
});
