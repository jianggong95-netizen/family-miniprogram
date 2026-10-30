Component({
  /**
   * 横向滚动筛选项，支持自定义维度
   * properties.filters: [{ key, label, options: [{ value, label }] }]
   * properties.current: { [key]: value }
   */
  properties: {
    filters: { type: Array, value: [] },
    current: { type: Object, value: {} },
  },

  methods: {
    onSelect(e) {
      const { key, value } = e.currentTarget.dataset;
      const current = { ...this.data.current };
      if (current[key] === value) {
        delete current[key];
      } else {
        current[key] = value;
      }
      this.triggerEvent('change', current);
    },
  },
});
