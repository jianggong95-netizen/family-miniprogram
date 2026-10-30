// ================= 模拟数据开关 =================
// 设为 true 时使用本地模拟数据，无需云环境即可测试
// 部署时保持 false
const USE_MOCK = false;
// ===============================================

let mock = null;
if (USE_MOCK) {
  mock = require('./mock-data');
}

const { call, imgUrl } = require('../utils/request');

function extOf(filePath) {
  const m = /\.(\w{2,5})$/.exec(filePath || '');
  return m ? m[1].toLowerCase() : 'jpg';
}

const app = () => getApp();

const api = {
  // 登录 / 家庭
  login: () => {
    if (USE_MOCK) return Promise.resolve(mock.login(''));
    return call('auth.login');
  },
  createFamily: (name) => {
    if (USE_MOCK) return Promise.resolve(mock.createFamily(name));
    return call('family.create', { name });
  },
  joinFamily: (code) => {
    if (USE_MOCK) return Promise.resolve(mock.joinFamily(code));
    return call('family.join', { code });
  },
  bindMember: (id) => {
    if (USE_MOCK) return Promise.resolve(mock.bindMember(id));
    return call('member.bind', { id: String(id) });
  },
  getFamily: () => {
    if (USE_MOCK) return Promise.resolve(mock.getFamily());
    return call('family.get');
  },

  // 成员
  addMember: (name) => {
    if (USE_MOCK) return Promise.resolve(mock.addMember(name));
    return call('member.add', { name });
  },
  updateMember: (id, data) => {
    if (USE_MOCK) return Promise.resolve(mock.updateMember(id, data));
    return call('member.update', { id: String(id), data });
  },

  // 衣服
  listClothes: (params = {}) => {
    if (USE_MOCK) return Promise.resolve(mock.listClothes(params));
    return call('clothes.list', params);
  },
  getClothes: (id) => {
    if (USE_MOCK) return Promise.resolve(mock.getClothes(id));
    return call('clothes.get', { id: String(id) });
  },
  createClothes: (data) => {
    if (USE_MOCK) return Promise.resolve(mock.createClothes(data));
    return call('clothes.create', { data });
  },
  updateClothes: (id, data) => {
    if (USE_MOCK) return Promise.resolve(mock.updateClothes(id, data));
    return call('clothes.update', { id: String(id), data });
  },
  deleteClothes: (id) => {
    if (USE_MOCK) return Promise.resolve(mock.deleteClothes(id));
    return call('clothes.delete', { id: String(id) });
  },

  // 图片：wx.cloud.uploadFile 直传云存储 → 云函数入库
  uploadImages: async (id, filePaths) => {
    if (USE_MOCK) return Promise.resolve(mock.uploadImages(id, filePaths));
    const g = app().globalData;
    const familyId = (g.family && g.family.id) || 'unknown';
    const openid = g.openid || 'anon';

    const fileIDs = [];
    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      const cloudPath = `clothes/${familyId}/${id}/${openid}-${Date.now()}-${i}.${extOf(filePath)}`;
      const res = await wx.cloud.uploadFile({ cloudPath, filePath });
      if (res && res.fileID) fileIDs.push(res.fileID);
    }
    if (!fileIDs.length) throw { code: 1, message: '图片上传失败' };
    return call('clothes.addImages', { id: String(id), fileIDs });
  },
  deleteImage: (id, imgId) => {
    if (USE_MOCK) return Promise.resolve(mock.deleteImage(id, imgId));
    return call('clothes.removeImage', { id: String(id), imgId: String(imgId) });
  },

  // 进销存
  createStock: (id, data) => {
    if (USE_MOCK) return Promise.resolve(mock.createStock(id, data));
    return call('stock.create', { id: String(id), data });
  },
  listRecords: (id) => {
    if (USE_MOCK) return Promise.resolve(mock.listRecords(id));
    return call('stock.records', { id: String(id) });
  },

  // 统计
  getOverview: () => {
    if (USE_MOCK) return Promise.resolve(mock.getOverview());
    return call('stats.overview');
  },
  getReport: (params = {}) => {
    if (USE_MOCK) return Promise.resolve(mock.getReport(params));
    return call('stats.report', params);
  },

  // 字典
  getDicts: () => {
    if (USE_MOCK) return Promise.resolve(mock.getDicts());
    return call('dicts.get');
  },
  addDict: (dict_type, name) => {
    if (USE_MOCK) return Promise.resolve(mock.addDict(dict_type, name));
    return call('dicts.add', { dict_type, name });
  },
  deleteDict: (id) => {
    if (USE_MOCK) return Promise.resolve(mock.deleteDict(id));
    return call('dicts.remove', { id: String(id) });
  },
};

module.exports = api;
module.exports.imgUrl = imgUrl;
