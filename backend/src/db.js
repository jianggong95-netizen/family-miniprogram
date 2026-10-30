const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');
const { genInviteCode, now } = require('./utils');

// 确保目录存在
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS families (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id  INTEGER NOT NULL REFERENCES families(id),
  name       TEXT NOT NULL,
  openid     TEXT UNIQUE,
  role       TEXT NOT NULL DEFAULT 'member',   -- admin | member
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clothes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id      INTEGER NOT NULL REFERENCES families(id),
  owner_id       INTEGER NOT NULL REFERENCES members(id),
  name           TEXT NOT NULL,
  category       TEXT DEFAULT '',
  sub_category   TEXT DEFAULT '',
  color          TEXT DEFAULT '',
  season         TEXT DEFAULT '四季通用',
  size           TEXT DEFAULT '',
  brand          TEXT DEFAULT '',
  material       TEXT DEFAULT '',
  quantity       INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT '在库',  -- 在库 | 借出 | 已处理
  location       TEXT DEFAULT '',
  purchase_price REAL,
  purchase_date  TEXT DEFAULT '',
  tags           TEXT DEFAULT '',
  note           TEXT DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_clothes_family ON clothes(family_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_clothes_owner ON clothes(owner_id);

CREATE TABLE IF NOT EXISTS clothing_images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  clothing_id INTEGER NOT NULL REFERENCES clothes(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,            -- 文件相对路径，如 /uploads/xxx.jpg
  is_cover    INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_images_clothing ON clothing_images(clothing_id);

CREATE TABLE IF NOT EXISTS stock_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  clothing_id INTEGER NOT NULL REFERENCES clothes(id),
  type        TEXT NOT NULL,             -- 入库 | 出库 | 借出 | 归还 | 转赠 | 清理
  quantity    INTEGER NOT NULL,
  price       REAL,
  counterparty TEXT DEFAULT '',          -- 来源/去向
  operator_id INTEGER REFERENCES members(id),
  note        TEXT DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_records_clothing ON stock_records(clothing_id);

CREATE TABLE IF NOT EXISTS dicts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id  INTEGER NOT NULL,
  dict_type  TEXT NOT NULL,              -- category | color | season | location
  name       TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  UNIQUE(family_id, dict_type, name)
);
`;

db.exec(SCHEMA);

// ---------- 种子字典（新家庭自动生成） ----------
const SEED_DICTS = {
  category: ['上衣', '下装', '连衣裙', '外套', '内衣', '袜子', '鞋类', '配饰', '家居服', '泳装', '其他'],
  color: ['红色', '橙色', '黄色', '绿色', '蓝色', '紫色', '黑色', '白色', '灰色', '粉色', '棕色', '米色', '卡其', '藏青', '酒红', '多色', '其他'],
  season: ['春', '夏', '秋', '冬', '四季通用'],
  location: ['衣柜-主卧', '衣柜-次卧', '玄关柜', '储物间', '行李箱', '其他'],
};

const stmtInsertDict = db.prepare(
  'INSERT OR IGNORE INTO dicts (family_id, dict_type, name, sort) VALUES (?, ?, ?, ?)'
);

function seedDicts(familyId) {
  const tx = db.transaction(() => {
    for (const type of Object.keys(SEED_DICTS)) {
      SEED_DICTS[type].forEach((name, i) => {
        stmtInsertDict.run(familyId, type, name, i);
      });
    }
  });
  tx();
}

// ---------- 查询封装 ----------
const q = {
  // 家庭
  familyById: db.prepare('SELECT * FROM families WHERE id = ?'),
  familyByCode: db.prepare('SELECT * FROM families WHERE invite_code = ?'),
  createFamily: db.prepare(
    'INSERT INTO families (name, invite_code, created_at) VALUES (?, ?, ?)'
  ),

  // 成员
  memberByOpenid: db.prepare('SELECT * FROM members WHERE openid = ? AND is_active = 1'),
  memberById: db.prepare('SELECT * FROM members WHERE id = ?'),
  membersByFamily: db.prepare(
    'SELECT m.*, (SELECT COUNT(*) FROM clothes c WHERE c.owner_id = m.id AND c.deleted_at IS NULL) AS clothing_count FROM members m WHERE m.family_id = ? ORDER BY (m.role = \'admin\') DESC, m.id ASC'
  ),
  unboundMembersByFamily: db.prepare(
    'SELECT * FROM members WHERE family_id = ? AND (openid IS NULL OR openid = \'\') AND is_active = 1'
  ),
  createMember: db.prepare(
    'INSERT INTO members (family_id, name, openid, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  bindMember: db.prepare('UPDATE members SET openid = ? WHERE id = ?'),
  updateMember: db.prepare(
    'UPDATE members SET name = ?, role = ?, is_active = ? WHERE id = ?'
  ),

  // 衣服
  insertClothes: db.prepare(`
    INSERT INTO clothes (family_id, owner_id, name, category, sub_category, color, season, size, brand,
      material, quantity, status, location, purchase_price, purchase_date, tags, note, created_at, updated_at)
    VALUES (@family_id, @owner_id, @name, @category, @sub_category, @color, @season, @size, @brand,
      @material, @quantity, @status, @location, @purchase_price, @purchase_date, @tags, @note, @created_at, @updated_at)
  `),
  updateClothes: db.prepare(`
    UPDATE clothes SET name = @name, owner_id = @owner_id, category = @category, sub_category = @sub_category,
      color = @color, season = @season, size = @size, brand = @brand, material = @material,
      quantity = @quantity, location = @location, purchase_price = @purchase_price,
      purchase_date = @purchase_date, tags = @tags, note = @note, updated_at = @updated_at
    WHERE id = @id AND family_id = @family_id
  `),
  clothesById: db.prepare(
    'SELECT * FROM clothes WHERE id = ? AND deleted_at IS NULL'
  ),
  softDeleteClothes: db.prepare(
    "UPDATE clothes SET deleted_at = ?, updated_at = ? WHERE id = ? AND family_id = ?"
  ),
  // 动态列表查询在 routes/clothes.js 中用 where 拼接
  imagesByClothing: db.prepare(
    'SELECT * FROM clothing_images WHERE clothing_id = ? ORDER BY sort ASC, id ASC'
  ),
  insertImage: db.prepare(
    'INSERT INTO clothing_images (clothing_id, path, is_cover, sort, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  imageById: db.prepare('SELECT * FROM clothing_images WHERE id = ?'),
  deleteImage: db.prepare('DELETE FROM clothing_images WHERE id = ? AND clothing_id = ?'),
  updateCover: db.prepare(
    'UPDATE clothing_images SET is_cover = 0 WHERE clothing_id = ?'
  ),

  // 进销存
  insertStock: db.prepare(`
    INSERT INTO stock_records (clothing_id, type, quantity, price, counterparty, operator_id, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  stockByClothing: db.prepare(
    'SELECT s.*, m.name AS operator_name FROM stock_records s LEFT JOIN members m ON m.id = s.operator_id WHERE s.clothing_id = ? ORDER BY s.id DESC LIMIT 200'
  ),
  recentStock: db.prepare(`
    SELECT s.*, c.name AS clothing_name, m.name AS operator_name
    FROM stock_records s
    JOIN clothes c ON c.id = s.clothing_id
    LEFT JOIN members m ON m.id = s.operator_id
    WHERE c.family_id = ?
    ORDER BY s.id DESC LIMIT 15
  `),
  updateQuantity: db.prepare(
    'UPDATE clothes SET quantity = ?, status = ?, updated_at = ? WHERE id = ?'
  ),

  // 统计
  statsTotal: db.prepare(
    'SELECT COUNT(*) AS total, COALESCE(SUM(quantity), 0) AS pieces FROM clothes WHERE family_id = ? AND deleted_at IS NULL'
  ),
  statsByStatus: db.prepare(
    'SELECT status, COUNT(*) AS cnt FROM clothes WHERE family_id = ? AND deleted_at IS NULL GROUP BY status'
  ),
  statsByOwner: db.prepare(`
    SELECT m.id, m.name, COUNT(c.id) AS cnt
    FROM members m
    LEFT JOIN clothes c ON c.owner_id = m.id AND c.deleted_at IS NULL
    WHERE m.family_id = ? AND m.is_active = 1
    GROUP BY m.id ORDER BY cnt DESC
  `),
  statsBySeason: db.prepare(
    'SELECT season, COUNT(*) AS cnt FROM clothes WHERE family_id = ? AND deleted_at IS NULL GROUP BY season'
  ),
  statsByCategory: db.prepare(
    'SELECT category, COUNT(*) AS cnt FROM clothes WHERE family_id = ? AND deleted_at IS NULL GROUP BY category ORDER BY cnt DESC LIMIT 8'
  ),
  statsByColor: db.prepare(
    'SELECT color, COUNT(*) AS cnt FROM clothes WHERE family_id = ? AND deleted_at IS NULL GROUP BY color ORDER BY cnt DESC LIMIT 8'
  ),
  monthIn: db.prepare(`
    SELECT COUNT(*) AS cnt FROM stock_records s JOIN clothes c ON c.id = s.clothing_id
    WHERE c.family_id = ? AND s.type = '入库' AND s.created_at >= ?
  `),
  monthOut: db.prepare(`
    SELECT COUNT(*) AS cnt FROM stock_records s JOIN clothes c ON c.id = s.clothing_id
    WHERE c.family_id = ? AND s.type IN ('出库','转赠','清理') AND s.created_at >= ?
  `),

  // 字典
  dictsByFamily: db.prepare(
    'SELECT * FROM dicts WHERE family_id = ? ORDER BY dict_type, sort ASC, id ASC'
  ),
  dictById: db.prepare('SELECT * FROM dicts WHERE id = ? AND family_id = ?'),
  deleteDict: db.prepare('DELETE FROM dicts WHERE id = ? AND family_id = ?'),
};

// ---------- 对外函数 ----------
function getOrCreateFamily(name) {
  const familyId = q.createFamily.run(name, genInviteCode(), now()).lastInsertRowid;
  seedDicts(familyId);
  return q.familyById.get(familyId);
}

function createMember({ familyId, name, openid = null, role = 'member' }) {
  return q.createMember.run(familyId, name, openid, role, now()).lastInsertRowid;
}

module.exports = { db, q, getOrCreateFamily, createMember, seedDicts };
