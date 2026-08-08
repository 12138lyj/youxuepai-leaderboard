const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const sound = require(path.join(__dirname, '..', 'src', 'rankup-sound.js'));

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
