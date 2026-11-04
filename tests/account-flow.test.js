const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const storage = new Map();
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const context = {
  console,
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  },
  window: { location: { href: '' } },
  document: { addEventListener() {} },
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
vm.runInContext(source, context);
context.showToast = () => {};
context.closeModal = () => {};
context.renderSchools = () => {};
context.renderSchoolAdmins = () => {};
context.updateNotifBadge = () => {};
context.renderPayments = () => {};

test('school parent credentials expose department accounts', () => {
  const school = {
    id: 42,
    name: 'Example School',
    username: 'example',
    password: 'school123',
    users: [
      { id: 4, name: 'Old DoSS', username: 'example-doss', password: 'doss123', role: 'doss' },
      { id: 5, name: 'Old Head Teacher', username: 'example-head', password: 'head123', role: 'head_teacher' }
    ]
  };
  const accounts = context.getSchoolDepartmentAccounts(school);
  assert.deepEqual(accounts.map(account => account.role), [
    'school_admin',
    'subject_teacher',
    'class_teacher'
  ]);
  assert.equal(accounts.every(account => account.username && !account.password), true);
  assert.equal(school.users.some(account => ['doss', 'head_teacher'].includes(account.role)), false);
});

test('a valid server session still opens the dashboard if the school list request fails', async () => {
  const priorAuth = storage.get('MOSHMIS_AUTH');
  const priorSchools = storage.get('MOSHMIS_SCHOOLS');
  const priorParentSession = storage.get('MOSHMIS_PARENT_SESSION');
  const priorFetch = context.fetch;
  const priorServerSessionActive = vm.runInContext('serverSessionActive', context);
  const notifications = [];
  context.showToast = message => notifications.push(message);
  context.fetch = async url => {
    if (url === '/api/auth/me') {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            user: {
              id: 'owner-1',
              role: 'admin',
              userRole: 'system_owner',
              schoolId: null,
              username: 'owner@example.test'
            }
          };
        }
      };
    }
    return {
      ok: false,
      status: 500,
      async json() { return { error: 'School query failed.' }; }
    };
  };

  try {
    const auth = await context.restoreServerSession();

    assert.equal(auth?.role, 'admin');
    assert.equal(context.getAuthentication()?.username, 'owner@example.test');
    assert.equal(vm.runInContext('serverSessionActive', context), true);
    assert.equal(context.window.location.href, '');
    assert.match(notifications[0], /school data could not be loaded/i);
  } finally {
    if (priorAuth === undefined) storage.delete('MOSHMIS_AUTH');
    else storage.set('MOSHMIS_AUTH', priorAuth);
    if (priorSchools === undefined) storage.delete('MOSHMIS_SCHOOLS');
    else storage.set('MOSHMIS_SCHOOLS', priorSchools);
    if (priorParentSession === undefined) storage.delete('MOSHMIS_PARENT_SESSION');
    else storage.set('MOSHMIS_PARENT_SESSION', priorParentSession);
    context.fetch = priorFetch;
    vm.runInContext(`serverSessionActive = ${priorServerSessionActive}`, context);
  }
});

test('school recovery does not reset a server password based only on a client-supplied email', () => {
  const school = {
    id: 'recovery-school',
    name: 'Recovery School',
    email: 'accounts@recovery.example',
    username: 'old-recovery',
    password: 'oldpass1',
    accountStatus: 'suspended'
  };
  context.saveSchool(school);

  const recovered = context.handlePasswordRecovery({
    preventDefault() {},
    target: {
      recoveryUsername: { value: '' },
      recoveryEmail: { value: 'ACCOUNTS@recovery.example' },
      recoveryNewUsername: { value: 'new-recovery' },
      recoveryPassword: { value: 'newpass2' },
      recoveryConfirm: { value: 'newpass2' }
    }
  });

  assert.equal(recovered, false);
  assert.equal(context.getSchoolById(school.id).username, 'old-recovery');
  assert.equal(context.getSchoolById(school.id).password, undefined);
  assert.equal(context.getSchoolById(school.id).accountStatus, 'suspended');
});

test('only the System Owner can reset a school or department login', async () => {
  const school = {
    id: 'owner-reset-school',
    name: 'Owner Reset School',
    username: 'owner-reset',
    password: 'oldpass1'
  };
  context.saveSchool(school);
  const formFields = {
    accountRole: { value: '2' },
    currentUsername: { value: 'owner-reset-subject' },
    username: { value: 'new-subject' },
    password: { value: 'newpassword2' },
    confirmPassword: { value: 'newpassword2' }
  };
  const submit = {
    preventDefault() {},
    target: {
      ...formFields,
      elements: { namedItem(name) { return formFields[name]; } }
    }
  };

  context.saveAuthState('school', school.id, 'school_admin');
  assert.equal(context.adminResetSchoolCredentials(submit, school.id), false);
  assert.equal(context.getSchoolById(school.id).users, undefined);

  context.saveAuthState('admin', null);
  const priorFetch = context.fetch;
  const priorShowModal = context.showModal;
  let modalContent = '';
  context.showModal = content => { modalContent = content; };
  context.openAdminLoginResetModal(school.id, '2');
  assert.match(modalContent, /Current Username/);
  assert.match(modalContent, /name="currentUsername" type="text" value=""/);
  assert.match(modalContent, /Confirm New Password/);
  assert.doesNotMatch(modalContent, /Current Password|currentPassword/);
  context.showModal = priorShowModal;
  context.fetch = async (url, options) => ({
    ok: true,
    status: 200,
    async json() {
      return {
        user: {
          id: '2',
          username: JSON.parse(options.body).username,
          status: 'active'
        }
      };
    }
  });
  vm.runInContext('serverSessionActive = true', context);
  assert.equal(context.adminResetSchoolCredentials(submit, school.id), true);
  await new Promise(resolve => setImmediate(resolve));
  const updated = context.getSchoolById(school.id);
  assert.equal(updated.users.find(user => user.role === 'subject_teacher').username, 'new-subject');
  assert.equal(updated.users.find(user => user.role === 'subject_teacher').password, undefined);
  context.fetch = priorFetch;
  vm.runInContext('serverSessionActive = false', context);
});

test('System Owner can reset the registered school account login through the server', async () => {
  const priorSchools = storage.get('MOSHMIS_SCHOOLS');
  const priorFetch = context.fetch;
  const school = {
    id: 'school-account-reset-test',
    name: 'School Account Reset Test',
    username: 'registered-school',
    schoolAccount: {
      id: 'school-account-user-1',
      accountType: 'school_account',
      name: 'School Administrator',
      username: 'registered-school',
      status: 'active'
    },
    users: []
  };
  context.saveSchool(school);
  context.saveAuthState('admin', null);
  let requestUrl = '';
  context.fetch = async (url, options) => {
    requestUrl = url;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          user: {
            id: school.schoolAccount.id,
            username: JSON.parse(options.body).username,
            status: 'active'
          }
        };
      }
    };
  };
  vm.runInContext('serverSessionActive = true', context);
  const resetFields = {
    accountRole: { value: school.schoolAccount.id },
    currentUsername: { value: 'registered-school' },
    username: { value: 'new-school-login' },
    password: { value: 'newpassword123' },
    confirmPassword: { value: 'newpassword123' }
  };
  const submit = {
    preventDefault() {},
    target: {
      ...resetFields,
      elements: { namedItem(name) { return resetFields[name]; } }
    }
  };

  assert.equal(context.adminResetSchoolCredentials(submit, school.id), true);
  await new Promise(resolve => setImmediate(resolve));
  const updated = context.getSchoolById(school.id);
  assert.equal(requestUrl, `/api/schools/${school.id}/users/${school.schoolAccount.id}/credentials`);
  assert.equal(updated.schoolAccount.username, 'new-school-login');
  assert.equal(updated.username, 'new-school-login');
  assert.equal(updated.schoolAccount.password, undefined);

  if (priorSchools === undefined) storage.delete('MOSHMIS_SCHOOLS');
  else storage.set('MOSHMIS_SCHOOLS', priorSchools);
  context.fetch = priorFetch;
  vm.runInContext('serverSessionActive = false', context);
});

test('department password resets are server-backed and never cached in plaintext', async () => {
  const priorSchools = storage.get('MOSHMIS_SCHOOLS');
  const priorAuditLogs = storage.get('MOSHMIS_AUDIT_LOGS');
  const priorFetch = context.fetch;
  const priorServerSessionActive = vm.runInContext('serverSessionActive', context);
  const school = {
    id: 'department-password-reset-test',
    name: 'Department Password Reset Test',
    users: [{
      id: 'department-user-1',
      accountType: 'subject_teacher',
      role: 'subject_teacher',
      name: 'Subject Teacher',
      username: 'teacher-login',
      password: 'legacy-plaintext'
    }]
  };
  context.saveSchool(school);
  const account = school.users[0];
  let requestUrl = '';
  let requestBody = null;
  context.fetch = async (url, options) => {
    requestUrl = url;
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          user: {
            id: account.id,
            username: account.username,
            status: 'active'
          }
        };
      }
    };
  };
  vm.runInContext('serverSessionActive = true', context);

  try {
    await context.resetDepartmentAccountPassword(school, account, 'teacher-login', 'new-department-pass');

    assert.equal(requestUrl, `/api/schools/${school.id}/users/${account.id}/password`);
    assert.deepEqual(requestBody, {
      currentUsername: 'teacher-login',
      newPassword: 'new-department-pass'
    });
    assert.equal(account.password, undefined);
    assert.equal(account.status, 'active');
    assert.equal(context.getSchoolById(school.id).users[0].password, undefined);
  } finally {
    if (priorSchools === undefined) storage.delete('MOSHMIS_SCHOOLS');
    else storage.set('MOSHMIS_SCHOOLS', priorSchools);
    if (priorAuditLogs === undefined) storage.delete('MOSHMIS_AUDIT_LOGS');
    else storage.set('MOSHMIS_AUDIT_LOGS', priorAuditLogs);
    context.fetch = priorFetch;
    vm.runInContext(`serverSessionActive = ${priorServerSessionActive}`, context);
  }
});

test('school registration login can create its first administrator login and enter the dashboard', async () => {
  const priorAuth = storage.get('MOSHMIS_AUTH');
  const priorSchools = storage.get('MOSHMIS_SCHOOLS');
  const priorParentSession = storage.get('MOSHMIS_PARENT_SESSION');
  const priorFetch = context.fetch;
  const priorServerSessionActive = vm.runInContext('serverSessionActive', context);
  const priorLocation = context.window.location.href;
  context.saveAuthState('school_parent', 'first-login-school', 'school_parent', 'school-account-id');
  vm.runInContext('serverSessionActive = true', context);
  let setupRequest = null;
  context.fetch = async (url, options = {}) => {
    if (url === '/api/schools/admin-setup') {
      setupRequest = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            user: {
              id: 'school-admin-id',
              schoolId: 'first-login-school',
              role: 'school',
              userRole: 'school_admin',
              username: 'admin@first-login.test',
              name: 'School Administrator'
            }
          };
        }
      };
    }
    if (url === '/api/schools') {
      return { ok: true, status: 200, async json() { return []; } };
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await context.completeFirstSchoolAdminSetup('admin@first-login.test', 'first-login-password');

    assert.deepEqual(setupRequest, {
      username: 'admin@first-login.test',
      password: 'first-login-password'
    });
    assert.equal(context.getAuthentication().role, 'school');
    assert.equal(context.getAuthentication().userRole, 'school_admin');
    assert.equal(context.getAuthentication().username, 'admin@first-login.test');
    assert.equal(context.window.location.href, 'dashboard.html');
  } finally {
    if (priorAuth === undefined) storage.delete('MOSHMIS_AUTH');
    else storage.set('MOSHMIS_AUTH', priorAuth);
    if (priorSchools === undefined) storage.delete('MOSHMIS_SCHOOLS');
    else storage.set('MOSHMIS_SCHOOLS', priorSchools);
    if (priorParentSession === undefined) storage.delete('MOSHMIS_PARENT_SESSION');
    else storage.set('MOSHMIS_PARENT_SESSION', priorParentSession);
    context.fetch = priorFetch;
    context.window.location.href = priorLocation;
    vm.runInContext(`serverSessionActive = ${priorServerSessionActive}`, context);
  }
});

test('School Management changes only update local data after the server confirms the action', async () => {
  const priorSchools = storage.get('MOSHMIS_SCHOOLS');
  const priorFetch = context.fetch;
  const priorServerSessionActive = vm.runInContext('serverSessionActive', context);
  const school = {
    id: 'school-management-actions-test',
    name: 'Before Update',
    district: 'Test District',
    username: 'test-school',
    logoDataUrl: '',
    accountStatus: 'active'
  };
  context.saveSchool(school);
  context.saveAuthState('admin', null);
  const requests = [];
  context.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() { return { status: 'ok' }; }
    };
  };
  vm.runInContext('serverSessionActive = true', context);

  try {
    school.accountStatus = 'suspended';
    await context.saveManagedSchool(school);
    assert.equal(context.getSchoolById(school.id).accountStatus, 'suspended');
    assert.equal(requests[0].url, `/api/schools/${school.id}`);
    assert.equal(requests[0].options.method, 'PUT');

    await context.deleteManagedSchool(school.id);
    assert.equal(context.getSchoolById(school.id), null);
    assert.equal(requests[1].url, `/api/schools/${school.id}`);
    assert.equal(requests[1].options.method, 'DELETE');
  } finally {
    if (priorSchools === undefined) storage.delete('MOSHMIS_SCHOOLS');
    else storage.set('MOSHMIS_SCHOOLS', priorSchools);
    context.fetch = priorFetch;
    vm.runInContext(`serverSessionActive = ${priorServerSessionActive}`, context);
  }
});

test('school support tickets can be replied to, managed by the owner, and reopened by the school', () => {
  const priorSchools = storage.get('MOSHMIS_SCHOOLS');
  const priorTickets = storage.get('MOSHMIS_SUPPORT_TICKETS');
  const priorAuditLogs = storage.get('MOSHMIS_AUDIT_LOGS');
  storage.set('MOSHMIS_SUPPORT_TICKETS', '[]');
  const school = {
    id: 'support-ticket-school',
    name: 'Support Ticket School',
    username: 'support-school',
    password: 'school123'
  };
  context.saveSchool(school);
  context.saveAuthState('school', school.id, 'school_admin', 1);
  const ticket = context.createSupportTicket({
    subject: 'Cannot open report cards',
    category: 'marks_reports',
    priority: 'high',
    message: 'The report card page gives an error.'
  });
  assert.ok(ticket);
  assert.equal(ticket.status, 'open');
  assert.equal(context.getSupportTickets().length, 1);
  assert.equal(context.createSupportTicket({
    subject: '',
    category: 'invalid',
    priority: 'urgent',
    message: ''
  }), null);

  context.saveAuthState('school', 'another-school', 'school_admin', 1);
  assert.equal(context.addSupportTicketReply(ticket.id, 'Unauthorized reply'), false);

  context.saveAuthState('admin', null);
  assert.equal(context.addSupportTicketReply(ticket.id, 'We are investigating this issue.'), true);
  assert.equal(context.getSupportTickets()[0].status, 'waiting_school');
  assert.equal(context.updateSupportTicket(ticket.id, { status: 'resolved', priority: 'normal' }), true);
  assert.equal(context.getSupportTickets()[0].status, 'resolved');
  assert.equal(context.getSupportTickets()[0].priority, 'normal');

  context.saveAuthState('school', school.id, 'school_admin', 1);
  assert.equal(context.addSupportTicketReply(ticket.id, 'The issue is still happening.'), true);
  assert.equal(context.getSupportTickets()[0].status, 'open');
  assert.equal(context.getSupportTickets()[0].messages.length, 2);

  context.saveAuthState('admin', null);
  assert.equal(context.deleteSupportTicket(ticket.id), true);
  assert.equal(context.getSupportTickets().length, 0);

  if (priorSchools === undefined) storage.delete('MOSHMIS_SCHOOLS');
  else storage.set('MOSHMIS_SCHOOLS', priorSchools);
  if (priorTickets === undefined) storage.delete('MOSHMIS_SUPPORT_TICKETS');
  else storage.set('MOSHMIS_SUPPORT_TICKETS', priorTickets);
  if (priorAuditLogs === undefined) storage.delete('MOSHMIS_AUDIT_LOGS');
  else storage.set('MOSHMIS_AUDIT_LOGS', priorAuditLogs);
});

test('School Administrators reset targets the school-admin account by account type and returns to the directory', async () => {
  const priorSchools = storage.get('MOSHMIS_SCHOOLS');
  const priorConfiguration = storage.get('MOSHMIS_OWNER_CONFIGURATION');
  const priorFetch = context.fetch;
  context.saveAuthState('admin', null);
  const configuration = context.getOwnerConfiguration();
  configuration.roleDefinitions = [
    ...(configuration.roleDefinitions || []).filter(role => role.id !== 'custom_school_admin'),
    { id: 'custom_school_admin', name: 'Custom School Admin', permissions: ['manage_staff'] }
  ];
  assert.equal(context.saveOwnerConfiguration(configuration), true);

  const school = {
    id: 'school-admin-directory-test',
    name: 'Directory Test School',
    username: 'directory-school',
    password: 'school123'
  };
  context.saveSchool(school);
  const savedSchool = context.getSchoolById(school.id);
  context.getSchoolDepartmentAccounts(savedSchool);
  const admin = savedSchool.users.find(user => user.accountType === 'school_admin');
  admin.role = 'custom_school_admin';
  context.saveSchool(savedSchool);

  let directoryRenderCount = 0;
  context.document.getElementById = id => id === 'pageTitle'
    ? { textContent: 'School Administrators' }
    : null;
  context.renderSchoolAdmins = () => { directoryRenderCount += 1; };
  context.fetch = async (url, options) => ({
    ok: true,
    status: 200,
    async json() {
      return {
        user: {
          id: String(admin.id),
          username: JSON.parse(options.body).username,
          status: 'active'
        }
      };
    }
  });
  vm.runInContext('serverSessionActive = true', context);
  const resetFields = {
    accountRole: { value: String(admin.id) },
    currentUsername: { value: admin.username },
    username: { value: 'directory-admin-updated' },
    password: { value: 'updatedpass1' },
    confirmPassword: { value: 'updatedpass1' }
  };
  const submit = {
    preventDefault() {},
    target: {
      ...resetFields,
      elements: { namedItem(name) { return resetFields[name]; } }
    }
  };

  assert.equal(context.adminResetSchoolCredentials(submit, school.id), true);
  await new Promise(resolve => setImmediate(resolve));
  const updated = context.getSchoolById(school.id);
  const updatedAdmin = updated.users.find(user => user.accountType === 'school_admin');
  assert.equal(updated.username, 'directory-school');
  assert.equal(updated.password, undefined);
  assert.equal(updatedAdmin.username, 'directory-admin-updated');
  assert.equal(updatedAdmin.role, 'custom_school_admin');
  assert.equal(directoryRenderCount, 1);

  if (priorSchools === undefined) storage.delete('MOSHMIS_SCHOOLS');
  else storage.set('MOSHMIS_SCHOOLS', priorSchools);
  if (priorConfiguration === undefined) storage.delete('MOSHMIS_OWNER_CONFIGURATION');
  else storage.set('MOSHMIS_OWNER_CONFIGURATION', priorConfiguration);
  context.fetch = priorFetch;
  vm.runInContext('serverSessionActive = false', context);
  delete context.document.getElementById;
});

test('System Owner role definitions persist and assigned custom roles keep their permissions', () => {
  context.saveAuthState('admin', null);
  const roles = context.getSystemRoles().map(role => ({
    id: role.id,
    name: role.name,
    permissions: role.permissions
  }));
  roles.push({
    id: 'custom_marks_reviewer',
    name: 'Marks Reviewer',
    permissions: ['view_marks']
  });
  assert.equal(context.saveSystemRoleDefinitions(roles), true);
  assert.equal(context.canAccessAction('custom_marks_reviewer', 'view_marks'), true);
  assert.equal(context.canAccessAction('custom_marks_reviewer', 'enter_marks'), false);

  const school = {
    id: 456,
    name: 'Role Assignment School',
    username: 'role-school',
    password: 'school123'
  };
  context.saveSchool(school);
  const accounts = context.getSchoolDepartmentAccounts(school);
  const subjectTeacher = school.users.find(user => user.accountType === 'subject_teacher');
  subjectTeacher.role = 'custom_marks_reviewer';
  context.saveSchool(school);

  const savedSchool = context.getSchoolById(school.id);
  context.ensureSchoolUsers(savedSchool);
  assert.equal(savedSchool.users.find(user => user.id === subjectTeacher.id).role, 'custom_marks_reviewer');
  assert.equal(savedSchool.users.length, accounts.length);
  assert.equal(context.getSystemRoleName('custom_marks_reviewer'), 'Marks Reviewer');

  storage.delete('MOSHMIS_OWNER_CONFIGURATION');
  storage.delete('MOSHMIS_SCHOOLS');
  context.clearAuthState();
});

test('System Owner settings persist notification and security choices', () => {
  context.saveAuthState('admin', null);
  context.saveSystemSettings({
    preventDefault() {},
    target: {
      minimumPasswordLength: { value: '12' },
      sessionTimeoutMinutes: { value: '30' },
      paymentAlerts: { checked: false },
      announcementAlerts: { checked: true }
    }
  });

  assert.deepEqual(JSON.parse(storage.get('MOSHMIS_SYSTEM_SETTINGS')), {
    notifications: { paymentAlerts: false, announcementAlerts: true },
    security: { minimumPasswordLength: 12, sessionTimeoutMinutes: 30 }
  });
  assert.equal(context.getMinimumPasswordLength(), 12);
  storage.delete('MOSHMIS_SYSTEM_SETTINGS');
});

test('System Owner can schedule, update, and delete image announcements', () => {
  const now = Date.now();
  const schedule = {
    title: 'School notice',
    message: 'Please read the attached flyer.',
    imageDataUrl: 'data:image/png;base64,ZmFrZQ==',
    startsAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString()
  };
  context.saveAuthState('admin', null);
  const announcement = context.addSystemAnnouncement(schedule);

  assert.ok(announcement);
  assert.equal(announcement.imageDataUrl, schedule.imageDataUrl);
  assert.equal(context.isSystemAnnouncementActive(announcement, now), true);
  assert.equal(context.isSystemAnnouncementActive(announcement, now + 60_000), false);
  assert.equal(context.addSystemAnnouncement({ ...schedule, expiresAt: schedule.startsAt }), null);
  const flyerOnly = context.addSystemAnnouncement({
    ...schedule,
    title: '',
    message: '',
    imageDataUrl: 'data:image/webp;base64,ZmFrZQ=='
  });
  assert.equal(flyerOnly.title, 'School flyer');
  assert.equal(flyerOnly.message, '');
  const gallery = context.addSystemAnnouncement({
    ...schedule,
    title: 'School gallery',
    imageDataUrl: '',
    imageDataUrls: ['data:image/png;base64,Zmlyc3Q=', 'data:image/webp;base64,c2Vjb25k']
  });
  assert.equal(gallery.imageDataUrls.length, 2);
  assert.equal(gallery.imageDataUrl, gallery.imageDataUrls[0]);
  assert.equal(context.addSystemAnnouncement({ ...schedule, title: '', message: '', imageDataUrl: '' }), null);

  context.saveAuthState('school', 'announcement-test-school', 'school_admin');
  assert.equal(context.updateSystemAnnouncement(announcement.id, schedule), false);
  assert.equal(context.removeSystemAnnouncement(announcement.id), false);

  context.saveAuthState('admin', null);
  const updated = {
    ...schedule,
    title: 'Updated notice',
    imageDataUrl: '',
    expiresAt: new Date(now + 120_000).toISOString()
  };
  assert.equal(context.updateSystemAnnouncement(announcement.id, updated), true);
  assert.equal(context.getSystemAnnouncements()[0].title, 'Updated notice');
  assert.equal(context.getSystemAnnouncements()[0].imageDataUrl, '');
  assert.equal(context.removeSystemAnnouncement(announcement.id), true);
  assert.equal(context.removeSystemAnnouncement(flyerOnly.id), true);
  assert.equal(context.removeSystemAnnouncement(gallery.id), true);
  assert.equal(context.getSystemAnnouncements().some(item => item.id === announcement.id), false);

  storage.delete('MOSHMIS_SYSTEM_ANNOUNCEMENTS');
  storage.delete('MOSHMIS_AUDIT_LOGS');
});

test('only System Owner approval unlocks service-fee payment', () => {
  const school = {
    id: 'payment-school',
    name: 'Payment School',
    students: [{ id: 1 }, { id: 2 }],
    payments: [{
      id: 9,
      amount: 160,
      status: 'submitted',
      paymentCategory: 'serviceFee',
      packageId: 'termly',
      txRef: 'TXN-9',
      date: new Date().toISOString()
    }]
  };
  context.saveSchool(school);

  context.saveAuthState('school', school.id, 'school_admin');
  assert.equal(context.approveSubmittedPayment(school.id, 9), false);
  assert.equal(context.hasPaidServiceFee(context.getSchoolById(school.id), 'termly'), false);

  context.saveAuthState('admin', null);
  assert.equal(context.approveSubmittedPayment(school.id, 9), true);
  const approvedSchool = context.getSchoolById(school.id);
  assert.equal(approvedSchool.payments[0].status, 'paid');
  assert.equal(approvedSchool.payments[0].approvedBy, 'System Administrator');
  assert.equal(context.hasPaidServiceFee(approvedSchool, 'termly'), true);
});

test('only the System Owner can delete selected payment history records', () => {
  const school = {
    id: 'payment-history-school',
    name: 'Payment History School',
    payments: [
      { id: 21, amount: 80, status: 'paid', date: new Date().toISOString() },
      { id: 22, amount: 160, status: 'pending', date: new Date().toISOString() }
    ]
  };
  context.saveSchool(school);

  context.saveAuthState('school', school.id, 'school_admin');
  assert.equal(context.removePaymentHistoryRecords([`${school.id}:21`]), 0);
  assert.equal(context.getSchoolById(school.id).payments.length, 2);

  context.saveAuthState('admin', null);
  assert.equal(context.removePaymentHistoryRecords([`${school.id}:21`]), 1);
  assert.deepEqual(
    context.getSchoolById(school.id).payments.map(payment => payment.id),
    [22]
  );
});

test('legacy school-confirmed service fees are returned to the owner approval queue', () => {
  const school = {
    id: 'legacy-payment-school',
    name: 'Legacy Payment School',
    students: [{ id: 1 }],
    payments: [{
      id: 10,
      amount: 80,
      status: 'paid',
      paymentCategory: 'serviceFee',
      packageId: 'termly',
      txRef: 'OLD-TXN',
      date: new Date().toISOString(),
      paidDate: new Date().toISOString()
    }]
  };
  context.saveSchool(school);

  const payment = context.getAllPayments().find(item => item.schoolId === school.id);
  assert.equal(payment.status, 'submitted');
  assert.equal(context.hasPaidServiceFee(context.getSchoolById(school.id), 'termly'), false);
});
