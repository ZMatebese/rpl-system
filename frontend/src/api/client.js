const BASE = '/api';

// The token is held in memory only. It is deliberately not written to
// localStorage: a stateless JWT in persistent storage widens the theft window
// well beyond the session.
let authToken = null;

export function setToken(token) { authToken = token; }
export function getToken() { return authToken; }

async function request(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (body && !isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

export const api = {
  // auth
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: () => request('/auth/me'),

  // reference data
  qualifications: () => request('/qualifications'),
  criteria: () => request('/assessment-criteria'),

  // applicant
  createApplication: (payload) => request('/applications', { method: 'POST', body: payload }),
  myApplications: () => request('/applications/mine'),
  updateDraft: (id, payload) => request(`/applications/${id}`, { method: 'PATCH', body: payload }),
  submit: (id) => request(`/applications/${id}/submit`, { method: 'POST' }),

  // evidence
  uploadEvidence: (id, formData) =>
    request(`/applications/${id}/evidence`, { method: 'POST', body: formData, isForm: true }),
  deleteEvidence: (id) => request(`/evidence/${id}`, { method: 'DELETE' }),
  downloadUrl: (id) => `${BASE}/evidence/${id}/download`,

  // shared
  application: (id) => request(`/applications/${id}`),
  audit: (id) => request(`/applications/${id}/audit`),
  assessments: (id) => request(`/applications/${id}/assessment`),

  // assessor
  allocated: () => request('/applications/allocated'),
  recordAssessment: (id, payload) =>
    request(`/applications/${id}/assessment`, { method: 'POST', body: payload }),

  // moderator
  moderationQueue: () => request('/applications/moderation'),
  moderations: (id) => request(`/applications/${id}/moderation`),
  recordModeration: (id, payload) =>
    request(`/applications/${id}/moderation`, { method: 'POST', body: payload }),

  // administrator
  queue: (status) => request(`/applications/queue${status ? `?status=${status}` : ''}`),
  allApplications: () => request('/applications'),
  assessors: (qualificationId) =>
    request(`/admin/assessors${qualificationId ? `?qualificationId=${qualificationId}` : ''}`),
  users: () => request('/admin/users'),
  createStaff: (payload) => request('/admin/users', { method: 'POST', body: payload }),
  updateUser: (id, payload) => request(`/admin/users/${id}`, { method: 'PATCH', body: payload }),
  changeRole: (id, role) => request(`/admin/users/${id}/role`, { method: 'PATCH', body: { role } }),
  setQualifications: (id, qualificationIds) =>
    request(`/admin/users/${id}/qualifications`, { method: 'PUT', body: { qualificationIds } }),
  setActive: (id, active) =>
    request(`/admin/users/${id}/status`, { method: 'PATCH', body: { active } }),
  resetPassword: (id, password) =>
    request(`/admin/users/${id}/password`, { method: 'POST', body: { password } }),
  deleteUser: (id) => request(`/admin/users/${id}`, { method: 'DELETE' }),
  userAudit: () => request('/admin/audit'),
  allocate: (id, assessorId) =>
    request(`/applications/${id}/allocate`, { method: 'POST', body: { assessorId } }),
  returnToDraft: (id, note) =>
    request(`/applications/${id}/return`, { method: 'POST', body: { note } }),
  recordOutcome: (id, decision, rationale) =>
    request(`/applications/${id}/outcome`, { method: 'POST', body: { decision, rationale } }),
  statistics: () => request('/statistics'),
};

/**
 * Evidence is never a plain link: the download endpoint requires the bearer
 * token, so the file is fetched and handed to the browser as a blob.
 */
export async function downloadEvidence(evidenceId, filename) {
  const res = await fetch(api.downloadUrl(evidenceId), {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) throw new Error('Could not retrieve that evidence file.');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
