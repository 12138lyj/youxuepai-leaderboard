const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const Cloud = require('../src/cloud.js');

const projectRoot = path.join(__dirname, '..');
const configPath = path.join(projectRoot, 'src', 'cloud-config.js');
const sdkPath = path.join(projectRoot, 'vendor', 'supabase.min.js');

function createFakeSupabase(options = {}) {
  const record = options.record || {
    payload: { classes: [] },
    revision: 1,
    updated_at: '2026-08-08T00:00:00.000Z',
  };
  const history = options.history || [];
  const signInCalls = [];
  const savedPayloads = [];
  const historyQueries = [];
  const restoreCalls = [];
  const uploadCalls = [];
  const removeCalls = [];
  let failNextSave = Boolean(options.failFirstSave);
  let authCallback = null;
  let remoteCallback = null;
  let closedSubscriptions = 0;

  const client = {
    from(table) {
      if (table === 'leaderboard_state') {
        return {
          select() { return this; },
          eq() { return this; },
          async single() { return { data: record, error: null }; },
        };
      }
      assert.equal(table, 'leaderboard_state_history');
      const query = { stateId: null, ascending: null, limit: null };
      historyQueries.push(query);
      return {
        select() { return this; },
        eq(column, value) {
          assert.equal(column, 'state_id');
          query.stateId = value;
          return this;
        },
        order(column, options) {
          assert.equal(column, 'revision');
          query.ascending = options.ascending;
          return this;
        },
        limit(value) {
          query.limit = value;
          return this;
        },
        then(resolve, reject) {
          return Promise.resolve({ data: history, error: null }).then(resolve, reject);
        },
      };
    },
    rpc(name, params) {
      if (name === 'restore_leaderboard_snapshot') {
        restoreCalls.push(Number(params.p_snapshot_id));
        return {
          async single() {
            return { data: options.restoredRecord || record, error: null };
          },
        };
      }
      assert.equal(name, 'save_leaderboard_state');
      savedPayloads.push(params.p_payload);
      return {
        async single() {
          if (failNextSave) {
            failNextSave = false;
            return { data: null, error: new Error('temporary failure') };
          }
          record.payload = params.p_payload;
          record.revision += 1;
          return { data: record, error: null };
        },
      };
    },
    auth: {
      async signInWithPassword(credentials) {
        signInCalls.push(credentials);
        return { data: { session: { user: { id: 'editor' } } }, error: null };
      },
      async getSession() {
        return { data: { session: options.authenticated ? { user: { id: 'editor' } } : null } };
      },
      async signOut() {
        return { error: null };
      },
      onAuthStateChange(callback) {
        authCallback = callback;
        return {
          data: {
            subscription: {
              unsubscribe() { closedSubscriptions += 1; },
            },
          },
        };
      },
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'rankup-audio');
        return {
          async upload(path, file, options) {
            uploadCalls.push({ path, file, options });
            return { data: { path }, error: null };
          },
          getPublicUrl(path) {
            return {
              data: {
                publicUrl: `https://test.supabase.co/storage/v1/object/public/${bucket}/${path}`,
              },
            };
          },
          async remove(paths) {
            removeCalls.push(paths);
            return { data: paths, error: null };
          },
        };
      },
    },
    channel() {
      return {
        on(event, filter, callback) {
          assert.equal(event, 'postgres_changes');
          assert.equal(filter.table, 'leaderboard_state');
          remoteCallback = callback;
          return this;
        },
        subscribe() { return this; },
      };
    },
    async removeChannel() {
      closedSubscriptions += 1;
    },
  };

  return {
    client,
    signInCalls,
    savedPayloads,
    historyQueries,
    restoreCalls,
    uploadCalls,
    removeCalls,
    emitAuth(event) { authCallback?.(event); },
    emitRemote(nextRecord) { remoteCallback?.({ new: nextRecord }); },
    get closedSubscriptions() { return closedSubscriptions; },
  };
}

test('loads and normalizes the main cloud record', async () => {
  const fake = createFakeSupabase({
    record: {
      payload: { classes: [{ id: 'c1', students: [{ id: 's1', name: '甲' }] }] },
      revision: 3,
      updated_at: '2026-08-08T00:00:00.000Z',
    },
  });
  const cloud = Cloud.createCloudSync({
    client: fake.client,
    normalize: (value) => ({ ...value, normalized: true }),
  });

  const row = await cloud.load();

  assert.equal(row.revision, 3);
  assert.equal(row.payload.normalized, true);
});

test('signs in with configured email and never stores the password', async () => {
  const fake = createFakeSupabase();
  const cloud = Cloud.createCloudSync({
    client: fake.client,
    editorEmail: 'coach@example.com',
    normalize: (value) => value,
  });

  await cloud.signIn('secret-value');

  assert.deepEqual(fake.signInCalls, [{ email: 'coach@example.com', password: 'secret-value' }]);
  assert.equal(JSON.stringify(cloud).includes('secret-value'), false);
});

test('debounces saves and keeps only the newest payload', async () => {
  const fake = createFakeSupabase();
  const statuses = [];
  const cloud = Cloud.createCloudSync({
    client: fake.client,
    normalize: (value) => value,
    debounceMs: 5,
    onStatus: (value) => statuses.push(value),
  });

  cloud.queueSave({ value: 1 });
  cloud.queueSave({ value: 2 });
  await cloud.flush();

  assert.deepEqual(fake.savedPayloads, [{ value: 2 }]);
  assert.equal(statuses.at(-1), 'synced');
});

test('lists the newest 50 normalized snapshots', async () => {
  const fake = createFakeSupabase({ history: [
    { id: 12, revision: 12, payload: { value: 12 }, created_at: '2026-08-11T04:00:00Z' },
    { id: 11, revision: 11, payload: { value: 11 }, created_at: '2026-08-11T03:00:00Z' },
  ] });
  const cloud = Cloud.createCloudSync({
    client: fake.client,
    normalize: (payload) => ({ ...payload, normalized: true }),
  });

  const rows = await cloud.listHistory();

  assert.deepEqual(rows.map(({ revision }) => revision), [12, 11]);
  assert.equal(rows[0].payload.normalized, true);
  assert.deepEqual(fake.historyQueries, [{ stateId: 'main', ascending: false, limit: 50 }]);
});

test('flushes pending edits before restoring and adopts the returned revision', async () => {
  const fake = createFakeSupabase({ restoredRecord: {
    payload: { value: 4 }, revision: 9, updated_at: '2026-08-11T05:00:00Z',
  } });
  const cloud = Cloud.createCloudSync({ client: fake.client, normalize: (value) => value });
  cloud.queueSave({ value: 8 });

  const row = await cloud.restoreSnapshot(44);

  assert.deepEqual(fake.savedPayloads, [{ value: 8 }]);
  assert.deepEqual(fake.restoreCalls, [44]);
  assert.equal(row.revision, 9);
  assert.equal(cloud.getRevision(), 9);
});

test('rejects invalid snapshot ids without calling the cloud', async () => {
  const fake = createFakeSupabase();
  const cloud = Cloud.createCloudSync({ client: fake.client, normalize: (value) => value });
  await assert.rejects(cloud.restoreSnapshot('bad'), /无效的历史版本/);
  assert.deepEqual(fake.restoreCalls, []);
});

test('keeps pending data after a failed save and retries it', async () => {
  const fake = createFakeSupabase({ failFirstSave: true });
  const cloud = Cloud.createCloudSync({
    client: fake.client,
    normalize: (value) => value,
    debounceMs: 0,
  });

  cloud.queueSave({ value: 7 });
  await assert.rejects(cloud.flush(), /temporary failure/);
  assert.deepEqual(cloud.getPendingPayload(), { value: 7 });

  await cloud.flush();

  assert.equal(cloud.getPendingPayload(), null);
});

test('forwards auth changes and releases subscriptions on destroy', async () => {
  const fake = createFakeSupabase();
  const cloud = Cloud.createCloudSync({ client: fake.client, normalize: (value) => value });
  const events = [];

  cloud.onAuthChange((event) => events.push(event));
  cloud.subscribe();
  fake.emitAuth('SIGNED_OUT');

  assert.deepEqual(events, ['SIGNED_OUT']);
  await cloud.destroy();
  assert.equal(fake.closedSubscriptions, 2);
});

test('ignores realtime records that are not newer than the current revision', () => {
  const fake = createFakeSupabase();
  const remoteRows = [];
  const cloud = Cloud.createCloudSync({
    client: fake.client,
    normalize: (value) => value,
    onRemote: (row) => remoteRows.push(row),
  });

  cloud.subscribe();
  fake.emitRemote({ payload: { value: 2 }, revision: 2 });
  fake.emitRemote({ payload: { value: 1 }, revision: 1 });
  fake.emitRemote({ payload: { value: 22 }, revision: 2 });

  assert.deepEqual(remoteRows, [{ payload: { value: 2 }, revision: 2 }]);
});

test('uploads rank-up audio to a unique public Storage path', async () => {
  const fake = createFakeSupabase();
  const cloud = Cloud.createCloudSync({
    client: fake.client,
    normalize: (value) => value,
    now: () => 1234,
  });
  const file = { name: 'Classroom Sprint.mp3', type: 'audio/mpeg' };

  const uploaded = await cloud.uploadRankupAudio(file);

  assert.equal(uploaded.path, 'main/1234-classroom-sprint.mp3');
  assert.match(uploaded.url, /rankup-audio\/main\/1234-classroom-sprint\.mp3$/);
  assert.equal(fake.uploadCalls[0].file, file);
  assert.deepEqual(fake.uploadCalls[0].options, {
    cacheControl: '3600',
    contentType: 'audio/mpeg',
    upsert: false,
  });
});

test('removes only a supplied rank-up audio object path', async () => {
  const fake = createFakeSupabase();
  const cloud = Cloud.createCloudSync({ client: fake.client, normalize: (value) => value });

  assert.equal(await cloud.removeRankupAudio('main/old.mp3'), true);
  assert.equal(await cloud.removeRankupAudio('../other.mp3'), false);
  assert.deepEqual(fake.removeCalls, [['main/old.mp3']]);
});

test('runtime cloud configuration contains only browser-safe public fields', () => {
  assert.equal(fs.existsSync(configPath), true, 'src/cloud-config.js must exist');
  const source = fs.readFileSync(configPath, 'utf8');
  const context = { globalThis: {} };
  vm.runInNewContext(source, context, { filename: configPath });
  const config = context.globalThis.LeaderboardCloudConfig;

  assert.deepEqual(
    Array.from(Object.keys(config).sort()),
    ['anonKey', 'editorEmail', 'recordId', 'url'],
  );
  assert.equal(Object.isFrozen(config), true);
  assert.match(config.url, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
  assert.match(config.anonKey, /^(?:eyJ|sb_publishable_)/);
  assert.equal(config.recordId, 'main');
  assert.equal(typeof config.editorEmail, 'string');
  assert.ok(config.editorEmail.includes('@'));
});

test('pinned Supabase SDK is a real browser bundle and runtime files contain no private credentials', () => {
  assert.equal(fs.existsSync(sdkPath), true, 'vendor/supabase.min.js must exist');
  const sdk = fs.readFileSync(sdkPath, 'utf8');
  assert.ok(sdk.length > 100_000, 'Supabase SDK bundle is unexpectedly small');
  assert.match(sdk.slice(0, 1_000), /supabase/i);
  assert.match(sdk, /createClient/);

  const runtimeSources = [
    path.join(projectRoot, 'index.html'),
    path.join(projectRoot, 'src', 'app.js'),
    path.join(projectRoot, 'src', 'cloud.js'),
    configPath,
  ].map((file) => fs.readFileSync(file, 'utf8')).join('\n');

  assert.doesNotMatch(runtimeSources, /service[_ -]?role/i);
  assert.doesNotMatch(runtimeSources, /postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(runtimeSources, /databasePassword|refreshToken|accessToken/i);
  assert.doesNotMatch(runtimeSources, /password\s*:\s*['"][^'"]+['"]/i);

  const ignoreFile = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
  assert.match(ignoreFile, /^!src\/cloud-config\.js$/m);
  assert.match(ignoreFile, /^!src\/cloud\.js$/m);
  assert.match(ignoreFile, /^!vendor\/supabase\.min\.js$/m);
});
