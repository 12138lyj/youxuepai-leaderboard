const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(projectRoot, 'src', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(projectRoot, 'styles.css'), 'utf8');

test('growth score editor uses a dedicated grid with room for five scores and total points', () => {
  assert.match(
    appSource,
    /student-editor \$\{isCustomLayout\(\) \? 'custom-score-editor' : ''\}/,
  );
  assert.match(
    styles,
    /\.student-editor\.custom-score-editor\s*\{[^}]*repeat\(5,\s*minmax\(76px,\s*0\.75fr\)\)[^}]*minmax\(100px,\s*1fr\)[^}]*38px;/s,
  );
});

test('desktop editor drawer is wide while the mobile drawer remains full width', () => {
  assert.match(styles, /\.edit-drawer\s*\{[^}]*width:\s*min\(940px,\s*100%\);/s);
  assert.match(
    styles,
    /@media\s*\(max-width:\s*760px\)[\s\S]*?\.edit-drawer\s*\{\s*width:\s*100%;\s*\}/,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*760px\)[\s\S]*?\.student-editor\.custom-score-editor\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*38px;\s*\}/,
  );
});
