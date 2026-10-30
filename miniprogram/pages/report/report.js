const app = getApp();
const api = require('../../services/api');

const RANGES = [
  { key: 'all', label: '全部' },
  { key: '30', label: '近30天' },
  { key: '90', label: '近90天' },
  { key: 'year', label: '今年' },
  { key: 'custom', label: '自定义' },
];

function pad(n) { return String(n).padStart(2, '0'); }
function toDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return toDate(new Date()); }
function beforeStr(days) { const d = new Date(); d.setDate(d.getDate() - days); return toDate(d); }
function yearStartStr() { const d = new Date(); return `${d.getFullYear()}-01-01`; }
function money(n) { return (Number(n) || 0).toFixed(2); }

Page({
  data: {
    loading: true,
    error: '',
    ranges: RANGES,
    activeRange: 'all',
    showCustom: false,
    customFrom: '',
    customTo: '',
    today: todayStr(),
    report: null,
    qFrom: '',
    qTo: '',
  },

  onShow() {
    this.init();
  },

  async init() {
    try {
      const member = await app.ensureLogin();
      if (!member) {
        this.setData({ loading: false, error: '请先绑定身份' });
        return;
      }
      this.setData({ error: '' });
      this.loadReport();
    } catch (e) {
      this.setData({ loading: false, error: '网络错误，请检查后端是否启动' });
    }
  },

  // 根据当前筛选项计算 from/to
  computeRange() {
    const key = this.data.activeRange;
    if (key === 'all') return { from: '', to: '' };
    if (key === '30') return { from: beforeStr(30), to: '' };
    if (key === '90') return { from: beforeStr(90), to: '' };
    if (key === 'year') return { from: yearStartStr(), to: '' };
    // custom
    return { from: this.data.customFrom || '', to: this.data.customTo || '' };
  },

  async loadReport() {
    const { from, to } = this.computeRange();
    this.setData({ loading: true, qFrom: from, qTo: to });
    try {
      const report = await api.getReport({ from, to });
      this.enrich(report);
      this.setData({ report, loading: false });
    } catch (e) {
      this.setData({ loading: false, error: '加载失败，请重试' });
    }
  },

  // 前端补充：趋势柱高、显示文本
  enrich(report) {
    const trend = report.trend || [];
    const maxAmount = trend.reduce((m, t) => Math.max(m, t.amount), 0);
    trend.forEach((t) => {
      t.barPct = maxAmount > 0 ? Math.max(8, Math.round((t.amount / maxAmount) * 100)) : 8;
      t.amountText = money(t.amount);
      t.monthShort = (t.month || '').slice(2); // 如 26-08
    });
    report.trend = trend;

    const set = (arr, fields) => (arr || []).map((x) => {
      const o = { ...x };
      if (fields.includes('amount')) o.amountText = money(x.amount);
      if (fields.includes('value')) o.valueText = money(x.value);
      o.amountW = o.pieces || o.cnt || 0;
      return o;
    });
    report.by_category = set(report.by_category, ['amount']);
    report.by_season = set(report.by_season, ['amount']);
    report.by_owner = set(report.by_owner, ['amount']);
    report.purchases = (report.purchases || []).map((p) => ({ ...p, priceText: money(p.purchase_price) }));

    // 展示文本
    report.totalValueText = money(report.total_value);
    report.totalPiecesText = String(report.total_pieces || 0);
    report.totalItemsText = String(report.total_items || 0);
    report.purchasedCountText = String(report.purchased_count || 0);
    report.purchasedPiecesText = String(report.purchased_pieces || 0);
    report.purchasedAmountText = money(report.purchased_amount);
    report.rangeText = report.from && report.to ? `${report.from} ~ ${report.to}` : (report.from || report.to || '全部');
  },

  switchRange(e) {
    const key = e.currentTarget.dataset.key;
    const showCustom = key === 'custom';
    this.setData({ activeRange: key, showCustom });
    if (!showCustom) this.loadReport();
  },

  pickCustomFrom(e) { this.setData({ customFrom: e.detail.value }); },
  pickCustomTo(e) { this.setData({ customTo: e.detail.value }); },
  applyCustom() {
    if (!this.data.customFrom && !this.data.customTo) {
      wx.showToast({ title: '请选择起止日期', icon: 'none' });
      return;
    }
    this.loadReport();
  },

  onPullDownRefresh() {
    this.loadReport().finally(() => wx.stopPullDownRefresh());
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },
});