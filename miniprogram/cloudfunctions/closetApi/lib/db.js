/**
 * 种子字典（移植自 backend/src/db.js SEED_DICTS）
 */
const SEED_DICTS = {
  category: ['上衣', '下装', '连衣裙', '外套', '内衣', '袜子', '鞋类', '配饰', '家居服', '泳装', '其他'],
  color: ['红色', '橙色', '黄色', '绿色', '蓝色', '紫色', '黑色', '白色', '灰色', '粉色', '棕色', '米色', '卡其', '藏青', '酒红', '多色', '其他'],
  season: ['春', '夏', '秋', '冬', '四季通用'],
  location: ['衣柜-主卧', '衣柜-次卧', '玄关柜', '储物间', '行李箱', '其他'],
};

/** 为新家庭写入种子字典 */
async function seedDicts(db, familyId) {
  const tasks = [];
  for (const type of Object.keys(SEED_DICTS)) {
    SEED_DICTS[type].forEach((name, i) => {
      tasks.push(
        db.collection('dicts').add({ data: { family_id: familyId, dict_type: type, name, sort: i } })
      );
    });
  }
  await Promise.all(tasks);
}

module.exports = { SEED_DICTS, seedDicts };
