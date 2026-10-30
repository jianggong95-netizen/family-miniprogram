// 俄罗斯方块：10x18 格，重力下落 + 消行计分 + 逐级加速
// 特性：右侧「下一个」方块预览、消行白色闪光动画、原创 8-bit BGM（《货郎》旋律，公有领域）
const { check } = require('../../../utils/perms');
const COLS = 10, ROWS = 18;
const SHAPES = [
  { cells: [[0, 0], [1, 0], [0, 1], [1, 1]], color: '#F59E0B' },               // O
  { cells: [[0, 0], [1, 0], [2, 0], [1, 1]], color: '#8B5CF6' },               // T
  { cells: [[0, 0], [1, 0], [2, 0], [3, 0]], color: '#06B6D4' },               // I
  { cells: [[0, 0], [0, 1], [1, 1], [2, 1]], color: '#10B981' },               // J
  { cells: [[2, 0], [0, 1], [1, 1], [2, 1]], color: '#EF4444' },               // L
  { cells: [[1, 0], [2, 0], [0, 1], [1, 1]], color: '#3B82F6' },               // S
  { cells: [[0, 0], [1, 0], [1, 1], [2, 1]], color: '#EC4899' },               // Z
];

const PREVIEW_W = 76; // 画布右侧预留的「下一个」预览列宽（px）

Page({
  data: { score: 0, lines: 0, level: 1, over: false, paused: false, statusText: '', muted: false },

  onLoad() {
    check('tetris').then((r) => {
      if (!r.allowed) {
        wx.showToast({ title: '俄罗斯方块已被管理员禁用', icon: 'none' });
        setTimeout(() => wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/games/games' }) }), 900);
        return;
      }
      this.muted = !!wx.getStorageSync('tetris_muted');
      this.setData({ muted: this.muted });
      this.grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
      this.initCanvas();
      this.initAudio();
      this.restart();
    });
  },

  onUnload() { this.stopTimer(); this.stopFlash(); this.stopBgm(); this.closeAudio(); },
  onHide() { if (!this.data.over && !this.data.paused) { this._autoPaused = true; this.pause(); } },
  onShow() { if (this._autoPaused) { this._autoPaused = false; this.pause(); } },

  // ================= 画布 =================
  initCanvas() {
    wx.createSelectorQuery()
      .select('#tetris')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) return;
        const { node: canvas, width, height } = res[0];
        const dpr = wx.getSystemInfoSync().pixelRatio;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.ctx.scale(dpr, dpr);
        this.w = width;
        this.h = height;
        // 棋盘变大：高度撑满可用区域，右侧预留预览列
        this.unit = Math.min((width - PREVIEW_W - 8) / COLS, (height - 8) / ROWS);
        this.ox = (width - PREVIEW_W - this.unit * COLS) / 2;
        this.oy = (height - this.unit * ROWS) / 2;
        this.draw();
      });
  },

  // ================= 音效与 BGM（WebAudio 合成） =================
  initAudio() { try { this.ac = wx.createWebAudioContext(); } catch (e) { this.ac = null; } },
  closeAudio() { try { if (this.ac) this.ac.close(); } catch (e) {} this.ac = null; },
  tone(freq, dur, type, vol, delay) {
    const ac = this.ac;
    if (!ac || this.muted) return;
    try {
      const t0 = ac.currentTime + (delay || 0);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(vol || 0.06, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(ac.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) {}
  },
  sfxRotate() { this.tone(520, 0.05, 'square', 0.04); },
  sfxLock() { this.tone(160, 0.06, 'triangle', 0.06, 0); },
  sfxMove() { this.tone(300, 0.03, 'triangle', 0.03); },
  sfxClear(n) { [523, 659, 784, 1046].slice(0, n + 1).forEach((f, i) => this.tone(f, 0.1, 'square', 0.07, i * 0.06)); },
  sfxDrop() { this.tone(240, 0.08, 'sawtooth', 0.05, 90); },
  sfxOver() { [392, 330, 262, 196, 147].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.09, i * 0.16)); },
  // 《货郎》Korobeiniki 主旋律（E 小调，公有领域民谣）32 步循环 + 低音
  startBgm() {
    if (this.muted || this.bgmTimer || !this.ac) return;
    const SEQ = [
      659, 988, 1047, 1175, 1047, 988, 880, 880,
      1047, 1319, 1175, 1047, 988, 784, 784, 880,
      988, 1319, 988, 1047, 1175, 1047, 988, 880,
      880, 1047, 1319, 1175, 1047, 988, 880, 659,
    ];
    let step = 0;
    this.bgmTimer = setInterval(() => {
      if (this.muted || this.data.paused || this.data.over) return;
      this.tone(SEQ[step], 0.13, 'square', 0.018);
      if (step % 8 === 0) this.tone(step % 16 === 0 ? 110 : 165, 0.26, 'triangle', 0.03);
      step = (step + 1) % SEQ.length;
    }, 165);
  },
  stopBgm() { if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; } },
  toggleMute() {
    this.muted = !this.muted;
    this.setData({ muted: this.muted });
    wx.setStorageSync('tetris_muted', this.muted);
    if (this.muted) this.stopBgm(); else this.startBgm();
  },

  // ================= 流程 =================
  restart() {
    this.stopTimer(); this.stopFlash();
    this.grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
    this.score = 0; this.lines = 0; this.level = 1;
    this.flash = null;
    this.next = Math.floor(Math.random() * SHAPES.length);
    this.setData({ score: 0, lines: 0, level: 1, over: false, paused: false, statusText: '' });
    this.spawn();
    this.startTimer();
    this.startBgm();
    this.draw();
  },

  spawn() {
    const s = SHAPES[this.next];
    this.piece = {
      color: s.color,
      cells: s.cells.map(([x, y]) => [x, y]),
      x: 3, y: 0,
    };
    this.next = Math.floor(Math.random() * SHAPES.length);
    if (this.collide(this.piece.x, this.piece.y, this.piece.cells)) {
      this.gameOver();
    }
  },

  collide(px, py, cells) {
    for (const [cx, cy] of cells) {
      const x = px + cx, y = py + cy;
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      if (y >= 0 && this.grid[y][x]) return true;
    }
    return false;
  },

  tick() {
    if (this.data.over || this.data.paused || this.flash) return;
    const p = this.piece;
    if (!this.collide(p.x, p.y + 1, p.cells)) {
      p.y++;
    } else {
      this.lock(p);
      this.sfxLock();
      this.settle();
    }
    this.draw();
  },

  // 锁定后结算：有满行 → 闪光动画（动画结束再消行+生成），否则直接生成
  settle() {
    const full = [];
    for (let r = 0; r < ROWS; r++) if (this.grid[r].every((c) => c)) full.push(r);
    if (full.length) this.startFlash(full);
    else this.spawn();
  },

  startFlash(rows) {
    this.stopTimer();
    this.flash = { rows, t: 0 };
    this.sfxClear(rows.length);
    this._flashTimer = setInterval(() => {
      this.flash.t += 40;
      if (this.flash.t >= 320) {
        this.stopFlash();
        this.removeRows(rows);
        this.flash = null;
        this.spawn();
        if (!this.data.over) { this.startTimer(); }
        this.draw();
        return;
      }
      this.draw();
    }, 40);
  },
  stopFlash() { if (this._flashTimer) { clearInterval(this._flashTimer); this._flashTimer = null; } },

  removeRows(rows) {
    // 从下往上删除，保持索引正确
    rows.slice().sort((a, b) => b - a).forEach((r) => {
      this.grid.splice(r, 1);
      this.grid.unshift(new Array(COLS).fill(null));
    });
    const cleared = rows.length;
    this.score += [0, 100, 300, 500, 800][cleared] * this.level;
    this.lines += cleared;
    const level = 1 + Math.floor(this.lines / 8);
    if (level !== this.level) this.level = level;
    this.setData({ score: this.score, lines: this.lines, level: this.level });
  },

  startTimer() {
    this.stopTimer();
    const speed = Math.max(260, 820 - (this.level - 1) * 55);
    this.timer = setInterval(() => this.tick(), speed);
  },
  stopTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  },

  move(e) {
    if (this.data.over || this.data.paused || this.flash) return;
    const dx = Number(e.currentTarget.dataset.d) || 0;
    const p = this.piece;
    if (!this.collide(p.x + dx, p.y, p.cells)) { p.x += dx; this.sfxMove(); this.draw(); }
  },

  rotate() {
    if (this.data.over || this.data.paused || this.flash) return;
    const p = this.piece;
    const rotated = p.cells.map(([x, y]) => [-y, x]);
    const minX = Math.min(...rotated.map(([x]) => x));
    const minY = Math.min(...rotated.map(([, y]) => y));
    const norm = rotated.map(([x, y]) => [x - minX, y - minY]);
    // 靠墙时尝试左右踢墙
    for (const kick of [0, -1, 1, -2, 2]) {
      if (!this.collide(p.x + kick, p.y, norm)) {
        p.cells = norm;
        p.x += kick;
        this.sfxRotate();
        this.draw();
        return;
      }
    }
  },

  softDrop() {
    if (this.data.over || this.data.paused || this.flash) return;
    const p = this.piece;
    if (!this.collide(p.x, p.y + 1, p.cells)) { p.y++; this.score += 1; }
    else { this.lock(p); this.sfxLock(); this.settle(); }
    this.setData({ score: this.score });
    this.draw();
  },

  hardDrop() {
    if (this.data.over || this.data.paused || this.flash) return;
    const p = this.piece;
    while (!this.collide(p.x, p.y + 1, p.cells)) { p.y++; this.score += 2; }
    this.sfxDrop();
    this.lock(p);
    this.settle();
    this.setData({ score: this.score });
    this.draw();
  },

  pause() {
    if (this.data.over) return;
    const paused = !this.data.paused;
    this.setData({ paused, statusText: paused ? '已暂停' : '' });
    if (paused) {
      this.stopTimer();
      // 闪光动画中途暂停：立即结算消行，避免状态不一致
      if (this.flash) {
        const rows = this.flash.rows;
        this.stopFlash(); this.flash = null;
        this.removeRows(rows);
        this.spawn();
      }
    } else {
      this.startTimer(); this.startBgm();
    }
  },

  gameOver() {
    this.stopTimer(); this.stopFlash(); this.stopBgm();
    this.flash = null;
    this.sfxOver();
    this.setData({ over: true, statusText: '游戏结束' });
    wx.showModal({
      title: '游戏结束',
      content: `得分 ${this.score}，消行 ${this.lines}`,
      confirmText: '再来一局',
      cancelText: '退出',
      success: (res) => {
        if (res.confirm) this.restart();
        else wx.navigateBack();
      },
    });
  },

  // ================= 渲染 =================
  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.unit) return;
    const { unit, ox, oy } = this;
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, this.w, this.h);

    // 网格底
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.strokeRect(ox + c * unit, oy + r * unit, unit, unit);
      }
    }
    // 已固定
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c]) this.block(ox + c * unit, oy + r * unit, this.grid[r][c]);
      }
    }
    // 当前方块
    if (this.piece && !this.data.over) {
      const p = this.piece;
      for (const [cx, cy] of p.cells) {
        const y = p.y + cy;
        if (y >= 0) this.block(ox + (p.x + cx) * unit, oy + y * unit, p.color);
      }
    }
    // 消行闪光：满行白色脉冲（3 次闪烁）
    if (this.flash) {
      const a = 0.25 + 0.65 * Math.abs(Math.sin((this.flash.t / 320) * Math.PI * 3));
      ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      for (const r of this.flash.rows) {
        ctx.fillRect(ox, oy + r * unit, COLS * unit, unit);
      }
    }
    // 游戏区外框
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox - 2, oy - 2, COLS * unit + 4, ROWS * unit + 4);
    ctx.lineWidth = 1;

    this.drawNext(ctx);
  },

  // 右侧「下一个」预览
  drawNext(ctx) {
    const { unit, oy } = this;
    const px = this.w - PREVIEW_W + 6;
    const pw = PREVIEW_W - 14;
    // 面板框
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.strokeRect(px, oy, pw, 64);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('下一个', px + pw / 2, oy + 4);
    // 迷你方块（最大 4 格宽）
    const s = SHAPES[this.next];
    if (!s) return;
    const mini = Math.min(13, (pw - 8) / 4, 40 / 2);
    const wCells = Math.max(...s.cells.map(([x]) => x)) + 1;
    const hCells = Math.max(...s.cells.map(([, y]) => y)) + 1;
    const sx = px + (pw - wCells * mini) / 2;
    const sy = oy + 18 + (44 - hCells * mini) / 2;
    for (const [cx, cy] of s.cells) {
      const x = sx + cx * mini, y = sy + cy * mini;
      ctx.fillStyle = s.color;
      ctx.fillRect(x + 1, y + 1, mini - 2, mini - 2);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x + 1, y + 1, mini - 2, 2);
    }
  },

  block(x, y, color) {
    const ctx = this.ctx;
    const u = this.unit;
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, u - 2, u - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + 1, y + 1, u - 2, 3);
  },
});
