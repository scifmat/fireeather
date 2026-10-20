/**
 * game.js —— 对局核心
 * 职责：每局抽样组局、按时间轴生成弹幕、维护 2 秒判定窗口、同步弹幕机、
 *       统计与好感度联动、暂停/恢复、胜负结算。DOM 细节交给 ui-live / ui-panel。
 */
(function (HMG) {
  'use strict';

  var CONFIG = window.GAME_CONFIG;
  var POSITIVE = window.GAME_DANMAKU_POSITIVE;
  var NEGATIVE = window.GAME_DANMAKU_NEGATIVE;
  var AUDIENCE = window.GAME_AUDIENCE;

  /* 各阶段非负面弹幕中“应援”的参考占比（§6.6 建议 25% / 12% / 5%） */
  var POSITIVE_RATE_BY_PHASE = [0.25, 0.12, 0.05];

  var callbacks = { onEnd: null };
  var state = null;
  var rafId = 0;

  /**
   * 生成 [min, max) 区间内的随机浮点数。
   * @param {number} min 最小值
   * @param {number} max 最大值
   * @returns {number} 随机数
   */
  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  /**
   * 生成 [min, max] 闭区间内的随机整数。
   * @param {number} min 最小值
   * @param {number} max 最大值
   * @returns {number} 随机整数
   */
  function randomInt(min, max) {
    return Math.floor(randomBetween(min, max + 1));
  }

  /**
   * 返回数组的洗牌副本（Fisher–Yates），不修改原数组。
   * @param {Array} list 原数组
   * @returns {Array} 洗牌后的新数组
   */
  function shuffleArray(list) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  /**
   * 根据 1 起算的弹幕序号查找所属阶段序号。
   * @param {number} index 弹幕序号（1~100）
   * @returns {number} 阶段序号（1/2/3）
   */
  function getPhaseNumber(index) {
    for (var i = 0; i < CONFIG.phases.length; i += 1) {
      var phase = CONFIG.phases[i];
      if (index >= phase.from && index <= phase.to) {
        return i + 1;
      }
    }
    return CONFIG.phases.length;
  }

  /**
   * 从已洗牌的池游标处取指定数量的内容，保证同局内不重复；
   * 防御性地在池耗尽时回绕并告警（正常数据量不会触发）。
   * @param {{items:string[], index:number, label:string}} pool 池游标对象
   * @param {number} count 需要取出的数量
   * @returns {string[]} 抽出的内容
   */
  function takeFromPool(pool, count) {
    var result = [];
    for (var i = 0; i < count; i += 1) {
      if (pool.index >= pool.items.length) {
        pool.index = 0;
        console.warn('[HMG] 弹幕池数量不足，已回绕使用：' + pool.label);
      }
      result.push(pool.items[pool.index]);
      pool.index += 1;
    }
    return result;
  }

  /**
   * 按弹幕类型计算观众权重：负面偏向无舰长/无灯牌的路人，其余偏向老粉。
   * 公开 V 圈昵称只参与非负面弹幕组合，避免把虚构黑粉发言绑定到真人 ID 上。
   * @param {{isCaptain:boolean, hasMedal:boolean, isGuestVtuber?:boolean}} audience 观众对象
   * @param {string} type 弹幕类型
   * @returns {number} 抽取权重；0 表示该类型下不参与抽取
   */
  function getAudienceWeight(audience, type) {
    if (audience.isGuestVtuber) {
      return type === 'negative' ? 0 : 2.4;
    }
    var isVeteran = audience.isCaptain || audience.hasMedal;
    if (type === 'negative') {
      return isVeteran ? 0.6 : 3;
    }
    return isVeteran ? 3 : 0.8;
  }

  /**
   * 随机抽取一名观众，并保证同一观众不会连续出现 3 条。
   * @param {string} type 弹幕类型
   * @param {number[]} recentIds 最近两条弹幕的观众 id（最多两个）
   * @returns {object} 选中的观众对象
   */
  function pickAudience(type, recentIds) {
    var list = AUDIENCE.audience;
    var candidates = [];
    var blockedId = recentIds.length === 2 && recentIds[0] === recentIds[1] ? recentIds[0] : -1;
    var totalWeight = 0;

    for (var i = 0; i < list.length; i += 1) {
      var audience = list[i];
      if (audience.id === blockedId) {
        continue;
      }
      var weight = getAudienceWeight(audience, type);
      if (weight <= 0) {
        continue;
      }
      candidates.push({ audience: audience, weight: weight });
      totalWeight += weight;
    }

    if (!candidates.length) {
      return list[Math.floor(Math.random() * list.length)];
    }

    var roll = Math.random() * totalWeight;
    for (var j = 0; j < candidates.length; j += 1) {
      roll -= candidates[j].weight;
      if (roll <= 0) {
        return candidates[j].audience;
      }
    }
    return candidates[candidates.length - 1].audience;
  }

  /**
   * 按 §6.6 抽样：分阶段抽取负面/陷阱/应援/普通，阶段内乱序，再组装 100 条时间轴。
   * 每条弹幕绑定随机观众；单局内容不重复。
   * @returns {Array<object>} 本局有序弹幕数组
   */
  function buildTimeline() {
    var pools = {
      negative: { items: shuffleArray(NEGATIVE.pools.negative), index: 0, label: 'negative' },
      positive: { items: shuffleArray(POSITIVE.pools.positive), index: 0, label: 'positive' },
      normal: { items: shuffleArray(POSITIVE.pools.normal), index: 0, label: 'normal' },
      trap: { items: shuffleArray(POSITIVE.pools.trap), index: 0, label: 'trap' }
    };

    var timeline = [];

    /* 逐个阶段抽样：先按占比分配名额，再从各内容池取用。 */
    CONFIG.phases.forEach(function (phase, phaseIndex) {
      var phaseNumber = phaseIndex + 1;
      var phaseSize = phase.to - phase.from + 1;
      var negativeCount = Math.round(phaseSize * phase.negativeRate);
      var nonNegativeCount = phaseSize - negativeCount;
      var positiveRate = POSITIVE_RATE_BY_PHASE[phaseIndex];
      if (typeof positiveRate !== 'number') {
        positiveRate = POSITIVE_RATE_BY_PHASE[POSITIVE_RATE_BY_PHASE.length - 1];
      }

      var trapCount = Math.round(nonNegativeCount * randomBetween(0.12, 0.18));
      var positiveCount = Math.round(nonNegativeCount * positiveRate);
      if (trapCount + positiveCount > nonNegativeCount) {
        trapCount = Math.max(0, nonNegativeCount - positiveCount);
      }
      var normalCount = nonNegativeCount - trapCount - positiveCount;

      var phaseItems = [];

      /* 取本阶段负面内容，并记录所属阶段。 */
      takeFromPool(pools.negative, negativeCount).forEach(function (content) {
        phaseItems.push({ content: content, type: 'negative', phase: phaseNumber });
      });
      /* 取本阶段应援内容。 */
      takeFromPool(pools.positive, positiveCount).forEach(function (content) {
        phaseItems.push({ content: content, type: 'positive', phase: phaseNumber });
      });
      /* 取本阶段陷阱内容。 */
      takeFromPool(pools.trap, trapCount).forEach(function (content) {
        phaseItems.push({ content: content, type: 'trap', phase: phaseNumber });
      });
      /* 剩余名额用普通弹幕补足。 */
      takeFromPool(pools.normal, normalCount).forEach(function (content) {
        phaseItems.push({ content: content, type: 'normal', phase: phaseNumber });
      });

      /* 阶段内部随机打乱，阶段之间保持先后顺序。 */
      timeline = timeline.concat(shuffleArray(phaseItems));
    });

    /* 按最终时间轴绑定观众，并限制同一观众最多连续出现两条。 */
    var recentIds = [];
    timeline.forEach(function (item, index) {
      item.id = index + 1;
      item.audience = pickAudience(item.type, recentIds);
      recentIds.push(item.audience.id);
      if (recentIds.length > 2) {
        recentIds.shift();
      }
    });

    return timeline;
  }

  /**
   * 计算下一条弹幕的生成延迟，按序号所属阶段取基础值与抖动。
   * @param {number} nextIndex 下一条弹幕的 0 基索引
   * @returns {number} 延迟毫秒数
   */
  function getSpawnDelay(nextIndex) {
    var phaseNumber = getPhaseNumber(nextIndex + 1);
    var spawn = CONFIG.spawn[phaseNumber - 1] || CONFIG.spawn[0];
    var delay = spawn.intervalMs + (Math.random() * 2 - 1) * spawn.jitterMs;
    return Math.max(300, delay);
  }

  /**
   * 组装当前统计视图，供 ui-live 渲染。
   * @returns {{total:number, done:number, miss:number, wrong:number, favor:number, favorMax:number}} 统计视图
   */
  function getStatsView() {
    return {
      total: state.stats.total,
      done: state.stats.done,
      miss: state.stats.miss,
      wrong: state.stats.wrong,
      favor: state.favor.value,
      favorMax: CONFIG.favor.max
    };
  }

  /**
   * 停止当前动画帧循环。
   * @returns {void}
   */
  function stopLoop() {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  /**
   * 生成本局三轮蟑螂入侵的触发弹幕数（在 config 的区间内随机，互不重叠）。
   * @returns {number[]} 三轮触发的弹幕总数
   */
  function buildRoachTargets() {
    var roachConfig = CONFIG.roach;
    if (!roachConfig || !Array.isArray(roachConfig.triggerRanges)) {
      return [];
    }
    var count = roachConfig.roundCount || roachConfig.triggerRanges.length;
    /* 为每一轮在配置区间内独立取一个触发弹幕数。 */
    return roachConfig.triggerRanges.slice(0, count).map(function (range) {
      return randomInt(range.from, range.to);
    });
  }

  /**
   * 在合适的进度检查并启动下一轮蟑螂入侵；同一时间只允许一轮。
   * @returns {void}
   */
  function maybeStartRoachRound() {
    if (!state || !state.playing || state.paused) {
      return;
    }
    if (state.processed >= state.timeline.length) {
      return;
    }
    if (HMG.roach.isActive()) {
      return;
    }
    if (!state.roachTargets || state.roachRound >= state.roachTargets.length) {
      return;
    }
    if (state.stats.total < state.roachTargets[state.roachRound]) {
      return;
    }
    state.roachRound += 1;
    var started = HMG.roach.startRound(state.roachRound);
    if (!started) {
      state.roachRound -= 1;
    }
  }

  /**
   * 拍死蟑螂的即时结算：好感度 +1，刷新统计并弹出飘字。
   * @returns {void}
   */
  function handleRoachKill() {
    if (!state || !state.playing) {
      return;
    }
    var result = HMG.favor.applyRoachKill(state.favor);
    HMG.uiLive.updateStats(getStatsView());
    HMG.uiLive.showDelta(result.delta);
  }

  /**
   * 单轮蟑螂入侵结束：统一结算逃跑惩罚，并检查失败/通关/下一轮。
   * @param {number} escapedCount 本轮逃跑的蟑螂数量
   * @returns {void}
   */
  function handleRoachRoundEnd(escapedCount) {
    if (!state || !state.playing) {
      return;
    }
    if (escapedCount > 0) {
      var result = HMG.favor.applyRoachEscapes(state.favor, escapedCount);
      HMG.uiLive.showDelta(result.delta);
    }
    HMG.uiLive.updateStats(getStatsView());

    if (HMG.favor.isFailed(state.favor)) {
      finish(false);
      return;
    }
    if (state.pendingFinish) {
      finish(true);
      return;
    }
    maybeStartRoachRound();
  }

  /**
   * 检查 100 条弹幕是否全部走完；若蟑螂入侵还在进行，则延后到本轮结束后结算。
   * @returns {void}
   */
  function checkGameCompletion() {
    if (!state || !state.playing) {
      return;
    }
    if (state.processed < state.timeline.length) {
      return;
    }
    if (HMG.roach.isActive()) {
      state.pendingFinish = true;
      return;
    }
    finish(true);
  }

  /**
   * 创建一条运行时弹幕，绑定 DOM 气泡并加入待判定队列。
   * @param {{id:number, content:string, type:string, phase:number, audience:object}} data 时间轴数据
   * @returns {void}
   */
  function spawnEntry(data) {
    var entry = {
      data: data,
      id: data.id,
      el: HMG.uiPanel.createBubble(data),
      spawnAt: state.activeTime,
      syncAt: state.activeTime + CONFIG.flow.clickWindowMs,
      handled: false,
      synced: false
    };
    state.pending.push(entry);
    state.stats.total += 1;
    HMG.uiLive.updateStats(getStatsView());
    maybeStartRoachRound();
  }

  /**
   * 处理所有已到 2 秒同步时间的弹幕，并检查失败/通关。
   * @returns {void}
   */
  function syncDueEntries() {
    for (var i = state.pending.length - 1; i >= 0; i -= 1) {
      var entry = state.pending[i];
      if (state.activeTime >= entry.syncAt) {
        state.pending.splice(i, 1);
        syncEntry(entry);
        if (!state || !state.playing) {
          return;
        }
      }
    }
  }

  /**
   * 执行单条弹幕的同步：负面记漏办并上红字，其余灰化并正常上屏。
   * @param {object} entry 运行时弹幕对象
   * @returns {void}
   */
  function syncEntry(entry) {
    entry.synced = true;
    state.processed += 1;

    if (entry.data.type === 'negative') {
      var missResult = HMG.favor.applyMiss(state.favor);
      state.stats.miss += 1;
      HMG.uiPanel.markMissed(entry.el);
      HMG.uiPanel.updateCombo(0);
      HMG.uiLive.pushMachine(entry.data, true);
      HMG.uiLive.showDelta(-missResult.delta);
    } else {
      HMG.uiPanel.markSynced(entry.el);
      HMG.uiLive.pushMachine(entry.data, false);
    }

    HMG.uiLive.updateStats(getStatsView());

    if (HMG.favor.isFailed(state.favor)) {
      finish(false);
      return;
    }
    checkGameCompletion();
  }

  /**
   * 生成所有已到生成时间的弹幕；每次生成后按下一序号重新设定下次时间。
   * @returns {void}
   */
  function spawnDueEntries() {
    while (
      state.playing &&
      state.nextIndex < state.timeline.length &&
      state.activeTime >= state.nextSpawnAt
    ) {
      spawnEntry(state.timeline[state.nextIndex]);
      state.nextIndex += 1;
      if (state.nextIndex < state.timeline.length) {
        state.nextSpawnAt = state.activeTime + getSpawnDelay(state.nextIndex);
      }
    }
  }

  /**
   * 主循环：推进活动时间、生成弹幕、处理同步；暂停或结束后不再续帧。
   * @param {number} timestamp requestAnimationFrame 时间戳
   * @returns {void}
   */
  function loop(timestamp) {
    rafId = 0;
    if (!state || !state.playing || state.paused) {
      return;
    }

    var delta = timestamp - state.lastFrame;
    state.lastFrame = timestamp;
    if (!isFinite(delta) || delta < 0) {
      delta = 0;
    }
    /* 防止长时间掉帧造成时间跳跃，单帧最多推进 250ms。 */
    if (delta > 250) {
      delta = 250;
    }
    state.activeTime += delta;

    spawnDueEntries();
    if (state.playing) {
      syncDueEntries();
    }
    if (state && state.playing) {
      rafId = window.requestAnimationFrame(loop);
    }
  }

  /**
   * 在 pending 队列中按弹幕 id 查找索引。
   * @param {number} id 弹幕 id
   * @returns {number} 索引，未找到为 -1
   */
  function findPendingIndex(id) {
    for (var i = 0; i < state.pending.length; i += 1) {
      if (state.pending[i].id === id) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 处理玩家点击：仅 pending 且在 2 秒窗口内生效；负面加好感，其余误伤。
   * @param {number} id 弹幕 id
   * @returns {boolean} 是否产生判定
   */
  function clickBubble(id) {
    if (!state || !state.playing || state.paused) {
      return false;
    }

    var index = findPendingIndex(id);
    if (index < 0) {
      return false;
    }
    var entry = state.pending[index];
    if (entry.handled || entry.synced) {
      return false;
    }
    if (state.activeTime >= entry.syncAt) {
      /* 窗口已过：不响应、不惩罚，交给主循环同步。 */
      return false;
    }

    entry.handled = true;
    state.pending.splice(index, 1);
    state.processed += 1;

    if (entry.data.type === 'negative') {
      var correctResult = HMG.favor.applyCorrect(state.favor);
      state.stats.done += 1;
      HMG.uiPanel.markCorrect(entry.el);
      HMG.uiPanel.updateCombo(state.favor.combo);
      HMG.uiLive.showDelta(correctResult.delta);
      HMG.audio.playCorrect();
    } else {
      var wrongResult = HMG.favor.applyWrong(state.favor);
      state.stats.wrong += 1;
      HMG.uiPanel.markWrong(entry.el);
      HMG.uiPanel.updateCombo(0);
      HMG.uiLive.showDelta(-wrongResult.delta);
      HMG.audio.playWrong();
    }

    HMG.uiLive.updateStats(getStatsView());

    if (HMG.favor.isFailed(state.favor)) {
      finish(false);
    } else {
      checkGameCompletion();
    }
    return true;
  }

  /**
   * 结束对局：停止循环、冻结状态并回调结算信息。
   * @param {boolean} success 是否通关
   * @returns {void}
   */
  function finish(success) {
    if (!state || !state.playing) {
      return;
    }
    state.playing = false;
    state.paused = false;
    stopLoop();
    HMG.roach.stop();
    HMG.uiPanel.hideCombo();
    HMG.uiLive.updateStats(getStatsView());

    var rating = success
      ? HMG.favor.getRating(state.favor.value)
      : { grade: 'F', title: '房管不合格' };

    var result = {
      success: success,
      grade: rating.grade,
      title: rating.title,
      favor: state.favor.value,
      stats: {
        total: state.stats.total,
        done: state.stats.done,
        miss: state.stats.miss,
        wrong: state.stats.wrong
      }
    };

    if (typeof callbacks.onEnd === 'function') {
      callbacks.onEnd(result);
    }
  }

  /**
   * 开始新一局：重置全部状态、重新抽样、清空 DOM 并启动主循环。
   * @returns {void}
   */
  function start() {
    stopLoop();
    HMG.roach.reset();

    var timeline = buildTimeline();
    state = {
      playing: true,
      paused: false,
      activeTime: 0,
      lastFrame: window.performance.now(),
      nextSpawnAt: 350,
      nextIndex: 0,
      timeline: timeline,
      pending: [],
      processed: 0,
      stats: { total: 0, done: 0, miss: 0, wrong: 0 },
      favor: HMG.favor.createState(),
      roachTargets: buildRoachTargets(),
      roachRound: 0,
      pendingFinish: false
    };

    HMG.uiPanel.reset();
    HMG.uiLive.resetMachine();
    HMG.uiLive.updateStats(getStatsView());
    rafId = window.requestAnimationFrame(loop);
  }

  /**
   * 暂停对局（页面隐藏时调用）：冻结生成与所有判定窗口。
   * @returns {void}
   */
  function pause() {
    if (!state || !state.playing || state.paused) {
      return;
    }
    state.paused = true;
    stopLoop();
    HMG.roach.pause();
  }

  /**
   * 恢复对局（页面重新可见时调用）：从当前活动时间继续。
   * @returns {void}
   */
  function resume() {
    if (!state || !state.playing || !state.paused) {
      return;
    }
    state.paused = false;
    state.lastFrame = window.performance.now();
    HMG.roach.resume();
    rafId = window.requestAnimationFrame(loop);
  }

  /**
   * 查询对局是否正在进行（主流程用于系统消息等装饰逻辑）。
   * @returns {boolean} 是否正在对局
   */
  function isPlaying() {
    return !!(state && state.playing);
  }

  /**
   * 初始化核心模块，注册结算回调。
   * @param {{onEnd:Function}} options 外部回调
   * @returns {void}
   */
  function init(options) {
    if (options && typeof options.onEnd === 'function') {
      callbacks.onEnd = options.onEnd;
    }
    HMG.roach.init({
      onKill: handleRoachKill,
      onRoundEnd: handleRoachRoundEnd
    });
  }

  HMG.game = {
    init: init,
    start: start,
    pause: pause,
    resume: resume,
    clickBubble: clickBubble,
    isPlaying: isPlaying
  };
})(window.HMG = window.HMG || {});
