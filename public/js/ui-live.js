/**
 * ui-live.js —— 左栏渲染
 * 职责：直播屏 16:9 自适应、GIF 占位切换、统计条、好感度飘字、弹幕机、礼物区。
 */
(function (HMG) {
  'use strict';

  var CONFIG = window.GAME_CONFIG;

  /* 礼物栏展示数据：图标编号对应 public/images/gift_icon/01~11.png */
  var GIFTS = [
    { name: '人气票', cost: '1电池' },
    { name: '心动盲盒', cost: '150电池' },
    { name: '粉丝团灯牌', cost: '1电池' },
    { name: '薯条', cost: '1电池' },
    { name: '小花花', cost: '1电池' },
    { name: '饭团', cost: '1电池' },
    { name: '牛哇牛哇', cost: '1电池' },
    { name: '打call', cost: '2电池' },
    { name: '鼓鼓掌', cost: '5电池' },
    { name: '你真好看', cost: '10电池' },
    { name: '大航海', cost: '40' }
  ];

  var dom = {};
  var lastStats = null;
  var lastStageWidth = -1;
  var lastStageHeight = -1;
  var placeholderTimer = 0;
  var resizeObserver = null;

  /**
   * 缓存本模块需要的 DOM 节点。
   * @returns {void}
   */
  function cacheDom() {
    dom.liveArea = document.getElementById('liveArea');
    dom.liveStage = document.getElementById('liveStage');
    dom.livePlaceholder = document.getElementById('livePlaceholder');
    dom.liveImg = document.getElementById('liveScreenImg');
    dom.statTotal = document.getElementById('statTotal');
    dom.statDone = document.getElementById('statDone');
    dom.statMiss = document.getElementById('statMiss');
    dom.statWrong = document.getElementById('statWrong');
    dom.statFavor = document.getElementById('statFavor');
    dom.statFavorPill = document.getElementById('statFavorPill');
    dom.favorFill = document.getElementById('favorFill');
    dom.machineViewport = document.getElementById('machineViewport');
    dom.machineTrack = document.getElementById('machineTrack');
    dom.giftList = document.getElementById('giftList');
  }

  /**
   * 构建 11 个礼物占位项（图标 + 名称 + 数量文案）。
   * @returns {void}
   */
  function buildGiftList() {
    var fragment = document.createDocumentFragment();
    /* 遍历礼物配置，生成图标、名称与占位数量文案。 */
    GIFTS.forEach(function (gift, index) {
      var serial = index + 1 < 10 ? '0' + (index + 1) : String(index + 1);
      var item = document.createElement('div');
      item.className = 'gift-item' + (index === GIFTS.length - 1 ? ' gift-item--royal' : '');

      var iconWrap = document.createElement('div');
      iconWrap.className = 'gift-item__icon-wrap';
      var icon = document.createElement('img');
      icon.className = 'gift-item__icon';
      icon.src = './public/images/gift_icon/' + serial + '.png';
      icon.alt = gift.name + '图标';
      icon.draggable = false;
      iconWrap.appendChild(icon);

      var name = document.createElement('span');
      name.className = 'gift-item__name';
      name.textContent = gift.name;

      var cost = document.createElement('span');
      cost.className = 'gift-item__cost';
      cost.textContent = gift.cost;

      item.appendChild(iconWrap);
      item.appendChild(name);
      item.appendChild(cost);
      fragment.appendChild(item);
    });
    dom.giftList.appendChild(fragment);
  }

  /**
   * 计算并设置直播屏尺寸：宽度优先撑满；高度受限时按高度反推宽度并居中。
   * @returns {void}
   */
  function fitStage() {
    var width = dom.liveArea.clientWidth;
    var height = dom.liveArea.clientHeight;
    if (width <= 0) {
      return;
    }

    var targetWidth = width;
    var isDesktop = window.innerWidth >= 1024;
    if (isDesktop && height > 0) {
      targetWidth = Math.min(width, (height * 16) / 9);
    }
    var targetHeight = (targetWidth * 9) / 16;

    if (Math.abs(targetWidth - lastStageWidth) < 0.5 && Math.abs(targetHeight - lastStageHeight) < 0.5) {
      return;
    }
    lastStageWidth = targetWidth;
    lastStageHeight = targetHeight;
    dom.liveStage.style.width = targetWidth.toFixed(2) + 'px';
    dom.liveStage.style.height = targetHeight.toFixed(2) + 'px';
  }

  /**
   * 监听容器尺寸变化与窗口缩放，使舞台始终贴合可用空间。
   * @returns {void}
   */
  function initStageFit() {
    fitStage();
    window.requestAnimationFrame(fitStage);

    /**
     * 尺寸变化回调：重新计算 16:9 舞台。
     * @returns {void}
     */
    function handleResize() {
      fitStage();
    }

    window.addEventListener('resize', handleResize);
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(dom.liveArea);
    }
  }

  /**
   * GIF 加载完成：淡出占位并显示直播画面。
   * @returns {void}
   */
  function handleImageLoad() {
    dom.liveImg.classList.add('is-ready');
    dom.livePlaceholder.classList.add('is-fading');
    window.clearTimeout(placeholderTimer);
    /* 淡出完成后的回调：把占位层彻底隐藏。 */
    placeholderTimer = window.setTimeout(function () {
      /* 淡出完成后彻底隐藏占位层，避免继续参与绘制。 */
      dom.livePlaceholder.hidden = true;
    }, 480);
  }

  /**
   * GIF 加载失败：保留渐变占位，不阻断游戏逻辑。
   * @returns {void}
   */
  function handleImageError() {
    dom.livePlaceholder.classList.remove('is-fading');
    dom.livePlaceholder.hidden = false;
  }

  /**
   * 绑定 GIF 的 load/error；若脚本执行时图片已缓存完成则立即切换。
   * @returns {void}
   */
  function initLiveImage() {
    dom.liveImg.addEventListener('load', handleImageLoad);
    dom.liveImg.addEventListener('error', handleImageError);
    if (dom.liveImg.complete) {
      if (dom.liveImg.naturalWidth > 0) {
        handleImageLoad();
      } else {
        handleImageError();
      }
    }
  }

  /**
   * 给统计数值播放一次脉冲动画。
   * @param {HTMLElement} element 数值节点
   * @returns {void}
   */
  function pulseValue(element) {
    if (!element) {
      return;
    }
    element.classList.remove('is-pulse');
    /* 读取 offsetWidth 强制回流，确保连续变化时动画能重新触发。 */
    void element.offsetWidth;
    element.classList.add('is-pulse');
  }

  /**
   * 更新一项统计文本，并在数值变化时播放脉冲。
   * @param {HTMLElement} element 目标节点
   * @param {string} text 展示文本
   * @param {number} numeric 用于比较的数值
   * @param {number|null} previous 上一次数值，null 表示首次渲染
   * @returns {void}
   */
  function setStatValue(element, text, numeric, previous) {
    if (!element) {
      return;
    }
    element.textContent = text;
    if (previous !== null && previous !== numeric) {
      pulseValue(element);
    }
  }

  /**
   * 用当前对局数据刷新统计条、好感度进度与预警状态。
   * @param {{total:number, done:number, miss:number, wrong:number, favor:number, favorMax:number}} stats 统计数据
   * @returns {void}
   */
  function updateStats(stats) {
    var previous = lastStats;
    setStatValue(dom.statTotal, stats.total + '/' + CONFIG.flow.totalDanmaku, stats.total, previous ? previous.total : null);
    setStatValue(dom.statDone, String(stats.done), stats.done, previous ? previous.done : null);
    setStatValue(dom.statMiss, String(stats.miss), stats.miss, previous ? previous.miss : null);
    setStatValue(dom.statWrong, String(stats.wrong), stats.wrong, previous ? previous.wrong : null);
    setStatValue(dom.statFavor, String(stats.favor), stats.favor, previous ? previous.favor : null);

    var ratio = stats.favorMax > 0 ? stats.favor / stats.favorMax : 0;
    ratio = Math.max(0, Math.min(1, ratio));
    dom.favorFill.style.width = (ratio * 100).toFixed(1) + '%';
    dom.statFavorPill.classList.toggle('is-warning', stats.favor < 30);

    lastStats = {
      total: stats.total,
      done: stats.done,
      miss: stats.miss,
      wrong: stats.wrong,
      favor: stats.favor
    };
  }

  /**
   * 在好感度胶囊下方弹出一条浮动数值（+3/+4/−8/−5）。
   * @param {number} delta 名义变化量（正数为加，负数为扣）
   * @returns {void}
   */
  function showDelta(delta) {
    if (!delta) {
      return;
    }
    var gain = delta > 0;
    var tip = document.createElement('span');
    tip.className = 'float-delta ' + (gain ? 'float-delta--gain' : 'float-delta--loss');
    tip.textContent = (gain ? '+' : '−') + Math.abs(delta);
    dom.statFavorPill.appendChild(tip);

    /**
     * 动画结束后移除飘字节点，避免 DOM 持续增长。
     * @returns {void}
     */
    function removeTip() {
      if (tip.parentNode) {
        tip.parentNode.removeChild(tip);
      }
    }
    tip.addEventListener('animationend', removeTip, { once: true });
    window.setTimeout(removeTip, 1000);
  }

  /**
   * 把弹幕机滚动到最新一条；内容未撑满时保持不动。
   * @returns {void}
   */
  function scrollMachineToBottom() {
    var viewport = dom.machineViewport;
    if (viewport.scrollHeight <= viewport.clientHeight) {
      return;
    }
    if (typeof viewport.scrollTo === 'function') {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
    } else {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }

  /**
   * 向主播弹幕机追加一条气泡。容量不写死，由可视高度自然裁剪。
   * @param {{audience:{name:string}, content:string}} data 弹幕数据
   * @param {boolean} isMiss 是否为漏办负面弹幕
   * @returns {void}
   */
  function pushMachine(data, isMiss) {
    var item = document.createElement('div');
    item.className = 'machine-item' + (isMiss ? ' machine-item--miss' : '');

    var name = document.createElement('span');
    name.className = 'machine-item__name';
    name.textContent = data.audience.name + '：';

    var text = document.createElement('span');
    text.textContent = data.content;

    item.appendChild(name);
    item.appendChild(text);
    dom.machineTrack.appendChild(item);
    scrollMachineToBottom();
  }

  /**
   * 清空弹幕机（重开对局时调用）。
   * @returns {void}
   */
  function resetMachine() {
    dom.machineTrack.textContent = '';
    dom.machineViewport.scrollTop = 0;
  }

  /**
   * 初始化左栏：缓存节点、渲染礼物、绑定图片加载与舞台自适应。
   * @returns {void}
   */
  function init() {
    cacheDom();
    buildGiftList();
    initLiveImage();
    initStageFit();
  }

  HMG.uiLive = {
    init: init,
    updateStats: updateStats,
    showDelta: showDelta,
    pushMachine: pushMachine,
    resetMachine: resetMachine
  };
})(window.HMG = window.HMG || {});
