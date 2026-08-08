const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const projectRoot = path.join(__dirname, '..');
const indexPath = path.join(projectRoot, 'index.html');
const stylesPath = path.join(projectRoot, 'styles.css');

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
} = {}) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(3000);
  await page.addInitScript(({
    isAuthenticated,
    initialPayload,
    cachedState,
    shouldFailInitialLoad,
  }) => {
    let signedIn = isAuthenticated;
    let nextLoginError = null;
    let failNextLoad = shouldFailInitialLoad;
    let failNextSave = false;
    let loadCalls = 0;
    let authCallback = null;
    let remoteCallback = null;
    const record = {
      payload: initialPayload,
      revision: 1,
      updated_at: '2026-08-08T00:00:00.000Z',
    };
    const savedPayloads = [];

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
      from() {
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
        savedPayloads.push(params.p_payload);
        return {
          async single() {
            if (failNextSave) {
              failNextSave = false;
              return { data: null, error: new Error('save unavailable') };
            }
            record.payload = params.p_payload;
            record.revision += 1;
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
    };
  }, {
    isAuthenticated: authenticated,
    initialPayload: makeCloudState(),
    cachedState: cachedPayload,
    shouldFailInitialLoad: failInitialLoad,
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
    const points = page.locator('input[data-student-id="s1"][data-field="totalPoints"]');
    await points.fill('300');
    await points.dispatchEvent('change');
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
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
    'src/app.js',
  ]) {
    assert.equal(html.includes(`${asset}?v=20260808-cloud-v1`), true, `${asset} must be versioned`);
  }
});

test('header brand names 优学湃素养中心 beside the logo', async () => {
  assert.equal(fs.existsSync(indexPath), true, 'index.html must exist');
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });

    await page.click('#edit-button');
    const pointsInput = page.locator('input[data-student-id="s9"][data-field="totalPoints"]');
    await pointsInput.fill('900');
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
    assert.equal(await page.locator('input[data-student-id="s9"][data-field="totalPoints"]').inputValue(), '900');

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
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
