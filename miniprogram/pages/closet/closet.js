const app = getApp();
const api = require('../../services/api');
const { imgUrl, imageFileUrl } = require('../../utils/request');

Page({
  data: {
    keyword: '',
    filters: [],
    current: {},
    list: [],
    page: 1,
    hasMore: true,
    loading: false,
    dicts: null,
    members: [],
  },

  onLoad() {
    this.initFilters();
  },

  onShow() {
    this.reload();
  },

  async initFilters() {
    const member = await app.ensureLogin();
    if (!member) return;
    const [dicts, family] = await Promise.all([
      app.loadDicts(),
      api.getFamily().catch(() => null),
    ]);
    const members = (family && family.members) || [];
    this.setData({
      dicts,
      members,
      filters: [
        {
          key: 'owner_id',
          label: '成员',
          options: members.map((m) => ({ value: String(m.id), label: m.name })),
        },
        {
          key: 'category',
          label: '种类',
          options: (dicts.category || []).map((d) => ({ value: d.name, label: d.name })),
        },
        {
          key: 'color',
          label: '颜色',
          options: (dicts.color || []).map((d) => ({ value: d.name, label: d.name })),
        },
        {
          key: 'season',
          label: '季节',
          options: (dicts.season || []).map((d) => ({ value: d.name, label: d.name })),
        },
        {
          key: 'status',
          label: '状态',
          options: [
            { value: '在库', label: '在库' },
            { value: '借出', label: '借出' },
            { value: '已处理', label: '已处理' },
          ],
        },
      ],
    });
  },

  async reload() {
    this.setData({ list: [], page: 1, hasMore: true });
    await this.loadList(true);
  },

  async loadList(reset) {
    if (this.data.loading) return;
    if (!reset && !this.data.hasMore) return;
    this.setData({ loading: true });

    const params = {
      ...this.data.current,
      keyword: this.data.keyword || undefined,
      page: this.data.page,
      page_size: 20,
    };

    try {
      const res = await api.listClothes(params);
      const enriched = await Promise.all(res.list.map(async (item) => {
        const images = item.images || [];
        const cover = images.find((i) => i.is_cover) || images[0];
        const coverPath = await imageFileUrl(imgUrl(cover ? cover.path : ''));
        return { ...item, cover: coverPath };
      }));
      const list = reset ? enriched : this.data.list.concat(enriched);
      this.setData({
        list,
        page: this.data.page + 1,
        hasMore: list.length < res.total,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  onFilterChange(e) {
    this.setData({ current: e.detail, list: [], page: 1, hasMore: true });
    this.loadList(true);
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.reload();
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this.loadList();
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/edit/edit' });
  },
});
