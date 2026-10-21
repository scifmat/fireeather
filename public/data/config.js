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
  bgmTracks: [
    { id: "1", label: "正常", src: "./public/audio/bgm_1.mp3" },
    { id: "2", label: "魔性", src: "./public/audio/bgm_2.wav" },
    { id: "3", label: "洗脑", src: "./public/audio/bgm_3.wav" }
  ],
  defaultBgm: "1",
  skins: [
    { id: "1", label: "皮套一", src: "./public/images/home_screen_1.gif", backdrop: "./public/images/home_screen_1_bg.webp" },
    { id: "2", label: "皮套二", src: "./public/images/home_screen_2.gif", backdrop: "./public/images/home_screen_2_bg.webp" },
    { id: "3", label: "皮套三", src: "./public/images/home_screen_3.gif", backdrop: "./public/images/home_screen_3_bg.webp" }
  ],
  defaultSkin: "2",
  roach: {
    roundCount: 3,
    triggerRanges: [
      { from: 15, to: 22 },
      { from: 42, to: 50 },
      { from: 70, to: 78 }
    ],
    bossSpawnDelayMs: 350,
    gruntSpawnDelaysMs: [1150, 1950, 2750, 3550],
    /* 头领与小强同速，配合出生间隔保持队形；最后一只约 9.55s 离场 */
    bossDurationMs: 6000,
    gruntDurationMs: 6000,
    /* 队列最小间距 = 入侵区宽度 × 该比例（不小于 10px） */
    minGapRatio: 0.02,
    killGain: 1,
    escapePenalty: 0.5,
    dieLingerMs: 420,
    zoneFadeMs: 320,
    sprites: {
      bossWalk: "./public/images/roach/cockroach_boss_walk.gif",
      bossDie: "./public/images/roach/cockroach_boss_die.png",
      gruntWalk: "./public/images/roach/roach_grunt_walk.gif",
      gruntDie: "./public/images/roach/roach_grunt_die.png",
      slipperHover: "./public/images/roach/slippers_hover.gif",
      slipperPress: "./public/images/roach/Slippers_press.png"
    },
    audio: {
      whistle: "./public/audio/roach/whistle.wav",
      drumbeat: "./public/audio/roach/drumbeat.wav",
      footsteps: "./public/audio/roach/cockroach_footsteps.wav",
      snap: "./public/audio/roach/snap.wav",
      whistleVolume: 0.8,
      loopVolume: 0.35,
      snapVolume: 0.75
    }
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
