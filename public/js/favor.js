/**
 * favor.js —— 好感度、连击与评级
 * 职责：维护单局好感度状态，提供 +/− 数值计算、连击加成、失败判断与评级映射。
 * 本模块不操作 DOM，也不播放音频，只做纯数值逻辑。
 */
(function (HMG) {
  'use strict';

  var CONFIG = window.GAME_CONFIG.favor;

  /**
   * 把数值限制在闭区间内。
   * @param {number} value 原值
   * @param {number} min 下限
   * @param {number} max 上限
   * @returns {number} 限制后的数值
   */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /**
   * 创建一局新的好感度状态。
   * @returns {{value:number, combo:number, maxCombo:number}} 初始状态
   */
  function createState() {
    return {
      value: CONFIG.initial,
      combo: 0,
      maxCombo: 0
    };
  }

  /**
   * 应用一次“正确消除”：连击 +1，连击达到阈值后收益 +1，好感度封顶。
   * @param {{value:number, combo:number, maxCombo:number}} state 好感度状态
   * @returns {{delta:number, combo:number, bonus:boolean}} 本次名义收益、当前连击、是否触发加成
   */
  function applyCorrect(state) {
    state.combo += 1;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    var bonus = state.combo >= CONFIG.comboThreshold;
    var delta = CONFIG.gainCorrect + (bonus ? CONFIG.comboBonus : 0);
    state.value = clamp(state.value + delta, CONFIG.min, CONFIG.max);
    return { delta: delta, combo: state.combo, bonus: bonus };
  }

  /**
   * 应用一次“漏办”：好感度下降，连击立即清零。
   * @param {{value:number, combo:number, maxCombo:number}} state 好感度状态
   * @returns {{delta:number, combo:number}} 本次名义扣分与清零后的连击
   */
  function applyMiss(state) {
    state.value = clamp(state.value - CONFIG.loseMiss, CONFIG.min, CONFIG.max);
    state.combo = 0;
    return { delta: CONFIG.loseMiss, combo: 0 };
  }

  /**
   * 应用一次“误伤”：好感度下降，连击立即清零。
   * @param {{value:number, combo:number, maxCombo:number}} state 好感度状态
   * @returns {{delta:number, combo:number}} 本次名义扣分与清零后的连击
   */
  function applyWrong(state) {
    state.value = clamp(state.value - CONFIG.loseWrong, CONFIG.min, CONFIG.max);
    state.combo = 0;
    return { delta: CONFIG.loseWrong, combo: 0 };
  }

  /**
   * 判断好感度是否已归零/跌破零（立即失败）。
   * @param {{value:number}} state 好感度状态
   * @returns {boolean} 是否失败
   */
  function isFailed(state) {
    return state.value <= CONFIG.min;
  }

  /**
   * 计算好感度进度比例，用于统计条迷你进度条。
   * @param {{value:number}} state 好感度状态
   * @returns {number} 0~1 的比例
   */
  function getRatio(state) {
    var span = CONFIG.max - CONFIG.min;
    if (span <= 0) {
      return 0;
    }
    return clamp((state.value - CONFIG.min) / span, 0, 1);
  }

  /**
   * 按好感度查评级（来自 config.rating）；0 或以下返回失败档 F。
   * @param {number} value 当前好感度
   * @returns {{grade:string, title:string}} 评级与称号
   */
  function getRating(value) {
    if (value <= 0) {
      return { grade: 'F', title: '房管不合格' };
    }
    var table = window.GAME_CONFIG.rating;
    for (var i = 0; i < table.length; i += 1) {
      if (value >= table[i].min) {
        return { grade: table[i].grade, title: table[i].title };
      }
    }
    return { grade: 'D', title: '初出茅庐' };
  }

  HMG.favor = {
    createState: createState,
    applyCorrect: applyCorrect,
    applyMiss: applyMiss,
    applyWrong: applyWrong,
    isFailed: isFailed,
    getRatio: getRatio,
    getRating: getRating
  };
})(window.HMG = window.HMG || {});
