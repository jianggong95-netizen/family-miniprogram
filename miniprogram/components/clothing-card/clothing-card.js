const { imgUrl, imageFileUrl } = require('../../utils/request');

Component({
  properties: {
    item: { type: Object, value: null },
  },

  data: {
    cover: '',
  },

  observers: {
    item(item) {
      if (!item) return;
      const images = item.images || [];
      const cover = images.find((i) => i.is_cover) || images[0];
      const url = imgUrl(cover ? cover.path : '');
      imageFileUrl(url).then((path) => {
        this.setData({ cover: path });
      });
    },
  },

  methods: {
    onTap() {
      if (!this.data.item) return;
      wx.navigateTo({ url: `/pages/detail/detail?id=${this.data.item.id}` });
    },
  },
});
