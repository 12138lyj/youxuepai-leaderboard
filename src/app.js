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
  const customCategories = [
    { field: 'punctuality', label: '准时先锋', icon: 'clock-3', tone: 'yellow', honor: '准时先锋', color: '#d39a00', soft: '#fff4c9', deep: '#8c6500' },
    { field: 'afterClassTest', label: '测评达人', icon: 'clipboard-check', tone: 'purple', honor: '测评达人', color: '#a487db', soft: '#f0e9fb', deep: '#69509f' },
    { field: 'homework', label: '作业之星', icon: 'notebook-pen', tone: 'green', honor: '作业之星', color: '#49ad7f', soft: '#e6f5ed', deep: '#267c59' },
    { field: 'participation', label: '课堂活力', icon: 'messages-square', tone: 'coral', honor: '课堂活力', color: '#ef746a', soft: '#fdeae7', deep: '#a5443c' },
    { field: 'preview', label: '预习先行', icon: 'book-open-check', tone: 'blue', honor: '预习先行', color: '#6b86d7', soft: '#edf1ff', deep: '#3d5eae' },
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
  let soundEditorSource = null;
  let soundDraft = null;
  let activeSoundPlayback = null;
  let historySnapshots = [];
  let selectedHistorySnapshot = null;
  let historyBusy = false;
  let historyReturnFocus = null;
  let pendingCourseName = '';

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
    customView: document.querySelector('#custom-view'),
    customCourseTitle: document.querySelector('#custom-course-title'),
    customCourseSubtitle: document.querySelector('#custom-course-subtitle'),
    customSummaryStrip: document.querySelector('#custom-summary-strip'),
    customTotalPoints: document.querySelector('#custom-total-points'),
    customTotalCaption: document.querySelector('#custom-total-caption'),
    customTopStudent: document.querySelector('#custom-top-student'),
    customModuleGrid: document.querySelector('#custom-module-grid'),
    customStudentTable: document.querySelector('#custom-student-table'),
    courseNameInput: document.querySelector('#custom-course-name'),
    classSwitcher: document.querySelector('.class-switcher'),
    classSwitcherButton: document.querySelector('#class-switcher-button'),
    currentClassName: document.querySelector('#current-class-name'),
    currentCourseSystem: document.querySelector('#current-course-system'),
    classSwitcherMenu: document.querySelector('#class-switcher-menu'),
    classList: document.querySelector('#class-list'),
    addClassForm: document.querySelector('#add-class-form'),
    newClassName: document.querySelector('#new-class-name'),
    courseSystemDialog: document.querySelector('#course-system-dialog'),
    pendingCourseName: document.querySelector('#pending-course-name'),
    courseSystemButtons: [...document.querySelectorAll('[data-course-system]')],
    courseSystemCancel: document.querySelector('#course-system-cancel'),
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
    rankupSoundSourceButtons: [...document.querySelectorAll('[data-sound-source]')],
    rankupSoundBuiltinPanel: document.querySelector('#rankup-sound-builtin-panel'),
    rankupSoundUploadPanel: document.querySelector('#rankup-sound-upload-panel'),
    rankupSoundUrlPanel: document.querySelector('#rankup-sound-url-panel'),
    rankupSoundFile: document.querySelector('#rankup-sound-file'),
    rankupSoundPickFile: document.querySelector('#rankup-sound-pick-file'),
    rankupSoundFileName: document.querySelector('#rankup-sound-file-name'),
    rankupSoundUrl: document.querySelector('#rankup-sound-url'),
    rankupSoundLoadUrl: document.querySelector('#rankup-sound-load-url'),
    rankupClipEditor: document.querySelector('#rankup-clip-editor'),
    rankupClipSourceName: document.querySelector('#rankup-clip-source-name'),
    rankupClipStart: document.querySelector('#rankup-clip-start'),
    rankupClipRange: document.querySelector('#rankup-clip-range'),
    rankupSoundSaveClip: document.querySelector('#rankup-sound-save-clip'),
    rankupSoundReset: document.querySelector('#rankup-sound-reset'),
    rankupSoundStatus: document.querySelector('#rankup-sound-status'),
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
    historyOpen: document.querySelector('#history-open'),
    historyCount: document.querySelector('#history-count'),
    historyDialog: document.querySelector('#history-dialog'),
    historyList: document.querySelector('#history-list'),
    historyClose: document.querySelector('#history-close'),
    historyRestoreDialog: document.querySelector('#history-restore-dialog'),
    historyConfirmCopy: document.querySelector('#history-confirm-copy'),
    historyRestoreCancel: document.querySelector('#history-restore-cancel'),
    historyRestoreConfirm: document.querySelector('#history-restore-confirm'),
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
    setView(activeView);
    if (elements.drawer.classList.contains('is-open')) renderEditor();
    if (elements.historyDialog.open) renderHistory();
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
          closeHistory();
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
      closeHistory();
      updateAdminUi();
      showToast('已退出管理模式');
    } catch {
      showToast('退出失败，请稍后重试');
    }
  }

  function activeClassroom() {
    return State.getActiveClassroom(appState);
  }

  function isCustomLayout() {
    return activeClassroom()?.systemType === 'custom';
  }

  function currentCategories() {
    return isCustomLayout() ? customCategories : categories;
  }

  function studentTotalPoints(classroom, student) {
    return isCustomLayout()
      ? State.getCustomStudentTotalPoints(classroom, student.id)
      : State.getStudentTotalPoints(classroom, student.id);
  }

  function studentModuleScore(classroom, student, category, mode = isCustomLayout() ? 'custom' : 'classic') {
    if (mode === 'custom') return State.getCustomStudentScores(classroom, student.id)[category.field] || 0;
    return student[category.field] || 0;
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

  function renderBadge(student, field, mode = isCustomLayout() ? 'custom' : 'classic') {
    const categoryList = mode === 'custom' ? customCategories : categories;
    const category = categoryList.find((candidate) => candidate.field === field);
    const classroom = activeClassroom();
    const storedLevel = mode === 'custom'
      ? classroom?.customBadges?.[String(student.id)]?.[field]
      : student.badges?.[field];
    const level = badgeLevels.find((candidate) => candidate.level === storedLevel)
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

  function courseSystemLabel(systemType) {
    return systemType === 'custom' ? '成长积分系统' : '四项习惯系统';
  }

  function renderClassSwitcher() {
    const current = activeClassroom();
    elements.currentClassName.textContent = current.name;
    elements.currentCourseSystem.textContent = courseSystemLabel(current.systemType);
    const disableDelete = appState.classes.length <= 1;
    elements.classList.innerHTML = appState.classes.map((classroom) => {
      const isCurrent = classroom.id === appState.activeClassId;
      if (isAdmin && classroom.id === editingClassId) {
        return `
          <div class="class-row is-editing" data-class-row>
            <form class="class-rename-form" data-class-rename-form="${escapeHtml(classroom.id)}">
              <input class="class-rename-input" type="text" maxlength="30" value="${escapeHtml(classroom.name)}" aria-label="重命名${escapeHtml(classroom.name)}">
              <button class="class-row-action class-save-button" type="submit" aria-label="保存课程名称" title="保存">
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
            <span class="class-course-copy">
              <strong>${escapeHtml(classroom.name)}</strong>
              <small class="class-system-tag ${classroom.systemType === 'custom' ? 'custom' : 'classic'}">${courseSystemLabel(classroom.systemType)}</small>
            </span>
          </button>
          ${isAdmin ? `
            <button class="class-row-action" type="button" data-class-rename="${escapeHtml(classroom.id)}" aria-label="重命名${escapeHtml(classroom.name)}" title="重命名">
              <i data-lucide="pencil" aria-hidden="true"></i>
            </button>
            <button class="class-row-action class-delete-button" type="button" data-class-delete="${escapeHtml(classroom.id)}" aria-label="删除${escapeHtml(classroom.name)}" title="删除课程" ${disableDelete ? 'disabled' : ''}>
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

  function renderCustomCourse() {
    const classroom = activeClassroom();
    const courseName = classroom.name;
    const students = classroom.students || [];
    const totalPoints = students.reduce((total, student) => total + State.getCustomStudentTotalPoints(classroom, student.id), 0);
    const currentScores = students.flatMap((student) => customCategories.map((category) => (
      State.getCustomStudentScores(classroom, student.id)[category.field] || 0
    )));
    const average = students.length ? (currentScores.reduce((sum, value) => sum + value, 0) / (students.length * customCategories.length)).toFixed(1) : '0.0';
    const topStudent = [...students].sort((left, right) => (
      State.getCustomStudentTotalPoints(classroom, right.id) - State.getCustomStudentTotalPoints(classroom, left.id)
      || String(left.name).localeCompare(String(right.name), 'zh-CN')
    ))[0];

    elements.customCourseTitle.textContent = courseName;
    elements.customCourseSubtitle.textContent = `第 ${classroom.lesson} 节课 · 五项评分即时更新 · 累计分数参与段位计算`;
    elements.customSummaryStrip.innerHTML = `
      <div class="summary-item">
        <div class="summary-label">本节课课次</div>
        <div class="summary-value">${classroom.lesson} <small>节</small></div>
      </div>
      <div class="summary-item">
        <div class="summary-label">参与 / 五项均分</div>
        <div class="summary-value green">${students.length} <small>人 · ${average} 分</small></div>
      </div>
      <div class="summary-item">
        <div class="summary-label">评分模块</div>
        <div class="summary-value purple">${customCategories.length} <small>项</small></div>
      </div>
    `;
    elements.customTotalPoints.textContent = totalPoints.toLocaleString('zh-CN');
    elements.customTotalCaption.textContent = `全班累计 ${totalPoints.toLocaleString('zh-CN')} 分 · 五项评分全部计入总分与段位`;
    elements.customTopStudent.innerHTML = topStudent
      ? `<div class="custom-top-student-label">当前累计领跑</div><div class="custom-top-student-name">${escapeHtml(topStudent.name)}</div><div class="custom-top-student-meta">${State.getCustomStudentTotalPoints(classroom, topStudent.id).toLocaleString('zh-CN')} 分 · ${Ranks.getRank(State.getCustomStudentTotalPoints(classroom, topStudent.id)).name}</div>`
      : '<div class="custom-top-student-label">当前累计领跑</div><div class="custom-top-student-name">等待学员</div>';

    elements.customModuleGrid.innerHTML = customCategories.map((category) => {
      const ranked = [...students].sort((left, right) => (
        studentModuleScore(classroom, right, category, 'custom') - studentModuleScore(classroom, left, category, 'custom')
        || String(left.name).localeCompare(String(right.name), 'zh-CN')
      ));
      const rows = ranked.map((student, index) => `
        <div class="custom-module-row">
          <span class="custom-module-rank">${index + 1}</span>
          <div class="custom-module-student">
            ${studentAvatar(student)}
            <span class="custom-module-student-name">${escapeHtml(student.name)}</span>
          </div>
          <span class="custom-module-score">${studentModuleScore(classroom, student, category, 'custom')}<small>分</small></span>
        </div>
      `).join('');
      return `
        <article class="custom-module-card" style="--module-color:${category.color};--module-soft:${category.soft};--module-deep:${category.deep}">
          <header class="custom-module-card-header">
            <span class="custom-module-icon"><i data-lucide="${category.icon}" aria-hidden="true"></i></span>
            <span class="custom-module-name">${escapeHtml(category.label)}</span>
          </header>
          <div>${rows || '<p class="history-empty">暂无学员</p>'}</div>
        </article>
      `;
    }).join('');

    const sortedStudents = [...students].sort((left, right) => (
      State.getCustomStudentTotalPoints(classroom, right.id) - State.getCustomStudentTotalPoints(classroom, left.id)
      || String(left.name).localeCompare(String(right.name), 'zh-CN')
    ));
    const headerCells = ['学员', ...customCategories.map((category) => category.label), '累计 / 段位'];
    elements.customStudentTable.innerHTML = `
      <div class="custom-student-grid header">${headerCells.map((label) => `<span>${escapeHtml(label)}</span>`).join('')}</div>
      ${sortedStudents.map((student) => {
        const total = State.getCustomStudentTotalPoints(classroom, student.id);
        const rank = Ranks.getRank(total);
        const scores = State.getCustomStudentScores(classroom, student.id);
        return `
          <div class="custom-student-grid" data-custom-student="${escapeHtml(student.id)}">
            <span class="custom-student-name-cell">${studentAvatar(student)}<span>${escapeHtml(student.name)}</span></span>
            ${customCategories.map((category) => `<span class="custom-student-score">${scores[category.field] || 0}<small> 分</small></span>`).join('')}
            <span class="custom-student-total">${total}<small> 分</small><span class="custom-student-rank">${renderRankEmblem(rank, 'rank-mini-emblem')}${escapeHtml(rank.shortName)}</span></span>
          </div>
        `;
      }).join('')}
    `;
  }

  function renderDisplay() {
    renderClassSwitcher();
    renderSummary();
    renderMotivation();
    renderWinners();
    renderBoards();
    renderRanks();
    renderCustomCourse();
    refreshIcons();
  }

  function snapshotSummary(snapshot) {
    const payload = State.normalizeAppState(snapshot.payload);
    const classrooms = payload.classes || [];
    const students = classrooms.reduce((total, classroom) => total + classroom.students.length, 0);
    const points = classrooms.reduce((total, classroom) => total + classroom.students.reduce(
      (sum, student) => sum + (classroom.systemType === 'custom'
        ? State.getCustomStudentTotalPoints(classroom, student.id)
        : State.getStudentTotalPoints(classroom, student.id)), 0,
    ), 0);
    const activeCourse = State.getActiveClassroom(payload);
    const sound = payload.rankupSound;
    const audio = !sound.enabled
      ? '已静音'
      : sound.source === 'builtin'
        ? soundStyleLabel(sound.style)
        : sound.name || (sound.source === 'url' ? '网址音效' : '自定义音效');
    return {
      classes: classrooms.length,
      students,
      points,
      lesson: activeCourse?.lesson || 0,
      audio,
      courseName: activeCourse
        ? `${activeCourse.name} · ${courseSystemLabel(activeCourse.systemType)}`
        : '课程未命名',
    };
  }

  function formatHistoryDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间未知';
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function renderHistory() {
    const currentRevision = cloudSync?.getRevision?.() || cloudRevision;
    elements.historyCount.textContent = historySnapshots.length
      ? String(historySnapshots.length)
      : '--';
    if (!historySnapshots.length) {
      elements.historyList.innerHTML = '<p class="history-empty">暂时没有历史版本</p>';
      return;
    }
    elements.historyList.innerHTML = historySnapshots.map((snapshot) => {
      const summary = snapshotSummary(snapshot);
      const current = Number(snapshot.revision) === currentRevision;
      return `
        <article class="history-version">
          <span class="history-version-number">v${Number(snapshot.revision)}</span>
          <div>
            <h3>${summary.lesson ? `第 ${summary.lesson} 节课 · ` : ''}${current ? '当前版本' : '自动保存'}</h3>
            <p>${escapeHtml(formatHistoryDate(snapshot.created_at))} · ${escapeHtml(summary.courseName)} · ${summary.classes}个课程 · ${summary.students}名学员 · 总积分 ${summary.points.toLocaleString('zh-CN')} · 音效：${escapeHtml(summary.audio)}</p>
          </div>
          <button class="history-restore-button" type="button" data-history-id="${Number(snapshot.id)}" ${current ? 'disabled' : ''}>${current ? '当前版本' : '恢复此版本'}</button>
        </article>
      `;
    }).join('');
    refreshIcons();
  }

  async function openHistory() {
    if (!requireAdmin() || !cloudSync) return;
    historyReturnFocus = document.activeElement;
    elements.historyList.innerHTML = '<p class="history-empty">正在读取历史版本...</p>';
    elements.historyDialog.showModal();
    try {
      await cloudSync.flush();
      historySnapshots = await cloudSync.listHistory();
      renderHistory();
    } catch {
      elements.historyCount.textContent = '--';
      elements.historyList.innerHTML = '<p class="history-empty is-error">历史版本读取失败，请稍后重试</p>';
    }
  }

  function closeHistory() {
    if (elements.historyRestoreDialog.open) elements.historyRestoreDialog.close();
    if (elements.historyDialog.open) elements.historyDialog.close();
    selectedHistorySnapshot = null;
    const returnTarget = historyReturnFocus;
    historyReturnFocus = null;
    const canRestoreFocus = returnTarget instanceof HTMLElement
      && returnTarget.isConnected
      && !returnTarget.hasAttribute('disabled')
      && !returnTarget.closest('[hidden], [aria-hidden="true"]')
      && returnTarget.getClientRects().length > 0;
    (canRestoreFocus ? returnTarget : elements.editButton).focus();
  }

  function requestHistoryRestore(snapshotId) {
    selectedHistorySnapshot = historySnapshots.find(
      (snapshot) => Number(snapshot.id) === Number(snapshotId),
    ) || null;
    if (!selectedHistorySnapshot) return;
    elements.historyConfirmCopy.textContent = `将整个网站恢复到 v${Number(selectedHistorySnapshot.revision)}（${formatHistoryDate(selectedHistorySnapshot.created_at)}）。所有班级、积分、徽章和音效都会替换，当前状态会先自动留档。`;
    elements.historyRestoreDialog.showModal();
  }

  function closeHistoryRestore() {
    if (historyBusy) return;
    const snapshotId = Number(selectedHistorySnapshot?.id);
    if (elements.historyRestoreDialog.open) elements.historyRestoreDialog.close();
    selectedHistorySnapshot = null;
    const returnTarget = Number.isSafeInteger(snapshotId)
      ? elements.historyList.querySelector(`[data-history-id="${snapshotId}"]`)
      : null;
    returnTarget?.focus();
  }

  async function confirmHistoryRestore() {
    if (!selectedHistorySnapshot || historyBusy || !cloudSync) return;
    historyBusy = true;
    elements.historyRestoreConfirm.disabled = true;
    elements.historyRestoreCancel.disabled = true;
    elements.historyRestoreDialog.setAttribute('aria-busy', 'true');
    const restoredRevision = Number(selectedHistorySnapshot.revision);
    try {
      let row;
      try {
        row = await cloudSync.restoreSnapshot(selectedHistorySnapshot.id);
      } catch {
        elements.historyConfirmCopy.textContent = '恢复失败，当前数据没有改变，请重试。';
        return;
      }
      applyRemoteState(row);
      elements.historyRestoreDialog.close();
      elements.historyClose.focus();
      showToast(row.superseded
        ? '恢复完成，但云端已有更新，已显示最新版本'
        : `已恢复到 v${restoredRevision}，并生成新版本`);
      try {
        historySnapshots = await cloudSync.listHistory();
        renderHistory();
      } catch {
        elements.historyCount.textContent = '--';
        elements.historyList.innerHTML = '<p class="history-empty is-error">恢复成功，但历史列表刷新失败，请关闭后重新打开</p>';
      }
    } finally {
      historyBusy = false;
      elements.historyRestoreConfirm.disabled = false;
      elements.historyRestoreCancel.disabled = false;
      elements.historyRestoreDialog.removeAttribute('aria-busy');
    }
  }

  function soundStyleLabel(style) {
    return RankupSound?.options.find((option) => option.id === style)?.label || '王者号角';
  }

  function getSoundEditorSource() {
    return soundDraft?.source || soundEditorSource || appState.rankupSound.source;
  }

  function setSoundStatus(message, isError = false) {
    elements.rankupSoundStatus.textContent = message;
    elements.rankupSoundStatus.classList.toggle('is-error', isError);
  }

  function renderSoundEditor() {
    if (!RankupSound) return;
    const settings = appState.rankupSound;
    const source = getSoundEditorSource();
    for (const button of elements.rankupSoundSourceButtons) {
      const isActive = button.dataset.soundSource === source;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }
    elements.rankupSoundBuiltinPanel.hidden = source !== 'builtin';
    elements.rankupSoundUploadPanel.hidden = source !== 'upload';
    elements.rankupSoundUrlPanel.hidden = source !== 'url';
    elements.rankupSoundStyle.value = settings.style;
    elements.rankupSoundEnabled.checked = settings.enabled;

    const customSettings = soundDraft || (
      source === settings.source && (source === 'upload' || source === 'url') ? settings : null
    );
    const uploadName = source === 'upload'
      ? soundDraft?.name || (settings.source === 'upload' ? settings.name : '')
      : '';
    elements.rankupSoundFileName.textContent = uploadName || '尚未选择文件';
    if (source === 'url' && document.activeElement !== elements.rankupSoundUrl) {
      elements.rankupSoundUrl.value = soundDraft?.url
        || (settings.source === 'url' ? settings.url : '');
    }

    elements.rankupClipEditor.hidden = !customSettings;
    if (customSettings) {
      const duration = Math.max(
        RankupSound.CLIP_DURATION,
        Number(customSettings.duration) || Number(customSettings.clipStart) + RankupSound.CLIP_DURATION,
      );
      const clipStart = RankupSound.normalizeClipStart(customSettings.clipStart, duration);
      elements.rankupClipStart.max = String(RankupSound.getMaxClipStart(duration));
      elements.rankupClipStart.value = String(clipStart);
      elements.rankupClipSourceName.textContent = customSettings.name || '自定义音效';
      elements.rankupClipRange.textContent = `${RankupSound.formatTime(clipStart)} - ${RankupSound.formatTime(clipStart + RankupSound.CLIP_DURATION)}`;
    }

    if (soundDraft) {
      setSoundStatus('已载入音乐，拖动滑块后试听并保存');
    } else if (settings.source === 'upload' || settings.source === 'url') {
      setSoundStatus(`当前：${settings.name} · ${RankupSound.formatTime(settings.clipStart)} - ${RankupSound.formatTime(settings.clipStart + RankupSound.CLIP_DURATION)} · 已同步到云端`);
    } else {
      setSoundStatus(`当前：${soundStyleLabel(settings.style)} · 已同步到云端`);
    }
  }

  function renderEditor() {
    const classroom = activeClassroom();
    elements.lessonInput.value = String(classroom.lesson);
    elements.collectiveGoalInput.value = String(classroom.collectiveGoal);
    elements.courseNameInput.value = classroom.name;
    renderSoundEditor();
    const disableDelete = classroom.students.length <= 1;
    const scoreFieldsMarkup = isCustomLayout()
      ? (student) => customCategories.map((category) => customEditorField(classroom, student, category)).join('')
      : (student) => categories.map((category) => editorField(student, category.field, 'number')).join('');
    elements.editorList.innerHTML = classroom.students.map((student, index) => `
      <section class="student-editor" data-editor-row="${escapeHtml(student.id)}" aria-label="学员 ${index + 1}">
        ${editorField(student, 'name', 'text', 'name-field')}
        ${scoreFieldsMarkup(student)}
        ${isCustomLayout() ? customTotalEditorField(classroom, student) : editorField(student, 'totalPoints', 'number', 'total-field')}
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

  function customEditorField(classroom, student, category) {
    const scores = State.getCustomStudentScores(classroom, student.id);
    return `
      <label class="student-field">
        <span>${escapeHtml(category.label)}</span>
        <input type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(scores[category.field])}" data-student-id="${escapeHtml(student.id)}" data-field="${escapeHtml(category.field)}" aria-label="${escapeHtml(student.name)} ${escapeHtml(category.label)}">
      </label>
    `;
  }

  function customTotalEditorField(classroom, student) {
    return `
      <label class="student-field total-field">
        <span>累计积分</span>
        <input type="number" min="0" step="1" inputmode="numeric" value="${State.getCustomStudentTotalPoints(classroom, student.id)}" data-student-id="${escapeHtml(student.id)}" readonly aria-label="${escapeHtml(student.name)} 累计积分">
      </label>
    `;
  }

  function renderBadgeSelectors(student) {
    const badgeCategories = isCustomLayout() ? customCategories : categories;
    const classroom = activeClassroom();
    return `
      <div class="badge-editor-grid" aria-label="${escapeHtml(student.name)}的模块徽章">
        ${badgeCategories.map((category) => `
          <div class="badge-selector">
            <span class="badge-selector-label">${category.label}徽章</span>
            <div class="badge-segments" role="group" aria-label="${escapeHtml(student.name)}的${category.label}徽章等级">
              ${badgeLevels.map((level) => {
                const currentLevel = isCustomLayout()
                  ? classroom.customBadges?.[String(student.id)]?.[category.field]
                  : student.badges?.[category.field];
                const isSelected = currentLevel === level.level;
                return `
                  <button class="badge-choice ${level.level}" type="button"
                    data-badge-student-id="${escapeHtml(student.id)}"
                    data-badge-field="${category.field}"
                    data-badge-mode="${isCustomLayout() ? 'custom' : 'classic'}"
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
    const customView = document.querySelector('#custom-view');
    const ranksView = document.querySelector('#ranks-view');
    scoresView.classList.toggle('is-active', activeView === 'scores' && !isCustomLayout());
    scoresView.hidden = activeView !== 'scores' || isCustomLayout();
    customView.classList.toggle('is-active', activeView === 'scores' && isCustomLayout());
    customView.hidden = activeView !== 'scores' || !isCustomLayout();
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

  function requestAddClassroom(rawName) {
    if (!requireAdmin()) return;
    const name = rawName.trim();
    if (!name) {
      showToast('课程名称不能为空');
      elements.newClassName.focus();
      return;
    }
    pendingCourseName = name;
    elements.pendingCourseName.textContent = name;
    if (!elements.courseSystemDialog.open) elements.courseSystemDialog.showModal();
    requestAnimationFrame(() => elements.courseSystemButtons[0]?.focus());
  }

  function cancelAddClassroom() {
    pendingCourseName = '';
    if (elements.courseSystemDialog.open) elements.courseSystemDialog.close();
    requestAnimationFrame(() => elements.newClassName.focus());
  }

  function addClassroom(systemType) {
    if (!requireAdmin() || !pendingCourseName) return;
    const normalizedSystemType = State.normalizeCourseSystemType(systemType);
    const name = pendingCourseName;
    appState = State.addClassroom(appState, { name, systemType: normalizedSystemType });
    pendingCourseName = '';
    if (elements.courseSystemDialog.open) elements.courseSystemDialog.close();
    elements.newClassName.value = '';
    persist();
    setClassMenuOpen(false);
    renderDisplay();
    setView(activeView);
    if (elements.drawer.classList.contains('is-open')) renderEditor();
    elements.classSwitcherButton.focus();
    showToast(`已新增 ${courseSystemLabel(normalizedSystemType)}课程：${name}`);
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
    setView(activeView);
    if (elements.drawer.classList.contains('is-open')) renderEditor();
    elements.classSwitcherButton.focus();
    showToast(`已切换到 ${activeClassroom().name} · ${courseSystemLabel(activeClassroom().systemType)}`);
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
      if (!name) showToast('课程名称不能为空，已恢复原名称');
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
      showToast('至少保留一个课程');
      return;
    }
    if (!globalThis.confirm(`确定删除课程“${classroom.name}”吗？该课程的数据将被删除。`)) return;
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

  function updateCourseName(rawValue) {
    if (!requireAdmin()) return;
    const classroom = activeClassroom();
    const nextName = String(rawValue || '').trim().slice(0, 30);
    if (!nextName) {
      elements.courseNameInput.value = classroom.name;
      showToast('课程名称不能为空');
      return;
    }
    if (nextName === classroom.name) {
      elements.courseNameInput.value = nextName;
      return;
    }
    appState = State.renameClassroom(appState, classroom.id, nextName);
    persist();
    renderDisplay();
    elements.courseNameInput.value = nextName;
    showToast(`课程名称已更新为 ${nextName}`);
  }

  function updateStudentFromInput(input) {
    if (!requireAdmin()) return;
    const classroom = activeClassroom();
    const student = classroom.students.find((candidate) => candidate.id === input.dataset.studentId);
    if (!student) return;
    const field = input.dataset.field;
    const isName = field === 'name';
    const isCustomScore = isCustomLayout() && State.customScoreFields.includes(field);
    const currentValue = isCustomScore
      ? State.getCustomStudentScores(classroom, student.id)[field]
      : student[field];
    const nextValue = isName ? input.value.trim() : State.normalizeScore(input.value);
    if (isName && !nextValue) {
      input.value = student.name;
      showToast('姓名不能为空');
      return;
    }
    if (!isName && currentValue === nextValue) {
      input.value = String(currentValue);
      return;
    }

    const previousPoints = studentTotalPoints(classroom, student);
    let nextPoints = previousPoints;
    let isRankUpgrade = false;
    appState = State.updateActiveClassroom(appState, (current) => {
      const updatedClassroom = isName
        ? State.updateStudent(current, student.id, { name: nextValue })
        : isCustomScore
          ? State.updateCustomStudentScore(current, student.id, field, nextValue)
          : State.updateStudentScore(current, student.id, field, nextValue);
      nextPoints = isCustomScore
        ? State.getCustomStudentTotalPoints(updatedClassroom, student.id)
        : State.getStudentTotalPoints(updatedClassroom, student.id);
      isRankUpgrade = !isName && Ranks.isRankUpgrade(previousPoints, nextPoints);
      if (!isRankUpgrade) return updatedClassroom;
      const nextRank = Ranks.getRank(nextPoints);
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
      const totalInput = isCustomScore
        ? elements.editorList.querySelector(`[data-student-id="${CSS.escape(student.id)}"][readonly]`)
        : elements.editorList.querySelector(`[data-student-id="${CSS.escape(student.id)}"][data-field="totalPoints"]`);
      if (updatedStudent && totalInput) {
        totalInput.value = String(studentTotalPoints(activeClassroom(), updatedStudent));
      }
    }

    if (isRankUpgrade) {
      showRankUpgrade(student.name, previousPoints, nextPoints);
    }
  }

  function updateStudentBadge(button) {
    if (!requireAdmin()) return;
    const classroom = activeClassroom();
    const student = classroom.students.find((candidate) => candidate.id === button.dataset.badgeStudentId);
    const field = button.dataset.badgeField;
    const level = button.dataset.badgeLevel;
    const mode = button.dataset.badgeMode === 'custom' ? 'custom' : 'classic';
    const badgeCategories = mode === 'custom' ? customCategories : categories;
    const isKnownField = badgeCategories.some((category) => category.field === field);
    const isKnownLevel = badgeLevels.some((candidate) => candidate.level === level);
    const currentLevel = mode === 'custom'
      ? classroom.customBadges?.[String(student?.id)]?.[field]
      : student?.badges?.[field];
    if (!student || !isKnownField || !isKnownLevel || currentLevel === level) return;

    appState = State.updateActiveClassroom(appState, (current) => (
      mode === 'custom'
        ? State.updateCustomStudentBadge(current, student.id, field, level)
        : State.updateStudent(current, student.id, { badges: { ...student.badges, [field]: level } })
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
    stopActiveSound();
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
    if (RankupSound) activeSoundPlayback = RankupSound.playSettings(appState.rankupSound);
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
    stopActiveSound();
    elements.rankupOverlay.classList.add('is-revealed');
    elements.rankupSkip.disabled = true;
    elements.rankupClose.disabled = false;
    elements.rankupClose.focus({ preventScroll: true });
  }

  function closeRankUpgrade() {
    if (!elements.rankupOverlay.classList.contains('is-active')) return;
    stopActiveSound();
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

  function stopActiveSound() {
    activeSoundPlayback?.stop?.();
    activeSoundPlayback = null;
  }

  function clearSoundDraft({ render = false } = {}) {
    stopActiveSound();
    if (soundDraft?.previewUrl?.startsWith('blob:')) {
      globalThis.URL?.revokeObjectURL?.(soundDraft.previewUrl);
    }
    soundDraft = null;
    elements.rankupSoundFile.value = '';
    if (render) renderSoundEditor();
  }

  function updateRankupSound(patch) {
    appState = State.normalizeAppState({
      ...appState,
      rankupSound: { ...appState.rankupSound, ...patch },
    });
    persist();
    renderSoundEditor();
  }

  function selectSoundSource(source) {
    if (!['builtin', 'upload', 'url'].includes(source)) return;
    if (soundDraft && soundDraft.source !== source) clearSoundDraft();
    soundEditorSource = source;
    renderSoundEditor();
  }

  async function loadSoundFile(file) {
    if (!requireAdmin() || !file || !RankupSound) return;
    const validation = RankupSound.validateAudioFile(file);
    if (!validation.valid) {
      setSoundStatus(validation.error, true);
      showToast(validation.error);
      elements.rankupSoundFile.value = '';
      return;
    }
    const previewUrl = globalThis.URL?.createObjectURL?.(file);
    if (!previewUrl) {
      setSoundStatus('当前浏览器无法读取所选文件', true);
      return;
    }
    elements.rankupSoundPickFile.disabled = true;
    setSoundStatus('正在读取音乐时长…');
    try {
      const { duration } = await RankupSound.inspectAudio(previewUrl);
      clearSoundDraft();
      soundEditorSource = 'upload';
      soundDraft = {
        enabled: elements.rankupSoundEnabled.checked,
        source: 'upload',
        style: appState.rankupSound.style,
        url: previewUrl,
        previewUrl,
        file,
        name: file.name.replace(/\.[^.]+$/, '') || '自定义音效',
        storagePath: '',
        duration,
        clipStart: 0,
        clipDuration: RankupSound.CLIP_DURATION,
      };
      renderSoundEditor();
    } catch (error) {
      globalThis.URL?.revokeObjectURL?.(previewUrl);
      const message = error?.message || '无法读取音频';
      setSoundStatus(message, true);
      showToast(message);
    } finally {
      elements.rankupSoundPickFile.disabled = false;
    }
  }

  async function loadSoundUrl() {
    if (!requireAdmin() || !RankupSound) return;
    const validation = RankupSound.validateAudioUrl(elements.rankupSoundUrl.value);
    if (!validation.valid) {
      setSoundStatus(validation.error, true);
      showToast(validation.error);
      return;
    }
    elements.rankupSoundLoadUrl.disabled = true;
    setSoundStatus('正在读取音乐时长…');
    try {
      const { duration } = await RankupSound.inspectAudio(validation.url);
      clearSoundDraft();
      soundEditorSource = 'url';
      const pathName = new URL(validation.url).pathname.split('/').pop() || '网络音效';
      soundDraft = {
        enabled: elements.rankupSoundEnabled.checked,
        source: 'url',
        style: appState.rankupSound.style,
        url: validation.url,
        name: decodeURIComponent(pathName).replace(/\.[^.]+$/, '') || '网络音效',
        storagePath: '',
        duration,
        clipStart: 0,
        clipDuration: RankupSound.CLIP_DURATION,
      };
      renderSoundEditor();
    } catch (error) {
      const message = error?.message || '无法读取音频';
      setSoundStatus(message, true);
      showToast(message);
    } finally {
      elements.rankupSoundLoadUrl.disabled = false;
    }
  }

  function updateSoundClipStart(value) {
    const source = getSoundEditorSource();
    const base = soundDraft || (
      appState.rankupSound.source === source ? appState.rankupSound : null
    );
    if (!base || source === 'builtin') return;
    const duration = Math.max(
      RankupSound.CLIP_DURATION,
      Number(base.duration) || Number(base.clipStart) + RankupSound.CLIP_DURATION,
    );
    soundDraft = {
      ...base,
      duration,
      clipStart: RankupSound.normalizeClipStart(value, duration),
    };
    renderSoundEditor();
  }

  function previewRankupSound() {
    if (!RankupSound) return;
    const source = getSoundEditorSource();
    let settings = soundDraft;
    if (!settings && source === appState.rankupSound.source) settings = appState.rankupSound;
    if (!settings && source === 'builtin') {
      settings = {
        ...appState.rankupSound,
        source: 'builtin',
        style: elements.rankupSoundStyle.value,
      };
    }
    if (!settings) {
      showToast('请先载入音乐');
      return;
    }
    stopActiveSound();
    activeSoundPlayback = RankupSound.playSettings(settings);
    if (!activeSoundPlayback.started) showToast('晋级音效已静音');
  }

  async function saveSoundClip() {
    if (!requireAdmin() || !soundDraft) {
      showToast('请先载入音乐并选择片段');
      return;
    }
    const draft = soundDraft;
    elements.rankupSoundSaveClip.disabled = true;
    setSoundStatus(draft.source === 'upload' && draft.file ? '正在上传并保存…' : '正在保存片段…');
    try {
      let url = draft.url;
      let storagePath = draft.storagePath || '';
      if (draft.source === 'upload' && draft.file) {
        if (!cloudSync) throw new Error('上传音乐需要打开正式网址');
        const uploaded = await cloudSync.uploadRankupAudio(draft.file);
        url = uploaded.url;
        storagePath = uploaded.path;
      }
      stopActiveSound();
      updateRankupSound({
        enabled: elements.rankupSoundEnabled.checked,
        source: draft.source,
        style: appState.rankupSound.style,
        url,
        name: draft.name,
        storagePath,
        duration: draft.duration,
        clipStart: draft.clipStart,
        clipDuration: RankupSound.CLIP_DURATION,
      });
      if (cloudSync) await cloudSync.flush();
      const savedName = draft.name;
      clearSoundDraft();
      soundEditorSource = appState.rankupSound.source;
      renderSoundEditor();
      showToast(`${savedName} 的片段已同步`);
    } catch (error) {
      const message = error?.message || '音效保存失败，请稍后重试';
      setSoundStatus(message, true);
      showToast(message);
    } finally {
      elements.rankupSoundSaveClip.disabled = false;
    }
  }

  async function saveBuiltinSound(style = 'horn') {
    if (!requireAdmin()) return;
    clearSoundDraft();
    soundEditorSource = 'builtin';
    updateRankupSound({
      ...State.DEFAULT_RANKUP_SOUND,
      enabled: elements.rankupSoundEnabled.checked,
      style,
      name: soundStyleLabel(style),
    });
    try {
      if (cloudSync) await cloudSync.flush();
      showToast(`已选择${soundStyleLabel(style)}`);
    } catch {
      showToast('音效设置已保存在本地，等待云端重试');
    }
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
    requestAddClassroom(elements.newClassName.value);
  });
  elements.courseSystemButtons.forEach((button) => {
    button.addEventListener('click', () => addClassroom(button.dataset.courseSystem));
  });
  elements.courseSystemCancel.addEventListener('click', cancelAddClassroom);
  elements.courseSystemDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    cancelAddClassroom();
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
  elements.historyOpen.addEventListener('click', () => void openHistory());
  elements.historyClose.addEventListener('click', closeHistory);
  elements.historyRestoreCancel.addEventListener('click', closeHistoryRestore);
  elements.historyRestoreDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeHistoryRestore();
  });
  elements.historyRestoreConfirm.addEventListener('click', () => void confirmHistoryRestore());
  elements.historyList.addEventListener('click', (event) => {
    const restoreButton = event.target.closest('[data-history-id]');
    if (restoreButton && !restoreButton.disabled) requestHistoryRestore(restoreButton.dataset.historyId);
  });
  elements.drawerClose.addEventListener('click', closeDrawer);
  elements.drawerDone.addEventListener('click', closeDrawer);
  elements.drawerBackdrop.addEventListener('click', closeDrawer);
  elements.lessonInput.addEventListener('change', () => updateLesson(elements.lessonInput.value));
  elements.collectiveGoalInput.addEventListener('change', () => updateCollectiveGoal(elements.collectiveGoalInput.value));
  elements.courseNameInput.addEventListener('change', () => updateCourseName(elements.courseNameInput.value));
  elements.rankupSoundStyle.addEventListener('change', () => {
    void saveBuiltinSound(elements.rankupSoundStyle.value);
  });
  elements.rankupSoundEnabled.addEventListener('change', () => {
    updateRankupSound({ enabled: elements.rankupSoundEnabled.checked });
    showToast(elements.rankupSoundEnabled.checked ? '已开启晋级音效' : '已静音晋级音效');
  });
  elements.rankupSoundSourceButtons.forEach((button) => {
    button.addEventListener('click', () => selectSoundSource(button.dataset.soundSource));
  });
  elements.rankupSoundPreview.addEventListener('click', previewRankupSound);
  elements.rankupSoundPickFile.addEventListener('click', () => elements.rankupSoundFile.click());
  elements.rankupSoundFile.addEventListener('change', () => {
    void loadSoundFile(elements.rankupSoundFile.files?.[0]);
  });
  elements.rankupSoundLoadUrl.addEventListener('click', () => void loadSoundUrl());
  elements.rankupSoundUrl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void loadSoundUrl();
    }
  });
  elements.rankupClipStart.addEventListener('input', () => updateSoundClipStart(elements.rankupClipStart.value));
  elements.rankupSoundSaveClip.addEventListener('click', () => void saveSoundClip());
  elements.rankupSoundReset.addEventListener('click', () => void saveBuiltinSound('horn'));
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
    if (elements.courseSystemDialog.open) {
      event.preventDefault();
      cancelAddClassroom();
    } else if (elements.classSwitcherButton.getAttribute('aria-expanded') === 'true') {
      setClassMenuOpen(false);
      elements.classSwitcherButton.focus();
    } else if (elements.historyRestoreDialog.open) {
      event.preventDefault();
      closeHistoryRestore();
    } else if (elements.historyDialog.open) closeHistory();
    else if (elements.rankupOverlay.classList.contains('is-active')) closeRankUpgrade();
    else if (elements.drawer.classList.contains('is-open')) closeDrawer();
  });

  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);

  renderDisplay();
  setView(location.hash === '#ranks' ? 'ranks' : 'scores');
  updateAdminUi();
  void initializeCloud();
})();
