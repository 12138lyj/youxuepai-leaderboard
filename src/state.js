(function attachLeaderboardState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LeaderboardState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStateApi() {
  const scoreFields = ['notebook', 'errorBook', 'draft', 'module', 'totalPoints'];
  const badgeFields = ['notebook', 'errorBook', 'draft', 'module'];
  const badgeColors = new Set(['white', 'yellow', 'purple']);
  const badgeColorOrder = { white: 0, yellow: 1, purple: 2 };
  const DEFAULT_COLLECTIVE_GOAL = 15000;
  let generatedStudentSequence = 0;

  function hasUsableId(value) {
    return value !== undefined && value !== null && String(value).trim() !== '';
  }

  function nextSequentialId(prefix, reservedIds, usedIds = reservedIds) {
    let sequence = 1;
    while (reservedIds.has(`${prefix}-${sequence}`) || usedIds.has(`${prefix}-${sequence}`)) {
      sequence += 1;
    }
    return `${prefix}-${sequence}`;
  }

  function normalizeScore(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.round(number));
  }

  function normalizeStudent(student) {
    const normalized = {
      id: hasUsableId(student?.id)
        ? String(student.id)
        : `student-${Date.now()}-${generatedStudentSequence += 1}`,
      name: String(student?.name || '').trim() || '未命名学员',
    };
    for (const field of scoreFields) normalized[field] = normalizeScore(student?.[field]);
    normalized.badges = {};
    for (const field of badgeFields) {
      const color = student?.badges?.[field];
      normalized.badges[field] = badgeColors.has(color) ? color : 'white';
    }
    return normalized;
  }

  function normalizeState(value) {
    const lesson = Math.max(1, normalizeScore(value?.lesson || 1));
    const sourceStudents = Array.isArray(value?.students) ? value.students : [];
    const reservedIds = new Set(sourceStudents
      .filter((student) => hasUsableId(student?.id))
      .map((student) => String(student.id)));
    const usedIds = new Set();
    const students = sourceStudents.map((student) => {
      let id = hasUsableId(student?.id) ? String(student.id) : nextSequentialId('student', reservedIds, usedIds);
      if (usedIds.has(id)) id = nextSequentialId('student', reservedIds, usedIds);
      usedIds.add(id);
      return normalizeStudent({ ...(student || {}), id });
    });
    return { lesson, students };
  }

  function normalizePreviousScores(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([studentId, scores]) => {
      if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return [];
      return [[String(studentId), Object.fromEntries(badgeFields.map((field) => (
        [field, normalizeScore(scores[field])]
      )))]];
    }));
  }

  function normalizeLessonRecords(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const records = {};
    for (const [lessonKey, students] of Object.entries(value)) {
      const lesson = Math.max(1, normalizeScore(lessonKey));
      if (!students || typeof students !== 'object' || Array.isArray(students)) continue;
      records[String(lesson)] = Object.fromEntries(Object.entries(students).flatMap(([studentId, scores]) => {
        if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return [];
        return [[String(studentId), Object.fromEntries(badgeFields.map((field) => (
          [field, normalizeScore(scores[field])]
        )))]];
      }));
    }
    return records;
  }

  function cloneLessonRecords(records) {
    return Object.fromEntries(Object.entries(records || {}).map(([lesson, students]) => [
      String(lesson), Object.fromEntries(Object.entries(students || {}).map(([studentId, scores]) => [
        String(studentId), Object.fromEntries(badgeFields.map((field) => [field, normalizeScore(scores?.[field])])),
      ])),
    ]));
  }

  function sumRecordScores(records, studentId) {
    return Object.values(records || {}).reduce((total, lessonStudents) => {
      const scores = lessonStudents?.[String(studentId)];
      if (!scores) return total;
      return total + badgeFields.reduce((sum, field) => sum + normalizeScore(scores[field]), 0);
    }, 0);
  }

  function getStudentTotalPoints(classroom, studentId) {
    const student = classroom?.students?.find((candidate) => String(candidate.id) === String(studentId));
    if (!student) return 0;
    const records = classroom?.lessonRecords;
    if (!records || Object.keys(records).length === 0) return normalizeScore(student.totalPoints);
    return normalizeScore(classroom?.carryoverPoints?.[String(student.id)]) + sumRecordScores(records, student.id);
  }

  function getModuleWinCounts(classroom, field) {
    if (!badgeFields.includes(field)) return {};
    const counts = Object.fromEntries((classroom?.students || []).map((student) => [String(student.id), 0]));
    for (const lessonStudents of Object.values(classroom?.lessonRecords || {})) {
      const entries = Object.entries(lessonStudents || {})
        .filter(([studentId]) => Object.prototype.hasOwnProperty.call(counts, String(studentId)))
        .map(([studentId, scores]) => [String(studentId), normalizeScore(scores?.[field])]);
      const maximum = Math.max(0, ...entries.map(([, score]) => score));
      if (maximum <= 0) continue;
      for (const [studentId, score] of entries) {
        if (score === maximum) counts[studentId] += 1;
      }
    }
    return counts;
  }

  function getAutomaticBadgeLevel(winCount) {
    const wins = normalizeScore(winCount);
    if (wins >= 6) return 'purple';
    if (wins >= 3) return 'yellow';
    return 'white';
  }

  function applyAutomaticBadges(classroom) {
    if (!classroom) return classroom;
    const winCounts = Object.fromEntries(badgeFields.map((field) => [field, getModuleWinCounts(classroom, field)]));
    return {
      ...classroom,
      students: (classroom.students || []).map((student) => ({
        ...student,
        badges: Object.fromEntries(badgeFields.map((field) => {
          const current = badgeColors.has(student.badges?.[field]) ? student.badges[field] : 'white';
          const automatic = getAutomaticBadgeLevel(winCounts[field]?.[String(student.id)] || 0);
          return [field, badgeColorOrder[current] >= badgeColorOrder[automatic] ? current : automatic];
        })),
      })),
    };
  }

  function normalizeHonorEvent(value, index) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const createdAt = Number(value.createdAt);
    const studentName = String(value.studentName || '').trim() || '学员';
    const message = String(value.message || '').trim() || '获得新荣誉';
    return {
      id: hasUsableId(value.id) ? String(value.id) : `honor-${Number.isFinite(createdAt) ? createdAt : 0}-${index}`,
      studentName,
      message,
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    };
  }

  function normalizeHonorEvents(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map(normalizeHonorEvent)
      .filter(Boolean)
      .slice(0, 30);
  }

  function sortStudents(students, field) {
    return [...students].sort((left, right) => {
      const scoreDifference = normalizeScore(right[field]) - normalizeScore(left[field]);
      if (scoreDifference !== 0) return scoreDifference;
      return String(left.name).localeCompare(String(right.name), 'zh-CN');
    });
  }

  function updateStudent(state, id, patch) {
    const targetId = String(id);
    const scorePatchField = scoreFields.find((field) => Object.prototype.hasOwnProperty.call(patch || {}, field));
    if (state.lessonRecords && scorePatchField) return updateStudentScore(state, targetId, scorePatchField, patch[scorePatchField]);
    const studentIndex = state.students.findIndex((student) => String(student.id) === targetId);
    return {
      ...state,
      students: state.students.map((student, index) => (
        index === studentIndex
          ? normalizeStudent({ ...student, ...patch, id: String(student.id) })
          : student
      )),
    };
  }

  function addStudent(state, student) {
    const usedIds = new Set(state.students.map(({ id }) => String(id)));
    const normalized = normalizeStudent(student);
    const id = usedIds.has(normalized.id)
      ? nextSequentialId('student', usedIds)
      : normalized.id;
    const next = { ...state, students: [...state.students, { ...normalized, id }] };
    if (!state.lessonRecords) return next;
    const lesson = String(state.lesson || 1);
    const lessonRecords = cloneLessonRecords(state.lessonRecords);
    lessonRecords[lesson] ||= {};
    lessonRecords[lesson][id] = Object.fromEntries(badgeFields.map((field) => [field, normalized[field]]));
    next.lessonRecords = lessonRecords;
    next.carryoverPoints = { ...(state.carryoverPoints || {}), [id]: normalizeScore(normalized.totalPoints) };
    return normalizeClassroom(next);
  }

  function removeStudent(state, id) {
    if (state.students.length <= 1) return state;
    const targetId = String(id);
    const studentIndex = state.students.findIndex((student) => String(student.id) === targetId);
    return { ...state, students: state.students.filter((student, index) => index !== studentIndex) };
  }

  function createDefaultState() {
    return normalizeState({
      lesson: 1,
      students: [
        { id: 's1', name: '崔晟宸', notebook: 0, errorBook: 0, draft: 0, module: 0, totalPoints: 0 },
        { id: 's2', name: '陆怡辰', notebook: 0, errorBook: 0, draft: 0, module: 0, totalPoints: 0 },
        { id: 's3', name: '李梓玉', notebook: 0, errorBook: 0, draft: 0, module: 0, totalPoints: 0 },
        { id: 's4', name: '李栩嘉', notebook: 0, errorBook: 0, draft: 0, module: 0, totalPoints: 0 },
        { id: 's5', name: '韩宝锐', notebook: 0, errorBook: 0, draft: 0, module: 0, totalPoints: 0 },
        { id: 's6', name: '杨晴雯', notebook: 0, errorBook: 0, draft: 0, module: 0, totalPoints: 0 },
        { id: 's7', name: '刘洛扬', notebook: 0, errorBook: 0, draft: 0, module: 0, totalPoints: 0 },
        { id: 's8', name: '王浩蕴', notebook: 0, errorBook: 0, draft: 0, module: 0, totalPoints: 0 },
        { id: 's9', name: '孙亦康', notebook: 0, errorBook: 0, draft: 0, module: 0, totalPoints: 0 },
        { id: 's10', name: '黄诗茹', notebook: 0, errorBook: 0, draft: 0, module: 0, totalPoints: 0 },
      ],
    });
  }

  function normalizeClassroom(value, index = 0) {
    const position = Math.max(0, normalizeScore(index));
    const id = hasUsableId(value?.id) ? String(value.id) : `class-${position + 1}`;
    const name = String(value?.name || '').trim() || '未命名班级';
    const normalizedState = normalizeState(value);
    const collectiveGoal = normalizeScore(value?.collectiveGoal) || DEFAULT_COLLECTIVE_GOAL;
    const previousScores = normalizePreviousScores(value?.previousScores);
    const honorEvents = normalizeHonorEvents(value?.honorEvents);
    const lessonRecords = normalizeLessonRecords(value?.lessonRecords);
    const currentLessonKey = String(normalizedState.lesson);
    lessonRecords[currentLessonKey] ||= {};
    const explicitCarryover = value?.carryoverPoints && typeof value.carryoverPoints === 'object'
      && !Array.isArray(value.carryoverPoints) ? value.carryoverPoints : null;
    const carryoverPoints = {};
    const students = normalizedState.students.map((student) => {
      const studentId = String(student.id);
      const suppliedRecord = lessonRecords[currentLessonKey][studentId];
      if (!suppliedRecord) {
        lessonRecords[currentLessonKey][studentId] = Object.fromEntries(badgeFields.map((field) => [field, student[field]]));
      } else {
        for (const field of badgeFields) student[field] = normalizeScore(suppliedRecord[field]);
      }
      const recordTotal = sumRecordScores(lessonRecords, studentId);
      const legacyCarryover = normalizeScore(student.totalPoints) - recordTotal;
      carryoverPoints[studentId] = normalizeScore(explicitCarryover?.[studentId] ?? Math.max(0, legacyCarryover));
      student.totalPoints = carryoverPoints[studentId] + sumRecordScores(lessonRecords, studentId);
      return student;
    });
    const normalized = {
      id,
      name,
      lesson: normalizedState.lesson,
      students,
      collectiveGoal,
      previousScores,
      honorEvents,
      lessonRecords,
      carryoverPoints,
    };
    return applyAutomaticBadges(normalized);
  }

  function createDefaultAppState() {
    const classroom = normalizeClassroom({
      id: 'class-1',
      name: '暑假学习技能训练',
      ...createDefaultState(),
    });
    return { activeClassId: classroom.id, classes: [classroom] };
  }

  function normalizeAppState(value) {
    if (!Array.isArray(value?.classes) || value.classes.length === 0) {
      return createDefaultAppState();
    }

    const reservedIds = new Set(value.classes
      .filter((classroom) => hasUsableId(classroom?.id))
      .map((classroom) => String(classroom.id)));
    const usedIds = new Set();
    const classes = value.classes.map((classroom, index) => {
      let id = hasUsableId(classroom?.id)
        ? String(classroom.id)
        : nextSequentialId('class', reservedIds, usedIds);
      if (usedIds.has(id)) {
        id = nextSequentialId('class', reservedIds, usedIds);
      }
      usedIds.add(id);
      return normalizeClassroom({ ...(classroom || {}), id }, index);
    });
    const requestedActiveId = hasUsableId(value?.activeClassId)
      ? String(value.activeClassId)
      : '';
    const activeClassId = classes.some((classroom) => classroom.id === requestedActiveId)
      ? requestedActiveId
      : classes[0].id;
    return { activeClassId, classes };
  }

  function getActiveClassroom(appState) {
    if (!Array.isArray(appState?.classes)) return undefined;
    return appState.classes.find((classroom) => classroom.id === appState.activeClassId)
      || appState.classes[0];
  }

  function updateActiveClassroom(appState, update) {
    const activeClassroom = getActiveClassroom(appState);
    if (!activeClassroom) return appState;
    const activeIndex = appState.classes.indexOf(activeClassroom);

    const updatedValue = typeof update === 'function'
      ? update(activeClassroom)
      : { ...activeClassroom, ...(update || {}) };
    if (!updatedValue || updatedValue === activeClassroom) return appState;

    const updatedClassroom = normalizeClassroom({
      ...activeClassroom,
      ...updatedValue,
      id: activeClassroom.id,
    });
    return {
      ...appState,
      classes: appState.classes.map((classroom, index) => (
        index === activeIndex ? updatedClassroom : classroom
      )),
    };
  }

  function switchLesson(classroom, nextLesson) {
    if (!classroom) return classroom;
    const lesson = Math.max(1, normalizeScore(nextLesson || 1));
    const lessonRecords = cloneLessonRecords(classroom.lessonRecords);
    lessonRecords[String(lesson)] ||= {};
    for (const student of classroom.students || []) {
      const studentId = String(student.id);
      lessonRecords[String(lesson)][studentId] ||= Object.fromEntries(badgeFields.map((field) => [field, 0]));
    }
    return normalizeClassroom({ ...classroom, lesson, lessonRecords });
  }

  function updateStudentScore(classroom, id, field, value) {
    if (!classroom) return classroom;
    const studentId = String(id);
    const student = classroom.students?.find((candidate) => String(candidate.id) === studentId);
    if (!student) return classroom;
    const nextValue = normalizeScore(value);
    if (field === 'totalPoints') {
      const carryoverPoints = { ...(classroom.carryoverPoints || {}) };
      carryoverPoints[studentId] = Math.max(0, nextValue - sumRecordScores(classroom.lessonRecords, studentId));
      return normalizeClassroom({ ...classroom, carryoverPoints });
    }
    if (!badgeFields.includes(field)) return updateStudent(classroom, studentId, { [field]: value });
    const lesson = String(classroom.lesson);
    const lessonRecords = cloneLessonRecords(classroom.lessonRecords);
    lessonRecords[lesson] ||= {};
    lessonRecords[lesson][studentId] ||= Object.fromEntries(badgeFields.map((candidate) => [candidate, student[candidate]]));
    lessonRecords[lesson][studentId][field] = nextValue;
    return normalizeClassroom({ ...classroom, lessonRecords });
  }

  function nextClassId(classes) {
    const ids = new Set(classes.map((classroom) => classroom.id));
    let sequence = 1;
    while (ids.has(`class-${sequence}`)) sequence += 1;
    return `class-${sequence}`;
  }

  function addClassroom(appState, classroomOrName) {
    const baseState = Array.isArray(appState?.classes) && appState.classes.length
      ? appState
      : normalizeAppState(appState);
    const source = typeof classroomOrName === 'string'
      ? { name: classroomOrName }
      : (classroomOrName || {});
    const id = nextClassId(baseState.classes);
    const classroom = normalizeClassroom({
      ...source,
      id,
      name: String(source.name || '').trim() || '新班级',
      lesson: source.lesson || 1,
      students: [{
        id: `${id}-student-1`,
        name: '新学员',
        notebook: 0,
        errorBook: 0,
        draft: 0,
        module: 0,
        totalPoints: 0,
        badges: { notebook: 'white', errorBook: 'white', draft: 'white', module: 'white' },
      }],
    });
    return {
      ...baseState,
      activeClassId: classroom.id,
      classes: [...baseState.classes, classroom],
    };
  }

  function switchClassroom(appState, id) {
    const classId = hasUsableId(id) ? String(id) : '';
    if (classId === appState?.activeClassId) return appState;
    if (!appState?.classes?.some((classroom) => classroom.id === classId)) return appState;
    return { ...appState, activeClassId: classId };
  }

  function renameClassroom(appState, id, name) {
    const classId = name === undefined
      ? appState?.activeClassId
      : (hasUsableId(id) ? String(id) : '');
    const nextName = String(name === undefined ? id : (name ?? '')).trim();
    if (!nextName) return appState;

    const classroomIndex = appState?.classes?.findIndex((classroom) => classroom.id === classId) ?? -1;
    if (classroomIndex < 0 || appState.classes[classroomIndex].name === nextName) return appState;
    return {
      ...appState,
      classes: appState.classes.map((classroom, index) => (
        index === classroomIndex ? { ...classroom, name: nextName } : classroom
      )),
    };
  }

  function removeClassroom(appState, id = appState?.activeClassId) {
    if (!Array.isArray(appState?.classes) || appState.classes.length <= 1) return appState;
    const classId = hasUsableId(id) ? String(id) : '';
    const classroomIndex = appState.classes.findIndex((classroom) => classroom.id === classId);
    if (classroomIndex < 0) return appState;

    let activeClassId = appState.activeClassId;
    if (classId === activeClassId) {
      activeClassId = appState.classes[classroomIndex + 1]?.id
        || appState.classes[classroomIndex - 1].id;
    }
    return {
      ...appState,
      activeClassId,
      classes: appState.classes.filter((classroom, index) => index !== classroomIndex),
    };
  }

  function serializeState(state) {
    return JSON.stringify(normalizeState(state));
  }

  function parseState(serialized, fallback) {
    try {
      const parsed = normalizeState(JSON.parse(serialized));
      if (!parsed.students.length) return fallback;
      return parsed;
    } catch {
      return fallback;
    }
  }

  function serializeAppState(appState) {
    return JSON.stringify(normalizeAppState(appState));
  }

  function isUsableStoredStudent(student) {
    return student !== null && typeof student === 'object' && !Array.isArray(student);
  }

  function isUsableStoredClassroom(classroom) {
    return classroom !== null
      && typeof classroom === 'object'
      && !Array.isArray(classroom)
      && Array.isArray(classroom.students)
      && classroom.students.length > 0
      && classroom.students.every(isUsableStoredStudent);
  }

  function parseAppState(serialized, fallback) {
    try {
      const parsed = JSON.parse(serialized);
      if (Array.isArray(parsed?.classes)
        && parsed.classes.length > 0
        && parsed.classes.every(isUsableStoredClassroom)) {
        return normalizeAppState(parsed);
      }
      if (Array.isArray(parsed?.students)
        && parsed.students.length > 0
        && parsed.students.every(isUsableStoredStudent)) {
        return normalizeAppState({
          activeClassId: 'class-1',
          classes: [{ id: 'class-1', name: '学能训练班', ...parsed }],
        });
      }
      return fallback;
    } catch {
      return fallback;
    }
  }

  return {
    scoreFields,
    badgeFields,
    DEFAULT_COLLECTIVE_GOAL,
    normalizeScore,
    normalizeStudent,
    normalizeState,
    normalizeLessonRecords,
    sortStudents,
    updateStudent,
    updateStudentScore,
    addStudent,
    removeStudent,
    createDefaultState,
    normalizeClassroom,
    normalizeAppState,
    createDefaultAppState,
    getActiveClassroom,
    updateActiveClassroom,
    switchLesson,
    getStudentTotalPoints,
    getModuleWinCounts,
    getAutomaticBadgeLevel,
    applyAutomaticBadges,
    addClassroom,
    switchClassroom,
    renameClassroom,
    removeClassroom,
    serializeState,
    parseState,
    serializeAppState,
    parseAppState,
  };
});
