const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '2026081101_leaderboard_history.sql');

test('history migration keeps 50 owner-only snapshots and exposes a restore RPC', () => {
  assert.equal(fs.existsSync(migrationPath), true, 'history migration must exist');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /create table if not exists public\.leaderboard_state_history/i);
  assert.match(sql, /unique\s*\(state_id, revision\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /auth\.uid\(\) = owner_id/i);
  assert.match(sql, /create trigger capture_leaderboard_state_history/i);
  assert.match(sql, /after update/i);
  assert.match(sql, /limit 50/i);
  assert.match(sql, /create or replace function public\.restore_leaderboard_snapshot/i);
  assert.match(sql, /grant execute on function public\.restore_leaderboard_snapshot\(bigint\) to authenticated/i);
  assert.doesNotMatch(sql, /grant .*leaderboard_state_history.* to anon/i);
});
