// 打牌积分：创建/加入 6 位数字房间，选中玩家加减分，日志实时同步（watch）
const { check } = require('../../../utils/perms');
Page({
  data: {
    stage: 'lobby', // lobby | room
    roomCode: '',
    joinCode: '',
    busy: false,
    players: [],
    logs: [],
    status: 'playing',
    round: 1,
    isHost: false,
    meId: '',
    selectedId: '',
    selectedName: '',
    delta: '',
    reason: '',
  },

  onLoad() {
    check('score').then((r) => {
      if (!r.allowed) {
        wx.showToast({ title: '打牌积分已被管理员禁用', icon: 'none' });
        setTimeout(() => wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/games/games' }) }), 900);
      }
    });
  },

  onShow() {
    if (this.data.stage === 'room' && this.data.roomCode) {
      this.refresh();
      this.startWatch(this.data.roomCode);
    }
  },
  onHide() { this.closeWatch(); },
  onUnload() { this.closeWatch(); },

  // 下拉刷新：重新拉取房间快照（分数 + 记分日志）
  onPullDownRefresh() {
    if (this.data.stage !== 'room' || !this.data.roomCode) {
      wx.stopPullDownRefresh();
      return;
    }
    this.call('score.get', { code: this.data.roomCode })
      .then((room) => {
        this.applyRoom(room);
        wx.showToast({ title: '已刷新', icon: 'none', duration: 800 });
      })
      .catch((e) => {
        if (e && /不存在|不在/.test(e.message || '')) {
          this.leaveRoom();
        } else {
          wx.showToast({ title: (e && e.message) || '刷新失败', icon: 'none' });
        }
      })
      .finally(() => { wx.stopPullDownRefresh(); });
  },

  call(action, data) {
    return wx.cloud.callFunction({ name: 'closetApi', data: Object.assign({ action }, data || {}) }).then((res) => {
      const body = (res && res.result) || {};
      if (body.code !== 0) throw body;
      return body.data;
    });
  },

  myName() {
    const g = getApp().globalData;
    return (g.member && g.member.name) || '玩家';
  },

  // ================= 大厅 =================
  onJoinCodeInput(e) {
    const v = String(e.detail.value || '').replace(/\D/g, '').slice(0, 6);
    this.setData({ joinCode: v });
    return v;
  },

  createRoom() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    this.call('score.create', { name: this.myName() })
      .then((d) => { this.enterRoom(d.code); })
      .catch((e) => {
        this.setData({ busy: false });
        wx.showToast({ title: e.message || '创建失败', icon: 'none' });
      });
  },

  joinRoom() {
    const code = String(this.data.joinCode || '').trim();
    if (!/^\d{6}$/.test(code)) return wx.showToast({ title: '请输入 6 位数字房间码', icon: 'none' });
    if (this.data.busy) return;
    this.setData({ busy: true });
    this.call('score.join', { code, name: this.myName() })
      .then(() => { this.enterRoom(code); })
      .catch((e) => {
        this.setData({ busy: false });
        wx.showToast({ title: e.message || '加入失败', icon: 'none' });
      });
  },

  enterRoom(code) {
    this.setData({ stage: 'room', roomCode: code, busy: false });
    this.refresh();
    this.startWatch(code);
  },

  leaveRoom() {
    this.closeWatch();
    this.setData({ stage: 'lobby', roomCode: '', joinCode: '', players: [], logs: [], selectedId: '' });
  },

  copyCode() { wx.setClipboardData({ data: this.data.roomCode }); },

  // ================= 实时同步 =================
  // watch 需要集合"可读"权限；无权限时收不到变更 → 2 秒轮询兜底
  startWatch(code) {
    this.closeWatch();
    // 兜底轮询：watch 在集合无客户端读权限时可能静默失效，2 秒拉一次保证同步
    this.pollTimer = setInterval(() => this.refresh(), 2000);
    const db = wx.cloud.database();
    this.watcher = db.collection('score_rooms').where({ code }).watch({
      onChange: (snapshot) => {
        const doc = snapshot.docs && snapshot.docs[0];
        if (doc) this.refresh();
      },
      onError: () => {},
    });
  },
  closeWatch() {
    if (this.watcher) { try { this.watcher.close(); } catch (e) {} this.watcher = null; }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  },
  refresh() {
    this.call('score.get', { code: this.data.roomCode })
      .then((room) => this.applyRoom(room))
      .catch((e) => {
        if (e && /不存在|不在/.test(e.message || '')) this.leaveRoom();
      });
  },
  applyRoom(room) {
    const me = (room.players || []).find((p) => p.isMe);
    this.setData({
      players: room.players || [],
      logs: room.logs || [],
      status: room.status,
      round: room.round || 1,
      isHost: !!(me && me.isHost),
      meId: me ? me.id : '',
    });
  },

  // ================= 记分 =================
  selectPlayer(e) {
    const id = e.currentTarget.dataset.id;
    const p = this.data.players.find((x) => x.id === id);
    if (!p) return;
    if (p.isMe) return wx.showToast({ title: '不能给自己记分', icon: 'none' });
    this.setData({ selectedId: id, selectedName: p.name });
  },

  onDeltaInput(e) {
    const v = String(e.detail.value || '').replace(/\D/g, '').slice(0, 4);
    this.setData({ delta: v });
    return v;
  },
  onReasonInput(e) { this.setData({ reason: e.detail.value }); },

  quickDelta(e) {
    const v = Number(e.currentTarget.dataset.v);
    this.setData({ delta: String(v) });
  },

  // 自定义积分：弹出可输入对话框
  openCustom() {
    wx.showModal({
      title: '自定义分值',
      editable: true,
      placeholderText: '输入 1-9999 的分值',
      success: (r) => {
        if (!r.confirm) return;
        const v = String(r.content || '').replace(/\D/g, '').slice(0, 4);
        if (v) this.setData({ delta: v });
      },
    });
  },

  // 麻将式转账：给选中玩家 N 分，自己自动扣 N 分
  submitGive() {
    if (!this.data.selectedId) return wx.showToast({ title: '先选中一位收分的玩家', icon: 'none' });
    const n = Math.round(Number(this.data.delta));
    if (!n || n <= 0 || n > 9999) return wx.showToast({ title: '请输入分值', icon: 'none' });
    if (this.data.busy) return;
    this.setData({ busy: true });
    this.call('score.adjust', {
      code: this.data.roomCode,
      targetId: this.data.selectedId,
      amount: n,
      reason: String(this.data.reason || '').trim(),
    })
      .then(() => { this.setData({ busy: false, delta: '', reason: '' }); })
      .catch((e) => {
        this.setData({ busy: false });
        wx.showToast({ title: e.message || '操作失败', icon: 'none' });
      });
  },

  finishRound() {
    wx.showModal({
      title: '结束本局', content: '结束后不能再记分，可再来一局清零',
      success: (r) => {
        if (r.confirm) this.call('score.finish', { code: this.data.roomCode }).catch((e) => wx.showToast({ title: e.message, icon: 'none' }));
      },
    });
  },

  reopen() {
    this.call('score.reopen', { code: this.data.roomCode })
      .then(() => this.refresh())
      .catch((e) => wx.showToast({ title: e.message || '操作失败', icon: 'none' }));
  },
});
