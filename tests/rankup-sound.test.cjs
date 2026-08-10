const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const sound = require(path.join(__dirname, '..', 'src', 'rankup-sound.js'));

function createFakeAudio({ duration = 30, playError = null } = {}) {
  const listeners = new Map();
  return {
    duration,
    currentTime: 0,
    paused: true,
    readyState: 1,
    playCalls: 0,
    loadCalls: 0,
    removedSource: false,
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    play() {
      this.playCalls += 1;
      this.paused = false;
      return playError ? Promise.reject(playError) : Promise.resolve();
    },
    pause() { this.paused = true; },
    removeAttribute(name) { if (name === 'src') this.removedSource = true; },
    load() { this.loadCalls += 1; },
    emit(name) { listeners.get(name)?.(); },
  };
}

test('offers three named rank-up sound styles with a 王者号角 default', () => {
  assert.deepEqual(sound.options.map((option) => option.id), ['horn', 'crystal', 'star']);
  assert.deepEqual(sound.options.map((option) => option.label), ['王者号角', '水晶解锁', '星耀冲刺']);
  assert.equal(sound.DEFAULT_STYLE, 'horn');
});

test('normalizes local sound settings without accepting unknown styles', () => {
  assert.deepEqual(sound.normalizeSettings({ style: 'crystal', enabled: false }), {
    style: 'crystal',
    enabled: false,
  });
  assert.deepEqual(sound.normalizeSettings({ style: 'unknown', enabled: 'yes' }), {
    style: 'horn',
    enabled: true,
  });
});

test('builds an ordered, distinct note sequence for every sound style', () => {
  const sequences = sound.options.map((option) => sound.getSequence(option.id));
  for (const sequence of sequences) {
    assert.ok(sequence.length >= 3);
    assert.ok(sequence.every((note) => note.frequency > 0 && note.duration > 0 && note.delay >= 0));
    assert.deepEqual(sequence.map((note) => note.delay), [...sequence].map((note) => note.delay).sort((a, b) => a - b));
  }
  assert.notDeepEqual(sequences[0], sequences[1]);
  assert.notDeepEqual(sequences[1], sequences[2]);
});

test('makes the default 王者号角 sequence energetic enough for a promotion reveal', () => {
  const horn = sound.getSequence('horn');
  assert.equal(horn.length, 8);
  assert.equal(horn.at(-1).frequency, 784);
  assert.ok(horn[4].delay < 1.2);
});

test('keeps every sound style aligned with the 5.2 second promotion animation', () => {
  for (const option of sound.options) {
    assert.ok(Math.abs(sound.getDuration(option.id) - 5.2) <= 0.05, option.label);
  }
});

test('validates supported files and HTTPS direct audio URLs', () => {
  assert.equal(sound.validateAudioFile({
    name: 'music.mp3',
    type: 'audio/mpeg',
    size: 10_485_760,
  }).valid, true);
  assert.match(sound.validateAudioFile({
    name: 'music.mp3',
    type: 'audio/mpeg',
    size: 10_485_761,
  }).error, /10MB/);
  assert.match(sound.validateAudioFile({
    name: 'notes.txt',
    type: 'text/plain',
    size: 20,
  }).error, /MP3/);
  assert.equal(sound.validateAudioUrl('https://example.com/music.m4a?v=1').valid, true);
  assert.equal(sound.validateAudioUrl('http://example.com/music.mp3').valid, false);
});

test('clamps clip starts to a 0.1 second slider range', () => {
  assert.equal(sound.CLIP_DURATION, 5.2);
  assert.equal(sound.getMaxClipStart(20), 14.8);
  assert.equal(sound.normalizeClipStart(12.46, 20), 12.5);
  assert.equal(sound.normalizeClipStart(99, 20), 14.8);
  assert.equal(sound.formatTime(12.4), '00:12.4');
});

test('reads audio duration and rejects media shorter than the promotion clip', async () => {
  const acceptedAudio = createFakeAudio({ duration: 30 });
  const accepted = sound.inspectAudio('https://example.com/music.mp3', {
    audioFactory: () => acceptedAudio,
  });
  acceptedAudio.emit('loadedmetadata');
  assert.deepEqual(await accepted, { duration: 30 });

  const shortAudio = createFakeAudio({ duration: 4.8 });
  const rejected = sound.inspectAudio('https://example.com/short.mp3', {
    audioFactory: () => shortAudio,
  });
  shortAudio.emit('loadedmetadata');
  await assert.rejects(rejected, /至少需要 5\.2 秒/);
});

test('plays only the selected 5.2 second custom clip and returns a stop handle', () => {
  const timers = [];
  const clearedTimers = [];
  const audio = createFakeAudio({ duration: 30 });
  const handle = sound.playSettings({
    enabled: true,
    source: 'url',
    style: 'horn',
    url: 'https://example.com/music.mp3',
    clipStart: 12.4,
    clipDuration: 5.2,
  }, {
    audioFactory: () => audio,
    setTimer: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimer: (timerId) => clearedTimers.push(timerId),
  });

  assert.equal(handle.started, true);
  assert.equal(handle.kind, 'custom');
  assert.equal(audio.currentTime, 12.4);
  assert.equal(audio.playCalls, 1);
  assert.equal(timers[0].delay, 5200);

  timers[0].callback();
  assert.equal(audio.paused, true);
  assert.equal(audio.removedSource, true);
  handle.stop();
  assert.deepEqual(clearedTimers, [1]);
});

test('falls back to the selected built-in style only once when custom playback fails', async () => {
  const audio = createFakeAudio({ playError: new Error('blocked') });
  const fallbackStyles = [];
  const handle = sound.playSettings({
    enabled: true,
    source: 'url',
    style: 'crystal',
    url: 'https://example.com/music.mp3',
    clipStart: 0,
  }, {
    audioFactory: () => audio,
    builtinPlayer: (style) => {
      fallbackStyles.push(style);
      return { started: true, kind: 'builtin', stop() {} };
    },
    setTimer: () => 1,
    clearTimer: () => {},
  });

  await Promise.resolve();
  await Promise.resolve();
  audio.emit('error');

  assert.deepEqual(fallbackStyles, ['crystal']);
  handle.stop();
});

test('waits for media metadata before seeking to a non-zero clip start', () => {
  const audio = createFakeAudio({ duration: 30 });
  audio.readyState = 0;
  const handle = sound.playSettings({
    enabled: true,
    source: 'url',
    style: 'horn',
    url: 'https://example.com/music.mp3',
    clipStart: 9.3,
  }, {
    audioFactory: () => audio,
    setTimer: () => 1,
    clearTimer: () => {},
  });

  assert.equal(audio.playCalls, 1);
  assert.equal(audio.currentTime, 0);
  audio.emit('loadedmetadata');
  assert.equal(audio.currentTime, 9.3);
  handle.stop();
});
