const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const storage = new Map();
const context = {
  console,
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  },
  window: { location: { href: '' } },
  document: { addEventListener() {}, getElementById() { return null; } },
  setTimeout() {},
  clearTimeout,
  URL,
  Blob,
  Date,
  Math,
  JSON,
  Number,
  String,
  Array,
  Map,
  Set,
  RegExp,
  Error,
  confirm() { return true; }
};

vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8'), context);

test('legacy browser-stored passwords are not accepted for department login', () => {
  const school = {
    id: 'school-1',
    name: 'Example School',
    username: 'example',
    password: 'school123',
    users: [{
      id: 2,
      name: 'Subject Teacher',
      username: 'subject@example',
      password: 'subject123',
      role: 'subject_teacher'
    }]
  };

  context.saveSchool(school);
  context.saveAuthState('school_parent', school.id, 'school_parent', school.id);
  assert.equal(context.loginDepartmentAccount('subject@example', 'subject123'), false);
  assert.equal(context.getAuthentication().role, 'school_parent');
  assert.equal(context.getSchoolById(school.id).password, undefined);
});
