# 云端自定义晋级音效 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员上传完整音乐或填写音频直链，用滑块选择固定 5.2 秒片段，并将音效与截取位置同步到所有设备。

**Architecture:** 顶层 `appState.rankupSound` 保存全站音效来源、URL、Storage 路径和片段起点，沿用现有单记录 Supabase Realtime 同步。`src/rankup-sound.js` 负责校验、时间换算、媒体时长检测和可停止播放；`src/cloud.js` 只负责 Storage 上传与删除；`src/app.js` 协调管理员界面、临时片段草稿和云端保存。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Web Audio API、HTMLAudioElement、Supabase Database/Auth/Realtime/Storage、Node test runner、Playwright、GitHub Pages。

---

## 文件结构

- Modify: `src/state.js` - 规范化并序列化全站 `rankupSound` 云端配置。
- Modify: `src/rankup-sound.js` - 文件/URL 校验、片段计算、时长读取和 5.2 秒播放控制。
- Modify: `src/cloud.js` - 上传、获取公开 URL、删除 Supabase Storage 音频。
- Create: `supabase/migrations/2026081001_rankup_audio_storage.sql` - 公共音频桶、文件限制和管理员写入策略。
- Modify: `index.html` - 三种来源、上传、网址、片段滑块、试听和恢复默认控件。
- Modify: `styles.css` - 桌面与移动端紧凑音效编辑器样式。
- Modify: `src/app.js` - 云端音效状态、片段草稿、上传、试听、保存和晋级播放生命周期。
- Modify: `tests/state.test.cjs` - 云端音效状态兼容与非法输入测试。
- Modify: `tests/rankup-sound.test.cjs` - 校验、片段、时长和播放控制测试。
- Modify: `tests/cloud.test.cjs` - Storage 上传和删除测试。
- Modify: `tests/ui.test.cjs` - 管理员截取流程、同步和晋级播放回归测试。

## Task 1: 将晋级音效设置纳入云端状态

**Files:**
- Modify: `tests/state.test.cjs`
- Modify: `src/state.js`

- [ ] **Step 1: 写云端音效规范化失败测试**

在 `tests/state.test.cjs` 增加：

```js
test('normalizes global rank-up sound settings with a fixed 5.2 second clip', () => {
  const app = stateApi.normalizeAppState({
    activeClassId: 'class-1',
    rankupSound: {
      enabled: false,
      source: 'upload',
      style: 'crystal',
      url: 'https://example.com/music.mp3?version=2',
      name: '  课堂冲刺  ',
      storagePath: 'main/123-music.mp3',
      clipStart: 12.46,
      clipDuration: 99,
    },
    classes: [{ id: 'class-1', name: '一班', students: [{ id: 's1', name: '甲' }] }],
  });

  assert.deepEqual(app.rankupSound, {
    enabled: false,
    source: 'upload',
    style: 'crystal',
    url: 'https://example.com/music.mp3?version=2',
    name: '课堂冲刺',
    storagePath: 'main/123-music.mp3',
    clipStart: 12.5,
    clipDuration: 5.2,
  });
});

test('falls back to 王者号角 for missing or invalid custom sound settings', () => {
  const legacy = stateApi.createDefaultAppState();
  assert.deepEqual(legacy.rankupSound, {
    enabled: true,
    source: 'builtin',
    style: 'horn',
    url: '',
    name: '王者号角',
    storagePath: '',
    clipStart: 0,
    clipDuration: 5.2,
  });

  const invalid = stateApi.normalizeRankupSound({
    source: 'url',
    url: 'http://example.com/page',
    clipStart: -7,
  });
  assert.deepEqual(invalid, legacy.rankupSound);
});
```

- [ ] **Step 2: 运行测试并确认因 API 缺失失败**

Run: `node --test tests/state.test.cjs`

Expected: FAIL，提示 `normalizeRankupSound is not a function` 或 `rankupSound` 为 `undefined`。

- [ ] **Step 3: 实现状态规范化**

在 `src/state.js` 增加并导出：

```js
const DEFAULT_RANKUP_SOUND = Object.freeze({
  enabled: true,
  source: 'builtin',
  style: 'horn',
  url: '',
  name: '王者号角',
  storagePath: '',
  clipStart: 0,
  clipDuration: 5.2,
});
const rankupSoundSources = new Set(['builtin', 'upload', 'url']);
const rankupSoundStyles = new Set(['horn', 'crystal', 'star']);
const rankupSoundLabels = { horn: '王者号角', crystal: '水晶解锁', star: '星耀冲刺' };
const audioPathPattern = /\.(?:mp3|m4a|wav|ogg)$/i;

function isValidAudioUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && audioPathPattern.test(url.pathname);
  } catch {
    return false;
  }
}

function normalizeRankupSound(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const source = rankupSoundSources.has(input.source) ? input.source : 'builtin';
  const style = rankupSoundStyles.has(input.style) ? input.style : 'horn';
  if (source !== 'builtin' && !isValidAudioUrl(input.url)) return { ...DEFAULT_RANKUP_SOUND };
  if (source === 'builtin') {
    return {
      ...DEFAULT_RANKUP_SOUND,
      enabled: input.enabled === false || input.enabled === 'false' ? false : true,
      style,
      name: rankupSoundLabels[style],
    };
  }
  const clipStart = Math.max(0, Math.round((Number(input.clipStart) || 0) * 10) / 10);
  return {
    enabled: input.enabled === false || input.enabled === 'false' ? false : true,
    source,
    style,
    url: String(input.url),
    name: String(input.name || '自定义音效').trim().slice(0, 80) || '自定义音效',
    storagePath: source === 'upload' ? String(input.storagePath || '') : '',
    clipStart,
    clipDuration: 5.2,
  };
}
```

让 `createDefaultAppState()` 返回 `rankupSound: normalizeRankupSound()`，让 `normalizeAppState()` 返回 `rankupSound: normalizeRankupSound(value.rankupSound)`。

- [ ] **Step 4: 运行状态测试**

Run: `node --test tests/state.test.cjs`

Expected: PASS，现有班级、积分、徽章测试无回归。

- [ ] **Step 5: 提交状态层**

```bash
git add -f src/state.js tests/state.test.cjs
git commit -m "feat: sync rank-up sound settings in app state"
```

## Task 2: 实现固定 5.2 秒片段工具和可停止播放

**Files:**
- Modify: `tests/rankup-sound.test.cjs`
- Modify: `src/rankup-sound.js`

- [ ] **Step 1: 写校验和片段计算失败测试**

在 `tests/rankup-sound.test.cjs` 增加：

```js
test('validates supported files and HTTPS direct audio URLs', () => {
  assert.equal(sound.validateAudioFile({ name: 'music.mp3', type: 'audio/mpeg', size: 10_485_760 }).valid, true);
  assert.match(sound.validateAudioFile({ name: 'music.mp3', type: 'audio/mpeg', size: 10_485_761 }).error, /10MB/);
  assert.match(sound.validateAudioFile({ name: 'notes.txt', type: 'text/plain', size: 20 }).error, /MP3/);
  assert.equal(sound.validateAudioUrl('https://example.com/music.m4a?v=1').valid, true);
  assert.equal(sound.validateAudioUrl('http://example.com/music.mp3').valid, false);
});

test('clamps clip starts to a 0.1 second slider range', () => {
  assert.equal(sound.getMaxClipStart(20), 14.8);
  assert.equal(sound.normalizeClipStart(12.46, 20), 12.5);
  assert.equal(sound.normalizeClipStart(99, 20), 14.8);
  assert.equal(sound.formatTime(12.4), '00:12.4');
});
```

- [ ] **Step 2: 写自定义播放失败测试**

先增加一个可记录 `currentTime`、`pause()` 和事件监听的假音频对象：

```js
function createFakeAudio({ duration = 30 } = {}) {
  const listeners = new Map();
  return {
    duration,
    currentTime: 0,
    paused: false,
    readyState: 1,
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    removeAttribute() {},
    load() {},
    emit(name) { listeners.get(name)?.(); },
  };
}
```

然后断言：

```js
test('plays only the selected 5.2 second custom clip and returns a stop handle', async () => {
  const timers = [];
  const audio = createFakeAudio({ duration: 30 });
  const handle = sound.playSettings({
    enabled: true,
    source: 'url',
    style: 'horn',
    url: 'https://example.com/music.mp3',
    clipStart: 12.4,
    clipDuration: 5.2,
  }, {
    audioFactory: () => audio,
    setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimer: () => {},
  });

  assert.equal(audio.currentTime, 12.4);
  assert.equal(timers[0].delay, 5200);
  timers[0].callback();
  assert.equal(audio.paused, true);
  handle.stop();
});
```

- [ ] **Step 3: 运行音频测试并确认新接口缺失**

Run: `node --test tests/rankup-sound.test.cjs`

Expected: FAIL，提示 `validateAudioFile`、`normalizeClipStart` 或 `playSettings` 不存在。

- [ ] **Step 4: 实现校验和片段工具**

在 `src/rankup-sound.js` 增加 `CLIP_DURATION = 5.2`、`MAX_FILE_BYTES = 10 * 1024 * 1024`，并实现：

```js
function validateAudioFile(file) {
  const extensionOk = /\.(?:mp3|m4a|wav|ogg)$/i.test(String(file?.name || ''));
  const mimeOk = /^(?:audio\/(?:mpeg|mp4|x-m4a|wav|x-wav|ogg)|application\/ogg)$/i.test(String(file?.type || ''));
  if (!extensionOk || !mimeOk) return { valid: false, error: '请选择 MP3、M4A、WAV 或 OGG 音频' };
  if (Number(file.size) > MAX_FILE_BYTES) return { valid: false, error: '音频文件不能超过 10MB' };
  return { valid: true, error: '' };
}

function validateAudioUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const valid = url.protocol === 'https:' && /\.(?:mp3|m4a|wav|ogg)$/i.test(url.pathname);
    return { valid, url: valid ? url.href : '', error: valid ? '' : '请输入 HTTPS 音频直链' };
  } catch {
    return { valid: false, url: '', error: '请输入 HTTPS 音频直链' };
  }
}

function getMaxClipStart(duration) {
  const available = Math.max(0, (Number(duration) || 0) - CLIP_DURATION);
  return Math.floor((available + 1e-9) * 10) / 10;
}

function normalizeClipStart(value, duration) {
  return Math.min(getMaxClipStart(duration), Math.max(0, Math.round((Number(value) || 0) * 10) / 10));
}

function formatTime(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}
```

- [ ] **Step 5: 实现时长读取和播放控制**

增加 `inspectAudio(url, { audioFactory })`，在 `loadedmetadata` 时解析有限 `duration`，不足 5.2 秒时拒绝；在 `error` 时以“无法读取音频”拒绝。增加 `playSettings(settings, dependencies)`：内置来源继续调用合成序列，自定义来源从 `clipStart` 播放，并用 5200ms 定时器、`timeupdate` 和返回的 `stop()` 共同停止；`play()` 拒绝或 `error` 时只回退一次 `horn`。

返回结构固定为：

```js
{
  started: true,
  kind: 'custom',
  stop() {
    clearTimer(timerId);
    audio.pause();
    audio.removeAttribute?.('src');
    audio.load?.();
  },
}
```

保留原 `play(style)` API 供旧测试兼容，并导出所有新增常量和函数。

- [ ] **Step 6: 运行音频测试**

Run: `node --test tests/rankup-sound.test.cjs`

Expected: PASS，三种内置音效仍保持约 5.2 秒。

- [ ] **Step 7: 提交音频模块**

```bash
git add -f src/rankup-sound.js tests/rankup-sound.test.cjs
git commit -m "feat: select and play fixed rank-up audio clips"
```

## Task 3: 增加 Supabase Storage 上传能力和权限

**Files:**
- Modify: `tests/cloud.test.cjs`
- Modify: `src/cloud.js`
- Create: `supabase/migrations/2026081001_rankup_audio_storage.sql`

- [ ] **Step 1: 写 Storage 客户端失败测试**

扩展 `createFakeSupabase()` 的 `storage.from('rankup-audio')`，记录上传和删除调用，并增加：

```js
test('uploads rank-up audio to a unique public Storage path', async () => {
  const fake = createFakeSupabase();
  const cloud = Cloud.createCloudSync({ client: fake.client, normalize: (value) => value, now: () => 1234 });
  const file = { name: 'Classroom Sprint.mp3', type: 'audio/mpeg' };

  const uploaded = await cloud.uploadRankupAudio(file);

  assert.equal(uploaded.path, 'main/1234-classroom-sprint.mp3');
  assert.match(uploaded.url, /rankup-audio\/main\/1234-classroom-sprint\.mp3$/);
  assert.equal(fake.uploadCalls[0].file, file);
});

test('removes only a supplied rank-up audio object path', async () => {
  const fake = createFakeSupabase();
  const cloud = Cloud.createCloudSync({ client: fake.client, normalize: (value) => value });
  await cloud.removeRankupAudio('main/old.mp3');
  assert.deepEqual(fake.removeCalls, [['main/old.mp3']]);
});
```

- [ ] **Step 2: 运行云端测试并确认接口缺失**

Run: `node --test tests/cloud.test.cjs`

Expected: FAIL，提示 `uploadRankupAudio is not a function`。

- [ ] **Step 3: 实现 Storage 方法**

给 `createCloudSync` 增加可注入的 `now = () => Date.now()`，实现并导出实例方法：

```js
async function uploadRankupAudio(file) {
  const extension = String(file.name).split('.').pop().toLowerCase();
  const baseName = String(file.name).replace(/\.[^.]+$/, '')
    .normalize('NFKD').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
    .toLowerCase() || 'rankup-audio';
  const path = `main/${now()}-${baseName}.${extension}`;
  const bucket = client.storage.from('rankup-audio');
  const { error } = await bucket.upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  const { data } = bucket.getPublicUrl(path);
  return { path, url: data.publicUrl };
}

async function removeRankupAudio(path) {
  if (!/^main\/[a-zA-Z0-9._-]+$/.test(String(path || ''))) return false;
  const { error } = await client.storage.from('rankup-audio').remove([path]);
  if (error) throw error;
  return true;
}
```

- [ ] **Step 4: 写 Storage 数据库迁移**

创建 `supabase/migrations/2026081001_rankup_audio_storage.sql`：

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rankup-audio',
  'rankup-audio',
  true,
  10485760,
  array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'application/ogg']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public rankup audio read" on storage.objects;
create policy "public rankup audio read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'rankup-audio');

drop policy if exists "leaderboard owner rankup audio insert" on storage.objects;
create policy "leaderboard owner rankup audio insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'rankup-audio'
  and (storage.foldername(name))[1] = 'main'
  and exists (
    select 1 from public.leaderboard_state
    where id = 'main' and owner_id = auth.uid()
  )
);

drop policy if exists "leaderboard owner rankup audio delete" on storage.objects;
create policy "leaderboard owner rankup audio delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'rankup-audio'
  and (storage.foldername(name))[1] = 'main'
  and exists (
    select 1 from public.leaderboard_state
    where id = 'main' and owner_id = auth.uid()
  )
);
```

- [ ] **Step 5: 运行云端测试和 SQL 静态检查**

Run: `node --test tests/cloud.test.cjs && rg -n "rankup-audio|file_size_limit|auth.uid" supabase/migrations/2026081001_rankup_audio_storage.sql`

Expected: 云端测试 PASS，迁移包含桶、10MB 限制和管理员策略。

- [ ] **Step 6: 提交 Storage 层**

```bash
git add -f src/cloud.js tests/cloud.test.cjs supabase/migrations/2026081001_rankup_audio_storage.sql
git commit -m "feat: upload rank-up audio to Supabase Storage"
```

## Task 4: 构建音效来源和片段选择界面

**Files:**
- Modify: `tests/ui.test.cjs`
- Modify: `index.html`
- Modify: `styles.css`

- [ ] **Step 1: 写界面结构失败测试**

将原“本机保存”测试替换为云端编辑器契约：

```js
test('exposes cloud sound sources and a fixed clip editor', () => {
  const html = fs.readFileSync(indexPath, 'utf8');
  for (const id of [
    'rankup-sound-source-builtin', 'rankup-sound-source-upload', 'rankup-sound-source-url',
    'rankup-sound-file', 'rankup-sound-url', 'rankup-sound-load-url',
    'rankup-clip-editor', 'rankup-clip-start', 'rankup-clip-range',
    'rankup-sound-preview', 'rankup-sound-save-clip', 'rankup-sound-reset',
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /固定 5\.2 秒/);
  assert.match(html, /所有设备同步/);
});
```

- [ ] **Step 2: 运行单项测试并确认控件缺失**

Run: `node --test --test-name-pattern="cloud sound sources" tests/ui.test.cjs`

Expected: FAIL，第一个新增控件 ID 不存在。

- [ ] **Step 3: 修改 HTML**

将 `index.html` 的 `.sound-settings` 扩展为：

```html
<div class="sound-source-segments" role="group" aria-label="音效来源">
  <button id="rankup-sound-source-builtin" type="button" data-sound-source="builtin">内置音效</button>
  <button id="rankup-sound-source-upload" type="button" data-sound-source="upload">上传音乐</button>
  <button id="rankup-sound-source-url" type="button" data-sound-source="url">音频网址</button>
</div>
<div id="rankup-sound-builtin-panel" class="sound-source-panel">
  <!-- 保留原 rankup-sound-style 选择框 -->
</div>
<div id="rankup-sound-upload-panel" class="sound-source-panel" hidden>
  <input id="rankup-sound-file" type="file" accept=".mp3,.m4a,.wav,.ogg,audio/mpeg,audio/mp4,audio/wav,audio/ogg" hidden>
  <button id="rankup-sound-pick-file" class="secondary-action" type="button"><i data-lucide="upload"></i>选择音乐</button>
  <span id="rankup-sound-file-name">尚未选择文件</span>
</div>
<div id="rankup-sound-url-panel" class="sound-source-panel" hidden>
  <input id="rankup-sound-url" type="url" inputmode="url" placeholder="https://example.com/music.mp3">
  <button id="rankup-sound-load-url" class="secondary-action" type="button">载入网址</button>
</div>
<div id="rankup-clip-editor" class="sound-clip-editor" hidden>
  <div class="sound-clip-summary"><strong>选择片段</strong><span>固定 5.2 秒</span></div>
  <input id="rankup-clip-start" type="range" min="0" max="0" step="0.1" value="0">
  <div id="rankup-clip-range" class="sound-clip-range">00:00.0 - 00:05.2</div>
  <button id="rankup-sound-save-clip" class="primary-action" type="button">保存这个片段</button>
</div>
<button id="rankup-sound-reset" class="text-action" type="button">恢复王者号角</button>
```

保留全局试听和启用开关，将说明改为“上传完整音乐，选择固定 5.2 秒，所有设备同步”。

- [ ] **Step 4: 增加响应式样式**

在 `styles.css` 增加来源分段控件、URL 行、上传行、片段选择器和范围输入样式；使用现有黄色、浅紫、绿色变量，卡片圆角不超过 8px：

```css
.sound-source-segments {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  background: #f1eef6;
  border-radius: 8px;
}

.sound-source-segments button {
  min-height: 38px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-weight: 800;
}

.sound-source-segments button.is-active {
  background: #fff;
  color: var(--purple-deep);
  box-shadow: 0 1px 4px rgb(64 43 91 / 12%);
}

.sound-source-panel,
.sound-upload-row,
.sound-url-row,
.sound-clip-summary,
.sound-clip-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sound-source-panel[hidden],
.sound-clip-editor[hidden] {
  display: none;
}

.sound-url-row input {
  min-width: 0;
  width: 100%;
  height: 40px;
}

.sound-clip-editor {
  display: grid;
  gap: 10px;
  padding: 13px;
  border: 1px solid #ded5ec;
  border-radius: 8px;
  background: #fbf9fe;
}

#rankup-clip-start {
  width: 100%;
  accent-color: var(--purple-deep);
}

.sound-clip-range {
  color: var(--green-deep);
  font-variant-numeric: tabular-nums;
  font-weight: 900;
}

@media (max-width: 640px) {
  .sound-upload-row,
  .sound-url-row,
  .sound-clip-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .sound-upload-row button,
  .sound-url-row button,
  .sound-clip-actions button {
    min-height: 40px;
    width: 100%;
  }
}
```

- [ ] **Step 5: 运行界面契约测试**

Run: `node --test --test-name-pattern="cloud sound sources" tests/ui.test.cjs`

Expected: PASS。

- [ ] **Step 6: 提交静态界面**

```bash
git add -f index.html styles.css tests/ui.test.cjs
git commit -m "feat: add rank-up audio clip editor"
```

## Task 5: 串联上传、网址、试听、保存与晋级播放

**Files:**
- Modify: `tests/ui.test.cjs`
- Modify: `src/app.js`

- [ ] **Step 1: 扩展 Playwright 假云端 Storage**

在 `openCloudPage()` 的浏览器内假客户端增加 `storage.from()`，记录上传，返回固定公开 URL，并将上传/删除记录暴露到 `__fakeCloudControl`。测试使用 `page.setInputFiles()` 提供一个大于 5.2 秒的最小 WAV fixture；fixture 由测试内 Buffer 生成，不提交二进制文件。

- [ ] **Step 2: 写网址片段跨设备状态失败测试**

```js
test('saves a selected 5.2 second URL clip into cloud app state', async () => {
  const { browser, page } = await openCloudPage({ authenticated: true });
  try {
    await page.evaluate(() => {
      globalThis.RankupSound.inspectAudio = async () => ({ duration: 30 });
    });
    await page.click('#edit-button');
    await page.click('#rankup-sound-source-url');
    await page.fill('#rankup-sound-url', 'https://example.com/class.mp3');
    await page.click('#rankup-sound-load-url');
    await page.fill('#rankup-clip-start', '12.4');
    await page.click('#rankup-sound-save-clip');
    await page.waitForSelector('#cloud-status.synced');
    const payload = await page.evaluate(() => globalThis.__fakeCloudControl.getSavedPayloads().at(-1));
    assert.equal(payload.rankupSound.source, 'url');
    assert.equal(payload.rankupSound.clipStart, 12.4);
    assert.equal(payload.rankupSound.clipDuration, 5.2);
  } finally {
    await browser.close();
  }
});
```

- [ ] **Step 3: 写晋级播放和停止失败测试**

更新现有晋级测试，把 `RankupSound.playSettings` 替换为返回带 `stop()` 的记录器；设置云端 `rankupSound` 为自定义 URL，积分升到 300 后断言传入完整设置，点击“跳过”后断言 `stop()` 被调用。

- [ ] **Step 4: 运行新增 UI 测试并确认逻辑缺失**

Run: `node --test --test-name-pattern="selected 5.2|rank-up sound" tests/ui.test.cjs`

Expected: FAIL，来源按钮无行为或未调用 `playSettings`。

- [ ] **Step 5: 实现音效编辑器状态**

在 `src/app.js` 增加：

```js
let soundDraft = null;
let activeSoundPlayback = null;

function updateRankupSound(patch) {
  appState = State.normalizeAppState({
    ...appState,
    rankupSound: { ...appState.rankupSound, ...patch },
  });
  persist();
  renderSoundEditor();
}

function stopActiveSound() {
  activeSoundPlayback?.stop?.();
  activeSoundPlayback = null;
}

function previewSound(settings = soundDraft || appState.rankupSound) {
  stopActiveSound();
  activeSoundPlayback = RankupSound.playSettings(settings);
}
```

`renderEditor()` 调用独立的 `renderSoundEditor()`：按 `appState.rankupSound.source` 更新来源按钮、面板、选择框、开关、当前名称和已保存片段；存在 `soundDraft` 时以草稿更新滑块最大值、数值和时间范围。

- [ ] **Step 6: 实现文件和网址草稿**

文件选择时先 `validateAudioFile(file)`，通过 `URL.createObjectURL(file)` 调用 `inspectAudio()`，不足 5.2 秒则提示并清理对象 URL；成功后保存 `{ source: 'upload', file, previewUrl, url: previewUrl, name, duration, clipStart: 0, clipDuration: 5.2 }`。网址按钮先 `validateAudioUrl()` 再 `inspectAudio()`，成功后建立相同结构但不含 `file`。

滑块 `input` 事件调用 `normalizeClipStart()` 并更新范围；试听使用草稿；保存时：

```js
async function saveSoundClip() {
  if (!requireAdmin() || !soundDraft) return;
  const previousPath = appState.rankupSound.storagePath;
  let url = soundDraft.url;
  let storagePath = '';
  if (soundDraft.source === 'upload') {
    const uploaded = await cloudSync.uploadRankupAudio(soundDraft.file);
    url = uploaded.url;
    storagePath = uploaded.path;
  }
  updateRankupSound({
    enabled: elements.rankupSoundEnabled.checked,
    source: soundDraft.source,
    style: appState.rankupSound.style,
    url,
    name: soundDraft.name,
    storagePath,
    clipStart: soundDraft.clipStart,
    clipDuration: 5.2,
  });
  if (cloudSync) await cloudSync.flush();
  if (previousPath && previousPath !== storagePath) {
    void cloudSync.removeRankupAudio(previousPath).catch(() => {});
  }
  clearSoundDraft();
}
```

上传失败时不调用 `updateRankupSound`；保存按钮恢复可用并显示错误。

- [ ] **Step 7: 将内置设置和静音改为云端保存**

删除 `RankupSound.getSettings()/saveSettings()` 的界面依赖。内置选择写入 `appState.rankupSound`；静音开关写入 `enabled`；恢复按钮写入默认 `builtin/horn` 并尝试删除旧上传对象。

- [ ] **Step 8: 管理晋级音频生命周期**

`showRankUpgrade()` 开始时先停止旧播放，再调用 `RankupSound.playSettings(appState.rankupSound)`。`finishRankupAnimation()`、`closeRankUpgrade()`、跳过按钮和下一次晋级都调用 `stopActiveSound()`，保证音频不超过动画。

- [ ] **Step 9: 运行目标 UI 测试**

Run: `node --test --test-name-pattern="selected 5.2|rank-up sound" tests/ui.test.cjs`

Expected: PASS。

- [ ] **Step 10: 提交应用串联**

```bash
git add -f src/app.js tests/ui.test.cjs
git commit -m "feat: sync and preview custom promotion clips"
```

## Task 6: 完整回归、视觉检查和版本更新

**Files:**
- Modify: `index.html`
- Modify: `tests/ui.test.cjs`

- [ ] **Step 1: 更新静态资源版本**

把 `index.html` 中所有运行资源查询参数统一更新为 `v=20260810-cloud-audio-clip-v1`，并同步更新版本测试的期望值。

- [ ] **Step 2: 运行完整自动测试**

Run: `npm test`

Expected: 全部测试 PASS，失败数为 0。

- [ ] **Step 3: 启动本地服务器**

Run: `python3 -m http.server 8765 --directory /Users/Admin/Documents/Codex/2026-08-07/new-chat/outputs/youxuepai-leaderboard`

Expected: `http://127.0.0.1:8765/index.html?v=20260810-cloud-audio-clip-v1#scores` 返回 200。

- [ ] **Step 4: 桌面和移动端视觉验收**

使用 Playwright 分别在 1440x900 和 390x844 打开编辑抽屉，截图并检查：来源分段控件、URL 输入、上传行、滑块、时间范围、保存按钮不重叠；移动端无横向滚动；文字不溢出；按钮触控高度足够。

- [ ] **Step 5: 运行脚本和资源检查**

Run: `node --check src/state.js && node --check src/rankup-sound.js && node --check src/cloud.js && node --check src/app.js && git diff --check`

Expected: 全部命令退出码 0，无空白错误。

- [ ] **Step 6: 提交发布版本**

```bash
git add -f index.html tests/ui.test.cjs
git commit -m "chore: version cloud audio clip release"
```

## Task 7: 配置 Supabase 并发布正式网址

**Files:**
- No additional source files unless live verification reveals a tested defect.

- [ ] **Step 1: 在 Supabase SQL Editor 执行 Storage 迁移**

使用用户已经登录的 Supabase Dashboard 执行 `supabase/migrations/2026081001_rankup_audio_storage.sql`。不得读取、保存或输出数据库密码、管理员密码、access token、refresh token 或 service role key。

- [ ] **Step 2: 验证桶和策略**

在 SQL Editor 执行只读查询：

```sql
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'rankup-audio';

select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like '%rankup audio%'
order by policyname;
```

Expected: 桶公开、限制 10485760 字节，存在 SELECT、INSERT、DELETE 三条策略。

- [ ] **Step 3: 推送 GitHub Pages**

Run: `git push origin main`

Expected: `main` 推送成功。

- [ ] **Step 4: 等待并验证 Pages**

检查 GitHub Pages 构建状态，随后访问：

`https://12138lyj.github.io/youxuepai-leaderboard/?v=20260810-cloud-audio-clip-v1#scores`

Expected: 页面资源 200，页面显示“已同步”，未登录可直接查看。

- [ ] **Step 5: 线上端到端验收**

管理员本人输入密码后，上传一段无版权风险的测试音频，选择一个非零开始点，试听并保存。在第二个未登录页面确认相同音频名称和时间范围同步；触发晋级时只播放该 5.2 秒片段；点击跳过后立即停止。随后恢复“王者号角”并删除测试对象，确保正式学员积分未被测试修改。

- [ ] **Step 6: 最终安全和仓库检查**

Run: `npm test && git status --short && git log -7 --oneline`

Expected: 测试失败数 0，工作树干净，最新提交包含状态、片段、Storage、界面和版本更新。
