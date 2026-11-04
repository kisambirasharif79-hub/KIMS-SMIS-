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

test('department accounts are protected by role-specific permissions', () => {
  const permissions = {
    subject_teacher: ['enter_marks', 'edit_marks'],
    class_teacher: ['enter_marks', 'view_marks', 'compile_marks', 'upload_to_admin'],
    school_admin: ['register_students', 'enroll_students', 'enter_marks', 'view_marks', 'manage_grading_scale', 'print_report_cards', 'generate_reports', 'manage_department_logins']
  };
  for (const [role, allowed] of Object.entries(permissions)) {
    for (const action of ['enter_marks', 'edit_marks', 'approve_marks', 'register_students', 'enroll_students', 'view_marks', 'compile_marks', 'upload_to_admin', 'manage_grading_scale', 'print_report_cards', 'generate_reports', 'manage_department_logins']) {
      assert.equal(context.canAccessAction(role, action), allowed.includes(action));
    }
  }
  assert.deepEqual(context.getRolePermissions('doss'), []);
  assert.deepEqual(context.getRolePermissions('head_teacher'), []);
});
