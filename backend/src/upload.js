const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { q, db } = require('./db');
const { now } = require('./utils');

// 确保图片目录存在
fs.mkdirSync(config.imagesDir, { recursive: true });

/**
 * 保存上传的图片文件，返回 { path }（对外路径 /uploads/xxx.jpg）
 */
function saveImage(buffer, originalName) {
  const ext = (path.extname(originalName || '') || '.jpg').toLowerCase().slice(0, 8);
  const filename = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
  const absPath = path.join(config.imagesDir, filename);
  fs.writeFileSync(absPath, buffer);
  return `/uploads/${filename}`;
}

/**
 * 删除图片文件（连同数据库记录）
 */
function deleteImage(imgId, clothingId) {
  const row = q.imageById.get(imgId);
  if (!row || row.clothing_id !== clothingId) return false;
  q.deleteImage.run(imgId, clothingId);
  try {
    const filename = path.basename(row.path);
    fs.unlinkSync(path.join(config.imagesDir, filename));
  } catch (e) {
    // 文件可能已被手动清理，忽略
  }
  return true;
}

/**
 * 为一件衣服新增图片记录（自动设置首张为封面）
 */
function addImageRecord(clothingId, urlPath) {
  const images = q.imagesByClothing.all(clothingId);
  const isCover = images.length === 0 ? 1 : 0;
  q.insertImage.run(clothingId, urlPath, isCover, images.length, now());
  return q.imagesByClothing.all(clothingId);
}

module.exports = { saveImage, deleteImage, addImageRecord };
