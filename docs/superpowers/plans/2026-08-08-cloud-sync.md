# 优学湃积分排行榜云同步实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有 GitHub Pages 排行榜接入 Supabase，实现公开只读、共享密码编辑、跨设备实时同步和离线缓存。

**Architecture:** GitHub Pages 继续托管静态页面，Supabase Database 用单条 JSONB 记录保存完整 `appState`，Supabase Auth 用一个共享管理员账号限制写入，Realtime 广播更高 revision 的更新。新的 `src/cloud.js` 隔离认证和网络逻辑，`src/app.js` 只协调本地状态、界面和云端接口。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Supabase Postgres/Auth/Realtime、`@supabase/supabase-js` 2.112.2、Node test runner、Playwright、GitHub Pages。

---

## 文件结构

- Create: `supabase/migrations/2026080801_leaderboard_state.sql` - 表、RLS、原子保存函数和 Realtime 配置。
- Create: `supabase/seed/leaderboard_state.sql` - 用已创建管理员 UID 写入 10 人初始数据。
- Create: `src/cloud-config.js` - 项目 URL、anon key、主记录 ID、共享账号邮箱。
- Create: `src/cloud.js` - 认证、读取、排队保存、重试、Realtime 订阅和状态事件。
- Create: `vendor/supabase.min.js` - 固定版本的 Supabase 浏览器 SDK。
- Create: `tests/cloud.test.cjs` - 云端模块单元测试。
- Modify: `index.html` - 同步状态、登录对话框、退出管理按钮和脚本顺序。
- Modify: `styles.css` - 紧凑同步状态及登录对话框样式。
- Modify: `src/app.js` - 登录门禁、本地缓存、云端初始化、保存和远端应用。
- Modify: `tests/ui.test.cjs` - 登录、只读、同步、离线和回归测试。
- Modify: `.gitignore` - 只放行新增运行文件，数据库迁移和测试仍使用显式 `git add -f`。

## Task 1: 创建 Supabase 项目、管理员和安全数据库

**Files:**
- Create: `supabase/migrations/2026080801_leaderboard_state.sql`
- Create: `supabase/seed/leaderboard_state.sql`

- [ ] **Step 1: 创建免费 Supabase 项目**

在 Supabase Dashboard 使用用户自己的账号登录，创建名为 `youxuepai-leaderboard` 的 Free 项目，区域选择离主要使用地点较近的 Singapore。数据库密码由用户本人输入并保存，不能发送到聊天、写入仓库或出现在命令输出中。

记录 Dashboard 中显示的 Project URL 和 anon public key。它们是客户端公开配置。不要复制 service role key。

- [ ] **Step 2: 创建共享管理员用户**

在 Authentication -> Users 中创建一个共享管理员用户。邮箱由用户提供，密码由用户本人在 Dashboard 中输入，勾选邮箱已确认。记录该用户 UID；邮箱和 UID可进入客户端配置或种子 SQL，密码不可进入任何文件。

- [ ] **Step 3: 写数据库迁移**

创建 `supabase/migrations/2026080801_leaderboard_state.sql`：

```sql
create table if not exists public.leaderboard_state (
  id text primary key check (id = 'main'),
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default timezone('utc', now()),
  owner_id uuid not null references auth.users(id)
);

alter table public.leaderboard_state enable row level security;

drop policy if exists "public leaderboard read" on public.leaderboard_state;
create policy "public leaderboard read"
on public.leaderboard_state for select
to anon, authenticated
using (true);

drop policy if exists "owner leaderboard update" on public.leaderboard_state;
create policy "owner leaderboard update"
on public.leaderboard_state for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

revoke all on public.leaderboard_state from anon, authenticated;
grant select on public.leaderboard_state to anon, authenticated;
grant update on public.leaderboard_state to authenticated;

create or replace function public.save_leaderboard_state(p_payload jsonb)
returns table(payload jsonb, revision bigint, updated_at timestamptz)
language sql
security invoker
set search_path = public
as $$
  update public.leaderboard_state
  set payload = p_payload,
      revision = leaderboard_state.revision + 1,
      updated_at = timezone('utc', now())
  where id = 'main' and auth.uid() = owner_id
  returning leaderboard_state.payload,
            leaderboard_state.revision,
            leaderboard_state.updated_at;
$$;

revoke all on function public.save_leaderboard_state(jsonb) from public;
grant execute on function public.save_leaderboard_state(jsonb) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'leaderboard_state'
  ) then
    alter publication supabase_realtime add table public.leaderboard_state;
  end if;
end $$;
```

- [ ] **Step 4: Apply the migration and verify policies**

在 Supabase SQL Editor 执行迁移。随后执行：

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename = 'leaderboard_state';

select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'leaderboard_state'
order by policyname;
```

Expected: `rowsecurity = true`，且只有公开 `SELECT` 和管理员 `UPDATE` 两条策略。

- [ ] **Step 5: Seed the confirmed roster**

创建 `supabase/seed/leaderboard_state.sql`。新项目在此时必须只有 Step 2 创建的一个 Auth 用户；SQL 会在数量不为 1 时主动停止，避免把所有权给错账号：

```sql
do $$
begin
  if (select count(*) from auth.users) <> 1 then
    raise exception 'Expected exactly one shared editor user before seeding';
  end if;
end $$;

with roster(name, position) as (
  values
    ('崔晟宸', 1),
    ('陆怡辰', 2),
    ('李梓玉', 3),
    ('李栩嘉', 4),
    ('韩宝锐', 5),
    ('杨晴雯', 6),
    ('刘洛扬', 7),
    ('王浩蕴', 8),
    ('孙亦康', 9),
    ('黄诗茹', 10)
), normalized as (
  select 's' || position as student_id, name, position
  from roster
), state_parts as (
  select
    jsonb_agg(
      jsonb_build_object(
        'id', student_id,
        'name', name,
        'notebook', 0,
        'errorBook', 0,
        'draft', 0,
        'module', 0,
        'totalPoints', 0,
        'badges', jsonb_build_object(
          'notebook', 'white',
          'errorBook', 'white',
          'draft', 'white',
          'module', 'white'
        )
      ) order by position
    ) as students,
    jsonb_object_agg(
      student_id,
      jsonb_build_object('notebook', 0, 'errorBook', 0, 'draft', 0, 'module', 0)
    ) as lesson_one,
    jsonb_object_agg(student_id, to_jsonb(0)) as carryover
  from normalized
), seed as (
  select jsonb_build_object(
    'activeClassId', 'class-1',
    'classes', jsonb_build_array(jsonb_build_object(
      'id', 'class-1',
      'name', '暑假学习技能训练',
      'lesson', 1,
      'students', students,
      'collectiveGoal', 15000,
      'previousScores', '{}'::jsonb,
      'honorEvents', '[]'::jsonb,
      'lessonRecords', jsonb_build_object('1', lesson_one),
      'carryoverPoints', carryover
    ))
  ) as payload
  from state_parts
), editor as (
  select id from auth.users limit 1
)
insert into public.leaderboard_state (id, payload, revision, owner_id)
select 'main', seed.payload, 1, editor.id
from seed cross join editor
on conflict (id) do update
set payload = excluded.payload,
    revision = public.leaderboard_state.revision + 1,
    owner_id = excluded.owner_id,
    updated_at = timezone('utc', now());
```

执行后查询 `payload #>> '{classes,0,name}'`、`jsonb_array_length(payload #> '{classes,0,students}')` 和总积分，分别期望“暑假学习技能训练”、`10`、`0`。

- [ ] **Step 6: Commit database artifacts**

```bash
git add -f supabase/migrations/2026080801_leaderboard_state.sql supabase/seed/leaderboard_state.sql
git commit -m "feat: add secure leaderboard cloud schema"
```

## Task 2: 以测试驱动实现云端适配器

**Files:**
- Create: `tests/cloud.test.cjs`
- Create: `src/cloud.js`

- [ ] **Step 1: Write failing cloud adapter tests**

测试覆盖以下公开接口：

```js
const Cloud = require('../src/cloud.js');

test('loads and normalizes the main cloud record', async () => {
  const fake = createFakeSupabase({ payload: { classes: [{ id: 'c1', students: [{ id: 's1', name: '甲' }] }] }, revision: 3 });
  const cloud = Cloud.createCloudSync({ client: fake.client, normalize: (value) => ({ ...value, normalized: true }) });
  const row = await cloud.load();
  assert.equal(row.revision, 3);
  assert.equal(row.payload.normalized, true);
});

test('signs in with configured email and never stores the password', async () => {
  const fake = createFakeSupabase();
  const cloud = Cloud.createCloudSync({ client: fake.client, editorEmail: 'coach@example.com', normalize: (value) => value });
  await cloud.signIn('secret-value');
  assert.deepEqual(fake.signInCalls, [{ email: 'coach@example.com', password: 'secret-value' }]);
  assert.equal(JSON.stringify(cloud).includes('secret-value'), false);
});

test('debounces saves and keeps only the newest payload', async () => {
  const fake = createFakeSupabase();
  const statuses = [];
  const cloud = Cloud.createCloudSync({ client: fake.client, normalize: (value) => value, debounceMs: 5, onStatus: (value) => statuses.push(value) });
  cloud.queueSave({ value: 1 });
  cloud.queueSave({ value: 2 });
  await cloud.flush();
  assert.deepEqual(fake.savedPayloads, [{ value: 2 }]);
  assert.equal(statuses.at(-1), 'synced');
});

test('keeps pending data after a failed save and retries it', async () => {
  const fake = createFakeSupabase({ failFirstSave: true });
  const cloud = Cloud.createCloudSync({ client: fake.client, normalize: (value) => value, debounceMs: 0 });
  cloud.queueSave({ value: 7 });
  await assert.rejects(cloud.flush());
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
```

Fake client 必须同时覆盖 `from(...).select(...).eq(...).single()`、`rpc(...)`、`auth.signInWithPassword(...)`、`auth.getSession()`、`auth.signOut()` 和 `channel(...).on(...).subscribe()`。

- [ ] **Step 2: Run tests and verify failure**

```bash
env NODE_PATH=/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
  /Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test tests/cloud.test.cjs
```

Expected: FAIL because `src/cloud.js` does not exist.

- [ ] **Step 3: Implement the minimal cloud module**

`src/cloud.js` must expose a CommonJS/browser UMD API:

```js
(function exposeCloud(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LeaderboardCloud = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  'use strict';

  function createCloudSync({ client, editorEmail, recordId = 'main', normalize, onStatus = () => {}, onRemote = () => {}, debounceMs = 400 }) {
    let revision = 0;
    let pendingPayload = null;
    let saveTimer = null;
    let channel = null;
    let authSubscription = null;

    async function load() {
      onStatus('connecting');
      const { data, error } = await client.from('leaderboard_state').select('payload,revision,updated_at').eq('id', recordId).single();
      if (error) { onStatus('offline'); throw error; }
      revision = Number(data.revision) || 0;
      onStatus('synced');
      return { ...data, revision, payload: normalize(data.payload) };
    }

    async function signIn(password) {
      const result = await client.auth.signInWithPassword({ email: editorEmail, password });
      if (result.error) throw result.error;
      return result.data.session;
    }

    async function isAuthenticated() {
      const { data } = await client.auth.getSession();
      return Boolean(data.session);
    }

    async function signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    }

    async function flush() {
      clearTimeout(saveTimer);
      saveTimer = null;
      if (!pendingPayload) return null;
      const payload = pendingPayload;
      onStatus('saving');
      const { data, error } = await client.rpc('save_leaderboard_state', { p_payload: payload }).single();
      if (error) { onStatus('failed'); throw error; }
      if (pendingPayload === payload) pendingPayload = null;
      revision = Number(data.revision) || revision;
      onStatus('synced');
      return { ...data, revision, payload: normalize(data.payload) };
    }

    function queueSave(payload) {
      pendingPayload = normalize(payload);
      onStatus('saving');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void flush().catch(() => {}), debounceMs);
    }

    function subscribe() {
      channel = client.channel('leaderboard-main')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leaderboard_state', filter: `id=eq.${recordId}` }, (event) => {
          const nextRevision = Number(event.new.revision) || 0;
          if (nextRevision <= revision) return;
          revision = nextRevision;
          onRemote({ payload: normalize(event.new.payload), revision });
        })
        .subscribe();
      return channel;
    }

    function onAuthChange(callback) {
      const { data } = client.auth.onAuthStateChange((event) => callback(event));
      authSubscription = data.subscription;
      return authSubscription;
    }

    async function destroy() {
      clearTimeout(saveTimer);
      if (channel) await client.removeChannel(channel);
      if (authSubscription) authSubscription.unsubscribe();
      channel = null;
      authSubscription = null;
    }

    return { load, signIn, isAuthenticated, signOut, flush, queueSave, subscribe, onAuthChange, destroy, getPendingPayload: () => pendingPayload };
  }

  return { createCloudSync };
});
```

补充测试要求的重试和销毁逻辑，但不要让模块直接操作 DOM 或应用全局状态。

- [ ] **Step 4: Run cloud tests**

Run the Task 2 Step 2 command.

Expected: all `tests/cloud.test.cjs` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cloud.js
git add -f tests/cloud.test.cjs
git commit -m "feat: add leaderboard cloud adapter"
```

## Task 3: 增加只读、登录和同步状态界面

**Files:**
- Modify: `index.html:20-54,138-183,271-276`
- Modify: `styles.css`
- Modify: `tests/ui.test.cjs`

- [ ] **Step 1: Write failing UI contract tests**

在 `tests/ui.test.cjs` 增加静态和 Playwright 断言：

```js
test('renders cloud status and password-only admin dialog', async () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  assert.match(html, /id="cloud-status"/);
  assert.match(html, /id="admin-login-dialog"/);
  assert.match(html, /id="admin-password"[^>]*type="password"/);
  assert.match(html, /id="admin-logout"/);
  assert.doesNotMatch(html, /service[_ -]?role/i);
});
```

Playwright 断言同步状态固定尺寸、密码框在手机宽度内、退出按钮默认隐藏，且编辑抽屉文案改为“自动同步到云端”。

- [ ] **Step 2: Run the contract test and verify failure**

Run:

```bash
env NODE_PATH=/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
  /Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test --test-name-pattern="cloud status|admin dialog" tests/ui.test.cjs
```

Expected: FAIL because cloud UI elements do not exist.

- [ ] **Step 3: Add semantic markup**

在 header 中增加：

```html
<div class="cloud-controls" aria-label="云端同步状态">
  <span id="cloud-status" class="cloud-status connecting" role="status" aria-live="polite">
    <i data-lucide="cloud" aria-hidden="true"></i><span>正在连接</span>
  </span>
  <button id="admin-logout" class="icon-button" type="button" aria-label="退出管理" title="退出管理" hidden>
    <i data-lucide="log-out" aria-hidden="true"></i>
  </button>
</div>
```

在 edit drawer 前增加原生 `<dialog id="admin-login-dialog">`，包含标题“进入管理模式”、`type="password"` 输入、取消按钮、登录按钮和 `role="alert"` 错误区域。将抽屉眉题从“仅保存在本浏览器”改为“自动同步到云端”。

脚本加载顺序改为：`lucide`、`supabase`、`rank-rules`、`state`、`cloud-config`、`cloud`、`app`，所有运行脚本使用同一个新的缓存版本号。

- [ ] **Step 4: Add restrained responsive styles**

`styles.css` 增加 `.cloud-controls`、`.cloud-status` 的 connecting/synced/saving/offline/failed 状态和登录对话框样式。状态组件高度固定为 36px，卡片圆角不超过 8px；移动端对话框使用 `width: min(420px, calc(100vw - 32px))`，不得与 header 或按钮重叠。

- [ ] **Step 5: Run UI contract tests**

Expected: new contract tests PASS and existing layout tests remain PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css
git add -f tests/ui.test.cjs
git commit -m "feat: add cloud login and sync status UI"
```

## Task 4: 集成登录门禁和云端状态同步

**Files:**
- Modify: `src/app.js`
- Modify: `tests/ui.test.cjs`

- [ ] **Step 1: Add failing Playwright tests with a fake cloud client**

测试客户端通过 `page.addInitScript` 提供 `globalThis.LeaderboardCloudClientOverride`，记录登录、保存和远端回调。新增测试必须验证：

```js
test('public viewers can read but must sign in before editing', async () => {
  const { page, fakeCloud } = await openCloudPage({ authenticated: false });
  await page.click('#edit-button');
  assert.equal(await page.locator('#admin-login-dialog').getAttribute('open'), '');
  assert.equal(await page.locator('#edit-drawer').getAttribute('aria-hidden'), 'true');
  await page.fill('#admin-password', 'wrong');
  fakeCloud.rejectNextLogin('密码错误');
  await page.click('#admin-login-form button[type="submit"]');
  assert.match(await page.locator('#admin-login-error').textContent(), /密码错误/);
  await page.fill('#admin-password', 'correct');
  await page.click('#admin-login-form button[type="submit"]');
  assert.equal(await page.locator('#edit-drawer').getAttribute('aria-hidden'), 'false');
});

test('a cloud update replaces display state without replaying promotion animation', async () => {
  const { page, fakeCloud } = await openCloudPage({ authenticated: false });
  fakeCloud.emitRemote(makeStateWithPoints('s1', 600), 4);
  await page.waitForFunction(() => document.querySelector('[data-rank-row="s1"] .rank-points')?.textContent === '600 分');
  assert.equal(await page.locator('[data-rank-row="s1"] .rank-points').textContent(), '600 分');
  assert.equal(await page.locator('#rankup-overlay.is-active').count(), 0);
});
```

- [ ] **Step 2: Run the new tests and verify failure**

Run with `--test-name-pattern="public viewers|cloud update"` and expect failure because the app does not initialize cloud sync or gate editing.

- [ ] **Step 3: Initialize cloud services in `src/app.js`**

Add state variables `cloudSync`, `isAdmin`, `cloudRevision`, and elements for cloud status, login dialog/form/password/error and logout. Initialize the Supabase client from `LeaderboardCloudClientOverride` during tests, otherwise from `supabase.createClient(config.url, config.anonKey)`.

Add these bounded functions:

```js
function setCloudStatus(status) {
  const labels = { connecting: '正在连接', synced: '已同步', saving: '同步中', offline: '离线', failed: '同步失败' };
  elements.cloudStatus.className = `cloud-status ${status}`;
  elements.cloudStatus.querySelector('span').textContent = labels[status] || labels.offline;
}

function applyRemoteState(row) {
  appState = State.normalizeAppState(row.payload);
  saveLocalState();
  renderDisplay();
  if (elements.drawer.classList.contains('is-open')) renderEditor();
}

async function requestEditAccess() {
  if (isAdmin) { openDrawer(); return; }
  elements.adminLoginError.textContent = '';
  elements.adminPassword.value = '';
  elements.adminLoginDialog.showModal();
  elements.adminPassword.focus();
}
```

Login form calls `cloudSync.signIn(password)`, clears the password input immediately in `finally`, sets `isAdmin`, closes dialog and opens drawer. Logout calls `cloudSync.signOut()`, closes the drawer and hides mutation controls.

- [ ] **Step 4: Gate every mutation path**

Replace the edit button handler with `requestEditAccess`. Hide class add/rename/delete controls for viewers and guard `addClassroom`, `finishRenameClassroom`, `removeClassroom`, `updateLesson`, `updateCollectiveGoal`, `updateStudentFromInput`, `updateStudentBadge`, `addStudent`, `removeStudent`, and `restoreDefaultData` with a shared `requireAdmin()` check.

Class switching and both leaderboard views remain available without login.

- [ ] **Step 5: Replace persistence with local plus queued cloud save**

Split current `persist()` into:

```js
function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, State.serializeAppState(appState));
}

function persist() {
  try { saveLocalState(); }
  catch { showToast('浏览器无法保存本地备份'); }
  if (cloudSync && isAdmin) {
    localStorage.setItem(PENDING_KEY, State.serializeAppState(appState));
    cloudSync.queueSave(appState);
  }
}
```

Define `PENDING_KEY = 'youxuepai-leaderboard-pending-v1'`. When cloud status reaches `synced`, remove this key. On startup, render local state first, restore auth session, and if an authenticated pending value exists, parse it with `State.parseAppState`, queue and flush it before loading the authoritative row. Then subscribe. Cloud load failure keeps local data visible and sets offline status.

- [ ] **Step 6: Run targeted and full tests**

Expected: new login/sync tests PASS; the entire existing UI suite remains PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app.js
git add -f tests/ui.test.cjs
git commit -m "feat: require admin login and sync leaderboard state"
```

## Task 5: 固定 SDK 并写入实际公开配置

**Files:**
- Create: `vendor/supabase.min.js`
- Create: `src/cloud-config.js`
- Modify: `.gitignore`

- [ ] **Step 1: Download and pin Supabase browser SDK**

Download exactly version 2.112.2 from:

```text
https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.2/dist/umd/supabase.min.js
```

Save it as `vendor/supabase.min.js`, run `shasum -a 256 vendor/supabase.min.js`, and confirm it begins with the expected UMD bundle rather than an HTML error page.

- [ ] **Step 2: Write actual cloud configuration**

Create `src/cloud-config.js` as an IIFE assigning a frozen `globalThis.LeaderboardCloudConfig` with exactly four fields: `url`, `anonKey`, `editorEmail`, and `recordId: 'main'`. Insert the actual Project URL, anon public key and shared administrator email from Task 1. Do not include the password, database password or service role key.

- [ ] **Step 3: Allow only runtime cloud files through `.gitignore`**

Add:

```gitignore
!src/cloud-config.js
!src/cloud.js
!vendor/supabase.min.js
```

- [ ] **Step 4: Add a secret scan test**

Add a test that rejects `service_role`, database connection strings, or a hard-coded password field in tracked runtime files, while allowing `anonKey` and `editorEmail`.

- [ ] **Step 5: Commit**

```bash
git add .gitignore src/cloud-config.js src/cloud.js vendor/supabase.min.js
git add -f tests/cloud.test.cjs tests/ui.test.cjs
git commit -m "chore: configure Supabase browser client"
```

## Task 6: 验证权限、离线恢复和实时同步

**Files:**
- Modify: `tests/cloud.test.cjs`
- Modify: `tests/ui.test.cjs`

- [ ] **Step 1: Add failure-first recovery tests**

Add tests for: cloud load failure renders cached roster, a failed save remains pending, reconnect calls `load()` before accepting new events, expired auth closes editor, and a lower/equal revision realtime event is ignored.

- [ ] **Step 2: Run and observe failures**

Run `tests/cloud.test.cjs` and the targeted UI names. Expected: at least reconnect and expired-session tests FAIL before implementation.

- [ ] **Step 3: Implement recovery behavior**

Use `window` online/offline events to update status. On `online`, call `cloudSync.flush()` when authenticated, then `cloudSync.load()` and apply the returned row. Subscribe to Supabase auth state changes so `SIGNED_OUT` or token expiration immediately sets `isAdmin = false`, closes editing UI and preserves pending local data.

- [ ] **Step 4: Verify RLS from the public site credentials**

Using only the Project URL and anon key, perform a REST `GET` on `/rest/v1/leaderboard_state?id=eq.main&select=payload,revision` and expect HTTP 200. Attempt a REST `PATCH` with the same anon key and expect HTTP 401/403 or zero updated rows. Then log in with the shared account in the webpage, modify one score, and confirm revision increments by one.

Never print the password, access token, refresh token, database password or service role key.

- [ ] **Step 5: Run the complete suite**

```bash
env NODE_PATH=/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
  /Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test tests/*.test.cjs
```

Expected: all previous 42 tests plus new cloud tests PASS, with zero failures.

- [ ] **Step 6: Commit**

```bash
git add src/cloud.js src/app.js
git add -f tests/cloud.test.cjs tests/ui.test.cjs
git commit -m "fix: recover cloud sync after offline and expired sessions"
```

## Task 7: 本地双页面验收、发布和公网验证

**Files:**
- Modify: `index.html` cache version only if needed

- [ ] **Step 1: Run a local static server**

Start a local server on an unused port and open two separate browser contexts. Verify public read in both contexts, shared-password login in one context, remote score update in the second context, reload persistence, logout, mobile layout and promotion animation after a cloud-backed rank increase.

- [ ] **Step 2: Capture verification evidence**

Capture desktop and mobile screenshots showing the compact `已同步` state, and record the database revision before and after one controlled edit. Restore the edited score so production seed values remain correct before deployment.

- [ ] **Step 3: Run final verification**

Run the complete test suite, `git diff --check`, `git status --short`, and a secret scan over tracked files. Expected: all tests PASS, no whitespace errors, no unintended files, no private keys or passwords.

- [ ] **Step 4: Push and wait for GitHub Pages**

```bash
git push origin main
```

Poll `repos/12138lyj/youxuepai-leaderboard/pages/builds/latest` until the build for the pushed commit reports `built`.

- [ ] **Step 5: Verify the public URL**

At `https://12138lyj.github.io/youxuepai-leaderboard/`, verify HTTP 200 for the page, Supabase SDK, `cloud-config.js`, `cloud.js`, app script, Logo and background. Repeat the public-read and authenticated-write RLS checks against production.

- [ ] **Step 6: Final commit if verification requires cache-only changes**

If cache versions changed during verification, commit only those changes with:

```bash
git add index.html styles.css
git commit -m "chore: publish cloud synchronized leaderboard"
git push origin main
```

Otherwise do not create an empty commit.
