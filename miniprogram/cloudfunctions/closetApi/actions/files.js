const cloud = require('wx-server-sdk');
const { ok } = require('../lib/utils');

/**
 * system.tempUrls：云函数侧（管理员权限）批量换取云存储临时链接。
 * 不受存储"仅创建者可读写"权限影响，保证家庭成员互相可见图片。
 */
async function tempUrls(event, ctx) {
  const fileIDs = Array.isArray(event.fileIDs) ? event.fileIDs.filter(Boolean) : [];
  if (!fileIDs.length) return ok({ urls: {} });

  const res = await cloud.getTempFileURL({ fileList: fileIDs });
  const urls = {};
  (res.fileList || []).forEach((f) => {
    if (f.status === 0 && f.tempFileURL) urls[f.fileID] = f.tempFileURL;
  });
  return ok({ urls });
}

module.exports = { 'system.tempUrls': tempUrls };
