/**
 * config.js —— 数值与流程配置
 * 通过 window.GAME_CONFIG 注入，供各逻辑模块读取。
 * 说明：本文件不包含函数，仅提供纯数据；spawn 与 phases 按下标一一对应。
 */
window.GAME_CONFIG = {
  favor: {
    initial: 50,
    max: 100,
    min: 0,
    gainCorrect: 3,
    comboBonus: 1,
    comboThreshold: 5,
    loseMiss: 8,
    loseWrong: 5
  },
  flow: {
    totalDanmaku: 100,
    clickWindowMs: 2000
  },
  spawn: [
    { intervalMs: 2800, jitterMs: 800 },
    { intervalMs: 2800, jitterMs: 800 },
    { intervalMs: 2400, jitterMs: 600 }
  ],
  phases: [
    { from: 1, to: 30, negativeRate: 0.15 },
    { from: 31, to: 70, negativeRate: 0.28 },
    { from: 71, to: 100, negativeRate: 0.35 }
  ],
  audio: {
    bgmVolume: 0.35,
    sfxVolume: 0.8
  },
  storageKey: "hinome_mod_seen_v1",
  rating: [
    { min: 95, grade: "SSS", title: "奇迹之夜" },
    { min: 85, grade: "S", title: "金牌房管" },
    { min: 70, grade: "A", title: "信赖之壁" },
    { min: 55, grade: "B", title: "合格房管" },
    { min: 40, grade: "C", title: "勉强合格" },
    { min: 1, grade: "D", title: "初出茅庐" }
  ]
};
