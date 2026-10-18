/**
 * ui-panel.js —— 右栏渲染
 * 职责：弹幕列表气泡创建与各状态标记、连击浮层、系统消息、玩家自发弹幕。
 * 本模块只负责 DOM 与视觉状态，判定与计时由 game.js 驱动。
 */
(function (HMG) {
  'use strict';

  var CONFIG = window.GAME_CONFIG;
  var dom = {};
  var onBubbleClick = null;

  /**
   * 缓存本模块需要的 DOM 节点。
   * @returns {void}
   */
  function cacheDom() {
    dom.list = document.getElementById('chatList');
    dom.comboHint = document.getElementById('comboHint');
  }

  /**
   * 把弹幕列表滚动到底部，保证新弹幕始终可见（吸底策略）。
   * @returns {void}
   */
  function scrollToBottom() {
    dom.list.scrollTop = dom.list.scrollHeight;
  }

  /**
   * 列表点击委托：只把 pending 气泡交给游戏判定，其余状态静默忽略。
   * @param {MouseEvent} event 点击事件
   * @returns {void}
   */
  function handleListClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') {
      return;
    }
    var item = target.closest('.chat-item');
    if (!item || !dom.list.contains(item)) {
      return;
    }
    if (item.dataset.state !== 'pending') {
      return;
    }
    var id = Number(item.dataset.dmId);
    if (!id) {
      return;
    }
    if (typeof onBubbleClick === 'function') {
      onBubbleClick(id, item);
    }
  }

  /**
   * 创建一条可操作的弹幕气泡并追加到列表底部。
   * @param {{id:number, content:string, audience:{name:string}}} data 弹幕数据
   * @returns {HTMLElement} 创建出的气泡节点
   */
  function createBubble(data) {
    var item = document.createElement('div');
    item.className = 'chat-item chat-item--pending';
    item.dataset.dmId = String(data.id);
    item.dataset.state = 'pending';

    var name = document.createElement('span');
    name.className = 'chat-item__name';
    name.textContent = data.audience.name + '：';

    var text = document.createElement('span');
    text.className = 'chat-item__text';
    text.textContent = data.content;

    item.appendChild(name);
    item.appendChild(text);
    dom.list.appendChild(item);
    scrollToBottom();
    return item;
  }

  /**
   * 给气泡添加状态角标（✓ / ✗ / 漏）。
   * @param {HTMLElement} item 气泡节点
   * @param {string} symbol 角标文字
   * @param {string} kind 角标类型：ok / wrong / miss
   * @returns {void}
   */
  function appendBadge(item, symbol, kind) {
    if (!item || item.querySelector('.chat-badge')) {
      return;
    }
    var badge = document.createElement('span');
    badge.className = 'chat-badge chat-badge--' + kind;
    badge.textContent = symbol;
    badge.setAttribute('aria-hidden', 'true');
    item.appendChild(badge);
  }

  /**
   * 移除节点；若节点已被重开清空则直接跳过。
   * @param {HTMLElement} item 气泡节点
   * @returns {void}
   */
  function detachBubble(item) {
    if (item && item.parentNode) {
      item.parentNode.removeChild(item);
    }
  }

  /**
   * 给气泡添加淡出动画，动画结束后移除 DOM。
   * @param {HTMLElement} item 气泡节点
   * @returns {void}
   */
  function fadeBubble(item) {
    if (!item || !item.parentNode) {
      return;
    }
    item.classList.add('is-removing');
    /* 淡出结束后的回调：从 DOM 中移除该气泡。 */
    window.setTimeout(function () {
      /* 淡出动画结束后移除节点，避免 DOM 持续膨胀。 */
      detachBubble(item);
    }, 260);
  }

  /**
   * 在指定延迟后开始淡出并移除气泡（点击消除专用）。
   * @param {HTMLElement} item 气泡节点
   * @param {number} delay 延迟毫秒数
   * @returns {void}
   */
  function scheduleRemove(item, delay) {
    /* 延迟到达后的回调：开始淡出。 */
    window.setTimeout(function () {
      /* 约 400ms 的变色展示结束后开始淡出。 */
      fadeBubble(item);
    }, delay);
  }

  /**
   * 标记为“正确消除”：绿底 + ✓，约 400ms 后淡出移除。
   * @param {HTMLElement} item 气泡节点
   * @returns {void}
   */
  function markCorrect(item) {
    if (!item) {
      return;
    }
    item.dataset.state = 'done';
    item.classList.remove('chat-item--pending');
    item.classList.add('chat-item--ok');
    appendBadge(item, '✓', 'ok');
    scheduleRemove(item, 400);
  }

  /**
   * 标记为“误伤”：红底 + ✗ + 抖动，约 400ms 后淡出移除。
   * @param {HTMLElement} item 气泡节点
   * @returns {void}
   */
  function markWrong(item) {
    if (!item) {
      return;
    }
    item.dataset.state = 'wrong';
    item.classList.remove('chat-item--pending');
    item.classList.add('chat-item--wrong');
    appendBadge(item, '✗', 'wrong');
    scheduleRemove(item, 400);
  }

  /**
   * 标记为“漏办”：红底 + 左上角「漏」，保留不消失。
   * @param {HTMLElement} item 气泡节点
   * @returns {void}
   */
  function markMissed(item) {
    if (!item) {
      return;
    }
    item.dataset.state = 'missed';
    item.classList.remove('chat-item--pending');
    item.classList.add('chat-item--miss');
    appendBadge(item, '漏', 'miss');
  }

  /**
   * 标记为“正常同步”：灰化 45% 透明度并禁止点击。
   * @param {HTMLElement} item 气泡节点
   * @returns {void}
   */
  function markSynced(item) {
    if (!item) {
      return;
    }
    item.dataset.state = 'synced';
    item.classList.remove('chat-item--pending');
    item.classList.add('chat-item--synced');
  }

  /**
   * 在列表底部追加一条灰色系统消息（观众进入直播间）。
   * @param {string} text 消息文本
   * @returns {void}
   */
  function appendSystem(text) {
    var line = document.createElement('div');
    line.className = 'chat-system';
    line.textContent = text;
    dom.list.appendChild(line);
    scrollToBottom();
  }

  /**
   * 追加玩家自己发送的弹幕，不参与判定与统计。
   * @param {string} text 弹幕内容
   * @returns {void}
   */
  function appendSelf(text) {
    var item = document.createElement('div');
    item.className = 'chat-item chat-item--self';

    var name = document.createElement('span');
    name.className = 'chat-item__name';
    name.textContent = '(房管)我：';

    var content = document.createElement('span');
    content.className = 'chat-item__text';
    content.textContent = text;

    item.appendChild(name);
    item.appendChild(content);
    dom.list.appendChild(item);
    scrollToBottom();
  }

  /**
   * 更新连击浮层：连击 ≥5 才显示，并轻微放大跳动。
   * @param {number} combo 当前连击数
   * @returns {void}
   */
  function updateCombo(combo) {
    if (combo >= CONFIG.favor.comboThreshold) {
      dom.comboHint.textContent = '连击 x' + combo;
      dom.comboHint.classList.add('is-visible');
      dom.comboHint.setAttribute('aria-hidden', 'false');
      dom.comboHint.classList.remove('is-pop');
      /* 读取 offsetWidth 强制回流，保证连续命中时跳动动画重复触发。 */
      void dom.comboHint.offsetWidth;
      dom.comboHint.classList.add('is-pop');
    } else {
      dom.comboHint.classList.remove('is-visible');
      dom.comboHint.classList.remove('is-pop');
      dom.comboHint.textContent = '';
      dom.comboHint.setAttribute('aria-hidden', 'true');
    }
  }

  /**
   * 隐藏连击浮层并清零（失误、结算、重开时调用）。
   * @returns {void}
   */
  function hideCombo() {
    updateCombo(0);
  }

  /**
   * 清空弹幕列表与连击浮层（重开对局时调用）。
   * @returns {void}
   */
  function reset() {
    dom.list.textContent = '';
    dom.list.scrollTop = 0;
    hideCombo();
  }

  /**
   * 初始化弹幕面板：缓存节点并绑定列表点击委托。
   * @param {{onBubbleClick:Function}} handlers 外部回调集合
   * @returns {void}
   */
  function init(handlers) {
    cacheDom();
    if (handlers && typeof handlers.onBubbleClick === 'function') {
      onBubbleClick = handlers.onBubbleClick;
    }
    dom.list.addEventListener('click', handleListClick);
  }

  HMG.uiPanel = {
    init: init,
    createBubble: createBubble,
    markCorrect: markCorrect,
    markWrong: markWrong,
    markMissed: markMissed,
    markSynced: markSynced,
    appendSystem: appendSystem,
    appendSelf: appendSelf,
    updateCombo: updateCombo,
    hideCombo: hideCombo,
    reset: reset
  };
})(window.HMG = window.HMG || {});
