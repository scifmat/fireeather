/**
 * audio.js —— BGM 与音效控制
 * 职责：创建音频对象、音量配置、自动播放兜底、页面隐藏时暂停/恢复。
 * 所有音频均为本地相对路径，兼容 file:// 双击运行。
 */
(function (HMG) {
  'use strict';

  var CONFIG = window.GAME_CONFIG;
  var bgm = null;
  var correctSfx = null;
  var wrongSfx = null;
  var bgmDesired = false;
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
   * 尝试播放 BGM；若被浏览器拦截则保持“待播放”状态，等待首次交互补播。
   * @returns {void}
   */
  function playBgm() {
    bgmDesired = true;
    if (!bgm) {
      return;
    }
    var promise = bgm.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(ignoreRejection);
    }
  }

  /**
   * 暂停 BGM（保留播放意愿，供切回前台时恢复）。
   * @returns {void}
   */
  function pauseBgm() {
    if (bgm && !bgm.paused) {
      bgm.pause();
    }
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
    bgm = createAudio('./public/audio/bgm.mp3', true, CONFIG.audio.bgmVolume);
    correctSfx = createAudio('./public/audio/correct.wav', false, CONFIG.audio.sfxVolume);
    wrongSfx = createAudio('./public/audio/wrong.wav', false, CONFIG.audio.sfxVolume);

    playBgm();
    document.addEventListener('pointerdown', handleFirstInteraction, { once: true });
    document.addEventListener('keydown', handleFirstInteraction, { once: true });
  }

  HMG.audio = {
    init: init,
    playBgm: playBgm,
    pauseBgm: pauseBgm,
    resumeBgm: resumeBgm,
    playCorrect: playCorrect,
    playWrong: playWrong
  };
})(window.HMG = window.HMG || {});
