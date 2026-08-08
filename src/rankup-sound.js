(function attachRankupSound(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RankupSound = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRankupSound(root) {
  'use strict';

  const STORAGE_KEY = 'youxuepai-rankup-sound-settings-v1';
  const DEFAULT_STYLE = 'horn';
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
  }

  function play(style = getSettings().style, { context = null, volume = 0.11 } = {}) {
    const settings = getSettings();
    if (!settings.enabled) return false;
    const selectedStyle = isKnownStyle(style) ? style : settings.style;
    const audioContext = context || getAudioContext();
    if (!audioContext) return false;
    const sequence = getSequence(selectedStyle);
    const start = audioContext.currentTime + 0.02;
    const safeVolume = Math.min(0.2, Math.max(0.02, Number(volume) || 0.11));
    sequence.forEach((note) => playTone(audioContext, note, start + note.delay, safeVolume));
    if (audioContext.state === 'suspended' && typeof audioContext.resume === 'function') {
      void audioContext.resume().catch(() => {});
    }
    return true;
  }

  return {
    STORAGE_KEY,
    DEFAULT_STYLE,
    options,
    normalizeSettings,
    getSettings,
    saveSettings,
    getSequence,
    getDuration,
    play,
  };
});
