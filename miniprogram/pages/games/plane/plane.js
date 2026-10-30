// 飞机大战：10 关闯关（每关波次编队 + 关底 BOSS，难度逐级提升），5 条生命，
// 大招=激光束扫屏（起始 1 个、最多 3 个，每 800 分 / 每击落 40 架充能 1 次），宝宝助战最多 5 个（跟踪导弹），火力升级战机外观进化，
// WebAudio 合成音效 + 背景音乐，Canvas 2d + requestAnimationFrame
const { check } = require('../../../utils/perms');

const LEVEL_NAMES = [
  '第 1 关 · 空中巡逻', '第 2 关 · 突袭编队', '第 3 关 · 钢铁防线', '第 4 关 · 夜幕截击', '第 5 关 · 雷霆风暴',
  '第 6 关 · 血色长空', '第 7 关 · 钢铁洪流', '第 8 关 · 深渊猎手', '第 9 关 · 苍穹决战', '第 10 关 · 终极 BOSS',
];

// 程序生成 10 关配置：波次数量、敌机速度/血量、BOSS 血量随关卡递增（每关时长约 40~90 秒）
const LEVELS = LEVEL_NAMES.map((name, i) => {
  const n = i + 1;
  const waves = [];
  const wcount = 4 + Math.floor(n / 2); // 4~9 波，关卡越深波次越多
  for (let w = 0; w < wcount; w++) {
    if (n >= 2 && w % 3 === 2) {
      waves.push({ type: 'big', count: 1 + Math.floor(n / 4), pattern: 'solo', escort: Math.min(3, Math.floor(n / 3)) });
    } else {
      waves.push({ type: 'small', count: Math.min(12, 5 + Math.floor(n / 2) + w), pattern: w % 2 ? 'line' : 'v' });
    }
  }
  return {
    name, waves, boss: true,
    speed: 1 + (n - 1) * 0.05,       // 敌机速度 ×1 → ×1.45
    bigHp: 5 + Math.floor(n / 3),     // 大机血量 5 → 8
    bossHp: 50 + n * 28,             // BOSS 血量 78 → 330（1 关火力 1 约 26 秒可破）
  };
});

const FIRE_INTERVAL = [330, 270, 230, 190, 160]; // 火力 1-5 级射击间隔(ms)

// hsl → #rrggbb（小程序 Canvas 渐变对 hsl 函数色解析不稳，统一转 hex）
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}
const BABY_INTERVAL = 450;                        // 宝宝射击间隔(ms)
const LASER_DPS = 80;                             // 激光每秒伤害
const LASER_DUR = 900;                            // 激光持续(ms)
const BOMB_MAX = 3;                               // 大招上限
const BOMB_SCORE_STEP = 800; // 每 800 分充能 1 次激光
const BOMB_KILL_STEP = 40;   // 每击落 40 架充能 1 次激光
const BABY_MAX = 5;                               // 宝宝上限

Page({
  data: {
    state: 'ready', // ready | playing | paused | over | win
    score: 0, lives: 5, bombs: 1, fire: 1, babies: 0, level: 1,
    bossHp: 0, bossMax: 0,
    mask: '', muted: false,
  },

  onLoad() {
    check('plane').then((r) => {
      if (!r.allowed) {
        wx.showToast({ title: '飞机大战已被管理员禁用', icon: 'none' });
        setTimeout(() => wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/games/games' }) }), 900);
        return;
      }
      this.loop = this.loop.bind(this);
      this.muted = !!wx.getStorageSync('plane_muted');
      this.setData({ muted: this.muted });
      this.initCanvas();
      this.initAudio();
    });
  },
  onUnload() { this.stopLoop(); this.stopBgm(); this.closeAudio(); },
  onHide() { if (this.data.state === 'playing') this.setPause(true); },

  // ================= 画布 =================
  initCanvas() {
    wx.createSelectorQuery()
      .select('#plane')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0]) {
          // 节点偶现查不到：300ms 后重试一次
          if (!this._cvRetry) { this._cvRetry = true; setTimeout(() => this.initCanvas(), 300); }
          return;
        }
        const { node: canvas, width, height } = res[0];
        const dpr = wx.getSystemInfoSync().pixelRatio;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.ctx.scale(dpr, dpr);
        this.w = width;
        this.h = height;
        this.makeStars();
        this.drawIdle();
      });
  },
  makeStars() {
    this.stars = Array.from({ length: 40 }, () => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      r: Math.random() * 1.6 + 0.4,
      v: Math.random() * 30 + 12,
    }));
  },

  // ================= 音效（WebAudio 合成：振荡器 + 白噪声） =================
  initAudio() {
    try { this.ac = wx.createWebAudioContext(); } catch (e) { this.ac = null; }
  },
  closeAudio() {
    try { if (this.ac) this.ac.close(); } catch (e) {}
    this.ac = null;
  },
  tone(freq, dur, type, vol, slideTo, delay) {
    const ac = this.ac;
    if (!ac || this.muted) return;
    try {
      const t0 = ac.currentTime + (delay || 0);
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
      g.gain.setValueAtTime(vol || 0.08, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(ac.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
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
      const src = ac.createBufferSource();
      src.buffer = buf;
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff || 800;
      const g = ac.createGain();
      g.gain.value = vol || 0.12;
      src.connect(f); f.connect(g); g.connect(ac.destination);
      src.start();
    } catch (e) {}
  },

  sfxShoot() { this.tone(720 + this.fire * 50, 0.04, 'square', 0.015, 520); },
  sfxHit() { this.tone(340, 0.05, 'square', 0.03, 260); },
  sfxExplode(type) {
    if (type === 'boss') { this.noise(0.9, 0.22, 400); this.tone(70, 0.8, 'sawtooth', 0.16, 25); this.tone(50, 1.0, 'sine', 0.14, 20, 0.15); }
    else if (type === 'big') { this.noise(0.35, 0.14, 600); this.tone(130, 0.3, 'sawtooth', 0.1, 40); }
    else { this.noise(0.16, 0.09, 1400); }
  },
  sfxPowerup() { this.tone(523, 0.09, 'sine', 0.1, 784); this.tone(784, 0.12, 'sine', 0.1, 1046, 0.09); },
  sfxShield() { this.tone(440, 0.15, 'sine', 0.09, 660); },
  sfxBaby() { this.tone(880, 0.08, 'triangle', 0.09, 1320); this.tone(1320, 0.1, 'triangle', 0.08, 1760, 0.08); },
  sfxMissile() { this.tone(240, 0.12, 'sawtooth', 0.03, 520); },
  sfxBombPick() { this.tone(392, 0.08, 'square', 0.08, 523); this.tone(523, 0.1, 'square', 0.08, 659, 0.08); },
  // 激光大招：上升锯齿嗡鸣 + 噪声
  sfxLaser() { this.tone(180, 0.9, 'sawtooth', 0.12, 1400); this.tone(90, 0.9, 'square', 0.06, 700); this.noise(0.5, 0.06, 3000); },
  sfxPlayerHit() { this.noise(0.3, 0.16, 700); this.tone(220, 0.3, 'sawtooth', 0.12, 55); },
  sfxEnemyShot() { this.tone(260, 0.07, 'square', 0.035, 180); },
  sfxLevelClear() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.1, f, i * 0.1)); },
  sfxIntro() { this.tone(392, 0.12, 'triangle', 0.08, 523); this.tone(523, 0.16, 'triangle', 0.08, 659, 0.12); },
  sfxBossWarn() {
    [0, 0.28, 0.56].forEach((d) => { this.tone(880, 0.14, 'square', 0.1, 660, d); this.tone(660, 0.14, 'square', 0.1, 880, d + 0.14); });
    this.noise(0.8, 0.1, 300);
  },
  sfxBossRage() { this.tone(110, 0.5, 'sawtooth', 0.14, 55); this.noise(0.5, 0.12, 400); },
  sfxWin() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.12, f, i * 0.13)); },
  sfxOver() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.12, f, i * 0.18)); },

  startBgm() {
    if (this.muted || this.bgmTimer) return;
    const bass = [130.8, 146.8, 164.8, 196.0];
    const mel = [523.3, 587.3, 659.3, 784.0, 880.0];
    let step = 0;
    this.bgmTimer = setInterval(() => {
      if (this.muted || this.data.state !== 'playing' || this.intro > 0) return;
      if (step % 4 === 0) this.tone(bass[Math.floor(step / 4) % bass.length], 0.4, 'triangle', 0.03);
      if (step % 2 === 1 && Math.random() < 0.7) this.tone(mel[Math.floor(Math.random() * mel.length)], 0.16, 'sine', 0.018);
      step++;
    }, 480);
  },
  stopBgm() { if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; } },
  toggleMute() {
    this.muted = !this.muted;
    this.setData({ muted: this.muted });
    wx.setStorageSync('plane_muted', this.muted);
    if (this.muted) this.stopBgm();
    else if (this.data.state === 'playing') this.startBgm();
  },

  // ================= 游戏流程 =================
  startGame() {
    if (!this.ctx) {
      // 画布未就绪：最多重试 10 次（约 2 秒），仍失败提示用户
      this._retryStart = (this._retryStart || 0) + 1;
      if (this._retryStart <= 10) {
        setTimeout(() => this.startGame(), 200);
      } else {
        this._retryStart = 0;
        wx.showToast({ title: '画布初始化失败，请退出重进', icon: 'none' });
      }
      return;
    }
    this._retryStart = 0;
    try { if (this.ac && this.ac.state === 'suspended') this.ac.resume(); } catch (e) {}
    this.score = 0;
    this.lives = 5;
    this.levelIdx = 0;
    this.fire = 1;
    this.bombs = 1;
    this.babies = [];
    this.player = { x: this.w / 2, y: this.h - 90, r: 15, inv: 0, shield: 0, fireT: 0 };
    this.bullets = [];
    this.missiles = [];
    this.ebullets = [];
    this.enemies = [];
    this.powerups = [];
    this.particles = [];
    this.flash = 0;
    this.laser = null;
    this.babyT = 0;
    this.time = 0;
    this.pendingNext = false;
    this._bossSyncT = 0;
    this.killCount = 0;       // 本局击落数
    this.bombScoreCharges = 0; // 已按积分发放的充能次数
    this.bombKillCharges = 0;  // 已按击落发放的充能次数
    this.setupLevel();
    this.setData({
      state: 'playing', score: 0, lives: 5, bombs: 1, fire: 1, babies: 0, level: 1,
      bossHp: 0, bossMax: 0, mask: '',
    });
    this.startBgm();
    this.startLoop();
  },

  setupLevel() {
    const cfg = LEVELS[this.levelIdx];
    this.cfg = cfg;
    this.spawnQueue = this.buildSpawns(cfg);
    this.spawnClock = 0;
    this.bossSpawned = false;
    this.intro = 1600; // 关卡开场提示
    this.introText = '';
    this.sfxIntro();
    this.setData({ level: this.levelIdx + 1, bossHp: 0, bossMax: 0 });
  },

  // 波次编队展开成按时间排序的出场表 [{type, x, delay}]
  buildSpawns(cfg) {
    const list = [];
    let t = 0;
    const margin = 34;
    cfg.waves.forEach((w) => {
      if (w.pattern === 'v') {
        const mid = this.w / 2;
        const k0 = Math.floor(w.count / 2);
        for (let i = 0; i < w.count; i++) {
          const k = i - k0;
          list.push({ type: w.type, x: Math.max(margin, Math.min(this.w - margin, mid + k * 40)), delay: t + Math.abs(k) * 130 });
        }
        t += 1700;
      } else if (w.pattern === 'line') {
        for (let i = 0; i < w.count; i++) {
          const x = w.count === 1 ? this.w / 2 : margin + ((this.w - margin * 2) * i) / (w.count - 1);
          list.push({ type: w.type, x, delay: t + i * 60 });
        }
        t += 1600;
      } else {
        for (let i = 0; i < w.count; i++) {
          const bx = margin + Math.random() * (this.w - margin * 2);
          list.push({ type: 'big', x: bx, delay: t + i * 1000 });
          for (let k = 0; k < (w.escort || 0); k++) {
            list.push({ type: 'small', x: Math.max(margin, Math.min(this.w - margin, bx + (k % 2 ? 1 : -1) * (30 + k * 18))), delay: t + i * 1000 + 120 * k });
          }
        }
        t += 1000 * w.count + 1300;
      }
    });
    list.sort((a, b) => a.delay - b.delay);
    return list;
  },

  startLoop() {
    this.stopLoop();
    this.lastTs = 0;
    this.raf = this.canvas.requestAnimationFrame(this.loop);
  },
  stopLoop() {
    if (this.raf && this.canvas) { try { this.canvas.cancelAnimationFrame(this.raf); } catch (e) {} }
    this.raf = null;
  },

  setPause(pause) {
    if (pause) {
      if (this.data.state !== 'playing') return;
      this.setData({ state: 'paused', mask: '已暂停' });
      this.stopLoop();
      this.stopBgm();
    } else {
      if (this.data.state !== 'paused') return;
      this.setData({ state: 'playing', mask: '' });
      this.startLoop();
      this.startBgm();
    }
  },
  togglePause() {
    const s = this.data.state;
    if (s === 'playing') this.setPause(true);
    else if (s === 'paused') this.setPause(false);
  },
  goBack() {
    this.stopLoop();
    this.stopBgm();
    wx.navigateBack();
  },

  loop(ts) {
    if (this.data.state !== 'playing') { this.raf = null; return; }
    const dt = Math.min(50, ts - (this.lastTs || ts));
    this.lastTs = ts;
    // 异常保护：单帧出错不能断掉 rAF 链（否则画面永久定格 = 卡死）；连续异常自动暂停
    try {
      this.update(dt);
      this.draw();
      this._loopErr = 0;
    } catch (err) {
      this._loopErr = (this._loopErr || 0) + 1;
      console.error('[plane] frame error', this._loopErr, err && err.message);
      if (this._loopErr >= 20) {
        this._loopErr = 0;
        this.setPause(true);
        wx.showToast({ title: '画面异常，已自动暂停', icon: 'none' });
      }
    }
    if (this.canvas) this.raf = this.canvas.requestAnimationFrame(this.loop);
  },

  // ================= 更新 =================
  update(dt) {
    const p = this.player;
    const sec = dt / 1000;
    this.time += sec;

    for (const s of this.stars) {
      s.y += s.v * sec;
      if (s.y > this.h) { s.y = -2; s.x = Math.random() * this.w; }
    }

    if (this.intro > 0) { this.intro -= dt; this.updateParticles(sec); return; }
    if (this.flash > 0) this.flash -= dt;
    if (p.inv > 0) p.inv -= dt;
    if (p.shield > 0) p.shield -= dt;

    // 玩家射击
    p.fireT -= dt;
    if (p.fireT <= 0) {
      p.fireT = FIRE_INTERVAL[this.fire - 1];
      this.playerShoot();
      this.sfxShoot();
    }

    // 宝宝跟踪导弹：每枚锁定最近敌机（优先 BOSS/大机），带转向追踪
    if (this.babies.length) {
      this.babyT -= dt;
      if (this.babyT <= 0) {
        this.babyT = BABY_INTERVAL;
        for (const b of this.babies) {
          const tgt = this.pickBabyTarget(b.x, b.y);
          this.missiles.push({
            x: b.x, y: b.y - 8, vx: 0, vy: -260, r: 4, dmg: 2,
            tgt, turn: 5.2, life: 4, trail: 0,
          });
        }
        this.sfxMissile();
      }
    }
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= sec;
      if (m.life <= 0) { this.missiles.splice(i, 1); continue; }
      // 目标失效则重锁
      if (!m.tgt || m.tgt.hp <= 0 || !this.enemies.includes(m.tgt)) m.tgt = this.pickBabyTarget(m.x, m.y);
      const sp = 330;
      if (m.tgt) {
        const dx = m.tgt.x - m.x, dy = m.tgt.y - m.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const desVx = (dx / len) * sp, desVy = (dy / len) * sp;
        const k = Math.min(1, m.turn * sec);
        m.vx += (desVx - m.vx) * k;
        m.vy += (desVy - m.vy) * k;
      } else {
        const k = Math.min(1, m.turn * sec);
        m.vx += (0 - m.vx) * k;
        m.vy += (-sp - m.vy) * k;
      }
      const vl = Math.sqrt(m.vx * m.vx + m.vy * m.vy) || 1;
      m.vx = (m.vx / vl) * sp; m.vy = (m.vy / vl) * sp;
      m.x += m.vx * sec; m.y += m.vy * sec;
      m.trail += sec;
      if (m.trail > 0.02) {
        m.trail = 0;
        this.particles.push({ x: m.x, y: m.y, vx: 0, vy: 0, life: 0.25, color: '#FDBA74' });
      }
      if (m.x < -20 || m.x > this.w + 20 || m.y < -20 || m.y > this.h + 20) { this.missiles.splice(i, 1); continue; }
      let gone = false;
      for (let j = this.enemies.length - 1; j >= 0; j--) {
        const e = this.enemies[j];
        if (this.hit(m, e)) {
          e.hp -= m.dmg;
          e.flash = 90;
          this.spawnParticles(m.x, m.y, 5, '#FDBA74');
          if (e.hp <= 0) this.killEnemy(j);
          else { this.sfxHit(); if (e.type === 'boss') this.onBossHit(e); }
          this.missiles.splice(i, 1);
          gone = true;
          break;
        }
      }
      if (gone) continue;
    }

    // 激光大招
    if (this.laser) {
      this.laser.t += dt;
      if (this.laser.t >= LASER_DUR) this.laser = null;
      else this.applyLaser(sec);
    }

    // 按出场表生成敌机
    this.spawnClock += dt;
    while (this.spawnQueue.length && this.spawnQueue[0].delay <= this.spawnClock) {
      const s = this.spawnQueue.shift();
      this.spawnEnemy(s.type, s.x);
    }
    if (this.cfg.boss && !this.bossSpawned && this.spawnQueue.length === 0 && !this.enemies.some((e) => e.type === 'boss')) {
      this.bossSpawned = true;
      this.spawnBoss();
    }

    // 玩家子弹
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * sec; b.y += b.vy * sec;
      if (b.y < -10 || b.x < -10 || b.x > this.w + 10) { this.bullets.splice(i, 1); continue; }
      for (let j = this.enemies.length - 1; j >= 0; j--) {
        const e = this.enemies[j];
        if (this.hit(b, e)) {
          this.bullets.splice(i, 1);
          e.hp -= b.dmg;
          e.flash = 80;
          this.spawnParticles(b.x, b.y, 3, '#FDE68A');
          if (e.hp <= 0) this.killEnemy(j);
          else { this.sfxHit(); if (e.type === 'boss') this.onBossHit(e); }
          break;
        }
      }
    }

    // 敌机
    const ebv = 150 + (this.levelIdx + 1) * 12; // 敌弹速度随关卡提升
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.flash > 0) e.flash -= dt;
      if (e.type === 'boss') {
        const rage = e.hp <= e.maxhp * 0.5;
        e.x += e.dir * (rage ? 130 : 70) * sec;
        if (e.x < e.r + 10) { e.x = e.r + 10; e.dir = 1; }
        if (e.x > this.w - e.r - 10) { e.x = this.w - e.r - 10; e.dir = -1; }
        e.t += sec;
        e.y = 90 + Math.sin(e.t * 1.3) * 14;
        e.fireT -= dt;
        if (e.fireT <= 0) this.bossFire(e, rage, ebv);
      } else {
        e.y += e.vy * sec;
        e.t += sec;
        e.x += Math.sin(e.t * 2) * 30 * sec;
        if (e.type === 'big') {
          e.fireT -= dt;
          if (e.fireT <= 0) {
            e.fireT = Math.max(700, 1500 - (this.levelIdx + 1) * 80) + Math.random() * 600;
            this.enemyAimShot(e, ebv);
          }
        }
        if (e.y > this.h + e.r) { this.enemies.splice(i, 1); continue; }
      }
      if (this.hit(e, p)) {
        if (e.type !== 'boss') this.killEnemy(i);
        this.damagePlayer();
      }
    }

    // 敌方子弹
    for (let i = this.ebullets.length - 1; i >= 0; i--) {
      const b = this.ebullets[i];
      b.x += b.vx * sec; b.y += b.vy * sec;
      if (b.y > this.h + 10 || b.y < -10 || b.x < -10 || b.x > this.w + 10) { this.ebullets.splice(i, 1); continue; }
      if (this.hit(b, p)) {
        this.ebullets.splice(i, 1);
        this.damagePlayer();
      }
    }

    // 道具
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const u = this.powerups[i];
      u.y += 90 * sec;
      u.t += sec;
      if (u.y > this.h + 16) { this.powerups.splice(i, 1); continue; }
      if (this.hit(u, p)) {
        this.powerups.splice(i, 1);
        this.applyPowerup(u.kind);
      }
    }

    this.updateParticles(sec);

    // BOSS 死亡在帧末统一推进关卡，避免遍历中重赋值数组
    if (this.pendingNext) {
      this.pendingNext = false;
      if (this.data.state === 'playing') this.nextLevel();
    }
  },

  // 激光束：沿玩家 x 的垂直光柱，清弹幕 + 持续伤害
  applyLaser(sec) {
    const L = this.laser;
    const env = Math.sin((L.t / LASER_DUR) * Math.PI); // 0→1→0 包络
    const hw = 16 * env + 6;
    const px = this.player.x;
    // 清除光束内的敌弹
    for (let i = this.ebullets.length - 1; i >= 0; i--) {
      const b = this.ebullets[i];
      if (Math.abs(b.x - px) < hw + b.r) {
        this.spawnParticles(b.x, b.y, 2, '#A5F3FC');
        this.ebullets.splice(i, 1);
      }
    }
    // 伤害光束内的敌机
    for (let j = this.enemies.length - 1; j >= 0; j--) {
      const e = this.enemies[j];
      if (Math.abs(e.x - px) < hw + e.r) {
        e.hp -= LASER_DPS * sec;
        e.flash = 60;
        if (e.hp <= 0) this.killEnemy(j);
        else if (e.type === 'boss') {
          if (!e.raged && e.hp <= e.maxhp * 0.5) { e.raged = true; this.sfxBossRage(); wx.showToast({ title: 'BOSS 狂暴了！', icon: 'none' }); }
        }
      }
    }
    // 激光期间 BOSS 血条低频刷新（每帧 setData 太重）
    if (this.time - (this._bossSyncT || 0) > 0.2) {
      this._bossSyncT = this.time;
      const boss = this.enemies.find((e) => e.type === 'boss');
      if (boss) this.setData({ bossHp: Math.max(0, Math.ceil(boss.hp)) });
    }
  },

  updateParticles(sec) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      q.x += q.vx * sec; q.y += q.vy * sec;
      q.life -= sec;
      if (q.life <= 0) this.particles.splice(i, 1);
    }
  },

  hit(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    const rr = (a.r || 4) + (b.r || 4);
    return dx * dx + dy * dy < rr * rr;
  },

  // ================= 实体 =================
  playerShoot() {
    const p = this.player;
    const shots = [
      [[0, -420]],
      [[-7, -420], [7, -420]],
      [[0, -430], [-10, -380], [10, -380]],
      [[-7, -420], [7, -420], [-16, -340], [16, -340]],
      [[0, -440], [-9, -400], [9, -400], [-18, -330], [18, -330]],
    ][this.fire - 1];
    for (const [ox, vy] of shots) {
      this.bullets.push({ x: p.x + ox, y: p.y - 14, vx: ox * 6, vy, r: 4, dmg: 1 });
    }
  },

  spawnEnemy(type, x) {
    const sp = this.cfg.speed;
    if (type === 'big') {
      const hp = this.cfg.bigHp;
      this.enemies.push({
        type: 'big', r: 24, hp, maxhp: hp, flash: 0, score: 40 + (this.levelIdx + 1) * 2,
        x, y: -30,
        vy: (55 + Math.random() * 25) * sp, t: Math.random() * 6,
        fireT: 1200 + Math.random() * 800,
      });
    } else {
      this.enemies.push({
        type: 'small', r: 13, hp: 1, maxhp: 1, flash: 0, score: 10,
        x, y: -20,
        vy: (115 + Math.random() * 55) * sp, t: Math.random() * 6,
      });
    }
  },

  spawnBoss() {
    this.intro = 1500;
    this.introText = '⚠️ BOSS 来袭';
    this.sfxBossWarn();
    const hp = this.cfg.bossHp;
    this.enemies.push({
      type: 'boss', r: 40 + Math.min(10, this.levelIdx + 1),
      hp, maxhp: hp, flash: 0, score: 500 + (this.levelIdx + 1) * 80,
      x: this.w / 2, y: 90, dir: 1, fireT: 1800, t: 0, volley: 0, spiral: 0, raged: false,
    });
    this.setData({ bossHp: hp, bossMax: hp });
  },

  // BOSS 受击（子弹命中）：血量同步 + 跌破半血进入狂暴
  onBossHit(e) {
    if (!e.raged && e.hp <= e.maxhp * 0.5) {
      e.raged = true;
      this.sfxBossRage();
      wx.showToast({ title: 'BOSS 狂暴了！', icon: 'none' });
    }
    if (this.time - (this._bossSyncT || 0) > 0.2) {
      this._bossSyncT = this.time;
      this.setData({ bossHp: Math.max(0, Math.ceil(e.hp)) });
    }
  },

  // BOSS 攻击模式按关卡分四档，狂暴后节奏加快
  bossFire(e, rage, ebv) {
    const n = this.levelIdx + 1;
    if (n <= 3) {
      e.fireT = rage ? 900 : 1300;
      this.bossFan(e, 3, ebv);
      this.enemyAimShot(e, ebv);
    } else if (n <= 6) {
      e.fireT = rage ? 850 : 1200;
      this.bossFan(e, 5, ebv);
      e.volley = (e.volley || 0) + 1;
      if (e.volley % 2 === 0) this.enemyAimShot(e, ebv);
    } else if (n <= 9) {
      e.fireT = rage ? 700 : 1000;
      this.bossSpiral(e, ebv);
      this.bossFan(e, 7, ebv);
    } else {
      e.fireT = rage ? 620 : 900;
      this.bossSpiral(e, ebv);
      this.bossFan(e, 9, ebv);
      this.enemyAimShot(e, ebv);
      this.enemyAimShot(e, ebv);
    }
  },

  // 螺旋弹幕：旋转角度逐次累加
  bossSpiral(e, ebv) {
    e.spiral = (e.spiral || 0) + 0.55;
    for (const off of [0, Math.PI]) {
      const a = e.spiral + off;
      this.ebullets.push({ x: e.x, y: e.y + 10, vx: Math.cos(a) * ebv * 0.9, vy: Math.abs(Math.sin(a)) * ebv * 0.6 + 60, r: 5 });
    }
    this.sfxEnemyShot();
  },

  enemyAimShot(e, ebv) {
    const p = this.player;
    const dx = p.x - e.x, dy = p.y - e.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const v = ebv + 20;
    this.ebullets.push({ x: e.x, y: e.y + (e.r || 10), vx: (dx / len) * v, vy: (dy / len) * v, r: 5 });
    this.sfxEnemyShot();
  },

  bossFan(e, n, ebv) {
    const spread = 1.1;
    for (let i = 0; i < n; i++) {
      const ang = -spread / 2 + (spread * i) / (n - 1);
      this.ebullets.push({ x: e.x, y: e.y + e.r * 0.7, vx: Math.sin(ang) * ebv, vy: Math.cos(ang) * ebv, r: 6 });
    }
    this.sfxEnemyShot();
  },

  killEnemy(idx) {
    const e = this.enemies[idx];
    this.enemies.splice(idx, 1);
    this.score += e.score;
    this.killCount++;
    this.spawnParticles(e.x, e.y, e.type === 'boss' ? 40 : e.type === 'big' ? 18 : 10, e.type === 'small' ? '#F87171' : e.type === 'big' ? '#C084FC' : '#FB923C');
    this.sfxExplode(e.type);
    if (e.type === 'boss') {
      this.setData({ bossHp: 0 });
      this.syncHud();
      this.pendingNext = true; // 延迟到帧末推进关卡，避免遍历中数组被重赋值
      return;
    }
    const chance = e.type === 'big' ? 0.65 : 0.15;
    if (Math.random() < chance) this.dropPowerup(e.x, e.y);
    this.syncHud();
  },

  dropPowerup(x, y) {
    const r = Math.random();
    let kind;
    if (this.babies.length < BABY_MAX && r < 0.18) kind = 'baby';
    else if (r < 0.48) kind = 'fire';
    else if (r < 0.72) kind = 'shield';
    else if (r < 0.88) kind = 'life';
    else kind = 'fire';
    this.powerups.push({ x, y, r: 13, kind, t: 0 });
  },

  applyPowerup(kind) {
    if (kind === 'fire') {
      if (this.fire < 5) this.fire++;
      else this.score += 30;
      this.sfxPowerup();
    } else if (kind === 'shield') {
      this.player.shield = 5000;
      this.sfxShield();
    } else if (kind === 'life') {
      if (this.lives < 9) this.lives++;
      else this.score += 50;
      this.sfxPowerup();
    } else if (kind === 'baby') {
      if (this.babies.length < BABY_MAX) {
        this.babies.push({ x: this.player.x, y: this.player.y, tx: this.player.x, ty: this.player.y });
        this.sfxBaby();
        wx.showToast({ title: '宝宝 +1（最多 ' + BABY_MAX + ' 个）', icon: 'none' });
      } else this.score += 30;
    }
    this.syncHud();
  },

  damagePlayer() {
    const p = this.player;
    if (p.inv > 0 || p.shield > 0 || this.intro > 0) {
      if (p.shield > 0) this.spawnParticles(p.x, p.y, 4, '#60A5FA');
      return;
    }
    this.lives--;
    this.bombs = Math.max(this.bombs, 1); // 换命保底 1 次激光
    this.fire = Math.max(1, this.fire - 1);
    p.inv = 2000;
    this.spawnParticles(p.x, p.y, 16, '#FBBF24');
    this.sfxPlayerHit();
    try { wx.vibrateShort({ type: 'heavy' }); } catch (e) {}
    this.syncHud();
    if (this.lives <= 0) this.gameOver();
  },

  // 大招：激光束扫屏
  useBomb() {
    if (this.data.state !== 'playing' || this.intro > 0) return;
    if (this.bombs <= 0) return wx.showToast({ title: '激光未充能，得分/击落敌机自动补充', icon: 'none' });
    this.bombs--;
    this.laser = { t: 0 };
    this.flash = 200;
    this.sfxLaser();
    try { wx.vibrateShort({ type: 'heavy' }); } catch (e) {}
    this.syncHud();
  },

  spawnParticles(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * 180;
      this.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0.4 + Math.random() * 0.5, color,
      });
    }
  },

  // ================= 关卡推进 / 结算 =================
  nextLevel() {
    if (this.levelIdx >= LEVELS.length - 1) { this.win(); return; }
    this.levelIdx++;
    this.enemies = [];
    this.ebullets = [];
    this.missiles = [];
    this.laser = null;
    this.setupLevel();
    this.sfxLevelClear();
    this.syncHud();
  },

  gameOver() {
    this.stopLoop();
    this.stopBgm();
    this.sfxOver();
    this.setData({ state: 'over', mask: '💥 战机坠毁\n得分 ' + this.score + ' · 到达第 ' + (this.levelIdx + 1) + ' 关' });
  },

  win() {
    this.stopLoop();
    this.stopBgm();
    this.sfxWin();
    this.setData({ state: 'win', mask: '🎉 十关全破！天空之王\n总分 ' + this.score });
  },

  // 激光充能：每积满 800 分 / 每击落 40 架各 +1 次（上限 3）。
  // 满仓时不推进计数（欠账保留），用完一次会立即补上，避免"到阈值却没给"的困惑。
  checkBombRecharge() {
    let room = BOMB_MAX - this.bombs;
    if (room <= 0) return;
    const sGive = Math.min(Math.max(0, Math.floor(this.score / BOMB_SCORE_STEP) - this.bombScoreCharges), room);
    room -= sGive;
    const kGive = Math.min(Math.max(0, Math.floor(this.killCount / BOMB_KILL_STEP) - this.bombKillCharges), room);
    if (sGive + kGive <= 0) return;
    this.bombScoreCharges += sGive;
    this.bombKillCharges += kGive;
    this.bombs += sGive + kGive;
    this.sfxBombPick();
  },

  syncHud() {
    this.checkBombRecharge();
    this.setData({ score: this.score, lives: this.lives, bombs: this.bombs, fire: this.fire, babies: this.babies.length });
  },

  // ================= 触摸操控 =================
  onTouch(e) {
    if (this.data.state !== 'playing' || !this.player) return;
    const t = e.touches[0];
    if (!t) return;
    const p = this.player;
    p.x = Math.max(p.r, Math.min(this.w - p.r, t.x));
    p.y = Math.max(40, Math.min(this.h - p.r, t.y - 55));
  },

  // ================= 绘制 =================
  drawIdle() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.fillStyle = '#0B1026';
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawStars();
  },

  draw() {
    const ctx = this.ctx;
    ctx.fillStyle = '#0B1026';
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawStars();

    // 道具
    for (const u of this.powerups) this.drawPowerup(u);
    // 敌机
    for (const e of this.enemies) this.drawEnemy(e);
    // 玩家子弹
    ctx.fillStyle = '#A7F3D0';
    for (const b of this.bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 宝宝跟踪导弹（沿速度方向的小弹体 + 尾焰）
    for (const m of this.missiles) {
      const ang = Math.atan2(m.vy, m.vx);
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(ang + Math.PI / 2);
      ctx.fillStyle = '#F1F5F9';
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(-2.6, 4);
      ctx.lineTo(2.6, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FB923C';
      ctx.fillRect(-2.6, 4, 5.2, 2.5);
      ctx.fillStyle = 'rgba(253,186,116,0.8)';
      ctx.beginPath();
      ctx.moveTo(-1.8, 6);
      ctx.lineTo(0, 6 + 4 + Math.random() * 4);
      ctx.lineTo(1.8, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // 敌方子弹
    for (const b of this.ebullets) {
      ctx.fillStyle = '#FCA5A5';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(248,113,113,0.35)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // 粒子
    for (const q of this.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, q.life * 2));
      ctx.fillStyle = q.color;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 玩家 + 宝宝（无敌闪烁）
    const p = this.player;
    if (p && !(p.inv > 0 && Math.floor(p.inv / 120) % 2 === 0)) {
      this.drawBabies(p);
      this.drawPlayer(p);
    }

    // 激光束
    if (this.laser) this.drawLaser();

    // 大招白闪
    if (this.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (this.flash / 200) * 0.35 + ')';
      ctx.fillRect(0, 0, this.w, this.h);
    }

    // 关卡开场提示
    if (this.intro > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.introText || this.cfg.name, this.w / 2, this.h / 2 - 14);
      ctx.font = '15px sans-serif';
      ctx.fillStyle = '#FDE68A';
      const sub = this.introText ? '摧毁它！激光大招可重创 BOSS'
        : this.cfg.boss ? '肃清残敌后，BOSS 即将登场！' : '击落全部敌机过关';
      ctx.fillText(sub, this.w / 2, this.h / 2 + 20);
      ctx.textBaseline = 'alphabetic';
    }
  },

  drawStars() {
    const ctx = this.ctx;
    ctx.fillStyle = '#94A3B8';
    for (const s of this.stars) {
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  drawPowerup(u) {
    const ctx = this.ctx;
    const map = { fire: ['⚡', '#F59E0B'], shield: ['🛡', '#3B82F6'], life: ['❤', '#EF4444'], baby: ['👶', '#F472B6'] };
    const [icon, color] = map[u.kind] || map.fire;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.r + Math.sin(u.t * 6) * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, u.x, u.y);
    ctx.restore();
  },

  // 战机外观随火力等级进化：1 蓝隼 → 2 青锋 → 3 银翼 → 4 紫电 → 5 金耀
  drawPlayer(p) {
    const ctx = this.ctx;
    const tier = this.fire;
    const skins = [
      { body: '#60A5FA', dark: '#1D4ED8', glow: 'rgba(96,165,250,0.25)' },
      { body: '#34D399', dark: '#047857', glow: 'rgba(52,211,153,0.25)' },
      { body: '#22D3EE', dark: '#0E7490', glow: 'rgba(34,211,238,0.3)' },
      { body: '#A78BFA', dark: '#6D28D9', glow: 'rgba(167,139,250,0.3)' },
      { body: '#FBBF24', dark: '#B45309', glow: 'rgba(251,191,36,0.35)' },
    ][tier - 1];
    const ws = 0.85 + tier * 0.12; // 翼展系数

    ctx.save();
    ctx.translate(p.x, p.y);

    // 护盾
    if (p.shield > 0) {
      ctx.strokeStyle = 'rgba(96,165,250,' + (p.shield < 1200 && Math.floor(p.shield / 150) % 2 === 0 ? 0.3 : 0.9) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, p.r + 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 5 级金色光环
    if (tier === 5) {
      ctx.fillStyle = skins.glow;
      ctx.beginPath();
      ctx.arc(0, 0, p.r + 8 + Math.sin(this.time * 5) * 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 主翼（梯形，随火力变宽）
    const wing = ctx.createLinearGradient(-p.r * ws, 0, p.r * ws, 0);
    wing.addColorStop(0, skins.dark);
    wing.addColorStop(0.5, skins.body);
    wing.addColorStop(1, skins.dark);
    ctx.fillStyle = wing;
    ctx.beginPath();
    ctx.moveTo(-p.r * ws, p.r * 0.55);
    ctx.lineTo(-p.r * 0.3, -p.r * 0.2);
    ctx.lineTo(p.r * 0.3, -p.r * 0.2);
    ctx.lineTo(p.r * ws, p.r * 0.55);
    ctx.lineTo(0, p.r * 0.3);
    ctx.closePath();
    ctx.fill();

    // 3 级+：侧挂舱
    if (tier >= 3) {
      ctx.fillStyle = skins.dark;
      for (const sx of [-p.r * ws * 0.8, p.r * ws * 0.8]) {
        ctx.beginPath();
        ctx.ellipse(sx, p.r * 0.3, 3.5, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 4 级+：前掠小翼
    if (tier >= 4) {
      ctx.fillStyle = skins.body;
      ctx.beginPath();
      ctx.moveTo(-p.r * 0.4, -p.r * 0.5);
      ctx.lineTo(-p.r * 0.9, -p.r * 0.1);
      ctx.lineTo(-p.r * 0.3, -p.r * 0.1);
      ctx.closePath();
      ctx.moveTo(p.r * 0.4, -p.r * 0.5);
      ctx.lineTo(p.r * 0.9, -p.r * 0.1);
      ctx.lineTo(p.r * 0.3, -p.r * 0.1);
      ctx.closePath();
      ctx.fill();
    }

    // 机身（纵向渐变）
    const bg = ctx.createLinearGradient(0, -p.r - 4, 0, p.r);
    bg.addColorStop(0, '#F8FAFC');
    bg.addColorStop(0.35, skins.body);
    bg.addColorStop(1, skins.dark);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(0, -p.r - 6);
    ctx.quadraticCurveTo(p.r * 0.45, -p.r * 0.2, p.r * 0.3, p.r * 0.9);
    ctx.lineTo(-p.r * 0.3, p.r * 0.9);
    ctx.quadraticCurveTo(-p.r * 0.45, -p.r * 0.2, 0, -p.r - 6);
    ctx.closePath();
    ctx.fill();

    // 座舱玻璃高光
    ctx.fillStyle = 'rgba(224,242,254,0.95)';
    ctx.beginPath();
    ctx.ellipse(0, -p.r * 0.25, 3.5, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // 翼尖航行灯（闪烁）
    const blink = Math.sin(this.time * 8) > 0;
    ctx.fillStyle = blink ? '#F87171' : '#7F1D1D';
    ctx.beginPath();
    ctx.arc(-p.r * ws, p.r * 0.55, 2, 0, Math.PI * 2);
    ctx.arc(p.r * ws, p.r * 0.55, 2, 0, Math.PI * 2);
    ctx.fill();

    // 尾焰（级数越多火焰越多）
    ctx.fillStyle = '#FBBF24';
    const flames = tier >= 4 ? [-p.r * 0.22, p.r * 0.22, 0] : [0];
    for (const fx of flames) {
      ctx.beginPath();
      ctx.moveTo(fx - 3, p.r * 0.9);
      ctx.lineTo(fx, p.r * 0.9 + 7 + Math.random() * 5);
      ctx.lineTo(fx + 3, p.r * 0.9);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },

  // 宝宝导弹锁敌：优先 BOSS > 大机 > 小机，同级取最近
  pickBabyTarget(x, y) {
    let best = null, bestScore = Infinity;
    for (const e of this.enemies) {
      const dx = e.x - x, dy = e.y - y;
      const d = dx * dx + dy * dy;
      const prio = e.type === 'boss' ? 0 : e.type === 'big' ? 1 : 2;
      const s = prio * 1e6 + d;
      if (s < bestScore) { bestScore = s; best = e; }
    }
    return best;
  },

  // 宝宝：跟随玩家的小奶飞机（平滑跟随，最多 5 个两翼 + 尾部编队）
  drawBabies(p) {
    const ctx = this.ctx;
    const offsets = [[-30, 34], [30, 34], [-46, 52], [46, 52], [0, 58]];
    for (let i = 0; i < this.babies.length; i++) {
      const b = this.babies[i];
      const [ox, oy] = offsets[i];
      b.tx = p.x + ox;
      b.ty = p.y + oy;
      b.x += (b.tx - b.x) * 0.2;
      b.y += (b.ty - b.y) * 0.2;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.fillStyle = '#FDE68A';
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(-7, 7);
      ctx.lineTo(0, 4);
      ctx.lineTo(7, 7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#F472B6';
      ctx.beginPath();
      ctx.arc(0, -1, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },

  drawLaser() {
    const ctx = this.ctx;
    const L = this.laser;
    const env = Math.sin((L.t / LASER_DUR) * Math.PI);
    const hw = 16 * env + 6;
    const px = this.player.x;
    const top = 0;
    const bottom = this.player.y - 14;
    // 外焰
    const g = ctx.createLinearGradient(px - hw, 0, px + hw, 0);
    g.addColorStop(0, 'rgba(34,211,238,0)');
    g.addColorStop(0.3, 'rgba(34,211,238,0.55)');
    g.addColorStop(0.5, 'rgba(240,253,255,0.95)');
    g.addColorStop(0.7, 'rgba(34,211,238,0.55)');
    g.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px - hw, top, hw * 2, bottom - top);
    // 核心白线
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(px - 2, top, 4, bottom - top);
    // 发射口光晕
    ctx.fillStyle = 'rgba(165,243,252,0.8)';
    ctx.beginPath();
    ctx.arc(px, bottom, hw * 0.8, 0, Math.PI * 2);
    ctx.fill();
  },

  drawEnemy(e) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(e.x, e.y);
    const lit = e.flash > 0;
    if (e.type === 'small') {
      // 红色截击机：机身 + 后掠翼 + 座舱 + 引擎红光，飞行时轻微倾斜
      ctx.rotate(Math.sin(e.t * 2) * 0.15);
      const body = lit ? '#fff' : '#EF4444';
      const dark = lit ? '#ddd' : '#991B1B';
      // 主翼（后掠）
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(-e.r * 0.95, -e.r * 0.5);
      ctx.lineTo(-e.r * 0.25, e.r * 0.1);
      ctx.lineTo(-e.r * 0.25, e.r * 0.5);
      ctx.lineTo(-e.r * 0.85, e.r * 0.75);
      ctx.closePath();
      ctx.moveTo(e.r * 0.95, -e.r * 0.5);
      ctx.lineTo(e.r * 0.25, e.r * 0.1);
      ctx.lineTo(e.r * 0.25, e.r * 0.5);
      ctx.lineTo(e.r * 0.85, e.r * 0.75);
      ctx.closePath();
      ctx.fill();
      // 机身（纵向渐变）
      const g = ctx.createLinearGradient(0, -e.r, 0, e.r);
      g.addColorStop(0, body);
      g.addColorStop(1, dark);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -e.r);
      ctx.quadraticCurveTo(e.r * 0.4, -e.r * 0.1, e.r * 0.28, e.r * 0.85);
      ctx.lineTo(-e.r * 0.28, e.r * 0.85);
      ctx.quadraticCurveTo(-e.r * 0.4, -e.r * 0.1, 0, -e.r);
      ctx.closePath();
      ctx.fill();
      // 尾翼
      ctx.fillStyle = dark;
      ctx.fillRect(-e.r * 0.55, e.r * 0.55, e.r * 1.1, e.r * 0.28);
      // 座舱
      ctx.fillStyle = 'rgba(186,230,253,0.9)';
      ctx.beginPath();
      ctx.ellipse(0, -e.r * 0.25, e.r * 0.16, e.r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      // 引擎喷口（敌机向下飞，尾焰朝上）
      ctx.fillStyle = 'rgba(251,146,60,' + (0.5 + 0.4 * Math.sin(e.t * 10)) + ')';
      ctx.beginPath();
      ctx.arc(-e.r * 0.3, -e.r * 0.75, 2.2, 0, Math.PI * 2);
      ctx.arc(e.r * 0.3, -e.r * 0.75, 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.type === 'big') {
      // 紫色重型轰炸机：宽机身 + 双发短舱 + 前炮塔 + 装甲线 + 血条
      const body = lit ? '#fff' : '#A855F7';
      const dark = lit ? '#ddd' : '#6B21A8';
      // 主翼
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(-e.r, -e.r * 0.35);
      ctx.lineTo(e.r, -e.r * 0.35);
      ctx.lineTo(e.r * 0.62, e.r * 0.55);
      ctx.lineTo(-e.r * 0.62, e.r * 0.55);
      ctx.closePath();
      ctx.fill();
      // 双发短舱
      ctx.fillStyle = lit ? '#eee' : '#7E22CE';
      for (const sx of [-e.r * 0.72, e.r * 0.72]) {
        ctx.beginPath();
        ctx.ellipse(sx, -e.r * 0.1, e.r * 0.16, e.r * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(251,146,60,0.7)';
        ctx.beginPath();
        ctx.arc(sx, -e.r * 0.45, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = lit ? '#eee' : '#7E22CE';
      }
      // 机身
      const g = ctx.createLinearGradient(0, -e.r, 0, e.r);
      g.addColorStop(0, body);
      g.addColorStop(1, dark);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -e.r * 0.95);
      ctx.quadraticCurveTo(e.r * 0.42, -e.r * 0.2, e.r * 0.34, e.r * 0.8);
      ctx.lineTo(-e.r * 0.34, e.r * 0.8);
      ctx.quadraticCurveTo(-e.r * 0.42, -e.r * 0.2, 0, -e.r * 0.95);
      ctx.closePath();
      ctx.fill();
      // 装甲刻线
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-e.r * 0.3, e.r * 0.15);
      ctx.lineTo(e.r * 0.3, e.r * 0.15);
      ctx.moveTo(-e.r * 0.24, e.r * 0.45);
      ctx.lineTo(e.r * 0.24, e.r * 0.45);
      ctx.stroke();
      // 前炮塔
      ctx.fillStyle = '#312E81';
      ctx.beginPath();
      ctx.arc(0, -e.r * 0.4, e.r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#C4B5FD';
      ctx.fillRect(-1, -e.r * 0.62, 2, e.r * 0.25);
      // 血条
      ctx.fillStyle = '#374151';
      ctx.fillRect(-e.r, -e.r - 8, e.r * 2, 4);
      ctx.fillStyle = '#A78BFA';
      ctx.fillRect(-e.r, -e.r - 8, e.r * 2 * (e.hp / e.maxhp), 4);
    } else {
      // BOSS 旗舰：配色随关卡轮换，狂暴红光 + 旋转炮塔 + 装甲甲板 + 核心
      const rage = e.hp <= e.maxhp * 0.5;
      const hue = (20 + this.levelIdx * 33) % 360;
      // hsl 转 hex（部分真机 webview 渐变解析不支持 hsl 函数色）
      const main = lit ? '#fff' : hslHex(hue, 75, 60);
      const dark = lit ? '#ddd' : hslHex(hue, 70, 32);
      if (rage) {
        ctx.fillStyle = 'rgba(244,63,94,' + (0.12 + 0.1 * Math.sin(e.t * 6)) + ')';
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 1.55, 0, Math.PI * 2);
        ctx.fill();
      }
      // 侧翼装甲板
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(-e.r * 1.25, -e.r * 0.18);
      ctx.lineTo(-e.r * 0.35, -e.r * 0.45);
      ctx.lineTo(-e.r * 0.35, e.r * 0.5);
      ctx.lineTo(-e.r * 1.05, e.r * 0.62);
      ctx.closePath();
      ctx.moveTo(e.r * 1.25, -e.r * 0.18);
      ctx.lineTo(e.r * 0.35, -e.r * 0.45);
      ctx.lineTo(e.r * 0.35, e.r * 0.5);
      ctx.lineTo(e.r * 1.05, e.r * 0.62);
      ctx.closePath();
      ctx.fill();
      // 翼尖炮塔（狂暴时随时间旋转）
      for (const sx of [-e.r * 1.0, e.r * 1.0]) {
        ctx.save();
        ctx.translate(sx, e.r * 0.15);
        ctx.rotate(rage ? Math.sin(e.t * 3) * 0.6 : 0);
        ctx.fillStyle = '#1F2937';
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(-1.5, 0, 3, e.r * 0.3);
        ctx.restore();
      }
      // 主体甲板（横向渐变）
      const g = ctx.createLinearGradient(-e.r, 0, e.r, 0);
      g.addColorStop(0, dark);
      g.addColorStop(0.5, main);
      g.addColorStop(1, dark);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, e.r, e.r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      // 甲板刻线
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-e.r * 0.6, -e.r * 0.25);
      ctx.lineTo(e.r * 0.6, -e.r * 0.25);
      ctx.moveTo(-e.r * 0.6, e.r * 0.25);
      ctx.lineTo(e.r * 0.6, e.r * 0.25);
      ctx.stroke();
      // 中央能量核心（脉动）
      const pr = 7 + (rage ? 2 : 0) + Math.sin(e.t * (rage ? 9 : 4)) * 2;
      const cg = ctx.createRadialGradient(0, -e.r * 0.1, 1, 0, -e.r * 0.1, pr + 4);
      cg.addColorStop(0, 'rgba(255,255,255,0.95)'); // 注意：小程序渐变不支持 #fff7 这类 4 位缩写色
      cg.addColorStop(0.4, rage ? '#F87171' : '#FDE68A');
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(0, -e.r * 0.1, pr + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rage ? '#FCA5A5' : '#FEF3C7';
      ctx.beginPath();
      ctx.arc(0, -e.r * 0.1, pr * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },
});
