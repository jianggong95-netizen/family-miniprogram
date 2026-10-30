#!/bin/bash
# ============================================
# 家庭衣橱后端 - 飞牛OS 一键部署脚本
# 用法: SSH登录飞牛后，粘贴此脚本内容执行
# ============================================
set -e

DEPLOY_DIR="/vol1/closet"
BACKEND_DIR="${DEPLOY_DIR}/backend"

echo "=========================================="
echo "  家庭衣橱后端 - 飞牛OS 一键部署"
echo "=========================================="

# 1. 创建目录
echo ""
echo "[1/5] 创建部署目录..."
mkdir -p "${BACKEND_DIR}/src/routes"
mkdir -p "${DEPLOY_DIR}/data"
mkdir -p "${DEPLOY_DIR}/images"
echo "  完成"

# 2. 写入 package.json
echo "[2/5] 写入后端代码..."
cat > "${BACKEND_DIR}/package.json" << 'PKGJSON'
{
  "name": "closet-api",
  "version": "1.0.0",
  "description": "家庭衣橱进销存后端（飞牛OS Docker 部署）",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "@fastify/multipart": "^8.3.1",
    "@fastify/static": "^7.0.4",
    "better-sqlite3": "^11.3.0",
    "fastify": "^4.28.1"
  }
}
PKGJSON

# 3. 写入 Dockerfile
cat > "${BACKEND_DIR}/Dockerfile" << 'DOCKERFILE'
FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
DOCKERFILE

# 4. 写入后端源码
cat > "${BACKEND_DIR}/src/config.js" << 'CONFIGJS'
const path = require('path');

const config = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'closet.db'),
  imagesDir: process.env.IMAGES_DIR || path.join(__dirname, '..', 'images'),
  wxAppid: process.env.WX_APPID || '',
  wxSecret: process.env.WX_SECRET || '',
  get devMode() {
    return !(this.wxAppid && this.wxSecret);
  },
};

module.exports = config;
CONFIGJS

cat > "${BACKEND_DIR}/src/utils.js" << 'UTILSJS'
function ok(data) {
  return { code: 0, data: data ?? null, message: 'ok' };
}

function fail(message, code = 1) {
  return { code, data: null, message };
}

function genInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

module.exports = { ok, fail, genInviteCode, now, pick };
UTILSJS

cat > "${BACKEND_DIR}/src/db.js" << 'DBJS'
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');
const { genInviteCode, now } = require('./utils');

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
  role       TEXT NOT NULL DEFAULT 'member',
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
  status         TEXT NOT NULL DEFAULT '在库',
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
  path        TEXT NOT NULL,
  is_cover    INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_images_clothing ON clothing_images(clothing_id);

CREATE TABLE IF NOT EXISTS stock_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  clothing_id INTEGER NOT NULL REFERENCES clothes(id),
  type        TEXT NOT NULL,
  quantity    INTEGER NOT NULL,
  price       REAL,
  counterparty TEXT DEFAULT '',
  operator_id INTEGER REFERENCES members(id),
  note        TEXT DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_records_clothing ON stock_records(clothing_id);

CREATE TABLE IF NOT EXISTS dicts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id  INTEGER NOT NULL,
  dict_type  TEXT NOT NULL,
  name       TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  UNIQUE(family_id, dict_type, name)
);
`;

db.exec(SCHEMA);

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

const q = {
  familyById: db.prepare('SELECT * FROM families WHERE id = ?'),
  familyByCode: db.prepare('SELECT * FROM families WHERE invite_code = ?'),
  createFamily: db.prepare(
    'INSERT INTO families (name, invite_code, created_at) VALUES (?, ?, ?)'
  ),
  memberByOpenid: db.prepare('SELECT * FROM members WHERE openid = ? AND is_active = 1'),
  memberById: db.prepare('SELECT * FROM members WHERE id = ?'),
  membersByFamily: db.prepare(
    "SELECT m.*, (SELECT COUNT(*) FROM clothes c WHERE c.owner_id = m.id AND c.deleted_at IS NULL) AS clothing_count FROM members m WHERE m.family_id = ? ORDER BY (m.role = 'admin') DESC, m.id ASC"
  ),
  unboundMembersByFamily: db.prepare(
    "SELECT * FROM members WHERE family_id = ? AND (openid IS NULL OR openid = '') AND is_active = 1"
  ),
  createMember: db.prepare(
    'INSERT INTO members (family_id, name, openid, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ),
  bindMember: db.prepare('UPDATE members SET openid = ? WHERE id = ?'),
  updateMember: db.prepare(
    'UPDATE members SET name = ?, role = ?, is_active = ? WHERE id = ?'
  ),
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
  dictsByFamily: db.prepare(
    'SELECT * FROM dicts WHERE family_id = ? ORDER BY dict_type, sort ASC, id ASC'
  ),
  dictById: db.prepare('SELECT * FROM dicts WHERE id = ? AND family_id = ?'),
  deleteDict: db.prepare('DELETE FROM dicts WHERE id = ? AND family_id = ?'),
};

function getOrCreateFamily(name) {
  const familyId = q.createFamily.run(name, genInviteCode(), now()).lastInsertRowid;
  seedDicts(familyId);
  return q.familyById.get(familyId);
}

function createMember({ familyId, name, openid = null, role = 'member' }) {
  return q.createMember.run(familyId, name, openid, role, now()).lastInsertRowid;
}

module.exports = { db, q, getOrCreateFamily, createMember, seedDicts };
DBJS

cat > "${BACKEND_DIR}/src/auth.js" << 'AUTHJS'
const config = require('./config');
const { q } = require('./db');

async function code2Session(code) {
  if (config.devMode) {
    return { openid: `dev_${code || 'devuser'}` };
  }
  const url =
    'https://api.weixin.qq.com/sns/jscode2session' +
    `?appid=${config.wxAppid}&secret=${config.wxSecret}` +
    `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.openid) {
    throw new Error(`微信登录失败: ${data.errmsg || '未知错误'}`);
  }
  return data;
}

async function authRequired(req, reply) {
  const openid = req.headers['x-token'];
  if (!openid) {
    return reply.code(401).send({ code: 401, data: null, message: '未登录' });
  }
  const member = q.memberByOpenid.get(openid);
  if (!member) {
    return reply.code(401).send({ code: 401, data: null, message: '账号未绑定家庭成员' });
  }
  req.member = member;
}

function openidOptional(req, reply, done) {
  const openid = req.headers['x-token'];
  if (openid) {
    const member = q.memberByOpenid.get(openid);
    if (member) {
      req.member = member;
    } else {
      req.openid = openid;
    }
  }
  done();
}

module.exports = { code2Session, authRequired, openidOptional };
AUTHJS

cat > "${BACKEND_DIR}/src/upload.js" << 'UPLOADJS'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { q } = require('./db');
const { now } = require('./utils');

fs.mkdirSync(config.imagesDir, { recursive: true });

function saveImage(buffer, originalName) {
  const ext = (path.extname(originalName || '') || '.jpg').toLowerCase().slice(0, 8);
  const filename = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
  const absPath = path.join(config.imagesDir, filename);
  fs.writeFileSync(absPath, buffer);
  return `/uploads/${filename}`;
}

function deleteImage(imgId, clothingId) {
  const row = q.imageById.get(imgId);
  if (!row || row.clothing_id !== clothingId) return false;
  q.deleteImage.run(imgId, clothingId);
  try {
    const filename = path.basename(row.path);
    fs.unlinkSync(path.join(config.imagesDir, filename));
  } catch (e) {}
  return true;
}

function addImageRecord(clothingId, urlPath) {
  const images = q.imagesByClothing.all(clothingId);
  const isCover = images.length === 0 ? 1 : 0;
  q.insertImage.run(clothingId, urlPath, isCover, images.length, now());
  return q.imagesByClothing.all(clothingId);
}

module.exports = { saveImage, deleteImage, addImageRecord };
UPLOADJS

cat > "${BACKEND_DIR}/src/server.js" << 'SERVERJS'
const path = require('path');
const fs = require('fs');
const fastify = require('fastify');
const config = require('./config');
const { ok } = require('./utils');

fs.mkdirSync(config.imagesDir, { recursive: true });

async function build() {
  const app = fastify({ logger: true });

  await app.register(require('@fastify/static'), {
    root: config.imagesDir,
    prefix: '/uploads/',
  });

  await app.register(require('@fastify/multipart'), {
    limits: { fileSize: 10 * 1024 * 1024, files: 9 },
  });

  app.get('/api/health', async () => ok({ status: 'up', devMode: config.devMode }));

  app.register(require('./routes/auth'));
  app.register(require('./routes/family'));
  app.register(require('./routes/clothes'));
  app.register(require('./routes/stock'));
  app.register(require('./routes/stats'));
  app.register(require('./routes/dicts'));

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ code: 404, data: null, message: '接口不存在' });
  });

  return app;
}

if (require.main === module) {
  build().then((app) => {
    app.listen({ port: config.port, host: '0.0.0.0' }, (err) => {
      if (err) {
        app.log.error(err);
        process.exit(1);
      }
      app.log.info(`家庭衣橱后端已启动: http://0.0.0.0:${config.port} (devMode=${config.devMode})`);
    });
  }).catch((e) => {
    console.error('启动失败:', e);
    process.exit(1);
  });
}

module.exports = { build };
SERVERJS

cat > "${BACKEND_DIR}/src/routes/auth.js" << 'ROUTEAUTHJS'
const { code2Session } = require('../auth');
const { q } = require('../db');
const { ok, fail } = require('../utils');

async function login(req, reply) {
  const { code } = req.body || {};
  if (!code) {
    return reply.send(fail('缺少 code'));
  }
  try {
    const session = await code2Session(code);
    const openid = session.openid;
    const member = q.memberByOpenid.get(openid);
    if (!member) {
      return reply.send(ok({ needBind: true, openid }));
    }
    const family = q.familyById.get(member.family_id);
    return reply.send(ok({ needBind: false, openid, member, family }));
  } catch (e) {
    return reply.send(fail(e.message || '登录失败'));
  }
}

module.exports = async function authRoutes(app) {
  app.post('/api/auth/login', login);
};
ROUTEAUTHJS

cat > "${BACKEND_DIR}/src/routes/family.js" << 'ROUTEFAMILYJS'
const { q, getOrCreateFamily, createMember } = require('../db');
const { ok, fail } = require('../utils');

async function createFamily(req, reply) {
  const openid = req.openid;
  if (!openid) {
    return reply.send(fail('请先登录'));
  }
  const name = (req.body && req.body.name || '').trim();
  if (!name) {
    return reply.send(fail('请输入家庭名称'));
  }
  const family = getOrCreateFamily(name);
  const adminId = createMember({ familyId: family.id, name: '管理员', openid, role: 'admin' });
  const member = q.memberById.get(adminId);
  return reply.send(ok({ family, member }));
}

async function joinFamily(req, reply) {
  const code = (req.query.code || '').trim().toUpperCase();
  if (!code) {
    return reply.send(fail('请输入邀请码'));
  }
  const family = q.familyByCode.get(code);
  if (!family) {
    return reply.send(fail('邀请码无效'));
  }
  const members = q.unboundMembersByFamily.all(family.id);
  return reply.send(ok({ family, members }));
}

async function bindMember(req, reply) {
  const openid = req.openid;
  if (!openid) {
    return reply.send(fail('请先登录'));
  }
  const member = q.memberById.get(Number(req.params.id));
  if (!member || member.is_active !== 1) {
    return reply.send(fail('成员不存在'));
  }
  if (member.openid) {
    return reply.send(fail('该成员已被绑定，请联系管理员'));
  }
  const occupied = q.memberByOpenid.get(openid);
  if (occupied) {
    return reply.send(fail('当前微信已绑定其他成员'));
  }
  q.bindMember.run(openid, member.id);
  const updated = q.memberById.get(member.id);
  return reply.send(ok(updated));
}

async function getFamily(req, reply) {
  const family = q.familyById.get(req.member.family_id);
  const members = q.membersByFamily.all(family.id);
  return reply.send(ok({ family, members }));
}

async function addMember(req, reply) {
  const name = (req.body && req.body.name || '').trim();
  if (!name) {
    return reply.send(fail('请输入成员名字'));
  }
  const id = createMember({ familyId: req.member.family_id, name });
  return reply.send(ok(q.memberById.get(id)));
}

async function updateMember(req, reply) {
  const id = Number(req.params.id);
  const target = q.memberById.get(id);
  if (!target || target.family_id !== req.member.family_id) {
    return reply.send(fail('成员不存在'));
  }
  const isSelf = target.id === req.member.id;
  const isAdmin = req.member.role === 'admin';
  if (!isSelf && !isAdmin) {
    return reply.send(fail('没有权限'));
  }
  const body = req.body || {};
  let name = target.name;
  let role = target.role;
  let isActive = target.is_active;
  if (body.name !== undefined) {
    name = String(body.name).trim() || target.name;
  }
  if (isAdmin && body.role !== undefined) {
    role = body.role === 'admin' ? 'admin' : 'member';
  }
  if (isAdmin && body.is_active !== undefined) {
    isActive = body.is_active ? 1 : 0;
  }
  q.updateMember.run(name, role, isActive, id);
  return reply.send(ok(q.memberById.get(id)));
}

module.exports = async function familyRoutes(app) {
  app.post('/api/families', { preHandler: [require('../auth').openidOptional] }, createFamily);
  app.get('/api/families/join', { preHandler: [require('../auth').openidOptional] }, joinFamily);
  app.put('/api/members/:id/bind', { preHandler: [require('../auth').openidOptional] }, bindMember);
  app.get('/api/family', { preHandler: [require('../auth').authRequired] }, getFamily);
  app.post('/api/members', { preHandler: [require('../auth').authRequired] }, addMember);
  app.put('/api/members/:id', { preHandler: [require('../auth').authRequired] }, updateMember);
};
ROUTEFAMILYJS

cat > "${BACKEND_DIR}/src/routes/clothes.js" << 'ROUTECLOTHESJS'
const { q, db } = require('../db');
const { ok, fail, now, pick } = require('../utils');
const { saveImage, deleteImage, addImageRecord } = require('../upload');

const BASE_FIELDS = [
  'owner_id', 'name', 'category', 'sub_category', 'color', 'season', 'size',
  'brand', 'material', 'quantity', 'location', 'purchase_price', 'purchase_date',
  'tags', 'note',
];

function enrich(item, images) {
  return { ...item, images: images || [] };
}

async function listClothes(req, reply) {
  const { owner_id, category, color, season, status, keyword } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 20));

  const where = ['family_id = ?', 'deleted_at IS NULL'];
  const params = [req.member.family_id];

  if (owner_id) { where.push('owner_id = ?'); params.push(Number(owner_id)); }
  if (category) { where.push('category = ?'); params.push(category); }
  if (color) { where.push('color = ?'); params.push(color); }
  if (season) { where.push('season = ?'); params.push(season); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (keyword) {
    where.push('(name LIKE ? OR brand LIKE ? OR tags LIKE ? OR note LIKE ?)');
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw, kw);
  }

  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM clothes WHERE ${whereSql}`).get(...params).cnt;
  const list = db.prepare(
    `SELECT * FROM clothes WHERE ${whereSql} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize);

  const items = list.map((item) => {
    const images = q.imagesByClothing.all(item.id);
    return enrich(item, images);
  });

  return reply.send(ok({ list: items, total, page, page_size: pageSize }));
}

async function getClothes(req, reply) {
  const item = q.clothesById.get(Number(req.params.id));
  if (!item || item.family_id !== req.member.family_id) {
    return reply.send(fail('衣服不存在'));
  }
  const images = q.imagesByClothing.all(item.id);
  const owner = q.memberById.get(item.owner_id);
  return reply.send(ok(enrich({ ...item, owner_name: owner ? owner.name : '' }, images)));
}

async function createClothes(req, reply) {
  const body = pick(req.body || {}, BASE_FIELDS);
  const name = (body.name || '').trim();
  if (!name) {
    return reply.send(fail('请输入衣服名称'));
  }
  const quantity = Math.max(1, Number(body.quantity) || 1);
  const ts = now();

  const info = q.insertClothes.run({
    family_id: req.member.family_id,
    owner_id: body.owner_id || req.member.id,
    name,
    category: body.category || '',
    sub_category: body.sub_category || '',
    color: body.color || '',
    season: body.season || '四季通用',
    size: body.size || '',
    brand: body.brand || '',
    material: body.material || '',
    quantity,
    status: '在库',
    location: body.location || '',
    purchase_price: body.purchase_price ? Number(body.purchase_price) : null,
    purchase_date: body.purchase_date || '',
    tags: body.tags || '',
    note: body.note || '',
    created_at: ts,
    updated_at: ts,
  });

  const id = Number(info.lastInsertRowid);
  q.insertStock.run(id, '入库', quantity, body.purchase_price ? Number(body.purchase_price) : null, '', req.member.id, '初始入库', ts);

  const item = q.clothesById.get(id);
  return reply.send(ok(enrich(item, q.imagesByClothing.all(id))));
}

async function updateClothes(req, reply) {
  const id = Number(req.params.id);
  const item = q.clothesById.get(id);
  if (!item || item.family_id !== req.member.family_id) {
    return reply.send(fail('衣服不存在'));
  }
  const body = pick(req.body || {}, BASE_FIELDS);
  if (body.name !== undefined && !String(body.name).trim()) {
    return reply.send(fail('请输入衣服名称'));
  }
  const oldQuantity = item.quantity;
  const newQuantity = body.quantity !== undefined ? Math.max(0, Number(body.quantity) || 0) : oldQuantity;

  q.updateClothes.run({
    id,
    family_id: req.member.family_id,
    name: body.name !== undefined ? String(body.name).trim() : item.name,
    owner_id: body.owner_id || item.owner_id,
    category: body.category !== undefined ? body.category : item.category,
    sub_category: body.sub_category !== undefined ? body.sub_category : item.sub_category,
    color: body.color !== undefined ? body.color : item.color,
    season: body.season !== undefined ? body.season : item.season,
    size: body.size !== undefined ? body.size : item.size,
    brand: body.brand !== undefined ? body.brand : item.brand,
    material: body.material !== undefined ? body.material : item.material,
    quantity: newQuantity,
    location: body.location !== undefined ? body.location : item.location,
    purchase_price: body.purchase_price !== undefined ? (body.purchase_price ? Number(body.purchase_price) : null) : item.purchase_price,
    purchase_date: body.purchase_date !== undefined ? body.purchase_date : item.purchase_date,
    tags: body.tags !== undefined ? body.tags : item.tags,
    note: body.note !== undefined ? body.note : item.note,
    updated_at: now(),
  });

  if (newQuantity !== oldQuantity) {
    const diff = newQuantity - oldQuantity;
    q.insertStock.run(
      id,
      diff > 0 ? '入库' : '出库',
      Math.abs(diff),
      null,
      '',
      req.member.id,
      '编辑数量调整',
      now()
    );
    const finalStatus = newQuantity <= 0 ? '已处理' : (item.status === '借出' ? '借出' : '在库');
    q.updateQuantity.run(newQuantity, finalStatus, now(), id);
  }

  const updated = q.clothesById.get(id);
  return reply.send(ok(enrich(updated, q.imagesByClothing.all(id))));
}

async function deleteClothes(req, reply) {
  const id = Number(req.params.id);
  const item = q.clothesById.get(id);
  if (!item || item.family_id !== req.member.family_id) {
    return reply.send(fail('衣服不存在'));
  }
  q.softDeleteClothes.run(now(), now(), id, req.member.family_id);
  return reply.send(ok(true));
}

async function uploadImages(req, reply) {
  const id = Number(req.params.id);
  const item = q.clothesById.get(id);
  if (!item || item.family_id !== req.member.family_id) {
    return reply.send(fail('衣服不存在'));
  }
  const parts = req.parts();
  const saved = [];
  for await (const part of parts) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) continue;
      const urlPath = saveImage(buffer, part.filename);
      addImageRecord(id, urlPath);
      saved.push(urlPath);
    }
  }
  if (saved.length === 0) {
    return reply.send(fail('没有收到图片文件'));
  }
  return reply.send(ok({ uploaded: saved, images: q.imagesByClothing.all(id) }));
}

async function removeImage(req, reply) {
  const id = Number(req.params.id);
  const imgId = Number(req.params.imgId);
  const item = q.clothesById.get(id);
  if (!item || item.family_id !== req.member.family_id) {
    return reply.send(fail('衣服不存在'));
  }
  if (!deleteImage(imgId, id)) {
    return reply.send(fail('图片不存在'));
  }
  return reply.send(ok({ images: q.imagesByClothing.all(id) }));
}

module.exports = async function clothesRoutes(app) {
  app.get('/api/clothes', { preHandler: [require('../auth').authRequired] }, listClothes);
  app.get('/api/clothes/:id', { preHandler: [require('../auth').authRequired] }, getClothes);
  app.post('/api/clothes', { preHandler: [require('../auth').authRequired] }, createClothes);
  app.put('/api/clothes/:id', { preHandler: [require('../auth').authRequired] }, updateClothes);
  app.delete('/api/clothes/:id', { preHandler: [require('../auth').authRequired] }, deleteClothes);
  app.post('/api/clothes/:id/images', { preHandler: [require('../auth').authRequired] }, uploadImages);
  app.delete('/api/clothes/:id/images/:imgId', { preHandler: [require('../auth').authRequired] }, removeImage);
};
ROUTECLOTHESJS

cat > "${BACKEND_DIR}/src/routes/stock.js" << 'ROUTESTOCKJS'
const { q, db } = require('../db');
const { ok, fail, now } = require('../utils');

const TYPE_RULES = {
  入库: { delta: 1 },
  归还: { delta: 1 },
  出库: { delta: -1 },
  转赠: { delta: -1 },
  清理: { delta: -1 },
  借出: { delta: -1, status: '借出' },
};

async function createStock(req, reply) {
  const id = Number(req.params.id);
  const item = q.clothesById.get(id);
  if (!item || item.family_id !== req.member.family_id) {
    return reply.send(fail('衣服不存在'));
  }
  const body = req.body || {};
  const type = String(body.type || '').trim();
  const rule = TYPE_RULES[type];
  if (!rule) {
    return reply.send(fail('无效的流水类型'));
  }
  const quantity = Math.max(1, Number(body.quantity) || 1);
  const newQuantity = item.quantity + rule.delta * quantity;
  if (newQuantity < 0) {
    return reply.send(fail(`库存不足：当前库存 ${item.quantity} 件`));
  }

  const ts = now();
  const tx = db.transaction(() => {
    q.insertStock.run(
      id, type, quantity,
      body.price !== undefined && body.price !== '' ? Number(body.price) : null,
      (body.counterparty || '').trim(),
      req.member.id,
      (body.note || '').trim(),
      ts
    );
    let status = item.status;
    if (type === '借出') {
      status = '借出';
    } else if (type === '归还') {
      status = newQuantity > 0 ? '在库' : '已处理';
    } else if (newQuantity <= 0) {
      status = '已处理';
    } else if (rule.delta < 0 && status !== '借出') {
      status = '在库';
    }
    q.updateQuantity.run(newQuantity, status, ts, id);
  });
  tx();

  const updated = q.clothesById.get(id);
  return reply.send(ok({ quantity: updated.quantity, status: updated.status }));
}

async function listStock(req, reply) {
  const id = Number(req.params.id);
  const item = q.clothesById.get(id);
  if (!item || item.family_id !== req.member.family_id) {
    return reply.send(fail('衣服不存在'));
  }
  return reply.send(ok(q.stockByClothing.all(id)));
}

module.exports = async function stockRoutes(app) {
  app.post('/api/clothes/:id/stock', { preHandler: [require('../auth').authRequired] }, createStock);
  app.get('/api/clothes/:id/records', { preHandler: [require('../auth').authRequired] }, listStock);
};
ROUTESTOCKJS

cat > "${BACKEND_DIR}/src/routes/stats.js" << 'ROUTESTATSJS'
const { q } = require('../db');
const { ok } = require('../utils');

async function overview(req, reply) {
  const familyId = req.member.family_id;

  const total = q.statsTotal.get(familyId);
  const byStatus = q.statsByStatus.all(familyId);
  const byOwner = q.statsByOwner.all(familyId);
  const bySeason = q.statsBySeason.all(familyId);
  const byCategory = q.statsByCategory.all(familyId);
  const byColor = q.statsByColor.all(familyId);

  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const monthIn = q.monthIn.get(familyId, monthAgo).cnt;
  const monthOut = q.monthOut.get(familyId, monthAgo).cnt;

  const statusMap = {};
  byStatus.forEach((r) => { statusMap[r.status] = r.cnt; });

  const recent = q.recentStock.all(familyId).map((r) => ({
    id: r.id,
    type: r.type,
    quantity: r.quantity,
    clothing_name: r.clothing_name,
    operator_name: r.operator_name,
    counterparty: r.counterparty,
    created_at: r.created_at,
  }));

  return reply.send(ok({
    total_pieces: total.pieces,
    total_items: total.total,
    in_stock: statusMap['在库'] || 0,
    borrowed: statusMap['借出'] || 0,
    disposed: statusMap['已处理'] || 0,
    month_in: monthIn,
    month_out: monthOut,
    by_owner: byOwner,
    by_season: bySeason,
    by_category: byCategory,
    by_color: byColor,
    recent,
  }));
}

module.exports = async function statsRoutes(app) {
  app.get('/api/stats/overview', { preHandler: [require('../auth').authRequired] }, overview);
};
ROUTESTATSJS

cat > "${BACKEND_DIR}/src/routes/dicts.js" << 'ROUTEDICTSJS'
const { q } = require('../db');
const { ok, fail, now } = require('../utils');

async function getDicts(req, reply) {
  const rows = q.dictsByFamily.all(req.member.family_id);
  const grouped = { category: [], color: [], season: [], location: [] };
  rows.forEach((r) => {
    if (!grouped[r.dict_type]) grouped[r.dict_type] = [];
    grouped[r.dict_type].push({ id: r.id, name: r.name });
  });
  return reply.send(ok(grouped));
}

async function addDict(req, reply) {
  if (req.member.role !== 'admin') {
    return reply.send(fail('仅管理员可维护字典'));
  }
  const { dict_type, name } = req.body || {};
  const type = String(dict_type || '').trim();
  const n = String(name || '').trim();
  if (!['category', 'color', 'season', 'location'].includes(type)) {
    return reply.send(fail('无效的字典类型'));
  }
  if (!n) {
    return reply.send(fail('请输入名称'));
  }
  const exists = q.dictsByFamily.all(req.member.family_id)
    .find((d) => d.dict_type === type && d.name === n);
  if (exists) {
    return reply.send(fail('该名称已存在'));
  }
  const maxSort = q.dictsByFamily.all(req.member.family_id)
    .filter((d) => d.dict_type === type)
    .reduce((m, d) => Math.max(m, d.sort), -1);
  q.db.prepare('INSERT INTO dicts (family_id, dict_type, name, sort) VALUES (?, ?, ?, ?)')
    .run(req.member.family_id, type, n, maxSort + 1);
  return reply.send(ok(true));
}

async function removeDict(req, reply) {
  if (req.member.role !== 'admin') {
    return reply.send(fail('仅管理员可维护字典'));
  }
  const id = Number(req.params.id);
  const row = q.dictById.get(id, req.member.family_id);
  if (!row) {
    return reply.send(fail('字典项不存在'));
  }
  q.deleteDict.run(id, req.member.family_id);
  return reply.send(ok(true));
}

module.exports = async function dictRoutes(app) {
  app.get('/api/dicts', { preHandler: [require('../auth').authRequired] }, getDicts);
  app.post('/api/dicts', { preHandler: [require('../auth').authRequired] }, addDict);
  app.delete('/api/dicts/:id', { preHandler: [require('../auth').authRequired] }, removeDict);
};
ROUTEDICTSJS

# 5. 写入 docker-compose.yml
echo "[3/5] 写入 docker-compose.yml..."
cat > "${DEPLOY_DIR}/docker-compose.yml" << 'COMPOSEYML'
services:
  closet-api:
    build: ./backend
    image: closet-api:latest
    container_name: closet-api
    restart: unless-stopped
    ports:
      - "9990:3000"
    volumes:
      - ./data:/app/data
      - ./images:/app/images
    environment:
      - PORT=3000
      - DB_PATH=/app/data/closet.db
      - IMAGES_DIR=/app/images
      - NODE_ENV=production
COMPOSEYML

# 6. 构建并启动
echo ""
echo "[4/5] 停止旧容器..."
cd "${DEPLOY_DIR}"
docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true

echo ""
echo "[5/5] 构建并启动服务（首次构建需要几分钟）..."
docker compose up -d --build 2>/dev/null || docker-compose up -d --build

echo ""
echo "等待服务启动..."
sleep 5

# 7. 验证
echo ""
echo "=========================================="
echo "  验证服务..."
echo "=========================================="
if curl -sf http://localhost:9990/api/health > /dev/null 2>&1; then
  echo ""
  echo "  ✓ 部署成功！"
  echo ""
  echo "  访问地址: http://192.168.1.100:9990/api/health"
  echo "  数据目录: ${DEPLOY_DIR}/data/"
  echo "  图片目录: ${DEPLOY_DIR}/images/"
  echo ""
  echo "  常用命令:"
  echo "    查看日志: cd ${DEPLOY_DIR} && docker compose logs -f"
  echo "    重启服务: cd ${DEPLOY_DIR} && docker compose restart"
  echo "    停止服务: cd ${DEPLOY_DIR} && docker compose down"
  echo "=========================================="
else
  echo ""
  echo "  ✗ 服务启动可能有问题，请查看日志:"
  echo "    cd ${DEPLOY_DIR} && docker compose logs"
  echo "=========================================="
fi
