// 学习小园地：三年级语文（阅读/生字）+ 英语单词 + 数学口算（附加）
// 题库本地内置（data.js），每轮随机抽 5 题，答对积分，积分按成员存本地
const { READ, WORD, ENG, MATH } = require('./data');
const { check } = require('../../utils/perms');

const MODULES = [
  { key: 'read', name: '语文 · 阅读理解', desc: '读一段话，选出它的意思', icon: '读', color: '#DB2777' },
  { key: 'word', name: '语文 · 生字学习', desc: '判断生字的组词对不对', icon: '字', color: '#B45309' },
  { key: 'eng', name: '英语 · 单词学习', desc: '中文选英文单词', icon: 'A', color: '#1D4ED8' },
  { key: 'math', name: '数学 · 口算练习', desc: '快速选出正确答案', icon: '算', color: '#0F6E56' },
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

Page({
  data: {
    view: 'home', // home | quiz | result
    modules: MODULES,
    totalScore: 0,
    // 答题中
    modName: '',
    qIndex: 0,
    qTotal: 5,
    qText: '',
    passage: '',
    options: [],
    picked: -1,   // 已选下标，-1 未选
    correctIdx: -1,
    right: 0,
    feedback: '',
  },

  onLoad() {
    check('study').then((r) => {
      if (!r.allowed) {
        wx.showToast({ title: '学习小园地已被管理员禁用', icon: 'none' });
        setTimeout(() => wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/games/games' }) }), 900);
      }
    });
  },

  onShow() {
    this.setData({ totalScore: wx.getStorageSync('study_score') || 0 });
  },

  start(e) {
    const key = e.currentTarget.dataset.key;
    const mod = MODULES.find((m) => m.key === key);
    const bank = { read: READ, word: WORD, eng: ENG, math: MATH }[key];
    this.questions = shuffle(bank).slice(0, 5);
    this.modKey = key;
    this.setData({
      view: 'quiz',
      modName: mod.name,
      qIndex: 0,
      right: 0,
    });
    this.renderQuestion();
  },

  renderQuestion() {
    const q = this.questions[this.data.qIndex];
    const base = { picked: -1, correctIdx: -1, feedback: '' };
    if (this.modKey === 'read') {
      Object.assign(base, { passage: q.t, qText: q.q, options: this.tag(shuffle(q.o.map((text, i) => ({ text, orig: i })))) });
      base.correctIdx = base.options.findIndex((o) => o.orig === q.a);
    } else if (this.modKey === 'word') {
      Object.assign(base, {
        passage: '',
        qText: '生字「' + q.c + '」组词「' + q.w + '」，对吗？',
        options: this.tag([{ text: '对' }, { text: '错' }], ['✓', '✗']),
        correctIdx: q.ok ? 0 : 1,
      });
      this.wordJudge = q;
    } else if (this.modKey === 'eng') {
      Object.assign(base, { passage: '', qText: '“' + q.c + '”用英语怎么说？', options: this.tag(shuffle(q.o.map((text, i) => ({ text, orig: i })))) });
      base.correctIdx = base.options.findIndex((o) => o.orig === q.a);
    } else {
      Object.assign(base, { passage: '', qText: q.q, options: this.tag(shuffle(q.o.map((text, i) => ({ text, orig: i })))) });
      base.correctIdx = base.options.findIndex((o) => o.orig === q.a);
    }
    this.setData(base);
  },

  // 给选项加 A/B/C/D（或自定义）标签
  tag(list, tags) {
    const T = tags || ['A', 'B', 'C', 'D'];
    return list.map((o, i) => Object.assign({}, o, { tag: T[i] || '' }));
  },

  pick(e) {
    if (this.data.picked >= 0) return; // 本题已作答
    const idx = Number(e.currentTarget.dataset.i);
    const isRight = idx === this.data.correctIdx;
    const q = this.modKey === 'word' ? this.wordJudge : this.questions[this.data.qIndex];
    const feedback = isRight
      ? '答对啦 +10' + (q.x ? '：' + q.x : '')
      : '答错了' + (q.x ? '：' + q.x : '正确答案是 ' + this.data.options[this.data.correctIdx].text);
    this.setData({
      picked: idx,
      right: this.data.right + (isRight ? 1 : 0),
      feedback,
    });
    if (isRight) {
      const s = (wx.getStorageSync('study_score') || 0) + 10;
      wx.setStorageSync('study_score', s);
      this.setData({ totalScore: s });
    }
    try { wx.vibrateShort({ type: isRight ? 'light' : 'heavy' }); } catch (err) {}
  },

  next() {
    if (this.data.qIndex + 1 >= this.questions.length) return this.finish();
    this.setData({ qIndex: this.data.qIndex + 1 });
    this.renderQuestion();
  },

  finish() {
    const r = this.data.right;
    const stars = r >= 5 ? '⭐⭐⭐' : r >= 3 ? '⭐⭐' : r >= 1 ? '⭐' : '继续加油';
    this.setData({ view: 'result', resultText: '答对 ' + r + ' / ' + this.questions.length + ' 题 ' + stars });
  },

  backHome() {
    this.setData({ view: 'home' });
  },

  retry() {
    this.start({ currentTarget: { dataset: { key: this.modKey } } });
  },
});
