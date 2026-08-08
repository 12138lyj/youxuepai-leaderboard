(function attachRankRules(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RankRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRankRules() {
  // The classroom ladder keeps the recognizable 王者荣耀 main-rank order.
  // Every 300 cumulative points unlocks the next rank; 王者 is the cap.
  const ranks = [
    { name: '倔强青铜', shortName: '青铜', minimum: 0, color: '#A96F43', className: 'bronze' },
    { name: '秩序白银', shortName: '白银', minimum: 300, color: '#8293A6', className: 'silver' },
    { name: '荣耀黄金', shortName: '黄金', minimum: 600, color: '#D59B14', className: 'gold' },
    { name: '尊贵铂金', shortName: '铂金', minimum: 900, color: '#4D9A8A', className: 'platinum' },
    { name: '永恒钻石', shortName: '钻石', minimum: 1200, color: '#6B86D7', className: 'diamond' },
    { name: '至尊星耀', shortName: '星耀', minimum: 1500, color: '#7D63C8', className: 'star' },
    { name: '最强王者', shortName: '王者', minimum: 1800, color: '#C68C12', className: 'king' },
  ];
  const checkpoints = ranks.map((rank) => rank.minimum);
  const MAX_POINTS = ranks[ranks.length - 1].minimum;

  function normalizePoints(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.round(number));
  }

  function getRank(value) {
    const points = normalizePoints(value);
    let index = 0;
    for (let candidate = 1; candidate < ranks.length; candidate += 1) {
      if (points >= ranks[candidate].minimum) index = candidate;
      else break;
    }
    return { ...ranks[index], index, points };
  }

  function getNextMilestone(value) {
    const points = normalizePoints(value);
    if (points >= MAX_POINTS) return { target: null, remaining: 0, label: '已登顶' };
    const target = checkpoints.find((checkpoint) => checkpoint > points);
    const remaining = target - points;
    return { target, remaining, label: `差 ${remaining} 分` };
  }

  function getRankProgress(value) {
    const points = normalizePoints(value);
    if (points >= MAX_POINTS) return 1;
    const current = getRank(points);
    const next = ranks[current.index + 1];
    return (points - current.minimum) / (next.minimum - current.minimum);
  }

  function isRankUpgrade(previousPoints, nextPoints) {
    return getRank(nextPoints).index > getRank(previousPoints).index;
  }

  return {
    ranks,
    checkpoints,
    MAX_POINTS,
    normalizePoints,
    getRank,
    getNextMilestone,
    getRankProgress,
    isRankUpgrade,
  };
});
