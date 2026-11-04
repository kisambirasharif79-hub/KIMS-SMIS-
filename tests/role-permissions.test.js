const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const context = {
  console,
  localStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
  },
  window: { location: { href: '' } },
  document: { addEventListener() {} },
  setTimeout,
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
vm.runInContext(source, context);

test('department roles have only their requested permissions', () => {
  assert.deepEqual(context.getRolePermissions('school_admin'), [
    'register_students',
    'enroll_students',
    'enter_marks',
    'view_marks',
    'manage_grading_scale',
    'print_report_cards',
    'generate_reports',
    'manage_department_logins',
    'manage_staff',
    'manage_classes'
  ]);
  assert.deepEqual(context.getRolePermissions('subject_teacher'), [
    'enter_marks',
    'edit_marks'
  ]);
  assert.deepEqual(context.getRolePermissions('class_teacher'), [
    'enter_marks',
    'view_marks',
    'compile_marks',
    'upload_to_admin'
  ]);
  assert.deepEqual(context.getRolePermissions('doss'), []);
  assert.deepEqual(context.getRolePermissions('head_teacher'), []);
});

test('department roles can enter marks without gaining approval permissions', () => {
  assert.equal(context.canAccessAction('school_admin', 'enter_marks'), true);
  assert.equal(context.canAccessAction('school_admin', 'manage_grading_scale'), true);
  assert.equal(context.canAccessAction('school_admin', 'manage_department_logins'), true);
  assert.equal(context.canAccessAction('class_teacher', 'manage_department_logins'), false);
  assert.equal(context.canAccessAction('subject_teacher', 'manage_department_logins'), false);
  assert.equal(context.canAccessAction('class_teacher', 'enter_marks'), true);
  assert.equal(context.canAccessAction('subject_teacher', 'enter_marks'), true);
  assert.equal(context.canAccessAction('subject_teacher', 'edit_marks'), true);
  assert.equal(context.canAccessAction('subject_teacher', 'approve_marks'), false);
  assert.equal(context.canAccessAction('class_teacher', 'compile_marks'), true);
  assert.equal(context.canAccessAction('class_teacher', 'upload_to_admin'), true);
  assert.equal(context.canAccessAction('class_teacher', 'approve_marks'), false);
  assert.equal(context.canAccessAction('school_admin', 'approve_marks'), false);
});
