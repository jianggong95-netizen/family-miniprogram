/**
 * 统一请求封装（微信云开发版）
 *
 * 所有业务请求走云函数 closetApi（action 路由），不再依赖自建服务器的
 * IP / 域名 / 隧道。图片走云存储直传与临时链接展示。
 */
const { CLOUD_ENV_ID } = require('./config');

let inited = false;
function ensureCloud() {
  if (inited || !wx.cloud) return;
  wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true });
  inited = true;
}

function getToken() {
  return wx.getStorageSync('openid') || '';
}

/**
 * 调用云函数，保持与原 request 相同的 resolve/reject 契约：
 *   resolve(data) / reject({code,message})
 */
function call(action, data = {}) {
  ensureCloud();
  return new Promise((resolve, reject) => {
    wx.cloud
      .callFunction({ name: 'closetApi', data: { action, ...data } })
      .then((res) => {
        const body = (res && res.result) || {};
        if (body.code === 401) {
          const pages = getCurrentPages();
          const current = pages.length ? pages[pages.length - 1].route : '';
          if (current !== 'pages/bind/bind') {
            wx.reLaunch({ url: '/pages/bind/bind' });
          }
          reject(body);
          return;
        }
        if (body.code === 0) {
          resolve(body.data);
        } else {
          wx.showToast({ title: body.message || '请求失败', icon: 'none' });
          reject(body);
        }
      })
      .catch((err) => {
        wx.showToast({ title: '网络异常，请重试', icon: 'none', duration: 2500 });
        reject(err);
      });
  });
}

/** 图片地址：云存储 fileID 原样返回（<image> 支持 cloud://；预览走 imageFileUrl） */
function imgUrl(path) {
  if (!path) return '';
  return path;
}

/**
 * 图片本地化加载：cloud:// fileID → 临时 https 链接。
 * 换链接走云函数 system.tempUrls（管理员权限），
 * 不受存储"仅创建者可读写"限制，家庭成员互相可见图片。
 * 带过期缓存（临时链接约 2 小时有效，这里按 100 分钟保守重取）。
 */
const tempUrlCache = new Map(); // fileID -> { url, expireAt }
const pending = new Map();      // fileID -> Promise<url>

function imageFileUrl(url) {
  if (!url) return Promise.resolve('');
  // 非云存储地址（http/本地临时文件）直接返回
  if (!/^cloud:\/\//.test(url)) return Promise.resolve(url);

  const hit = tempUrlCache.get(url);
  if (hit && hit.expireAt > Date.now()) return Promise.resolve(hit.url);
  if (pending.has(url)) return pending.get(url);

  ensureCloud();
  const p = wx.cloud
    .callFunction({ name: 'closetApi', data: { action: 'system.tempUrls', fileIDs: [url] } })
    .then((res) => {
      const body = (res && res.result) || {};
      const finalUrl = (body.data && body.data.urls && body.data.urls[url]) || url;
      tempUrlCache.set(url, { url: finalUrl, expireAt: Date.now() + 100 * 60 * 1000 });
      pending.delete(url);
      return finalUrl;
    })
    .catch(() => {
      pending.delete(url);
      return url;
    });

  pending.set(url, p);
  return p;
}

module.exports = { call, getToken, imgUrl, imageFileUrl };
