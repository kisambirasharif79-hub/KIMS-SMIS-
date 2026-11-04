/**
 * MOSHMIS - Modern School Management & Information System
 * Shared JavaScript Logic — Multi-school with registration
 */

// ==================== SYSTEM OWNER IDENTITY ====================
const ADMIN_CREDENTIAL = { name: 'System Owner' };
let serverSessionActive = false;

async function apiRequest(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function refreshSchoolsFromServer() {
  const schools = await apiRequest('/schools');
  localStorage.setItem('MOSHMIS_SCHOOLS', JSON.stringify(schools));
  serverSessionActive = true;
  return schools;
}

async function restoreServerSession() {
  const previousAuth = loadAuthState();
  const timeoutMinutes = getSystemSettings().security.sessionTimeoutMinutes;
  if (timeoutMinutes && Number(previousAuth?.timestamp) &&
      Date.now() - Number(previousAuth.timestamp) >= timeoutMinutes * 60 * 1000) {
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => {});
    clearAuthState();
    return null;
  }
  try {
    const { user } = await apiRequest('/auth/me');
    const auth = {
      role: user.role,
      schoolId: user.schoolId || null,
      userRole: user.userRole || null,
      userId: user.id,
      username: user.username,
      timestamp: Date.now()
    };
    localStorage.setItem('MOSHMIS_AUTH', JSON.stringify(auth));
    serverSessionActive = true;
    if (user.role === 'school_parent') {
      localStorage.setItem(PARENT_SESSION_KEY, JSON.stringify({
        ...auth,
        role: 'school_parent',
        userRole: 'school_parent',
        userId: user.id
      }));
    }
    try {
      await refreshSchoolsFromServer();
    } catch (error) {
      if (error.status === 401) {
        serverSessionActive = false;
        clearAuthState();
        return null;
      }
      console.error('Could not load schools after restoring the server session:', error);
      showToast('You are signed in, but school data could not be loaded. Some dashboard features may be unavailable.', 'error');
    }
    return auth;
  } catch (error) {
    serverSessionActive = false;
    if (error.status !== 401) {
      console.error('Could not restore the server session:', error);
      showToast('Cannot connect to the KIMS database service. Please try again later.', 'error');
    }
    return null;
  }
}

const SCHOOL_USER_ROLES = {
  school_admin: 'Admin',
  subject_teacher: 'Subject Teacher',
  class_teacher: 'Class Teacher'
};

// ==================== CORE DB (non-school data) ====================
const DB = {
  classes: ["Baby", "Middle", "Top", "P1", "P2", "P3", "P4", "P5", "P6", "P7"],
  subjects: {
    lower: ["English", "Mathematics", "Literacy I", "Literacy II/RWT", "Luganda/LD I", "RE", "CAPE I/RWD/SD 1", "CAPE II/LD II", "CAPE III/HBS", "Project Work"],
    upper: ["Science", "Mathematics", "English", "Social Studies", "Project Work"]
  },
  gradeScale: [
    { min: 85, max: 100, grade: "D1", remark: "Distinction" },
    { min: 80, max: 84,  grade: "D2", remark: "Distinction" },
    { min: 75, max: 79,  grade: "C3", remark: "Credit" },
    { min: 70, max: 74,  grade: "C4", remark: "Credit" },
    { min: 60, max: 69,  grade: "C4", remark: "Credit" },
    { min: 56, max: 59,  grade: "C5", remark: "Credit" },
    { min: 50, max: 55,  grade: "C6", remark: "Credit" },
    { min: 40, max: 49,  grade: "P7", remark: "Pass" },
    { min: 35, max: 39,  grade: "P8", remark: "Pass" },
    { min: 0,  max: 34,  grade: "F9", remark: "Fail" }
  ],
  currentUser: null,
  currentView: 'dashboard'
};

const OWNER_CONFIGURATION_KEY = 'MOSHMIS_OWNER_CONFIGURATION';
const SYSTEM_SETTINGS_KEY = 'MOSHMIS_SYSTEM_SETTINGS';
const LAST_BACKUP_KEY = 'MOSHMIS_LAST_BACKUP';
const SYSTEM_BACKUP_FORMAT = 'MOSHMIS_BACKUP';
const DEFAULT_SYSTEM_SETTINGS = {
  notifications: {
    paymentAlerts: true,
    announcementAlerts: true
  },
  security: {
    minimumPasswordLength: 10,
    sessionTimeoutMinutes: 60
  }
};
const DEFAULT_OWNER_CONFIGURATION = {
  academicYears: [
    { id: '2025-2026', name: '2025/2026', term1: 'Jan-Mar', term2: 'Apr-Jun', term3: 'Jul-Sep', active: true },
    { id: '2024-2025', name: '2024/2025', term1: 'Jan-Mar', term2: 'Apr-Jun', term3: 'Jul-Sep', active: false }
  ],
  reportCardTemplates: [
    { id: 'template-primary', name: 'Primary School', description: 'Primary school layout with logo header.' },
    { id: 'template-secondary', name: 'Secondary School', description: 'Secondary school report card with grade summary.' },
    { id: 'template-nursery', name: 'Nursery', description: 'Early learning milestones and comments.' },
    { id: 'template-detailed', name: 'Detailed Subject Results', description: 'Detailed subject grade book.' }
  ],
  subscriptionPlans: [
    { id: 'plan-premium', name: 'Premium', price: 650000, billingPeriod: 'year', description: 'Unlimited report generation, priority support, analytics.' },
    { id: 'plan-basic', name: 'Basic', price: 250000, billingPeriod: 'year', description: 'Essential school tools, attendance, report cards.' },
    { id: 'plan-trial', name: 'Trial', price: 0, billingPeriod: '30 days', description: 'Free trial for new schools.' }
  ],
  gradeScale: DB.gradeScale
};

function getOwnerConfiguration() {
  try {
    const stored = JSON.parse(localStorage.getItem(OWNER_CONFIGURATION_KEY) || '{}');
    return {
      academicYears: Array.isArray(stored.academicYears) ? stored.academicYears : DEFAULT_OWNER_CONFIGURATION.academicYears.map(item => ({ ...item })),
      reportCardTemplates: Array.isArray(stored.reportCardTemplates) ? stored.reportCardTemplates : DEFAULT_OWNER_CONFIGURATION.reportCardTemplates.map(item => ({ ...item })),
      subscriptionPlans: Array.isArray(stored.subscriptionPlans) ? stored.subscriptionPlans : DEFAULT_OWNER_CONFIGURATION.subscriptionPlans.map(item => ({ ...item })),
      gradeScale: Array.isArray(stored.gradeScale) && stored.gradeScale.length ? stored.gradeScale : DEFAULT_OWNER_CONFIGURATION.gradeScale.map(item => ({ ...item })),
      roleDefinitions: Array.isArray(stored.roleDefinitions) ? stored.roleDefinitions : []
    };
  } catch {
    return {
      academicYears: DEFAULT_OWNER_CONFIGURATION.academicYears.map(item => ({ ...item })),
      reportCardTemplates: DEFAULT_OWNER_CONFIGURATION.reportCardTemplates.map(item => ({ ...item })),
      subscriptionPlans: DEFAULT_OWNER_CONFIGURATION.subscriptionPlans.map(item => ({ ...item })),
      gradeScale: DEFAULT_OWNER_CONFIGURATION.gradeScale.map(item => ({ ...item })),
      roleDefinitions: []
    };
  }
}

function saveOwnerConfiguration(configuration) {
  if (getAuthentication()?.role !== 'admin') {
    showToast('Only the System Owner can update platform configuration.', 'error');
    return false;
  }
  localStorage.setItem(OWNER_CONFIGURATION_KEY, JSON.stringify(configuration));
  DB.gradeScale = configuration.gradeScale.map(item => ({ ...item }));
  recordAuditEvent('Platform configuration updated', 'System');
  return true;
}

DB.gradeScale = getOwnerConfiguration().gradeScale;

function getSystemSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SYSTEM_SETTINGS_KEY) || '{}');
    const security = stored.security || {};
    const minimumPasswordLength = Number(security.minimumPasswordLength);
    const sessionTimeoutMinutes = Number(security.sessionTimeoutMinutes);
    return {
      notifications: {
        paymentAlerts: stored.notifications?.paymentAlerts !== false,
        announcementAlerts: stored.notifications?.announcementAlerts !== false
      },
      security: {
        minimumPasswordLength: Number.isInteger(minimumPasswordLength) && minimumPasswordLength >= 10 && minimumPasswordLength <= 32
          ? minimumPasswordLength
          : DEFAULT_SYSTEM_SETTINGS.security.minimumPasswordLength,
        sessionTimeoutMinutes: [0, 15, 30, 60, 120, 240].includes(sessionTimeoutMinutes)
          ? sessionTimeoutMinutes
          : DEFAULT_SYSTEM_SETTINGS.security.sessionTimeoutMinutes
      }
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_SYSTEM_SETTINGS));
  }
}

function getMinimumPasswordLength() {
  return getSystemSettings().security.minimumPasswordLength;
}

function saveSystemSettings(e) {
  e.preventDefault();
  if (getAuthentication()?.role !== 'admin') {
    showToast('Only the System Owner can update system settings.', 'error');
    return;
  }

  const form = e.target;
  const minimumPasswordLength = Number(form.minimumPasswordLength.value);
  const sessionTimeoutMinutes = Number(form.sessionTimeoutMinutes.value);
  if (!Number.isInteger(minimumPasswordLength) || minimumPasswordLength < 10 || minimumPasswordLength > 32) {
    showToast('Choose a minimum password length between 10 and 32 characters.', 'error');
    return;
  }
  if (![0, 15, 30, 60, 120, 240].includes(sessionTimeoutMinutes)) {
    showToast('Choose a valid session timeout.', 'error');
    return;
  }

  const settings = {
    notifications: {
      paymentAlerts: form.paymentAlerts.checked,
      announcementAlerts: form.announcementAlerts.checked
    },
    security: { minimumPasswordLength, sessionTimeoutMinutes }
  };
  try {
    localStorage.setItem(SYSTEM_SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('Could not save system settings:', error);
    showToast('System settings could not be saved. Check browser storage and try again.', 'error');
    return;
  }
  recordAuditEvent('System settings updated', 'Settings');
  updateNotifBadge();
  if (getAuthentication()?.role !== 'admin' && typeof updateAnnouncementNotificationBadge === 'function') {
    updateAnnouncementNotificationBadge();
  }
  showToast('System settings saved successfully.', 'success');
}

function setUserThemePreference(mode) {
  if (!['light', 'dark', 'system'].includes(mode)) {
    showToast('Choose a valid theme.', 'error');
    return false;
  }
  const auth = getAuthentication();
  if (!auth) return false;
  const userKey = auth.role === 'admin'
    ? 'system-owner'
    : [auth.role, auth.schoolId || '', auth.userRole || '', auth.userId ?? ''].join(':');
  try {
    localStorage.setItem(`MOSHMIS_USER_THEME_${encodeURIComponent(userKey)}`, mode);
    if (auth.role === 'admin') localStorage.setItem('MOSHMIS_INTERFACE_MODE', mode);
  } catch (error) {
    console.error('Could not save theme preference:', error);
    showToast('Your theme preference could not be saved. Check browser storage and try again.', 'error');
    return false;
  }
  applyInterfaceMode(mode);
  document.querySelectorAll('[data-theme-preference]').forEach(select => { select.value = mode; });
  return true;
}

function initializeThemePreferenceControls() {
  const auth = getAuthentication();
  const userKey = auth?.role === 'admin'
    ? 'system-owner'
    : [auth?.role || '', auth?.schoolId || '', auth?.userRole || '', auth?.userId ?? ''].join(':');
  const storedMode = auth
    ? localStorage.getItem(`MOSHMIS_USER_THEME_${encodeURIComponent(userKey)}`)
    : null;
  const mode = storedMode || getPreferredInterfaceMode(getActiveSchool());
  document.querySelectorAll('[data-theme-preference]').forEach(select => {
    select.value = mode;
    if (select.dataset.themePreferenceInitialized) return;
    select.dataset.themePreferenceInitialized = 'true';
    select.addEventListener('change', () => {
      if (setUserThemePreference(select.value)) showToast('Your theme preference has been saved.', 'success');
    });
  });
  applyInterfaceMode(mode);
}

function createSystemBackup() {
  if (getAuthentication()?.role !== 'admin') {
    showToast('Only the System Owner can create a system backup.', 'error');
    return;
  }

  try {
    const data = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith('MOSHMIS_') || ['MOSHMIS_AUTH', 'MOSHMIS_PARENT_SESSION'].includes(key)) continue;
      data[key] = localStorage.getItem(key);
    }
    const backup = {
      format: SYSTEM_BACKUP_FORMAT,
      version: 1,
      createdAt: new Date().toISOString(),
      data
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kims-system-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    localStorage.setItem(LAST_BACKUP_KEY, backup.createdAt);
    recordAuditEvent('System backup downloaded', 'Backups');
    showToast('System backup downloaded. Store the file securely.', 'success');
    renderBackups();
  } catch (error) {
    console.error('Could not create system backup:', error);
    showToast('The system backup could not be created. Check browser storage and try again.', 'error');
  }
}

function restoreSystemBackup(e) {
  if (getAuthentication()?.role !== 'admin') {
    showToast('Only the System Owner can restore a system backup.', 'error');
    return;
  }
  const input = e.target;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onerror = () => {
    showToast('The selected backup file could not be read.', 'error');
    input.value = '';
  };
  reader.onload = () => {
    try {
      const backup = JSON.parse(String(reader.result || ''));
      if (backup.format !== SYSTEM_BACKUP_FORMAT || backup.version !== 1 || !backup.data ||
          typeof backup.data !== 'object' || Array.isArray(backup.data)) {
        throw new Error('Unsupported or invalid backup file.');
      }
      const backupKeys = Object.keys(backup.data);
      if (backupKeys.some(key =>
        !key.startsWith('MOSHMIS_') ||
        ['MOSHMIS_AUTH', 'MOSHMIS_PARENT_SESSION'].includes(key) ||
        (backup.data[key] !== null && typeof backup.data[key] !== 'string')
      )) {
        throw new Error('Backup contains unsupported data.');
      }
      const registry = backup.data.MOSHMIS_SCHOOLS;
      if (registry !== undefined && !Array.isArray(JSON.parse(registry))) {
        throw new Error('Backup school data is invalid.');
      }
      if (!confirm('Restore this backup? Current system data will be replaced. This cannot be undone.')) {
        input.value = '';
        return;
      }

      const currentData = {};
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith('MOSHMIS_') && !['MOSHMIS_AUTH', 'MOSHMIS_PARENT_SESSION'].includes(key)) {
          currentData[key] = localStorage.getItem(key);
        }
      }
      try {
        Object.keys(currentData).forEach(key => localStorage.removeItem(key));
        Object.entries(backup.data).forEach(([key, value]) => {
          if (value !== null) localStorage.setItem(key, value);
        });
      } catch (restoreError) {
        Object.keys(currentData).forEach(key => localStorage.removeItem(key));
        Object.entries(currentData).forEach(([key, value]) => localStorage.setItem(key, value));
        throw restoreError;
      }

      recordAuditEvent('System backup restored', 'Backups');
      showToast('Backup restored successfully.', 'success');
      input.value = '';
      renderBackups();
      if (typeof updateNotifBadge === 'function') updateNotifBadge();
    } catch (error) {
      console.error('Could not restore system backup:', error);
      showToast(`Backup restore failed: ${error.message}`, 'error');
      input.value = '';
    }
  };
  reader.readAsText(file);
}

// ==================== SCHOOL REGISTRY (persisted) ====================
// Each school entry:
// { id, name, district, address, tel, email, motto, logoDataUrl,
//   username, headTeacher,
//   staff:[], students:[], marks:{} }

function sanitizeClientRecord(value) {
  if (Array.isArray(value)) return value.map(sanitizeClientRecord);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(password|password_hash|token|refresh_token)$/i.test(key))
    .map(([key, item]) => [key, sanitizeClientRecord(item)]));
}

function loadSchoolRegistry() {
  try {
    const raw = localStorage.getItem('MOSHMIS_SCHOOLS');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const safeRecords = sanitizeClientRecord(parsed);
    const serialized = JSON.stringify(safeRecords);
    if (serialized !== raw) {
      try {
        localStorage.setItem('MOSHMIS_SCHOOLS', serialized);
      } catch (error) {
        console.error('Could not remove legacy credentials from browser storage:', error);
        showToast('Legacy login details could not be removed from this browser. Clear the old local school data.', 'error');
      }
    }
    return safeRecords;
  } catch (error) {
    console.error('Could not read the school registry from browser storage:', error);
    return [];
  }
}

const AUDIT_LOGS_KEY = 'MOSHMIS_AUDIT_LOGS';
const MAX_AUDIT_LOGS = 2000;
const SUPPORT_TICKETS_KEY = 'MOSHMIS_SUPPORT_TICKETS';
const SUPPORT_TICKET_STATUSES = ['open', 'in_progress', 'waiting_school', 'resolved', 'closed'];
const SUPPORT_TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

function getAuditLogs() {
  try {
    const logs = JSON.parse(localStorage.getItem(AUDIT_LOGS_KEY) || '[]');
    return Array.isArray(logs) ? logs : [];
  } catch { return []; }
}

function getSupportTickets() {
  try {
    const tickets = JSON.parse(localStorage.getItem(SUPPORT_TICKETS_KEY) || '[]');
    return Array.isArray(tickets) ? tickets : [];
  } catch {
    return [];
  }
}

function createSupportTicket({ subject, category, priority, message }) {
  const auth = getAuthentication();
  if (!['school', 'school_parent'].includes(auth?.role) || !auth.schoolId) {
    showToast('Sign in to a school account to submit a support ticket.', 'error');
    return null;
  }
  const school = getSchoolById(auth.schoolId);
  if (!school) {
    showToast('The school account for this support ticket could not be found.', 'error');
    return null;
  }
  const cleanSubject = String(subject || '').trim();
  const cleanMessage = String(message || '').trim();
  const allowedCategories = ['account_access', 'students', 'marks_reports', 'payments', 'technical', 'other'];
  if (!cleanSubject || cleanSubject.length > 120 || !cleanMessage || cleanMessage.length > 4000 ||
      !allowedCategories.includes(category) || !SUPPORT_TICKET_PRIORITIES.includes(priority)) {
    showToast('Enter a subject, valid category and priority, and a message of up to 4,000 characters.', 'error');
    return null;
  }
  const departmentUser = (school.users || []).find(user => String(user.id) === String(auth.userId));
  const ticket = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    schoolId: String(school.id),
    schoolName: school.name || 'School',
    requester: departmentUser?.name || school.name || 'School account',
    requesterRole: auth.role === 'school_parent' ? 'School account' : auth.userRole || 'School user',
    requesterId: String(auth.userId || school.id),
    subject: cleanSubject,
    category,
    priority,
    description: cleanMessage,
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: []
  };
  const tickets = getSupportTickets();
  tickets.push(ticket);
  localStorage.setItem(SUPPORT_TICKETS_KEY, JSON.stringify(tickets));
  recordAuditEvent(`Support ticket created: ${ticket.subject}`, 'Support Tickets', ticket.schoolName);
  return ticket;
}

function addSupportTicketReply(ticketId, message) {
  const auth = getAuthentication();
  if (!['admin', 'school', 'school_parent'].includes(auth?.role)) {
    showToast('Sign in with an authorized account to reply to a support ticket.', 'error');
    return false;
  }
  const cleanMessage = String(message || '').trim();
  if (!cleanMessage || cleanMessage.length > 4000) {
    showToast('Enter a reply of up to 4,000 characters.', 'error');
    return false;
  }
  const tickets = getSupportTickets();
  const ticket = tickets.find(item => String(item.id) === String(ticketId));
  if (!ticket) {
    showToast('The selected support ticket could not be found.', 'error');
    return false;
  }
  if (auth.role !== 'admin' && String(ticket.schoolId) !== String(auth.schoolId)) {
    showToast('You can only reply to tickets submitted by your school.', 'error');
    return false;
  }
  if (!Array.isArray(ticket.messages)) ticket.messages = [];
  const school = auth.role === 'admin' ? null : getSchoolById(auth.schoolId);
  const departmentUser = school?.users?.find(user => String(user.id) === String(auth.userId));
  ticket.messages.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    author: auth.role === 'admin'
      ? ADMIN_CREDENTIAL.name
      : departmentUser?.name || school?.name || 'School user',
    authorRole: auth.role === 'admin' ? 'System Owner' : auth.role === 'school_parent' ? 'School account' : auth.userRole || 'School user',
    message: cleanMessage,
    createdAt: new Date().toISOString()
  });
  if (auth.role === 'admin' && !['resolved', 'closed'].includes(ticket.status)) {
    ticket.status = 'waiting_school';
  } else if (auth.role !== 'admin' && ticket.status !== 'open') {
    ticket.status = 'open';
  }
  ticket.updatedAt = new Date().toISOString();
  localStorage.setItem(SUPPORT_TICKETS_KEY, JSON.stringify(tickets));
  recordAuditEvent(`Support ticket reply added: ${ticket.subject}`, 'Support Tickets', ticket.schoolName);
  return true;
}

function updateSupportTicket(ticketId, updates = {}) {
  if (getAuthentication()?.role !== 'admin') {
    showToast('Only the System Owner can manage support tickets.', 'error');
    return false;
  }
  const tickets = getSupportTickets();
  const ticket = tickets.find(item => String(item.id) === String(ticketId));
  if (!ticket) {
    showToast('The selected support ticket could not be found.', 'error');
    return false;
  }
  if (updates.status !== undefined && !SUPPORT_TICKET_STATUSES.includes(updates.status)) {
    showToast('Choose a valid support ticket status.', 'error');
    return false;
  }
  if (updates.priority !== undefined && !SUPPORT_TICKET_PRIORITIES.includes(updates.priority)) {
    showToast('Choose a valid support ticket priority.', 'error');
    return false;
  }
  const changed = (updates.status !== undefined && updates.status !== ticket.status) ||
    (updates.priority !== undefined && updates.priority !== ticket.priority);
  if (!changed) return true;
  if (updates.status !== undefined) ticket.status = updates.status;
  if (updates.priority !== undefined) ticket.priority = updates.priority;
  ticket.updatedAt = new Date().toISOString();
  localStorage.setItem(SUPPORT_TICKETS_KEY, JSON.stringify(tickets));
  recordAuditEvent(`Support ticket updated: ${ticket.subject}`, 'Support Tickets', ticket.schoolName);
  return true;
}

function deleteSupportTicket(ticketId) {
  if (getAuthentication()?.role !== 'admin') {
    showToast('Only the System Owner can delete support tickets.', 'error');
    return false;
  }
  const tickets = getSupportTickets();
  const ticket = tickets.find(item => String(item.id) === String(ticketId));
  if (!ticket) {
    showToast('The selected support ticket could not be found.', 'error');
    return false;
  }
  localStorage.setItem(SUPPORT_TICKETS_KEY, JSON.stringify(
    tickets.filter(item => String(item.id) !== String(ticketId))
  ));
  recordAuditEvent(`Support ticket deleted: ${ticket.subject}`, 'Support Tickets', ticket.schoolName);
  return true;
}

const SYSTEM_ANNOUNCEMENTS_KEY = 'MOSHMIS_SYSTEM_ANNOUNCEMENTS';
const SYSTEM_ANNOUNCEMENT_DISMISSALS_KEY = 'MOSHMIS_ANNOUNCEMENT_DISMISSALS';
const SYSTEM_ANNOUNCEMENT_DELETIONS_KEY = 'MOSHMIS_ANNOUNCEMENT_DELETIONS';
const OWNER_PAYMENT_NOTIFICATION_DELETIONS_KEY = 'MOSHMIS_OWNER_PAYMENT_NOTIFICATION_DELETIONS';
let selectedPaymentHistoryKeys = new Set();

function getSystemAnnouncements() {
  try {
    const announcements = JSON.parse(localStorage.getItem(SYSTEM_ANNOUNCEMENTS_KEY) || '[]');
    return Array.isArray(announcements) ? announcements : [];
  } catch { return []; }
}

function isSystemAnnouncementActive(announcement, now = Date.now()) {
  const startsAt = announcement.startsAt
    ? new Date(announcement.startsAt).getTime()
    : new Date(announcement.createdAt || 0).getTime();
  const expiresAt = announcement.expiresAt ? new Date(announcement.expiresAt).getTime() : Infinity;
  return Number.isFinite(startsAt) && !Number.isNaN(expiresAt) && startsAt <= now && now < expiresAt;
}

function saveSystemAnnouncements(announcements) {
  localStorage.setItem(SYSTEM_ANNOUNCEMENTS_KEY, JSON.stringify(announcements));
}

function isValidSystemAnnouncementImage(imageDataUrl) {
  return !imageDataUrl || /^data:image\/[a-z0-9.+-]+;base64,/i.test(imageDataUrl);
}

function getSystemAnnouncementImages(announcement) {
  const images = Array.isArray(announcement.imageDataUrls)
    ? announcement.imageDataUrls
    : announcement.imageDataUrl ? [announcement.imageDataUrl] : [];
  return images.filter(image => image && isValidSystemAnnouncementImage(image));
}

function getAnnouncementViewerKey() {
  const auth = getAuthentication();
  if (!auth) return null;
  if (auth.role === 'admin') return 'system-owner';
  return [auth.role, auth.schoolId || '', auth.userRole || '', auth.userId ?? ''].join(':');
}

function getDismissedSystemAnnouncementIds() {
  const viewerKey = getAnnouncementViewerKey();
  if (!viewerKey) return new Set();
  try {
    const dismissals = JSON.parse(localStorage.getItem(SYSTEM_ANNOUNCEMENT_DISMISSALS_KEY) || '{}');
    return new Set(Array.isArray(dismissals[viewerKey]) ? dismissals[viewerKey].map(String) : []);
  } catch { return new Set(); }
}

function getDeletedSystemAnnouncementIds() {
  const viewerKey = getAnnouncementViewerKey();
  if (!viewerKey) return new Set();
  try {
    const deletions = JSON.parse(localStorage.getItem(SYSTEM_ANNOUNCEMENT_DELETIONS_KEY) || '{}');
    return new Set(Array.isArray(deletions[viewerKey]) ? deletions[viewerKey].map(String) : []);
  } catch { return new Set(); }
}

function dismissSystemAnnouncementForViewer(announcementId) {
  const viewerKey = getAnnouncementViewerKey();
  if (!viewerKey) return false;
  try {
    const dismissals = JSON.parse(localStorage.getItem(SYSTEM_ANNOUNCEMENT_DISMISSALS_KEY) || '{}');
    const dismissedIds = new Set(Array.isArray(dismissals[viewerKey]) ? dismissals[viewerKey].map(String) : []);
    dismissedIds.add(String(announcementId));
    dismissals[viewerKey] = [...dismissedIds];
    localStorage.setItem(SYSTEM_ANNOUNCEMENT_DISMISSALS_KEY, JSON.stringify(dismissals));
  } catch { return false; }

  const card = document.getElementById(`system-announcement-${announcementId}`);
  const feed = document.getElementById('systemAnnouncementFeed');
  card?.remove();
  if (feed) {
    const remaining = feed.querySelectorAll('[data-system-announcement-card]').length;
    if (!remaining) feed.remove();
    else {
      const count = feed.querySelector('[data-announcement-count]');
      if (count) count.textContent = `${remaining} ${remaining === 1 ? 'notice' : 'notices'}`;
    }
  }
  return true;
}

function deleteSystemAnnouncementForViewer(announcementId) {
  const viewerKey = getAnnouncementViewerKey();
  if (!viewerKey) return false;
  try {
    const deletions = JSON.parse(localStorage.getItem(SYSTEM_ANNOUNCEMENT_DELETIONS_KEY) || '{}');
    const deletedIds = new Set(Array.isArray(deletions[viewerKey]) ? deletions[viewerKey].map(String) : []);
    deletedIds.add(String(announcementId));
    deletions[viewerKey] = [...deletedIds];
    localStorage.setItem(SYSTEM_ANNOUNCEMENT_DELETIONS_KEY, JSON.stringify(deletions));
  } catch { return false; }
  dismissSystemAnnouncementForViewer(announcementId);
  return true;
}

function addSystemAnnouncement({ title, message, imageDataUrl = '', imageDataUrls, startsAt, expiresAt }) {
  if (getAuthentication()?.role !== 'admin') return null;
  const images = Array.isArray(imageDataUrls) ? imageDataUrls : imageDataUrl ? [imageDataUrl] : [];
  const cleanTitle = String(title || (images.length ? 'School flyer' : '')).trim();
  const cleanMessage = String(message || '').trim();
  const startTime = new Date(startsAt).getTime();
  const expiryTime = new Date(expiresAt).getTime();
  if (!cleanTitle || (!cleanMessage && !images.length) || !Number.isFinite(startTime) || !Number.isFinite(expiryTime) || expiryTime <= startTime) return null;
  if (images.length > 8 || images.some(image => !isValidSystemAnnouncementImage(image) || !image)) return null;

  const announcement = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: cleanTitle,
    message: cleanMessage,
    imageDataUrls: images,
    imageDataUrl: images[0] || '',
    startsAt: new Date(startTime).toISOString(),
    expiresAt: new Date(expiryTime).toISOString(),
    createdAt: new Date().toISOString(),
    createdBy: ADMIN_CREDENTIAL.name
  };
  saveSystemAnnouncements([announcement, ...getSystemAnnouncements()]);
  recordAuditEvent('Announcement published', 'Announcements');
  return announcement;
}

function updateSystemAnnouncement(announcementId, updates) {
  if (getAuthentication()?.role !== 'admin') return false;
  const announcements = getSystemAnnouncements();
  const index = announcements.findIndex(item => String(item.id) === String(announcementId));
  if (index < 0) return false;

  const images = Array.isArray(updates.imageDataUrls)
    ? updates.imageDataUrls
    : updates.imageDataUrl ? [updates.imageDataUrl] : [];
  const cleanTitle = String(updates.title || (images.length ? 'School flyer' : '')).trim();
  const cleanMessage = String(updates.message || '').trim();
  const startTime = new Date(updates.startsAt).getTime();
  const expiryTime = new Date(updates.expiresAt).getTime();
  if (!cleanTitle || (!cleanMessage && !images.length) || !Number.isFinite(startTime) || !Number.isFinite(expiryTime) || expiryTime <= startTime) return false;
  if (images.length > 8 || images.some(image => !isValidSystemAnnouncementImage(image) || !image)) return false;

  announcements[index] = {
    ...announcements[index],
    title: cleanTitle,
    message: cleanMessage,
    imageDataUrls: images,
    imageDataUrl: images[0] || '',
    startsAt: new Date(startTime).toISOString(),
    expiresAt: new Date(expiryTime).toISOString(),
    updatedAt: new Date().toISOString()
  };
  saveSystemAnnouncements(announcements);
  recordAuditEvent('Announcement updated', 'Announcements');
  return true;
}

function removeSystemAnnouncement(announcementId) {
  if (getAuthentication()?.role !== 'admin') return false;
  const announcements = getSystemAnnouncements();
  const remaining = announcements.filter(item => String(item.id) !== String(announcementId));
  if (remaining.length === announcements.length) return false;
  saveSystemAnnouncements(remaining);
  recordAuditEvent('Announcement deleted', 'Announcements');
  return true;
}

function deleteAuditLogs(ids = null) {
  if (getAuthentication()?.role !== 'admin') return false;
  const logs = getAuditLogs();
  const idsToDelete = ids === null ? null : new Set(ids.map(String));
  const remainingLogs = idsToDelete
    ? logs.filter(log => !idsToDelete.has(String(log.id)))
    : [];
  const deletedCount = logs.length - remainingLogs.length;
  localStorage.setItem(AUDIT_LOGS_KEY, JSON.stringify(remainingLogs));
  return deletedCount;
}

function recordAuditEvent(action, category, schoolName = '') {
  const auth = getAuthentication();
  const school = auth?.schoolId ? getSchoolById(auth.schoolId) : null;
  const departmentUser = school?.users?.find(user => user.id === auth?.userId);
  const actor = auth?.role === 'admin'
    ? ADMIN_CREDENTIAL.name
    : departmentUser?.name || school?.name || getCurrentUserDisplay();
  const role = auth?.role === 'admin'
    ? 'System Owner'
    : auth?.userRole || auth?.role || 'Guest';
  const accountId = auth?.role === 'admin'
    ? 'system-owner'
    : String(auth?.userId || auth?.schoolId || 'unknown');
  const accountUsername = auth?.role === 'admin'
    ? auth.username || ''
    : departmentUser?.username || school?.username || '';
  const logs = getAuditLogs();

  logs.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    action,
    category,
    actor,
    role,
    accountId,
    accountUsername,
    school: schoolName || school?.name || ''
  });
  localStorage.setItem(AUDIT_LOGS_KEY, JSON.stringify(logs.slice(-MAX_AUDIT_LOGS)));
}

function saveSchoolRegistry(schools) {
  const previousSchools = loadSchoolRegistry();
  localStorage.setItem('MOSHMIS_SCHOOLS', JSON.stringify(sanitizeClientRecord(schools)));

  const previousById = new Map(previousSchools.map(school => [String(school.id), school]));
  const currentById = new Map(schools.map(school => [String(school.id), school]));
  for (const school of schools) {
    const previousSchool = previousById.get(String(school.id));
    if (!previousSchool) {
      recordAuditEvent('School registered', 'Schools', school.name);
    } else if (JSON.stringify(previousSchool) !== JSON.stringify(school)) {
      const changedArea = previousSchool.accountStatus !== school.accountStatus
        ? ['School account status updated', 'Schools']
        : JSON.stringify(previousSchool.payments || []) !== JSON.stringify(school.payments || [])
          ? ['Payment records updated', 'Payments']
          : JSON.stringify(previousSchool.staff || []) !== JSON.stringify(school.staff || [])
            ? ['Staff records updated', 'Staff']
            : JSON.stringify(previousSchool.students || []) !== JSON.stringify(school.students || [])
              ? ['Student records updated', 'Students']
              : JSON.stringify(previousSchool.marks || {}) !== JSON.stringify(school.marks || {})
                ? ['Student marks updated', 'Marks']
                : ['School settings updated', 'Schools'];
      recordAuditEvent(changedArea[0], changedArea[1], school.name);
    }
  }
  for (const school of previousSchools) {
    if (!currentById.has(String(school.id))) {
      recordAuditEvent('School account deleted', 'Schools', school.name);
    }
  }
  if (serverSessionActive) {
    const changedSchools = schools.filter(school =>
      JSON.stringify(previousById.get(String(school.id))) !== JSON.stringify(school)
    );
    changedSchools.forEach(school => {
      apiRequest(`/schools/${encodeURIComponent(school.id)}`, {
        method: 'PUT',
        body: JSON.stringify(school)
      }).then(() => {
        delete school.password;
        (school.users || []).forEach(user => delete user.password);
        localStorage.setItem('MOSHMIS_SCHOOLS', JSON.stringify(schools));
      }).catch(error => {
        console.error('Could not save school records to the database:', error);
        showToast(`Changes for ${school.name || 'the school'} could not be saved to the database. ${error.message}`, 'error');
      });
    });
    previousSchools.filter(school =>
      !schools.some(current => String(current.id) === String(school.id))
    ).forEach(school => {
      apiRequest(`/schools/${encodeURIComponent(school.id)}`, { method: 'DELETE' })
        .catch(error => {
          console.error('Could not delete the school from the database:', error);
          showToast(`The ${school.name || 'school'} account could not be deleted from the database. ${error.message}`, 'error');
        });
    });
  }
}

async function saveManagedSchool(school) {
  if (getAuthentication()?.role !== 'admin') {
    throw new Error('Only the System Owner can manage school accounts.');
  }
  if (!serverSessionActive) {
    throw new Error('The server session is unavailable. Sign in again and retry.');
  }

  const schoolId = String(school.id);
  const existingSchools = loadSchoolRegistry();
  const index = existingSchools.findIndex(item => String(item.id) === schoolId);
  if (index < 0) throw new Error('The selected school account could not be found.');

  await apiRequest(`/schools/${encodeURIComponent(schoolId)}`, {
    method: 'PUT',
    body: JSON.stringify(school)
  });

  existingSchools[index] = sanitizeClientRecord(school);
  localStorage.setItem('MOSHMIS_SCHOOLS', JSON.stringify(existingSchools));
  recordAuditEvent('School settings updated', 'Schools', school.name);
  return existingSchools[index];
}

async function deleteManagedSchool(schoolId) {
  if (getAuthentication()?.role !== 'admin') {
    throw new Error('Only the System Owner can delete school accounts.');
  }
  if (!serverSessionActive) {
    throw new Error('The server session is unavailable. Sign in again and retry.');
  }

  const id = String(schoolId);
  const schools = loadSchoolRegistry();
  const school = schools.find(item => String(item.id) === id);
  if (!school) throw new Error('The selected school account could not be found.');

  await apiRequest(`/schools/${encodeURIComponent(id)}`, { method: 'DELETE' });
  localStorage.setItem('MOSHMIS_SCHOOLS', JSON.stringify(
    sanitizeClientRecord(schools.filter(item => String(item.id) !== id))
  ));
  recordAuditEvent('School account deleted', 'Schools', school.name);
}

function getSchoolById(id) {
  return loadSchoolRegistry().find(s => String(s.id) === String(id)) || null;
}

function saveSchool(school) {
  const all = loadSchoolRegistry();
  const idx = all.findIndex(s => s.id === school.id);
  if (idx >= 0) all[idx] = school; else all.push(school);
  saveSchoolRegistry(all);
}

// ==================== SESSION ====================
const PARENT_SESSION_KEY = 'MOSHMIS_PARENT_SESSION';

function saveAuthState(role, schoolId, userRole = null, userId = null) {
  const auth = {
    role,
    schoolId: schoolId || null,
    userRole: userRole || null,
    userId: userId || null,
    timestamp: Date.now()
  };

  if (role === 'school_parent') {
    localStorage.setItem(PARENT_SESSION_KEY, JSON.stringify(auth));
  } else if (role === 'school' && schoolId) {
    const parentSession = loadAuthState();
    if (parentSession?.role === 'school_parent') {
      localStorage.setItem(PARENT_SESSION_KEY, JSON.stringify(parentSession));
    } else {
      localStorage.setItem(PARENT_SESSION_KEY, JSON.stringify({
        role: 'school_parent',
        schoolId,
        userRole: 'school_parent',
        userId: schoolId,
        timestamp: Date.now()
      }));
    }
  }

  localStorage.setItem('MOSHMIS_AUTH', JSON.stringify(auth));
  recordAuditEvent('User signed in', 'Authentication');
}

function loadAuthState() {
  try {
    const raw = localStorage.getItem('MOSHMIS_AUTH');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function loadParentSession() {
  try {
    const raw = localStorage.getItem(PARENT_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function restoreParentSession() {
  const parentSession = loadParentSession();
  if (!parentSession) return false;
  localStorage.setItem('MOSHMIS_AUTH', JSON.stringify(parentSession));
  return true;
}

function clearAuthState() {
  localStorage.removeItem('MOSHMIS_AUTH');
  localStorage.removeItem(PARENT_SESSION_KEY);
}

function getAuthentication() { return loadAuthState(); }
function isAuthenticated()   { return !!loadAuthState(); }

function getCurrentSchoolRole() {
  const auth = getAuthentication();
  return auth && auth.role === 'school' ? (auth.userRole || 'school_admin') : null;
}

function getCurrentUserDisplay() {
  const auth = getAuthentication();
  if (!auth) return 'Unknown user';
  if (auth.userRole) return auth.userRole.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  return auth.userId || auth.username || 'Unknown user';
}

const ROLE_PERMISSIONS = {
  school_admin: ['register_students', 'enroll_students', 'enter_marks', 'view_marks', 'manage_grading_scale', 'print_report_cards', 'generate_reports', 'manage_department_logins', 'manage_staff', 'manage_classes'],
  subject_teacher: ['enter_marks', 'edit_marks'],
  class_teacher: ['enter_marks', 'view_marks', 'compile_marks', 'upload_to_admin']
};

const AVAILABLE_ROLE_PERMISSIONS = [
  { id: 'register_students', label: 'Register students' },
  { id: 'enroll_students', label: 'Enroll students' },
  { id: 'enter_marks', label: 'Enter marks' },
  { id: 'edit_marks', label: 'Edit marks' },
  { id: 'view_marks', label: 'View marks' },
  { id: 'manage_grading_scale', label: 'Manage grading scale' },
  { id: 'print_report_cards', label: 'Print report cards' },
  { id: 'generate_reports', label: 'Generate reports' },
  { id: 'manage_department_logins', label: 'Manage department logins' },
  { id: 'compile_marks', label: 'Compile marks' },
  { id: 'upload_to_admin', label: 'Upload marks to school admin' },
  { id: 'manage_staff', label: 'Manage staff' },
  { id: 'manage_classes', label: 'Manage classes' }
];

function getSystemRoles() {
  const configuredRoles = getOwnerConfiguration().roleDefinitions;
  const roles = Array.isArray(configuredRoles) ? configuredRoles : [];
  const configuredById = new Map(roles.map(role => [role.id, role]));
  return Object.keys(SCHOOL_USER_ROLES).map(id => ({
    id,
    name: configuredById.get(id)?.name || SCHOOL_USER_ROLES[id],
    permissions: Array.isArray(configuredById.get(id)?.permissions)
      ? configuredById.get(id).permissions.filter(permission => AVAILABLE_ROLE_PERMISSIONS.some(item => item.id === permission))
      : [...(ROLE_PERMISSIONS[id] || [])],
    builtIn: true
  })).concat(roles.filter(role =>
    role && typeof role.id === 'string' &&
    !Object.hasOwn(SCHOOL_USER_ROLES, role.id) &&
    /^[a-z0-9_-]+$/.test(role.id) &&
    typeof role.name === 'string'
  ).map(role => ({
    id: role.id,
    name: role.name,
    permissions: Array.isArray(role.permissions)
      ? role.permissions.filter(permission => AVAILABLE_ROLE_PERMISSIONS.some(item => item.id === permission))
      : [],
    builtIn: false
  })));
}

function getSystemRoleName(role) {
  return getSystemRoles().find(item => item.id === role)?.name || SCHOOL_USER_ROLES[role] || role;
}

function saveSystemRoleDefinitions(roles) {
  if (getAuthentication()?.role !== 'admin') {
    showToast('Only the System Owner can manage roles and permissions.', 'error');
    return false;
  }
  const configuration = getOwnerConfiguration();
  configuration.roleDefinitions = roles;
  return saveOwnerConfiguration(configuration);
}

function getRolePermissions(role) {
  const definition = getSystemRoles().find(item => item.id === role);
  return [...(definition?.permissions || ROLE_PERMISSIONS[role] || [])];
}

function canAccessAction(role, action) {
  return getRolePermissions(role).includes(action);
}

function requireRolePermission(action) {
  if (canAccessAction(getCurrentSchoolRole(), action)) return true;
  const permission = AVAILABLE_ROLE_PERMISSIONS.find(item => item.id === action);
  showToast(`Your role does not have permission to ${permission?.label.toLowerCase() || 'perform this action'}.`, 'error');
  return false;
}

function getSchoolRoleNavigation(role) {
  const items = [
    { id: 'staff', icon: 'users', label: 'Staff Management', permissions: ['manage_staff'] },
    { id: 'manage-settings', icon: 'settings', label: 'Manage Settings', permissions: ['manage_department_logins'] },
    { id: 'classes', icon: 'class', label: 'Class Management', permissions: ['manage_classes'] },
    { id: 'students', icon: 'students', label: 'Students', permissions: ['register_students', 'enroll_students'] },
    { id: 'subject-marks', icon: 'marks', label: 'Edit Marks', permissions: ['edit_marks'] },
    { id: 'marks', icon: 'marks', label: 'Marks Entry', permissions: ['enter_marks'] },
    { id: 'grading', icon: 'grading', label: 'Grading Scale', permissions: ['manage_grading_scale'] },
    { id: 'submitted-mark-lists', icon: 'reports', label: 'Submitted Mark Lists', permissions: ['view_marks'] },
    { id: 'class-compile', icon: 'reports', label: 'Compile & Upload Mark List', permissions: ['compile_marks', 'upload_to_admin'], requireAll: true },
    { id: 'reports', icon: 'reports', label: 'Report Cards', permissions: ['print_report_cards', 'generate_reports'] }
  ];
  return [
    { id: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
    { id: 'support', icon: 'support', label: 'Support Tickets' },
    ...items.filter(item => {
      if (item.id === 'marks' && canAccessAction(role, 'edit_marks')) return false;
      return item.requireAll
        ? item.permissions.every(permission => canAccessAction(role, permission))
        : item.permissions.some(permission => canAccessAction(role, permission));
    })
  ];
}

function getSchoolDepartmentAccounts(school) {
  if (!school) return [];
  const before = JSON.stringify(school.users || []);
  ensureSchoolUsers(school);
  if (before !== JSON.stringify(school.users || [])) saveSchool(school);
  const departmentAccounts = school.users.map(user => ({
    id: user.id,
    accountType: user.accountType,
    name: user.name,
    role: user.role,
    username: user.username,
    status: user.status,
    password: user.password
  }));
  if (school.schoolAccount?.id) {
    return [{
      ...school.schoolAccount,
      role: 'school_admin',
      isSchoolAccount: true
    }, ...departmentAccounts];
  }
  return departmentAccounts;
}

function ensureSchoolUsers(school) {
  if (!school) return [];
  if (!Array.isArray(school.users)) school.users = [];
  const validRoleIds = new Set(getSystemRoles().map(role => role.id));
  school.users = school.users.filter(user => validRoleIds.has(user?.role));

  const baseDefaults = [
    { id: 1, accountType: 'school_admin', name: 'Admin', username: `${school.username || 'school'}-admin`, password: '', role: 'school_admin' },
    { id: 2, accountType: 'subject_teacher', name: 'Subject Teacher', username: `${school.username || 'school'}-subject`, password: '', role: 'subject_teacher' },
    { id: 3, accountType: 'class_teacher', name: 'Class Teacher', username: `${school.username || 'school'}-class`, password: '', role: 'class_teacher' }
  ];

  const map = new Map();
  school.users.forEach(user => {
    if (!user.accountType && Object.hasOwn(SCHOOL_USER_ROLES, user.role)) user.accountType = user.role;
    if (user.accountType) map.set(user.accountType, user);
  });

  baseDefaults.forEach(defaultUser => {
    if (!map.has(defaultUser.accountType)) {
      school.users.push(defaultUser);
      map.set(defaultUser.accountType, defaultUser);
    }
  });

  return school.users;
}

function findSchoolLoginUser(username, password) {
  const schools = loadSchoolRegistry();
  for (const school of schools) {
    ensureSchoolUsers(school);
    const match = school.users.find(user => user.username === username && user.password === password);
    if (match) return { school, user: match };
  }
  return null;
}

function requireAuthentication() {
  const auth = getAuthentication();
  if (!auth) {
    window.location.href = 'login.html';
    return false;
  }
  const timeoutMinutes = getSystemSettings().security.sessionTimeoutMinutes;
  if (timeoutMinutes && Number(auth.timestamp) &&
      Date.now() - Number(auth.timestamp) >= timeoutMinutes * 60 * 1000) {
    clearAuthState();
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

let sessionTimeoutMonitorId = null;

function startSessionTimeoutMonitor() {
  if (sessionTimeoutMonitorId) window.clearInterval(sessionTimeoutMonitorId);
  const auth = getAuthentication();
  if (!auth) return;

  let lastActivity = Number(auth.timestamp) || Date.now();
  let lastPersistedActivity = lastActivity;
  let lastServerActivity = lastActivity;
  const recordActivity = () => {
    lastActivity = Date.now();
    if (lastActivity - lastPersistedActivity < 30000) return;
    lastPersistedActivity = lastActivity;
    const currentAuth = getAuthentication();
    if (currentAuth) {
      currentAuth.timestamp = lastActivity;
      localStorage.setItem('MOSHMIS_AUTH', JSON.stringify(currentAuth));
      const parentSession = loadParentSession();
      if (parentSession) {
        parentSession.timestamp = lastActivity;
        localStorage.setItem(PARENT_SESSION_KEY, JSON.stringify(parentSession));
      }
    }
    if (lastActivity - lastServerActivity >= 5 * 60 * 1000) {
      apiRequest('/auth/heartbeat', { method: 'POST' }).then(() => {
        lastServerActivity = Date.now();
      }).catch(error => {
        if (error.status === 401) {
          clearAuthState();
          window.location.href = 'login.html';
          return;
        }
        console.error('Could not renew the server session:', error);
      });
    }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(eventName =>
    document.addEventListener(eventName, recordActivity, { passive: true })
  );
  sessionTimeoutMonitorId = window.setInterval(() => {
    const timeoutMinutes = getSystemSettings().security.sessionTimeoutMinutes;
    lastActivity = Math.max(lastActivity, Number(getAuthentication()?.timestamp) || 0);
    if (!timeoutMinutes || Date.now() - lastActivity < timeoutMinutes * 60 * 1000) return;
    apiRequest('/auth/logout', { method: 'POST' }).catch(error => {
      console.error('Could not revoke the expired server session:', error);
    }).finally(() => {
      clearAuthState();
      window.clearInterval(sessionTimeoutMonitorId);
      sessionTimeoutMonitorId = null;
      showToast('Your session expired due to inactivity. Please sign in again.', 'info');
      window.location.href = 'login.html';
    });
  }, 15000);
}

// Returns the school object for the currently logged-in school user
function getActiveSchool() {
  const auth = loadAuthState();
  if (!auth || !['school', 'school_parent'].includes(auth.role) || !auth.schoolId) return null;
  return getSchoolById(auth.schoolId);
}

// Persist changes to the active school's data back to registry
function saveActiveSchool(school) {
  saveSchool(school);
}

// Shorthand helpers that operate on the active school
function getActiveStaff()    { return getActiveSchool()?.staff    || []; }
function getActiveStudents() { return getActiveSchool()?.students || []; }
function getActiveMarks()    { return getActiveSchool()?.marks    || {}; }

function saveActiveData({ staff, students, marks }) {
  const school = getActiveSchool();
  if (!school) return;
  if (staff    !== undefined) school.staff    = staff;
  if (students !== undefined) school.students = students;
  if (marks    !== undefined) school.marks    = marks;
  saveSchool(school);
}

function getAccountStatus(school) {
  return school?.accountStatus || 'active';
}

function getAccountStatusLabel(status) {
  switch (status) {
    case 'suspended': return 'Suspended';
    case 'blocked': return 'Blocked';
    default: return 'Active';
  }
}

function getAccountStatusBadgeClass(status) {
  switch (status) {
    case 'suspended': return 'bg-amber-100 text-amber-700';
    case 'blocked': return 'bg-red-100 text-red-700';
    default: return 'bg-emerald-100 text-emerald-700';
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getPreferredInterfaceMode(school = null) {
  const auth = getAuthentication();
  const userKey = auth?.role === 'admin'
    ? 'system-owner'
    : auth
      ? [auth.role, auth.schoolId || '', auth.userRole || '', auth.userId ?? ''].join(':')
      : '';
  const userPreference = userKey
    ? localStorage.getItem(`MOSHMIS_USER_THEME_${encodeURIComponent(userKey)}`)
    : null;
  if (['light', 'dark', 'system'].includes(userPreference)) return userPreference;
  if (auth?.role === 'admin') {
    const storedMode = localStorage.getItem('MOSHMIS_INTERFACE_MODE');
    return ['light', 'dark', 'system'].includes(storedMode) ? storedMode : 'system';
  }
  if (school && ['light', 'dark', 'system'].includes(school.interfaceMode)) return school.interfaceMode;
  return 'system';
}

function getResolvedInterfaceMode(mode) {
  if (mode === 'dark' || mode === 'light') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyInterfaceMode(mode = null) {
  const resolvedMode = getResolvedInterfaceMode(mode || getPreferredInterfaceMode(getActiveSchool()));
  document.documentElement.setAttribute('data-theme', resolvedMode);
  document.body.classList.toggle('dark', resolvedMode === 'dark');
  document.body.style.backgroundColor = resolvedMode === 'dark' ? '#020617' : '#f8fafc';
  document.body.style.color = resolvedMode === 'dark' ? '#f8fafc' : '#0f172a';

  let style = document.getElementById('moshmis-theme-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'moshmis-theme-style';
    document.head.appendChild(style);
  }

  style.textContent = `
    :root {
      color-scheme: ${resolvedMode};
      --app-bg: ${resolvedMode === 'dark' ? '#020617' : '#f8fafc'};
      --app-surface: ${resolvedMode === 'dark' ? '#0f172a' : '#ffffff'};
      --app-surface-soft: ${resolvedMode === 'dark' ? '#111827' : '#f8fafc'};
      --app-text: ${resolvedMode === 'dark' ? '#f8fafc' : '#0f172a'};
      --app-muted: ${resolvedMode === 'dark' ? '#94a3b8' : '#475569'};
      --app-border: ${resolvedMode === 'dark' ? '#334155' : '#e2e8f0'};
    }
    html, body {
      background-color: var(--app-bg) !important;
      color: var(--app-text) !important;
      transition: background-color .2s ease, color .2s ease;
    }
    body .bg-white, body .bg-gray-50, body .bg-gray-100, body .bg-gray-200, body .bg-slate-50, body .bg-slate-100, body .bg-slate-200, body .bg-zinc-50, body .bg-zinc-100 {
      background-color: var(--app-surface) !important;
      color: var(--app-text) !important;
    }
    body .border-slate-200, body .border-slate-100, body .border-slate-300, body .border-slate-400, body .border-gray-200, body .border-gray-300, body .border-gray-400 {
      border-color: var(--app-border) !important;
    }
    body .text-slate-600, body .text-slate-500, body .text-slate-400, body .text-slate-700, body .text-gray-600, body .text-gray-500, body .text-gray-400, body .text-gray-700 {
      color: var(--app-muted) !important;
    }
    body .text-slate-800, body .text-slate-900, body .text-gray-800, body .text-gray-900 {
      color: var(--app-text) !important;
    }
    body input, body select, body textarea {
      background-color: var(--app-surface) !important;
      color: var(--app-text) !important;
      border-color: var(--app-border) !important;
    }
  `;
}

function persistInterfaceMode(mode, schoolId = null) {
  if (schoolId && getAuthentication()?.role !== 'admin') {
    const school = getSchoolById(schoolId);
    if (!school) return;
  }
  setUserThemePreference(mode);
}

function setUserAccountStatus(schoolId, status) {
  const schools = loadSchoolRegistry();
  const school = schools.find(s => String(s.id) === String(schoolId));
  if (!school) return;
  school.accountStatus = status;
  saveSchoolRegistry(schools);
  showToast(`Account ${getAccountStatusLabel(status).toLowerCase()} successfully.`, 'success');
  const returnToUsersRoles = getAuthentication()?.role === 'admin' &&
    document.getElementById?.('pageTitle')?.textContent === 'Users & Roles';
  const returnToSchoolAdmins = getAuthentication()?.role === 'admin' &&
    document.getElementById?.('pageTitle')?.textContent === 'School Administrators';
  closeModal();
  if (returnToUsersRoles) renderUsersRoles();
  else if (returnToSchoolAdmins) renderSchoolAdmins();
  else renderDashboard();
}

function deleteUserAccount(schoolId) {
  const school = getSchoolById(schoolId);
  if (!school) return;
  const confirmed = window.confirm(`Delete account for ${school.name}? This action cannot be undone.`);
  if (!confirmed) return;

  const schools = loadSchoolRegistry().filter(s => String(s.id) !== String(schoolId));
  saveSchoolRegistry(schools);

  const auth = getAuthentication();
  if (auth?.role === 'school' && String(auth.schoolId) === String(schoolId)) {
    clearAuthState();
    showToast('Your account was deleted. Please contact the administrator.', 'error');
    setTimeout(() => { window.location.href = 'login.html'; }, 1000);
    return;
  }

  showToast('Account deleted successfully.', 'success');
  const returnToSchoolAdmins = auth?.role === 'admin' &&
    document.getElementById?.('pageTitle')?.textContent === 'School Administrators';
  closeModal();
  if (returnToSchoolAdmins) renderSchoolAdmins();
  else renderDashboard();
}

function openAccountSettingsModal(schoolId = null) {
  const auth = getAuthentication();
  const targetSchoolId = schoolId || auth?.schoolId || null;
  const school = targetSchoolId ? getSchoolById(targetSchoolId) : null;
  if (!school) return;

  const canManageStatus = auth?.role === 'admin';
  const schoolIdArgument = escapeHtml(JSON.stringify(String(school.id)));
  showModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <div>
          <h3 class="text-xl font-bold text-slate-800">Account Settings</h3>
          <p class="text-sm text-slate-500">Manage ${escapeHtml(school.name)} account details.</p>
        </div>
        <button type="button" onclick="closeModal()" class="text-slate-400 hover:text-slate-600">✕</button>
      </div>

      ${canManageStatus ? `
        <div class="flex flex-wrap gap-2 mb-5">
          <button type="button" onclick="setUserAccountStatus(${schoolIdArgument}, 'active')" class="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm">Activate</button>
          <button type="button" onclick="setUserAccountStatus(${schoolIdArgument}, 'suspended')" class="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm">Suspend</button>
          <button type="button" onclick="setUserAccountStatus(${schoolIdArgument}, 'blocked')" class="px-3 py-2 rounded-lg bg-red-600 text-white text-sm">Block</button>
          <button type="button" onclick="deleteUserAccount(${schoolIdArgument})" class="px-3 py-2 rounded-lg bg-slate-800 text-white text-sm">Delete Account</button>
        </div>` : ''}

      ${!canManageStatus ? `
        <div class="flex flex-wrap gap-2 mb-4">
          <button type="button" onclick="saveAccountSettingsFromAction('password', ${schoolIdArgument})" class="px-4 py-2 rounded-lg bg-sky-600 text-white text-sm">Change Password</button>
          <button type="button" onclick="saveAccountSettingsFromAction('theme', ${schoolIdArgument})" class="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm">Theme</button>
        </div>` : ''}

      <form id="accountSettingsForm" onsubmit="saveAccountSettings(event, ${schoolIdArgument})" class="space-y-4">
        <div class="grid md:grid-cols-2 gap-4">
          ${canManageStatus ? `
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">School Name</label>
              <input name="name" value="${escapeHtml(school.name)}" class="w-full px-3 py-2 border rounded-lg" required>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Username</label>
              <input name="username" value="${escapeHtml(school.username)}" class="w-full px-3 py-2 border rounded-lg" required>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">District</label>
              <input name="district" value="${escapeHtml(school.district)}" class="w-full px-3 py-2 border rounded-lg">
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Head Teacher</label>
              <input name="headTeacher" value="${escapeHtml(school.headTeacher || '')}" class="w-full px-3 py-2 border rounded-lg">
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input name="email" type="email" value="${escapeHtml(school.email || '')}" class="w-full px-3 py-2 border rounded-lg">
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Telephone</label>
              <input name="tel" value="${escapeHtml(school.tel || '')}" class="w-full px-3 py-2 border rounded-lg">
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Address</label>
              <input name="address" value="${escapeHtml(school.address || '')}" class="w-full px-3 py-2 border rounded-lg">
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Account Status</label>
              <select name="accountStatus" class="w-full px-3 py-2 border rounded-lg">
                <option value="active" ${getAccountStatus(school) === 'active' ? 'selected' : ''}>Active</option>
                <option value="suspended" ${getAccountStatus(school) === 'suspended' ? 'selected' : ''}>Suspended</option>
                <option value="blocked" ${getAccountStatus(school) === 'blocked' ? 'selected' : ''}>Blocked</option>
              </select>
            </div>` : ''}
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">New Password</label>
            <input name="password" type="password" placeholder="Leave blank to keep current password" class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Interface Mode</label>
            <select name="interfaceMode" class="w-full px-3 py-2 border rounded-lg">
              <option value="light" ${getPreferredInterfaceMode(school) === 'light' ? 'selected' : ''}>Light</option>
              <option value="dark" ${getPreferredInterfaceMode(school) === 'dark' ? 'selected' : ''}>Dark</option>
              <option value="system" ${getPreferredInterfaceMode(school) === 'system' ? 'selected' : ''}>System / Auto</option>
            </select>
          </div>
        </div>

        <div class="flex justify-end gap-3 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 rounded-lg border border-slate-300 text-slate-700">Cancel</button>
          <button type="submit" class="px-4 py-2 rounded-lg bg-sky-600 text-white">Save Changes</button>
        </div>
      </form>
    </div>
  `);
}

function saveAccountSettings(e, schoolId) {
  e.preventDefault();
  const form = e.target;
  const school = getSchoolById(schoolId);
  if (!school) return;

  const auth = getAuthentication();
  const returnToUsersRoles = auth?.role === 'admin' &&
    document.getElementById?.('pageTitle')?.textContent === 'Users & Roles';
  const returnToSchoolAdmins = auth?.role === 'admin' &&
    document.getElementById?.('pageTitle')?.textContent === 'School Administrators';
  const usernameInput = form.username;
  if (usernameInput && usernameInput.value.trim()) {
    const newUsername = usernameInput.value.trim();
    const existing = loadSchoolRegistry().filter(s => String(s.id) !== String(schoolId));
    if (existing.some(s => s.username === newUsername)) {
      showToast('That username is already taken.', 'error');
      return;
    }
    school.username = newUsername;
  }

  if (form.name) school.name = form.name.value.trim();
  if (form.district) school.district = form.district.value.trim();
  if (form.headTeacher) school.headTeacher = form.headTeacher.value.trim();
  if (form.email) school.email = form.email.value.trim();
  if (form.tel) school.tel = form.tel.value.trim();
  if (form.address) school.address = form.address.value.trim();
  if (form.password && form.password.value.trim()) {
    if (form.password.value.length < getMinimumPasswordLength()) {
      showToast(`Password must be at least ${getMinimumPasswordLength()} characters long.`, 'error');
      return;
    }
    school.password = form.password.value;
  }

  if (auth?.role === 'admin' && form.accountStatus) {
    school.accountStatus = form.accountStatus.value;
  }

  if (form.interfaceMode) {
    persistInterfaceMode(form.interfaceMode.value, school.id);
    applyInterfaceMode(form.interfaceMode.value);
  }

  saveSchool(school);
  showToast('Account settings updated successfully.', 'success');
  closeModal();
  if (returnToUsersRoles) renderUsersRoles();
  else if (returnToSchoolAdmins) renderSchoolAdmins();
  else renderDashboard();
}

function saveAccountSettingsFromAction(action, schoolId) {
  const form = document.getElementById('accountSettingsForm');
  const school = getSchoolById(schoolId);
  if (!form || !school) return;

  if (action === 'password') {
    const passwordInput = form.querySelector('[name="password"]');
    if (!passwordInput || !passwordInput.value.trim()) {
      showToast('Please enter a new password.', 'error');
      return;
    }
    if (passwordInput.value.length < getMinimumPasswordLength()) {
      showToast(`Password must be at least ${getMinimumPasswordLength()} characters long.`, 'error');
      return;
    }
    school.password = passwordInput.value;
    saveSchool(school);
    showToast('Password updated successfully.', 'success');
    closeModal();
    renderDashboard();
    return;
  }

  if (action === 'theme') {
    const modeInput = form.querySelector('[name="interfaceMode"]');
    if (!modeInput) return;
    persistInterfaceMode(modeInput.value, school.id);
    applyInterfaceMode(modeInput.value);
    saveSchool(school);
    showToast('Theme updated successfully.', 'success');
    closeModal();
    renderDashboard();
  }
}

function openAdminAccountSettingsModal() {
  const auth = getAuthentication();
  if (auth?.role !== 'admin') return;

  showModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <div>
          <h3 class="text-xl font-bold text-slate-800">Admin Account Settings</h3>
          <p class="text-sm text-slate-500">Manage your interface theme. Account credentials are managed by the server.</p>
        </div>
        <button type="button" onclick="closeModal()" class="text-slate-400 hover:text-slate-600">✕</button>
      </div>
      <form onsubmit="saveAdminAccountSettings(event)" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Username</label>
          <input name="username" value="${escapeHtml(getAuthentication()?.username || '')}" minlength="3" maxlength="80" autocomplete="username" class="w-full px-3 py-2 border rounded-lg" required>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
          <input name="currentPassword" type="password" autocomplete="current-password" class="w-full px-3 py-2 border rounded-lg" required>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">New Password</label>
          <input name="password" type="password" minlength="10" autocomplete="new-password" placeholder="Leave blank to keep current password" class="w-full px-3 py-2 border rounded-lg">
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Interface Mode</label>
          <select name="interfaceMode" class="w-full px-3 py-2 border rounded-lg">
            <option value="light" ${getPreferredInterfaceMode() === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${getPreferredInterfaceMode() === 'dark' ? 'selected' : ''}>Dark</option>
            <option value="system" ${getPreferredInterfaceMode() === 'system' ? 'selected' : ''}>System / Auto</option>
          </select>
        </div>
        <div class="flex justify-end gap-3 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 rounded-lg border border-slate-300 text-slate-700">Cancel</button>
          <button type="submit" class="px-4 py-2 rounded-lg bg-sky-600 text-white">Save Changes</button>
        </div>
      </form>
    </div>
  `);
}

async function saveAdminAccountSettings(e) {
  e.preventDefault();
  const form = e.target;
  try {
    const result = await apiRequest('/auth/credentials', {
      method: 'POST',
      body: JSON.stringify({
        username: form.username.value.trim(),
        currentPassword: form.currentPassword.value,
        newPassword: form.password.value
      })
    });
    const auth = getAuthentication();
    if (auth) {
      auth.username = result.username;
      localStorage.setItem('MOSHMIS_AUTH', JSON.stringify(auth));
    }
    persistInterfaceMode(form.interfaceMode.value);
    applyInterfaceMode(form.interfaceMode.value);
    showToast('Account credentials and interface settings updated.', 'success');
    closeModal();
  } catch (error) {
    showToast(`Could not update account credentials: ${error.message}`, 'error');
  }
}

// ==================== AUTH ====================
function isSchoolLoginUsernameAvailable(username, targetSchoolId, targetRole, targetUserId = null) {
  const normalizedUsername = username.trim().toLowerCase();
  if (!normalizedUsername) return false;

  for (const school of loadSchoolRegistry()) {
    const isTargetSchool = String(school.id) === String(targetSchoolId);
    if (String(school.username || '').toLowerCase() === normalizedUsername &&
        !(isTargetSchool && (targetRole === 'school' || targetUserId === String(school.schoolAccount?.id)))) {
      return false;
    }
    if (!(isTargetSchool && targetRole === 'school') &&
        String(school.username || '').toLowerCase() === normalizedUsername) {
      return false;
    }

    for (const user of ensureSchoolUsers(school)) {
      if (isTargetSchool && (
        (targetUserId !== null && String(user.id) === String(targetUserId)) ||
        (targetUserId === null && targetRole === 'school' && user.role === 'school_admin')
      )) continue;
      if (String(user.username || '').toLowerCase() === normalizedUsername) return false;
    }
  }
  return true;
}

function openAdminLoginResetModal(schoolId, selectedUserId = null) {
  if (getAuthentication()?.role !== 'admin') {
    showToast('Only the System Owner can reset user logins.', 'error');
    return;
  }

  const school = getSchoolById(schoolId);
  if (!school) {
    showToast('The selected school account could not be found.', 'error');
    return;
  }

  const accounts = getSchoolDepartmentAccounts(school);
  const selectedAccount = accounts.find(account => String(account.id) === String(selectedUserId)) || accounts[0];
  const schoolIdArgument = escapeHtml(JSON.stringify(String(school.id)));
  showModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <div>
          <h3 class="text-xl font-bold text-slate-800">Reset User Login</h3>
          <p class="text-sm text-slate-500">${escapeHtml(school.name)} — set new login details for an account.</p>
        </div>
        <button type="button" onclick="closeModal()" class="text-slate-400 hover:text-slate-600">✕</button>
      </div>
      <form onsubmit="adminResetSchoolCredentials(event, ${schoolIdArgument})" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Account</label>
          <select name="accountRole" onchange="const option=this.selectedOptions[0]; this.form.elements.namedItem('currentUsername').value=''; this.form.elements.namedItem('username').value=option.dataset.username;" class="w-full px-3 py-2 border border-slate-300 rounded-lg" required>
            ${accounts.map(account => {
                const label = account.isSchoolAccount || account.accountType === 'school_admin'
                  ? 'School Account / Admin'
                  : getSystemRoleName(account.role);
              return `<option value="${escapeHtml(String(account.id))}" data-username="${escapeHtml(account.username || '')}" ${String(account.id) === String(selectedAccount?.id) ? 'selected' : ''}>${escapeHtml(account.name || label)} (${escapeHtml(label)}) — current username: ${escapeHtml(account.username)}</option>`;
            }).join('')}
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Current Username</label>
          <input name="currentUsername" type="text" value="" required autocomplete="username" class="w-full px-3 py-2 border border-slate-300 rounded-lg">
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">New Username</label>
          <input name="username" type="text" value="${escapeHtml(selectedAccount?.username || '')}" required autocomplete="off" class="w-full px-3 py-2 border border-slate-300 rounded-lg">
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">New Password</label>
          <input name="password" type="password" required minlength="${getMinimumPasswordLength()}" autocomplete="new-password" class="w-full px-3 py-2 border border-slate-300 rounded-lg">
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
          <input name="confirmPassword" type="password" required minlength="${getMinimumPasswordLength()}" autocomplete="new-password" class="w-full px-3 py-2 border border-slate-300 rounded-lg">
        </div>
        <div class="flex justify-end gap-3 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 rounded-lg border border-slate-300 text-slate-700">Cancel</button>
          <button type="submit" class="px-4 py-2 rounded-lg bg-sky-600 text-white">Save New Login</button>
        </div>
      </form>
    </div>
  `);
}

function adminResetSchoolCredentials(e, schoolId) {
  e.preventDefault();
  if (getAuthentication()?.role !== 'admin') {
    showToast('Only the System Owner can reset user logins.', 'error');
    return false;
  }

  const form = e.target;
  const accountId = form.accountRole.value;
  const currentUsername = form.elements.namedItem('currentUsername').value.trim();
  const username = form.username.value.trim();
  const password = form.password.value;
  const confirmPassword = form.elements.namedItem('confirmPassword').value;
  const schools = loadSchoolRegistry();
  const school = schools.find(item => String(item.id) === String(schoolId));

  if (!school) {
    showToast('The selected school account could not be found.', 'error');
    return false;
  }
  if (password.length < getMinimumPasswordLength()) {
    showToast(`Password must be at least ${getMinimumPasswordLength()} characters long.`, 'error');
    return false;
  }
  if (password !== confirmPassword) {
    showToast('The new passwords do not match.', 'error');
    return false;
  }
  const accounts = getSchoolDepartmentAccounts(school);
  const account = accounts.find(item => String(item.id) === String(accountId));
  if (!account || (!account.isSchoolAccount && !getSystemRoles().some(item => item.id === account.role))) {
    showToast('Choose a valid user account.', 'error');
    return false;
  }
  if (!currentUsername || currentUsername.toLowerCase() !== String(account.username || '').toLowerCase()) {
    showToast('The current username does not match the selected account.', 'error');
    return false;
  }
  const accountRecord = account.isSchoolAccount
    ? school.schoolAccount
    : ensureSchoolUsers(school).find(item => String(item.id) === String(account.id));
  if (!accountRecord) {
    showToast('The selected user account could not be found.', 'error');
    return false;
  }
  const isSchoolAdminAccount = account.isSchoolAccount ||
    account.accountType === 'school_admin' || account.role === 'school_admin';
  const targetRole = isSchoolAdminAccount ? 'school' : account.role;
  if (!isSchoolLoginUsernameAvailable(username, school.id, targetRole, String(account.id))) {
    showToast('That username is already taken or reserved. Choose another.', 'error');
    return false;
  }

  if (!serverSessionActive) {
    showToast('Connect to the server before changing school user logins.', 'error');
    return false;
  }

  apiRequest(`/schools/${encodeURIComponent(school.id)}/users/${encodeURIComponent(account.id)}/credentials`, {
    method: 'PUT',
    body: JSON.stringify({ currentUsername, username, password })
  }).then(({ user }) => {
    if (account.isSchoolAccount) {
      accountRecord.username = user.username;
      accountRecord.status = user.status;
      school.username = user.username;
    } else {
      accountRecord.username = user.username;
      accountRecord.status = user.status;
    }
    delete accountRecord.password;
    localStorage.setItem('MOSHMIS_SCHOOLS', JSON.stringify(sanitizeClientRecord(schools)));
    recordAuditEvent('User login reset by System Owner', 'Authentication', school.name);
    finishOwnerCredentialReset();
  }).catch(error => {
    console.error('Could not reset the school user login:', error);
    showToast(`Could not save the new login: ${error.message}`, 'error');
  });
  return true;
}

async function resetDepartmentAccountPassword(school, account, currentUsername, newPassword) {
  if (!serverSessionActive) {
    throw new Error('The server session is unavailable. Sign in again and retry.');
  }

  const schoolId = String(school.id);
  const userId = String(account.id);
  const { user } = await apiRequest(
    `/schools/${encodeURIComponent(schoolId)}/users/${encodeURIComponent(userId)}/password`,
    {
      method: 'PUT',
      body: JSON.stringify({ currentUsername, newPassword })
    }
  );
  if (String(user.id) !== userId) {
    throw new Error('The server returned a different account than the one selected.');
  }

  account.username = user.username;
  account.status = user.status;
  delete account.password;
  const schools = loadSchoolRegistry();
  const savedSchool = schools.find(item => String(item.id) === schoolId);
  const savedAccount = savedSchool?.users?.find(item => String(item.id) === userId);
  if (savedAccount) {
    savedAccount.username = user.username;
    savedAccount.status = user.status;
    delete savedAccount.password;
  }
  localStorage.setItem('MOSHMIS_SCHOOLS', JSON.stringify(sanitizeClientRecord(schools)));
  recordAuditEvent('Department account password reset', 'Authentication', school.name);
  return user;
}

async function getSchoolAdminSetupStatus() {
  if (getAuthentication()?.role !== 'school_parent' || !serverSessionActive) {
    return { required: false };
  }
  return apiRequest('/schools/admin-setup');
}

async function completeFirstSchoolAdminSetup(username, password) {
  if (getAuthentication()?.role !== 'school_parent' || !serverSessionActive) {
    throw new Error('Sign in with the school registration login before setting up the School Administrator account.');
  }
  const { user } = await apiRequest('/schools/admin-setup', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  serverSessionActive = true;
  saveAuthState(user.role, user.schoolId, user.userRole, user.id);
  const auth = loadAuthState();
  if (auth) {
    auth.username = user.username;
    localStorage.setItem('MOSHMIS_AUTH', JSON.stringify(auth));
  }
  await refreshSchoolsFromServer();
  window.location.href = 'dashboard.html';
  return user;
}

function finishOwnerCredentialReset() {
  const returnToUsersRoles = document.getElementById?.('pageTitle')?.textContent === 'Users & Roles';
  const returnToSchoolAdmins = document.getElementById?.('pageTitle')?.textContent === 'School Administrators';
  closeModal();
  if (returnToUsersRoles) renderUsersRoles();
  else if (returnToSchoolAdmins) renderSchoolAdmins();
  else renderSchools();
  showToast('New login details saved successfully.', 'success');
}

function openPasswordRecoveryModal() {
  showModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-5">
        <div>
          <h3 class="text-xl font-bold text-slate-800">Password recovery</h3>
          <p class="text-sm text-slate-500">For security, password resets require verification by the System Owner.</p>
        </div>
        <button type="button" onclick="closeModal()" class="text-slate-400 hover:text-slate-600">✕</button>
      </div>
      <p class="text-sm text-slate-600">Contact <a class="text-sky-600 underline" href="mailto:info@kimsitsolutions.ug">info@kimsitsolutions.ug</a> and provide your school name and registered email. Do not send your current password.</p>
      <div class="flex justify-end pt-5">
        <button type="button" onclick="closeModal()" class="px-4 py-2 rounded-lg bg-sky-600 text-white">Close</button>
      </div>
    </div>
  `);
}

function handlePasswordRecovery(e) {
  e?.preventDefault?.();
  showToast('Contact the System Owner to verify your identity before resetting your password.', 'info');
  return false;
}

function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername')?.value.trim();
  const password = document.getElementById('loginPassword')?.value;
  apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  }).then(async ({ user, school }) => {
    serverSessionActive = true;
    if (school) localStorage.setItem('MOSHMIS_SCHOOLS', JSON.stringify([school]));
    saveAuthState(user.role, user.schoolId, user.userRole, user.id);
    const auth = loadAuthState();
    if (auth) {
      auth.username = user.username;
      localStorage.setItem('MOSHMIS_AUTH', JSON.stringify(auth));
    }
    if (user.role === 'admin') {
      showToast('Welcome back, System Owner!', 'success');
      initAdminNotifications();
    } else {
      showToast(`Welcome back to ${school?.name || 'your school'}.`, 'success');
    }
    setTimeout(() => { window.location.href = 'dashboard.html'; }, 500);
  }).catch(error => {
    showToast(error.status === 401
      ? 'Invalid credentials or inactive account.'
      : `Unable to sign in: ${error.message}`, 'error');
  });
}

function loginDepartmentAccount(username, password) {
  const school = getActiveSchool();
  if (!school) return false;
  const account = (school.users || []).find(user =>
    user.username === username && user.password === password
  );
  if (!account) return false;
  saveAuthState('school', school.id, account.role, account.id);
  return account;
}

function handleDepartmentLogin(e) {
  e.preventDefault();
  const username = e.target.username.value.trim();
  const password = e.target.password.value;
  const schoolId = getActiveSchool()?.id;
  apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, schoolId })
  }).then(({ user }) => {
    const school = getActiveSchool();
    if (user.role !== 'school' || String(user.schoolId) !== String(school?.id)) {
      throw new Error('That login is not a department account for this school.');
    }
    serverSessionActive = true;
    saveAuthState('school', user.schoolId, user.userRole, user.id);
    const auth = loadAuthState();
    if (auth) {
      auth.username = user.username;
      localStorage.setItem('MOSHMIS_AUTH', JSON.stringify(auth));
    }
    const welcomeName = user.userRole.replace(/_/g, ' ');
    showToast(`Welcome, ${welcomeName}!`, 'success');
    setTimeout(() => { window.location.href = 'dashboard.html'; }, 500);
  }).catch(error => {
    showToast(`Department sign-in failed: ${error.message}`, 'error');
  });
}

function logout() {
  const auth = getAuthentication();

  if (auth?.role === 'school' && loadParentSession()) {
    apiRequest('/auth/restore-school', { method: 'POST' })
      .then(() => {
        serverSessionActive = true;
        restoreParentSession();
        showToast('Department session logged out. School account is still signed in.', 'success');
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 500);
      })
      .catch(error => {
        console.error('Could not restore the school account session:', error);
        showToast(`Could not restore the school account: ${error.message}`, 'error');
      });
    return;
  }

  apiRequest('/auth/logout', { method: 'POST' })
    .catch(error => console.error('Could not revoke the server session:', error))
    .finally(() => {
      serverSessionActive = false;
      clearAuthState();
      showToast('Logged out successfully', 'success');
      setTimeout(() => { window.location.href = 'index.html'; }, 500);
    });
}

// ==================== REGISTRATION ====================
async function handleRegister(e) {
  e.preventDefault();
  const form = e.target;

  const username = form.regUsername.value.trim();
  const password = form.regPassword.value;
  const confirm  = form.regConfirm.value;

  if (password !== confirm) {
    showToast('Passwords do not match.', 'error'); return;
  }
  if (password.length < 10) {
    showToast('Password must be at least 10 characters.', 'error'); return;
  }

  try {
    const { school } = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        schoolName: form.schoolName.value.trim(),
        district: form.district.value.trim(),
        address: form.address.value.trim(),
        telephone: form.tel.value.trim(),
        email: form.email.value.trim(),
        motto: form.motto.value.trim() || 'Strive for Excellence',
        headTeacher: form.headTeacher.value.trim(),
        logoDataUrl: document.getElementById('logoDataUrlField')?.value || '',
        username,
        password,
        paymentMethod: form.paymentMethod?.value || 'none',
        paymentPhone: form.paymentPhone?.value.trim() || '',
        paymentAccount: form.paymentAccount?.value.trim() || '',
        subscribeNow: !!form.subscribeNow?.checked,
        subscriptionAmount: Number(form.subAmount?.value || 0)
      })
    });
    showToast(`${school.name} registered successfully. You can now sign in.`, 'success');
    setTimeout(() => { window.location.href = 'login.html'; }, 1000);
  } catch (error) {
    showToast(`School registration failed: ${error.message}`, 'error');
  }
}

// ===== Payments & Notifications =====
function addPaymentToSchool(schoolId, amount, note, paymentCategory = 'subscription') {
  const all = loadSchoolRegistry();
  const idx = all.findIndex(s => s.id === schoolId);
  if (idx < 0) return false;
  const school = all[idx];
  const method = school.paymentMethod || 'none';
  const contact = method === 'mobile' ? school.paymentPhone : (method === 'bank' ? school.paymentAccount : '');
  const p = {
    id: Date.now(),
    amount: Number(amount),
    note: note || '',
    date: new Date().toISOString(),
    status: 'pending',
    txRef: '',
    notified: false,
    paymentCategory,
    method,
    contact
  };
  all[idx].payments = all[idx].payments || [];
  all[idx].payments.push(p);
  saveSchoolRegistry(all);
  return true;
}

function getAllPayments() {
  const schools = loadSchoolRegistry();
  let changed = false;
  schools.forEach(school => (school.payments || []).forEach(payment => {
    if (payment.paymentCategory === 'serviceFee' && payment.status === 'paid' && !payment.approvedAt) {
      payment.status = 'submitted';
      payment.submittedAt = payment.paidDate || payment.date;
      payment.paidDate = null;
      payment.notified = false;
      changed = true;
    }
  }));
  if (changed) saveSchoolRegistry(schools);
  return schools.flatMap(s => (s.payments || []).map(p => ({ schoolId: s.id, schoolName: s.name, ...p })));
}

const SERVICE_FEE_PACKAGES = {
  termly:   { label: 'Termly',    ratePerStudent: 80 },
  twoTerms: { label: 'Two Terms', ratePerStudent: 150 },
  annual:   { label: 'Annual',    ratePerStudent: 230 }
};

function getServicePackageConfig(packageId) {
  return SERVICE_FEE_PACKAGES[packageId] || SERVICE_FEE_PACKAGES.termly;
}

function buildServiceFeeDetails(school, packageId) {
  const pkg = getServicePackageConfig(packageId || school?.servicePackage || 'termly');
  const students = (school?.students || []).length;
  const amount = students * pkg.ratePerStudent;
  return {
    packageId: packageId || school?.servicePackage || 'termly',
    packageLabel: pkg.label,
    studentCount: students,
    ratePerStudent: pkg.ratePerStudent,
    amount
  };
}

function getServiceFeePayments(school, packageId) {
  if (!school?.payments) return [];
  return school.payments.filter(p => p.paymentCategory === 'serviceFee' && p.packageId === (packageId || school?.servicePackage || 'termly'));
}

function getLatestServiceFeePayment(school, packageId) {
  return getServiceFeePayments(school, packageId).sort((a,b) => new Date(b.date) - new Date(a.date))[0] || null;
}

function hasPaidServiceFee(school, packageId) {
  const feeDetails = buildServiceFeeDetails(school, packageId);
  if (feeDetails.studentCount === 0) return true;
  const payment = getLatestServiceFeePayment(school, feeDetails.packageId);
  if (payment?.status === 'paid' && !payment.approvedAt) {
    payment.status = 'submitted';
    payment.submittedAt = payment.paidDate || payment.date;
    payment.paidDate = null;
    saveSchool(school);
  }
  return !!payment && payment.status === 'paid' && !!payment.approvedAt && Number(payment.amount) >= feeDetails.amount;
}

function ensureServiceFeePaymentRecord(school, packageId) {
  const feeDetails = buildServiceFeeDetails(school, packageId);
  if (feeDetails.studentCount === 0) return null;
  school.servicePackage = feeDetails.packageId;
  school.payments = school.payments || [];
  let payment = getLatestServiceFeePayment(school, feeDetails.packageId);
  if (payment?.status === 'paid' && !payment.approvedAt) {
    payment.status = 'submitted';
    payment.submittedAt = payment.paidDate || payment.date;
    payment.paidDate = null;
    payment.notified = false;
  }
  if (payment && payment.status === 'paid' && payment.approvedAt && Number(payment.amount) >= feeDetails.amount) {
    saveSchool(school);
    return payment;
  }
  const note = `Service fee for ${feeDetails.packageLabel} package (${feeDetails.studentCount} students @ UGX ${feeDetails.ratePerStudent.toLocaleString()})`;
  const method = school.paymentMethod || 'none';
  const contact = method === 'mobile' ? school.paymentPhone : (method === 'bank' ? school.paymentAccount : '');
  if (payment && ['pending', 'submitted'].includes(payment.status)) {
    if (payment.status === 'submitted' && Number(payment.amount) !== Number(feeDetails.amount)) {
      payment.status = 'pending';
      payment.txRef = '';
      payment.submittedAt = null;
    }
    payment.amount = feeDetails.amount;
    payment.note = note;
    payment.method = method;
    payment.contact = contact;
    saveSchool(school);
    return payment;
  }
  payment = {
    id: Date.now(),
    amount: Number(feeDetails.amount),
    note,
    date: new Date().toISOString(),
    status: 'pending',
    txRef: '',
    paidDate: null,
    notified: false,
    paymentCategory: 'serviceFee',
    packageId: feeDetails.packageId,
    packageLabel: feeDetails.packageLabel,
    method,
    contact
  };
  school.payments.push(payment);
  saveSchool(school);
  return payment;
}

function getPaidPayments() {
  return getAllPayments().filter(p => p.status === 'paid');
}

function getUnreadPayments() {
  if (!getSystemSettings().notifications.paymentAlerts) return [];
  const deletedIds = getDeletedOwnerPaymentNotificationIds();
  return getAllPayments().filter(p => p.status === 'submitted' && !p.notified && !deletedIds.has(getOwnerPaymentNotificationKey(p)));
}

function getDeletedOwnerPaymentNotificationIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(OWNER_PAYMENT_NOTIFICATION_DELETIONS_KEY) || '[]');
    return new Set(Array.isArray(ids) ? ids.map(String) : []);
  } catch { return new Set(); }
}

function getOwnerPaymentNotificationKey(payment) {
  return `${payment.schoolId}:${payment.id}`;
}

function getOwnerPaymentNotificationHistory() {
  const deletedIds = getDeletedOwnerPaymentNotificationIds();
  return getAllPayments()
    .filter(payment => (payment.status === 'submitted' || payment.notified || payment.approvedAt) && !deletedIds.has(getOwnerPaymentNotificationKey(payment)))
    .sort((a, b) => new Date(b.submittedAt || b.paidDate || b.date) - new Date(a.submittedAt || a.paidDate || a.date));
}

function deleteOwnerPaymentNotification(schoolId, paymentId) {
  if (getAuthentication()?.role !== 'admin') return false;
  const deletedIds = getDeletedOwnerPaymentNotificationIds();
  deletedIds.add(`${schoolId}:${paymentId}`);
  localStorage.setItem(OWNER_PAYMENT_NOTIFICATION_DELETIONS_KEY, JSON.stringify([...deletedIds]));
  updateNotifBadge();
  openPaymentsModal();
  return true;
}

function clearOwnerPaymentNotificationHistory() {
  if (getAuthentication()?.role !== 'admin') return;
  const history = getOwnerPaymentNotificationHistory();
  if (!history.length) return;
  if (!confirm(`Delete all ${history.length} notifications from your history? Payment records will be kept.`)) return;
  const deletedIds = getDeletedOwnerPaymentNotificationIds();
  history.forEach(payment => deletedIds.add(getOwnerPaymentNotificationKey(payment)));
  localStorage.setItem(OWNER_PAYMENT_NOTIFICATION_DELETIONS_KEY, JSON.stringify([...deletedIds]));
  updateNotifBadge();
  openPaymentsModal();
}

function markPaymentNotified(schoolId, paymentId) {
  const all = loadSchoolRegistry();
  const s = all.find(x => x.id === schoolId);
  if (!s || !s.payments) return false;
  const p = s.payments.find(x => x.id === paymentId);
  if (!p) return false;
  p.notified = true;
  saveSchoolRegistry(all);
  return true;
}

function submitPaymentForApproval(schoolId, paymentId, txRef) {
  const auth = getAuthentication();
  if (!['school', 'school_parent'].includes(auth?.role) || auth.schoolId !== schoolId) return false;
  if (!String(txRef || '').trim()) return false;
  const all = loadSchoolRegistry();
  const s = all.find(x => x.id === schoolId);
  if (!s || !s.payments) return false;
  const p = s.payments.find(x => x.id === paymentId);
  if (!p || p.paymentCategory !== 'serviceFee' || !['pending', 'submitted'].includes(p.status)) return false;
  p.status = 'submitted';
  p.txRef = txRef || p.txRef || '';
  p.submittedAt = new Date().toISOString();
  p.notified = false;
  saveSchoolRegistry(all);
  return true;
}

function approveSubmittedPayment(schoolId, paymentId) {
  if (getAuthentication()?.role !== 'admin') {
    showToast('Only the System Owner can approve payments.', 'error');
    return false;
  }
  const all = loadSchoolRegistry();
  const school = all.find(item => item.id === schoolId);
  const payment = school?.payments?.find(item => item.id === paymentId);
  if (!school || !payment || payment.status !== 'submitted') {
    showToast('This payment is not awaiting approval.', 'error');
    return false;
  }
  if (payment.paymentCategory === 'serviceFee') {
    if (!String(payment.txRef || '').trim()) {
      showToast('A transaction reference is required before approval.', 'error');
      return false;
    }
    const requiredAmount = buildServiceFeeDetails(school, payment.packageId).amount;
    if (Number(payment.amount) < requiredAmount) {
      showToast('The submitted amount is below the current service fee.', 'error');
      return false;
    }
  }
  payment.status = 'paid';
  payment.paidDate = new Date().toISOString();
  payment.approvedAt = payment.paidDate;
  payment.approvedBy = ADMIN_CREDENTIAL.name;
  payment.notified = true;
  saveSchoolRegistry(all);
  showToast('Payment approved by the System Owner.', 'success');
  updateNotifBadge();
  renderPaymentHistoryDashboard();
  return true;
}

// ===== Admin notification UI =====
function initAdminNotifications() {
  updateNotifBadge();
  const btn = document.getElementById('notifBtn');
  if (btn) btn.addEventListener('click', openPaymentsModal);
  // Ensure Payments nav item exists for admins
  const navMenu = document.getElementById('navMenu');
  if (navMenu && !document.getElementById('nav-payments')) {
    const btnHtml = `
      <button type="button" onclick="navigate('payments')" id="nav-payments"
        class="nav-button w-full flex items-center gap-3 px-4 py-3 rounded-lg text-slate-700">
        <i class="fa-solid fa-wallet w-5 flex-shrink-0"></i>
        <span class="font-medium text-sm">Payments</span>
      </button>`;
    navMenu.insertAdjacentHTML('beforeend', btnHtml);
  }
}

function updateNotifBadge() {
  const enabled = getSystemSettings().notifications.paymentAlerts;
  const count = enabled ? getUnreadPayments().length : 0;
  const badge = document.getElementById('notifCount');
  if (!badge) return;
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
  document.getElementById('notifBtn')?.setAttribute('aria-label', `Notifications${count ? `, ${count} new payments` : ''}`);
}

function openPaymentsModal() {
  if (getAuthentication()?.role !== 'admin') return;
  if (!getSystemSettings().notifications.paymentAlerts) {
    showToast('Payment notifications are disabled in System Settings.', 'info');
    return;
  }
  const history = getOwnerPaymentNotificationHistory();
  const list = history.map(p => {
    const unread = p.status === 'submitted' && !p.notified;
    const date = new Date(p.submittedAt || p.paidDate || p.date);
    const paymentDate = Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString();
    return `
    <article class="p-4 border border-slate-200 rounded-lg flex flex-wrap justify-between gap-3">
      <div>
        <div class="flex items-center gap-2"><div class="font-semibold">${escapeHtml(p.schoolName || 'School')}</div><span class="text-xs px-2 py-1 rounded-full ${unread ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'}">${unread ? 'Unread' : 'Read'}</span></div>
        <div class="text-sm text-slate-600 mt-1">${escapeHtml(p.note || 'Payment notification')} — UGX ${Number(p.amount || 0).toLocaleString()} on ${escapeHtml(paymentDate)}</div>
        <div class="text-xs text-slate-500 mt-1">Status: ${escapeHtml(p.status || 'unknown')}${p.txRef ? ` · Reference: ${escapeHtml(p.txRef)}` : ''}</div>
      </div>
      <div class="flex flex-wrap items-start gap-2">
        ${p.status === 'submitted' ? `<button class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm" onclick="approveSubmittedPayment(${JSON.stringify(p.schoolId)}, ${JSON.stringify(p.id)})">Approve Payment</button>` : ''}
        ${unread ? `<button class="px-3 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm" onclick="markAndRefresh(${JSON.stringify(p.schoolId)}, ${JSON.stringify(p.id)})">Mark Read</button>` : ''}
        <button class="px-3 py-2 border border-red-300 text-red-700 hover:bg-red-50 rounded-lg text-sm" onclick="deleteOwnerPaymentNotification(${JSON.stringify(p.schoolId)}, ${JSON.stringify(p.id)})">Delete</button>
      </div>
    </article>`;
  }).join('');
  const content = `<div class="p-6 max-w-3xl"><div class="flex items-start justify-between gap-4 mb-4"><div><h3 class="text-lg font-bold">Payment Notification History</h3><p class="text-sm text-slate-500 mt-1">${history.length} ${history.length === 1 ? 'notification' : 'notifications'}</p></div>${history.length ? '<button type="button" onclick="clearOwnerPaymentNotificationHistory()" class="text-sm text-red-700 hover:text-red-900 underline">Clear history</button>' : ''}</div><div class="space-y-3 max-h-[65vh] overflow-y-auto">${list || '<p class="text-sm text-slate-500 py-5">No payment notifications in your history.</p>'}</div><div class="mt-5 text-right"><button onclick="closeModal()" class="px-4 py-2 bg-sky-600 text-white rounded-lg">Close</button></div></div>`;
  showModal(content);
}

function markAndRefresh(schoolId, paymentId) {
  markPaymentNotified(schoolId, paymentId);
  updateNotifBadge();
  openPaymentsModal();
}

function openConfirmPaymentModal(paymentId) {
  const school = getActiveSchool();
  if (!school) return;
  const p = (school.payments || []).find(x => x.id === paymentId);
  if (!p) return;
  const content = `
    <div class="p-6">
      <h3 class="text-lg font-bold mb-3">Submit Payment for Approval</h3>
      <p class="text-sm text-slate-600 mb-4">Enter the transaction reference. The System Owner must verify and approve this payment before report cards can be printed.</p>
      <div class="mb-3">
        <label class="block text-sm text-slate-700 mb-1">Transaction Reference</label>
        <input id="txRefInput" class="w-full px-3 py-2 border border-slate-300 rounded" placeholder="e.g. TXN12345">
      </div>
      <div class="text-right">
        <button onclick="confirmPaymentFromSchool(${paymentId})" class="px-4 py-2 bg-emerald-600 text-white rounded">Submit for Approval</button>
        <button onclick="closeModal()" class="px-4 py-2 ml-2 bg-slate-100 rounded">Cancel</button>
      </div>
    </div>
  `;
  showModal(content);
}

function confirmPaymentFromSchool(paymentId) {
  const tx = document.getElementById('txRefInput')?.value.trim();
  const school = getActiveSchool();
  if (!school) return;
  if (!tx) { showToast('Please enter the transaction reference.', 'error'); return; }
  const ok = submitPaymentForApproval(school.id, paymentId, tx);
  if (ok) {
    showToast('Payment submitted to the System Owner for approval.', 'success');
    closeModal();
    renderSchoolDashboard();
  } else {
    showToast('Could not confirm payment.', 'error');
  }
}

// ==================== UTILITY ====================
function findNewId(collection) {
  return collection.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1;
}

function getGrade(score) {
  return DB.gradeScale.find(g => score >= g.min && score <= g.max) || { grade: 'F9', remark: 'Fail' };
}

function getDivision(aggregates) {
  const total = Number(aggregates);
  if (Number.isNaN(total)) return 'Not Classified';

  // PLE aggregate ranges:
  // 4–12   → Division I
  // 13–24  → Division II
  // 25–29  → Division III
  // 30–35  → Division IV
  // 36+    → Division U
  if (total >= 4 && total <= 12) {
    return 'Division I';
  }

  if (total >= 13 && total <= 24) {
    return 'Division II';
  }

  if (total >= 25 && total <= 29) {
    return 'Division III';
  }

  if (total >= 30 && total <= 35) {
    return 'Division IV';
  }

  if (total >= 36) {
    return 'Division U';
  }

  return 'Not Classified';
}

function showToast(message, type = 'info') {
  const map = {
    success: { color: 'bg-emerald-600', icon: 'fa-circle-check' },
    error:   { color: 'bg-red-600',     icon: 'fa-triangle-exclamation' },
    info:    { color: 'bg-sky-600',      icon: 'fa-info-circle' }
  };
  const cfg = map[type] || map.info;
  const el = document.createElement('div');
  el.className = `fixed bottom-4 right-4 ${cfg.color} text-white px-6 py-4 rounded-lg shadow-lg flex items-center gap-3 fade-in z-40 max-w-md`;
  el.innerHTML = `<i class="fa-solid ${cfg.icon}"></i><span>${message}</span>`;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(100px)';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ==================== MODAL ====================
function showModal(content) {
  const modalContainer = document.getElementById('modalContainer');
  if (!modalContainer) return;
  modalContainer.innerHTML = `
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 fade-in" onclick="closeModal(event)">
      <div class="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onclick="event.stopPropagation()">
        ${content}
      </div>
    </div>
  `;
}

function closeModal(event) {
  const modalContainer = document.getElementById('modalContainer');
  if (!modalContainer) return;
  if (!event || event.target === event.currentTarget) {
    modalContainer.innerHTML = '';
  }
}

// ==================== DASHBOARD ====================
function renderDashboard() {
  const auth = getAuthentication();
  applyInterfaceMode(getPreferredInterfaceMode(getActiveSchool()));
  if (auth?.role === 'admin') renderAdminDashboard();
  else renderSchoolDashboard();
  if (auth?.role === 'admin') {
    initAdminNotifications();
  }
}

function renderAdminDashboard() {
  document.getElementById('pageTitle').textContent = 'Admin Dashboard';
  document.getElementById('pageSubtitle').textContent = 'Platform overview, school management, subscriptions and system health';

  const schools = loadSchoolRegistry();
  const totalStudents = schools.reduce((n, s) => n + (s.students?.length || 0), 0);
  const totalStaff    = schools.reduce((n, s) => n + (s.staff?.length    || 0), 0);
  const unreadPayments = getUnreadPayments().length;
  const activeSchools = schools.filter(s => getAccountStatus(s) === 'active').length;

  document.getElementById('contentArea').innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
      ${statCard('Registered Schools', schools.length, 'fa-school', 'from-blue-500 to-blue-600')}
      ${statCard('Active Schools', activeSchools, 'fa-check-circle', 'from-emerald-500 to-emerald-600')}
      ${statCard('Total Students', totalStudents.toLocaleString(), 'fa-children', 'from-amber-500 to-amber-600')}
      ${statCard('New Payments', unreadPayments, 'fa-bell', 'from-red-500 to-red-600')}
    </div>

    <div class="mb-6 flex justify-end gap-2 flex-wrap">
      <button onclick="openAdminAccountSettingsModal()" class="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-lg font-medium text-sm">Admin Settings</button>
      <a href="register.html?admin=1" class="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-medium text-sm">Register New School</a>
      <button onclick="navigate('subscriptions')" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-sm">Create Subscription Plan</button>
      <button onclick="navigate('backups')" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm">Backup Database</button>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div class="xl:col-span-2 space-y-6">
        <div class="bg-white rounded-xl shadow-sm p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-bold">Quick Actions</h3>
            <span class="text-sm text-slate-500">Supervisor shortcuts</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button onclick="navigate('schools')" class="text-left p-4 border rounded-lg hover:border-sky-400 hover:bg-sky-50">
              <p class="font-semibold text-slate-800">Register New School</p>
              <p class="text-sm text-slate-500 mt-1">Create a school account and assign admin access.</p>
            </button>
            <button onclick="navigate('subscriptions')" class="text-left p-4 border rounded-lg hover:border-emerald-400 hover:bg-emerald-50">
              <p class="font-semibold text-slate-800">Create Subscription Plan</p>
              <p class="text-sm text-slate-500 mt-1">Set prices, trials, discounts and renewals.</p>
            </button>
            <button onclick="navigate('users')" class="text-left p-4 border rounded-lg hover:border-amber-400 hover:bg-amber-50">
              <p class="font-semibold text-slate-800">Add System Administrator</p>
              <p class="text-sm text-slate-500 mt-1">Assign roles and permissions to platform users.</p>
            </button>
            <button onclick="navigate('announcements')" class="text-left p-4 border rounded-lg hover:border-purple-400 hover:bg-purple-50">
              <p class="font-semibold text-slate-800">Broadcast Announcement</p>
              <p class="text-sm text-slate-500 mt-1">Share updates to all schools or selected groups.</p>
            </button>
          </div>
        </div>

        <div class="bg-white rounded-xl shadow-sm p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-bold">Schools Management</h3>
            <span class="text-sm text-slate-500">Registered schools and account controls</span>
          </div>
          ${schools.length === 0 ? `
            <div class="text-center py-12 text-slate-400">
              <i class="fa-solid fa-school text-4xl mb-3"></i>
              <p>No schools registered yet.</p>
              <p class="text-sm mt-1">Schools can self-register from the login page.</p>
            </div>
          ` : `
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th class="text-left p-3 font-semibold">School</th>
                  <th class="text-left p-3 font-semibold">Status</th>
                  <th class="text-left p-3 font-semibold">Plan</th>
                  <th class="text-left p-3 font-semibold">Expiry</th>
                  <th class="text-left p-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${schools.slice(0, 5).map(s => `
                  <tr class="border-b border-slate-100 hover:bg-slate-50">
                    <td class="p-3 font-medium">${s.name}</td>
                    <td class="p-3"><span class="px-2.5 py-1 rounded-full text-xs font-semibold ${getAccountStatusBadgeClass(getAccountStatus(s))}">${getAccountStatusLabel(getAccountStatus(s))}</span></td>
                    <td class="p-3 text-slate-600">${s.paymentMethod && s.paymentMethod !== 'none' ? 'Premium' : 'Basic'}</td>
                    <td class="p-3 text-slate-600">${s.expiryDate || 'Open-ended'}</td>
                    <td class="p-3">
                      <div class="flex flex-wrap gap-2">
                        <button onclick="openAccountSettingsModal(${s.id})" class="px-2.5 py-1 bg-sky-600 text-white rounded text-xs">Manage</button>
                        <button onclick="setUserAccountStatus(${s.id}, 'suspended')" class="px-2.5 py-1 bg-amber-600 text-white rounded text-xs">Suspend</button>
                        <button onclick="setUserAccountStatus(${s.id}, 'blocked')" class="px-2.5 py-1 bg-red-600 text-white rounded text-xs">Block</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`}
        </div>
      </div>

      <div class="space-y-6">
        <div class="bg-white rounded-xl shadow-sm p-6">
          <h3 class="text-lg font-bold mb-4">System Monitoring</h3>
          <div class="space-y-3 text-sm">
            <div class="flex justify-between"><span>Server Status</span><span class="font-semibold text-emerald-600">Online</span></div>
            <div class="flex justify-between"><span>Database Status</span><span class="font-semibold text-emerald-600">Healthy</span></div>
            <div class="flex justify-between"><span>Storage Usage</span><span class="font-semibold">68%</span></div>
            <div class="flex justify-between"><span>CPU Usage</span><span class="font-semibold">42%</span></div>
            <div class="flex justify-between"><span>Memory Usage</span><span class="font-semibold">57%</span></div>
          </div>
        </div>

        <div class="bg-white rounded-xl shadow-sm p-6">
          <h3 class="text-lg font-bold mb-4">Notifications Center</h3>
          <div class="space-y-3 text-sm">
            <div class="border rounded-lg p-3"><p class="font-medium">New school registration</p><p class="text-slate-500">Busitema School pending review</p></div>
            <div class="border rounded-lg p-3"><p class="font-medium">Subscription renewal</p><p class="text-slate-500">Victory High renewal due tomorrow</p></div>
            <div class="border rounded-lg p-3"><p class="font-medium">Report generation errors</p><p class="text-slate-500">2 schools encountered template issues</p></div>
          </div>
        </div>

        <div class="bg-white rounded-xl shadow-sm p-6">
          <h3 class="text-lg font-bold mb-4">Audit Logs</h3>
          <div class="space-y-3 text-sm">
            <div class="border rounded-lg p-3"><p class="font-medium">Admin created school</p><p class="text-slate-500">27-Jul-2026</p></div>
            <div class="border rounded-lg p-3"><p class="font-medium">School admin generated reports</p><p class="text-slate-500">27-Jul-2026</p></div>
            <div class="border rounded-lg p-3"><p class="font-medium">Teacher updated marks</p><p class="text-slate-500">27-Jul-2026</p></div>
          </div>
        </div>
      </div>
    </div>

    <div class="bg-white rounded-xl shadow-sm p-6 mt-6">
      <h3 class="text-lg font-bold mb-4">Recent Paid Payments</h3>
      ${getPaidPayments().sort((a,b)=> new Date(b.paidDate || b.date)-new Date(a.paidDate || a.date)).slice(0,5).length === 0 ? `
        <p class="text-slate-500">No paid payments recorded yet.</p>
      ` : `
        <div class="space-y-3">
          ${getPaidPayments().sort((a,b)=> new Date(b.paidDate || b.date)-new Date(a.paidDate || a.date)).slice(0,5).map(p => `
            <div class="flex items-center justify-between p-3 border rounded">
              <div>
                <div class="font-semibold">${p.schoolName}</div>
                <div class="text-sm text-slate-600">UGX ${p.amount.toLocaleString()} — ${new Date(p.paidDate || p.date).toLocaleString()}</div>
                <div class="text-xs text-slate-400">Ref: ${p.txRef || '-'}</div>
              </div>
              <div>
                ${p.notified ? `<span class="text-xs text-slate-500">Read</span>` : `<button onclick="markAndRefresh(${p.schoolId}, ${p.id})" class="px-3 py-1 bg-emerald-600 text-white rounded text-sm">Mark Read</button>`}
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

function renderSchoolDashboard() {
  const school = getActiveSchool();
  if (!school) { logout(); return; }

  const students = school.students || [];
  const staff    = school.staff    || [];

  document.getElementById('pageTitle').textContent    = school.name;
  document.getElementById('pageSubtitle').textContent = `${school.district} — School Dashboard`;

  const studentsByClass = {};
  DB.classes.forEach(cls => {
    studentsByClass[cls] = students.filter(s => s.class === cls).length;
  });

  document.getElementById('contentArea').innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
      ${statCard('Total Students', students.length, 'fa-children', 'from-sky-500 to-sky-600')}
      ${statCard('Staff Members', staff.length, 'fa-users', 'from-emerald-500 to-emerald-600')}
      ${statCard('Total Classes', DB.classes.length, 'fa-chalkboard', 'from-purple-500 to-purple-600')}
    </div>

    ${ (school.payments || []).filter(p => p.paymentCategory === 'serviceFee' && ['pending', 'submitted'].includes(p.status)).length ? `
      <div class="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h3 class="text-lg font-bold mb-3">Service Fee Payments</h3>
        <div class="space-y-3">
          ${ (school.payments || []).filter(p => p.paymentCategory === 'serviceFee' && ['pending', 'submitted'].includes(p.status)).map(p => `
            <div class="flex items-center justify-between p-3 border rounded">
              <div>
                <div class="font-semibold">${p.note || 'Payment'} — UGX ${p.amount.toLocaleString()}</div>
                <div class="text-sm text-slate-600">Status: ${p.status === 'submitted' ? 'Awaiting System Owner approval' : 'Awaiting your transaction reference'}</div>
                ${p.txRef ? `<div class="text-xs text-slate-500">Reference: ${p.txRef}</div>` : ''}
              </div>
              <div>
                ${p.paymentCategory === 'serviceFee' ? `<button onclick="openConfirmPaymentModal(${p.id})" class="px-3 py-1 bg-sky-600 text-white rounded">${p.status === 'submitted' ? 'Update Reference' : 'Submit Payment'}</button>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '' }

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-white rounded-xl shadow-sm p-6">
        <h3 class="text-lg font-bold mb-4">Class Distribution</h3>
        <canvas id="classChart"></canvas>
      </div>
      <div class="bg-white rounded-xl shadow-sm p-6">
        <h3 class="text-lg font-bold mb-4">School Profile</h3>
        <div class="flex items-center gap-4 mb-4">
          ${school.logoDataUrl
            ? `<img src="${school.logoDataUrl}" class="w-16 h-16 rounded-xl object-cover border-2 border-sky-200 shadow">`
            : `<div class="w-16 h-16 rounded-xl bg-sky-100 flex items-center justify-center text-sky-600 text-3xl"><i class="fa-solid fa-school"></i></div>`}
          <div>
            <p class="font-bold text-slate-800">${school.name}</p>
            <p class="text-sm text-slate-500">${school.district}</p>
          </div>
        </div>
        <div class="space-y-2 text-sm text-slate-600">
          ${school.headTeacher ? `<div><span class="font-medium text-slate-700">Head Teacher:</span> ${school.headTeacher}</div>` : ''}
          ${school.tel         ? `<div><span class="font-medium text-slate-700">Tel:</span> ${school.tel}</div>` : ''}
          ${school.email       ? `<div><span class="font-medium text-slate-700">Email:</span> ${school.email}</div>` : ''}
          ${school.address     ? `<div><span class="font-medium text-slate-700">Address:</span> ${school.address}</div>` : ''}
          ${school.motto       ? `<div><span class="font-medium text-slate-700">Motto:</span> <em>${school.motto}</em></div>` : ''}
        </div>
      </div>
    </div>

    <div class="bg-white rounded-xl shadow-sm p-6 mt-6">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-bold">Account Settings</h3>
        <button onclick="openAccountSettingsModal(${school.id})" class="px-3 py-2 bg-sky-600 text-white rounded-lg text-sm">Manage Account</button>
      </div>
      <p class="text-sm text-slate-600">Update your account details, change your password, or contact the administrator for account actions.</p>
    </div>
  `;

  setTimeout(() => {
    const ctx = document.getElementById('classChart');
    if (ctx) {
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: Object.keys(studentsByClass),
          datasets: [{ label: 'Students', data: Object.values(studentsByClass), backgroundColor: 'rgb(14,165,233)', borderRadius: 6 }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
      });
    }
  }, 100);
}

// ==================== PAYMENTS VIEW (admin) ====================
function renderPaymentHistoryDashboard() {
  if (getAuthentication()?.role !== 'admin') {
    showToast('Only the System Owner can manage payment history.', 'error');
    return;
  }
  selectedPaymentHistoryKeys = new Set();
  const payments = getAllPayments().sort((a,b) => new Date(b.paidDate || b.date) - new Date(a.paidDate || a.date));
  document.getElementById('pageTitle').textContent = 'Payment Management';
  document.getElementById('pageSubtitle').textContent = 'Search, select, delete, and print payment history';

  document.getElementById('contentArea').innerHTML = `
    <div class="bg-white rounded-xl shadow-sm p-4 mb-4 space-y-3">
      <div class="flex items-center gap-2 flex-wrap">
        <input id="paymentsSearch" placeholder="Search school, ref, note" class="px-3 py-2 border rounded text-sm w-60">
        <select id="paymentsStatusFilter" class="px-3 py-2 border rounded text-sm">
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="submitted">Awaiting Owner Approval</option>
          <option value="paid">Paid</option>
          <option value="refunded">Refunded</option>
        </select>
        <input id="paymentsFrom" type="date" class="px-3 py-2 border rounded text-sm">
        <input id="paymentsTo" type="date" class="px-3 py-2 border rounded text-sm">
        <button id="paymentsFilterBtn" class="px-3 py-2 bg-sky-600 text-white rounded text-sm">Filter</button>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button id="printSelectedPaymentsBtn" disabled class="px-3 py-2 bg-slate-700 text-white disabled:opacity-40 rounded text-sm">Print selected (0)</button>
        <button id="printPaymentsBtn" class="px-3 py-2 bg-slate-800 text-white rounded text-sm">Print filtered</button>
        <button id="clearSelectedPaymentsBtn" disabled class="px-3 py-2 border border-red-300 text-red-700 disabled:opacity-40 rounded text-sm">Delete selected (0)</button>
        <button id="clearAllPaymentsBtn" class="px-3 py-2 bg-red-700 text-white rounded text-sm">Delete all</button>
        <button id="exportPaymentsBtn" class="px-3 py-2 bg-emerald-600 text-white rounded text-sm">Export CSV</button>
        <button id="addPaymentBtn" class="px-3 py-2 bg-indigo-600 text-white rounded text-sm">Add Payment</button>
      </div>
    </div>
    <div id="paymentsTableWrap"></div>
  `;

  renderPaymentsTable(payments);

  document.getElementById('paymentsFilterBtn').addEventListener('click', applyPaymentsFilters);
  document.getElementById('exportPaymentsBtn').addEventListener('click', () => exportPaymentsCSV(applyPaymentsFilters(true)));
  document.getElementById('printSelectedPaymentsBtn').addEventListener('click', printSelectedPaymentHistory);
  document.getElementById('printPaymentsBtn').addEventListener('click', printFilteredPaymentHistory);
  document.getElementById('clearSelectedPaymentsBtn').addEventListener('click', clearSelectedPaymentHistory);
  document.getElementById('clearAllPaymentsBtn').addEventListener('click', clearAllPaymentHistory);
  document.getElementById('addPaymentBtn').addEventListener('click', openAddPaymentModal);
}

function renderPaymentsTable(payments) {
  const wrap = document.getElementById('paymentsTableWrap');
  if (!wrap) return;
  if (!payments || payments.length === 0) {
    wrap.innerHTML = `<div class="bg-white rounded-xl shadow-sm p-6"> <p class="text-slate-500">No payments recorded.</p> </div>`;
    return;
  }
  wrap.innerHTML = `
    <section class="print-area payments-print-area bg-white rounded-xl shadow-sm p-6 overflow-x-auto">
      <div id="paymentsPrintHeading" class="payments-print-heading hidden mb-4">
        <h2 class="text-xl font-bold">Payment History</h2>
        <p id="paymentsPrintDetails" class="text-sm text-slate-600 mt-1"></p>
      </div>
      <table class="w-full text-sm payments-history-table">
        <thead class="bg-slate-50 border-b"><tr>
          <th class="p-3 text-left no-print"><input id="selectVisiblePayments" type="checkbox" aria-label="Select visible payment records" onchange="toggleVisiblePaymentHistory(this.checked)"></th>
          <th class="p-3 text-left">School</th>
          <th class="p-3 text-left">Amount</th>
          <th class="p-3 text-left">Method</th>
          <th class="p-3 text-left">Contact</th>
          <th class="p-3 text-left">Note</th>
          <th class="p-3 text-left">Status</th>
          <th class="p-3 text-left">Submitted / Created</th>
          <th class="p-3 text-left">Paid Date</th>
          <th class="p-3 text-left">Reference</th>
          <th class="p-3 text-left">Notified</th>
          <th class="p-3 text-left no-print">Action</th>
        </tr></thead>
        <tbody>
          ${payments.map(p => `
            <tr class="border-b hover:bg-slate-50">
              <td class="p-3 no-print"><input type="checkbox" data-payment-history-key="${escapeHtml(getPaymentHistoryKey(p))}" aria-label="Select payment from ${escapeHtml(p.schoolName || 'school')}" ${selectedPaymentHistoryKeys.has(getPaymentHistoryKey(p)) ? 'checked' : ''}></td>
              <td class="p-3 font-medium">${p.schoolName}</td>
              <td class="p-3">UGX ${p.amount.toLocaleString()}</td>
              <td class="p-3">${p.method || '-'}</td>
              <td class="p-3">${p.contact || '-'}</td>
              <td class="p-3 text-slate-600">${p.note || '-'}</td>
              <td class="p-3 text-sm">${p.status}</td>
              <td class="p-3 text-sm">${new Date(p.submittedAt || p.date).toLocaleString()}</td>
              <td class="p-3 text-sm">${p.paidDate ? new Date(p.paidDate).toLocaleString() : '-'}</td>
              <td class="p-3 text-sm">${p.txRef || '-'}</td>
              <td class="p-3 text-sm">${p.notified ? 'Yes' : 'No'}</td>
              <td class="p-3 no-print">
                <button onclick="viewPayment(${p.schoolId}, ${p.id})" class="px-3 py-1 bg-sky-600 text-white rounded text-sm mr-2">View</button>
                ${p.status === 'submitted' ? `<button onclick="approveSubmittedPayment(${p.schoolId}, ${p.id})" class="px-3 py-1 bg-emerald-600 text-white rounded text-sm">Approve Payment</button>` : ''}
                ${p.status === 'paid' && !p.notified ? `<button onclick="markAndRefresh(${p.schoolId}, ${p.id})" class="px-3 py-1 bg-emerald-600 text-white rounded text-sm">Acknowledge</button>` : ''}
                ${p.status === 'paid' ? `<button onclick="markPaymentRefunded(${p.schoolId}, ${p.id}); renderPaymentHistoryDashboard();" class="px-3 py-1 bg-red-500 text-white rounded text-sm ml-2">Refund</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
  `;
  wrap.querySelectorAll('[data-payment-history-key]').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      const key = checkbox.dataset.paymentHistoryKey;
      if (checkbox.checked) selectedPaymentHistoryKeys.add(key);
      else selectedPaymentHistoryKeys.delete(key);
      updatePaymentHistorySelectionControls(payments);
    });
  });
  updatePaymentHistorySelectionControls(payments);
}

function getPaymentHistoryKey(payment) {
  return `${payment.schoolId}:${payment.id}`;
}

function updatePaymentHistorySelectionControls(visiblePayments = []) {
  const clearSelectedButton = document.getElementById('clearSelectedPaymentsBtn');
  const printSelectedButton = document.getElementById('printSelectedPaymentsBtn');
  const selectVisible = document.getElementById('selectVisiblePayments');
  if (clearSelectedButton) {
    clearSelectedButton.textContent = `Delete selected (${selectedPaymentHistoryKeys.size})`;
    clearSelectedButton.disabled = selectedPaymentHistoryKeys.size === 0;
  }
  if (printSelectedButton) {
    printSelectedButton.textContent = `Print selected (${selectedPaymentHistoryKeys.size})`;
    printSelectedButton.disabled = selectedPaymentHistoryKeys.size === 0;
  }
  if (selectVisible) {
    selectVisible.checked = visiblePayments.length > 0 && visiblePayments.every(payment => selectedPaymentHistoryKeys.has(getPaymentHistoryKey(payment)));
    selectVisible.indeterminate = visiblePayments.some(payment => selectedPaymentHistoryKeys.has(getPaymentHistoryKey(payment))) && !selectVisible.checked;
  }
}

function toggleVisiblePaymentHistory(checked) {
  if (getAuthentication()?.role !== 'admin') return;
  const payments = applyPaymentsFilters(true);
  payments.forEach(payment => {
    const key = getPaymentHistoryKey(payment);
    if (checked) selectedPaymentHistoryKeys.add(key);
    else selectedPaymentHistoryKeys.delete(key);
  });
  renderPaymentsTable(payments);
}

function removePaymentHistoryRecords(paymentKeys) {
  if (getAuthentication()?.role !== 'admin') return 0;
  const keys = new Set(paymentKeys);
  const schools = loadSchoolRegistry();
  let removedCount = 0;
  schools.forEach(school => {
    const currentPayments = school.payments || [];
    const remainingPayments = currentPayments.filter(payment => !keys.has(getPaymentHistoryKey({ ...payment, schoolId: school.id })));
    removedCount += currentPayments.length - remainingPayments.length;
    school.payments = remainingPayments;
  });
  if (removedCount) {
    saveSchoolRegistry(schools);
    const dismissedNotifications = getDeletedOwnerPaymentNotificationIds();
    keys.forEach(key => dismissedNotifications.delete(key));
    localStorage.setItem(OWNER_PAYMENT_NOTIFICATION_DELETIONS_KEY, JSON.stringify([...dismissedNotifications]));
  }
  return removedCount;
}

function clearSelectedPaymentHistory() {
  if (getAuthentication()?.role !== 'admin') return;
  const keys = [...selectedPaymentHistoryKeys];
  if (!keys.length) return;
  if (!confirm(`Permanently delete ${keys.length} selected payment ${keys.length === 1 ? 'record' : 'records'}?`)) return;
  const removedCount = removePaymentHistoryRecords(keys);
  selectedPaymentHistoryKeys.clear();
  renderPaymentHistoryDashboard();
  updateNotifBadge();
  showToast(`${removedCount} payment ${removedCount === 1 ? 'record' : 'records'} deleted.`, 'success');
}

function clearAllPaymentHistory() {
  if (getAuthentication()?.role !== 'admin') return;
  const payments = getAllPayments();
  if (!payments.length) {
    showToast('There are no payment records to delete.', 'info');
    return;
  }
  if (!confirm(`Permanently delete all ${payments.length} payment records? This cannot be undone.`)) return;
  const removedCount = removePaymentHistoryRecords(payments.map(getPaymentHistoryKey));
  selectedPaymentHistoryKeys.clear();
  renderPaymentHistoryDashboard();
  updateNotifBadge();
  showToast(`${removedCount} payment records deleted.`, 'success');
}

function printPaymentHistoryRecords(payments, details, restorePayments) {
  renderPaymentsTable(payments);
  const printDetails = document.getElementById('paymentsPrintDetails');
  if (printDetails) printDetails.textContent = details;
  window.addEventListener('afterprint', () => renderPaymentsTable(restorePayments), { once: true });
  window.print();
}

function printSelectedPaymentHistory() {
  if (getAuthentication()?.role !== 'admin') {
    showToast('Only the System Owner can print payment history.', 'error');
    return;
  }
  const selectedKeys = new Set(selectedPaymentHistoryKeys);
  const payments = getAllPayments()
    .filter(payment => selectedKeys.has(getPaymentHistoryKey(payment)))
    .sort((a, b) => new Date(b.paidDate || b.date) - new Date(a.paidDate || a.date));
  if (!payments.length) {
    showToast('Select at least one payment record to print.', 'info');
    return;
  }
  const restorePayments = applyPaymentsFilters(true);
  printPaymentHistoryRecords(payments, `${payments.length} selected payment ${payments.length === 1 ? 'record' : 'records'}`, restorePayments);
}

function printFilteredPaymentHistory() {
  if (getAuthentication()?.role !== 'admin') {
    showToast('Only the System Owner can print payment history.', 'error');
    return;
  }
  const payments = applyPaymentsFilters(true);
  if (!payments.length) {
    showToast('There are no filtered payment records to print.', 'info');
    return;
  }
  const status = document.getElementById('paymentsStatusFilter')?.selectedOptions[0]?.textContent || 'All statuses';
  const from = document.getElementById('paymentsFrom')?.value || 'Any date';
  const to = document.getElementById('paymentsTo')?.value || 'Any date';
  const restorePayments = payments;
  printPaymentHistoryRecords(payments, `${payments.length} records · ${status} · ${from} to ${to}`, restorePayments);
}

function applyPaymentsFilters(returnFiltered) {
  const all = getAllPayments().sort((a,b) => new Date(b.paidDate || b.date) - new Date(a.paidDate || a.date));
  const q = (document.getElementById('paymentsSearch')?.value || '').toLowerCase().trim();
  const status = document.getElementById('paymentsStatusFilter')?.value || 'all';
  const from = document.getElementById('paymentsFrom')?.value;
  const to = document.getElementById('paymentsTo')?.value;
  const filtered = all.filter(p => {
    if (status !== 'all' && p.status !== status) return false;
    if (q) {
      const hay = `${p.schoolName} ${p.txRef || ''} ${p.note || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (from) {
      const d = new Date(p.date);
      if (d < new Date(from + 'T00:00:00')) return false;
    }
    if (to) {
      const d = new Date(p.date);
      if (d > new Date(to + 'T23:59:59')) return false;
    }
    return true;
  });
  renderPaymentsTable(filtered);
  return returnFiltered ? filtered : null;
}

function exportPaymentsCSV(payments) {
  const rows = payments || getAllPayments();
  const cols = ['schoolName','amount','method','contact','note','status','date','paidDate','txRef','notified'];
  const csv = [ ['School','Amount','Method','Contact','Note','Status','Created','PaidDate','Reference','Notified'].join(',') ].concat(
    rows.map(r => cols.map(c => `"${(r[c]||'').toString().replace(/"/g,'""')}"`).join(','))
  ).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `payments_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}

function openAddPaymentModal() {
  const schools = loadSchoolRegistry();
  const opts = schools.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  const content = `
    <div class="p-6">
      <h3 class="text-lg font-bold mb-3">Add Payment (Admin)</h3>
      <div class="mb-2">
        <label class="block text-sm mb-1">School</label>
        <select id="adminAddSchool" class="w-full px-3 py-2 border rounded">${opts}</select>
      </div>
      <div class="mb-2">
        <label class="block text-sm mb-1">Amount (UGX)</label>
        <input id="adminAddAmount" type="number" class="w-full px-3 py-2 border rounded">
      </div>
      <div class="mb-2">
        <label class="block text-sm mb-1">Note</label>
        <input id="adminAddNote" class="w-full px-3 py-2 border rounded">
      </div>
      <div class="text-right">
        <button onclick="adminAddPayment()" class="px-4 py-2 bg-emerald-600 text-white rounded">Add</button>
        <button onclick="closeModal()" class="px-4 py-2 ml-2 bg-slate-100 rounded">Cancel</button>
      </div>
    </div>
  `;
  showModal(content);
}

function adminAddPayment() {
  const schoolId = parseInt(document.getElementById('adminAddSchool')?.value,10);
  const amount = parseFloat(document.getElementById('adminAddAmount')?.value) || 0;
  const note = document.getElementById('adminAddNote')?.value || '';
  if (!schoolId || amount <= 0) { showToast('Select school and enter a valid amount.', 'error'); return; }
  const all = loadSchoolRegistry();
  const sidx = all.findIndex(s => s.id === schoolId);
  if (sidx < 0) { showToast('School not found', 'error'); return; }
  const school = all[sidx];
  const method = school.paymentMethod || 'none';
  const contact = method === 'mobile' ? school.paymentPhone : (method === 'bank' ? school.paymentAccount : '');
  const p = {
    id: Date.now(),
    amount: Number(amount),
    note,
    date: new Date().toISOString(),
    status: 'paid',
    txRef: 'ADMIN-'+Date.now(),
    paidDate: new Date().toISOString(),
    notified: false,
    paymentCategory: 'admin',
    method,
    contact
  };
  all[sidx].payments = all[sidx].payments || [];
  all[sidx].payments.push(p);
  saveSchoolRegistry(all);
  closeModal();
  showToast('Payment added and admin notified.', 'success');
  renderPaymentHistoryDashboard();
  updateNotifBadge();
}

function markPaymentRefunded(schoolId, paymentId) {
  const all = loadSchoolRegistry();
  const s = all.find(x => x.id === schoolId);
  if (!s || !s.payments) { showToast('Payment not found', 'error'); return false; }
  const p = s.payments.find(x => x.id === paymentId);
  if (!p) { showToast('Payment not found', 'error'); return false; }
  p.status = 'refunded';
  p.refundDate = new Date().toISOString();
  saveSchoolRegistry(all);
  showToast('Payment marked refunded.', 'info');
  renderPaymentHistoryDashboard();
  return true;
}

function findPayment(schoolId, paymentId) {
  const school = getSchoolById(schoolId);
  if (!school || !school.payments) return null;
  const p = school.payments.find(x => x.id === paymentId);
  if (!p) return null;
  return { school, payment: p };
}

function viewPayment(schoolId, paymentId) {
  const rec = findPayment(schoolId, paymentId);
  if (!rec) return showModal(`<div class="p-6">Payment not found.</div>`);
  const { school, payment: p } = rec;
  const method = school.paymentMethod || 'none';
  const contact = method === 'mobile' ? school.paymentPhone : (method === 'bank' ? school.paymentAccount : '');
  const content = `
    <div class="p-6">
      <h3 class="text-lg font-bold mb-3">Payment Details</h3>
      <div class="space-y-2 text-sm text-slate-700">
        <div><strong>School:</strong> ${school.name}</div>
        <div><strong>Amount:</strong> UGX ${p.amount.toLocaleString()}</div>
        <div><strong>Status:</strong> ${p.status}</div>
        <div><strong>Created:</strong> ${new Date(p.date).toLocaleString()}</div>
        <div><strong>Paid Date:</strong> ${p.paidDate ? new Date(p.paidDate).toLocaleString() : '-'}</div>
        <div><strong>Reference:</strong> ${p.txRef || '-'}</div>
        <div><strong>Method:</strong> ${method}</div>
        <div><strong>Contact:</strong> ${contact || '-'}</div>
        <div><strong>Note:</strong> ${p.note || '-'}</div>
        <div><strong>Notified:</strong> ${p.notified ? 'Yes' : 'No'}</div>
      </div>
      <div class="mt-4 text-right">
        ${p.status === 'paid' && !p.notified ? `<button onclick="markAndRefresh(${schoolId}, ${paymentId})" class="px-4 py-2 bg-emerald-600 text-white rounded mr-2">Acknowledge</button>` : ''}
        <button onclick="closeModal()" class="px-4 py-2 bg-slate-100 rounded">Close</button>
      </div>
    </div>
  `;
  showModal(content);
}

function statCard(title, value, icon, gradient) {
  return `
    <div class="bg-white rounded-xl shadow-sm p-6 border border-slate-100 hover:shadow-md transition-shadow">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-slate-600 mb-1">${title}</p>
          <p class="text-3xl font-bold text-slate-800">${value}</p>
        </div>
        <div class="w-14 h-14 bg-gradient-to-br ${gradient} rounded-xl flex items-center justify-center">
          <i class="fa-solid ${icon} text-white text-2xl"></i>
        </div>
      </div>
    </div>
  `;
}

// ==================== INITIALIZE ====================
function initializeApp() {
  applyInterfaceMode(getPreferredInterfaceMode(getActiveSchool()));

  // Demo fixtures require explicit opt-in and are never seeded for normal use.
  const schools = loadSchoolRegistry();
  if (window.KIMS_DEMO_MODE === true && schools.length === 0) {
    const demo = {
      id: 1,
      name: 'Green Hill Primary School',
      district: 'Kampala',
      address: 'P.O. Box 12345, Kampala',
      tel: '0414-123456',
      email: 'info@greenhill.ac.ug',
      motto: 'Strive for Excellence',
      headTeacher: 'Mrs. Sarah Nakabugo',
      logoDataUrl: '',
      username: 'school',
      password: 'school123',
      staff: [
        { id: 1, name: "Mrs. Sarah Nakabugo",  role: "Head Teacher",         contact: "0700123456", salary: 1200000 },
        { id: 2, name: "Mr. James Okello",      role: "Deputy Head Teacher",  contact: "0701123456", salary: 1000000 },
        { id: 3, name: "Ms. Grace Atim",        role: "Teacher",              contact: "0702123456", salary: 800000, class: "P7" },
        { id: 4, name: "Mr. David Ssali",       role: "Teacher",              contact: "0703123456", salary: 800000, class: "P6" },
        { id: 5, name: "Mrs. Janet Namutebi",   role: "Teacher",              contact: "0704123456", salary: 750000, class: "P5" },
        { id: 6, name: "Mr. Peter Kato",        role: "Teacher",              contact: "0705123456", salary: 750000, class: "P4" },
        { id: 7, name: "Ms. Rose Nambi",        role: "Teacher",              contact: "0706123456", salary: 700000, class: "P3" },
        { id: 8, name: "Mr. Moses Kiiza",       role: "Bursar",               contact: "0707123456", salary: 900000 }
      ],
      students: [
        { id:1,  name:"Aisha Namubiru",    lin:"U0012345", class:"P7", parent:"Mrs. Namubiru",   contact:"0788123456", photo:"👧", gender:"Female" },
        { id:2,  name:"Brian Ochieng",     lin:"U0012346", class:"P7", parent:"Mr. Ochieng",     contact:"0789123456", photo:"👦", gender:"Male"   },
        { id:3,  name:"Catherine Nalwoga", lin:"U0012347", class:"P7", parent:"Mrs. Nalwoga",    contact:"0790123456", photo:"👧", gender:"Female" },
        { id:4,  name:"Daniel Mukasa",     lin:"U0012348", class:"P6", parent:"Mr. Mukasa",      contact:"0791123456", photo:"👦", gender:"Male"   },
        { id:5,  name:"Esther Nakintu",    lin:"U0012349", class:"P6", parent:"Mrs. Nakintu",    contact:"0792123456", photo:"👧", gender:"Female" },
        { id:6,  name:"Frank Tumusiime",   lin:"U0012350", class:"P5", parent:"Mr. Tumusiime",   contact:"0793123456", photo:"👦", gender:"Male"   },
        { id:7,  name:"Gloria Namagembe",  lin:"U0012351", class:"P5", parent:"Mrs. Namagembe",  contact:"0794123456", photo:"👧", gender:"Female" },
        { id:8,  name:"Henry Lubega",      lin:"U0012352", class:"P4", parent:"Mr. Lubega",      contact:"0795123456", photo:"👦", gender:"Male"   },
        { id:9,  name:"Irene Atwine",      lin:"U0012353", class:"P3", parent:"Mrs. Atwine",     contact:"0796123456", photo:"👧", gender:"Female" },
        { id:10, name:"Joseph Kasozi",     lin:"U0012354", class:"P2", parent:"Mr. Kasozi",      contact:"0797123456", photo:"👦", gender:"Male"   }
      ],
      marks: {}
    };
    saveSchoolRegistry([demo]);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
