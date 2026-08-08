const test = require('node:test');
const assert = require('node:assert/strict');

const Cloud = require('../src/cloud.js');

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
