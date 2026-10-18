/**
 * main.js —— 入口与流程调度
 * 职责：初始化各模块、校验数据、教程判定与存储、教程/结算弹窗、开局与重开、
 *       观众进入直播间的装饰消息、输入栏占位交互、页面可见性暂停。
 */
(function (HMG) {
  'use strict';

  var CONFIG = window.GAME_CONFIG;
  var COMMENTS = window.GAME_COMMENTS;
  var AUDIENCE = window.GAME_AUDIENCE;

  var dom = {};
  var started = false;
  var systemTimer = 0;

  /**
   * 按 id 获取 DOM 节点。
   * @param {string} id 元素 id
   * @returns {HTMLElement} 元素
   */
  function byId(id) {
    return document.getElementById(id);
  }

  /**
   * 缓存主流程需要的 DOM 节点。
   * @returns {void}
   */
  function cacheDom() {
    dom.tutorialModal = byId('tutorialModal');
    dom.resultModal = byId('resultModal');
    dom.startBtn = byId('startBtn');
    dom.restartBtn = byId('restartBtn');
    dom.followBtn = byId('followBtn');
    dom.chatForm = byId('chatForm');
    dom.chatInput = byId('chatInput');
    dom.resultGrade = byId('resultGrade');
    dom.resultTitle = byId('resultTitle');
    dom.resultSubtitle = byId('resultSubtitle');
    dom.resultEgg = byId('resultEgg');
    dom.resTotal = byId('resTotal');
    dom.resDone = byId('resDone');
    dom.resMiss = byId('resMiss');
    dom.resWrong = byId('resWrong');
    dom.resFavor = byId('resFavor');
  }

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
   * 从数组中随机取一条；空数组或非法输入返回空字符串。
   * @param {Array<string>} list 文案数组
   * @returns {string} 随机文案
   */
  function randomItem(list) {
    if (!Array.isArray(list) || list.length === 0) {
      return '';
    }
    return list[Math.floor(Math.random() * list.length)];
  }

  /**
   * 读取教程完成标记；localStorage 被禁用时降级为未看过。
   * @returns {boolean} 是否已看过教程
   */
  function hasSeenTutorial() {
    try {
      return window.localStorage.getItem(CONFIG.storageKey) === '1';
    } catch (error) {
      return false;
    }
  }

  /**
   * 写入教程完成标记；localStorage 被禁用时静默失败。
   * @returns {void}
   */
  function markTutorialSeen() {
    try {
      window.localStorage.setItem(CONFIG.storageKey, '1');
    } catch (error) {
      /* 隐私模式或被禁用时忽略，下次仍会显示教程。 */
    }
  }

  /**
   * 校验数据文件是否完整，并在控制台告警池数量/观众属性一致性问题。
   * @returns {void}
   */
  function validateData() {
    if (!window.GAME_CONFIG || !window.GAME_COMMENTS || !window.GAME_DANMAKU_POSITIVE ||
        !window.GAME_DANMAKU_NEGATIVE || !window.GAME_AUDIENCE) {
      console.warn('[HMG] 数据文件未完整加载，请检查 script 引入顺序。');
      return;
    }

    var positivePools = window.GAME_DANMAKU_POSITIVE.pools;
    var negativePools = window.GAME_DANMAKU_NEGATIVE.pools;
    var positiveTotal = positivePools.positive.length + positivePools.normal.length + positivePools.trap.length;
    if (positiveTotal < 200) {
      console.warn('[HMG] 正面弹幕库总量不足 200 条。');
    }
    if (negativePools.negative.length < 200) {
      console.warn('[HMG] 负面弹幕库不足 200 条。');
    }
    if (positivePools.positive.length < 30) {
      console.warn('[HMG] positive 池不足 30 条。');
    }
    if (positivePools.normal.length < 60) {
      console.warn('[HMG] normal 池不足 60 条。');
    }
    if (positivePools.trap.length < 15) {
      console.warn('[HMG] trap 池不足 15 条。');
    }
    if (window.GAME_AUDIENCE.audience.length < 200) {
      console.warn('[HMG] 观众表不足 200 条。');
    }

    window.GAME_AUDIENCE.audience.forEach(function (audience) {
      /* 舰长档位与布尔标记必须一致。 */
      if (audience.isCaptain) {
        if (audience.captainLevel < 1 || audience.captainLevel > 3) {
          console.warn('[HMG] 观众舰长档位异常：' + audience.name);
        }
      } else if (audience.captainLevel !== 0) {
        console.warn('[HMG] 非舰长的 captainLevel 应为 0：' + audience.name);
      }
      /* 未佩戴灯牌时，灯牌名与等级必须为空/0。 */
      if (audience.hasMedal) {
        if (!audience.medalName || audience.medalLevel < 1) {
          console.warn('[HMG] 灯牌数据异常：' + audience.name);
        }
      } else if (audience.medalName !== '' || audience.medalLevel !== 0) {
        console.warn('[HMG] 未佩戴灯牌却存在灯牌数据：' + audience.name);
      }
    });

    Object.keys(window.GAME_COMMENTS.success).forEach(function (grade) {
      /* 每个评级至少准备 3 条副标题。 */
      if (window.GAME_COMMENTS.success[grade].length < 3) {
        console.warn('[HMG] 评级 ' + grade + ' 的结算文案不足 3 条。');
      }
    });
    if (window.GAME_COMMENTS.fail.length < 3) {
      console.warn('[HMG] 失败结算文案不足 3 条。');
    }
    if (window.GAME_COMMENTS.easterEgg.length < 1) {
      console.warn('[HMG] 通关彩蛋池为空。');
    }
  }

  /**
   * 显示教程弹窗（首次访问，同时作为 GIF 加载遮罩）。
   * @returns {void}
   */
  function showTutorial() {
    dom.tutorialModal.hidden = false;
    dom.startBtn.focus();
  }

  /**
   * 开始/重开一局：关闭弹窗、启动 BGM、重置对局与输入框。
   * @returns {void}
   */
  function startGame() {
    dom.tutorialModal.hidden = true;
    dom.resultModal.hidden = true;
    started = true;
    HMG.audio.playBgm();
    HMG.game.start();
    dom.chatInput.value = '';
    scheduleSystemMessage();
  }

  /**
   * 教程「开始执勤」按钮：写入标记并进入对局。
   * @returns {void}
   */
  function handleStartClick() {
    markTutorialSeen();
    startGame();
  }

  /**
   * 结算弹窗「再来一次」：直接重开新局。
   * @returns {void}
   */
  function handleRestartClick() {
    startGame();
  }

  /**
   * 「关注」占位按钮：切换文案与样式，不影响游戏。
   * @returns {void}
   */
  function handleFollowClick() {
    var followed = dom.followBtn.classList.toggle('is-followed');
    dom.followBtn.textContent = followed ? '已关注' : '关注';
    dom.followBtn.setAttribute('aria-pressed', followed ? 'true' : 'false');
  }

  /**
   * 将玩家发送的内容以「(房管)我」名义追加到列表，不参与判定。
   * @param {SubmitEvent} event 表单提交事件
   * @returns {void}
   */
  function handleChatSubmit(event) {
    event.preventDefault();
    var text = dom.chatInput.value.trim();
    if (!text) {
      return;
    }
    HMG.uiPanel.appendSelf(text);
    dom.chatInput.value = '';
    dom.chatInput.focus();
  }

  /**
   * 弹幕气泡点击入口：交给游戏核心判定。
   * @param {number} id 弹幕 id
   * @returns {void}
   */
  function handleBubbleClick(id) {
    HMG.game.clickBubble(id);
  }

  /**
   * 渲染结算弹窗：评级、称号、随机副标题、五项统计、通关彩蛋。
   * @param {{success:boolean, grade:string, title:string, favor:number, stats:object}} result 结算数据
   * @returns {void}
   */
  function renderResult(result) {
    dom.resultGrade.className = 'result__grade result__grade--' + result.grade;
    dom.resultGrade.textContent = result.grade;
    dom.resultTitle.textContent = result.title;

    if (result.success) {
      var successPool = COMMENTS.success[result.grade] || COMMENTS.success.D;
      dom.resultSubtitle.textContent = randomItem(successPool);
    } else {
      dom.resultSubtitle.textContent = randomItem(COMMENTS.fail);
    }

    dom.resTotal.textContent = String(result.stats.total);
    dom.resDone.textContent = String(result.stats.done);
    dom.resMiss.textContent = String(result.stats.miss);
    dom.resWrong.textContent = String(result.stats.wrong);
    dom.resFavor.textContent = String(result.favor);

    if (result.success) {
      dom.resultEgg.hidden = false;
      dom.resultEgg.textContent = randomItem(COMMENTS.easterEgg);
    } else {
      dom.resultEgg.hidden = true;
      dom.resultEgg.textContent = '';
    }

    dom.resultModal.hidden = false;
    dom.restartBtn.focus();
  }

  /**
   * 对局结束回调：打开结算弹窗。
   * @param {object} result 结算数据
   * @returns {void}
   */
  function handleGameEnd(result) {
    renderResult(result);
  }

  /**
   * 安排下一条「观众进入直播间」装饰消息（20~40 秒随机）。
   * @returns {void}
   */
  function scheduleSystemMessage() {
    window.clearTimeout(systemTimer);
    /* 随机延时的回调：插入装饰消息后继续安排下一条。 */
    systemTimer = window.setTimeout(function () {
      /* 到点插入一条装饰消息，并继续安排下一次。 */
      appendRandomSystemMessage();
      scheduleSystemMessage();
    }, randomBetween(20000, 40000));
  }

  /**
   * 随机挑一名观众昵称，追加一条灰色系统消息。
   * @returns {void}
   */
  function appendRandomSystemMessage() {
    if (!started || document.hidden) {
      return;
    }
    var list = AUDIENCE.audience;
    if (!list.length) {
      return;
    }
    var audience = list[Math.floor(Math.random() * list.length)];
    HMG.uiPanel.appendSystem(audience.name + ' 进入直播间');
  }

  /**
   * 页面可见性变化：隐藏时暂停对局与 BGM，恢复时继续。
   * @returns {void}
   */
  function handleVisibilityChange() {
    if (document.hidden) {
      HMG.game.pause();
      HMG.audio.pauseBgm();
    } else {
      HMG.game.resume();
      HMG.audio.resumeBgm();
    }
  }

  /**
   * 绑定所有主流程事件。
   * @returns {void}
   */
  function bindEvents() {
    dom.startBtn.addEventListener('click', handleStartClick);
    dom.restartBtn.addEventListener('click', handleRestartClick);
    dom.followBtn.addEventListener('click', handleFollowClick);
    dom.chatForm.addEventListener('submit', handleChatSubmit);
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  /**
   * 初始化入口：缓存节点、校验数据、初始化模块、决定教程或直接开局。
   * @returns {void}
   */
  function init() {
    cacheDom();
    validateData();
    HMG.audio.init();
    HMG.uiLive.init();
    HMG.uiPanel.init({ onBubbleClick: handleBubbleClick });
    HMG.game.init({ onEnd: handleGameEnd });
    bindEvents();

    if (hasSeenTutorial()) {
      startGame();
    } else {
      showTutorial();
    }
  }

  init();
})(window.HMG = window.HMG || {});
