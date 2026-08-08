(function startLeaderboardApp() {
  'use strict';

  const STORAGE_KEY = 'youxuepai-leaderboard-state-v2';
  const PENDING_KEY = 'youxuepai-leaderboard-pending-v1';
  const State = globalThis.LeaderboardState;
  const Ranks = globalThis.RankRules;
  const Cloud = globalThis.LeaderboardCloud;
  const RankupSound = globalThis.RankupSound;
  const cloudConfig = globalThis.LeaderboardCloudConfig;
  const cloudClientOverride = globalThis.LeaderboardCloudClientOverride;
  const canUseRemoteCloud = Boolean(
    Cloud
    && cloudConfig
    && (cloudClientOverride || (
      globalThis.supabase
      && (location.protocol === 'http:' || location.protocol === 'https:')
    )),
  );

  if (!State || !Ranks) {
    throw new Error('排行榜数据模块未正确加载');
  }

  const categories = [
    { field: 'notebook', label: '笔记本', icon: 'pencil-ruler', tone: 'yellow', honor: '笔记之星' },
    { field: 'errorBook', label: '错题本', icon: 'target', tone: 'purple', honor: '错题猎手' },
    { field: 'draft', label: '草稿本', icon: 'list-ordered', tone: 'green', honor: '草稿达人' },
    { field: 'module', label: '模块', icon: 'route', tone: 'coral', honor: '模块先锋' },
  ];
  const inputLabels = {
    name: '姓名',
    notebook: '笔记本',
    errorBook: '错题本',
    draft: '草稿本',
    module: '模块',
    totalPoints: '累计积分',
  };
  const badgeLevels = [
    { level: 'white', label: '启航', fullLabel: '白色启航', stars: 1 },
    { level: 'yellow', label: '进阶', fullLabel: '黄色进阶', stars: 2 },
    { level: 'purple', label: '卓越', fullLabel: '紫色卓越', stars: 3 },
  ];

  const defaultAppState = State.createDefaultAppState();
  let appState = loadState();
  let activeView = 'scores';
  let toastTimer = null;
  let lastFocusedElement = null;
  let editingClassId = null;
  let rankupReturnFocus = null;
  let rankupAutoCloseTimer = null;
  let cloudSync = null;
  let cloudRevision = 0;
  let isAdmin = !canUseRemoteCloud;
  let isRecoveringCloud = false;

  const elements = {
    lessonSubtitle: document.querySelector('#lesson-subtitle'),
    summaryStrip: document.querySelector('#summary-strip'),
    winnersGrid: document.querySelector('#winners-grid'),
    boardsGrid: document.querySelector('#boards-grid'),
    rankList: document.querySelector('#rank-list'),
    collectiveGoalCopy: document.querySelector('#collective-goal-copy'),
    collectiveProgress: document.querySelector('#collective-progress'),
    collectiveProgressFill: document.querySelector('#collective-progress-fill'),
    progressStar: document.querySelector('#progress-star'),
    latestHonor: document.querySelector('#latest-honor'),
    classSwitcher: document.querySelector('.class-switcher'),
    classSwitcherButton: document.querySelector('#class-switcher-button'),
    currentClassName: document.querySelector('#current-class-name'),
    classSwitcherMenu: document.querySelector('#class-switcher-menu'),
    classList: document.querySelector('#class-list'),
    addClassForm: document.querySelector('#add-class-form'),
    newClassName: document.querySelector('#new-class-name'),
    editButton: document.querySelector('#edit-button'),
    cloudStatus: document.querySelector('#cloud-status'),
    adminLogout: document.querySelector('#admin-logout'),
    adminLoginDialog: document.querySelector('#admin-login-dialog'),
    adminLoginForm: document.querySelector('#admin-login-form'),
    adminPassword: document.querySelector('#admin-password'),
    adminLoginError: document.querySelector('#admin-login-error'),
    adminLoginCancel: document.querySelector('#admin-login-cancel'),
    drawer: document.querySelector('#edit-drawer'),
    drawerBackdrop: document.querySelector('#drawer-backdrop'),
    drawerClose: document.querySelector('#drawer-close'),
    drawerDone: document.querySelector('#drawer-done'),
    lessonInput: document.querySelector('#lesson-input'),
    collectiveGoalInput: document.querySelector('#collective-goal-input'),
    rankupSoundStyle: document.querySelector('#rankup-sound-style'),
    rankupSoundEnabled: document.querySelector('#rankup-sound-enabled'),
    rankupSoundPreview: document.querySelector('#rankup-sound-preview'),
    editorList: document.querySelector('#student-editor-list'),
    addStudent: document.querySelector('#add-student'),
    restoreData: document.querySelector('#restore-data'),
    rankupOverlay: document.querySelector('#rankup-overlay'),
    rankupOldEmblemUse: document.querySelector('#rankup-old-emblem-use'),
    rankupNewEmblemUse: document.querySelector('#rankup-new-emblem-use'),
    rankupSkip: document.querySelector('#rankup-skip'),
    rankupStudent: document.querySelector('#rankup-student'),
    rankupOldRank: document.querySelector('#rankup-old-rank'),
    rankupNewRank: document.querySelector('#rankup-new-rank'),
    rankupClose: document.querySelector('#rankup-close'),
    toast: document.querySelector('#toast'),
  };

  function loadState() {
    try {
      return State.parseAppState(localStorage.getItem(STORAGE_KEY), defaultAppState);
    } catch {
      return defaultAppState;
    }
  }

  function saveLocalState() {
    localStorage.setItem(STORAGE_KEY, State.serializeAppState(appState));
  }

  function persist() {
    try {
      saveLocalState();
    } catch {
      showToast('浏览器无法保存本地备份');
    }
    if (!cloudSync || !isAdmin) return;
    try {
      localStorage.setItem(PENDING_KEY, State.serializeAppState(appState));
    } catch {
      showToast('浏览器无法保存待同步备份');
    }
    cloudSync.queueSave(appState);
  }

  function setCloudStatus(status) {
    const labels = {
      connecting: '正在连接',
      synced: '已同步',
      saving: '同步中',
      offline: '离线',
      failed: '同步失败',
    };
    const nextStatus = Object.prototype.hasOwnProperty.call(labels, status) ? status : 'offline';
    elements.cloudStatus.className = `cloud-status ${nextStatus}`;
    elements.cloudStatus.querySelector('span').textContent = labels[nextStatus];
    if (nextStatus === 'synced' && isAdmin && !cloudSync?.getPendingPayload()) {
      localStorage.removeItem(PENDING_KEY);
    }
  }

  function updateAdminUi() {
    elements.adminLogout.hidden = !isAdmin || !cloudSync;
    elements.addClassForm.hidden = !isAdmin;
    renderClassSwitcher();
    refreshIcons();
  }

  function requestEditAccess() {
    if (isAdmin) {
      openDrawer();
      return;
    }
    if (!cloudSync) {
      showToast('云端连接失败，请刷新后重试');
      return;
    }
    elements.adminLoginError.textContent = '';
    elements.adminPassword.value = '';
    if (!elements.adminLoginDialog.open) elements.adminLoginDialog.showModal();
    elements.adminPassword.focus();
  }

  function requireAdmin() {
    if (isAdmin) return true;
    requestEditAccess();
    return false;
  }

  function applyRemoteState(row) {
    appState = State.normalizeAppState(row.payload);
    cloudRevision = Number(row.revision) || cloudRevision;
    try {
      saveLocalState();
    } catch {
      showToast('浏览器无法保存本地备份');
    }
    renderDisplay();
    if (elements.drawer.classList.contains('is-open')) renderEditor();
  }

  async function initializeCloud() {
    if (!canUseRemoteCloud) {
      setCloudStatus('offline');
      updateAdminUi();
      return;
    }

    try {
      const client = cloudClientOverride || globalThis.supabase.createClient(
        cloudConfig.url,
        cloudConfig.anonKey,
      );
      cloudSync = Cloud.createCloudSync({
        client,
        editorEmail: cloudConfig.editorEmail,
        recordId: cloudConfig.recordId,
        normalize: State.normalizeAppState,
        onStatus: setCloudStatus,
        onRemote: applyRemoteState,
      });
      cloudSync.onAuthChange((event) => {
        if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESH_FAILED') {
          isAdmin = false;
          closeDrawer();
          updateAdminUi();
        } else if (event === 'SIGNED_IN') {
          isAdmin = true;
          updateAdminUi();
        }
      });

      isAdmin = await cloudSync.isAuthenticated();
      updateAdminUi();

      const pending = isAdmin ? localStorage.getItem(PENDING_KEY) : null;
      if (pending) {
        const pendingState = State.parseAppState(pending, appState);
        cloudSync.queueSave(pendingState);
        await cloudSync.flush();
      }

      try {
        const row = await cloudSync.load();
        applyRemoteState(row);
      } catch {
        setCloudStatus(navigator.onLine ? 'failed' : 'offline');
      }
      cloudSync.subscribe();
    } catch {
      setCloudStatus(navigator.onLine ? 'failed' : 'offline');
      updateAdminUi();
    }
  }

  async function recoverCloud() {
    if (!cloudSync || !navigator.onLine || isRecoveringCloud) return;
    isRecoveringCloud = true;
    setCloudStatus('connecting');
    try {
      if (isAdmin && cloudSync.getPendingPayload()) await cloudSync.flush();
      const row = await cloudSync.load();
      applyRemoteState(row);
    } catch {
      setCloudStatus(navigator.onLine ? 'failed' : 'offline');
    } finally {
      isRecoveringCloud = false;
    }
  }

  function handleOffline() {
    if (cloudSync) setCloudStatus('offline');
  }

  function handleOnline() {
    void recoverCloud();
  }

  async function submitAdminLogin(event) {
    event.preventDefault();
    if (!cloudSync) return;
    const submitButton = elements.adminLoginForm.querySelector('button[type="submit"]');
    const password = elements.adminPassword.value;
    elements.adminLoginError.textContent = '';
    submitButton.disabled = true;
    try {
      await cloudSync.signIn(password);
      isAdmin = true;
      updateAdminUi();
      elements.adminLoginDialog.close();
      openDrawer();
    } catch (error) {
      elements.adminLoginError.textContent = error?.message || '登录失败，请检查密码';
    } finally {
      elements.adminPassword.value = '';
      submitButton.disabled = false;
    }
  }

  async function signOutAdmin() {
    if (!cloudSync) return;
    try {
      await cloudSync.signOut();
      isAdmin = false;
      closeDrawer();
      updateAdminUi();
      showToast('已退出管理模式');
    } catch {
      showToast('退出失败，请稍后重试');
    }
  }

  function activeClassroom() {
    return State.getActiveClassroom(appState);
  }

  function studentTotalPoints(classroom, student) {
    return State.getStudentTotalPoints(classroom, student.id);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function rankSoftColor(rank) {
    const colors = {
      bronze: '#f6e9df',
      silver: '#edf0f3',
      gold: '#fff3c8',
      platinum: '#e1f3ef',
      diamond: '#edf1ff',
      star: '#f0e9fb',
      king: '#fff1bd',
    };
    return colors[rank.className] || '#f2f2f2';
  }

  const validRankClasses = new Set(Ranks.ranks.map((rank) => rank.className));

  function rankEmblemHref(rank) {
    const className = validRankClasses.has(rank?.className) ? rank.className : 'bronze';
    return `#rank-emblem-${className}`;
  }

  function renderRankEmblem(rank, className = '') {
    return `
      <svg class="rank-emblem-art ${escapeHtml(className)}" viewBox="0 0 300 300" aria-hidden="true">
        <use class="rank-emblem-use" width="100%" height="100%" href="${rankEmblemHref(rank)}"></use>
      </svg>
    `;
  }

  function avatarTone(student) {
    const value = String(student.id).split('').reduce((sum, character) => sum + character.charCodeAt(0), 0);
    return value % 4;
  }

  function studentAvatar(student) {
    const initial = Array.from(student.name.trim())[0] || '学';
    return `<span class="avatar tone-${avatarTone(student)}" aria-hidden="true">${escapeHtml(initial)}</span>`;
  }

  function renderBadge(student, field) {
    const category = categories.find((candidate) => candidate.field === field);
    const level = badgeLevels.find((candidate) => candidate.level === student.badges?.[field])
      || badgeLevels[0];
    const categoryLabel = category?.label || inputLabels[field] || '模块';
    return `
      <span class="module-badge ${level.level}" data-module-field="${escapeHtml(field)}" data-badge-level="${level.level}" data-badge-stars="${level.stars}" aria-label="${escapeHtml(student.name)}的${categoryLabel}徽章：${level.fullLabel}" title="${level.fullLabel}">
        <span class="module-badge-emblem" aria-hidden="true">
          <i data-lucide="${category?.icon || 'badge-check'}"></i>
          <span class="module-badge-stars">${'★'.repeat(level.stars)}</span>
        </span>
        <span class="module-badge-label">${level.label}</span>
      </span>
    `;
  }

  function refreshIcons() {
    if (globalThis.lucide && typeof globalThis.lucide.createIcons === 'function') {
      globalThis.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
    }
  }

  function renderClassSwitcher() {
    const current = activeClassroom();
    elements.currentClassName.textContent = current.name;
    const disableDelete = appState.classes.length <= 1;
    elements.classList.innerHTML = appState.classes.map((classroom) => {
      const isCurrent = classroom.id === appState.activeClassId;
      if (isAdmin && classroom.id === editingClassId) {
        return `
          <div class="class-row is-editing" data-class-row>
            <form class="class-rename-form" data-class-rename-form="${escapeHtml(classroom.id)}">
              <input class="class-rename-input" type="text" maxlength="30" value="${escapeHtml(classroom.name)}" aria-label="重命名${escapeHtml(classroom.name)}">
              <button class="class-row-action class-save-button" type="submit" aria-label="保存班级名称" title="保存">
                <i data-lucide="check" aria-hidden="true"></i>
              </button>
              <button class="class-row-action" type="button" data-class-rename-cancel="${escapeHtml(classroom.id)}" aria-label="取消重命名" title="取消">
                <i data-lucide="x" aria-hidden="true"></i>
              </button>
            </form>
          </div>
        `;
      }
      return `
        <div class="class-row${isCurrent ? ' is-current' : ''}" data-class-row>
          <button class="class-switch-option" type="button" data-class-switch="${escapeHtml(classroom.id)}" ${isCurrent ? 'aria-current="true"' : ''}>
            <span class="class-current-marker" aria-hidden="true">
              ${isCurrent ? '<i data-lucide="circle-check"></i>' : ''}
            </span>
            <span>${escapeHtml(classroom.name)}</span>
          </button>
          ${isAdmin ? `
            <button class="class-row-action" type="button" data-class-rename="${escapeHtml(classroom.id)}" aria-label="重命名${escapeHtml(classroom.name)}" title="重命名">
              <i data-lucide="pencil" aria-hidden="true"></i>
            </button>
            <button class="class-row-action class-delete-button" type="button" data-class-delete="${escapeHtml(classroom.id)}" aria-label="删除${escapeHtml(classroom.name)}" title="删除班级" ${disableDelete ? 'disabled' : ''}>
              <i data-lucide="trash-2" aria-hidden="true"></i>
            </button>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  function setClassMenuOpen(isOpen) {
    elements.classSwitcherMenu.hidden = !isOpen;
    elements.classSwitcherButton.setAttribute('aria-expanded', String(isOpen));
    elements.classSwitcher.classList.toggle('is-open', isOpen);
    if (!isOpen) editingClassId = null;
  }

  function calculateAverage() {
    const classroom = activeClassroom();
    if (!classroom.students.length) return '0.0';
    const total = classroom.students.reduce((studentTotal, student) => (
      studentTotal + categories.reduce((categoryTotal, category) => categoryTotal + student[category.field], 0)
    ), 0);
    return (total / (classroom.students.length * categories.length)).toFixed(1);
  }

  function calculateCompletedCategories() {
    const classroom = activeClassroom();
    return categories.filter((category) => (
      classroom.students.every((student) => Number.isFinite(student[category.field]))
    )).length;
  }

  function renderSummary() {
    const classroom = activeClassroom();
    elements.lessonSubtitle.textContent = `第 ${classroom.lesson} 节课 · 课堂结束后即时更新`;
    elements.summaryStrip.innerHTML = `
      <div class="summary-item">
        <div class="summary-label">本节课课次</div>
        <div class="summary-value">${classroom.lesson} <small>节</small></div>
      </div>
      <div class="summary-item">
        <div class="summary-label">参与 / 班级均分</div>
        <div class="summary-value green">${classroom.students.length} <small>人 · ${calculateAverage()} 分</small></div>
      </div>
      <div class="summary-item">
        <div class="summary-label">完成评分</div>
        <div class="summary-value purple">${calculateCompletedCategories()} / ${categories.length} <small>项</small></div>
      </div>
    `;
  }

  function renderMotivation() {
    const classroom = activeClassroom();
    const totalPoints = classroom.students.reduce((total, student) => total + studentTotalPoints(classroom, student), 0);
    const goal = Math.max(1, classroom.collectiveGoal || State.DEFAULT_COLLECTIVE_GOAL);
    const progress = Math.min(100, Math.round((totalPoints / goal) * 100));
    elements.collectiveGoalCopy.textContent = `${totalPoints.toLocaleString('zh-CN')} / ${goal.toLocaleString('zh-CN')} 分`;
    elements.collectiveProgress.setAttribute('aria-valuenow', String(progress));
    elements.collectiveProgressFill.style.setProperty('--collective-progress', `${progress}%`);

    const progressCandidates = classroom.students.flatMap((student) => {
      const previous = classroom.previousScores?.[student.id];
      if (!previous) return [];
      const currentTotal = categories.reduce((sum, category) => sum + student[category.field], 0);
      const previousTotal = categories.reduce((sum, category) => sum + State.normalizeScore(previous[category.field]), 0);
      return [{ student, delta: currentTotal - previousTotal }];
    }).sort((left, right) => right.delta - left.delta);
    const progressWinner = progressCandidates[0];
    elements.progressStar.querySelector('.pulse-copy').innerHTML = progressWinner?.delta > 0
      ? `<div class="pulse-label">本节课进步之星</div><div class="pulse-value">${escapeHtml(progressWinner.student.name)} <strong>+${progressWinner.delta}</strong></div><div class="pulse-note">相比上一节四项总分</div>`
      : '<div class="pulse-label">本节课进步之星</div><div class="pulse-value">等待下一节课</div><div class="pulse-note">切换课次后自动比较</div>';

    const latestHonor = classroom.honorEvents?.[0];
    elements.latestHonor.querySelector('.pulse-copy').innerHTML = latestHonor
      ? `<div class="pulse-label">最新荣誉</div><div class="pulse-value">${escapeHtml(latestHonor.studentName)}</div><div class="pulse-note">${escapeHtml(latestHonor.message)}</div>`
      : '<div class="pulse-label">最新荣誉</div><div class="pulse-value">荣誉席位待点亮</div><div class="pulse-note">升级段位后将在这里播报</div>';
  }

  function renderWinners() {
    const classroom = activeClassroom();
    elements.winnersGrid.innerHTML = categories.map((category) => {
      const winner = State.sortStudents(classroom.students, category.field)[0];
      if (!winner) return '';
      const rank = Ranks.getRank(studentTotalPoints(classroom, winner));
      const initial = Array.from(winner.name.trim())[0] || '学';
      return `
        <article class="winner-card ${category.tone}">
          <div class="winner-avatar">
            <i data-lucide="crown" aria-hidden="true"></i>
            ${escapeHtml(initial)}
          </div>
          <div>
            <div class="winner-label">
              <i data-lucide="${category.icon}" aria-hidden="true"></i>
              ${category.label}第一名
            </div>
            <div class="winner-name">${escapeHtml(winner.name)}</div>
            <div class="winner-score">${winner[category.field]} 分 · ${category.honor}</div>
            <div class="winner-badge-row">${renderBadge(winner, category.field)}</div>
            <div class="student-meta">当前段位 · ${rank.name}</div>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderBoards() {
    const classroom = activeClassroom();
    elements.boardsGrid.innerHTML = categories.map((category) => {
      const students = State.sortStudents(classroom.students, category.field);
      const rows = students.map((student, index) => {
        const rank = Ranks.getRank(studentTotalPoints(classroom, student));
        return `
          <div class="board-row" data-board-student="${escapeHtml(student.id)}">
            <span class="placement">${index + 1}</span>
            <div class="board-student">
              ${studentAvatar(student)}
              <div class="student-copy">
                <div class="student-name">${escapeHtml(student.name)}</div>
                <div class="student-meta">${rank.name}</div>
              </div>
            </div>
            <div class="board-badge-cell">${renderBadge(student, category.field)}</div>
            <div class="board-score">${student[category.field]} <small>分</small></div>
          </div>
        `;
      }).join('');
      return `
        <article class="score-board ${category.tone}" data-board-field="${category.field}">
          <header class="board-header">
            <div class="board-title">
              <span class="board-icon"><i data-lucide="${category.icon}" aria-hidden="true"></i></span>
              ${category.label}分数排行榜
            </div>
            <span class="lesson-tag">第 ${classroom.lesson} 节课</span>
          </header>
          <div>${rows}</div>
        </article>
      `;
    }).join('');
  }

  function renderRanks() {
    const classroom = activeClassroom();
    const students = State.sortStudents(classroom.students.map((student) => ({
      ...student,
      totalPoints: studentTotalPoints(classroom, student),
    })), 'totalPoints');
    elements.rankList.innerHTML = students.map((student, index) => {
      const totalPoints = studentTotalPoints(classroom, student);
      const rank = Ranks.getRank(totalPoints);
      const milestone = Ranks.getNextMilestone(totalPoints);
      const progress = Math.round(Ranks.getRankProgress(totalPoints) * 100);
      return `
        <div class="rank-row" data-rank-row="${escapeHtml(student.id)}">
          <div class="rank-student">
            <span class="rank-placement">${index + 1}</span>
            ${studentAvatar(student)}
            <div class="student-copy">
              <div class="student-name">${escapeHtml(student.name)}</div>
              <div class="student-meta">第 ${classroom.lesson} 节课</div>
            </div>
          </div>
          <div class="rank-points">${totalPoints} <small>分</small></div>
          <div class="rank-tier" style="--rank-color:${rank.color};--rank-soft:${rankSoftColor(rank)}">
            ${renderRankEmblem(rank, 'rank-table-emblem')}
            <div class="rank-name">${rank.name}</div>
          </div>
          <div class="rank-remaining">${escapeHtml(milestone.label)}</div>
          <div class="rank-progress-wrap">
            <div class="progress-track" role="progressbar" aria-label="${escapeHtml(student.name)}段位进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
              <div class="progress-fill" style="--progress:${progress}%"></div>
            </div>
            <div class="progress-caption"><span>当前进度</span><span>${progress}%</span></div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderDisplay() {
    renderClassSwitcher();
    renderSummary();
    renderMotivation();
    renderWinners();
    renderBoards();
    renderRanks();
    refreshIcons();
  }

  function renderEditor() {
    const classroom = activeClassroom();
    elements.lessonInput.value = String(classroom.lesson);
    elements.collectiveGoalInput.value = String(classroom.collectiveGoal);
    if (RankupSound) {
      const soundSettings = RankupSound.getSettings();
      elements.rankupSoundStyle.value = soundSettings.style;
      elements.rankupSoundEnabled.checked = soundSettings.enabled;
    }
    const disableDelete = classroom.students.length <= 1;
    elements.editorList.innerHTML = classroom.students.map((student, index) => `
      <section class="student-editor" data-editor-row="${escapeHtml(student.id)}" aria-label="学员 ${index + 1}">
        ${editorField(student, 'name', 'text', 'name-field')}
        ${editorField(student, 'notebook', 'number')}
        ${editorField(student, 'errorBook', 'number')}
        ${editorField(student, 'draft', 'number')}
        ${editorField(student, 'module', 'number')}
        ${editorField(student, 'totalPoints', 'number', 'total-field')}
        <button class="delete-student" type="button" data-delete-student="${escapeHtml(student.id)}" aria-label="删除${escapeHtml(student.name)}" title="删除学员" ${disableDelete ? 'disabled' : ''}>
          <i data-lucide="trash-2" aria-hidden="true"></i>
        </button>
        ${renderBadgeSelectors(student)}
      </section>
    `).join('');
    refreshIcons();
  }

  function editorField(student, field, type, className) {
    const numericAttributes = type === 'number' ? 'min="0" step="1" inputmode="numeric"' : 'maxlength="30"';
    return `
      <label class="student-field ${className || ''}">
        <span>${inputLabels[field]}</span>
        <input type="${type}" ${numericAttributes} value="${escapeHtml(student[field])}" data-student-id="${escapeHtml(student.id)}" data-field="${field}" aria-label="${escapeHtml(student.name)} ${inputLabels[field]}">
      </label>
    `;
  }

  function renderBadgeSelectors(student) {
    return `
      <div class="badge-editor-grid" aria-label="${escapeHtml(student.name)}的模块徽章">
        ${categories.map((category) => `
          <div class="badge-selector">
            <span class="badge-selector-label">${category.label}徽章</span>
            <div class="badge-segments" role="group" aria-label="${escapeHtml(student.name)}的${category.label}徽章等级">
              ${badgeLevels.map((level) => {
                const isSelected = student.badges?.[category.field] === level.level;
                return `
                  <button class="badge-choice ${level.level}" type="button"
                    data-badge-student-id="${escapeHtml(student.id)}"
                    data-badge-field="${category.field}"
                    data-badge-level="${level.level}"
                    aria-label="${escapeHtml(student.name)} ${category.label}徽章 ${level.fullLabel}"
                    aria-pressed="${isSelected}"
                    title="${level.fullLabel}">
                    <span class="badge-color-swatch" aria-hidden="true">
                      <i data-lucide="${category.icon}"></i>
                      <small>${'★'.repeat(level.stars)}</small>
                    </span>
                    <span class="badge-choice-label">${level.label}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function setView(view) {
    activeView = view === 'ranks' ? 'ranks' : 'scores';
    document.querySelectorAll('[data-view]').forEach((button) => {
      const isActive = button.dataset.view === activeView;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
    const scoresView = document.querySelector('#scores-view');
    const ranksView = document.querySelector('#ranks-view');
    scoresView.classList.toggle('is-active', activeView === 'scores');
    scoresView.hidden = activeView !== 'scores';
    ranksView.classList.toggle('is-active', activeView === 'ranks');
    ranksView.hidden = activeView !== 'ranks';
    if (location.hash !== `#${activeView}`) history.replaceState(null, '', `#${activeView}`);
  }

  function openDrawer() {
    lastFocusedElement = document.activeElement;
    renderEditor();
    elements.drawer.classList.add('is-open');
    elements.drawerBackdrop.classList.add('is-open');
    elements.drawer.setAttribute('aria-hidden', 'false');
    elements.drawerBackdrop.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => elements.lessonInput.focus());
  }

  function closeDrawer() {
    elements.drawer.classList.remove('is-open');
    elements.drawerBackdrop.classList.remove('is-open');
    elements.drawer.setAttribute('aria-hidden', 'true');
    elements.drawerBackdrop.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') lastFocusedElement.focus();
  }

  function addClassroom(rawName) {
    if (!requireAdmin()) return;
    const name = rawName.trim();
    if (!name) {
      showToast('班级名称不能为空');
      elements.newClassName.focus();
      return;
    }
    appState = State.addClassroom(appState, name);
    elements.newClassName.value = '';
    persist();
    setClassMenuOpen(false);
    renderDisplay();
    if (elements.drawer.classList.contains('is-open')) renderEditor();
    elements.classSwitcherButton.focus();
    showToast(`已新增并切换到 ${name}`);
  }

  function switchClassroom(id) {
    const nextState = State.switchClassroom(appState, id);
    if (nextState === appState) {
      setClassMenuOpen(false);
      elements.classSwitcherButton.focus();
      return;
    }
    appState = nextState;
    persist();
    setClassMenuOpen(false);
    renderDisplay();
    if (elements.drawer.classList.contains('is-open')) renderEditor();
    elements.classSwitcherButton.focus();
    showToast(`已切换到 ${activeClassroom().name}`);
  }

  function beginRenameClassroom(id) {
    if (!requireAdmin()) return;
    editingClassId = id;
    renderClassSwitcher();
    refreshIcons();
    requestAnimationFrame(() => {
      const input = elements.classList.querySelector('.class-rename-input');
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  function finishRenameClassroom(id, rawName) {
    if (!requireAdmin()) return;
    const classroom = appState.classes.find((candidate) => candidate.id === id);
    const name = rawName.trim();
    editingClassId = null;
    if (!classroom || !name) {
      renderClassSwitcher();
      refreshIcons();
      elements.classSwitcherButton.focus();
      if (!name) showToast('班级名称不能为空，已恢复原名称');
      return;
    }
    appState = State.renameClassroom(appState, id, name);
    persist();
    renderDisplay();
    elements.classSwitcherButton.focus();
    showToast(`已重命名为 ${name}`);
  }

  function removeClassroom(id) {
    if (!requireAdmin()) return;
    const classroom = appState.classes.find((candidate) => candidate.id === id);
    if (!classroom || appState.classes.length <= 1) {
      showToast('至少保留一个班级');
      return;
    }
    if (!globalThis.confirm(`确定删除“${classroom.name}”吗？该班级的数据将被删除。`)) return;
    appState = State.removeClassroom(appState, id);
    editingClassId = null;
    persist();
    renderDisplay();
    if (elements.drawer.classList.contains('is-open')) renderEditor();
    elements.classSwitcherButton.focus();
    showToast(`已删除 ${classroom.name}`);
  }

  function updateLesson(rawValue) {
    if (!requireAdmin()) return;
    const classroom = activeClassroom();
    const nextLesson = Math.max(1, State.normalizeScore(rawValue || 1));
    if (nextLesson === classroom.lesson) {
      elements.lessonInput.value = String(classroom.lesson);
      return;
    }
    const previousScores = Object.fromEntries(classroom.students.map((student) => [
      student.id,
      Object.fromEntries(categories.map((category) => [category.field, student[category.field]])),
    ]));
    appState = State.updateActiveClassroom(appState, (current) => ({
      ...State.switchLesson(current, nextLesson),
      previousScores,
    }));
    persist();
    renderDisplay();
    elements.lessonInput.value = String(nextLesson);
    showToast(`已切换到第 ${nextLesson} 节课`);
  }

  function updateCollectiveGoal(rawValue) {
    if (!requireAdmin()) return;
    const classroom = activeClassroom();
    const nextGoal = Math.max(1, State.normalizeScore(rawValue || State.DEFAULT_COLLECTIVE_GOAL));
    if (nextGoal === classroom.collectiveGoal) {
      elements.collectiveGoalInput.value = String(classroom.collectiveGoal);
      return;
    }
    appState = State.updateActiveClassroom(appState, { collectiveGoal: nextGoal });
    persist();
    renderMotivation();
    elements.collectiveGoalInput.value = String(nextGoal);
    showToast(`全班目标已更新为 ${nextGoal.toLocaleString('zh-CN')} 分`);
  }

  function updateStudentFromInput(input) {
    if (!requireAdmin()) return;
    const classroom = activeClassroom();
    const student = classroom.students.find((candidate) => candidate.id === input.dataset.studentId);
    if (!student) return;
    const field = input.dataset.field;
    const isName = field === 'name';
    const nextValue = isName ? input.value.trim() : State.normalizeScore(input.value);
    if (isName && !nextValue) {
      input.value = student.name;
      showToast('姓名不能为空');
      return;
    }
    if (student[field] === nextValue) {
      input.value = String(student[field]);
      return;
    }

    const previousPoints = studentTotalPoints(classroom, student);
    const isRankUpgrade = field === 'totalPoints' && Ranks.isRankUpgrade(previousPoints, nextValue);
    appState = State.updateActiveClassroom(appState, (current) => {
      const updatedClassroom = field === 'name'
        ? State.updateStudent(current, student.id, { name: nextValue })
        : State.updateStudentScore(current, student.id, field, nextValue);
      if (!isRankUpgrade) return updatedClassroom;
      const nextRank = Ranks.getRank(nextValue);
      return {
        ...updatedClassroom,
        honorEvents: [{
          id: `rank-${Date.now()}-${student.id}`,
          studentName: student.name,
          message: `晋升 ${nextRank.name}`,
          createdAt: Date.now(),
        }, ...(current.honorEvents || [])],
      };
    });
    persist();
    renderDisplay();
    input.value = String(nextValue);
    if (field !== 'totalPoints') {
      const updatedStudent = activeClassroom().students.find((candidate) => candidate.id === student.id);
      const totalInput = elements.editorList.querySelector(
        `[data-student-id="${CSS.escape(student.id)}"][data-field="totalPoints"]`,
      );
      if (updatedStudent && totalInput) totalInput.value = String(studentTotalPoints(activeClassroom(), updatedStudent));
    }

    if (isRankUpgrade) {
      showRankUpgrade(student.name, previousPoints, nextValue);
    }
  }

  function updateStudentBadge(button) {
    if (!requireAdmin()) return;
    const classroom = activeClassroom();
    const student = classroom.students.find((candidate) => candidate.id === button.dataset.badgeStudentId);
    const field = button.dataset.badgeField;
    const level = button.dataset.badgeLevel;
    const isKnownField = categories.some((category) => category.field === field);
    const isKnownLevel = badgeLevels.some((candidate) => candidate.level === level);
    if (!student || !isKnownField || !isKnownLevel || student.badges?.[field] === level) return;

    const nextBadges = { ...student.badges, [field]: level };
    appState = State.updateActiveClassroom(appState, (current) => (
      State.updateStudent(current, student.id, { badges: nextBadges })
    ));
    persist();
    renderDisplay();
    renderEditor();

    const selectedButton = elements.editorList.querySelector(
      `[data-badge-student-id="${CSS.escape(student.id)}"][data-badge-field="${field}"][data-badge-level="${level}"]`,
    );
    if (selectedButton) selectedButton.focus({ preventScroll: true });
  }

  function addStudent() {
    if (!requireAdmin()) return;
    const classroom = activeClassroom();
    let suffix = Date.now();
    while (classroom.students.some((student) => student.id === `student-${suffix}`)) suffix += 1;
    appState = State.updateActiveClassroom(appState, (current) => State.addStudent(current, {
        id: `student-${suffix}`,
        name: `新学员${current.students.length + 1}`,
        notebook: 0,
        errorBook: 0,
        draft: 0,
        module: 0,
        totalPoints: 0,
      }));
    persist();
    renderDisplay();
    renderEditor();
    const newNameInput = elements.editorList.querySelector(`[data-student-id="student-${suffix}"][data-field="name"]`);
    if (newNameInput) {
      newNameInput.focus();
      newNameInput.select();
      newNameInput.scrollIntoView({ block: 'center' });
    }
    showToast('已新增一名学员');
  }

  function removeStudent(id) {
    if (!requireAdmin()) return;
    const classroom = activeClassroom();
    const student = classroom.students.find((candidate) => candidate.id === id);
    if (!student || classroom.students.length <= 1) {
      showToast('至少保留一名学员');
      return;
    }
    if (!globalThis.confirm(`确定删除“${student.name}”吗？`)) return;
    appState = State.updateActiveClassroom(appState, (current) => State.removeStudent(current, id));
    persist();
    renderDisplay();
    renderEditor();
    showToast(`已删除 ${student.name}`);
  }

  function restoreDefaultData() {
    if (!requireAdmin()) return;
    if (!globalThis.confirm('确定恢复示例数据吗？当前班级的修改将被覆盖。')) return;
    const sample = State.createDefaultState();
    appState = State.updateActiveClassroom(appState, (classroom) => ({
      ...classroom,
      lesson: sample.lesson,
      students: sample.students,
      lessonRecords: {},
      carryoverPoints: {},
      previousScores: {},
    }));
    persist();
    renderDisplay();
    renderEditor();
    showToast('已恢复示例数据');
  }

  function showRankUpgrade(studentName, previousPoints, nextPoints) {
    const previousRank = Ranks.getRank(previousPoints);
    const nextRank = Ranks.getRank(nextPoints);
    rankupReturnFocus = document.activeElement;
    clearTimeout(rankupAutoCloseTimer);
    rankupAutoCloseTimer = null;
    closeDrawer();
    elements.rankupStudent.textContent = studentName;
    elements.rankupOldRank.textContent = previousRank.name;
    elements.rankupNewRank.textContent = nextRank.name;
    elements.rankupOldEmblemUse.setAttribute('href', rankEmblemHref(previousRank));
    elements.rankupNewEmblemUse.setAttribute('href', rankEmblemHref(nextRank));
    elements.rankupOverlay.style.setProperty('--new-rank-color', nextRank.color);
    elements.rankupOverlay.dataset.rankClass = nextRank.className;
    elements.rankupOverlay.dataset.animation = 'rankup-v2';
    elements.rankupOverlay.classList.remove('is-active', 'is-revealed');
    elements.rankupClose.disabled = true;
    elements.rankupSkip.disabled = false;
    void elements.rankupOverlay.offsetWidth;
    elements.rankupOverlay.classList.add('is-active');
    elements.rankupOverlay.setAttribute('aria-hidden', 'false');
    if (RankupSound) RankupSound.play(RankupSound.getSettings().style);
    refreshIcons();
    requestAnimationFrame(() => elements.rankupOverlay.focus({ preventScroll: true }));

    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finishRankupAnimation();
      return;
    }

    rankupAutoCloseTimer = setTimeout(() => {
      rankupAutoCloseTimer = null;
      finishRankupAnimation();
    }, 5200);
  }

  function finishRankupAnimation() {
    if (!elements.rankupOverlay.classList.contains('is-active')) return;
    elements.rankupOverlay.classList.add('is-revealed');
    elements.rankupSkip.disabled = true;
    elements.rankupClose.disabled = false;
    elements.rankupClose.focus({ preventScroll: true });
  }

  function closeRankUpgrade() {
    if (!elements.rankupOverlay.classList.contains('is-active')) return;
    clearTimeout(rankupAutoCloseTimer);
    rankupAutoCloseTimer = null;
    elements.rankupOverlay.classList.remove('is-active', 'is-revealed');
    elements.rankupOverlay.setAttribute('aria-hidden', 'true');
    delete elements.rankupOverlay.dataset.animation;
    elements.rankupSkip.disabled = true;
    elements.rankupClose.disabled = true;
    const returnTarget = rankupReturnFocus;
    rankupReturnFocus = null;
    const canRestorePreviousFocus = returnTarget instanceof HTMLElement
      && returnTarget.isConnected
      && !returnTarget.hasAttribute('disabled')
      && !returnTarget.closest('[hidden], [aria-hidden="true"]')
      && returnTarget.getClientRects().length > 0;
    (canRestorePreviousFocus ? returnTarget : elements.editButton).focus();
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add('is-visible');
    toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 2200);
  }

  function saveRankupSoundSettings() {
    if (!RankupSound) return;
    const settings = RankupSound.saveSettings({
      style: elements.rankupSoundStyle.value,
      enabled: elements.rankupSoundEnabled.checked,
    });
    elements.rankupSoundStyle.value = settings.style;
    elements.rankupSoundEnabled.checked = settings.enabled;
  }

  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });
  elements.classSwitcherButton.addEventListener('click', () => {
    const isOpen = elements.classSwitcherButton.getAttribute('aria-expanded') === 'true';
    setClassMenuOpen(!isOpen);
    if (!isOpen) {
      renderClassSwitcher();
      refreshIcons();
    }
  });
  elements.addClassForm.addEventListener('submit', (event) => {
    event.preventDefault();
    addClassroom(elements.newClassName.value);
  });
  elements.classList.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-class-rename-form]');
    if (!form) return;
    event.preventDefault();
    finishRenameClassroom(form.dataset.classRenameForm, form.querySelector('.class-rename-input').value);
  });
  elements.classList.addEventListener('click', (event) => {
    const switchButton = event.target.closest('[data-class-switch]');
    if (switchButton) {
      switchClassroom(switchButton.dataset.classSwitch);
      return;
    }
    const renameButton = event.target.closest('[data-class-rename]');
    if (renameButton) {
      beginRenameClassroom(renameButton.dataset.classRename);
      return;
    }
    const cancelButton = event.target.closest('[data-class-rename-cancel]');
    if (cancelButton) {
      editingClassId = null;
      renderClassSwitcher();
      refreshIcons();
      elements.classSwitcherButton.focus();
      return;
    }
    const deleteButton = event.target.closest('[data-class-delete]');
    if (deleteButton) removeClassroom(deleteButton.dataset.classDelete);
  });
  elements.editButton.addEventListener('click', requestEditAccess);
  elements.adminLoginForm.addEventListener('submit', submitAdminLogin);
  elements.adminLoginCancel.addEventListener('click', () => {
    elements.adminLoginError.textContent = '';
    elements.adminPassword.value = '';
    elements.adminLoginDialog.close();
    elements.editButton.focus();
  });
  elements.adminLogout.addEventListener('click', signOutAdmin);
  elements.drawerClose.addEventListener('click', closeDrawer);
  elements.drawerDone.addEventListener('click', closeDrawer);
  elements.drawerBackdrop.addEventListener('click', closeDrawer);
  elements.lessonInput.addEventListener('change', () => updateLesson(elements.lessonInput.value));
  elements.collectiveGoalInput.addEventListener('change', () => updateCollectiveGoal(elements.collectiveGoalInput.value));
  elements.rankupSoundStyle.addEventListener('change', () => {
    saveRankupSoundSettings();
    const currentStyle = RankupSound.getSettings().style;
    const option = RankupSound.options.find((candidate) => candidate.id === currentStyle);
    showToast(`已选择${option?.label || '王者号角'}音效`);
  });
  elements.rankupSoundEnabled.addEventListener('change', () => {
    saveRankupSoundSettings();
    showToast(elements.rankupSoundEnabled.checked ? '已开启晋级音效' : '已静音晋级音效');
  });
  elements.rankupSoundPreview.addEventListener('click', () => {
    saveRankupSoundSettings();
    if (!RankupSound.play(RankupSound.getSettings().style)) showToast('晋级音效已静音');
  });
  elements.addStudent.addEventListener('click', addStudent);
  elements.restoreData.addEventListener('click', restoreDefaultData);
  elements.rankupSkip.addEventListener('click', finishRankupAnimation);
  elements.rankupClose.addEventListener('click', closeRankUpgrade);
  elements.editorList.addEventListener('change', (event) => {
    if (event.target.matches('input[data-student-id][data-field]')) updateStudentFromInput(event.target);
  });
  elements.editorList.addEventListener('click', (event) => {
    const badgeButton = event.target.closest('[data-badge-student-id][data-badge-field][data-badge-level]');
    if (badgeButton) {
      updateStudentBadge(badgeButton);
      return;
    }
    const deleteButton = event.target.closest('[data-delete-student]');
    if (deleteButton) removeStudent(deleteButton.dataset.deleteStudent);
  });
  document.addEventListener('click', (event) => {
    if (elements.classSwitcherButton.getAttribute('aria-expanded') === 'true'
      && !event.composedPath().includes(elements.classSwitcher)) {
      setClassMenuOpen(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (elements.classSwitcherButton.getAttribute('aria-expanded') === 'true') {
      setClassMenuOpen(false);
      elements.classSwitcherButton.focus();
    } else if (elements.rankupOverlay.classList.contains('is-active')) closeRankUpgrade();
    else if (elements.drawer.classList.contains('is-open')) closeDrawer();
  });

  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);

  renderDisplay();
  setView(location.hash === '#ranks' ? 'ranks' : 'scores');
  updateAdminUi();
  void initializeCloud();
})();
