(function attachRankupSound(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RankupSound = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRankupSound(root) {
  'use strict';

  const STORAGE_KEY = 'youxuepai-rankup-sound-settings-v1';
  const DEFAULT_STYLE = 'horn';
  const CLIP_DURATION = 5.2;
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const audioPathPattern = /\.(?:mp3|m4a|wav|ogg)$/i;
  const audioMimePattern = /^(?:audio\/(?:mpeg|mp4|x-m4a|wav|x-wav|ogg)|application\/ogg)$/i;
  const options = Object.freeze([
    Object.freeze({ id: 'horn', label: '王者号角', description: '快速上行号角和高音收束，晋级感最燃' }),
    Object.freeze({ id: 'crystal', label: '水晶解锁', description: '清亮钟声和水晶泛音，适合课堂播放' }),
    Object.freeze({ id: 'star', label: '星耀冲刺', description: '短促的星光琶音，节奏明快有冲劲' }),
  ]);
  const sequences = Object.freeze({
    horn: Object.freeze([
      Object.freeze({ frequency: 196, duration: 0.44, delay: 0, type: 'sawtooth' }),
      Object.freeze({ frequency: 247, duration: 0.42, delay: 0.18, type: 'sawtooth' }),
      Object.freeze({ frequency: 294, duration: 0.44, delay: 0.38, type: 'sawtooth' }),
      Object.freeze({ frequency: 392, duration: 0.5, delay: 0.65, type: 'triangle' }),
      Object.freeze({ frequency: 523, duration: 0.6, delay: 0.95, type: 'triangle' }),
      Object.freeze({ frequency: 659, duration: 0.68, delay: 1.42, type: 'triangle' }),
      Object.freeze({ frequency: 698, duration: 0.8, delay: 2.55, type: 'triangle' }),
      Object.freeze({ frequency: 784, duration: 1, delay: 4.2, type: 'sine' }),
    ]),
    crystal: Object.freeze([
      Object.freeze({ frequency: 523.25, duration: 0.45, delay: 0, type: 'sine' }),
      Object.freeze({ frequency: 659.25, duration: 0.48, delay: 0.32, type: 'sine' }),
      Object.freeze({ frequency: 783.99, duration: 0.5, delay: 0.74, type: 'sine' }),
      Object.freeze({ frequency: 1046.5, duration: 0.72, delay: 1.25, type: 'sine' }),
      Object.freeze({ frequency: 783.99, duration: 0.55, delay: 2.25, type: 'sine' }),
      Object.freeze({ frequency: 987.77, duration: 0.7, delay: 3.15, type: 'sine' }),
      Object.freeze({ frequency: 1318.51, duration: 0.85, delay: 4.35, type: 'sine' }),
    ]),
    star: Object.freeze([
      Object.freeze({ frequency: 392, duration: 0.28, delay: 0, type: 'triangle' }),
      Object.freeze({ frequency: 523.25, duration: 0.3, delay: 0.18, type: 'triangle' }),
      Object.freeze({ frequency: 659.25, duration: 0.32, delay: 0.38, type: 'triangle' }),
      Object.freeze({ frequency: 783.99, duration: 0.35, delay: 0.62, type: 'triangle' }),
      Object.freeze({ frequency: 1046.5, duration: 0.45, delay: 0.9, type: 'sine' }),
      Object.freeze({ frequency: 783.99, duration: 0.5, delay: 1.55, type: 'triangle' }),
      Object.freeze({ frequency: 1174.66, duration: 0.7, delay: 2.65, type: 'sine' }),
      Object.freeze({ frequency: 1567.98, duration: 0.9, delay: 4.3, type: 'sine' }),
    ]),
  });

  function isKnownStyle(style) {
    return options.some((option) => option.id === style);
  }

  function validateAudioFile(file) {
    const fileName = String(file?.name || '');
    const mimeType = String(file?.type || '');
    if (!audioPathPattern.test(fileName) || (mimeType && !audioMimePattern.test(mimeType))) {
      return { valid: false, error: '请选择 MP3、M4A、WAV 或 OGG 音频' };
    }
    if (Number(file?.size) > MAX_FILE_BYTES) {
      return { valid: false, error: '音频文件不能超过 10MB' };
    }
    return { valid: true, error: '' };
  }

  function validateAudioUrl(value) {
    try {
      const url = new URL(String(value || ''));
      const valid = url.protocol === 'https:' && audioPathPattern.test(url.pathname);
      return {
        valid,
        url: valid ? url.href : '',
        error: valid ? '' : '请输入 HTTPS 音频直链',
      };
    } catch {
      return { valid: false, url: '', error: '请输入 HTTPS 音频直链' };
    }
  }

  function getMaxClipStart(duration) {
    const available = Math.max(0, (Number(duration) || 0) - CLIP_DURATION);
    return Math.floor((available + 1e-9) * 10) / 10;
  }

  function normalizeClipStart(value, duration) {
    const rounded = Math.max(0, Math.round((Number(value) || 0) * 10) / 10);
    return Math.min(getMaxClipStart(duration), rounded);
  }

  function formatTime(value) {
    const seconds = Math.max(0, Number(value) || 0);
    const minutes = Math.floor(seconds / 60);
    const remainder = (seconds % 60).toFixed(1).padStart(4, '0');
    return `${String(minutes).padStart(2, '0')}:${remainder}`;
  }

  function createAudioElement(audioFactory) {
    if (typeof audioFactory === 'function') return audioFactory();
    if (typeof root.Audio !== 'function') return null;
    return new root.Audio();
  }

  function inspectAudio(url, {
    audioFactory,
    setTimer = root.setTimeout?.bind(root),
    clearTimer = root.clearTimeout?.bind(root),
    timeoutMs = 10000,
  } = {}) {
    return new Promise((resolve, reject) => {
      const audio = createAudioElement(audioFactory);
      if (!audio) {
        reject(new Error('当前浏览器无法读取音频'));
        return;
      }
      let settled = false;
      let timeoutId = null;
      const cleanup = () => {
        audio.removeEventListener?.('loadedmetadata', handleMetadata);
        audio.removeEventListener?.('error', handleError);
        if (timeoutId !== null && clearTimer) clearTimer(timeoutId);
      };
      const settle = (callback) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const handleMetadata = () => {
        const duration = Number(audio.duration);
        if (!Number.isFinite(duration) || duration <= 0) {
          settle(() => reject(new Error('无法读取音频时长')));
          return;
        }
        if (duration < CLIP_DURATION) {
          settle(() => reject(new Error('音频至少需要 5.2 秒')));
          return;
        }
        settle(() => resolve({ duration }));
      };
      const handleError = () => settle(() => reject(new Error('无法读取音频')));
      audio.addEventListener?.('loadedmetadata', handleMetadata);
      audio.addEventListener?.('error', handleError);
      audio.preload = 'metadata';
      audio.src = String(url || '');
      audio.load?.();
      if (setTimer) timeoutId = setTimer(handleError, timeoutMs);
      if (audio.readyState >= 1 && Number.isFinite(Number(audio.duration))) handleMetadata();
    });
  }

  function normalizeSettings(value) {
    const input = value && typeof value === 'object' ? value : {};
    const enabled = input.enabled === false || input.enabled === 'false' ? false : true;
    return {
      style: isKnownStyle(input.style) ? input.style : DEFAULT_STYLE,
      enabled,
    };
  }

  function getSettings(storage = root.localStorage) {
    try {
      return normalizeSettings(JSON.parse(storage?.getItem(STORAGE_KEY) || '{}'));
    } catch {
      return normalizeSettings();
    }
  }

  function saveSettings(value, storage = root.localStorage) {
    const settings = normalizeSettings(value);
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Sound preferences are optional; playback still works for this session.
    }
    return settings;
  }

  function getSequence(style) {
    const sequence = sequences[isKnownStyle(style) ? style : DEFAULT_STYLE];
    return sequence.map((note) => ({ ...note }));
  }

  function getDuration(style) {
    return getSequence(style).reduce((duration, note) => (
      Math.max(duration, note.delay + note.duration)
    ), 0);
  }

  function getAudioContext() {
    const AudioContext = root.AudioContext || root.webkitAudioContext;
    if (!AudioContext) return null;
    if (!root.__youxuepaiRankupAudioContext) {
      try {
        root.__youxuepaiRankupAudioContext = new AudioContext();
      } catch {
        return null;
      }
    }
    return root.__youxuepaiRankupAudioContext;
  }

  function playTone(context, note, start, volume) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = note.type;
    oscillator.frequency.setValueAtTime(note.frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + note.duration + 0.04);
    return oscillator;
  }

  function playBuiltin(style, { context = null, volume = 0.11 } = {}) {
    const selectedStyle = isKnownStyle(style) ? style : DEFAULT_STYLE;
    const audioContext = context || getAudioContext();
    if (!audioContext) return { started: false, kind: 'builtin', stop() {} };
    const sequence = getSequence(selectedStyle);
    const start = audioContext.currentTime + 0.02;
    const safeVolume = Math.min(0.2, Math.max(0.02, Number(volume) || 0.11));
    const oscillators = sequence.map((note) => (
      playTone(audioContext, note, start + note.delay, safeVolume)
    ));
    let stopped = false;
    if (audioContext.state === 'suspended' && typeof audioContext.resume === 'function') {
      void audioContext.resume().catch(() => {});
    }
    return {
      started: true,
      kind: 'builtin',
      stop() {
        if (stopped) return;
        stopped = true;
        for (const oscillator of oscillators) {
          try {
            oscillator.stop(audioContext.currentTime);
          } catch {
            // The oscillator may already have reached its scheduled stop time.
          }
        }
      },
    };
  }

  function play(style = getSettings().style, options = {}) {
    const settings = getSettings();
    if (!settings.enabled) return false;
    const selectedStyle = isKnownStyle(style) ? style : settings.style;
    return playBuiltin(selectedStyle, options).started;
  }

  function playSettings(settings, {
    audioFactory,
    context = null,
    volume = 0.11,
    setTimer = root.setTimeout?.bind(root),
    clearTimer = root.clearTimeout?.bind(root),
    builtinPlayer = playBuiltin,
  } = {}) {
    const input = settings && typeof settings === 'object' ? settings : {};
    if (input.enabled === false || input.enabled === 'false') {
      return { started: false, kind: 'muted', stop() {} };
    }
    const style = isKnownStyle(input.style) ? input.style : DEFAULT_STYLE;
    if (input.source !== 'upload' && input.source !== 'url') {
      return builtinPlayer(style, { context, volume });
    }
    const validatedUrl = validateAudioUrl(input.url);
    if (!validatedUrl.valid) return builtinPlayer(style, { context, volume });
    const audio = createAudioElement(audioFactory);
    if (!audio) return builtinPlayer(style, { context, volume });

    const clipStart = Math.max(0, Math.round((Number(input.clipStart) || 0) * 10) / 10);
    const clipEnd = clipStart + CLIP_DURATION;
    let timerId = null;
    let stopped = false;
    let fellBack = false;
    let fallbackPlayback = null;

    const releaseAudio = () => {
      audio.removeEventListener?.('error', handleFailure);
      audio.removeEventListener?.('loadedmetadata', handleMetadata);
      audio.removeEventListener?.('timeupdate', handleTimeUpdate);
      audio.pause?.();
      audio.removeAttribute?.('src');
      audio.load?.();
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (timerId !== null && clearTimer) clearTimer(timerId);
      releaseAudio();
      fallbackPlayback?.stop?.();
    };
    const handleFailure = () => {
      if (stopped || fellBack) return;
      fellBack = true;
      releaseAudio();
      fallbackPlayback = builtinPlayer(style, { context, volume });
    };
    const handleTimeUpdate = () => {
      if (Number(audio.currentTime) >= clipEnd) stop();
    };
    const handleMetadata = () => {
      try {
        audio.currentTime = clipStart;
      } catch {
        handleFailure();
      }
    };

    audio.addEventListener?.('error', handleFailure);
    audio.addEventListener?.('loadedmetadata', handleMetadata);
    audio.addEventListener?.('timeupdate', handleTimeUpdate);
    audio.preload = 'auto';
    audio.src = validatedUrl.url;
    try {
      if (audio.readyState >= 1) handleMetadata();
      const playResult = audio.play?.();
      if (playResult && typeof playResult.catch === 'function') {
        void playResult.catch(handleFailure);
      }
    } catch {
      handleFailure();
    }
    if (setTimer) timerId = setTimer(stop, CLIP_DURATION * 1000);

    return { started: true, kind: 'custom', stop };
  }

  return {
    STORAGE_KEY,
    DEFAULT_STYLE,
    CLIP_DURATION,
    MAX_FILE_BYTES,
    options,
    validateAudioFile,
    validateAudioUrl,
    getMaxClipStart,
    normalizeClipStart,
    formatTime,
    inspectAudio,
    normalizeSettings,
    getSettings,
    saveSettings,
    getSequence,
    getDuration,
    play,
    playSettings,
  };
});
