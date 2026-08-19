const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = path.join(__dirname, '..', 'src', 'state.js');
const moduleExists = fs.existsSync(modulePath);
const stateApi = moduleExists ? require(modulePath) : {};

test('state module exists', () => {
  assert.equal(moduleExists, true);
});

test('normalizes names and all score fields', () => {
  assert.deepEqual(
    stateApi.normalizeStudent({
      id: 'a',
      name: '  林思妍  ',
      notebook: '96.4',
      errorBook: -5,
      draft: '',
      module: '91',
      totalPoints: '800.2',
    }),
    {
      id: 'a',
      name: '林思妍',
      notebook: 96,
      errorBook: 0,
      draft: 0,
      module: 91,
      totalPoints: 800,
      badges: {
        notebook: 'white',
        errorBook: 'white',
        draft: 'white',
        module: 'white',
      },
    },
  );
});

test('sorts a category descending and breaks ties by name', () => {
  const students = [
    { id: 'b', name: '周铭轩', notebook: 90 },
    { id: 'a', name: '陈宇航', notebook: 96 },
    { id: 'c', name: '林思妍', notebook: 90 },
  ];
  const result = stateApi.sortStudents(students, 'notebook');
  assert.deepEqual(result.map((student) => student.id), ['a', 'c', 'b']);
  assert.deepEqual(students.map((student) => student.id), ['b', 'a', 'c']);
});

test('updates one student without mutating the previous state', () => {
  const original = {
    lesson: 12,
    students: [{ id: 'a', name: '陈宇航', notebook: 90, errorBook: 80, draft: 70, module: 60, totalPoints: 799 }],
  };
  const next = stateApi.updateStudent(original, 'a', { name: '  陈同学 ', totalPoints: '800' });
  assert.equal(next.students[0].name, '陈同学');
  assert.equal(next.students[0].totalPoints, 800);
  assert.equal(original.students[0].name, '陈宇航');
  assert.equal(original.students[0].totalPoints, 799);
});

test('adds a normalized student and will not remove the final student', () => {
  const original = { lesson: 1, students: [{ id: 'a', name: '甲', notebook: 0, errorBook: 0, draft: 0, module: 0, totalPoints: 0 }] };
  const unchanged = stateApi.removeStudent(original, 'a');
  assert.equal(unchanged.students.length, 1);

  const withStudent = stateApi.addStudent(original, { id: 'b', name: '  乙  ', notebook: 10 });
  assert.equal(withStudent.students.length, 2);
  assert.equal(withStudent.students[1].name, '乙');
  assert.equal(withStudent.students[1].errorBook, 0);
  assert.equal(stateApi.removeStudent(withStudent, 'a').students[0].id, 'b');
});

test('serializes valid state and falls back when stored data is invalid', () => {
  const fallback = stateApi.createDefaultState();
  const source = { lesson: '8', students: [{ id: 'x', name: '学生', notebook: 10, errorBook: 20, draft: 30, module: 40, totalPoints: 320 }] };
  const serialized = stateApi.serializeState(source);
  const parsed = stateApi.parseState(serialized, fallback);
  assert.equal(parsed.lesson, 8);
  assert.equal(parsed.students[0].totalPoints, 320);
  assert.deepEqual(stateApi.parseState('{broken', fallback), fallback);
  assert.deepEqual(stateApi.parseState('{"lesson":1,"students":[]}', fallback), fallback);
});

test('normalizes the four badge colors and defaults invalid values to white', () => {
  const student = stateApi.normalizeStudent({
    id: 'badge-student',
    name: '徽章学员',
    badges: {
      notebook: 'yellow',
      errorBook: 'purple',
      draft: 'white',
      module: 'blue',
    },
  });

  assert.deepEqual(student.badges, {
    notebook: 'yellow',
    errorBook: 'purple',
    draft: 'white',
    module: 'white',
  });
});

test('updates only the active classroom and leaves other classrooms untouched', () => {
  const original = stateApi.normalizeAppState({
    activeClassId: 'class-2',
    classes: [
      { id: 'class-1', name: '一班', lesson: 3, students: [{ id: 'a', name: '甲', totalPoints: 10 }] },
      { id: 'class-2', name: '二班', lesson: 4, students: [{ id: 'b', name: '乙', totalPoints: 20 }] },
    ],
  });

  const next = stateApi.updateActiveClassroom(original, (classroom) => (
    stateApi.updateStudent(classroom, 'b', { totalPoints: 99 })
  ));

  assert.equal(stateApi.getActiveClassroom(next).students[0].totalPoints, 99);
  assert.equal(original.classes[1].students[0].totalPoints, 20);
  assert.equal(next.classes[0], original.classes[0]);
});

test('adds, switches, renames, and removes classrooms while preserving a valid active class', () => {
  const original = stateApi.createDefaultAppState();
  assert.equal(original.activeClassId, 'class-1');
  assert.equal(original.classes[0].name, '暑假学习技能训练');
  assert.equal(original.classes[0].students.length, 10);
  assert.equal(original.classes[0].students.some((student) => student.id === 's9'), true);

  const withSecond = stateApi.addClassroom(original, '二班');
  assert.equal(withSecond.classes.length, 2);
  assert.equal(withSecond.activeClassId, 'class-2');
  assert.equal(stateApi.getActiveClassroom(withSecond).name, '二班');
  assert.deepEqual(stateApi.getActiveClassroom(withSecond).students[0], {
    id: 'class-2-student-1',
    name: '新学员',
    notebook: 0,
    errorBook: 0,
    draft: 0,
    module: 0,
    totalPoints: 0,
    badges: { notebook: 'white', errorBook: 'white', draft: 'white', module: 'white' },
  });

  const renamed = stateApi.renameClassroom(withSecond, 'class-2', '  进阶班  ');
  assert.equal(stateApi.getActiveClassroom(renamed).name, '进阶班');
  assert.equal(stateApi.renameClassroom(renamed, 'class-2', '  '), renamed);

  const switched = stateApi.switchClassroom(renamed, 'class-1');
  assert.equal(switched.activeClassId, 'class-1');
  assert.equal(stateApi.switchClassroom(switched, 'missing'), switched);

  const withThird = stateApi.addClassroom(switched, '三班');
  const activeFirst = stateApi.switchClassroom(withThird, 'class-1');
  const removedFirst = stateApi.removeClassroom(activeFirst, 'class-1');
  assert.equal(removedFirst.activeClassId, 'class-2');

  const activeLast = stateApi.switchClassroom(removedFirst, 'class-3');
  const removedLast = stateApi.removeClassroom(activeLast, 'class-3');
  assert.equal(removedLast.activeClassId, 'class-2');
  assert.equal(stateApi.removeClassroom(removedLast, 'class-2'), removedLast);
});

test('migrates legacy single-class JSON without losing student names or scores', () => {
  const fallback = stateApi.createDefaultAppState();
  const legacy = JSON.stringify({
    lesson: 7,
    students: [
      { id: 'legacy-1', name: '旧学员甲', notebook: 12, errorBook: 23, draft: 34, module: 45, totalPoints: 678 },
      { id: 'legacy-2', name: '旧学员乙', notebook: 56, errorBook: 67, draft: 78, module: 89, totalPoints: 901 },
    ],
  });

  const migrated = stateApi.parseAppState(legacy, fallback);
  assert.equal(migrated.activeClassId, 'class-1');
  assert.equal(migrated.classes[0].id, 'class-1');
  assert.equal(migrated.classes[0].name, '学能训练班');
  assert.equal(migrated.classes[0].lesson, 7);
  assert.deepEqual(migrated.classes[0].students.map(({
    name, notebook, errorBook, draft, module, totalPoints,
  }) => ({ name, notebook, errorBook, draft, module, totalPoints })), [
    { name: '旧学员甲', notebook: 12, errorBook: 23, draft: 34, module: 45, totalPoints: 678 },
    { name: '旧学员乙', notebook: 56, errorBook: 67, draft: 78, module: 89, totalPoints: 901 },
  ]);
  assert.equal(stateApi.parseAppState('{broken', fallback), fallback);
});

test('serializes and parses the multi-class app-state format', () => {
  const source = stateApi.addClassroom(stateApi.createDefaultAppState(), '二班');
  const serialized = stateApi.serializeAppState(source);
  const raw = JSON.parse(serialized);
  const parsed = stateApi.parseAppState(serialized, stateApi.createDefaultAppState());

  assert.equal(raw.activeClassId, 'class-2');
  assert.equal(raw.classes.length, 2);
  assert.equal(parsed.activeClassId, 'class-2');
  assert.deepEqual(parsed, stateApi.normalizeAppState(source));
});

test('repairs duplicate classroom ids so class operations target one classroom', () => {
  const normalized = stateApi.normalizeAppState({
    activeClassId: 'duplicate',
    classes: [
      { id: 'duplicate', name: '一班', lesson: 1, students: [{ id: 'a', name: '甲' }] },
      { id: 'duplicate', name: '二班', lesson: 2, students: [{ id: 'b', name: '乙' }] },
    ],
  });

  assert.equal(new Set(normalized.classes.map(({ id }) => id)).size, 2);
  assert.equal(stateApi.getActiveClassroom(normalized).name, '一班');

  const renamed = stateApi.renameClassroom(normalized, normalized.classes[1].id, '新二班');
  assert.deepEqual(renamed.classes.map(({ name }) => name), ['一班', '新二班']);

  const removed = stateApi.removeClassroom(normalized, 'duplicate');
  assert.equal(removed.classes.length, 1);
  assert.equal(removed.activeClassId, removed.classes[0].id);
  assert.equal(stateApi.getActiveClassroom(removed), removed.classes[0]);
});

test('normalizes unique student ids and student operations target only one match', () => {
  const normalized = stateApi.normalizeState({
    lesson: 2,
    students: [
      { id: 7, name: '甲' },
      { id: 7, name: '乙' },
      { name: '丙' },
      { name: '丁' },
    ],
  });
  assert.equal(new Set(normalized.students.map(({ id }) => id)).size, 4);

  const withAdded = stateApi.addStudent(normalized, { id: '7', name: '戊' });
  assert.equal(new Set(withAdded.students.map(({ id }) => id)).size, 5);

  const updated = stateApi.updateStudent(withAdded, 7, { name: '仅更新此人' });
  assert.equal(updated.students.filter(({ name }) => name === '仅更新此人').length, 1);
  assert.equal(updated.students.filter(({ name }) => name === '乙').length, 1);

  const removed = stateApi.removeStudent(updated, 7);
  assert.equal(removed.students.length, 4);
  assert.equal(removed.students.some(({ id }) => id === '7'), false);
});

test('falls back for unusable classrooms in stored multi-class state', () => {
  const fallback = stateApi.createDefaultAppState();
  const emptyStudents = JSON.stringify({
    activeClassId: 'class-1',
    classes: [{ id: 'class-1', name: '损坏班级', lesson: 1, students: [] }],
  });
  const nullClassroom = JSON.stringify({ activeClassId: 'class-1', classes: [null] });

  assert.equal(stateApi.parseAppState(emptyStudents, fallback), fallback);
  assert.equal(stateApi.parseAppState(nullClassroom, fallback), fallback);
});

test('normalizes classroom motivation data and supplies safe legacy defaults', () => {
  const honorEvents = Array.from({ length: 35 }, (_, index) => ({
    id: `event-${index}`,
    studentName: `学员${index}`,
    message: `荣誉${index}`,
    createdAt: 1000 - index,
  }));
  const normalized = stateApi.normalizeAppState({
    activeClassId: 'class-1',
    classes: [{
      id: 'class-1',
      name: '成长班',
      lesson: 5,
      collectiveGoal: '18000',
      students: [{ id: 'student-1', name: '甲', notebook: 90, errorBook: 80, draft: 70, module: 60 }],
      previousScores: {
        'student-1': { notebook: '88', errorBook: 79, draft: -1, module: 60 },
      },
      honorEvents,
    }],
  });
  const classroom = stateApi.getActiveClassroom(normalized);

  assert.equal(classroom.collectiveGoal, 18000);
  assert.deepEqual(classroom.previousScores['student-1'], {
    notebook: 88,
    errorBook: 79,
    draft: 0,
    module: 60,
  });
  assert.equal(classroom.honorEvents.length, 30);
  assert.equal(classroom.honorEvents[0].id, 'event-0');

  const legacy = stateApi.normalizeAppState({
    activeClassId: 'legacy',
    classes: [{ id: 'legacy', name: '旧班级', students: [{ id: 'legacy-student', name: '乙' }] }],
  });
  const legacyClassroom = stateApi.getActiveClassroom(legacy);
  assert.equal(legacyClassroom.collectiveGoal, 15000);
  assert.deepEqual(legacyClassroom.previousScores, {});
  assert.deepEqual(legacyClassroom.honorEvents, []);
});

test('preserves explicit classroom ids before assigning ids to missing classrooms', () => {
  const normalized = stateApi.normalizeAppState({
    activeClassId: 'class-1',
    classes: [
      { name: '临时', students: [{ name: '临时学员' }] },
      { id: 'class-1', name: '目标', students: [{ name: '目标学员' }] },
      { id: 0, name: '零号', students: [{ name: '零号学员' }] },
    ],
  });

  assert.equal(stateApi.getActiveClassroom(normalized).name, '目标');
  assert.equal(normalized.classes.find(({ name }) => name === '目标').id, 'class-1');
  assert.notEqual(normalized.classes.find(({ name }) => name === '临时').id, 'class-1');
  assert.equal(normalized.classes.find(({ name }) => name === '零号').id, '0');

  const zeroActive = stateApi.normalizeAppState({
    activeClassId: 0,
    classes: [{ id: 0, name: '零号', students: [{ name: '零号学员' }] }],
  });
  assert.equal(zeroActive.activeClassId, '0');
});

test('switches, renames, and removes a classroom when its id is numeric zero', () => {
  const original = stateApi.normalizeAppState({
    activeClassId: 'class-1',
    classes: [
      { id: 'class-1', name: '一班', students: [{ name: '甲' }] },
      { id: 0, name: '零号班', students: [{ name: '乙' }] },
    ],
  });

  const switched = stateApi.switchClassroom(original, 0);
  assert.equal(switched.activeClassId, '0');

  const renamed = stateApi.renameClassroom(switched, 0, '零号新班');
  assert.equal(stateApi.getActiveClassroom(renamed).name, '零号新班');

  const removed = stateApi.removeClassroom(renamed, 0);
  assert.equal(removed.classes.length, 1);
  assert.equal(removed.classes[0].id, 'class-1');
  assert.equal(removed.activeClassId, 'class-1');
});

test('stores lesson records and derives cumulative points across lessons', () => {
  let app = stateApi.normalizeAppState({
    activeClassId: 'class-1',
    classes: [{
      id: 'class-1',
      lesson: 1,
      students: [{ id: 'a', name: '甲', notebook: 10, errorBook: 5, draft: 0, module: 5, totalPoints: 20 }],
    }],
  });
  let classroom = stateApi.getActiveClassroom(app);
  classroom = stateApi.updateStudentScore(classroom, 'a', 'notebook', 20);
  classroom = stateApi.switchLesson(classroom, 2);
  classroom = stateApi.updateStudentScore(classroom, 'a', 'notebook', 30);
  classroom = stateApi.updateStudentScore(classroom, 'a', 'module', 10);
  assert.equal(stateApi.getStudentTotalPoints(classroom, 'a'), 70);
  assert.equal(classroom.students[0].totalPoints, 70);
  app = stateApi.updateActiveClassroom(app, () => classroom);
  const parsed = stateApi.parseAppState(stateApi.serializeAppState(app), stateApi.createDefaultAppState());
  assert.equal(stateApi.getStudentTotalPoints(stateApi.getActiveClassroom(parsed), 'a'), 70);
  assert.equal(stateApi.getActiveClassroom(parsed).lessonRecords['1'].a.notebook, 20);
});

test('stores custom course scores separately and derives custom cumulative points', () => {
  let app = stateApi.normalizeAppState({
    layoutMode: 'custom',
    customCourseName: '成长挑战',
    activeClassId: 'class-1',
    classes: [{ id: 'class-1', lesson: 1, students: [{ id: 'a', name: '甲' }] }],
  });
  let classroom = stateApi.getActiveClassroom(app);
  classroom = stateApi.updateCustomStudentScore(classroom, 'a', 'punctuality', 8);
  classroom = stateApi.updateCustomStudentScore(classroom, 'a', 'homework', 12);
  assert.deepEqual(stateApi.getCustomStudentScores(classroom, 'a'), {
    punctuality: 8,
    afterClassTest: 0,
    homework: 12,
    participation: 0,
    preview: 0,
  });
  assert.equal(stateApi.getCustomStudentTotalPoints(classroom, 'a'), 20);
  classroom = stateApi.switchLesson(classroom, 2);
  classroom = stateApi.updateCustomStudentScore(classroom, 'a', 'preview', 5);
  assert.equal(stateApi.getCustomStudentTotalPoints(classroom, 'a'), 25);
  assert.equal(classroom.students[0].totalPoints, 0);
  app = stateApi.updateActiveClassroom(app, () => classroom);
  const parsed = stateApi.parseAppState(stateApi.serializeAppState(app), stateApi.createDefaultAppState());
  assert.equal(parsed.layoutMode, 'custom');
  assert.equal(parsed.customCourseName, '成长挑战');
  assert.equal(stateApi.getCustomStudentTotalPoints(stateApi.getActiveClassroom(parsed), 'a'), 25);
});

test('keeps custom badges independent from the classic badge set', () => {
  let classroom = stateApi.normalizeClassroom({
    id: 'class-1',
    lesson: 1,
    students: [{ id: 'a', name: '甲', badges: { notebook: 'purple' } }],
  });
  classroom = stateApi.updateCustomStudentBadge(classroom, 'a', 'preview', 'yellow');
  assert.equal(classroom.customBadges.a.preview, 'yellow');
  assert.equal(classroom.students[0].badges.notebook, 'purple');
});

test('counts independent module winners and upgrades badges after three and six wins', () => {
  const classroom = stateApi.normalizeClassroom({
    id: 'class-1',
    lesson: 6,
    students: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }],
    lessonRecords: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [String(index + 1), {
      a: { notebook: index < 6 ? 10 : 0, errorBook: index < 3 ? 10 : 0, draft: 0, module: 0 },
      b: { notebook: 0, errorBook: index < 3 ? 8 : 10, draft: 0, module: 0 },
    }])),
  });
  assert.equal(stateApi.getModuleWinCounts(classroom, 'notebook').a, 6);
  assert.equal(stateApi.getModuleWinCounts(classroom, 'errorBook').a, 3);
  assert.equal(stateApi.getAutomaticBadgeLevel(2), 'white');
  assert.equal(stateApi.getAutomaticBadgeLevel(3), 'yellow');
  assert.equal(stateApi.getAutomaticBadgeLevel(6), 'purple');
  const upgraded = stateApi.applyAutomaticBadges(classroom);
  assert.equal(upgraded.students.find((student) => student.id === 'a').badges.notebook, 'purple');
  assert.equal(upgraded.students.find((student) => student.id === 'a').badges.errorBook, 'yellow');
});

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
      duration: 30.04,
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
    duration: 30,
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
    duration: 0,
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
