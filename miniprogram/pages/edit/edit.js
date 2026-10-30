const app = getApp();
const api = require('../../services/api');
const { imgUrl, imageFileUrl } = require('../../utils/request');

Page({
  data: {
    id: null,
    isEdit: false,
    submitting: false,

    // 表单
    form: {
      name: '',
      owner_id: null,
      category: '',
      sub_category: '',
      color: '',
      season: '四季通用',
      size: '',
      brand: '',
      material: '',
      quantity: 1,
      location: '',
      purchase_price: '',
      purchase_date: '',
      tags: '',
      note: '',
    },

    // 选项
    members: [],
    categories: [],
    colors: [],
    seasons: [],
    locations: [],

    // 图片
    images: [],          // 已上传的图片 { id, path, url }
    newImages: [],       // 待上传的本地临时文件
    uploading: false,
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ id: options.id, isEdit: true });
      wx.setNavigationBarTitle({ title: '编辑衣服' });
    } else {
      wx.setNavigationBarTitle({ title: '新增衣服' });
    }
    this.init();
  },

  async init() {
    const member = await app.ensureLogin();
    if (!member) return;
    const [dicts, family] = await Promise.all([
      app.loadDicts(),
      api.getFamily().catch(() => null),
    ]);
    const members = (family && family.members) || [];
    const categories = dicts.category || [];
    const colors = dicts.color || [];
    const seasons = dicts.season || [];
    const locations = dicts.location || [];
    const ownerIdx = members.findIndex((m) => m.id === member.id);
    this.setData({
      members,
      categories,
      colors,
      seasons,
      locations,
      'form.owner_id': member.id,
      'form.season': this.guessSeason(),
      ownerIdx: ownerIdx >= 0 ? ownerIdx : 0,
      categoryIdx: -1,
      colorIdx: -1,
      seasonIdx: seasons.findIndex((s) => s.name === this.guessSeason()) >= 0 ? seasons.findIndex((s) => s.name === this.guessSeason()) : 0,
      locationIdx: -1,
    });

    if (this.data.isEdit) {
      this.loadDetail();
    }
  },

  /** 根据当前月份猜季节 */
  guessSeason() {
    const m = new Date().getMonth() + 1;
    if (m >= 3 && m <= 5) return '春';
    if (m >= 6 && m <= 8) return '夏';
    if (m >= 9 && m <= 11) return '秋';
    return '冬';
  },

  async loadDetail() {
    const item = await api.getClothes(this.data.id);
    const imgs = item.images || [];
    const urls = await Promise.all(imgs.map((i) => imageFileUrl(imgUrl(i.path))));
    const images = imgs.map((i, idx) => ({ id: i.id, path: i.path, url: urls[idx] }));
    const members = this.data.members;
    const categories = this.data.categories;
    const colors = this.data.colors;
    const seasons = this.data.seasons;
    const locations = this.data.locations;
    this.setData({
      form: {
        name: item.name,
        owner_id: item.owner_id,
        category: item.category,
        sub_category: item.sub_category,
        color: item.color,
        season: item.season,
        size: item.size,
        brand: item.brand,
        material: item.material,
        quantity: item.quantity,
        location: item.location,
        purchase_price: item.purchase_price || '',
        purchase_date: item.purchase_date || '',
        tags: item.tags || '',
        note: item.note || '',
      },
      images,
      ownerIdx: item.owner_id ? members.findIndex((m) => m.id === item.owner_id) : 0,
      categoryIdx: item.category ? categories.indexOf(item.category) : -1,
      colorIdx: item.color ? colors.indexOf(item.color) : -1,
      seasonIdx: item.season ? seasons.indexOf(item.season) : -1,
      locationIdx: item.location ? locations.indexOf(item.location) : -1,
    });
  },

  // ---------- 表单输入 ----------
  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  pickOwner(e) {
    const idx = Number(e.detail.value);
    this.setData({ ownerIdx: idx, 'form.owner_id': this.data.members[idx] ? this.data.members[idx].id : null });
  },
  pickCategory(e) {
    const idx = Number(e.detail.value);
    this.setData({ categoryIdx: idx, 'form.category': this.data.categories[idx] ? this.data.categories[idx].name : '' });
  },
  pickColor(e) {
    const idx = Number(e.detail.value);
    this.setData({ colorIdx: idx, 'form.color': this.data.colors[idx] ? this.data.colors[idx].name : '' });
  },
  pickSeason(e) {
    const idx = Number(e.detail.value);
    this.setData({ seasonIdx: idx, 'form.season': this.data.seasons[idx] ? this.data.seasons[idx].name : '' });
  },
  pickLocation(e) {
    const idx = Number(e.detail.value);
    this.setData({ locationIdx: idx, 'form.location': this.data.locations[idx] ? this.data.locations[idx].name : '' });
  },
  pickDate(e) {
    this.setData({ 'form.purchase_date': e.detail.value });
  },

  // ---------- 图片 ----------
  chooseImages() {
    const remain = 9 - this.data.images.length - this.data.newImages.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多 9 张图片', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const paths = res.tempFiles.map((f) => f.tempFilePath);
        this.setData({ newImages: this.data.newImages.concat(paths) });
      },
    });
  },

  previewNew(e) {
    wx.previewImage({
      current: e.currentTarget.dataset.src,
      urls: this.data.newImages,
    });
  },

  removeNew(e) {
    const idx = e.currentTarget.dataset.idx;
    const newImages = this.data.newImages.slice();
    newImages.splice(idx, 1);
    this.setData({ newImages });
  },

  removeUploaded(e) {
    const idx = e.currentTarget.dataset.idx;
    const img = this.data.images[idx];
    wx.showModal({
      title: '删除这张图片？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await api.deleteImage(this.data.id, img.id);
          const images = this.data.images.slice();
          images.splice(idx, 1);
          this.setData({ images });
        } catch (err) {}
      },
    });
  },

  // ---------- 提交 ----------
  async submit() {
    if (this.data.submitting) return;
    const { form } = this.data;
    if (!form.name.trim()) {
      wx.showToast({ title: '请输入衣服名称', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });

    const payload = {
      ...form,
      quantity: Math.max(1, Number(form.quantity) || 1),
      purchase_price: form.purchase_price ? Number(form.purchase_price) : '',
    };

    try {
      let id = this.data.id;
      if (this.data.isEdit) {
        await api.updateClothes(id, payload);
      } else {
        const created = await api.createClothes(payload);
        id = created.id;
      }

      // 上传新图片
      if (this.data.newImages.length) {
        this.setData({ uploading: true });
        await api.uploadImages(id, this.data.newImages);
      }

      wx.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => {
        if (this.data.isEdit) {
          wx.navigateBack();
        } else {
          wx.redirectTo({ url: `/pages/detail/detail?id=${id}` });
        }
      }, 600);
    } catch (e) {
      // 错误提示已由 request 统一处理
    } finally {
      this.setData({ submitting: false, uploading: false });
    }
  },
});
