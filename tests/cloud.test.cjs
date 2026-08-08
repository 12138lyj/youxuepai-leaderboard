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
  const signInCalls = [];
  const savedPayloads = [];
  let failNextSave = Boolean(options.failFirstSave);
  let authCallback = null;
  let remoteCallback = null;
  let closedSubscriptions = 0;

  const client = {
    from(table) {
      assert.equal(table, 'leaderboard_state');
      return {
        select() { return this; },
        eq() { return this; },
        async single() { return { data: record, error: null }; },
      };
    },
    rpc(name, params) {
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
