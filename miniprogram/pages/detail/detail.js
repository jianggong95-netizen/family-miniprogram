const app = getApp();
const api = require('../../services/api');
const { imgUrl, imageFileUrl } = require('../../utils/request');

const STOCK_TYPES = ['入库', '出库', '借出', '归还', '转赠', '清理'];
const TYPE_CLASS = { '入库': 'in', '出库': 'out', '借出': 'borrow', '归还': 'return', '转赠': 'gift', '清理': 'clean' };
const STATUS_CLASS = { '在库': 'stock', '借出': 'borrow', '已处理': 'done' };

Page({
  data: {
    id: null,
    item: null,
    images: [],
    records: [],
    loading: true,

    showStock: false,          // 记一笔弹层
    stockTypes: STOCK_TYPES,
    stockType: '出库',
    stockQty: 1,
    stockCounterparty: '',
    stockNote: '',
    submitting: false,
  },

  onLoad(options) {
    this.setData({ id: options.id });
  },

  onShow() {
    this.load();
  },

  typeClass(type) { return TYPE_CLASS[type] || ''; },
  statusClass(status) { return STATUS_CLASS[status] || ''; },

  async load() {
    try {
      const item = await api.getClothes(this.data.id);
      const images = await Promise.all((item.images || []).map((i) => imageFileUrl(imgUrl(i.path))));
      const records = await api.listRecords(this.data.id);
      this.setData({
        item,
        images,
        records: records.map((r) => ({ ...r, typeCls: TYPE_CLASS[r.type] || '' })),
        loading: false,
      });
      wx.setNavigationBarTitle({ title: item.name });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  previewImage(e) {
    wx.previewImage({
      current: e.currentTarget.dataset.src,
      urls: this.data.images,
    });
  },

  // ---------- 记一笔 ----------
  openStock() {
    this.setData({
      showStock: true,
      stockType: '出库',
      stockQty: 1,
      stockCounterparty: '',
      stockNote: '',
    });
  },

  closeStock() {
    this.setData({ showStock: false });
  },

  noop() {},

  pickType(e) {
    this.setData({ stockType: e.currentTarget.dataset.type });
  },

  onQtyInput(e) {
    const v = parseInt(e.detail.value, 10);
    this.setData({ stockQty: isNaN(v) || v < 1 ? 1 : v });
  },

  onCounterpartyInput(e) {
    this.setData({ stockCounterparty: e.detail.value });
  },

  onNoteInput(e) {
    this.setData({ stockNote: e.detail.value });
  },

  async submitStock() {
    if (this.data.submitting) return;
    const { stockType, stockQty, stockCounterparty, stockNote } = this.data;
    this.setData({ submitting: true });
    try {
      const res = await api.createStock(this.data.id, {
        type: stockType,
        quantity: stockQty,
        counterparty: stockCounterparty,
        note: stockNote,
      });
      wx.showToast({ title: `成功，剩 ${res.quantity} 件`, icon: 'success' });
      this.setData({ showStock: false });
      this.load();
    } catch (e) {
      // 错误提示由 request 统一处理
    } finally {
      this.setData({ submitting: false });
    }
  },

  // ---------- 编辑 / 删除 ----------
  goEdit() {
    wx.navigateTo({ url: `/pages/edit/edit?id=${this.data.id}` });
  },

  onDelete() {
    wx.showModal({
      title: '删除这件衣服？',
      content: '删除后该衣服将不再显示（流水会保留）',
      confirmColor: '#D85A30',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteClothes(this.data.id);
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 600);
        } catch (e) {}
      },
    });
  },

  onShareAppMessage() {
    return { title: this.data.item ? this.data.item.name : '我的家庭衣橱' };
  },
});
