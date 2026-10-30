// 五子棋：15x15。模式：双人(pvp) / 人机(ai) / 联机(online，云数据库 watch 实时同步)
const { check } = require('../../../utils/perms');
const SIZE = 15;
const EMPTY = 0, BLACK = 1, WHITE = 2;

Page({
  data: {
    mode: 'pvp', // pvp | ai | online
    stage: 'play', // online 子阶段：lobby | waiting | play
    turn: BLACK,
    winner: 0,
    statusText: '黑方落子',
    lastMove: '',
    // 联机
    roomCode: '',
    joinCode: '',
    myColor: '', // 'black' | 'white'
    myTurn: false,
    roomInfo: '',
    onlineBusy: false,
    // 准备阶段
    iReady: false,
    oppReady: false,
    oppName: '',
    muted: false,
  },

  onLoad() {
    check('gomoku').then((r) => {
      if (!r.allowed) {
        wx.showToast({ title: '五子棋已被管理员禁用', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 900);
        return;
      }
      this.muted = !!wx.getStorageSync('gomoku_muted');
      this.setData({ muted: this.muted });
      this.initAudio();
      this.resetBoard();
      this.initCanvas();
    });
  },

  onUnload() { this.closeWatch(); this.stopBgm(); this.closeAudio(); },
  onHide() { this.closeWatch(); this.stopBgm(); },
  onShow() {
    // 联机对局中返回页面：重建监听并同步快照
    if (this.data.mode === 'online' && this.data.roomCode && this.data.stage !== 'lobby') {
      this.refreshRoom(this.data.roomCode);
      this.startWatch(this.data.roomCode);
    }
    if (!this.muted) this.startBgm();
  },

  // ================= 音效（WebAudio 合成，无需音频文件） =================
  initAudio() {
    if (this.ac) return;
    try { this.ac = wx.createWebAudioContext(); } catch (e) { this.ac = null; }
  },
  closeAudio() { try { if (this.ac) this.ac.close(); } catch (e) {} this.ac = null; },
  tone(freq, dur, type, vol, delay) {
    const ac = this.ac;
    if (!ac || this.muted) return;
    try {
      if (ac.state === 'suspended' && ac.resume) ac.resume();
      const t0 = ac.currentTime + (delay || 0);
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(ac.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) {}
  },
  // 落子声：黑子低沉、白子清脆
  sfxPlace(who) { this.tone(who === BLACK ? 180 : 320, 0.12, 'triangle', 0.18); this.tone(who === BLACK ? 90 : 160, 0.08, 'sine', 0.12); },
  sfxWin() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.16, i * 0.14)); },
  sfxLose() { [440, 349, 262].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.12, i * 0.2)); },
  sfxDraw() { this.tone(392, 0.3, 'sine', 0.14); this.tone(392, 0.3, 'sine', 0.14, 0.35); },
  // 背景音乐：五声音阶轻柔循环
  startBgm() {
    this.initAudio();
    if (this.muted || this.bgmTimer) return;
    const scale = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3];
    let step = 0;
    this.bgmTimer = setInterval(() => {
      if (this.muted) return;
      const n = scale[(step * 3 + (step % 2)) % scale.length];
      this.tone(n, 0.5, 'sine', 0.04);
      if (step % 4 === 0) this.tone(n / 2, 0.7, 'sine', 0.03);
      step++;
    }, 620);
  },
  stopBgm() { if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; } },
  toggleMute() {
    this.muted = !this.muted;
    this.setData({ muted: this.muted });
    wx.setStorageSync('gomoku_muted', this.muted);
    if (this.muted) this.stopBgm();
    else this.startBgm();
  },

  resetBoard() {
    this.board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY));
    this.history = [];
    // 注意：不要重置 this.pad / this.cell，它们是 canvas 几何参数，
    // 由 initCanvas 计算一次；若清零，draw() 会把网格线画成不可见的点。
  },

  initCanvas(cb) {
    wx.createSelectorQuery()
      .select('#gomoku')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) { if (cb) cb(false); return; }
        const { node: canvas, width } = res[0];
        const dpr = wx.getSystemInfoSync().pixelRatio;
        canvas.width = width * dpr;
        canvas.height = width * dpr;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.ctx.scale(dpr, dpr);
        this.sizePx = width;
        this.pad = width / (SIZE + 1) / 2 + 8;
        this.cell = (width - this.pad * 2) / (SIZE - 1);
        this.draw();
        if (cb) cb(true);
      });
  },

  call(action, data) {
    return wx.cloud.callFunction({ name: 'closetApi', data: Object.assign({ action }, data || {}) }).then((res) => {
      const body = (res && res.result) || {};
      if (body.code !== 0) throw body;
      return body.data;
    });
  },

  // ================= 模式切换 =================
  pickMode(e) {
    const next = e.currentTarget.dataset.m;
    if (next === this.data.mode) return;
    this.closeWatch();
    this.setData({
      mode: next,
      stage: next === 'online' ? 'lobby' : 'play',
      roomCode: '',
      joinCode: '',
      myColor: '',
      myTurn: false,
      winner: 0,
      roomInfo: '',
    });
    this.restartBoard();
  },

  restartBoard() {
    this.resetBoard();
    this.setData({ turn: BLACK, winner: 0, statusText: '黑方落子', lastMove: '' });
    this.draw();
  },

  // ================= 联机：大厅 =================
  onJoinCodeInput(e) {
    // 只保留数字，最多 4 位（兼容模拟器物理键盘输入）
    const v = String(e.detail.value || '').replace(/\D/g, '').slice(0, 4);
    this.setData({ joinCode: v });
    return v;
  },

  createRoom() {
    if (this.data.onlineBusy) return;
    this.setData({ onlineBusy: true });
    const name = (getApp().globalData.member && getApp().globalData.member.name) || '玩家';
    this.call('gomoku.create', { name })
      .then((d) => {
        this._isHost = true;
        this.setData({
          roomCode: d.code,
          myColor: d.color,
          stage: 'waiting',
          statusText: '等待对手加入…',
          onlineBusy: false,
        });
        this.startWatch(d.code);
      })
      .catch((e) => {
        this.setData({ onlineBusy: false });
        wx.showToast({ title: e.message || '创建失败', icon: 'none' });
      });
  },

  joinRoom() {
    const code = String(this.data.joinCode || '').trim();
    if (!/^\d{4}$/.test(code)) return wx.showToast({ title: '请输入 4 位数字房间码', icon: 'none' });
    if (this.data.onlineBusy) return;
    this.setData({ onlineBusy: true });
    const name = (getApp().globalData.member && getApp().globalData.member.name) || '玩家';
    this.call('gomoku.join', { code, name })
      .then((d) => {
        this._isHost = false;
        this.setData({ roomCode: code, myColor: d.color, stage: 'waiting', onlineBusy: false });
        this.refreshRoom(code);
        this.startWatch(code);
      })
      .catch((e) => {
        this.setData({ onlineBusy: false });
        wx.showToast({ title: e.message || '加入失败', icon: 'none' });
      });
  },

  copyCode() {
    if (!this.data.roomCode) return;
    wx.setClipboardData({ data: this.data.roomCode });
  },

  backLobby() {
    this.closeWatch();
    this.restartBoard();
    this.setData({ stage: 'lobby', roomCode: '', myColor: '', myTurn: false, statusText: '' });
  },

  // ================= 联机：实时同步 =================
  // watch 需要集合"可读"权限；无权限时收不到任何变更事件。
  // watch 有变化 → 本地直接规范化快照渲染（零额外往返）；watch 拿不到 → 1 秒轮询兜底
  startWatch(code) {
    this.closeWatch();
    // 兜底轮询：watch 在集合无客户端读权限时可能静默失效，1 秒拉一次保证同步
    this.pollTimer = setInterval(() => this.refreshRoom(code), 1000);
    const db = wx.cloud.database();
    this.watcher = db.collection('gomoku_rooms').where({ code }).watch({
      onChange: (snapshot) => {
        const doc = snapshot.docs && snapshot.docs[0];
        if (!doc) return;
        // watch 快照已含完整房间数据，本地规范化直接渲染，省一次云函数往返（降低延迟）
        const room = this.normalizeDoc(doc);
        if (room) this.applyRoom(room);
        else this.refreshRoom(code);
      },
      onError: () => {},
    });
  },
  // 把数据库原始文档规范化为 gomoku.get 返回的同构快照
  normalizeDoc(d) {
    if (!d || this._isHost === undefined) return null;
    const hc = d.host_color || 'black';
    const isHost = !!this._isHost;
    return {
      code: d.code,
      host: d.host && d.host.name,
      guest: d.guest && d.guest.name,
      moves: d.moves || [],
      turn: d.turn,
      status: d.status,
      hostReady: !!d.host_ready,
      guestReady: !!d.guest_ready,
      winner: d.winner || null,
      myColor: isHost ? hc : (hc === 'black' ? 'white' : 'black'),
      isHost,
    };
  },
  closeWatch() {
    if (this.watcher) { try { this.watcher.close(); } catch (e) {} this.watcher = null; }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  },
  refreshRoom(code) {
    this.call('gomoku.get', { code })
      .then((room) => this.applyRoom(room, true))
      .catch(() => {});
  },

  /** 把房间状态映射到页面 */
  applyRoom(room, isSnapshot) {
    if (room.isHost !== undefined) this._isHost = !!room.isHost;
    const myColor = room.myColor || this.data.myColor;
    const isHost = !!room.isHost;
    const iReady = isHost ? !!room.hostReady : !!room.guestReady;
    const oppReady = isHost ? !!room.guestReady : !!room.hostReady;
    const oppName = isHost ? (room.guest || '等待加入') : (room.host || '?');

    // 等待对手 / 准备阶段：不画棋盘
    if (room.status === 'waiting') {
      this.setData({ stage: 'waiting', statusText: '等待对手加入…', oppName: '' });
      return;
    }
    if (room.status === 'ready') {
      this.setData({
        stage: 'ready',
        myColor,
        iReady,
        oppReady,
        oppName,
        roomInfo: (room.host || '?') + ' vs ' + (room.guest || '等待加入'),
        statusText: oppReady ? '双方已准备，即将开局…' : (iReady ? '已准备，等待对手点击开始' : '对手已准备，点击"开始"开局'),
      });
      return;
    }

    // playing / ended：进入棋盘。
    // 注意：大厅/等待/准备阶段棋盘 canvas 并未渲染（wx:if 卸载/未挂载），
    // 切入 play 后节点是新建的，旧 ctx 已失效，必须重新初始化再绘制，
    // 否则棋盘一片空白。
    const wasPlay = this.data.stage === 'play';
    this.setData({
      stage: 'play',
      myColor,
      iReady: true,
      oppReady: true,
      oppName,
      roomInfo: (room.host || '?') + ' vs ' + (room.guest || '等待加入'),
    });
    if (wasPlay && this.ctx) {
      this.renderRoom(room, myColor);
    } else {
      setTimeout(() => {
        this.initCanvas((ok) => { if (ok) this.renderRoom(room, myColor); });
      }, 50);
    }
  },

  renderRoom(room, myColor) {
    const prevCount = this.history.length;
    const prevEnded = this.data.winner;
    this.resetBoard();
    (room.moves || []).forEach((m) => {
      const who = m.w === 'black' ? BLACK : WHITE;
      this.board[m.r][m.c] = who;
      this.history.push({ row: m.r, col: m.c, who });
    });

    const myTurnColor = myColor === 'black' ? 'black' : 'white';
    let statusText = '';
    let winner = 0;
    if (room.status === 'ended') {
      if (room.winner === 'draw') statusText = '平局';
      else if (room.winner === myTurnColor) statusText = '你赢了 🎉';
      else statusText = '你输了';
      winner = 1;
    } else {
      statusText = room.turn === myTurnColor ? '轮到你落子' : '等待对手落子…';
    }

    // 音效：对手新落子（本地乐观渲染的棋子不重复出声）；结算音
    if (this.history.length > prevCount && this.history.length > (this._optiCount || 0)) {
      this.sfxPlace(this.history[this.history.length - 1].who);
    }
    if (room.status === 'ended' && !prevEnded) {
      if (room.winner === 'draw') this.sfxDraw();
      else if (room.winner === myTurnColor) this.sfxWin();
      else this.sfxLose();
    }
    this._optiCount = 0;

    this.setData({
      myTurn: room.turn === myTurnColor && room.status === 'playing',
      winner,
      statusText,
      lastMove: this.history.length ? `${this.history[this.history.length - 1].row},${this.history[this.history.length - 1].col}` : '',
    });
    this.draw();
  },

  // 点击"开始"（准备）
  readyStart() {
    if (this.data.onlineBusy || this.data.iReady) return;
    this.setData({ onlineBusy: true });
    this.call('gomoku.ready', { code: this.data.roomCode })
      .then(() => {
        this.setData({ onlineBusy: false, iReady: true, statusText: '已准备，等待对手点击开始' });
        this.refreshRoom(this.data.roomCode);
      })
      .catch((e) => {
        this.setData({ onlineBusy: false });
        wx.showToast({ title: e.message || '操作失败', icon: 'none' });
      });
  },

  // ================= 落子 =================
  onTap(e) {
    if (this.data.winner) return;
    const t = e.touches[0] || e.changedTouches[0];
    const col = Math.round((t.x - this.pad) / this.cell);
    const row = Math.round((t.y - this.pad) / this.cell);
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return;
    if (this.board[row][col] !== EMPTY) return;

    if (this.data.mode === 'online') {
      if (!this.data.myTurn) return wx.showToast({ title: '还没轮到你', icon: 'none' });
      // 乐观渲染：本地立即落子出声，不等云函数返回（消除落子延迟感）
      const who = this.data.myColor === 'black' ? BLACK : WHITE;
      this.board[row][col] = who;
      this.history.push({ row, col, who });
      this._optiCount = this.history.length;
      this.sfxPlace(who);
      this.setData({ myTurn: false, statusText: '等待对手落子…', lastMove: `${row},${col}` });
      this.draw();
      this.call('gomoku.move', { code: this.data.roomCode, r: row, c: col })
        .then((snap) => {
          // 云函数已返回最新快照，直接应用（省一次 get 往返）
          if (snap && snap.moves) this.applyRoom(snap);
        })
        .catch((err) => {
          wx.showToast({ title: err.message || '落子失败', icon: 'none' });
          this.refreshRoom(this.data.roomCode); // 回滚为服务端真实状态
        });
      return;
    }

    if (this.data.mode === 'ai' && this.data.turn === WHITE) return;
    this.place(row, col);
    if (!this.data.winner && this.data.mode === 'ai') {
      this.draw();
      setTimeout(() => this.aiMove(), 300);
    } else {
      this.draw();
    }
  },

  place(row, col) {
    const who = this.data.turn;
    this.board[row][col] = who;
    this.history.push({ row, col, who });
    this.sfxPlace(who);
    if (this.checkWin(row, col, who)) {
      this.sfxWin();
      this.setData({ winner: who, statusText: who === BLACK ? '黑方胜！' : '白方胜！', lastMove: `${row},${col}` });
    } else if (this.history.length >= SIZE * SIZE) {
      this.sfxDraw();
      this.setData({ winner: -1, statusText: '平局' });
    } else {
      const next = who === BLACK ? WHITE : BLACK;
      this.setData({ turn: next, statusText: next === BLACK ? '黑方落子' : '白方落子', lastMove: `${row},${col}` });
    }
  },

  checkWin(row, col, who) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      let n = 1;
      for (let k = 1; k < 5; k++) {
        const r = row + dr * k, c = col + dc * k;
        if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || this.board[r][c] !== who) break;
        n++;
      }
      for (let k = 1; k < 5; k++) {
        const r = row - dr * k, c = col - dc * k;
        if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || this.board[r][c] !== who) break;
        n++;
      }
      if (n >= 5) return true;
    }
    return false;
  },

  // ================= 本地 AI =================
  aiMove() {
    if (this.data.winner) return;
    const me = WHITE, you = BLACK;
    let best = null, bestScore = -1;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (this.board[r][c] !== EMPTY) continue;
        if (!this.hasNeighbor(r, c, 2)) continue;
        const score = this.evalPoint(r, c, me) * 1.1 + this.evalPoint(r, c, you);
        if (score > bestScore) { bestScore = score; best = { r, c }; }
      }
    }
    if (!best) best = { r: 7, c: 7 };
    this.place(best.r, best.c);
    this.draw();
  },

  hasNeighbor(r, c, dist) {
    for (let dr = -dist; dr <= dist; dr++) {
      for (let dc = -dist; dc <= dist; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && this.board[rr][cc] !== EMPTY) return true;
      }
    }
    return false;
  },

  evalPoint(r, c, who) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    let total = 0;
    for (const [dr, dc] of dirs) {
      let n = 1, open = 0;
      let k = 1;
      while (true) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) break;
        if (this.board[rr][cc] === who) { n++; k++; }
        else { if (this.board[rr][cc] === EMPTY) open++; break; }
      }
      k = 1;
      while (true) {
        const rr = r - dr * k, cc = c - dc * k;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) break;
        if (this.board[rr][cc] === who) { n++; k++; }
        else { if (this.board[rr][cc] === EMPTY) open++; break; }
      }
      if (n >= 5) total += 100000;
      else if (n === 4) total += open === 2 ? 10000 : open === 1 ? 1000 : 0;
      else if (n === 3) total += open === 2 ? 500 : open === 1 ? 100 : 0;
      else if (n === 2) total += open === 2 ? 50 : 10;
      else total += n;
    }
    return total;
  },

  // ================= 联机操作 =================
  resign() {
    if (this.data.mode !== 'online' || !this.data.roomCode || this.data.winner) return;
    wx.showModal({
      title: '认输', content: '确定认输本局？',
      success: (r) => { if (r.confirm) this.call('gomoku.resign', { code: this.data.roomCode }).catch(() => {}); },
    });
  },

  rematch() {
    if (this.data.mode !== 'online' || !this.data.roomCode) return;
    this.call('gomoku.rematch', { code: this.data.roomCode })
      .then(() => this.refreshRoom(this.data.roomCode))
      .catch((e) => wx.showToast({ title: e.message || '操作失败', icon: 'none' }));
  },

  // ================= 本地操作 =================
  undo() {
    if (this.data.mode === 'online' || this.data.winner || !this.history.length) return;
    const steps = this.data.mode === 'ai' ? (this.history.length >= 2 ? 2 : 1) : 1;
    for (let i = 0; i < steps; i++) {
      const last = this.history.pop();
      if (last) this.board[last.row][last.col] = EMPTY;
    }
    const turn = this.history.length % 2 === 0 ? BLACK : WHITE;
    this.setData({ turn, statusText: turn === BLACK ? '黑方落子' : '白方落子', lastMove: '' });
    this.draw();
  },

  restart() {
    if (this.data.mode === 'online') return this.rematch();
    this.restartBoard();
  },

  // ================= 绘制 =================
  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.cell) return; // canvas 未初始化/几何未就绪时不画，避免空白棋盘
    const { pad, cell } = this;
    ctx.fillStyle = '#E8D9B5';
    ctx.fillRect(0, 0, this.sizePx, this.sizePx);

    ctx.strokeStyle = '#8B7355';
    ctx.lineWidth = 1;
    for (let i = 0; i < SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(pad, pad + i * cell);
      ctx.lineTo(pad + (SIZE - 1) * cell, pad + i * cell);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pad + i * cell, pad);
      ctx.lineTo(pad + i * cell, pad + (SIZE - 1) * cell);
      ctx.stroke();
    }
    const stars = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
    ctx.fillStyle = '#5C4A2F';
    stars.forEach(([r, c]) => {
      ctx.beginPath();
      ctx.arc(pad + c * cell, pad + r * cell, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    this.history.forEach((h, idx) => {
      const x = pad + h.col * cell, y = pad + h.row * cell;
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = h.who === BLACK ? '#1F2937' : '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#5C4A2F';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (idx === this.history.length - 1) {
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.15, 0, Math.PI * 2);
        ctx.fillStyle = '#EF4444';
        ctx.fill();
      }
    });
  },
});
