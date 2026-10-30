// 蹦蹦大陆：横版平台跳跃（MVP 1-1 绿草原），横屏 + 王者荣耀式动态镂空按键
// 手感四要素：土狼时间 6 帧 / 输入缓冲 8 帧 / 可变跳跃 / 松开快坠
// 原创像素绘制 + WebAudio 合成音效，无外部资源
const { check } = require('../../../utils/perms');

const TILE = 16, COLS = 240, ROWS = 15;
const T = { G: 'G', B: 'B', Q: 'Q', E: 'E', P: 'P', S: 'S', O: 'O' }; // 地面/砖/？箱/空箱/管/实心/单向
const SOLID = { G: 1, B: 1, Q: 1, E: 1, P: 1, S: 1 };

// 物理参数（每逻辑帧 @60fps，单位=世界px）
const G = 0.8, MAX_FALL = 12, ACC = 0.6, DEC = 0.4;
const MAX_WALK = 3.2, MAX_RUN = 4.6, JUMP_V = -11;
const COYOTE = 6, BUFFER = 8, JUMP_HOLD = 12;

const FLAG_X = 239;
const LEVEL_TIME = 200;

// 1-1 关卡数据（网格 top 行 = 14 - 文档 bottom 行）
function buildGrid() {
  const g = [];
  for (let y = 0; y < ROWS; y++) g.push(new Array(COLS).fill(null));
  const set = (x, y, v) => { if (x >= 0 && x < COLS && y >= 0 && y < ROWS) g[y][x] = v; };
  // 地面 y=14 全宽
  for (let x = 0; x < COLS; x++) set(x, 14, T.G);
  // 传送管：x=3 高2、x=230 高3（MVP 装饰）
  const pipe = (px, h) => { for (let i = 0; i < h; i++) { set(px, 13 - i, T.P); set(px + 1, 13 - i, T.P); } };
  pipe(3, 2); pipe(230, 3);
  // 砖块组 + ？箱（bottom y=5 → top 9）
  for (let x = 20; x <= 24; x++) set(x, 9, T.B);
  set(26, 9, T.Q);
  for (let x = 28; x <= 32; x++) set(x, 9, T.B);
  set(22, 5, T.Q); // 高空？箱（bottom 9 → top 5）
  // 单向平台（bottom 8→top6、bottom 10→top4、bottom 6→top8）
  for (let x = 60; x <= 66; x++) set(x, 6, T.O);
  for (let x = 72; x <= 78; x++) set(x, 4, T.O);
  for (let x = 110; x <= 116; x++) set(x, 8, T.O);
  // 终点台阶（bottom 1..4 → top 13..10）
  for (let s = 0; s < 4; s++) for (let y = 13 - s; y <= 13; y++) set(222 + s, y, T.S);
  return g;
}
const COINS0 = [[12, 8], [40, 8], [68, 3], [74, 3], [76, 3], [113, 7], [115, 7], [62, 5], [75, 3]];
const ENEMIES0 = [
  { x: 14, type: 'goomba' }, { x: 22, type: 'goomba' }, { x: 30, type: 'goomba' },
  { x: 85, type: 'koopa' }, { x: 95, type: 'goomba', dir: -1 }, { x: 105, type: 'koopa' },
  { x: 140, type: 'goomba' }, { x: 150, type: 'koopa', dir: -1 },
];

Page({
  data: {
    state: 'ready', // ready | playing | paused | win | over
    score: 0, coins: 0, lives: 3, time: LEVEL_TIME, best: 0,
    muted: false, mask: '',
    joyOn: false, joyX: 0, joyY: 0, knobX: 0, knobY: 0, joyDir: '',
  },

  onLoad() {
    check('benben').then((r) => {
      if (!r.allowed) {
        wx.showToast({ title: '蹦蹦大陆已被管理员禁用', icon: 'none' });
        setTimeout(() => wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/games/games' }) }), 900);
        return;
      }
      this.loop = this.loop.bind(this);
      this.muted = !!wx.getStorageSync('benben_muted');
      this.setData({ muted: this.muted, best: wx.getStorageSync('benben_best') || 0 });
      this.initCanvas();
      this.initAudio();
      // 横竖屏切换（如设备方向锁定变化）时重取画布尺寸
      this._onWinResize = () => this.initCanvas();
      wx.onWindowResize(this._onWinResize);
    });
  },
  onUnload() {
    this.stopLoop(); this.stopBgm(); this.closeAudio();
    try { if (this._onWinResize) wx.offWindowResize(this._onWinResize); } catch (e) {}
  },
  onHide() { if (this.data.state === 'playing') this.setPause(true); },

  // ================= 画布 =================
  initCanvas() {
    wx.createSelectorQuery()
      .select('#benben')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) return;
        const { node: canvas, width, height } = res[0];
        const dpr = wx.getSystemInfoSync().pixelRatio;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = dpr;
        this.cw = width;
        this.ch = height;
        // 世界高 240px 只映射画布上部 70%，底部留按键区（不遮挡角色）
        this.scale = (height * 0.70) / (ROWS * TILE);
        this.worldH = ROWS * TILE * this.scale;
        this.drawIdle();
      });
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
  sfxJump() { this.tone(300, 0.16, 'square', 0.06, 720); this.tone(150, 0.1, 'triangle', 0.04, 360); },
  sfxLand() { this.tone(120, 0.05, 'triangle', 0.04, 70); },
  // 走路脚步：轻"嗒"（随机微音高，避免机械感）
  sfxStep() { this.tone(180 + Math.random() * 40, 0.035, 'triangle', 0.025, 110); },
  sfxStomp() { this.tone(220, 0.09, 'square', 0.09, 60); this.noise(0.06, 0.06, 1200); },
  sfxCoin() { this.tone(988, 0.06, 'square', 0.06); this.tone(1319, 0.14, 'square', 0.06, 1319, 0.06); },
  sfxBump() { this.tone(160, 0.08, 'triangle', 0.1, 100); },
  sfxBreak() { this.noise(0.14, 0.14, 2400); this.tone(400, 0.08, 'square', 0.05, 120); },
  sfxPowerup() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.09, 'triangle', 0.08, f, i * 0.06)); },
  // 变大：上行琶音 + 结尾高音闪光 + 低频轰鸣
  sfxGrow() {
    [262, 330, 392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.1, 'square', 0.07, f, i * 0.07));
    this.tone(1568, 0.25, 'triangle', 0.08, 1568, 0.5);
    this.noise(0.3, 0.05, 300);
  },
  // 缩小：下行琶音
  sfxShrink() { [784, 659, 523, 392, 262].forEach((f, i) => this.tone(f, 0.09, 'square', 0.07, f * 0.9, i * 0.07)); },
  sfxDie() { [494, 392, 330, 262, 196, 147].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.09, f, i * 0.13)); },
  sfxFlag() { [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.13, 'triangle', 0.1, f, i * 0.09)); this.noise(0.5, 0.04, 2000); },
  sfxKick() { this.tone(520, 0.07, 'square', 0.08, 180); this.noise(0.05, 0.05, 1500); },
  sfxShellKill() { this.tone(660, 0.08, 'square', 0.07, 220); this.noise(0.08, 0.07, 1800); },
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
  // 原创 8-bit 风 BGM：C 大调五声轻快旋律（16 拍循环）+ 低音行进 + 帽点节奏
  startBgm() {
    if (this.muted || this.bgmTimer) return;
    // [旋律频率, 低音频率]；0 = 休止
    const SEQ = [
      [523, 131], [659, 0], [784, 196], [659, 0],
      [523, 131], [587, 196], [659, 0], [0, 131],
      [784, 196], [880, 0], [1046, 262], [880, 0],
      [784, 196], [659, 131], [587, 0], [523, 131],
    ];
    let step = 0;
    this.bgmTimer = setInterval(() => {
      if (this.muted || this.data.state !== 'playing') return;
      const [mel, bass] = SEQ[step % SEQ.length];
      if (mel) this.tone(mel, 0.12, 'square', 0.02);
      if (bass) this.tone(bass, 0.2, 'triangle', 0.03);
      if (step % 4 === 2) this.noise(0.03, 0.012, 6000); // hi-hat
      step++;
    }, 190);
  },
  stopBgm() { if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; } },
  toggleMute() {
    this.muted = !this.muted;
    this.setData({ muted: this.muted });
    wx.setStorageSync('benben_muted', this.muted);
    if (this.muted) this.stopBgm(); else if (this.data.state === 'playing') this.startBgm();
  },

  // ================= 按键（镂空按钮） =================
  padDown(e) {
    const k = e.currentTarget.dataset.k;
    if (!this.input) return;
    this.input[k] = true;
    if (k === 'jump') this.input.jumpEdge = true;
  },
  padUp(e) {
    const k = e.currentTarget.dataset.k;
    if (!this.input) return;
    this.input[k] = false;
    if (k === 'jump') this.input.jumpRelease = true;
  },

  // 动态摇杆（王者荣耀式）：手指按在左区任意位置，摇杆即从该点出现；
  // 摇帽跟随手指（限幅半径），横向偏移量为模拟量决定移动速度，越过死区才生效。
  // 注意用 changedTouches：多指操作（边跳边走）时 touches[0] 可能是另一根手指
  joyDown(e) {
    if (!this.input) return;
    const t = e.changedTouches[0];
    this.joyId = t.identifier;
    this.joyOx = t.clientX;
    this.joyOy = t.clientY;
    this.joyOn = true;
    this.setData({ joyOn: true, joyX: t.clientX, joyY: t.clientY, knobX: 0, knobY: 0, joyDir: '' });
    this.joyEval(t.clientX, t.clientY);
  },
  joyMove(e) {
    if (!this.joyOn) return;
    for (const t of e.changedTouches) {
      if (t.identifier === this.joyId) { this.joyEval(t.clientX, t.clientY); break; }
    }
  },
  joyUp(e) {
    if (e && e.changedTouches) {
      let mine = false;
      for (const t of e.changedTouches) if (t.identifier === this.joyId) mine = true;
      if (!mine) return; // 其它手指抬起，不处理
    }
    this.joyOn = false;
    this.joyId = null;
    if (this.input) { this.input.axis = 0; this.input.left = false; this.input.right = false; }
    this.setData({ joyOn: false, joyDir: '' });
  },
  joyEval(x, y) {
    const R = 44;            // 摇杆最大半径(px)
    const DEAD = 8;          // 死区，防误触
    let dx = x - this.joyOx;
    let dy = y - this.joyOy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > R) { dx = dx * R / len; dy = dy * R / len; } // 摇帽限幅在环内
    const mag = Math.abs(dx) < DEAD ? 0 : Math.min(1, (Math.abs(dx) - DEAD) / (R - DEAD));
    const axis = dx > 0 ? mag : -mag;
    this.input.axis = axis;
    this.input.left = axis < -0.05;
    this.input.right = axis > 0.05;
    const dir = axis < -0.05 ? 'dir-left' : axis > 0.05 ? 'dir-right' : '';
    this.setData({ knobX: Math.round(dx), knobY: Math.round(dy), joyDir: dir });
  },

  // ================= 流程 =================
  startGame() {
    if (!this.ctx) {
      if (!this._retry) { this._retry = true; setTimeout(() => this.startGame(), 200); }
      return;
    }
    this._retry = false;
    try { if (this.ac && this.ac.state === 'suspended') this.ac.resume(); } catch (e) {}
    this.input = { left: false, right: false, jump: false, run: false, jumpEdge: false, jumpRelease: false, axis: 0 };
    this.score = 0; this.coinCount = 0; this.lives = 3; this.timeLeft = LEVEL_TIME;
    this.resetLevel(true);
    this.setData({ state: 'playing', score: 0, coins: 0, lives: 3, time: LEVEL_TIME, mask: '' });
    this.startBgm();
    this.startLoop();
  },

  resetLevel(full) {
    this.grid = buildGrid();
    this.coins = COINS0.map(([x, y]) => ({ x: x * TILE + 3, y: y * TILE + 4, taken: false, t: Math.random() * 6 }));
    this.enemies = ENEMIES0.map((e, i) => this.makeEnemy(e.x, e.type, e.dir, i));
    this.powerups = [];
    this.fx = [];
    this.parts = [];
    this.combo = 0;
    if (full) { this.flagDone = false; }
    const spawnY = 13 * TILE;
    this.player = {
      x: 2 * TILE, y: spawnY, w: 12, h: 15, vx: 0, vy: 0,
      big: false, onGround: false, coyote: 0, buffer: 0, jumpF: 0,
      inv: 0, dying: 0, face: 1, anim: 0, growT: 0, landT: 0,
    };
    this.camX = 0;
    this.timeAcc = 0;
  },

  makeEnemy(gx, type, dir, i) {
    return {
      x: gx * TILE, y: 13 * TILE - (type === 'koopa' ? 7 : 0), w: 14, h: type === 'koopa' ? 22 : 14,
      vx: (dir || 1) * -0.8, vy: 0, type, state: 'walk', // walk|shell|slide|squash
      shellT: 0, dead: false, anim: i * 0.7,
    };
  },

  startLoop() {
    this.stopLoop();
    this.lastTs = 0; this.acc = 0;
    this.raf = this.canvas.requestAnimationFrame(this.loop);
  },
  stopLoop() {
    if (this.raf && this.canvas) { try { this.canvas.cancelAnimationFrame(this.raf); } catch (e) {} }
    this.raf = null;
  },

  loop(ts) {
    const s = this.data.state;
    if (s !== 'playing') { this.raf = null; return; }
    const STEP = 1000 / 60;
    this.acc += Math.min(100, ts - (this.lastTs || ts));
    this.lastTs = ts;
    while (this.acc >= STEP) { this.acc -= STEP; this.update(); }
    this.render();
    this.raf = this.canvas.requestAnimationFrame(this.loop);
  },

  setPause(pause) {
    if (pause) {
      if (this.data.state !== 'playing') return;
      this.setData({ state: 'paused', mask: '已暂停' });
      this.stopLoop(); this.stopBgm();
    } else {
      if (this.data.state !== 'paused') return;
      this.setData({ state: 'playing', mask: '' });
      this.startLoop(); this.startBgm();
    }
  },
  togglePause() {
    const s = this.data.state;
    if (s === 'playing') this.setPause(true);
    else if (s === 'paused') this.setPause(false);
  },
  goBack() { this.stopLoop(); this.stopBgm(); wx.navigateBack(); },

  // ================= 逻辑（每逻辑帧） =================
  update() {
    const p = this.player;
    const inp = this.input;

    // 计时
    this.timeAcc++;
    if (this.timeAcc >= 60) {
      this.timeAcc = 0;
      this.timeLeft--;
      this.setData({ time: this.timeLeft });
      if (this.timeLeft <= 0) { this.kill(); return; }
    }

    // 死亡动画：弹跳落下
    if (p.dying > 0) {
      p.dying--;
      p.vy += G; p.y += p.vy;
      if (p.dying === 0) this.respawn();
      return;
    }

    // 水平：模拟量摇杆（轻推慢走、推满快跑），朝目标速度加/减速
    const axis = inp.axis || 0;
    if (Math.abs(axis) > 0.05) {
      const target = Math.max(-MAX_RUN, Math.min(MAX_RUN, axis * MAX_WALK * (inp.run ? 1.44 : 1)));
      const a = (axis * p.vx < 0) ? ACC * 2.5 : ACC; // 反向拨杆快速刹车转向
      if (target > p.vx) p.vx = Math.min(target, p.vx + a);
      else if (target < p.vx) p.vx = Math.max(target, p.vx - a);
      p.face = axis > 0 ? 1 : -1;
      // 走路脚步声（按步频触发）
      if (p.onGround) {
        this.stepAcc = (this.stepAcc || 0) + Math.abs(p.vx);
        if (this.stepAcc > 26) { this.stepAcc = 0; this.sfxStep(); }
      }
    } else {
      if (p.vx > 0) p.vx = Math.max(0, p.vx - DEC);
      else if (p.vx < 0) p.vx = Math.min(0, p.vx + DEC);
    }

    // 土狼 + 缓冲 + 可变跳
    if (p.onGround) p.coyote = COYOTE; else if (p.coyote > 0) p.coyote--;
    if (inp.jumpEdge) { p.buffer = BUFFER; inp.jumpEdge = false; }
    else if (p.buffer > 0) p.buffer--;
    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = JUMP_V; p.onGround = false; p.coyote = 0; p.buffer = 0; p.jumpF = JUMP_HOLD;
      this.sfxJump();
    }
    if (inp.jump && p.vy < 0 && p.jumpF > 0) { p.vy -= 0.4; p.jumpF--; }
    if (inp.jumpRelease) {
      inp.jumpRelease = false;
      if (p.vy < 0) { p.vy *= 0.5; p.jumpF = 0; }
    }
    p.vy += (p.vy > 0 && !inp.jump) ? G * 1.5 : G;
    if (p.vy > MAX_FALL) p.vy = MAX_FALL;

    // 逐轴碰撞
    const wasAir = !p.onGround;
    this.moveAxis(p, 'x');
    this.moveAxis(p, 'y');
    if (wasAir && p.onGround) { this.sfxLand(); p.landT = 8; } // 落地音 + 压扁帧
    if (p.landT > 0) p.landT--;

    // 掉坑
    if (p.y > ROWS * TILE + 40) { this.kill(); return; }

    // 顶砖（移动中被 moveAxis 记录）
    if (p.bumped) { this.doBump(p.bumped); p.bumped = null; }

    // 无敌闪烁
    if (p.inv > 0) p.inv--;
    if (p.growT > 0) p.growT--;

    // 粒子
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i];
      q.x += q.vx; q.y += q.vy; q.vy += 0.12; q.t--;
      if (q.t <= 0) this.parts.splice(i, 1);
    }

    // 动画帧
    p.anim += Math.abs(p.vx) * 0.15;

    // 相机（只向右推进，马里奥式）
    const viewW = this.cw / this.scale;
    const target = Math.max(0, Math.min(COLS * TILE - viewW, p.x - viewW * 0.38));
    if (target > this.camX) this.camX += (target - this.camX) * 0.2;

    // 胜利旗
    if (!this.flagDone && p.x + p.w > FLAG_X * TILE + 6 && p.x < FLAG_X * TILE + 14) {
      this.reachFlag();
      return;
    }

    // 道具（变大果）
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const u = this.powerups[i];
      u.t += 0.08; // 浮动动画计时
      if (u.rise > 0) { u.rise--; u.y -= 1; continue; }
      u.vy = Math.min(u.vy + G, MAX_FALL);
      u.x += u.vx; u.y += u.vy;
      // 简单落地
      if (this.solidAt(u.x + 7, u.y + 15)) { u.y = Math.floor(u.y / TILE) * TILE - 15; u.vy = 0; }
      if (this.solidAt(u.x + (u.vx > 0 ? 15 : 0), u.y + 8)) u.vx *= -1;
      if (u.y > ROWS * TILE + 30) { this.powerups.splice(i, 1); continue; }
      if (this.overlap(u, p)) {
        this.powerups.splice(i, 1);
        if (!p.big) {
          p.big = true; p.h = 30; p.y -= 15; p.growT = 36; // 变大特效：星尘爆发 + 闪烁生长
          this.burst(p.x + p.w / 2, p.y + 15, 26, ['#FFD54F', '#FFF176', '#FF8A65', '#fff']);
          this.sfxGrow();
          try { wx.vibrateShort({ type: 'medium' }); } catch (e) {}
        } else {
          this.sfxPowerup();
          this.burst(u.x + 7, u.y + 8, 10, ['#FFD54F', '#fff']);
        }
        this.addScore(1000, u.x, u.y);
      }
    }

    // 敌人
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.x < this.camX - 64 || e.x > this.camX + viewW + 96) continue; // 离屏休眠
      if (e.state === 'squash') { e.squashT--; if (e.squashT <= 0) e.dead = true; continue; }
      e.anim += 0.1;
      e.vy = Math.min(e.vy + G, MAX_FALL);
      // x
      e.x += e.vx;
      if (this.solidAt(e.x + (e.vx > 0 ? e.w : 0), e.y + e.h / 2)) { e.vx *= -1; e.x += e.vx * 2; }
      // y
      e.y += e.vy;
      if (e.vy > 0 && this.solidAt(e.x + 2, e.y + e.h) && this.solidAt(e.x + e.w - 2, e.y + e.h)) {
        e.y = Math.floor((e.y + e.h) / TILE) * TILE - e.h; e.vy = 0;
      }
      if (e.y > ROWS * TILE + 30) { e.dead = true; continue; }
      if (e.state === 'shell' || e.state === 'slide') e.h = 14;

      // 与玩家
      if (p.inv <= 0 && this.overlap(e, p)) {
        const stomp = p.vy > 0 && p.y + p.h - e.y < 12;
        if (stomp) this.stomp(e);
        else if (e.state === 'shell' && e.vx === 0) this.kickShell(e);
        else if (e.state === 'slide') { /* 撞滑动壳 = 受伤 */ this.hurt(); }
        else this.hurt();
      } else if (p.inv > 0 && e.state === 'slide' && this.overlap(e, p)) {
        e.vx = 0; e.state = 'shell'; // 停下滑动壳
      }
    }

    // 滑动壳连杀
    for (const e of this.enemies) {
      if (e.dead || e.state !== 'slide') continue;
      for (const o of this.enemies) {
        if (o === e || o.dead || o.state === 'squash') continue;
        if (this.overlap(e, o)) {
          this.combo = Math.min(this.combo + 1, 4);
          const pts = [100, 200, 400, 800][this.combo - 1];
          o.dead = true;
          this.addScore(pts, o.x, o.y);
          this.sfxShellKill();
          this.burst(o.x + o.w / 2, o.y + 6, 10, ['#A5D6A7', '#fff', '#FFD54F']);
        }
      }
    }

    // 星币
    for (const c of this.coins) {
      if (c.taken) continue;
      c.t += 0.1;
      if (this.overlap({ x: c.x, y: c.y, w: 10, h: 10 }, p)) {
        c.taken = true;
        this.coinCount++;
        this.addScore(10, c.x, c.y);
        this.sfxCoin();
        this.setData({ coins: this.coinCount });
      }
    }

    // 特效
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t--; f.y -= 2;
      if (f.t <= 0) this.fx.splice(i, 1);
    }
  },

  overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  },
  solidAt(x, y) {
    const gx = Math.floor(x / TILE), gy = Math.floor(y / TILE);
    if (gx < 0 || gx >= COLS || gy < 0) return false;
    if (gy >= ROWS) return false;
    const v = this.grid[gy][gx];
    return !!v && SOLID[v];
  },
  tileAt(x, y) {
    const gx = Math.floor(x / TILE), gy = Math.floor(y / TILE);
    if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return null;
    return { gx, gy, v: this.grid[gy][gx] };
  },

  moveAxis(p, axis) {
    const step = axis === 'x' ? p.vx : p.vy;
    p[axis] += step;
    if (axis === 'x') {
      const edge = step > 0 ? p.x + p.w : p.x;
      const t = this.tileAt(edge, p.y + 2);
      const t2 = this.tileAt(edge, p.y + p.h - 2);
      for (const tt of [t, t2]) {
        if (tt && tt.v && SOLID[tt.v]) {
          p.x = step > 0 ? tt.gx * TILE - p.w - 0.01 : (tt.gx + 1) * TILE + 0.01;
          p.vx = 0;
        }
      }
    } else {
      p.onGround = false;
      if (step > 0) { // 下落：实心 + 单向
        for (const ox of [2, p.w / 2, p.w - 2]) {
          const t = this.tileAt(p.x + ox, p.y + p.h);
          if (t && t.v === T.O) {
            const top = t.gy * TILE;
            if (p.y + p.h - step <= top + 1) { p.y = top - p.h; p.vy = 0; p.onGround = true; }
          } else if (t && t.v && SOLID[t.v]) {
            p.y = t.gy * TILE - p.h; p.vy = 0; p.onGround = true;
          }
        }
      } else if (step < 0) { // 上升：顶头
        for (const ox of [2, p.w / 2, p.w - 2]) {
          const t = this.tileAt(p.x + ox, p.y);
          if (t && t.v && SOLID[t.v] && t.v !== T.G) {
            p.y = (t.gy + 1) * TILE + 0.01; p.vy = 0;
            if (!p.bumped || (Math.abs(t.gx - p.bumped.gx) <= 1 && t.gy === p.bumped.gy)) p.bumped = t;
          }
        }
      }
    }
  },

  doBump(t) {
    const v = t.v;
    if (v === T.Q) {
      this.grid[t.gy][t.gx] = T.E;
      if (t.gx === 26 || t.gx === 22) { // 出变大果
        this.powerups.push({ x: t.gx * TILE + 1, y: t.gy * TILE, w: 14, h: 15, vx: 1.2, vy: 0, rise: 16, t: Math.random() * 6 });
        this.sfxPowerup();
      } else {
        this.coinCount++;
        this.addScore(10, t.gx * TILE, t.gy * TILE - 16);
        this.sfxCoin();
        this.setData({ coins: this.coinCount });
      }
    } else if (v === T.B) {
      if (this.player.big) {
        this.grid[t.gy][t.gx] = null;
        this.addScore(50, t.gx * TILE, t.gy * TILE);
        this.sfxBreak();
        // 碎砖飞溅
        for (let i = 0; i < 8; i++) {
          this.parts.push({
            x: t.gx * TILE + 8, y: t.gy * TILE + 8,
            vx: (Math.random() - 0.5) * 3, vy: -1 - Math.random() * 2.5,
            t: 30, r: 1.5 + Math.random(), color: ['#B5651D', '#8D4A12', '#D89858'][i % 3],
          });
        }
      } else this.sfxBump();
    } else this.sfxBump();
  },

  stomp(e) {
    this.player.vy = this.input.jump ? -9 : -6;
    this.combo = 0;
    this.burst(e.x + e.w / 2, e.y + 4, 8, ['#D7CCC8', '#8D6E63', '#fff']);
    if (e.type === 'goomba') {
      if (e.state === 'squash') return;
      e.state = 'squash'; e.squashT = 30;
      this.addScore(100, e.x, e.y);
    } else {
      if (e.state === 'walk') {
        e.state = 'shell'; e.vx = 0; e.y = e.y + 8;
        this.addScore(100, e.x, e.y);
      } else if (e.state === 'slide') {
        e.vx = 0; e.state = 'shell';
        this.addScore(100, e.x, e.y);
      } else {
        e.state = 'shell';
      }
    }
    this.sfxStomp();
    try { wx.vibrateShort({ type: 'light' }); } catch (err) {}
  },

  kickShell(e) {
    const dir = this.player.x + this.player.w / 2 < e.x + e.w / 2 ? 1 : -1;
    e.vx = dir * 4.2;
    e.state = 'slide';
    this.combo = 0;
    this.sfxKick();
  },

  hurt() {
    const p = this.player;
    if (p.inv > 0) return;
    if (p.big) {
      p.big = false; p.h = 15; p.y += 15;
      p.inv = 120;
      this.sfxShrink();
      this.burst(p.x + p.w / 2, p.y + 8, 18, ['#EF5350', '#FFD54F', '#fff']); // 缩小红雾
    } else this.kill();
  },

  kill() {
    const p = this.player;
    if (p.dying > 0) return;
    p.dying = 70; p.vy = -9; p.vx = 0;
    this.sfxDie();
    this.stopBgm();
  },

  respawn() {
    this.lives--;
    this.setData({ lives: this.lives });
    if (this.lives <= 0) { this.gameOver(); return; }
    this.resetLevel(false);
    // 重置计时，否则超时死亡后 timeLeft<=0 会每秒连锁扣命
    this.timeLeft = LEVEL_TIME;
    this.setData({ time: this.timeLeft });
    this.startBgm();
  },

  reachFlag() {
    this.flagDone = true;
    const heightBonus = Math.max(100, 5000 - Math.floor(this.player.y / TILE) * 300);
    this.addScore(heightBonus, this.player.x, this.player.y);
    const timeBonus = this.timeLeft * 10;
    this.score += timeBonus;
    this.sfxFlag();
    this.stopBgm();
    const best = Math.max(wx.getStorageSync('benben_best') || 0, this.score);
    wx.setStorageSync('benben_best', best);
    this.setData({ state: 'win', score: this.score, best, mask: '🚩 到达胜利旗！\n得分 ' + this.score + '（含时间奖励 ' + timeBonus + '）' });
    this.stopLoop();
  },

  gameOver() {
    this.stopLoop(); this.stopBgm();
    const best = Math.max(wx.getStorageSync('benben_best') || 0, this.score);
    wx.setStorageSync('benben_best', best);
    this.setData({ state: 'over', best, mask: '💥 生命耗尽\n得分 ' + this.score });
  },

  addScore(n, x, y) {
    this.score += n;
    this.fx.push({ x, y, t: 40, text: '+' + n });
    this.setData({ score: this.score });
  },

  // 粒子爆发（世界坐标）
  burst(x, y, n, colors) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.8 + Math.random() * 2.4;
      this.parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1,
        t: 24 + Math.floor(Math.random() * 18), r: 1 + Math.random() * 1.8,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  },

  // ================= 渲染 =================
  drawIdle() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.fillStyle = '#7EC8E3';
    ctx.fillRect(0, 0, this.cw, this.ch);
  },

  render() {
    const ctx = this.ctx;
    const sc = this.scale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // 天空
    const sky = ctx.createLinearGradient(0, 0, 0, this.ch);
    sky.addColorStop(0, '#8ED6F2'); sky.addColorStop(0.7, '#DFF3FB'); sky.addColorStop(1, '#EAD9C0');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.cw, this.ch);
    // 底部按键区：半透明沙色地带，与游戏世界分隔（玩家永远不被按钮挡住）
    ctx.fillStyle = 'rgba(122, 84, 46, 0.35)';
    ctx.fillRect(0, this.worldH, this.cw, this.ch - this.worldH);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, this.worldH, this.cw, 2);

    ctx.save();
    ctx.scale(sc, sc);
    const cam = this.camX;
    const viewW = this.cw / sc;

    // 远景：山+云 视差 0.2 / 中景灌木 0.5
    this.drawParallax(ctx, cam, viewW);

    ctx.translate(-cam, 0);
    // 地形（只画可见列）
    const x0 = Math.max(0, Math.floor(cam / TILE) - 1);
    const x1 = Math.min(COLS - 1, Math.ceil((cam + viewW) / TILE) + 1);
    for (let gy = 0; gy < ROWS; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const v = this.grid[gy][gx];
        if (v) this.drawTile(ctx, gx, gy, v);
      }
    }
    // 胜利旗
    this.drawFlag(ctx);
    // 星币
    for (const c of this.coins) if (!c.taken) this.drawCoin(ctx, c);
    // 道具
    for (const u of this.powerups) this.drawFruit(ctx, u);
    // 敌人
    for (const e of this.enemies) if (!e.dead) this.drawEnemy(ctx, e);
    // 玩家（无敌闪烁）
    const p = this.player;
    if (!(p.inv > 0 && Math.floor(p.inv / 4) % 2 === 0)) this.drawPlayer(ctx, p);
    // 粒子
    for (const q of this.parts) {
      ctx.globalAlpha = Math.min(1, q.t / 16);
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 飘分
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    for (const f of this.fx) {
      ctx.fillStyle = 'rgba(255,255,255,' + Math.min(1, f.t / 20) + ')';
      ctx.fillText(f.text, f.x + 8, f.y);
    }
    ctx.restore();
  },

  drawParallax(ctx, cam, viewW) {
    // 远景按屏幕坐标绘制（此函数在 translate(-cam) 之前调用），视差系数 0.2 / 0.5
    const period = 160;
    const startI = Math.floor((cam * 0.2) / period) - 1;
    const span = Math.ceil(viewW / period) + 2;
    const mod3 = (n) => ((n % 3) + 3) % 3;
    const mod4 = (n) => ((n % 4) + 4) % 4;

    // 山
    ctx.fillStyle = '#9ED4A8';
    for (let i = startI; i < startI + span; i++) {
      const sx = i * period - cam * 0.2;
      const h = 40 + mod3(i) * 18;
      ctx.beginPath();
      ctx.moveTo(sx, 14 * TILE);
      ctx.lineTo(sx + 60, 14 * TILE - h);
      ctx.lineTo(sx + 120, 14 * TILE);
      ctx.closePath();
      ctx.fill();
    }
    // 云
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = startI; i < startI + span; i++) {
      const sx = i * period + 30 - cam * 0.2;
      const cy = 26 + mod4(i) * 12;
      ctx.beginPath();
      ctx.arc(sx, cy, 9, 0, Math.PI * 2);
      ctx.arc(sx + 11, cy - 4, 7, 0, Math.PI * 2);
      ctx.arc(sx + 22, cy, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    // 灌木（视差0.5）
    ctx.fillStyle = '#6FBF7F';
    const p2 = 110;
    const s2 = Math.floor((cam * 0.5) / p2) - 1;
    for (let i = s2; i < s2 + Math.ceil(viewW / p2) + 2; i++) {
      const sx = i * p2 - cam * 0.5;
      ctx.beginPath();
      ctx.arc(sx, 13.4 * TILE, 12, Math.PI, 0);
      ctx.arc(sx + 16, 13.4 * TILE, 14, Math.PI, 0);
      ctx.arc(sx + 32, 13.4 * TILE, 12, Math.PI, 0);
      ctx.fill();
    }
  },

  drawTile(ctx, gx, gy, v) {
    const x = gx * TILE, y = gy * TILE;
    if (v === T.G) {
      ctx.fillStyle = '#C97B4A';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#7CB342';
      ctx.fillRect(x, y, TILE, 4);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(x, y + 8, TILE, 2);
    } else if (v === T.B) {
      ctx.fillStyle = '#B5651D';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, y + 7, TILE, 1.5);
      ctx.fillRect(x + 7, y, 1.5, 7);
      ctx.fillRect(x + 3, y + 8, 1.5, 8);
      ctx.fillRect(x + 11, y + 8, 1.5, 8);
    } else if (v === T.Q) {
      const pulse = 0.75 + 0.25 * Math.sin(Date.now() / 200);
      ctx.fillStyle = '#F2A93B';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
      ctx.fillStyle = 'rgba(255,255,255,' + pulse + ')';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('?', x + TILE / 2, y + 12);
    } else if (v === T.E) {
      ctx.fillStyle = '#9A8C7A';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
    } else if (v === T.P) {
      ctx.fillStyle = '#3FA34D';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#66C26F';
      ctx.fillRect(x + 2, y, 3, TILE);
      ctx.fillStyle = '#2C7A36';
      ctx.fillRect(x, y, TILE, 2);
    } else if (v === T.S) {
      ctx.fillStyle = '#8D9AAE';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
    } else if (v === T.O) {
      ctx.fillStyle = '#E8A33D';
      ctx.fillRect(x, y, TILE, 6);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(x, y + 4, TILE, 2);
    }
  },

  drawCoin(ctx, c) {
    // 旋转星币：金色椭圆 + 中央五角星 + 高光
    const w = Math.abs(Math.cos(c.t)) * 5 + 2;
    const cx = c.x + 5, cy = c.y + 5;
    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2 + 0.8, 6.6, 0, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createLinearGradient(cx - 4, cy - 6, cx + 4, cy + 6);
    g.addColorStop(0, '#FFE082');
    g.addColorStop(0.5, '#FFD54F');
    g.addColorStop(1, '#FBBF24');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2, 5.8, 0, 0, Math.PI * 2);
    ctx.fill();
    if (w > 4.5) {
      ctx.fillStyle = '#B45309';
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('★', cx, cy + 2.6);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.ellipse(cx - 1.4, cy - 2.6, 1.2, 2, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  drawFruit(ctx, u) {
    // 变大果：红果白斑 + 绿叶 + 浮动微光
    const bob = Math.sin(u.t * 3) * 1.2;
    const cx = u.x + 7, cy = u.y + 9 + bob;
    ctx.fillStyle = 'rgba(255,138,101,0.25)';
    ctx.beginPath();
    ctx.arc(cx, cy + 2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#E53935';
    ctx.beginPath();
    ctx.arc(cx, cy + 2, 7, Math.PI * 0.9, Math.PI * 0.1);
    ctx.quadraticCurveTo(cx + 8, cy + 8, cx, cy + 9.5);
    ctx.quadraticCurveTo(cx - 8, cy + 8, cx - 6.8, cy + 1);
    ctx.fill();
    ctx.fillStyle = '#FFCDD2';
    ctx.beginPath();
    ctx.arc(cx - 2.5, cy + 1, 1.3, 0, Math.PI * 2);
    ctx.arc(cx + 2.8, cy + 3.5, 1.1, 0, Math.PI * 2);
    ctx.arc(cx + 0.5, cy + 6, 1, 0, Math.PI * 2);
    ctx.fill();
    // 叶
    ctx.fillStyle = '#43A047';
    ctx.beginPath();
    ctx.ellipse(cx + 2.5, cy - 5, 3.6, 1.6, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2E7D32';
    ctx.fillRect(cx - 0.8, cy - 6.5, 1.6, 3);
  },

  drawFlag(ctx) {
    // 胜利旗：银色杆 + 圆球 + 飘动三角旗（波浪摆动 + 星徽）
    const x = FLAG_X * TILE + 8;
    const t = Date.now() / 300;
    ctx.fillStyle = '#E5E7EB';
    ctx.fillRect(x, 6 * TILE, 3, 8 * TILE);
    ctx.fillStyle = '#9CA3AF';
    ctx.fillRect(x + 2, 6 * TILE, 1, 8 * TILE);
    // 旗面（三点波浪）
    const wave = Math.sin(t) * 2;
    const g = ctx.createLinearGradient(x + 3, 6 * TILE, x + 24, 6 * TILE + 14);
    g.addColorStop(0, '#43A047');
    g.addColorStop(1, '#1B5E20');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x + 3, 6 * TILE + 1);
    ctx.quadraticCurveTo(x + 12, 6 * TILE + 3 + wave, x + 23, 6 * TILE + 7 + wave * 0.6);
    ctx.quadraticCurveTo(x + 12, 6 * TILE + 11 + wave, x + 3, 6 * TILE + 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#FFD54F';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('★', x + 11, 6 * TILE + 10 + wave * 0.5);
    // 杆顶圆球
    const sg = ctx.createRadialGradient(x - 1, 6 * TILE - 5, 1, x + 1.5, 6 * TILE - 3, 5);
    sg.addColorStop(0, '#FFF9C4');
    sg.addColorStop(1, '#F59E0B');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(x + 1.5, 6 * TILE - 3, 4.2, 0, Math.PI * 2);
    ctx.fill();
  },

  // 蹦蹦：红圆帽+帽檐、圆脸腮红、蓝背带裤、跑步摆腿、变大金色光环脉动（原创 Q 版）
  drawPlayer(ctx, p) {
    const big = p.big;
    const H = big ? 30 : 15;
    const run = Math.abs(p.vx) > 0.3 && p.onGround;
    const air = !p.onGround && p.dying <= 0;
    const cyc = p.anim;
    ctx.save();
    ctx.translate(p.x + p.w / 2, p.y + H);
    if (p.dying > 0) { ctx.rotate(0.25); }
    // 挤压拉伸（卡通手感）：上升拉长、下落微压、落地瞬间一蹲
    if (p.dying <= 0) {
      let sx = 1, sy = 1;
      if (!p.onGround) {
        const st = Math.max(-0.12, Math.min(0.12, -p.vy * 0.012));
        sy = 1 + st; sx = 1 - st * 0.7;
      } else if (p.landT > 0) {
        const k = p.landT / 8;
        sy = 1 - 0.14 * k; sx = 1 + 0.14 * k;
      }
      ctx.scale(sx, sy);
      if (run) ctx.rotate(p.face * 0.04); // 奔跑前倾
    }
    // 变大特效：金色光环脉动 + 闪烁
    if (p.growT > 0) {
      const g = p.growT / 36;
      ctx.fillStyle = 'rgba(255,213,79,' + (0.25 + 0.35 * Math.sin(p.growT * 0.9)) * g + ')';
      ctx.beginPath();
      ctx.arc(0, -H / 2, H * (0.9 + 0.5 * g), 0, Math.PI * 2);
      ctx.fill();
    }
    if (big && p.inv <= 0) {
      ctx.fillStyle = 'rgba(255,213,79,0.18)';
      ctx.beginPath();
      ctx.arc(0, -H / 2, H * 0.72 + Math.sin(Date.now() / 180) * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    const s = big ? 2 : 1; // 大蹦整体比例翻倍（小蹦基准 15px 高）
    // 腿（跑步摆动 / 腾空张开）
    ctx.fillStyle = '#15479A';
    const legA = run ? Math.sin(cyc * 2.2) * 3 : air ? 2 : 0;
    ctx.fillRect(-5 * s + legA, -5 * s, 4 * s, 5 * s);
    ctx.fillRect(1 * s - legA, -5 * s, 4 * s, 5 * s);
    // 鞋
    ctx.fillStyle = '#5D4037';
    ctx.fillRect(-6 * s + legA, -1.5 * s, 5 * s, 1.6 * s);
    ctx.fillRect(1 * s - legA, -1.5 * s, 5 * s, 1.6 * s);
    // 背带裤身体
    ctx.fillStyle = '#1E63C8';
    const bodyTop = -12 * s;
    ctx.fillRect(-6 * s, bodyTop, 12 * s, 7 * s);
    // 背带（肩带两条）
    ctx.fillRect(-5 * s, bodyTop - 3 * s, 2 * s, 3.5 * s);
    ctx.fillRect(3 * s, bodyTop - 3 * s, 2 * s, 3.5 * s);
    // 金色纽扣
    ctx.fillStyle = '#FFD54F';
    ctx.beginPath();
    ctx.arc(-3.6 * s, bodyTop + 1.2 * s, 1 * s, 0, Math.PI * 2);
    ctx.arc(3.6 * s, bodyTop + 1.2 * s, 1 * s, 0, Math.PI * 2);
    ctx.fill();
    // 红色上衣（袖子手臂）
    ctx.fillStyle = '#E53935';
    ctx.fillRect(-6 * s, bodyTop - 3.5 * s, 12 * s, 3.6 * s);
    const armA = run ? Math.sin(cyc * 2.2) * 2 : 0;
    ctx.fillRect(-7.6 * s, bodyTop - 2.5 * s + armA, 2 * s, 4 * s);
    ctx.fillRect(5.6 * s, bodyTop - 2.5 * s - armA, 2 * s, 4 * s);
    // 手
    ctx.fillStyle = '#FFCC9C';
    ctx.beginPath();
    ctx.arc(-6.6 * s, bodyTop + 1.8 * s + armA, 1.1 * s, 0, Math.PI * 2);
    ctx.arc(6.6 * s, bodyTop + 1.8 * s - armA, 1.1 * s, 0, Math.PI * 2);
    ctx.fill();
    // 头（圆脸）
    const hy = -17 * s;
    ctx.fillStyle = '#FFCC9C';
    ctx.beginPath();
    ctx.arc(0, hy, 5.4 * s, 0, Math.PI * 2);
    ctx.fill();
    // 腮红
    ctx.fillStyle = 'rgba(244,143,177,0.6)';
    ctx.beginPath();
    ctx.arc(-3.4 * s * (p.face > 0 ? 0.6 : 1), hy + 1.8 * s, 1.2 * s, 0, Math.PI * 2);
    ctx.arc(3.4 * s * (p.face > 0 ? 1 : 0.6), hy + 1.8 * s, 1.2 * s, 0, Math.PI * 2);
    ctx.fill();
    // 眼睛（朝向前进方向 + 眨眼）
    const blink = Math.floor(Date.now() / 2000) % 3 === 0 && Math.floor(Date.now() % 2000) < 120;
    ctx.fillStyle = '#263238';
    const ex = p.face * 1.6 * s;
    if (blink || p.dying > 0) {
      ctx.fillRect(ex - 2.4 * s, hy - 0.4 * s, 1.8 * s, 0.8 * s);
      ctx.fillRect(ex + 0.6 * s, hy - 0.4 * s, 1.8 * s, 0.8 * s);
    } else {
      ctx.beginPath();
      ctx.arc(ex - 1 * s, hy - 0.3 * s, 0.9 * s, 0, Math.PI * 2);
      ctx.arc(ex + 1.6 * s, hy - 0.3 * s, 0.9 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    // 鼻子
    ctx.fillStyle = '#F0A868';
    ctx.beginPath();
    ctx.arc(ex + 0.4 * s, hy + 1.4 * s, 0.8 * s, 0, Math.PI * 2);
    ctx.fill();
    // 红圆帽（帽顶 + 帽檐朝前）
    ctx.fillStyle = '#E53935';
    ctx.beginPath();
    ctx.arc(0, hy - 1.2 * s, 5.6 * s, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(-5.6 * s, hy - 1.6 * s, 11.2 * s, 1.4 * s);
    ctx.fillStyle = '#C62828';
    ctx.beginPath();
    ctx.ellipse(p.face * 4.4 * s, hy - 0.6 * s, 3.4 * s, 1.3 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // 帽子圆徽（无字母，原创）
    ctx.fillStyle = '#FFF';
    ctx.beginPath();
    ctx.arc(0, hy - 3.4 * s, 1.8 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#E53935';
    ctx.beginPath();
    ctx.arc(0, hy - 3.4 * s, 0.8 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  drawEnemy(ctx, e) {
    const x = e.x, y = e.y;
    if (e.type === 'goomba') {
      const cx = x + 7;
      if (e.state === 'squash') {
        // 压扁：扁帽 + X 眼
        ctx.fillStyle = '#8D6E63';
        ctx.beginPath();
        ctx.ellipse(cx, y + 12, 8, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#3E2723';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 4, y + 10); ctx.lineTo(cx - 2, y + 12);
        ctx.moveTo(cx - 2, y + 10); ctx.lineTo(cx - 4, y + 12);
        ctx.moveTo(cx + 2, y + 10); ctx.lineTo(cx + 4, y + 12);
        ctx.moveTo(cx + 4, y + 10); ctx.lineTo(cx + 2, y + 12);
        ctx.stroke();
        return;
      }
      // 滚菇：深浅斑纹蘑菇帽 + 生气白眼 + 交替小脚
      const wob = Math.sin(e.anim * 3) * 0.8;
      const foot = Math.sin(e.anim * 6) * 1.5;
      // 脚
      ctx.fillStyle = '#4E342E';
      ctx.fillRect(cx - 5 + foot, y + 11, 4, 3.5);
      ctx.fillRect(cx + 1 - foot, y + 11, 4, 3.5);
      // 菌柄（脸）
      ctx.fillStyle = '#EFEBE9';
      ctx.beginPath();
      ctx.ellipse(cx, y + 8 + wob, 5.5, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 帽
      ctx.fillStyle = '#8D6E63';
      ctx.beginPath();
      ctx.arc(cx, y + 6 + wob, 7.5, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(cx - 7.5, y + 5 + wob, 15, 2);
      // 帽斑
      ctx.fillStyle = '#5D4037';
      ctx.beginPath();
      ctx.arc(cx - 4, y + 3 + wob, 1.6, 0, Math.PI * 2);
      ctx.arc(cx + 3.5, y + 2.2 + wob, 1.9, 0, Math.PI * 2);
      ctx.arc(cx + 0.2, y + 0.6 + wob, 1.3, 0, Math.PI * 2);
      ctx.fill();
      // 怒目（白底黑仁 + 眉毛）
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(cx - 2.4, y + 7.6 + wob, 1.7, 1.9, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 2.4, y + 7.6 + wob, 1.7, 1.9, 0, 0, Math.PI * 2);
      ctx.fill();
      const look = e.vx > 0 ? 0.6 : -0.6;
      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.arc(cx - 2.4 + look, y + 7.8 + wob, 0.8, 0, Math.PI * 2);
      ctx.arc(cx + 2.4 + look, y + 7.8 + wob, 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3E2723';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(cx - 4, y + 5 + wob); ctx.lineTo(cx - 1, y + 6.2 + wob);
      ctx.moveTo(cx + 4, y + 5 + wob); ctx.lineTo(cx + 1, y + 6.2 + wob);
      ctx.stroke();
    } else {
      // 龟兵 / 龟壳
      if (e.state === 'walk') {
        const cx = x + 7;
        const foot = Math.sin(e.anim * 5) * 1.5;
        const headX = x + (e.vx > 0 ? 12 : 2);
        // 脚
        ctx.fillStyle = '#F9A825';
        ctx.fillRect(cx - 5 + foot, y + 19, 4, 3.5);
        ctx.fillRect(cx + 1 - foot, y + 19, 4, 3.5);
        // 身体
        ctx.fillStyle = '#FDD835';
        ctx.fillRect(cx - 4.5, y + 13, 9, 6.5);
        // 头
        ctx.fillStyle = '#FFEE58';
        ctx.beginPath();
        ctx.arc(headX, y + 14, 3.6, 0, Math.PI * 2);
        ctx.fill();
        // 嘴
        ctx.fillStyle = '#F9A825';
        ctx.fillRect(e.vx > 0 ? headX + 2 : headX - 4, y + 14.5, 2.4, 1.4);
        // 眼
        ctx.fillStyle = '#263238';
        ctx.beginPath();
        ctx.arc(headX + (e.vx > 0 ? 1 : -1), y + 12.8, 0.9, 0, Math.PI * 2);
        ctx.fill();
        // 壳（深绿描边 + 六格花纹）
        ctx.fillStyle = '#2E7D32';
        ctx.beginPath();
        ctx.ellipse(cx, y + 10.5, 8.2, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#43A047';
        ctx.beginPath();
        ctx.ellipse(cx, y + 10.5, 6.6, 5.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1B5E20';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(cx - 6.6, y + 10.5); ctx.lineTo(cx + 6.6, y + 10.5);
        ctx.moveTo(cx - 3.2, y + 5.6); ctx.lineTo(cx - 4.6, y + 10.5); ctx.lineTo(cx - 3.2, y + 15.2);
        ctx.moveTo(cx + 3.2, y + 5.6); ctx.lineTo(cx + 4.6, y + 10.5); ctx.lineTo(cx + 3.2, y + 15.2);
        ctx.stroke();
        // 壳顶高光
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.ellipse(cx - 2, y + 6.5, 2.6, 1.4, -0.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 龟壳：滑动时旋转条纹 + 速度线
        const cx = x + 7, cy = y + 8;
        if (e.state === 'slide') {
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.lineWidth = 1;
          const dir = e.vx > 0 ? -1 : 1;
          ctx.beginPath();
          ctx.moveTo(cx + dir * 10, cy - 2); ctx.lineTo(cx + dir * 15, cy - 2);
          ctx.moveTo(cx + dir * 10, cy + 2); ctx.lineTo(cx + dir * 16, cy + 2);
          ctx.stroke();
        }
        ctx.fillStyle = '#1B5E20';
        ctx.beginPath();
        ctx.ellipse(cx, cy, 8.2, 6.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = e.state === 'slide' ? '#66BB6A' : '#43A047';
        ctx.beginPath();
        ctx.ellipse(cx, cy, 6.4, 4.8, 0, 0, Math.PI * 2);
        ctx.fill();
        // 旋转花纹（滑动时随时间转）
        const rot = e.state === 'slide' ? (e.anim * 4) % (Math.PI * 2) : 0;
        ctx.strokeStyle = '#1B5E20';
        ctx.lineWidth = 1;
        for (let k = 0; k < 3; k++) {
          const a = rot + (k * Math.PI) / 3;
          ctx.beginPath();
          ctx.moveTo(cx - Math.cos(a) * 6.2, cy - Math.sin(a) * 4.6);
          ctx.lineTo(cx + Math.cos(a) * 6.2, cy + Math.sin(a) * 4.6);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.ellipse(cx - 2, cy - 2.6, 2.4, 1.2, -0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
});
