// 炸弹小子：炸弹人式玩法（移植自 炸弹小子.html）
// 6 关选关 + 星级评价（本地存档），摇杆移动 + 放置炸弹，
// 十字爆炸 / 链式引爆 / 砖块掉道具，全灭怪物后开启出口、进门过关，
// 三种敌人（史莱姆/幽灵/猎手会追人），
// WebAudio 合成音效 + BGM，Canvas 2d 固定步长 60fps
const { check } = require('../../../utils/perms');

const TILE = 32;
const WALL = 1, BRICK = 2, EMPTY = 0;
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const LEVELS = [
  { name: '第 1 关', cols: 15, rows: 13, brickRatio: 0.42, enemyCount: 3, enemySpeed: 0.7, playerSpeed: 4.2 },
  { name: '第 2 关', cols: 15, rows: 13, brickRatio: 0.45, enemyCount: 4, enemySpeed: 0.8, playerSpeed: 4.2 },
  { name: '第 3 关', cols: 17, rows: 15, brickRatio: 0.48, enemyCount: 5, enemySpeed: 0.9, playerSpeed: 4.3 },
  { name: '第 4 关', cols: 17, rows: 15, brickRatio: 0.5, enemyCount: 6, enemySpeed: 1.0, playerSpeed: 4.3 },
  { name: '第 5 关', cols: 19, rows: 15, brickRatio: 0.5, enemyCount: 7, enemySpeed: 1.1, playerSpeed: 4.4 },
  { name: '第 6 关', cols: 19, rows: 17, brickRatio: 0.52, enemyCount: 8, enemySpeed: 1.2, playerSpeed: 4.4 },
];

const PU_GLYPH = { BOMB: '💣', RANGE: '🔥', SPEED: '👟', HP: '❤️' };
const PU_TYPES = ['BOMB', 'RANGE', 'SPEED', 'HP'];

// 圆角矩形（部分真机 canvas 无 roundRect）
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

Page({
  data: {
    state: 'ready', // ready | playing | paused | win | lose
    hp: 3, bombs: 1, range: 2, score: 0, levelNo: 1,
    stars: '', winBreak: '', loseReason: '',
    levelList: [], muted: false,
    stickX: 0, stickY: 0,
  },

  onLoad() {
    check('bomber').then((r) => {
      if (!r.allowed) {
        wx.showToast({ title: '炸弹小子已被管理员禁用', icon: 'none' });
        setTimeout(() => wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/games/games' }) }), 900);
        return;
      }
      this.loop = this.loop.bind(this);
      this.muted = !!wx.getStorageSync('bomber_muted');
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.winW = win.windowWidth;
      this.winH = win.windowHeight;
      this.setData({ muted: this.muted, levelList: this.buildLevelList() });
      this.initCanvas();
      this.initAudio();
      this._onWinResize = () => {
        const w2 = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        this.winW = w2.windowWidth; this.winH = w2.windowHeight;
        this.initCanvas();
      };
      wx.onWindowResize(this._onWinResize);
    });
  },
  onUnload() { this.stopLoop(); this.stopBgm(); this.closeAudio(); try { if (this._onWinResize) wx.offWindowResize(this._onWinResize); } catch (e) {} },
  onHide() { if (this.data.state === 'playing') this.setPause(true); },

  // ================= 画布 =================
  initCanvas() {
    wx.createSelectorQuery()
      .select('#bomber')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) {
          if (!this._cvRetry) { this._cvRetry = true; setTimeout(() => this.initCanvas(), 300); }
          return;
        }
        const { node: canvas, width, height } = res[0];
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = dpr;
        this.cw = width;
        this.ch = height;
        this._cvRetry = false;
        this.fit();
        this.render();
      });
  },
  // 地图等比缩放居中到画布
  fit() {
    const s = this.s;
    const W = s ? s.cols * TILE : LEVELS[0].cols * TILE;
    const H = s ? s.rows * TILE : LEVELS[0].rows * TILE;
    const scale = Math.min((this.cw - 8) / W, (this.ch - 8) / H);
    this.view = { scale, ox: (this.cw - W * scale) / 2, oy: (this.ch - H * scale) / 2 };
  },

  // ================= 音效（WebAudio 合成） =================
  initAudio() { try { this.ac = wx.createWebAudioContext(); } catch (e) { this.ac = null; } },
  closeAudio() { try { if (this.ac) this.ac.close(); } catch (e) {} this.ac = null; },
  tone(freq, dur, type, vol, slideTo, delay) {
    const ac = this.ac;
    if (!ac || this.muted) return;
    try {
      const t0 = ac.currentTime + (delay || 0);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
      g.gain.setValueAtTime(vol || 0.08, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(ac.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) {}
  },
  noise(dur, vol, cutoff) {
    const ac = this.ac;
    if (!ac || this.muted) return;
    try {
      const n = Math.floor(ac.sampleRate * dur);
      const buf = ac.createBuffer(1, n, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ac.createBufferSource(); src.buffer = buf;
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff || 800;
      const g = ac.createGain(); g.gain.value = vol || 0.12;
      src.connect(f); f.connect(g); g.connect(ac.destination); src.start();
    } catch (e) {}
  },
  sfxPlace() { this.tone(220, 0.08, 'triangle', 0.07, 140); },
  sfxExplode() { this.noise(0.4, 0.2, 500); this.tone(70, 0.35, 'sawtooth', 0.14, 28); },
  sfxPowerup() { this.tone(660, 0.08, 'square', 0.07, 990); this.tone(990, 0.12, 'square', 0.07, 1320, 0.08); },
  sfxHurt() { this.tone(320, 0.22, 'sawtooth', 0.1, 110); this.noise(0.1, 0.06, 600); },
  sfxKill() { this.tone(520, 0.07, 'square', 0.07, 200); this.noise(0.08, 0.05, 1500); },
  sfxWin() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.15, 'triangle', 0.1, f, i * 0.11)); },
  sfxLose() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.1, f, i * 0.17)); },
  startBgm() {
    if (this.muted || this.bgmTimer) return;
    // 紧张又轻快的 8-bit 循环（E 小调五声）
    const SEQ = [[330, 82], [0, 0], [392, 82], [440, 0], [392, 82], [330, 0], [294, 73], [0, 0],
      [330, 82], [0, 0], [440, 82], [494, 0], [440, 82], [392, 0], [330, 73], [294, 0]];
    let step = 0;
    this.bgmTimer = setInterval(() => {
      if (this.muted || this.data.state !== 'playing') return;
      const [mel, bass] = SEQ[step % SEQ.length];
      if (mel) this.tone(mel, 0.1, 'square', 0.016);
      if (bass) this.tone(bass, 0.16, 'triangle', 0.028);
      if (step % 4 === 2) this.noise(0.03, 0.01, 6000);
      step++;
    }, 175);
  },
  stopBgm() { if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; } },
  toggleMute() {
    this.muted = !this.muted;
    this.setData({ muted: this.muted });
    wx.setStorageSync('bomber_muted', this.muted);
    if (this.muted) this.stopBgm(); else if (this.data.state === 'playing') this.startBgm();
  },

  // ================= 输入（固定摇杆 + 放弹按钮） =================
  joyCenter() { return { x: 16 + 64, y: this.winH - 20 - 64 }; },
  joyDown(e) {
    const t = e.changedTouches[0];
    this.joyId = t.identifier;
    this.joyHandle(t.clientX, t.clientY);
  },
  joyMove(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.joyId) { this.joyHandle(t.clientX, t.clientY); break; }
    }
  },
  joyHandle(mx, my) {
    const c = this.joyCenter();
    let dx = mx - c.x, dy = my - c.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const max = 44;
    if (dist > max) { dx = dx / dist * max; dy = dy / dist * max; }
    const inp = this.input;
    if (inp) {
      // 模拟量：死区 8px 之外按偏移比例输出，轻推慢走、推满快走；
      // 输出下限 0.5，避免轻推时慢得难受（len 为限幅后的实际偏移长度）
      const DEAD = 8, FLOOR = 0.5;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > DEAD) {
        const mag = FLOOR + (1 - FLOOR) * Math.min(1, (len - DEAD) / (max - DEAD));
        inp.x = clamp(dx / len * mag, -1, 1);
        inp.y = clamp(dy / len * mag, -1, 1);
      } else {
        inp.x = 0; inp.y = 0;
      }
    }
    this.setData({ stickX: Math.round(dx), stickY: Math.round(dy) });
  },
  joyUp(e) {
    if (e && e.changedTouches) {
      let mine = false;
      for (const t of e.changedTouches) if (t.identifier === this.joyId) mine = true;
      if (!mine) return;
    }
    this.joyId = null;
    if (this.input) { this.input.x = 0; this.input.y = 0; }
    this.setData({ stickX: 0, stickY: 0 });
  },
  bombBtn() { if (this.input) this.input.bomb = true; },

  // ================= 关卡与流程 =================
  buildLevelList() {
    const unlocked = parseInt(wx.getStorageSync('bomber_unlocked') || '1', 10);
    const progress = parseInt(wx.getStorageSync('bomber_progress') || '1', 10);
    return LEVELS.map((l, i) => {
      const n = i + 1;
      // progress = 已通关的最高关号，故 n <= progress 即该关已通关
      return { n, locked: n > unlocked, cleared: n <= progress };
    });
  },
  pickLevel(e) {
    const n = e.currentTarget.dataset.n;
    const it = this.data.levelList[n - 1];
    if (it.locked) return wx.showToast({ title: '先通过前面的关卡', icon: 'none' });
    this.startLevel(n);
  },
  startGame() {
    const progress = clamp(parseInt(wx.getStorageSync('bomber_progress') || '1', 10), 1, LEVELS.length);
    this.startLevel(progress);
  },

  startLevel(n) {
    if (!this.ctx) {
      this._retry = (this._retry || 0) + 1;
      if (this._retry <= 10) setTimeout(() => this.startLevel(n), 200);
      else wx.showToast({ title: '画布初始化失败，请退出重进', icon: 'none' });
      return;
    }
    this._retry = 0;
    try { if (this.ac && this.ac.state === 'suspended') this.ac.resume(); } catch (e) {}
    this.currentLevel = n;
    const cfg = Object.assign({}, LEVELS[n - 1], { levelNo: n, powerupRate: 0.28 });
    this.s = this.newState(cfg);
    this.spawnEnemies(this.s);
    this.input = { x: 0, y: 0, bomb: false };
    this.shakeT = 0; this.shakeMag = 0;
    this.scorePopup = ''; this.scorePopupT = 0;
    this._hudCache = {};
    this.fit();
    this.setData({ state: 'playing', levelNo: n, score: 0, hp: 3, bombs: 1, range: 2, stickX: 0, stickY: 0 });
    this.startBgm();
    this.startLoop();
  },

  newState(cfg) {
    const cols = cfg.cols, rows = cfg.rows;
    const m = [];
    for (let y = 0; y < rows; y++) {
      m[y] = [];
      for (let x = 0; x < cols; x++) {
        if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) { m[y][x] = WALL; continue; }
        if (x % 2 === 0 && y % 2 === 0) { m[y][x] = WALL; continue; }
        // 出生点保护（左上 + 右上）
        if ((x <= 2 && y <= 2) || (x >= cols - 3 && y <= 2)) { m[y][x] = EMPTY; continue; }
        m[y][x] = Math.random() < cfg.brickRatio ? BRICK : EMPTY;
      }
    }
    return {
      cols, rows, map: m, cfg,
      player: { x: 1.5, y: 1.5, speed: cfg.playerSpeed, vx: 0, vy: 0, hp: 3, bombs: 1, range: 2, invincible: 0, alive: true },
      bombs: [], explosions: [], enemies: [], powerups: [], door: null,
      score: 0, time: 0, running: true,
    };
  },

  startLoop() { this.stopLoop(); this.lastTs = 0; this.acc = 0; this.raf = this.canvas.requestAnimationFrame(this.loop); },
  stopLoop() { if (this.raf && this.canvas) { try { this.canvas.cancelAnimationFrame(this.raf); } catch (e) {} } this.raf = null; },

  loop(ts) {
    if (this.data.state !== 'playing') { this.raf = null; return; }
    const dt = Math.min(0.05, (ts - (this.lastTs || ts)) / 1000);
    this.lastTs = ts;
    // 异常保护：单帧出错不断掉 rAF 链
    try {
      this.acc += dt;
      const STEP = 1 / 60;
      while (this.acc >= STEP) { this.update(STEP); this.acc -= STEP; }
      if (this.shakeT > 0) this.shakeT -= dt;
      if (this.scorePopupT > 0) this.scorePopupT -= dt;
      this.render();
      this.syncHud();
      this._err = 0;
    } catch (err) {
      this._err = (this._err || 0) + 1;
      console.error('[bomber] frame error', this._err, err && err.message);
      if (this._err >= 20) { this._err = 0; this.setPause(true); wx.showToast({ title: '画面异常，已自动暂停', icon: 'none' }); }
    }
    if (this.canvas) this.raf = this.canvas.requestAnimationFrame(this.loop);
  },

  setPause(pause) {
    if (pause) {
      if (this.data.state !== 'playing') return;
      if (this.s) this.s.running = false;
      this.stopLoop(); this.stopBgm();
      this.setData({ state: 'paused' });
    } else {
      if (this.data.state !== 'paused') return;
      if (this.s) this.s.running = true;
      this.setData({ state: 'playing' });
      this.startLoop(); this.startBgm();
    }
  },
  togglePause() { const s = this.data.state; if (s === 'playing') this.setPause(true); else if (s === 'paused') this.setPause(false); },
  restart() { this.startLevel(this.currentLevel); },
  goLevels() {
    this.stopLoop(); this.stopBgm();
    this.s = null; this.fit(); this.render();
    this.setData({ state: 'ready', levelList: this.buildLevelList() });
  },
  goBack() { this.stopLoop(); this.stopBgm(); wx.navigateBack(); },

  nextLevel() {
    if (this.currentLevel < LEVELS.length) this.startLevel(this.currentLevel + 1);
    else this.goLevels();
  },

  // ================= 游戏逻辑 =================
  solidAt(s, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= s.cols || ty >= s.rows) return true;
    if (s.map[ty][tx] === WALL || s.map[ty][tx] === BRICK) return true;
    const p = s.player;
    for (const b of s.bombs) {
      if (Math.floor(b.x) !== tx || Math.floor(b.y) !== ty) continue;
      // 经典炸弹人规则：玩家身体还压着的炸弹不挡路（放弹后可直接走开），
      // 完全离开该格后炸弹恢复阻挡
      if (p && p.alive) {
        const x0 = Math.floor(p.x - 0.32), x1 = Math.floor(p.x + 0.32);
        const y0 = Math.floor(p.y - 0.32), y1 = Math.floor(p.y + 0.32);
        if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) continue;
      }
      return true;
    }
    return false;
  },
  inExplosion(s, x, y) {
    for (const e of s.explosions) {
      if (Math.abs(x - e.x) < 0.55 && Math.abs(y - e.y) < 0.55) return true;
      if (e.cap === 'V' && Math.abs(x - e.x) < 0.45 && Math.abs(y - e.y) < 0.9) return true;
      if (e.cap === 'H' && Math.abs(y - e.y) < 0.45 && Math.abs(x - e.x) < 0.9) return true;
    }
    return false;
  },
  flashScore(t) { this.scorePopup = t; this.scorePopupT = 0.8; },
  shake(m) { this.shakeT = 0.25; this.shakeMag = m; },

  updatePlayer(s, dt) {
    const p = s.player;
    if (!p.alive) return;
    if (p.invincible > 0) p.invincible -= dt;
    const inp = this.input;
    const dx = inp.x, dy = inp.y;

    const r = 0.32;
    const canStand = (x, y) => {
      const corners = [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]];
      for (const [px, py] of corners) {
        if (this.solidAt(s, Math.floor(px), Math.floor(py))) return false;
      }
      return true;
    };
    // 速度平滑：起步/停步有短暂加减速缓冲，消除顿挫感
    const ACC = p.speed * 8;
    const tvx = dx * p.speed, tvy = dy * p.speed;
    p.vx += clamp(tvx - p.vx, -ACC * dt, ACC * dt);
    p.vy += clamp(tvy - p.vy, -ACC * dt, ACC * dt);
    if (!dx && Math.abs(p.vx) < 0.06) p.vx = 0;
    if (!dy && Math.abs(p.vy) < 0.06) p.vy = 0;

    const stepX = p.vx * dt, stepY = p.vy * dt;
    // 双轴独立移动：贴墙时沿墙滑行，斜向移动顺滑
    if (stepX) { if (canStand(p.x + stepX, p.y)) p.x += stepX; else p.vx = 0; }
    if (stepY) { if (canStand(p.x, p.y + stepY)) p.y += stepY; else p.vy = 0; }
    // 通道吸附（角部辅助）：沿主移动方向渐进对齐格子中心线，
    // 1 格宽走廊和门口不用精细操作即可顺滑进入
    const absVx = Math.abs(p.vx), absVy = Math.abs(p.vy);
    const rate = Math.max(Math.abs(stepX), Math.abs(stepY), 0.045);
    if (absVx > absVy * 1.2 && p.vx) {
      const t = Math.round(p.y - 0.5) + 0.5;
      const d = t - p.y;
      if (Math.abs(d) > 0.005 && Math.abs(d) < 0.5) {
        const ny = p.y + clamp(d, -rate, rate);
        if (canStand(p.x, ny)) p.y = ny;
      }
    } else if (absVy > absVx * 1.2 && p.vy) {
      const t = Math.round(p.x - 0.5) + 0.5;
      const d = t - p.x;
      if (Math.abs(d) > 0.005 && Math.abs(d) < 0.5) {
        const nx = p.x + clamp(d, -rate, rate);
        if (canStand(nx, p.y)) p.x = nx;
      }
    }
    p.x = clamp(p.x, 0.5, s.cols - 0.5);
    p.y = clamp(p.y, 0.5, s.rows - 0.5);

    // 拾取道具
    for (let i = s.powerups.length - 1; i >= 0; i--) {
      const pu = s.powerups[i];
      if (Math.abs(p.x - pu.x) < 0.6 && Math.abs(p.y - pu.y) < 0.6) {
        this.applyPowerup(s, pu.type);
        s.powerups.splice(i, 1);
      }
    }
    // 踩到火焰
    if (p.invincible <= 0 && this.inExplosion(s, p.x, p.y)) this.hurtPlayer(s);
    // 放炸弹
    if (inp.bomb) { inp.bomb = false; this.placeBomb(s); }
  },

  applyPowerup(s, type) {
    const p = s.player;
    if (type === 'BOMB') { p.bombs++; s.score += 50; this.flashScore('+50'); }
    if (type === 'RANGE') { p.range = Math.min(p.range + 1, 6); s.score += 50; this.flashScore('+50'); }
    if (type === 'SPEED') { p.speed = Math.min(p.speed + 0.4, 6); s.score += 50; this.flashScore('+50'); }
    if (type === 'HP') { p.hp = Math.min(p.hp + 1, 5); s.score += 100; this.flashScore('+100'); }
    this.sfxPowerup();
  },

  hurtPlayer(s) {
    const p = s.player;
    p.hp--;
    p.invincible = 2;
    this.shake(10);
    this.sfxHurt();
    if (p.hp <= 0) {
      p.alive = false;
      s.running = false;
      this.stopLoop(); this.stopBgm();
      setTimeout(() => {
        if (this.data.state !== 'playing') return;
        this.sfxLose();
        this.setData({ state: 'lose', loseReason: '你被炸到了…', score: s.score });
      }, 500);
    }
  },

  placeBomb(s) {
    const p = s.player;
    const tx = Math.round(p.x - 0.5) + 0.5;
    const ty = Math.round(p.y - 0.5) + 0.5;
    const gx = Math.floor(tx), gy = Math.floor(ty);
    if (s.bombs.some((b) => Math.floor(b.x) === gx && Math.floor(b.y) === gy)) return;
    if (s.map[gy][gx] !== EMPTY) return;
    s.bombs.push({ x: tx, y: ty, range: p.range, timer: 2.6, flicker: 0 });
    this.sfxPlace();
  },

  updateBombs(s, dt) {
    for (let i = s.bombs.length - 1; i >= 0; i--) {
      const b = s.bombs[i];
      b.timer -= dt;
      b.flicker += dt;
      if (b.timer <= 0) {
        this.detonate(s, b);
        s.bombs.splice(i, 1);
      }
    }
  },

  detonate(s, b) {
    const ex = Math.floor(b.x), ey = Math.floor(b.y);
    const cells = [{ x: ex, y: ey, type: 'CENTER' }];
    const dirs = [[1, 0, 'H'], [-1, 0, 'H'], [0, 1, 'V'], [0, -1, 'V']];
    for (const [dx, dy, cap] of dirs) {
      for (let i = 1; i <= b.range; i++) {
        const nx = ex + dx * i, ny = ey + dy * i;
        const t = s.map[ny] ? s.map[ny][nx] : WALL;
        if (t === WALL) break; // 硬墙：挡住火焰
        if (t === BRICK) {
          // 砖块：被火焰炸掉（火焰吞没本格），并阻断继续传播
          s.map[ny][nx] = EMPTY;
          s.score += 10;
          cells.push({ x: nx, y: ny, type: cap });
          if (Math.random() < s.cfg.powerupRate) {
            s.powerups.push({ x: nx + 0.5, y: ny + 0.5, type: PU_TYPES[rand(0, 3)], t: 0 });
          }
          break;
        }
        cells.push({ x: nx, y: ny, type: cap });
        const chain = s.bombs.find((o) => Math.floor(o.x) === nx && Math.floor(o.y) === ny);
        if (chain) chain.timer = Math.min(chain.timer, 0.15);
      }
    }
    for (const c of cells) s.explosions.push({ x: c.x + 0.5, y: c.y + 0.5, life: 0.35, cap: c.type });
    this.shake(6);
    this.sfxExplode();
  },

  spawnEnemies(s) {
    const cfg = s.cfg;
    let tries = 0;
    while (s.enemies.length < cfg.enemyCount && tries < 200) {
      tries++;
      const x = rand(3, s.cols - 2);
      const y = rand(3, s.rows - 2);
      if (s.map[y][x] !== EMPTY) continue;
      if (Math.abs(x - 1.5) + Math.abs(y - 1.5) < 4) continue;
      s.enemies.push({
        x: x + 0.5, y: y + 0.5,
        speed: cfg.enemySpeed, dir: rand(0, 3), t: rand(0, 100) / 100,
        type: rand(0, 2), alive: true,
      });
    }
  },

  updateEnemies(s, dt) {
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const e of s.enemies) {
      if (!e.alive) continue;
      e.t += dt;
      const spd = e.speed * dt;
      const [dx, dy] = dirs[e.dir];
      const nx = e.x + dx * spd, ny = e.y + dy * spd;
      const r = 0.35;
      const blocked = () => {
        const checks = [[nx - r, ny - r], [nx + r, ny - r], [nx - r, ny + r], [nx + r, ny + r]];
        for (const [px, py] of checks) {
          if (this.solidAt(s, Math.floor(px), Math.floor(py))) return true;
        }
        return false;
      };
      if (blocked() || e.t > (e.type === 2 ? 0.3 : 1.2)) {
        e.t = 0;
        const opts = [0, 1, 2, 3].filter((d) => {
          if (d === (e.dir + 2) % 4) return false;
          const [tx, ty] = dirs[d];
          return !this.solidAt(s, Math.floor(e.x + tx * 0.6), Math.floor(e.y + ty * 0.6));
        });
        if (opts.length) e.dir = opts[rand(0, opts.length - 1)];
      } else {
        e.x = nx; e.y = ny;
      }
      // 猎手追玩家
      if (e.type === 2 && rand(0, 100) < 3) {
        const p = s.player;
        const adx = p.x - e.x, ady = p.y - e.y;
        if (Math.abs(adx) > Math.abs(ady) && !this.solidAt(s, Math.floor(e.x + Math.sign(adx)), Math.floor(e.y))) {
          e.dir = adx > 0 ? 1 : 3;
        } else if (!this.solidAt(s, Math.floor(e.x), Math.floor(e.y + Math.sign(ady)))) {
          e.dir = ady > 0 ? 2 : 0;
        }
      }
      // 踩到火焰
      if (this.inExplosion(s, e.x, e.y)) {
        e.alive = false;
        s.score += 200;
        this.flashScore('+200');
        this.sfxKill();
        if (Math.random() < 0.35) {
          const types = ['BOMB', 'RANGE', 'SPEED'];
          s.powerups.push({ x: e.x, y: e.y, type: types[rand(0, 2)], t: 0 });
        }
        continue;
      }
      // 碰到玩家
      const p = s.player;
      if (p.alive && p.invincible <= 0 && Math.abs(e.x - p.x) < 0.6 && Math.abs(e.y - p.y) < 0.6) {
        this.hurtPlayer(s);
      }
    }
  },

  update(dt) {
    const s = this.s;
    if (!s || !s.running) return;
    s.time += dt;
    this.updatePlayer(s, dt);
    this.updateBombs(s, dt);
    this.updateEnemies(s, dt);
    for (let i = s.explosions.length - 1; i >= 0; i--) {
      s.explosions[i].life -= dt;
      if (s.explosions[i].life <= 0) s.explosions.splice(i, 1);
    }
    for (const pu of s.powerups) pu.t += dt;
    if (s.door) s.door.t += dt;
    // 通关：消灭全部怪物后右上出生区开启出口，走进出口才过关
    if (s.running && s.enemies.length && s.enemies.every((e) => !e.alive)) {
      if (!s.door) {
        s.door = { x: s.cols - 2.5, y: 1.5, t: 0 };
        this.flashScore('🚪 出口开启！');
        this.sfxPowerup();
      }
      const p = s.player;
      if (p.alive && Math.abs(p.x - s.door.x) < 0.55 && Math.abs(p.y - s.door.y) < 0.55) {
        s.running = false;
        const stars = this.calcStars(s);
        const timeBonus = Math.max(0, 3000 - Math.floor(s.time) * 20);
        s.score += timeBonus + s.player.hp * 100;
        const unlocked = parseInt(wx.getStorageSync('bomber_unlocked') || '1', 10);
        if (this.currentLevel >= unlocked) {
          wx.setStorageSync('bomber_unlocked', Math.min(LEVELS.length, this.currentLevel + 1));
        }
        wx.setStorageSync('bomber_progress', this.currentLevel);
        this.stopLoop(); this.stopBgm();
        setTimeout(() => {
          if (this.data.state !== 'playing') return;
          this.sfxWin();
          this.setData({
            state: 'win', score: s.score,
            stars: '⭐'.repeat(stars) + '☆'.repeat(3 - stars),
            winBreak: `通关用时 ${s.time.toFixed(1)}s · 时间奖励 +${timeBonus} · 剩余生命 ×${s.player.hp}00`,
          });
        }, 400);
      }
    }
  },

  calcStars(s) {
    let stars = 3;
    const limit = s.cfg.cols * s.cfg.rows * 0.9;
    if (s.time > limit * 1.6) stars = 1;
    else if (s.time > limit * 1.1) stars = 2;
    if (s.player.hp <= 1) stars = Math.max(1, stars - 1);
    return stars;
  },

  syncHud() {
    const s = this.s;
    if (!s) return;
    const p = s.player;
    const c = this._hudCache;
    const patch = {};
    if (c.hp !== p.hp) { c.hp = p.hp; patch.hp = p.hp; }
    if (c.bombs !== p.bombs) { c.bombs = p.bombs; patch.bombs = p.bombs; }
    if (c.range !== p.range) { c.range = p.range; patch.range = p.range; }
    if (c.score !== s.score) { c.score = s.score; patch.score = s.score; }
    if (Object.keys(patch).length) this.setData(patch);
  },

  // ================= 渲染 =================
  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.s;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, this.cw, this.ch);
    if (!s) return;
    const { scale, ox, oy } = this.view;
    ctx.save();
    ctx.translate(ox, oy);
    if (this.shakeT > 0) ctx.translate((Math.random() - 0.5) * this.shakeMag, (Math.random() - 0.5) * this.shakeMag);
    ctx.scale(scale, scale);

    // 地图
    for (let y = 0; y < s.rows; y++) {
      for (let x = 0; x < s.cols; x++) {
        const cell = s.map[y][x];
        const px = x * TILE, py = y * TILE;
        if (cell === EMPTY) {
          ctx.fillStyle = (x + y) % 2 === 0 ? '#1c2130' : '#191e2c';
          ctx.fillRect(px, py, TILE, TILE);
        } else if (cell === WALL) {
          ctx.fillStyle = '#3a4254';
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = '#525c72';
          ctx.fillRect(px, py, TILE, 8);
          ctx.fillStyle = 'rgba(0,0,0,.25)';
          ctx.fillRect(px, py + TILE - 8, TILE, 8);
          ctx.fillStyle = 'rgba(255,255,255,.06)';
          ctx.fillRect(px, py, 6, TILE);
        } else {
          ctx.fillStyle = '#8f4c1c';
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = '#c8722f';
          ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
          ctx.fillStyle = '#8f4c1c';
          ctx.fillRect(px, py + TILE / 2 - 2, TILE, 4);
          ctx.fillRect(px + TILE / 2 - 2, py, 4, TILE / 2);
          ctx.fillRect(px + TILE / 2 - 2, py + TILE / 2, 4, TILE / 2);
        }
      }
    }

    // 道具
    for (const pu of s.powerups) {
      ctx.globalAlpha = 0.7 + Math.sin(pu.t * 5) * 0.3;
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(PU_GLYPH[pu.type], pu.x * TILE, pu.y * TILE);
      ctx.globalAlpha = 1;
    }
    // 出口（全灭怪物后出现）：金色发光门
    if (s.door) {
      const ddx = s.door.x * TILE, ddy = s.door.y * TILE;
      const pulse = 0.7 + Math.sin(s.door.t * 4) * 0.3;
      const glow = ctx.createRadialGradient(ddx, ddy, 2, ddx, ddy, 24);
      glow.addColorStop(0, 'rgba(255,210,74,' + (0.5 * pulse).toFixed(2) + ')');
      glow.addColorStop(1, 'rgba(255,210,74,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(ddx - 24, ddy - 24, 48, 48);
      ctx.fillStyle = '#7a4a1e';
      rr(ctx, ddx - 12, ddy - 16, 24, 32, 5);
      ctx.fill();
      const dg = ctx.createLinearGradient(ddx, ddy - 13, ddx, ddy + 14);
      dg.addColorStop(0, '#ffe08a');
      dg.addColorStop(1, '#ff9d3d');
      ctx.fillStyle = dg;
      rr(ctx, ddx - 8, ddy - 12, 16, 27, 3);
      ctx.fill();
      ctx.fillStyle = '#7a4a1e';
      ctx.beginPath();
      ctx.arc(ddx + 4, ddy + 1, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // 火焰
    for (const e of s.explosions) this.drawFlame(ctx, e.x * TILE, e.y * TILE, Math.max(0, e.life / 0.35), e.cap);
    // 炸弹
    for (const b of s.bombs) this.drawBomb(ctx, b);
    // 敌人
    for (const e of s.enemies) {
      if (!e.alive) continue;
      const ex = e.x * TILE, ey = e.y * TILE;
      const bob = Math.sin(s.time * 6 + e.x) * 2;
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath();
      ctx.ellipse(ex, ey + 13, 11, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(ex, ey + bob);
      if (e.type === 0) this.drawEnemySlime(ctx);
      else if (e.type === 1) this.drawEnemyGhost(ctx);
      else this.drawEnemyHunter(ctx);
      ctx.restore();
    }
    // 玩家
    const p = s.player;
    if (p.alive) {
      const px = p.x * TILE, py = p.y * TILE;
      const bob = Math.sin(s.time * 8) * 1.5;
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath();
      ctx.ellipse(px, py + 15, 12, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(px, py + bob);
      if (p.invincible > 0 && Math.floor(s.time * 20) % 2 === 0) ctx.globalAlpha = 0.4;
      const bodyG = ctx.createLinearGradient(0, -12, 0, 12);
      bodyG.addColorStop(0, '#4ade80');
      bodyG.addColorStop(1, '#16a34a');
      ctx.fillStyle = bodyG;
      rr(ctx, -10, -10, 20, 18, 8);
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(0, -10, 9, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(-4, -11, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(4, -11, 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, -9, 3, 0, Math.PI); ctx.stroke();
      ctx.restore();
    }
    // 得分飘字
    if (this.scorePopupT > 0) {
      ctx.globalAlpha = Math.max(0, this.scorePopupT / 0.8);
      ctx.fillStyle = '#ffd24a';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(this.scorePopup, s.cols * TILE / 2, 60 - (0.8 - this.scorePopupT) * 30);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  },

  drawFlame(ctx, cx, cy, alpha, cap) {
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(cx, cy - 2, 0, cx, cy, 20);
    g.addColorStop(0, '#fff5c0');
    g.addColorStop(0.25, '#ffd24a');
    g.addColorStop(0.6, '#ff7a18');
    g.addColorStop(1, 'rgba(180,20,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    if (cap === 'CENTER') ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    else if (cap === 'H') ctx.ellipse(cx, cy, 18, 9, 0, 0, Math.PI * 2);
    else ctx.ellipse(cx, cy, 9, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  },

  drawBomb(ctx, b) {
    const bob = Math.sin(b.flicker * 10) * 2;
    const bx = b.x * TILE, by = b.y * TILE + bob;
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath();
    ctx.ellipse(bx, by + 11, 11, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(bx - 3, by - 5, 2, bx, by, 12);
    g.addColorStop(0, '#5a6275');
    g.addColorStop(1, '#232a38');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx, by, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffb020';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx + 7, by - 6);
    ctx.quadraticCurveTo(bx + 12, by - 12, bx + 8, by - 15);
    ctx.stroke();
    if (b.timer < 0.8 || Math.floor(b.flicker * 6) % 2 === 0) {
      ctx.fillStyle = '#ff3b3b';
      ctx.beginPath();
      ctx.arc(bx + 3, by - 2, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  drawEnemySlime(ctx) {
    ctx.fillStyle = '#a855f7';
    ctx.beginPath();
    ctx.ellipse(0, 4, 12, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c084fc';
    ctx.beginPath();
    ctx.ellipse(-3, 0, 5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-5, 2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(3, 2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(-5, 2, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(3, 2, 1.4, 0, Math.PI * 2); ctx.fill();
  },
  drawEnemyGhost(ctx) {
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.moveTo(-11, 8);
    ctx.lineTo(-11, -4);
    ctx.quadraticCurveTo(-11, -14, 0, -14);
    ctx.quadraticCurveTo(11, -14, 11, -4);
    ctx.lineTo(11, 8);
    ctx.lineTo(5, 3); ctx.lineTo(0, 8); ctx.lineTo(-5, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-4, -4, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -4, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(-4, -4, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -4, 1.3, 0, Math.PI * 2); ctx.fill();
  },
  drawEnemyHunter(ctx) {
    ctx.fillStyle = '#f43f5e';
    rr(ctx, -11, -8, 22, 18, 6);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.moveTo(-11, -8); ctx.lineTo(-16, -16); ctx.lineTo(-6, -8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(11, -8); ctx.lineTo(16, -16); ctx.lineTo(6, -8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-4, -2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(-4, -2, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(4, -2, 1.5, 0, Math.PI * 2); ctx.fill();
  },
});
