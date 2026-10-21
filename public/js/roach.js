/**
 * roach.js —— 拍蟑螂玩法
 * 职责：直播画面底部的蟑螂入侵区域、1 只头领 + 4 只小蟑螂的移动、拖鞋光标与击打判定、
 *       入侵音效循环、逃跑/击杀统计、暂停恢复与清理。
 * 本模块只负责表现与输入；好感度结算通过 callbacks 交给 game.js。
 */
(function (HMG) {
  'use strict';

  var CONFIG = window.GAME_CONFIG;
  var R = CONFIG.roach;
  var dom = {};
  var callbacks = { onKill: null, onRoundEnd: null };
  var state = null;
  var initialized = false;
  var cleanupTimer = 0;
  var pressTimer = 0;
  var lastPointer = { x: -1, y: -1, type: 'mouse' };
  var hoverMedia = window.matchMedia
    ? window.matchMedia('(any-hover: hover) and (any-pointer: fine)')
    : null;

  /**
   * 按 id 获取 DOM 节点。
   * @param {string} id 元素 id
   * @returns {HTMLElement} 元素
   */
  function byId(id) {
    return document.getElementById(id);
  }

  /**
   * 缓存本模块需要的 DOM 节点。
   * @returns {void}
   */
  function cacheDom() {
    dom.stageColumn = document.querySelector('.stage-column');
    dom.roachZone = byId('roachZone');
    dom.cursor = byId('roachCursor');
    dom.skinSwitcher = byId('skinSwitcher');
  }

  /**
   * 判断当前设备是否具备可用的精确指针（鼠标/触控笔）。
   * @returns {boolean} 是否显示跟随鼠标的拖鞋
   */
  function supportsHover() {
    return hoverMedia ? hoverMedia.matches : true;
  }

  /**
   * 预加载一张图片，避免首次进入时闪烁。
   * @param {string} src 图片地址
   * @returns {void}
   */
  function preloadImage(src) {
    if (!src) {
      return;
    }
    var image = new Image();
    image.src = src;
  }

  /**
   * 判断坐标是否在左栏（直播屏 + 礼物区）内。
   * @param {number} x 视口坐标 X
   * @param {number} y 视口坐标 Y
   * @returns {boolean} 是否在左栏内
   */
  function insideStage(x, y) {
    if (!dom.stageColumn) {
      return false;
    }
    var rect = dom.stageColumn.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  /**
   * 判断坐标是否落在画面/BGM 下拉等交互控件上（这些控件保留正常指针，不参与拍打）。
   * @param {number} x 视口坐标 X
   * @param {number} y 视口坐标 Y
   * @returns {boolean} 是否应跳过拍打
   */
  function isInteractivePoint(x, y) {
    var element = document.elementFromPoint(x, y);
    return !!(element && element.closest && element.closest('.stage-switcher'));
  }

  /**
   * 隐藏拖鞋光标并取消按压状态。
   * @returns {void}
   */
  function hideCursor() {
    if (!dom.cursor) {
      return;
    }
    window.clearTimeout(pressTimer);
    pressTimer = 0;
    dom.cursor.classList.remove('is-visible');
    dom.cursor.classList.remove('is-pressing');
  }

  /**
   * 按当前指针位置更新拖鞋光标；右侧、触屏或交互控件上则隐藏。
   * @returns {void}
   */
  function updateCursor() {
    if (!state || !state.active || state.paused || !supportsHover() ||
        lastPointer.type === 'touch' || !insideStage(lastPointer.x, lastPointer.y) ||
        isInteractivePoint(lastPointer.x, lastPointer.y)) {
      hideCursor();
      return;
    }
    dom.cursor.style.left = lastPointer.x + 'px';
    dom.cursor.style.top = lastPointer.y + 'px';
    dom.cursor.classList.add('is-visible');
  }

  /**
   * 处理全局指针移动：记忆位置，并按是否在左栏切换拖鞋光标。
   * @param {PointerEvent} event 指针事件
   * @returns {void}
   */
  function handlePointerMove(event) {
    lastPointer.x = event.clientX;
    lastPointer.y = event.clientY;
    lastPointer.type = event.pointerType || 'mouse';
    if (state && state.active) {
      updateCursor();
    }
  }

  /**
   * 在点击位置显示一次“按下”拖鞋，并安排恢复/隐藏。
   * @param {PointerEvent} event 指针事件
   * @returns {void}
   */
  function pulseSlipper(event) {
    if (!dom.cursor || !supportsHover() || event.pointerType === 'touch') {
      /* 触屏端不展示拖鞋，直接用手指点击蟑螂。 */
      hideCursor();
      return;
    }
    dom.cursor.style.left = event.clientX + 'px';
    dom.cursor.style.top = event.clientY + 'px';
    dom.cursor.classList.add('is-visible');
    dom.cursor.classList.add('is-pressing');
    window.clearTimeout(pressTimer);
    /* 按下状态短暂展示：鼠标回到悬停图；触屏不会进入这里。 */
    pressTimer = window.setTimeout(function () {
      if (!dom.cursor) {
        return;
      }
      dom.cursor.classList.remove('is-pressing');
      updateCursor();
    }, 160);
  }

  /**
   * 判断点击位置是否命中某只行走中的蟑螂，命中则拍死一只。
   * @param {number} x 视口坐标 X
   * @param {number} y 视口坐标 Y
   * @returns {void}
   */
  function hitTest(x, y) {
    if (!state) {
      return;
    }
    /* 后添加的小蟑螂在上层，优先判定，避免大头领挡住小蟑螂。 */
    for (var i = state.roaches.length - 1; i >= 0; i -= 1) {
      var roach = state.roaches[i];
      if (roach.status !== 'walking') {
        continue;
      }
      var rect = roach.el.getBoundingClientRect();
      /* 命中框覆盖整张行走图（含透明留白），并额外放宽 12px，全身都可拍中。 */
      if (x >= rect.left - 12 && x <= rect.right + 12 && y >= rect.top - 12 && y <= rect.bottom + 12) {
        killRoach(roach);
        return;
      }
    }
  }

  /**
   * 处理左栏左键点击：播放击打音效、展示按下拖鞋，并尝试拍中蟑螂。
   * @param {PointerEvent} event 指针事件
   * @returns {void}
   */
  function handlePointerDown(event) {
    if (!state || !state.active || state.paused) {
      return;
    }
    if (typeof event.button === 'number' && event.button !== 0) {
      return;
    }
    lastPointer.x = event.clientX;
    lastPointer.y = event.clientY;
    lastPointer.type = event.pointerType || 'mouse';
    if (!insideStage(event.clientX, event.clientY) ||
        isInteractivePoint(event.clientX, event.clientY)) {
      return;
    }

    HMG.audio.playSnap();
    pulseSlipper(event);
    hitTest(event.clientX, event.clientY);
  }

  /**
   * 让一只蟑螂进入区域（显示并从最左侧开始移动）。
   * @param {object} roach 运行时蟑螂对象
   * @returns {void}
   */
  function enterRoach(roach) {
    roach.status = 'walking';
    roach.el.style.visibility = 'visible';
    var width = roach.el.offsetWidth || 0;
    roach.el.style.transform = 'translateX(' + (-width).toFixed(2) + 'px)';
    if (roach.isBoss && state && !state.bossEntered) {
      state.bossEntered = true;
      HMG.audio.playWhistle();
      HMG.audio.startRoachLoop();
    }
  }

  /**
   * 计算蟑螂在当前时间点的理论水平位置（未做队列间距修正）。
   * @param {object} roach 运行时蟑螂对象
   * @param {number} zoneWidth 当前入侵区域宽度
   * @returns {number} 左边缘相对区域左侧的像素偏移
   */
  function getRoachX(roach, zoneWidth) {
    var width = roach.el.offsetWidth || 0;
    var progress = (state.elapsed - roach.spawnAt) / roach.duration;
    progress = Math.max(0, Math.min(1, progress));
    return -width + progress * (zoneWidth + width);
  }

  /**
   * 将蟑螂移动到指定水平位置。
   * @param {object} roach 运行时蟑螂对象
   * @param {number} x 左边缘相对区域左侧的像素偏移
   * @returns {void}
   */
  function setRoachX(roach, x) {
    roach.el.style.transform = 'translateX(' + x.toFixed(2) + 'px)';
  }

  /**
   * 标记蟑螂从右侧逃跑并移除节点。
   * @param {object} roach 运行时蟑螂对象
   * @returns {void}
   */
  function escapeRoach(roach) {
    roach.status = 'escaped';
    if (state) {
      state.escapedCount += 1;
    }
    if (roach.el.parentNode) {
      roach.el.parentNode.removeChild(roach.el);
    }
  }

  /**
   * 拍死一只蟑螂：切换死亡图、回调 +1 好感、检查本轮是否结束。
   * @param {object} roach 运行时蟑螂对象
   * @returns {void}
   */
  function killRoach(roach) {
    if (roach.status !== 'walking') {
      return;
    }
    roach.status = 'dead';
    roach.el.src = roach.dieSrc;
    roach.el.classList.add('is-dead');
    if (typeof callbacks.onKill === 'function') {
      callbacks.onKill();
    }
    /* 死亡图保留一小段时间；若本轮已结束，区域淡出时会统一清理。 */
    window.setTimeout(function () {
      if (roach.el.parentNode) {
        roach.el.parentNode.removeChild(roach.el);
      }
    }, R.dieLingerMs);
    checkRoundComplete();
  }

  /**
   * 若五只蟑螂全部被拍死或已逃跑，结束本轮。
   * @returns {void}
   */
  function checkRoundComplete() {
    if (!state) {
      return;
    }
    for (var i = 0; i < state.roaches.length; i += 1) {
      var status = state.roaches[i].status;
      if (status !== 'dead' && status !== 'escaped') {
        return;
      }
    }
    endRound();
  }

  /**
   * 每次动画帧推进入侵进度、生成/移动/结算蟑螂，并维持队列最小间距。
   * @returns {void}
   */
  function updateRoaches() {
    if (!state) {
      return;
    }
    var zoneWidth = dom.roachZone.clientWidth;
    var i;
    /* 先让到期者入场；位置统一在第二遍按队列计算。 */
    for (i = 0; i < state.roaches.length; i += 1) {
      var entering = state.roaches[i];
      if (entering.status === 'waiting' && state.elapsed >= entering.spawnAt) {
        enterRoach(entering);
      }
    }

    /* 按“头领→小强1→小强2…”的出生顺序排队，后一只不得追上前一只。 */
    var gap = Math.max(10, zoneWidth * (R.minGapRatio || 0.02));
    var previous = null;
    for (i = 0; i < state.roaches.length; i += 1) {
      var roach = state.roaches[i];
      if (roach.status !== 'walking') {
        continue;
      }
      var width = roach.el.offsetWidth || 0;
      var x = getRoachX(roach, zoneWidth);
      if (previous) {
        /* 左边缘至少比前一只的右边缘再退后 gap 像素。 */
        var minX = previous.x - previous.width - gap;
        if (x > minX) {
          x = minX;
        }
      }
      if (x >= zoneWidth) {
        escapeRoach(roach);
        continue;
      }
      setRoachX(roach, x);
      previous = { x: x, width: width };
    }
    checkRoundComplete();
  }

  /**
   * 主循环：使用活动时间推进，暂停时完全冻结。
   * @param {number} timestamp requestAnimationFrame 时间戳
   * @returns {void}
   */
  function loop(timestamp) {
    if (!state || !state.active || state.paused) {
      if (state) {
        state.rafId = 0;
      }
      return;
    }
    var delta = timestamp - state.lastTs;
    state.lastTs = timestamp;
    if (!isFinite(delta) || delta < 0) {
      delta = 0;
    }
    if (delta > 250) {
      delta = 250;
    }
    state.elapsed += delta;
    updateRoaches();
    if (state && state.active) {
      state.rafId = window.requestAnimationFrame(loop);
    }
  }

  /**
   * 清理入侵区域的 DOM 节点并隐藏。
   * @returns {void}
   */
  function clearZone() {
    if (!dom.roachZone) {
      return;
    }
    dom.roachZone.textContent = '';
    dom.roachZone.classList.remove('is-active', 'is-leaving', 'is-paused');
    dom.roachZone.hidden = true;
    dom.roachZone.setAttribute('aria-hidden', 'true');
  }

  /**
   * 结束当前入侵轮次：停音效/光标，区域淡出，并回调逃跑数量。
   * @returns {void}
   */
  function endRound() {
    if (!state) {
      return;
    }
    var round = state;
    state = null;
    if (round.rafId) {
      window.cancelAnimationFrame(round.rafId);
      round.rafId = 0;
    }
    HMG.audio.stopRoachLoop();
    if (dom.stageColumn) {
      dom.stageColumn.classList.remove('is-roach-hunting');
    }
    hideCursor();
    dom.roachZone.classList.remove('is-active', 'is-paused');
    dom.roachZone.classList.add('is-leaving');
    dom.roachZone.setAttribute('aria-hidden', 'true');
    window.clearTimeout(cleanupTimer);
    /* 淡出结束后清理入侵区域；若下一轮已开始，startRound 会取消这个定时器。 */
    cleanupTimer = window.setTimeout(function () {
      clearZone();
    }, R.zoneFadeMs);
    if (typeof callbacks.onRoundEnd === 'function') {
      callbacks.onRoundEnd(round.escapedCount);
    }
  }

  /**
   * 开始一轮蟑螂入侵。
   * @param {number} roundNumber 第几轮（1~3）
   * @returns {boolean} 是否成功开始
   */
  function startRound(roundNumber) {
    if (!initialized || (state && state.active)) {
      return false;
    }
    window.clearTimeout(cleanupTimer);
    cleanupTimer = 0;
    hideCursor();
    clearZone();
    HMG.audio.stopRoachLoop();
    if (dom.stageColumn) {
      dom.stageColumn.classList.add('is-roach-hunting');
    }

    state = {
      active: true,
      paused: false,
      roundNumber: roundNumber || 1,
      elapsed: 0,
      lastTs: window.performance.now(),
      rafId: 0,
      escapedCount: 0,
      bossEntered: false,
      roaches: []
    };

    var defs = [{
      isBoss: true,
      spawnAt: R.bossSpawnDelayMs,
      duration: R.bossDurationMs,
      walkSrc: R.sprites.bossWalk,
      dieSrc: R.sprites.bossDie
    }];

    /* 四只小蟑螂按各自的延迟陆续从左侧进入。 */
    R.gruntSpawnDelaysMs.forEach(function (delay) {
      /* 第二只起都是小蟑螂，沿用统一的行走/死亡素材。 */
      defs.push({
        isBoss: false,
        spawnAt: delay,
        duration: R.gruntDurationMs,
        walkSrc: R.sprites.gruntWalk,
        dieSrc: R.sprites.gruntDie
      });
    });

    /* 为头领/小蟑螂创建独立 GIF 节点，等待自己的入场时间。 */
    defs.forEach(function (def) {
      /* 每个节点独立保存位置、时长与死亡图。 */
      var element = document.createElement('img');
      element.className = 'roach ' + (def.isBoss ? 'roach--boss' : 'roach--grunt');
      element.src = def.walkSrc;
      element.alt = '';
      element.draggable = false;
      element.style.visibility = 'hidden';
      dom.roachZone.appendChild(element);
      state.roaches.push({
        isBoss: def.isBoss,
        el: element,
        spawnAt: def.spawnAt,
        duration: def.duration,
        dieSrc: def.dieSrc,
        status: 'waiting'
      });
    });

    dom.roachZone.hidden = false;
    dom.roachZone.classList.remove('is-active', 'is-leaving', 'is-paused');
    dom.roachZone.setAttribute('aria-hidden', 'false');
    /* 强制回流，让淡入/红光动画在重新出现时重新播放。 */
    void dom.roachZone.offsetWidth;
    dom.roachZone.classList.add('is-active');
    state.lastTs = window.performance.now();
    state.rafId = window.requestAnimationFrame(loop);
    updateCursor();
    return true;
  }

  /**
   * 暂停入侵：冻结位置、动画与循环音效。
   * @returns {void}
   */
  function pause() {
    if (!state || !state.active || state.paused) {
      return;
    }
    state.paused = true;
    if (state.rafId) {
      window.cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    dom.roachZone.classList.add('is-paused');
    HMG.audio.pauseRoachLoop();
    hideCursor();
  }

  /**
   * 恢复入侵：从冻结时的进度继续，并恢复循环音效。
   * @returns {void}
   */
  function resume() {
    if (!state || !state.active || !state.paused) {
      return;
    }
    state.paused = false;
    state.lastTs = window.performance.now();
    dom.roachZone.classList.remove('is-paused');
    HMG.audio.resumeRoachLoop();
    state.rafId = window.requestAnimationFrame(loop);
    updateCursor();
  }

  /**
   * 立即停止并清理入侵（结算、重开、失败时调用），不触发逃跑结算。
   * @returns {void}
   */
  function stop() {
    window.clearTimeout(cleanupTimer);
    cleanupTimer = 0;
    if (state) {
      if (state.rafId) {
        window.cancelAnimationFrame(state.rafId);
      }
      state = null;
    }
    HMG.audio.stopRoachLoop();
    if (dom.stageColumn) {
      dom.stageColumn.classList.remove('is-roach-hunting');
    }
    hideCursor();
    clearZone();
  }

  /**
   * 重置入侵模块（新一局开始时调用）。
   * @returns {void}
   */
  function reset() {
    stop();
  }

  /**
   * 查询当前是否有蟑螂入侵正在进行。
   * @returns {boolean} 是否进行中
   */
  function isActive() {
    return !!(state && state.active);
  }

  /**
   * 窗口尺寸变化时重新校正拖鞋光标位置。
   * @returns {void}
   */
  function handleViewportResize() {
    if (state && state.active) {
      updateCursor();
    }
  }

  /**
   * 初始化拍蟑螂模块：缓存节点、预加载素材、绑定指针事件。
   * @param {{onKill:Function, onRoundEnd:Function}} options 结算回调
   * @returns {void}
   */
  function init(options) {
    if (initialized) {
      return;
    }
    initialized = true;
    cacheDom();
    if (options && typeof options.onKill === 'function') {
      callbacks.onKill = options.onKill;
    }
    if (options && typeof options.onRoundEnd === 'function') {
      callbacks.onRoundEnd = options.onRoundEnd;
    }
    preloadImage(R.sprites.bossWalk);
    preloadImage(R.sprites.bossDie);
    preloadImage(R.sprites.gruntWalk);
    preloadImage(R.sprites.gruntDie);
    preloadImage(R.sprites.slipperHover);
    preloadImage(R.sprites.slipperPress);

    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('pointerdown', handlePointerDown);
    document.documentElement.addEventListener('mouseleave', hideCursor);
    window.addEventListener('blur', hideCursor);
    window.addEventListener('resize', handleViewportResize);
  }

  HMG.roach = {
    init: init,
    startRound: startRound,
    stop: stop,
    reset: reset,
    pause: pause,
    resume: resume,
    isActive: isActive
  };
})(window.HMG = window.HMG || {});
