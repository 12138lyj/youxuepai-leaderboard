const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = path.join(__dirname, '..', 'src', 'rank-rules.js');
const moduleExists = fs.existsSync(modulePath);
const rules = moduleExists ? require(modulePath) : {};

test('rank rules module exists', () => {
  assert.equal(moduleExists, true);
});

test('uses the requested cumulative thresholds for all seven ranks', () => {
  const cases = [
    [0, '倔强青铜'],
    [299, '倔强青铜'],
    [300, '秩序白银'],
    [599, '秩序白银'],
    [600, '荣耀黄金'],
    [999, '荣耀黄金'],
    [1000, '尊贵铂金'],
    [1599, '尊贵铂金'],
    [1600, '永恒钻石'],
    [2199, '永恒钻石'],
    [2200, '至尊星耀'],
    [2999, '至尊星耀'],
    [3000, '最强王者'],
    [9999, '最强王者'],
  ];
  for (const [points, expected] of cases) {
    assert.equal(rules.getRank(points).name, expected, `${points} points`);
  }
});

test('reports the remaining points to the next requested rank', () => {
  const cases = [
    [0, 300, '差 300 分'],
    [299, 1, '差 1 分'],
    [300, 300, '差 300 分'],
    [599, 1, '差 1 分'],
    [600, 400, '差 400 分'],
    [999, 1, '差 1 分'],
    [1000, 600, '差 600 分'],
    [1599, 1, '差 1 分'],
    [1600, 600, '差 600 分'],
    [2199, 1, '差 1 分'],
    [2200, 800, '差 800 分'],
    [2999, 1, '差 1 分'],
  ];
  for (const [points, remaining, label] of cases) {
    const milestone = rules.getNextMilestone(points);
    assert.equal(milestone.remaining, remaining, `${points} remaining`);
    assert.equal(milestone.label, label, `${points} label`);
  }
  assert.deepEqual(rules.getNextMilestone(3000), {
    target: null,
    remaining: 0,
    label: '已登顶',
  });
});

test('only reports promotion when the named rank increases', () => {
  assert.equal(rules.isRankUpgrade(299, 300), true);
  assert.equal(rules.isRankUpgrade(599, 600), true);
  assert.equal(rules.isRankUpgrade(999, 1000), true);
  assert.equal(rules.isRankUpgrade(1599, 1600), true);
  assert.equal(rules.isRankUpgrade(2199, 2200), true);
  assert.equal(rules.isRankUpgrade(2999, 3000), true);
  assert.equal(rules.isRankUpgrade(300, 599), false);
  assert.equal(rules.isRankUpgrade(2200, 2999), false);
  assert.equal(rules.isRankUpgrade(3000, 2999), false);
});

test('returns checkpoint progress from zero to one', () => {
  assert.equal(rules.getRankProgress(0), 0);
  assert.equal(rules.getRankProgress(150), 0.5);
  assert.equal(rules.getRankProgress(300), 0);
  assert.ok(rules.getRankProgress(599) > 0.99);
  assert.equal(rules.getRankProgress(800), 0.5);
  assert.equal(rules.getRankProgress(1000), 0);
  assert.equal(rules.getRankProgress(1300), 0.5);
  assert.equal(rules.getRankProgress(1600), 0);
  assert.equal(rules.getRankProgress(1900), 0.5);
  assert.equal(rules.getRankProgress(2200), 0);
  assert.equal(rules.getRankProgress(2600), 0.5);
  assert.equal(rules.getRankProgress(3000), 1);
});

test('exposes the complete rank order including platinum', () => {
  assert.deepEqual(rules.ranks.map((rank) => rank.name), [
    '倔强青铜', '秩序白银', '荣耀黄金', '尊贵铂金', '永恒钻石', '至尊星耀', '最强王者',
  ]);
  assert.deepEqual(rules.ranks.map((rank) => rank.minimum), [0, 300, 600, 1000, 1600, 2200, 3000]);
});
