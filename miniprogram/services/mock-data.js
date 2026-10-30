/**
 * 模拟数据 - 用于本地测试，无需后端
 */

const NOW = new Date().toISOString();
const DAY_AGO = new Date(Date.now() - 86400000).toISOString();
const WEEK_AGO = new Date(Date.now() - 7 * 86400000).toISOString();
const MONTH_AGO = new Date(Date.now() - 30 * 86400000).toISOString();

const mockMember = {
  id: 1,
  name: '我',
  role: 'admin',
  openid: 'mock_openid_001',
  is_active: 1,
  clothing_count: 5,
};

const mockFamily = {
  id: 1,
  name: '李家衣橱',
  invite_code: 'ABC123',
  members: [
    { id: 1, name: '我', role: 'admin', openid: 'mock_openid_001', is_active: 1, clothing_count: 5 },
    { id: 2, name: '妈妈', role: 'member', openid: '', is_active: 1, clothing_count: 3 },
    { id: 3, name: '爸爸', role: 'member', openid: '', is_active: 1, clothing_count: 2 },
  ],
};

const mockDicts = {
  category: [
    { id: 1, name: '上衣', dict_type: 'category' },
    { id: 2, name: '裤子', dict_type: 'category' },
    { id: 3, name: '外套', dict_type: 'category' },
    { id: 4, name: '裙子', dict_type: 'category' },
    { id: 5, name: '鞋子', dict_type: 'category' },
  ],
  color: [
    { id: 1, name: '白色', dict_type: 'color' },
    { id: 2, name: '黑色', dict_type: 'color' },
    { id: 3, name: '蓝色', dict_type: 'color' },
    { id: 4, name: '灰色', dict_type: 'color' },
    { id: 5, name: '红色', dict_type: 'color' },
  ],
  season: [
    { id: 1, name: '春', dict_type: 'season' },
    { id: 2, name: '夏', dict_type: 'season' },
    { id: 3, name: '秋', dict_type: 'season' },
    { id: 4, name: '冬', dict_type: 'season' },
    { id: 5, name: '四季通用', dict_type: 'season' },
  ],
  location: [
    { id: 1, name: '主卧衣柜', dict_type: 'location' },
    { id: 2, name: '次卧衣柜', dict_type: 'location' },
    { id: 3, name: '鞋柜', dict_type: 'location' },
    { id: 4, name: '储物间', dict_type: 'location' },
  ],
};

const mockClothes = [
  {
    id: 1, name: '白色圆领短袖T恤', owner_id: 1, owner_name: '我',
    category: '上衣', sub_category: '短袖', color: '白色', season: '夏',
    size: 'M', brand: '优衣库', material: '纯棉', quantity: 2,
    location: '主卧衣柜', purchase_price: 99, purchase_date: '2025-06-15',
    status: '在库', tags: '常穿,百搭', note: '基础款，多买了一件备用',
    images: [],
    created_at: MONTH_AGO, updated_at: NOW,
  },
  {
    id: 2, name: '深蓝色牛仔裤', owner_id: 1, owner_name: '我',
    category: '裤子', sub_category: '直筒', color: '蓝色', season: '四季通用',
    size: '30', brand: 'Levis', material: '牛仔布', quantity: 1,
    location: '主卧衣柜', purchase_price: 399, purchase_date: '2025-03-20',
    status: '在库', tags: '经典款', note: '',
    images: [],
    created_at: MONTH_AGO, updated_at: NOW,
  },
  {
    id: 3, name: '黑色羽绒服', owner_id: 1, owner_name: '我',
    category: '外套', sub_category: '羽绒服', color: '黑色', season: '冬',
    size: 'L', brand: '波司登', material: '鸭绒', quantity: 1,
    location: '储物间', purchase_price: 1299, purchase_date: '2024-11-10',
    status: '在库', tags: '保暖', note: '去年冬天买的',
    images: [],
    created_at: MONTH_AGO, updated_at: NOW,
  },
  {
    id: 4, name: '妈妈的花裙子', owner_id: 2, owner_name: '妈妈',
    category: '裙子', sub_category: '连衣裙', color: '红色', season: '夏',
    size: 'L', brand: '', material: '雪纺', quantity: 1,
    location: '次卧衣柜', purchase_price: 259, purchase_date: '2025-05-01',
    status: '借出', tags: '旅游', note: '借给阿姨穿了',
    images: [],
    created_at: MONTH_AGO, updated_at: NOW,
  },
  {
    id: 5, name: '灰色运动鞋', owner_id: 1, owner_name: '我',
    category: '鞋子', sub_category: '运动鞋', color: '灰色', season: '四季通用',
    size: '42', brand: 'Nike', material: '网面', quantity: 1,
    location: '鞋柜', purchase_price: 599, purchase_date: '2025-07-01',
    status: '在库', tags: '跑步', note: '',
    images: [],
    created_at: WEEK_AGO, updated_at: NOW,
  },
];

const mockRecords = [
  { id: 1, clothing_id: 1, type: '入库', quantity: 2, price: 99, counterparty: '淘宝优衣库旗舰店', note: '618活动购入', operator_name: '我', created_at: MONTH_AGO },
  { id: 2, clothing_id: 2, type: '入库', quantity: 1, price: 399, counterparty: '商场专柜', note: '', operator_name: '我', created_at: MONTH_AGO },
  { id: 3, clothing_id: 3, type: '入库', quantity: 1, price: 1299, counterparty: '波司登官网', note: '去年冬天', operator_name: '我', created_at: MONTH_AGO },
  { id: 4, clothing_id: 4, type: '借出', quantity: 1, price: 0, counterparty: '阿姨', note: '旅游穿', operator_name: '妈妈', created_at: WEEK_AGO },
  { id: 5, clothing_id: 5, type: '入库', quantity: 1, price: 599, counterparty: 'Nike官网', note: '', operator_name: '我', created_at: WEEK_AGO },
  { id: 6, clothing_id: 1, type: '出库', quantity: 1, price: 0, counterparty: '捐赠', note: '旧衣回收', operator_name: '我', created_at: DAY_AGO },
];

const mockOverview = {
  total_pieces: 10,
  in_stock: 8,
  borrowed: 1,
  processed: 1,
  month_in: 3,
  month_out: 1,
  by_owner: [
    { id: 1, name: '我', cnt: 5 },
    { id: 2, name: '妈妈', cnt: 3 },
    { id: 3, name: '爸爸', cnt: 2 },
  ],
  by_season: [
    { season: '春', cnt: 2 },
    { season: '夏', cnt: 3 },
    { season: '秋', cnt: 2 },
    { season: '冬', cnt: 1 },
    { season: '四季通用', cnt: 2 },
  ],
  recent: mockRecords.slice(0, 5),
};

// 模拟 API 模块
let nextClothId = 6;
let nextRecordId = 7;
let nextImageId = 6;
let clothes = JSON.parse(JSON.stringify(mockClothes));
let records = JSON.parse(JSON.stringify(mockRecords));

module.exports = {
  mockMember,
  mockFamily,
  mockDicts,
  mockOverview,

  login: () => ({ openid: 'mock_openid_001', member: mockMember, family: mockFamily }),

  getFamily: () => JSON.parse(JSON.stringify(mockFamily)),

  getOverview: () => JSON.parse(JSON.stringify(mockOverview)),

  // BI 数据分析（模拟）
  getReport: () => ({
    total_items: clothes.length,
    total_pieces: clothes.reduce((s, c) => s + (c.quantity || 1), 0),
    total_value: clothes.reduce((s, c) => s + (c.quantity || 1) * (c.purchase_price || 0), 0),
    purchased_count: clothes.filter((c) => c.purchase_price && c.purchase_date).length,
    purchased_pieces: clothes.filter((c) => c.purchase_price && c.purchase_date).reduce((s, c) => s + (c.quantity || 1), 0),
    purchased_amount: clothes.filter((c) => c.purchase_price && c.purchase_date).reduce((s, c) => s + (c.quantity || 1) * (c.purchase_price || 0), 0),
    by_category: [],
    by_season: [],
    by_owner: [],
    trend: [],
    stock_in: 3,
    stock_out: 1,
    stock_borrow: 1,
    stock_return: 1,
    purchases: [],
  }),

  getDicts: () => JSON.parse(JSON.stringify(mockDicts)),

  listClothes: (params) => {
    let list = JSON.parse(JSON.stringify(clothes));
    if (params.keyword) {
      const kw = params.keyword.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(kw) || (c.brand && c.brand.toLowerCase().includes(kw)));
    }
    if (params.owner_id) list = list.filter((c) => String(c.owner_id) === String(params.owner_id));
    if (params.category) list = list.filter((c) => c.category === params.category);
    if (params.color) list = list.filter((c) => c.color === params.color);
    if (params.season) list = list.filter((c) => c.season === params.season);
    if (params.status) list = list.filter((c) => c.status === params.status);
    return { list, total: list.length };
  },

  getClothes: (id) => {
    const item = clothes.find((c) => c.id === id);
    return item ? JSON.parse(JSON.stringify(item)) : null;
  },

  createClothes: (data) => {
    const item = { id: nextClothId++, ...data, status: '在库', created_at: NOW, updated_at: NOW, images: [] };
    clothes.push(item);
    return { id: item.id };
  },

  updateClothes: (id, data) => {
    const idx = clothes.findIndex((c) => c.id === id);
    if (idx >= 0) Object.assign(clothes[idx], data, { updated_at: NOW });
    return { ok: true };
  },

  deleteClothes: (id) => {
    clothes = clothes.filter((c) => c.id !== id);
    return { ok: true };
  },

  listRecords: (clothingId) => {
    return JSON.parse(JSON.stringify(records.filter((r) => r.clothing_id === clothingId)));
  },

  createStock: (clothingId, data) => {
    const item = clothes.find((c) => c.id === clothingId);
    if (item) {
      if (data.type === '入库') item.quantity += data.quantity;
      else if (data.type === '出库' || data.type === '借出' || data.type === '转赠' || data.type === '清理') item.quantity = Math.max(0, item.quantity - data.quantity);
      else if (data.type === '归还') item.quantity += data.quantity;
      if (data.type === '借出') item.status = '借出';
      if (item.quantity === 0) item.status = '已处理';
      else if (item.status === '借出' && data.type !== '借出') item.status = '在库';
    }
    records.push({ id: nextRecordId++, clothing_id: clothingId, ...data, operator_name: '我', created_at: NOW });
    return { quantity: item ? item.quantity : 0 };
  },

  uploadImages: (clothingId, filePaths) => {
    const item = clothes.find((c) => c.id === clothingId);
    if (item) {
      filePaths.forEach((p, i) => {
        item.images.push({ id: nextImageId++, path: p, is_cover: item.images.length === 0 ? 1 : 0 });
      });
    }
    return filePaths.map((p) => ({ id: nextImageId++, path: p }));
  },

  deleteImage: (clothingId, imgId) => {
    const item = clothes.find((c) => c.id === clothingId);
    if (item) item.images = item.images.filter((i) => i.id !== imgId);
    return { ok: true };
  },

  addMember: (name) => {
    mockFamily.members.push({ id: mockFamily.members.length + 1, name, role: 'member', openid: '', is_active: 1, clothing_count: 0 });
    return { ok: true };
  },

  updateMember: (id, data) => {
    const m = mockFamily.members.find((m) => m.id === id);
    if (m) Object.assign(m, data);
    return { ok: true };
  },

  createFamily: (name) => ({ member: mockMember, family: { ...mockFamily, name } }),
  joinFamily: (code) => ({ family: mockFamily, members: mockFamily.members.filter((m) => !m.openid) }),
  bindMember: (id, openid) => {
    const m = mockFamily.members.find((m) => m.id === id);
    if (m) m.openid = openid;
    return m;
  },

  addDict: (type, name) => ({ id: 100, name, dict_type: type }),
  deleteDict: (id) => ({ ok: true }),
};
