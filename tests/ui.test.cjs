const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const projectRoot = path.join(__dirname, '..');
const indexPath = path.join(projectRoot, 'index.html');
const stylesPath = path.join(projectRoot, 'styles.css');

function resolveBrowserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : null,
    process.platform === 'win32' ? 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' : null,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null,
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function makeCloudState(points = 0) {
  return {
    activeClassId: 'class-1',
    classes: [{
      id: 'class-1',
      name: '云端测试班',
      lesson: 1,
      students: [{
        id: 's1',
        name: '甲',
        notebook: 0,
        errorBook: 0,
        draft: 0,
        module: 0,
        totalPoints: points,
        badges: { notebook: 'white', errorBook: 'white', draft: 'white', module: 'white' },
      }],
      collectiveGoal: 15000,
      previousScores: {},
      honorEvents: [],
      lessonRecords: {},
      carryoverPoints: {},
    }],
  };
}

async function openCloudPage({
  authenticated = false,
  cachedPayload = null,
  failInitialLoad = false,
  cloudPayload = makeCloudState(),
  history = [],
  failRestore = false,
  supersedingPayload = null,
  holdRestore = false,
} = {}) {
  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(3000);
  await page.addInitScript(({
    isAuthenticated,
    initialPayload,
    cachedState,
    shouldFailInitialLoad,
    initialHistory,
    shouldFailRestore,
    restoreSupersedingPayload,
    shouldHoldRestore,
  }) => {
    let signedIn = isAuthenticated;
    let nextLoginError = null;
    let failNextLoad = shouldFailInitialLoad;
    let failNextSave = false;
    let failNextRestore = shouldFailRestore;
    let failNextHistoryRead = false;
    let loadCalls = 0;
    let authCallback = null;
    let remoteCallback = null;
    let releaseRestore = null;
    const restoreGate = shouldHoldRestore
      ? new Promise((resolve) => { releaseRestore = resolve; })
      : null;
    const historyRows = [...initialHistory];
    const record = {
      payload: initialPayload,
      revision: Math.max(1, ...historyRows.map((row) => Number(row.revision) || 0)),
      updated_at: '2026-08-08T00:00:00.000Z',
    };
    const savedPayloads = [];
    const uploadCalls = [];
    const removeCalls = [];
    const restoreCalls = [];

    if (cachedState) {
      localStorage.setItem('youxuepai-leaderboard-state-v2', JSON.stringify(cachedState));
    }

    globalThis.LeaderboardCloudConfig = Object.freeze({
      url: 'https://test.supabase.co',
      anonKey: 'test-anon-key',
      editorEmail: 'coach@example.com',
      recordId: 'main',
    });
    globalThis.LeaderboardCloudClientOverride = {
      from(table) {
        if (table === 'leaderboard_state_history') {
          return {
            select() { return this; },
            eq() { return this; },
            order() { return this; },
            async limit() {
              if (failNextHistoryRead) {
                failNextHistoryRead = false;
                return { data: null, error: new Error('history unavailable') };
              }
              return { data: historyRows, error: null };
            },
          };
        }
        return {
          select() { return this; },
          eq() { return this; },
          async single() {
            loadCalls += 1;
            if (failNextLoad) {
              failNextLoad = false;
              return { data: null, error: new Error('network unavailable') };
            }
            return { data: record, error: null };
          },
        };
      },
      rpc(name, params) {
        if (name === 'restore_leaderboard_snapshot') {
          const snapshotId = Number(params.p_snapshot_id);
          restoreCalls.push(snapshotId);
          return {
            async single() {
              if (restoreGate) await restoreGate;
              if (failNextRestore) {
                failNextRestore = false;
                return { data: null, error: new Error('restore unavailable') };
              }
              const snapshot = historyRows.find((row) => Number(row.id) === snapshotId);
              const restoredRecord = {
                payload: snapshot?.payload || record.payload,
                revision: record.revision + 1,
                updated_at: '2026-08-11T06:00:00.000Z',
              };
              historyRows.unshift({
                id: Math.max(0, ...historyRows.map((row) => Number(row.id) || 0)) + 1,
                revision: restoredRecord.revision,
                payload: restoredRecord.payload,
                created_at: restoredRecord.updated_at,
              });
              Object.assign(record, restoredRecord);
              if (restoreSupersedingPayload) {
                Object.assign(record, {
                  payload: restoreSupersedingPayload,
                  revision: restoredRecord.revision + 1,
                  updated_at: '2026-08-11T06:00:01.000Z',
                });
                remoteCallback?.({ new: { ...record } });
              }
              return { data: restoredRecord, error: null };
            },
          };
        }
        savedPayloads.push(params.p_payload);
        return {
          async single() {
            if (failNextSave) {
              failNextSave = false;
              return { data: null, error: new Error('save unavailable') };
            }
            record.payload = params.p_payload;
            record.revision += 1;
            record.updated_at = '2026-08-11T05:30:00.000Z';
            historyRows.unshift({
              id: Math.max(0, ...historyRows.map((row) => Number(row.id) || 0)) + 1,
              revision: record.revision,
              payload: record.payload,
              created_at: record.updated_at,
            });
            return { data: record, error: null };
          },
        };
      },
      auth: {
        async signInWithPassword() {
          if (nextLoginError) {
            const message = nextLoginError;
            nextLoginError = null;
            return { data: { session: null }, error: new Error(message) };
          }
          signedIn = true;
          const session = { user: { id: 'editor' } };
          authCallback?.('SIGNED_IN', session);
          return { data: { session }, error: null };
        },
        async getSession() {
          return { data: { session: signedIn ? { user: { id: 'editor' } } : null } };
        },
        async signOut() {
          signedIn = false;
          authCallback?.('SIGNED_OUT', null);
          return { error: null };
        },
        onAuthStateChange(callback) {
          authCallback = callback;
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
      storage: {
        from(bucket) {
          return {
            async upload(path, file, options) {
              uploadCalls.push({ bucket, path, name: file.name, size: file.size, options });
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
              removeCalls.push({ bucket, paths });
              return { data: paths, error: null };
            },
          };
        },
      },
      channel() {
        return {
          on(event, filter, callback) {
            remoteCallback = callback;
            return this;
          },
          subscribe() { return this; },
        };
      },
      async removeChannel() {},
    };
    globalThis.__fakeCloudControl = {
      rejectNextLogin(message) { nextLoginError = message; },
      failNextLoad() { failNextLoad = true; },
      failNextSave() { failNextSave = true; },
      failNextRestore() { failNextRestore = true; },
      failNextHistoryRead() { failNextHistoryRead = true; },
      setRecord(payload, revision) {
        record.payload = payload;
        record.revision = revision;
      },
      emitAuth(event) {
        if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESH_FAILED') signedIn = false;
        if (event === 'SIGNED_IN') signedIn = true;
        authCallback?.(event, signedIn ? { user: { id: 'editor' } } : null);
      },
      emitRemote(payload, revision) {
        record.payload = payload;
        record.revision = revision;
        remoteCallback?.({ new: { ...record } });
      },
      getLoadCalls() { return loadCalls; },
      getSavedPayloads() { return savedPayloads; },
      getUploadCalls() { return uploadCalls; },
      getRemoveCalls() { return removeCalls; },
      getRestoreCalls() { return restoreCalls; },
      releaseRestore() { releaseRestore?.(); },
    };
  }, {
    isAuthenticated: authenticated,
    initialPayload: cloudPayload,
    cachedState: cachedPayload,
    shouldFailInitialLoad: failInitialLoad,
    initialHistory: history,
    shouldFailRestore: failRestore,
    restoreSupersedingPayload: supersedingPayload,
    shouldHoldRestore: holdRestore,
  });

  try {
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    await page.waitForSelector(failInitialLoad
      ? '#cloud-status.failed, #cloud-status.offline'
      : '#cloud-status.synced');
  } catch (error) {
    await browser.close();
    throw error;
  }

  return {
    browser,
    page,
    fakeCloud: {
      rejectNextLogin: (message) => page.evaluate((value) => {
        globalThis.__fakeCloudControl.rejectNextLogin(value);
      }, message),
      emitRemote: (payload, revision) => page.evaluate(({ value, nextRevision }) => {
        globalThis.__fakeCloudControl.emitRemote(value, nextRevision);
      }, { value: payload, nextRevision: revision }),
      failNextSave: () => page.evaluate(() => globalThis.__fakeCloudControl.failNextSave()),
      setRecord: (payload, revision) => page.evaluate(({ value, nextRevision }) => {
        globalThis.__fakeCloudControl.setRecord(value, nextRevision);
      }, { value: payload, nextRevision: revision }),
      emitAuth: (event) => page.evaluate((value) => {
        globalThis.__fakeCloudControl.emitAuth(value);
      }, event),
      getLoadCalls: () => page.evaluate(() => globalThis.__fakeCloudControl.getLoadCalls()),
      getSavedPayloads: () => page.evaluate(() => globalThis.__fakeCloudControl.getSavedPayloads()),
      getUploadCalls: () => page.evaluate(() => globalThis.__fakeCloudControl.getUploadCalls()),
      getRemoveCalls: () => page.evaluate(() => globalThis.__fakeCloudControl.getRemoveCalls()),
      getRestoreCalls: () => page.evaluate(() => globalThis.__fakeCloudControl.getRestoreCalls()),
      releaseRestore: () => page.evaluate(() => globalThis.__fakeCloudControl.releaseRestore()),
      failNextHistoryRead: () => page.evaluate(() => globalThis.__fakeCloudControl.failNextHistoryRead()),
    },
  };
}

test('public viewers can read but must sign in before editing', async () => {
  const { browser, page, fakeCloud } = await openCloudPage({ authenticated: false });

  try {
    await page.click('#edit-button');
    assert.equal(await page.locator('#admin-login-dialog').getAttribute('open'), '');
    assert.equal(await page.locator('#edit-drawer').getAttribute('aria-hidden'), 'true');

    await page.fill('#admin-password', 'wrong');
    await fakeCloud.rejectNextLogin('密码错误');
    await page.click('#admin-login-form button[type="submit"]');
    assert.match(await page.locator('#admin-login-error').textContent(), /密码错误/);
    assert.equal(await page.locator('#admin-password').inputValue(), '');

    await page.fill('#admin-password', 'correct');
    await page.click('#admin-login-form button[type="submit"]');
    assert.equal(await page.locator('#edit-drawer').getAttribute('aria-hidden'), 'false');
    assert.equal(await page.locator('#admin-logout').isVisible(), true);
  } finally {
    await browser.close();
  }
});

test('a cloud update replaces display state without replaying promotion animation', async () => {
  const { browser, page, fakeCloud } = await openCloudPage({ authenticated: false });

  try {
    await fakeCloud.emitRemote(makeCloudState(600), 4);
    await page.waitForFunction(() => (
      document.querySelector('[data-rank-row="s1"] .rank-points')?.textContent.trim() === '600 分'
    ));
    assert.equal(await page.locator('[data-rank-row="s1"] .rank-points').textContent(), '600 分');
    assert.equal(await page.locator('#rankup-overlay.is-active').count(), 0);
  } finally {
    await browser.close();
  }
});

test('cached roster remains visible when the initial cloud load fails', async () => {
  const { browser, page } = await openCloudPage({
    cachedPayload: makeCloudState(300),
    failInitialLoad: true,
  });

  try {
    assert.equal(await page.locator('[data-rank-row="s1"] .rank-points').textContent(), '300 分');
    assert.match(await page.locator('#cloud-status').textContent(), /离线|同步失败/);
  } finally {
    await browser.close();
  }
});

test('reconnect loads the latest cloud row before updating the display', async () => {
  const { browser, page, fakeCloud } = await openCloudPage();

  try {
    await fakeCloud.setRecord(makeCloudState(600), 2);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.waitForSelector('#cloud-status.offline');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => globalThis.__fakeCloudControl.getLoadCalls() >= 2);
    await page.waitForFunction(() => (
      document.querySelector('[data-rank-row="s1"] .rank-points')?.textContent.trim() === '600 分'
    ));
    assert.equal(await fakeCloud.getLoadCalls(), 2);
    assert.match(await page.locator('#cloud-status').textContent(), /已同步/);
  } finally {
    await browser.close();
  }
});

test('failed save remains pending and retries after reconnect', async () => {
  const { browser, page, fakeCloud } = await openCloudPage({ authenticated: true });

  try {
    await page.click('#edit-button');
    await fakeCloud.failNextSave();
    const points = page.locator('input[data-student-id="s1"][data-field="totalPoints"]');
    await points.fill('300');
    await points.dispatchEvent('change');
    await page.waitForSelector('#cloud-status.failed');
    assert.notEqual(
      await page.evaluate(() => localStorage.getItem('youxuepai-leaderboard-pending-v1')),
      null,
    );

    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForSelector('#cloud-status.synced');
    assert.equal(
      await page.evaluate(() => localStorage.getItem('youxuepai-leaderboard-pending-v1')),
      null,
    );
  } finally {
    await browser.close();
  }
});

test('expired authentication closes editing and preserves unsynced data', async () => {
  const { browser, page, fakeCloud } = await openCloudPage({ authenticated: true });

  try {
    await page.click('#edit-button');
    await fakeCloud.failNextSave();
    const points = page.locator('input[data-student-id="s1"][data-field="totalPoints"]');
    await points.fill('300');
    await points.dispatchEvent('change');
    await page.waitForSelector('#cloud-status.failed');
    await fakeCloud.emitAuth('TOKEN_REFRESH_FAILED');

    assert.equal(await page.locator('#edit-drawer').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('#admin-logout').isVisible(), false);
    assert.notEqual(
      await page.evaluate(() => localStorage.getItem('youxuepai-leaderboard-pending-v1')),
      null,
    );
  } finally {
    await browser.close();
  }
});

test('an authenticated admin can inspect and restore a complete cloud snapshot', async () => {
  const oldPayload = makeCloudState(300);
  const currentPayload = makeCloudState(900);
  const { browser, page, fakeCloud } = await openCloudPage({
    authenticated: true,
    cloudPayload: currentPayload,
    history: [
      { id: 9, revision: 9, payload: currentPayload, created_at: '2026-08-11T05:00:00Z' },
      { id: 8, revision: 8, payload: oldPayload, created_at: '2026-08-11T04:00:00Z' },
    ],
  });

  try {
    await page.click('#edit-button');
    await page.click('#history-open');
    await page.waitForSelector('#history-dialog[open]');
    assert.equal(await page.locator('.history-version').count(), 2);
    assert.equal(await page.locator('[data-history-id="9"]').isDisabled(), true);

    await page.click('[data-history-id="8"]');
    await page.waitForSelector('#history-restore-dialog[open]');
    await page.click('#history-restore-confirm');
    await page.waitForFunction(() => !document.querySelector('#history-restore-dialog')?.open);

    assert.deepEqual(await fakeCloud.getRestoreCalls(), [8]);
    assert.match(await page.locator('#rank-list').textContent(), /300/);
    assert.match(await page.locator('#toast').textContent(), /已恢复到 v8/);
  } finally {
    await browser.close();
  }
});

test('a failed history restore preserves the current website state and can be retried', async () => {
  const oldPayload = makeCloudState(300);
  const currentPayload = makeCloudState(900);
  const { browser, page, fakeCloud } = await openCloudPage({
    authenticated: true,
    cloudPayload: currentPayload,
    failRestore: true,
    history: [
      { id: 9, revision: 9, payload: currentPayload, created_at: '2026-08-11T05:00:00Z' },
      { id: 8, revision: 8, payload: oldPayload, created_at: '2026-08-11T04:00:00Z' },
    ],
  });

  try {
    await page.click('#edit-button');
    await page.click('#history-open');
    await page.click('[data-history-id="8"]');
    await page.click('#history-restore-confirm');
    await page.waitForFunction(() => /恢复失败/.test(document.querySelector('#history-confirm-copy')?.textContent || ''));

    assert.deepEqual(await fakeCloud.getRestoreCalls(), [8]);
    assert.equal(await page.locator('#history-restore-dialog').getAttribute('open'), '');
    assert.match(await page.locator('#rank-list').textContent(), /900/);
    assert.equal(await page.locator('#history-restore-confirm').isDisabled(), false);
  } finally {
    await browser.close();
  }
});

test('history marks the revision created by the latest local save as current', async () => {
  const currentPayload = makeCloudState();
  const { browser, page, fakeCloud } = await openCloudPage({
    authenticated: true,
    cloudPayload: currentPayload,
    history: [
      { id: 1, revision: 1, payload: currentPayload, created_at: '2026-08-11T05:00:00Z' },
    ],
  });

  try {
    await page.click('#edit-button');
    const notebook = page.locator('input[data-student-id="s1"][data-field="notebook"]');
    await notebook.fill('5');
    await notebook.dispatchEvent('change');
    await page.waitForFunction(() => globalThis.__fakeCloudControl.getSavedPayloads().length === 1);
    await page.click('#history-open');

    assert.equal(await page.locator('[data-history-id="2"]').isDisabled(), true);
    assert.equal(await page.locator('[data-history-id="1"]').isDisabled(), false);
  } finally {
    await browser.close();
  }
});

test('opening history flushes an edit that is still waiting for the debounce timer', async () => {
  const currentPayload = makeCloudState();
  const { browser, page } = await openCloudPage({
    authenticated: true,
    cloudPayload: currentPayload,
    history: [
      { id: 1, revision: 1, payload: currentPayload, created_at: '2026-08-11T05:00:00Z' },
    ],
  });

  try {
    await page.click('#edit-button');
    const notebook = page.locator('input[data-student-id="s1"][data-field="notebook"]');
    await notebook.fill('5');
    await notebook.dispatchEvent('change');
    await page.click('#history-open');

    assert.equal(await page.locator('[data-history-id="2"]').isDisabled(), true);
    assert.equal(await page.locator('[data-history-id="1"]').isDisabled(), false);
  } finally {
    await browser.close();
  }
});

test('a restore in progress cannot be dismissed with Cancel or Escape', async () => {
  const oldPayload = makeCloudState(300);
  const currentPayload = makeCloudState(900);
  const { browser, page, fakeCloud } = await openCloudPage({
    authenticated: true,
    cloudPayload: currentPayload,
    holdRestore: true,
    history: [
      { id: 9, revision: 9, payload: currentPayload, created_at: '2026-08-11T05:00:00Z' },
      { id: 8, revision: 8, payload: oldPayload, created_at: '2026-08-11T04:00:00Z' },
    ],
  });

  try {
    await page.click('#edit-button');
    await page.click('#history-open');
    await page.click('[data-history-id="8"]');
    await page.click('#history-restore-confirm');
    await page.waitForFunction(() => globalThis.__fakeCloudControl.getRestoreCalls().length === 1);

    assert.equal(await page.locator('#history-restore-cancel').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#history-restore-dialog').getAttribute('open'), '');

    await fakeCloud.releaseRestore();
    await page.waitForFunction(() => !document.querySelector('#history-restore-dialog')?.open);
  } finally {
    await browser.close();
  }
});

test('Escape closes only restore confirmation and returns focus to its version', async () => {
  const oldPayload = makeCloudState(300);
  const currentPayload = makeCloudState(900);
  const { browser, page } = await openCloudPage({
    authenticated: true,
    cloudPayload: currentPayload,
    history: [
      { id: 9, revision: 9, payload: currentPayload, created_at: '2026-08-11T05:00:00Z' },
      { id: 8, revision: 8, payload: oldPayload, created_at: '2026-08-11T04:00:00Z' },
    ],
  });

  try {
    await page.click('#edit-button');
    await page.click('#history-open');
    await page.click('[data-history-id="8"]');
    await page.keyboard.press('Escape');

    assert.equal(await page.locator('#history-restore-dialog').getAttribute('open'), null);
    assert.equal(await page.locator('#history-dialog').getAttribute('open'), '');
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('data-history-id')),
      '8',
    );
  } finally {
    await browser.close();
  }
});

test('history summaries identify the rank-up audio stored in each version', async () => {
  const payload = makeCloudState(900);
  payload.rankupSound = {
    enabled: true,
    source: 'upload',
    style: 'horn',
    url: 'https://test.supabase.co/storage/v1/object/public/rankup-audio/main/victory.mp3',
    name: '冲刺号角',
    storagePath: 'main/victory.mp3',
    duration: 20,
    clipStart: 3,
    clipDuration: 5.2,
  };
  const { browser, page } = await openCloudPage({
    authenticated: true,
    cloudPayload: payload,
    history: [
      { id: 9, revision: 9, payload, created_at: '2026-08-11T05:00:00Z' },
    ],
  });

  try {
    await page.click('#edit-button');
    await page.click('#history-open');

    assert.match(await page.locator('.history-version').textContent(), /音效：冲刺号角/);
  } finally {
    await browser.close();
  }
});

test('a restored state remains successful when refreshing the history list fails', async () => {
  const oldPayload = makeCloudState(300);
  const currentPayload = makeCloudState(900);
  const { browser, page, fakeCloud } = await openCloudPage({
    authenticated: true,
    cloudPayload: currentPayload,
    history: [
      { id: 9, revision: 9, payload: currentPayload, created_at: '2026-08-11T05:00:00Z' },
      { id: 8, revision: 8, payload: oldPayload, created_at: '2026-08-11T04:00:00Z' },
    ],
  });

  try {
    await page.click('#edit-button');
    await page.click('#history-open');
    await page.click('[data-history-id="8"]');
    await fakeCloud.failNextHistoryRead();
    await page.click('#history-restore-confirm');
    await page.waitForFunction(() => !document.querySelector('#history-restore-dialog')?.open);

    assert.match(await page.locator('#rank-list').textContent(), /300/);
    assert.match(await page.locator('#toast').textContent(), /已恢复到 v8/);
    assert.match(await page.locator('#history-list').textContent(), /恢复成功.*刷新失败/);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'history-close');
  } finally {
    await browser.close();
  }
});

test('a restore overtaken by a newer cloud revision reports the conflict accurately', async () => {
  const oldPayload = makeCloudState(300);
  const currentPayload = makeCloudState(900);
  const newerPayload = makeCloudState(1200);
  const { browser, page } = await openCloudPage({
    authenticated: true,
    cloudPayload: currentPayload,
    supersedingPayload: newerPayload,
    history: [
      { id: 9, revision: 9, payload: currentPayload, created_at: '2026-08-11T05:00:00Z' },
      { id: 8, revision: 8, payload: oldPayload, created_at: '2026-08-11T04:00:00Z' },
    ],
  });

  try {
    await page.click('#edit-button');
    await page.click('#history-open');
    await page.click('[data-history-id="8"]');
    await page.click('#history-restore-confirm');
    await page.waitForFunction(() => !document.querySelector('#history-restore-dialog')?.open);

    assert.match(await page.locator('#rank-list').textContent(), /1200/);
    assert.match(await page.locator('#toast').textContent(), /云端已有更新.*最新版本/);
    assert.doesNotMatch(await page.locator('#toast').textContent(), /已恢复到 v8/);
  } finally {
    await browser.close();
  }
});

test('signing out of an open history dialog returns focus outside the hidden drawer', async () => {
  const payload = makeCloudState();
  const { browser, page, fakeCloud } = await openCloudPage({
    authenticated: true,
    cloudPayload: payload,
    history: [{ id: 1, revision: 1, payload, created_at: '2026-08-11T05:00:00Z' }],
  });

  try {
    await page.click('#edit-button');
    await page.click('#history-open');
    await fakeCloud.emitAuth('SIGNED_OUT');

    assert.equal(await page.locator('#history-dialog').getAttribute('open'), null);
    assert.equal(await page.locator('#edit-drawer').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'edit-button');
  } finally {
    await browser.close();
  }
});

test('changing a cloud rank-up sound keeps the old upload available to history', async () => {
  const payload = makeCloudState();
  payload.rankupSound = {
    enabled: true,
    source: 'upload',
    style: 'horn',
    url: 'https://test.supabase.co/storage/v1/object/public/rankup-audio/main/old.mp3',
    name: '旧晋级音乐',
    storagePath: 'main/old.mp3',
    duration: 12,
    clipStart: 0,
    clipDuration: 5.2,
  };
  const { browser, page, fakeCloud } = await openCloudPage({ authenticated: true, cloudPayload: payload });

  try {
    await page.click('#edit-button');
    await page.click('#rankup-sound-source-builtin');
    await page.selectOption('#rankup-sound-style', 'crystal');
    await page.waitForFunction(() => globalThis.__fakeCloudControl.getSavedPayloads().length === 1);

    assert.deepEqual(await fakeCloud.getRemoveCalls(), []);
  } finally {
    await browser.close();
  }
});

test('renders cloud status and password-only admin dialog', async () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  assert.match(html, /id="cloud-status"/);
  assert.match(html, /id="admin-login-dialog"/);
  assert.match(html, /id="admin-password"[^>]*type="password"/);
  assert.match(html, /id="admin-logout"/);
  assert.match(html, /自动同步到云端/);
  assert.doesNotMatch(html, /service[_ -]?role/i);

  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });

    assert.equal(await page.locator('#admin-logout').isVisible(), false);
    assert.equal(Math.round((await page.locator('#cloud-status').boundingBox()).height), 36);

    await page.locator('#admin-login-dialog').evaluate((dialog) => dialog.showModal());
    const dialogBox = await page.locator('#admin-login-dialog').boundingBox();
    assert.ok(dialogBox.x >= 15);
    assert.ok(dialogBox.x + dialogBox.width <= 375);
    assert.equal(await page.locator('#admin-password').getAttribute('autocomplete'), 'current-password');
  } finally {
    await browser.close();
  }
});

test('chooses a system when adding a course and switches systems by course', async () => {
  const payload = makeCloudState(0);
  const { browser, page, fakeCloud } = await openCloudPage({ authenticated: true, cloudPayload: payload });

  try {
    assert.equal(await page.locator('[data-layout-mode]').count(), 0);
    assert.equal(await page.locator('#current-course-system').innerText(), '四项习惯系统');
    await page.click('#class-switcher-button');
    await page.fill('#new-class-name', '成长挑战');
    await page.click('#add-class-form button[type="submit"]');
    await page.locator('#course-system-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-course-system]').count(), 2);
    await page.click('[data-course-system="custom"]');
    await page.locator('#custom-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#custom-course-title').innerText(), '成长挑战');
    assert.equal(await page.locator('#current-course-system').innerText(), '成长积分系统');
    assert.equal(await page.locator('#custom-class-pulse').count(), 1);
    assert.equal(await page.locator('#custom-winners-title').innerText(), '今日领跑者');
    assert.equal(await page.locator('#custom-winners-grid .winner-card').count(), 5);
    assert.equal(await page.locator('#custom-boards-title').innerText(), '五项课堂排行');
    assert.equal(await page.locator('#custom-boards-grid .score-board').count(), 5);
    assert.equal(await page.locator('#custom-collective-progress').getAttribute('role'), 'progressbar');
    const customBoardTops = await page.locator('#custom-boards-grid .score-board').evaluateAll((boards) => (
      boards.map((board) => Math.round(board.getBoundingClientRect().top))
    ));
    assert.equal(new Set(customBoardTops).size, 1);
    const customViewText = await page.locator('#custom-view').innerText();
    for (const label of ['准时先锋', '测评达人', '作业之星', '课堂活力', '预习先行']) {
      assert.match(customViewText, new RegExp(label));
    }

    await page.click('#edit-button');
    const punctuality = page.locator('input[data-student-id="class-2-student-1"][data-field="punctuality"]');
    await punctuality.fill('12');
    await punctuality.press('Tab');
    assert.equal(
      await page.locator('input[data-student-id="class-2-student-1"][readonly]').inputValue(),
      '12',
    );
    assert.match(await page.locator('#custom-collective-goal-copy').innerText(), /^12 \/ 15,000 分$/);
    await page.waitForTimeout(1000);
    const savedPayloads = await fakeCloud.getSavedPayloads();
    assert.ok(savedPayloads.length >= 1);
    const saved = savedPayloads.at(-1);
    const customCourse = saved.classes.find((course) => course.name === '成长挑战');
    assert.equal(Object.prototype.hasOwnProperty.call(saved, 'layoutMode'), false);
    assert.equal(customCourse.systemType, 'custom');
    assert.equal(customCourse.customLessonRecords['1']['class-2-student-1'].punctuality, 12);
    assert.equal(saved.classes[0].systemType, 'classic');
    assert.equal(saved.classes[0].students[0].notebook, 0);

    await page.click('#drawer-done');
    await page.click('[data-view="ranks"]');
    await page.locator('#ranks-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#rank-list .rank-row').count(), 1);
    assert.match(await page.locator('#rank-list .rank-points').innerText(), /12/);
    await page.click('#class-switcher-button');
    await page.click('[data-class-switch="class-1"]');
    assert.equal(await page.locator('#current-course-system').innerText(), '四项习惯系统');
    assert.equal(await page.locator('#ranks-view').isVisible(), true);
    assert.match(await page.locator('#rank-list .rank-points').innerText(), /0/);
    await page.click('[data-view="scores"]');
    await page.locator('#scores-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#custom-view').isVisible(), false);
  } finally {
    await browser.close();
  }
});

test('course system chooser fits mobile and cancel preserves the course draft', async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await page.click('#class-switcher-button');
    await page.fill('#new-class-name', '移动端成长课程');
    await page.click('#add-class-form button[type="submit"]');
    await page.locator('#course-system-dialog').waitFor({ state: 'visible' });

    const layout = await page.locator('#course-system-dialog').evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        viewportWidth: document.documentElement.clientWidth,
        pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        dialogOverflows: dialog.scrollWidth > dialog.clientWidth,
      };
    });
    assert.ok(layout.left >= 0);
    assert.ok(layout.right <= layout.viewportWidth);
    assert.equal(layout.pageOverflows, false);
    assert.equal(layout.dialogOverflows, false);
    assert.equal(await page.locator('[data-course-system]').count(), 2);

    await page.keyboard.press('Escape');
    await page.locator('#course-system-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#new-class-name').inputValue(), '移动端成长课程');

    await page.click('#add-class-form button[type="submit"]');
    await page.click('[data-course-system="custom"]');
    await page.locator('#custom-view').waitFor({ state: 'visible' });
    const customLayout = await page.locator('#custom-view').evaluate((view) => ({
      overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      winnerCount: view.querySelectorAll('#custom-winners-grid .winner-card').length,
      boardCount: view.querySelectorAll('#custom-boards-grid .score-board').length,
      winnerColumns: getComputedStyle(view.querySelector('#custom-winners-grid')).gridTemplateColumns.split(' ').length,
      boardColumns: getComputedStyle(view.querySelector('#custom-boards-grid')).gridTemplateColumns.split(' ').length,
      boardRegionScrolls: view.querySelector('#custom-boards-grid').scrollWidth > view.querySelector('#custom-boards-grid').clientWidth,
    }));
    assert.deepEqual(customLayout, {
      overflows: false,
      winnerCount: 5,
      boardCount: 5,
      winnerColumns: 1,
      boardColumns: 5,
      boardRegionScrolls: true,
    });
  } finally {
    await browser.close();
  }
});

test('exposes an accessible history entry, list, and restore confirmation', () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  const styles = fs.readFileSync(stylesPath, 'utf8');
  for (const id of [
    'history-open', 'history-count', 'history-dialog', 'history-list', 'history-close',
    'history-restore-dialog', 'history-restore-cancel', 'history-restore-confirm',
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /最近50个完整版本/);
  assert.match(html, /恢复会替换所有班级、积分、徽章和音效/);
  assert.match(styles, /\.history-version/);
  assert.match(styles, /\.history-restore-button/);
  assert.match(styles, /@media \(max-width: 600px\)/);
});

test('history keeps its footer visible and scrolls only the version list on short screens', async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    await page.evaluate(() => {
      document.querySelector('#history-list').innerHTML = Array.from({ length: 12 }, (_, index) => `
        <article class="history-version">
          <span class="history-version-number">v${12 - index}</span>
          <div><h3>自动保存</h3><p>1个班级 · 10名学员</p></div>
          <button class="history-restore-button" type="button">恢复此版本</button>
        </article>
      `).join('');
      document.querySelector('#history-dialog').showModal();
    });

    const layout = await page.evaluate(() => {
      const dialog = document.querySelector('#history-dialog');
      const list = document.querySelector('#history-list');
      const footer = document.querySelector('.history-footer');
      const noticeLabel = document.querySelector('.history-notice strong');
      return {
        dialogBottom: dialog.getBoundingClientRect().bottom,
        footerBottom: footer.getBoundingClientRect().bottom,
        listClientHeight: list.clientHeight,
        listScrollHeight: list.scrollHeight,
        noticeLabelWidth: noticeLabel.getBoundingClientRect().width,
      };
    });
    assert.ok(layout.footerBottom <= layout.dialogBottom + 1);
    assert.ok(layout.listScrollHeight > layout.listClientHeight);
    assert.ok(layout.noticeLabelWidth > 40);
  } finally {
    await browser.close();
  }
});

test('keeps animated SVG emblems sharp and moves blur onto sibling glow layers', () => {
  const css = fs.readFileSync(stylesPath, 'utf8');
  const landingStart = css.indexOf('@keyframes rankup-emblem-land');
  const landingEnd = css.indexOf('@keyframes rankup-emblem-float', landingStart);
  const landingKeyframes = css.slice(landingStart, landingEnd);

  assert.notEqual(landingStart, -1, 'rankup-emblem-land keyframes must exist');
  assert.notEqual(landingEnd, -1, 'rankup-emblem-land keyframes must be bounded');
  assert.doesNotMatch(landingKeyframes, /filter\s*:/);
  assert.doesNotMatch(landingKeyframes, /scale\(0\.0\d*\)/);
  assert.match(landingKeyframes, /scale\(0\.72\)/);
  assert.match(css, /\.rankup-emblem-glow\s*\{[\s\S]*?filter:\s*blur\(/);
  assert.match(css, /\.rankup-old-emblem,\s*\n\.rankup-new-emblem\s*\{[\s\S]*?filter:\s*none;/);
  assert.match(css, /\.rankup-emblem-art\s*\{[\s\S]*?shape-rendering:\s*geometricPrecision;/);
  assert.match(css, /\.rankup-overlay\.is-revealed \.rankup-new-emblem\s*\{[\s\S]*?animation:\s*none;/);
});

test('versions runtime assets so browsers load the current leaderboard release', () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  for (const asset of [
    'styles.css',
    'vendor/lucide.min.js',
    'vendor/supabase.min.js',
    'src/rank-rules.js',
    'src/state.js',
    'src/cloud-config.js',
    'src/cloud.js',
    'src/rankup-sound.js',
    'src/app.js',
  ]) {
    assert.equal(html.includes(`${asset}?v=20260820-growth-layout-v2`), true, `${asset} must be versioned`);
  }
});

test('shows the coach-defined rank thresholds in both leaderboard views', () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  assert.match(html, /300[\s·/]+600[\s·/]+1000[\s·/]+1600[\s·/]+2200[\s·/]+3000/);
  assert.doesNotMatch(html, /每 300 分升一档/);
});

test('exposes cloud sound sources and a fixed clip editor', () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  for (const id of [
    'rankup-sound-source-builtin',
    'rankup-sound-source-upload',
    'rankup-sound-source-url',
    'rankup-sound-file',
    'rankup-sound-url',
    'rankup-sound-load-url',
    'rankup-clip-editor',
    'rankup-clip-start',
    'rankup-clip-range',
    'rankup-sound-preview',
    'rankup-sound-save-clip',
    'rankup-sound-reset',
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="rankup-sound-style"/);
  assert.match(html, /王者号角/);
  assert.match(html, /水晶解锁/);
  assert.match(html, /星耀冲刺/);
  assert.match(html, /id="rankup-sound-enabled"/);
  assert.match(html, /固定 5\.2 秒/);
  assert.match(html, /所有设备同步/);
  assert.match(html, /src\/rankup-sound\.js\?v=20260820-growth-layout-v2/);
});

test('saves a selected 5.2 second URL clip into cloud app state', async () => {
  const { browser, page, fakeCloud } = await openCloudPage({ authenticated: true });

  try {
    await page.evaluate(() => {
      globalThis.RankupSound.inspectAudio = async () => ({ duration: 30 });
    });
    await page.click('#edit-button');
    await page.click('#rankup-sound-source-url');
    await page.fill('#rankup-sound-url', 'https://example.com/class.mp3');
    await page.click('#rankup-sound-load-url');
    await page.locator('#rankup-clip-start').evaluate((input) => {
      input.value = '12.4';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.locator('#rankup-clip-range').textContent(), '00:12.4 - 00:17.6');
    await page.click('#rankup-sound-save-clip');
    await page.waitForSelector('#cloud-status.synced');

    const payload = (await fakeCloud.getSavedPayloads()).at(-1);
    assert.equal(payload.rankupSound.source, 'url');
    assert.equal(payload.rankupSound.url, 'https://example.com/class.mp3');
    assert.equal(payload.rankupSound.clipStart, 12.4);
    assert.equal(payload.rankupSound.clipDuration, 5.2);
  } finally {
    await browser.close();
  }
});

test('uploads a music file and syncs its selected clip', async () => {
  const { browser, page, fakeCloud } = await openCloudPage({ authenticated: true });

  try {
    await page.evaluate(() => {
      globalThis.RankupSound.inspectAudio = async () => ({ duration: 24 });
    });
    await page.click('#edit-button');
    await page.click('#rankup-sound-source-upload');
    await page.setInputFiles('#rankup-sound-file', {
      name: 'class-sprint.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('test audio fixture'),
    });
    await page.waitForSelector('#rankup-clip-editor:not([hidden])');
    await page.locator('#rankup-clip-start').evaluate((input) => {
      input.value = '8.1';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#rankup-sound-save-clip');
    await page.waitForSelector('#cloud-status.synced');

    const uploads = await fakeCloud.getUploadCalls();
    const payload = (await fakeCloud.getSavedPayloads()).at(-1);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].bucket, 'rankup-audio');
    assert.equal(uploads[0].name, 'class-sprint.mp3');
    assert.equal(payload.rankupSound.source, 'upload');
    assert.match(payload.rankupSound.url, /rankup-audio\/main\//);
    assert.match(payload.rankupSound.storagePath, /^main\//);
    assert.equal(payload.rankupSound.clipStart, 8.1);
    assert.equal(payload.rankupSound.duration, 24);
  } finally {
    await browser.close();
  }
});

test('plays the synced rank-up clip and stops it when the animation is skipped', async () => {
  const cloudPayload = makeCloudState();
  cloudPayload.rankupSound = {
    enabled: true,
    source: 'url',
    style: 'crystal',
    url: 'https://example.com/class.mp3',
    name: '课堂冲刺',
    storagePath: '',
    duration: 30,
    clipStart: 12.4,
    clipDuration: 5.2,
  };
  const { browser, page } = await openCloudPage({ authenticated: true, cloudPayload });

  try {
    await page.evaluate(() => {
      globalThis.__rankupSoundCalls = [];
      globalThis.__rankupSoundStops = 0;
      globalThis.RankupSound.playSettings = (settings) => {
        globalThis.__rankupSoundCalls.push(settings);
        return {
          started: true,
          kind: 'custom',
          stop() { globalThis.__rankupSoundStops += 1; },
        };
      };
    });
    await page.click('#edit-button');
    const points = page.locator('input[data-student-id="s1"][data-field="totalPoints"]');
    await points.fill('300');
    await points.dispatchEvent('change');
    await page.waitForSelector('#rankup-overlay.is-active');
    assert.deepEqual(await page.evaluate(() => globalThis.__rankupSoundCalls), [cloudPayload.rankupSound]);

    await page.click('#rankup-skip');
    assert.equal(await page.evaluate(() => globalThis.__rankupSoundStops), 1);
  } finally {
    await browser.close();
  }
});

test('header brand names 优学湃素养中心 beside the logo', async () => {
  assert.equal(fs.existsSync(indexPath), true, 'index.html must exist');
  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    assert.equal(await page.locator('.brand-copy strong').textContent(), '优学湃素养中心');
  } finally {
    await browser.close();
  }
});

test('uses the math pattern asset on the leaderboard background', async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    const backgroundImage = await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundImage);
    assert.match(backgroundImage, /math-pattern\.svg/);
  } finally {
    await browser.close();
  }
});

test('defines one distinct reusable SVG emblem for every rank', async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    const symbolIds = await page.locator('#rank-emblem-sprite symbol').evaluateAll((symbols) => (
      symbols.map((symbol) => symbol.id)
    ));
    assert.deepEqual(symbolIds, [
      'rank-emblem-bronze',
      'rank-emblem-silver',
      'rank-emblem-gold',
      'rank-emblem-platinum',
      'rank-emblem-diamond',
      'rank-emblem-star',
      'rank-emblem-king',
    ]);
    const symbolContents = await page.locator('#rank-emblem-sprite symbol').evaluateAll((symbols) => (
      symbols.map((symbol) => symbol.innerHTML.replaceAll(/\s+/g, ' ').trim())
    ));
    assert.equal(new Set(symbolContents).size, 7);
  } finally {
    await browser.close();
  }
});

test('renders the motivation band and academy shield badge contract', async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });

    assert.equal(await page.locator('#class-pulse').count(), 1);
    assert.equal(await page.locator('#collective-progress').getAttribute('role'), 'progressbar');
    assert.match(await page.locator('#progress-star').textContent(), /进步之星/);
    assert.match(await page.locator('#latest-honor').textContent(), /最新荣誉/);

    const notebookBadge = page.locator('.module-badge[data-module-field="notebook"]').first();
    assert.equal(await notebookBadge.getAttribute('data-badge-level'), 'white');
    assert.equal(await notebookBadge.getAttribute('data-badge-stars'), '1');
    assert.equal(await notebookBadge.locator('svg').count(), 1);

    await page.click('#edit-button');
    assert.equal(await page.locator('#collective-goal-input').inputValue(), '15000');
    await page.locator('#collective-goal-input').fill('20000');
    await page.locator('#collective-goal-input').dispatchEvent('change');
    await page.click('#drawer-done');
    assert.match(await page.locator('#class-pulse').textContent(), /20,000/);
  } finally {
    await browser.close();
  }
});

test('shows the renamed lesson title and sums a new lesson into cumulative points', async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    assert.equal(await page.locator('#scores-title').textContent(), '本节课积分排行榜');
    await page.click('#edit-button');
    await page.locator('#lesson-input').fill('2');
    await page.locator('#lesson-input').dispatchEvent('change');
    const moduleInput = page.locator('input[data-student-id="s9"][data-field="module"]');
    await moduleInput.fill('10');
    await moduleInput.dispatchEvent('change');
    assert.equal(await page.locator('input[data-student-id="s9"][data-field="totalPoints"]').inputValue(), '10');
    await page.click('#drawer-done');
    await page.click('[data-view="ranks"]');
    assert.equal(await page.locator('[data-rank-row="s9"] .rank-points').textContent(), '10 分');
  } finally {
    await browser.close();
  }
});

test('editing points updates rank, plays the v2 promotion animation, and persists', async () => {
  assert.equal(fs.existsSync(indexPath), true, 'index.html must exist');
  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });

    await page.click('#edit-button');
    const pointsInput = page.locator('input[data-student-id="s9"][data-field="totalPoints"]');
    await pointsInput.fill('1200');
    await pointsInput.dispatchEvent('change');

    await page.waitForSelector('#rankup-overlay.is-active');
    assert.equal(await page.locator('#rankup-overlay').getAttribute('data-rank-class'), 'platinum');
    assert.equal(await page.locator('#rankup-video').count(), 0);
    assert.equal(await page.locator('#rankup-overlay').getAttribute('data-animation'), 'rankup-v2');
    assert.equal(await page.locator('#rankup-new-emblem .rank-emblem-art').count(), 1);
    assert.equal(
      await page.locator('#rankup-new-emblem-use').getAttribute('href'),
      '#rank-emblem-platinum',
    );
    assert.equal(
      await page.locator('#rankup-old-emblem-use').getAttribute('href'),
      '#rank-emblem-bronze',
    );
    assert.equal(await page.locator('.rankup-lightning i').count(), 4);
    assert.equal(await page.locator('.rankup-shards i').count(), 12);
    assert.equal(await page.locator('.rankup-shockwave').count(), 2);
    assert.equal(await page.locator('.rankup-rune-ring').count(), 1);
    assert.equal(await page.locator('.rankup-beam-field i').count(), 4);
    const stageBounds = await page.locator('.rankup-animation-stage').boundingBox();
    assert.ok(stageBounds.height <= 900, `promotion stage height ${stageBounds.height}px must stay inside the viewport`);
    assert.ok(stageBounds.width <= 1440, `promotion stage width ${stageBounds.width}px must stay inside the viewport`);
    assert.match(await page.locator('#rankup-new-rank').textContent(), /铂金/);
    await page.waitForSelector('#rankup-overlay.is-revealed', { timeout: 6500 });
    assert.equal(await page.locator('#rankup-overlay').getAttribute('aria-hidden'), 'false');
    assert.equal(await page.locator('#rankup-close').isEnabled(), true);
    const emblemGeometry = await page.evaluate(() => {
      const wrapper = document.querySelector('#rankup-new-emblem').getBoundingClientRect();
      const art = document.querySelector('#rankup-new-emblem .rank-emblem-art').getBoundingClientRect();
      return { wrapperWidth: wrapper.width, wrapperHeight: wrapper.height, artWidth: art.width, artHeight: art.height };
    });
    assert.ok(Math.abs(emblemGeometry.artWidth - emblemGeometry.wrapperWidth) < 1);
    assert.ok(Math.abs(emblemGeometry.artHeight - emblemGeometry.wrapperHeight) < 1);
    await page.click('#rankup-close');
    assert.equal(await page.locator('#rankup-overlay').evaluate((element) => element.classList.contains('is-active')), false);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'edit-button');
    await page.click('[data-view="ranks"]');
    assert.equal(await page.locator('[data-rank-row="s9"] .rank-name').textContent(), '尊贵铂金');
    assert.equal(
      await page.locator('[data-rank-row="s9"] .rank-emblem-use').getAttribute('href'),
      '#rank-emblem-platinum',
    );

    await page.reload({ waitUntil: 'load' });
    await page.click('#edit-button');
    assert.equal(await page.locator('input[data-student-id="s9"][data-field="totalPoints"]').inputValue(), '1200');

    await page.setViewportSize({ width: 390, height: 844 });
    const mobilePointsInput = page.locator('input[data-student-id="s10"][data-field="totalPoints"]');
    await mobilePointsInput.fill('900');
    await mobilePointsInput.dispatchEvent('change');
    await page.waitForSelector('#rankup-overlay.is-active', { timeout: 5000 });
    const mobileGeometry = await page.evaluate(() => {
      const stage = document.querySelector('.rankup-animation-stage').getBoundingClientRect();
      return {
        stageLeft: stage.left,
        stageTop: stage.top,
        stageRight: stage.right,
        stageBottom: stage.bottom,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        rootOverflow: getComputedStyle(document.documentElement).overflow,
        bodyOverflow: getComputedStyle(document.body).overflow,
      };
    });
    assert.ok(mobileGeometry.stageLeft >= -1 && mobileGeometry.stageRight <= 391);
    assert.ok(mobileGeometry.stageTop >= -1 && mobileGeometry.stageBottom <= 845);
    assert.ok(mobileGeometry.documentWidth <= mobileGeometry.viewportWidth);
    assert.equal(mobileGeometry.rootOverflow, 'hidden');
    assert.equal(mobileGeometry.bodyOverflow, 'hidden');
    assert.equal(await page.locator('#rankup-new-emblem').isVisible(), true);
    const mobileEmblem = await page.locator('#rankup-new-emblem').boundingBox();
    const mobileEmblemCssWidth = await page.locator('#rankup-new-emblem').evaluate((element) => (
      Number.parseFloat(getComputedStyle(element).width)
    ));
    assert.ok(mobileEmblemCssWidth <= 280);
    assert.ok(mobileEmblem.width <= 280);
    assert.ok(mobileEmblem.height <= 280);
    await page.click('#rankup-skip');
    await page.click('#rankup-close');
  } finally {
    await browser.close();
  }
});

test('reduced motion reveals promotion result without running effect layers', async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });

  try {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await page.click('#edit-button');
    const points = page.locator('input[data-student-id="s9"][data-field="totalPoints"]');
    await points.fill('900');
    await points.dispatchEvent('change');
    await page.waitForSelector('#rankup-overlay.is-revealed');
    assert.equal(await page.locator('#rankup-close').isEnabled(), true);
    for (const selector of [
      '.rankup-lightning',
      '.rankup-vortex',
      '.rankup-mega-burst',
      '.rankup-shockwave.inner',
      '.rankup-shards',
      '.rankup-beam-field',
    ]) {
      assert.equal(
        await page.locator(selector).evaluate((element) => getComputedStyle(element).display),
        'none',
        `${selector} should be disabled when reduced motion is requested`,
      );
    }
  } finally {
    await browser.close();
  }
});

test('editing a module badge updates only that badge and persists without rank promotion', async () => {
  assert.equal(fs.existsSync(indexPath), true, 'index.html must exist');
  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(3000);
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });

    const originalPoints = await page.locator('[data-rank-row="s9"] .rank-points').textContent();
    await page.click('#edit-button');
    const purpleNotebook = page.locator('button[data-badge-student-id="s9"][data-badge-field="notebook"][data-badge-level="purple"]');
    await purpleNotebook.click();

    assert.equal(await purpleNotebook.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('input[data-student-id="s9"][data-field="totalPoints"]').inputValue(), '0');
    assert.equal(await page.locator('#rankup-overlay').evaluate((element) => element.classList.contains('is-active')), false);

    await page.click('#drawer-done');
    assert.equal(
      await page.locator('[data-board-field="notebook"] [data-board-student="s9"] .module-badge.purple').count(),
      1,
    );
    assert.equal(
      await page.locator('[data-board-field="errorBook"] [data-board-student="s9"] .module-badge.white').count(),
      1,
    );
    assert.equal(await page.locator('[data-rank-row="s9"] .rank-points').textContent(), originalPoints);

    await page.click('#class-switcher-button');
    await page.fill('#new-class-name', '徽章隔离班');
    await page.click('#add-class-form button[type="submit"]');
    await page.click('[data-course-system="classic"]');
    await page.click('#edit-button');
    const secondClassYellow = page.locator('button[data-badge-student-id="class-2-student-1"][data-badge-field="notebook"][data-badge-level="yellow"]');
    await secondClassYellow.click();
    assert.equal(await secondClassYellow.getAttribute('aria-pressed'), 'true');
    await page.click('#drawer-done');
    assert.equal(
      await page.locator('[data-board-field="notebook"] [data-board-student="class-2-student-1"] .module-badge.yellow').count(),
      1,
    );

    await page.click('#class-switcher-button');
    await page.click('[data-class-switch="class-1"]');
    assert.equal(
      await page.locator('[data-board-field="notebook"] [data-board-student="s9"] .module-badge.purple').count(),
      1,
    );

    await page.reload({ waitUntil: 'load' });
    await page.click('#edit-button');
    assert.equal(await purpleNotebook.getAttribute('aria-pressed'), 'true');
  } finally {
    await browser.close();
  }
});

test('creates, switches, and persists independent classrooms', async () => {
  assert.equal(fs.existsSync(indexPath), true, 'index.html must exist');
  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(3000);
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });

    await page.click('#class-switcher-button');
    assert.equal(await page.locator('#class-switcher-button').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#class-switcher-button').getAttribute('aria-haspopup'), null);
    await page.locator('#new-class-name').fill('启航二班');
    await page.locator('#add-class-form button[type="submit"]').click();
    await page.click('[data-course-system="classic"]');
    assert.equal(await page.locator('#current-class-name').textContent(), '启航二班');

    await page.click('#edit-button');
    await page.locator('#lesson-input').fill('3');
    await page.locator('#lesson-input').dispatchEvent('change');
    await page.click('#drawer-done');

    await page.click('#class-switcher-button');
    await page.click('[data-class-switch="class-1"]');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'class-switcher-button');
    assert.match(await page.locator('#lesson-subtitle').textContent(), /第 1 节课/);

    await page.reload({ waitUntil: 'load' });
    await page.click('#class-switcher-button');
    assert.equal(await page.locator('[data-class-row]').count(), 2);
    await page.click('[data-class-switch="class-2"]');
    assert.equal(await page.locator('#current-class-name').textContent(), '启航二班');
    assert.match(await page.locator('#lesson-subtitle').textContent(), /第 3 节课/);
  } finally {
    await browser.close();
  }
});

test('canceling student deletion preserves the student and the final student stays protected', async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(3000);
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });

    await page.click('#edit-button');
    const initialCount = await page.locator('[data-editor-row]').count();
    let confirmationMessage = '';
    page.once('dialog', async (dialog) => {
      confirmationMessage = dialog.message();
      await dialog.dismiss();
    });
    await page.click('[data-delete-student="s1"]');
    assert.match(confirmationMessage, /删除.*崔晟宸/);
    assert.equal(await page.locator('[data-editor-row]').count(), initialCount);
    assert.equal(await page.locator('input[data-student-id="s1"][data-field="name"]').inputValue(), '崔晟宸');

    await page.click('#drawer-done');
    await page.click('#class-switcher-button');
    await page.fill('#new-class-name', '单人班');
    await page.click('#add-class-form button[type="submit"]');
    await page.click('[data-course-system="classic"]');
    await page.click('#edit-button');
    assert.equal(await page.locator('[data-editor-row]').count(), 1);
    assert.equal(await page.locator('[data-delete-student]').isDisabled(), true);

    let restoreMessage = '';
    page.once('dialog', async (dialog) => {
      restoreMessage = dialog.message();
      await dialog.dismiss();
    });
    await page.click('#restore-data');
    assert.match(restoreMessage, /当前班级的修改将被覆盖/);
  } finally {
    await browser.close();
  }
});

test('class rename submit, cancel, and deletion return focus to the switcher', async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(3000);
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });

    await page.click('#class-switcher-button');
    await page.fill('#new-class-name', '待维护班级');
    await page.click('#add-class-form button[type="submit"]');
    await page.click('[data-course-system="classic"]');
    await page.click('#class-switcher-button');
    const interactionStates = [];

    await page.click('[data-class-rename="class-2"]');
    await page.fill('.class-rename-input', '已重命名班级');
    await page.click('.class-save-button');
    interactionStates.push({
      branch: 'submit',
      focusId: await page.evaluate(() => document.activeElement?.id),
      expanded: await page.locator('#class-switcher-button').getAttribute('aria-expanded'),
      menuVisible: await page.locator('#class-switcher-menu').isVisible(),
    });

    await page.click('[data-class-rename="class-2"]');
    await page.click('[data-class-rename-cancel="class-2"]');
    interactionStates.push({
      branch: 'cancel',
      focusId: await page.evaluate(() => document.activeElement?.id),
      expanded: await page.locator('#class-switcher-button').getAttribute('aria-expanded'),
      menuVisible: await page.locator('#class-switcher-menu').isVisible(),
    });

    page.once('dialog', (dialog) => dialog.accept());
    await page.click('[data-class-delete="class-2"]');
    interactionStates.push({
      branch: 'delete',
      focusId: await page.evaluate(() => document.activeElement?.id),
      expanded: await page.locator('#class-switcher-button').getAttribute('aria-expanded'),
      menuVisible: await page.locator('#class-switcher-menu').isVisible(),
    });

    assert.deepEqual(interactionStates, [
      { branch: 'submit', focusId: 'class-switcher-button', expanded: 'true', menuVisible: true },
      { branch: 'cancel', focusId: 'class-switcher-button', expanded: 'true', menuVisible: true },
      { branch: 'delete', focusId: 'class-switcher-button', expanded: 'true', menuVisible: true },
    ]);
  } finally {
    await browser.close();
  }
});

test('rank rows stay inside their container at tablet widths', async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(resolveBrowserExecutable() ? { executablePath: resolveBrowserExecutable() } : {}),
  });

  try {
    const page = await browser.newPage({ viewport: { width: 850, height: 900 } });
    page.setDefaultTimeout(3000);
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await page.click('[data-view="ranks"]');

    for (const width of [761, 800, 850]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.rank-row')];
        const clippedRows = rows.filter((row) => {
          const rowRect = row.getBoundingClientRect();
          return [...row.children].some((child) => {
            const childRect = child.getBoundingClientRect();
            return childRect.left < rowRect.left - 1 || childRect.right > rowRect.right + 1;
          });
        }).length;
        return {
          clippedRows,
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
        };
      });
      assert.equal(geometry.clippedRows, 0, `${width}px must not clip rank row content`);
      assert.ok(geometry.documentWidth <= geometry.viewportWidth, `${width}px must not overflow horizontally`);
    }
  } finally {
    await browser.close();
  }
});
