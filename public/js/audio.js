/**
 * audio.js —— BGM 与音效控制
 * 职责：创建音频对象、音量配置、自动播放兜底、页面隐藏时暂停/恢复。
 * 所有音频均为本地相对路径，兼容 file:// 双击运行。
 */
(function (HMG) {
  'use strict';

  var CONFIG = window.GAME_CONFIG;
  var bgmTracks = {};
  var activeBgmId = '';
  var bgmBaseVolume = 0.35;
  var bgmFadeRaf = 0;
  var bgmFadeToken = 0;
  var correctSfx = null;
  var wrongSfx = null;
  var whistleSfx = null;
  var snapSfx = null;
  var drumbeatAudio = null;
  var footstepsAudio = null;
  var bgmDesired = false;
  var bgmPaused = false;
  var roachLoopDesired = false;
  var initialized = false;

  /**
   * 创建单个音频对象。
   * @param {string} src 音频相对路径
   * @param {boolean} loop 是否循环播放
   * @param {number} volume 音量（0~1）
   * @returns {HTMLAudioElement} 创建出的音频元素
   */
  function createAudio(src, loop, volume) {
    var audio = new Audio(src);
    audio.loop = !!loop;
    audio.preload = 'auto';
    audio.volume = volume;
    return audio;
  }

  /**
   * 静默处理 play() 返回的 Promise 拒绝，避免自动播放被拦截时产生未捕获异常。
   * @returns {void}
   */
  function ignoreRejection() {
    /* 自动播放被浏览器拦截属于预期情况，等待首次交互补播即可。 */
  }

  /**
   * 取得当前选中的 BGM 音频对象。
   * @returns {HTMLAudioElement|null} 当前曲目
   */
  function getActiveBgm() {
    return bgmTracks[activeBgmId] || null;
  }

  /**
   * 把 BGM 下拉框同步为当前曲目。
   * @returns {void}
   */
  function syncBgmSelect() {
    var select = document.getElementById('bgmSelect');
    if (select) {
      select.value = activeBgmId;
    }
  }

  /**
   * 取消尚未完成的 BGM 交叉淡入淡出。
   * @returns {void}
   */
  function cancelBgmFade() {
    bgmFadeToken += 1;
    if (bgmFadeRaf) {
      window.cancelAnimationFrame(bgmFadeRaf);
      bgmFadeRaf = 0;
    }
  }

  /**
   * 暂停全部 BGM 轨道，并保留当前曲目的音量。
   * @returns {void}
   */
  function pauseAllBgm() {
    cancelBgmFade();
    /* 逐轨暂停，只给当前曲目保留恢复音量。 */
    Object.keys(bgmTracks).forEach(function (id) {
      var track = bgmTracks[id];
      track.pause();
      track.volume = id === activeBgmId ? bgmBaseVolume : 0;
    });
  }

  /**
   * 尝试播放当前 BGM；若被浏览器拦截则保持“待播放”状态，等待首次交互补播。
   * @returns {void}
   */
  function playBgm() {
    bgmDesired = true;
    bgmPaused = false;
    cancelBgmFade();
    var active = getActiveBgm();
    if (!active) {
      return;
    }
    /* 确保只有当前曲目在播放，其余轨道全部静音。 */
    Object.keys(bgmTracks).forEach(function (id) {
      if (id !== activeBgmId) {
        bgmTracks[id].pause();
        bgmTracks[id].volume = 0;
      }
    });
    active.volume = bgmBaseVolume;
    var promise = active.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(ignoreRejection);
    }
  }

  /**
   * 暂停 BGM（保留播放意愿，供切回前台时恢复）。
   * @returns {void}
   */
  function pauseBgm() {
    bgmPaused = true;
    pauseAllBgm();
  }

  /**
   * 恢复 BGM：仅当此前有播放意愿时执行，避免教程阶段被误播。
   * @returns {void}
   */
  function resumeBgm() {
    if (bgmDesired) {
      playBgm();
    }
  }

  /**
   * 切换 BGM 曲目；正在播放时用 220ms 交叉淡入淡出，避免硬切。
   * @param {string} trackId 曲目 id
   * @returns {void}
   */
  function switchBgm(trackId) {
    var id = String(trackId || '');
    if (!bgmTracks[id]) {
      syncBgmSelect();
      return;
    }
    if (id === activeBgmId) {
      syncBgmSelect();
      return;
    }

    cancelBgmFade();
    var previousId = activeBgmId;
    var previous = getActiveBgm();
    /* 先停掉可能残留在上一次淡入淡出中的其他轨道。 */
    Object.keys(bgmTracks).forEach(function (key) {
      if (key !== previousId) {
        bgmTracks[key].pause();
        bgmTracks[key].volume = 0;
      }
    });

    activeBgmId = id;
    syncBgmSelect();
    var next = getActiveBgm();
    if (!next) {
      return;
    }

    if (!bgmDesired || bgmPaused || document.hidden) {
      if (previous) {
        previous.pause();
        previous.volume = 0;
      }
      next.volume = bgmBaseVolume;
      return;
    }

    try {
      next.currentTime = 0;
    } catch (error) {
      /* 音频尚未 ready 时忽略电流设置失败。 */
    }
    next.volume = 0;
    var playPromise = next.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(ignoreRejection);
    }

    if (!previous || previous.paused) {
      next.volume = bgmBaseVolume;
      return;
    }

    previous.volume = bgmBaseVolume;
    var token = ++bgmFadeToken;
    var startedAt = window.performance.now();
    /**
     * 交叉淡入淡出的单帧回调。
     * @param {number} now requestAnimationFrame 时间戳
     * @returns {void}
     */
    function step(now) {
      if (token !== bgmFadeToken) {
        return;
      }
      var progress = Math.max(0, Math.min(1, (now - startedAt) / 220));
      previous.volume = bgmBaseVolume * (1 - progress);
      next.volume = bgmBaseVolume * progress;
      if (progress < 1) {
        bgmFadeRaf = window.requestAnimationFrame(step);
        return;
      }
      bgmFadeRaf = 0;
      previous.pause();
      try {
        previous.currentTime = 0;
      } catch (error) {
        /* 音频尚未 ready 时忽略电流设置失败。 */
      }
      previous.volume = 0;
      next.volume = bgmBaseVolume;
    }
    bgmFadeRaf = window.requestAnimationFrame(step);
  }

  /**
   * 读取当前 BGM 状态（自检/调试用）。
   * @returns {{id:string, desired:boolean, paused:boolean, currentTime:number, volume:number, duration:number, readyState:number, loop:boolean}} 状态快照
   */
  function getBgmState() {
    var active = getActiveBgm();
    return {
      id: activeBgmId,
      desired: bgmDesired,
      paused: active ? active.paused : true,
      currentTime: active ? active.currentTime : 0,
      volume: active ? active.volume : 0,
      duration: active && isFinite(active.duration) ? active.duration : 0,
      readyState: active ? active.readyState : 0,
      loop: active ? active.loop : false
    };
  }

  /**
   * 处理 BGM 下拉框切换。
   * @returns {void}
   */
  function handleBgmChange() {
    var select = document.getElementById('bgmSelect');
    if (select) {
      switchBgm(select.value);
    }
  }

  /**
   * 播放正确消除音效。
   * @returns {void}
   */
  function playCorrect() {
    playSfx(correctSfx);
  }

  /**
   * 播放误伤音效。
   * @returns {void}
   */
  function playWrong() {
    playSfx(wrongSfx);
  }

  /**
   * 播放蟑螂头领入场口哨（每轮一次）。
   * @returns {void}
   */
  function playWhistle() {
    playSfx(whistleSfx);
  }

  /**
   * 播放拖鞋击打音效（拍蟑螂阶段每次左键）。
   * @returns {void}
   */
  function playSnap() {
    playSfx(snapSfx);
  }

  /**
   * 从头播放一个循环音频（鼓点/脚步），失败时静默。
   * @param {HTMLAudioElement|null} audio 目标循环音频
   * @param {boolean} restart 是否从头开始
   * @returns {void}
   */
  function playLoop(audio, restart) {
    if (!audio) {
      return;
    }
    if (restart) {
      try {
        audio.currentTime = 0;
      } catch (error) {
        /* 音频未就绪时忽略 currentTime 设置失败。 */
      }
    }
    var promise = audio.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(ignoreRejection);
    }
  }

  /**
   * 开始蟑螂入侵的鼓点 + 脚步循环。
   * @returns {void}
   */
  function startRoachLoop() {
    roachLoopDesired = true;
    playLoop(drumbeatAudio, true);
    playLoop(footstepsAudio, true);
  }

  /**
   * 暂停蟑螂循环（保留播放意愿，页面恢复后继续）。
   * @returns {void}
   */
  function pauseRoachLoop() {
    if (drumbeatAudio && !drumbeatAudio.paused) {
      drumbeatAudio.pause();
    }
    if (footstepsAudio && !footstepsAudio.paused) {
      footstepsAudio.pause();
    }
  }

  /**
   * 恢复蟑螂循环：仅当本轮仍在入侵中且此前有播放意愿时执行。
   * @returns {void}
   */
  function resumeRoachLoop() {
    if (!roachLoopDesired) {
      return;
    }
    playLoop(drumbeatAudio, false);
    playLoop(footstepsAudio, false);
  }

  /**
   * 停止蟑螂循环并归零（入侵结束/重开/结算时调用）。
   * @returns {void}
   */
  function stopRoachLoop() {
    roachLoopDesired = false;
    if (drumbeatAudio) {
      drumbeatAudio.pause();
      try {
        drumbeatAudio.currentTime = 0;
      } catch (error) {
        /* 音频未就绪时忽略。 */
      }
    }
    if (footstepsAudio) {
      footstepsAudio.pause();
      try {
        footstepsAudio.currentTime = 0;
      } catch (error) {
        /* 音频未就绪时忽略。 */
      }
    }
  }

  /**
   * 从头播放一个短音效，失败时静默（不打断游戏）。
   * @param {HTMLAudioElement|null} audio 目标音效对象
   * @returns {void}
   */
  function playSfx(audio) {
    if (!audio) {
      return;
    }
    try {
      audio.currentTime = 0;
    } catch (error) {
      /* 某些浏览器在音频尚未就绪时不允许设置 currentTime，忽略即可。 */
    }
    var promise = audio.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(ignoreRejection);
    }
  }

  /**
   * 首次任意用户交互的兜底入口：再次尝试播放 BGM。
   * @returns {void}
   */
  function handleFirstInteraction() {
    playBgm();
    resumeRoachLoop();
  }

  /**
   * 初始化音频模块：创建对象、设置音量、尝试自动播放并绑定首次交互补播。
   * @returns {void}
   */
  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    bgmBaseVolume = CONFIG.audio.bgmVolume;
    var tracks = CONFIG.bgmTracks || [];
    activeBgmId = String(CONFIG.defaultBgm || (tracks[0] && tracks[0].id) || '');
    /* 三首 BGM 全部预加载，切歌时才能即时交叉淡入。 */
    tracks.forEach(function (track) {
      var id = String(track.id);
      bgmTracks[id] = createAudio(track.src, true, id === activeBgmId ? bgmBaseVolume : 0);
    });
    if (!bgmTracks[activeBgmId] && tracks.length) {
      activeBgmId = String(tracks[0].id);
      bgmTracks[activeBgmId].volume = bgmBaseVolume;
    }
    var bgmSelect = document.getElementById('bgmSelect');
    if (bgmSelect) {
      bgmSelect.value = activeBgmId;
      bgmSelect.addEventListener('change', handleBgmChange);
    }

    correctSfx = createAudio('./public/audio/correct.wav', false, CONFIG.audio.sfxVolume);
    wrongSfx = createAudio('./public/audio/wrong.wav', false, CONFIG.audio.sfxVolume);

    var roachAudio = CONFIG.roach.audio;
    whistleSfx = createAudio(roachAudio.whistle, false, roachAudio.whistleVolume);
    snapSfx = createAudio(roachAudio.snap, false, roachAudio.snapVolume);
    drumbeatAudio = createAudio(roachAudio.drumbeat, true, roachAudio.loopVolume);
    footstepsAudio = createAudio(roachAudio.footsteps, true, roachAudio.loopVolume);

    playBgm();
    document.addEventListener('pointerdown', handleFirstInteraction, { once: true });
    document.addEventListener('keydown', handleFirstInteraction, { once: true });
  }

  HMG.audio = {
    init: init,
    playBgm: playBgm,
    pauseBgm: pauseBgm,
    resumeBgm: resumeBgm,
    switchBgm: switchBgm,
    getBgmState: getBgmState,
    playCorrect: playCorrect,
    playWrong: playWrong,
    playWhistle: playWhistle,
    playSnap: playSnap,
    startRoachLoop: startRoachLoop,
    pauseRoachLoop: pauseRoachLoop,
    resumeRoachLoop: resumeRoachLoop,
    stopRoachLoop: stopRoachLoop
  };
})(window.HMG = window.HMG || {});
