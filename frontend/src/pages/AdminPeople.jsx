import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import {
  Button, Empty, Field, Notice, PageHeading, formatDateTime, inputClass, nqfLabel,
} from '../components/ui.jsx';

const ROLE_LABEL = {
  APPLICANT: 'Applicant',
  ASSESSOR: 'Assessor',
  MODERATOR: 'Moderator',
  ADMINISTRATOR: 'Registrar (administrator)',
};

// The administrator role is never offered: there is one administrator, set on
// the server with `npm run seed:admin`. The server refuses it regardless.
const ASSIGNABLE = ['APPLICANT', 'ASSESSOR', 'MODERATOR'];
const STAFF = ['ASSESSOR', 'MODERATOR'];

const FILTERS = [
  { key: 'STAFF', label: 'Staff' },
  { key: 'APPLICANT', label: 'Applicants' },
  { key: 'INACTIVE', label: 'Deactivated' },
  { key: 'ALL', label: 'Everyone' },
];

/**
 * People: the administrator's account management screen.
 * Read (the register), write (create staff, change role, scope, name,
 * password, deactivate) and delete (only for accounts with no record).
 */
export function People() {
  const [users, setUsers] = useState(null);
  const [qualifications, setQualifications] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState('STAFF');
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.users().then((d) => setUsers(d.users)).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    api.qualifications().then((d) => setQualifications(d.qualifications)).catch(() => {});
  }, []);

  const qualTitle = useMemo(
    () => Object.fromEntries(qualifications.map((q) => [q.id, q.title])),
    [qualifications]
  );

  async function act(fn, success) {
    setBusy(true); setError(''); setMessage('');
    try {
      await fn();
      await load();
      if (success) setMessage(success);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const shown = (users ?? []).filter((u) => {
    if (filter === 'ALL') return true;
    if (filter === 'INACTIVE') return !u.active;
    if (filter === 'STAFF') return u.active && (STAFF.includes(u.role) || u.role === 'ADMINISTRATOR');
    return u.active && u.role === filter;
  });

  return (
    <>
      <PageHeading
        title="People"
        caption="You are the only administrator. Create assessors and moderators, set what they may assess, and deactivate or remove accounts."
      >
        {!creating && (
          <Button variant="seal" onClick={() => { setCreating(true); setOpenId(null); }}>
            Add staff member
          </Button>
        )}
      </PageHeading>

      <Notice kind="error">{error}</Notice>
      <Notice kind="good">{message}</Notice>

      {creating && (
        <CreateStaffForm
          qualifications={qualifications}
          busy={busy}
          onCancel={() => setCreating(false)}
          onCreate={async (payload) => {
            const ok = await act(
              () => api.createStaff(payload),
              `${payload.firstName} ${payload.surname} added as ${ROLE_LABEL[payload.role].toLowerCase()}.`
            );
            if (ok) { setCreating(false); setFilter('STAFF'); }
          }}
        />
      )}

      <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`border-b-2 pb-0.5 text-[14px] ${
              filter === f.key ? 'border-seal text-ink' : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {users === null && <p className="text-[14px] text-ink-soft">Loading…</p>}
      {users && shown.length === 0 && <Empty>Nobody matches that filter.</Empty>}

      {shown.length > 0 && (
        <div className="register border-x border-rule">
          <div className="grid grid-cols-[1fr_1fr_10rem_7rem] border-b border-rule bg-paper">
            {['Name', 'Qualifications', 'Role', ''].map((h, i) => (
              <div key={i} className="field-label px-4 py-2">{h}</div>
            ))}
          </div>

          {shown.map((u) => {
            const isAdmin = u.role === 'ADMINISTRATOR';
            const open = openId === u.id;
            return (
              <div key={u.id} className="border-b border-[var(--color-rule-soft)] bg-leaf">
                <div className="grid grid-cols-[1fr_1fr_10rem_7rem] items-center">
                  <div className="px-4 py-3">
                    <div className="text-[14px]">
                      {u.first_name} {u.surname}
                      {!u.active && (
                        <span className="ml-2 text-[12px] uppercase tracking-wide text-[#9aa6b1]">
                          deactivated
                        </span>
                      )}
                    </div>
                    <div className="ref text-[12px] text-ink-soft">{u.email}</div>
                  </div>
                  <div className="px-4 py-3 text-[13px] text-ink-soft">
                    {STAFF.includes(u.role)
                      ? qualifications.length > 0 &&
                        qualifications.every((q) => u.qualificationIds.includes(q.id))
                        ? 'All qualifications'
                        : u.qualificationIds.length
                        ? u.qualificationIds.map((id) => qualTitle[id] ?? `#${id}`).join('; ')
                        : <span className="text-seal">None. Cannot be allocated work</span>
                      : '—'}
                  </div>
                  <div className="px-4 py-3 text-[14px]">{ROLE_LABEL[u.role]}</div>
                  <div className="px-4 py-3 text-right">
                    {isAdmin ? (
                      <span className="text-[12px] text-[#9aa6b1]">set on server</span>
                    ) : (
                      <button
                        onClick={() => { setOpenId(open ? null : u.id); setCreating(false); }}
                        className="text-[13px] text-seal underline underline-offset-4"
                        aria-expanded={open}
                      >
                        {open ? 'Close' : 'Manage'}
                      </button>
                    )}
                  </div>
                </div>

                {open && !isAdmin && (
                  <ManagePanel
                    user={u}
                    qualifications={qualifications}
                    busy={busy}
                    act={act}
                    onDeleted={() => setOpenId(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function QualificationPicker({ qualifications, value, onChange, idPrefix }) {
  const toggle = (id) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const faculties = [...new Set(qualifications.map((q) => q.faculty ?? 'Other'))];
  const all = qualifications.length > 0 && qualifications.every((q) => value.includes(q.id));
  return (
    <div>
      <label className="mb-3 flex items-center gap-2 text-[13px] text-ink-soft">
        <input type="checkbox" checked={all}
               onChange={() => onChange(all ? [] : qualifications.map((q) => q.id))} />
        All qualifications
      </label>
      {faculties.map((faculty) => (
        <fieldset key={faculty} className="mb-4">
          <legend className="mb-1.5 text-[13px] font-medium">{faculty}</legend>
          <FacultyQualifications
            qualifications={qualifications.filter((q) => (q.faculty ?? 'Other') === faculty)}
            value={value} toggle={toggle} idPrefix={idPrefix}
          />
        </fieldset>
      ))}
    </div>
  );
}

function FacultyQualifications({ qualifications, value, toggle, idPrefix }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {qualifications.map((q) => (
        <label key={q.id} htmlFor={`${idPrefix}-${q.id}`} className="flex items-start gap-2 text-[14px]">
          <input
            id={`${idPrefix}-${q.id}`}
            type="checkbox"
            className="mt-1"
            checked={value.includes(q.id)}
            onChange={() => toggle(q.id)}
          />
          <span>
            {q.title} <span className="text-[12px] text-ink-soft">{nqfLabel(q.nqf_level)}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function CreateStaffForm({ qualifications, busy, onCreate, onCancel }) {
  const [form, setForm] = useState({
    firstName: '', surname: '', email: '', role: 'ASSESSOR', password: '', qualificationIds: [],
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <form
      className="mb-8 border border-rule bg-leaf px-5 py-5"
      onSubmit={(e) => { e.preventDefault(); onCreate(form); }}
    >
      <h2 className="mb-4 font-display text-[18px]">New staff member</h2>
      <div className="grid gap-x-6 sm:grid-cols-2">
        <Field label="First name" id="cs-first">
          <input id="cs-first" className={inputClass} value={form.firstName} onChange={set('firstName')} required />
        </Field>
        <Field label="Surname" id="cs-surname">
          <input id="cs-surname" className={inputClass} value={form.surname} onChange={set('surname')} required />
        </Field>
        <Field label="Email" id="cs-email">
          <input id="cs-email" type="email" className={inputClass} value={form.email} onChange={set('email')} required />
        </Field>
        <Field label="Role" id="cs-role" hint="Moderators review assessed files for quality; assessors judge evidence.">
          <select id="cs-role" className={inputClass} value={form.role} onChange={set('role')}>
            <option value="ASSESSOR">Assessor</option>
            <option value="MODERATOR">Moderator</option>
          </select>
        </Field>
        <Field
          label="Temporary password"
          id="cs-password"
          hint="At least 10 characters, with upper case, lower case and a digit. Give it to them in person."
        >
          <input id="cs-password" type="text" autoComplete="off" className={inputClass}
                 value={form.password} onChange={set('password')} required />
        </Field>
      </div>

      <div className="mb-5">
        <div className="field-label mb-2">Qualifications they may {form.role === 'MODERATOR' ? 'moderate' : 'assess'}</div>
        <QualificationPicker
          qualifications={qualifications}
          value={form.qualificationIds}
          onChange={(qualificationIds) => setForm({ ...form, qualificationIds })}
          idPrefix="cs-q"
        />
      </div>

      <div className="flex gap-3">
        <Button variant="seal" disabled={busy}>Create account</Button>
        <Button type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

function ManagePanel({ user, qualifications, busy, act, onDeleted }) {
  const [scope, setScope] = useState(user.qualificationIds);
  const [name, setName] = useState({ firstName: user.first_name, surname: user.surname });
  const [password, setPassword] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isStaff = STAFF.includes(user.role);
  const scopeDirty = JSON.stringify([...scope].sort()) !== JSON.stringify([...user.qualificationIds].sort());
  const nameDirty = name.firstName !== user.first_name || name.surname !== user.surname;

  return (
    <div className="grid gap-8 border-t border-rule bg-paper px-5 py-5 lg:grid-cols-2">
      <div>
        <Field label="Role" id={`role-${user.id}`}>
          <select
            id={`role-${user.id}`}
            className={inputClass}
            value={user.role}
            disabled={busy}
            onChange={(e) =>
              act(() => api.changeRole(user.id, e.target.value),
                `${user.first_name} is now ${ROLE_LABEL[e.target.value].toLowerCase()}.`)
            }
          >
            {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>

        {isStaff && (
          <div className="mb-5">
            <div className="field-label mb-2">
              Qualifications they may {user.role === 'MODERATOR' ? 'moderate' : 'assess'}
            </div>
            <QualificationPicker
              qualifications={qualifications}
              value={scope}
              onChange={setScope}
              idPrefix={`q-${user.id}`}
            />
            <Button
              className="mt-3"
              disabled={!scopeDirty || busy}
              onClick={() => act(() => api.setQualifications(user.id, scope), 'Qualifications updated.')}
            >
              Save qualifications
            </Button>
          </div>
        )}

        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="First name" id={`fn-${user.id}`}>
            <input id={`fn-${user.id}`} className={inputClass} value={name.firstName}
                   onChange={(e) => setName({ ...name, firstName: e.target.value })} />
          </Field>
          <Field label="Surname" id={`sn-${user.id}`}>
            <input id={`sn-${user.id}`} className={inputClass} value={name.surname}
                   onChange={(e) => setName({ ...name, surname: e.target.value })} />
          </Field>
        </div>
        <Button
          disabled={!nameDirty || busy}
          onClick={() => act(() => api.updateUser(user.id, name), 'Name updated.')}
        >
          Save name
        </Button>
      </div>

      <div>
        <Field label="Reset password" id={`pw-${user.id}`} hint="Takes effect immediately. Tell them the new password in person.">
          <input id={`pw-${user.id}`} type="text" autoComplete="off" className={inputClass}
                 value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button
          disabled={!password || busy}
          onClick={async () => {
            const ok = await act(() => api.resetPassword(user.id, password), 'Password reset.');
            if (ok) setPassword('');
          }}
        >
          Set new password
        </Button>

        <div className="mt-8 border-t border-rule pt-5">
          <div className="field-label mb-2">Access</div>
          {user.active ? (
            <>
              <p className="mb-3 text-[13px] text-ink-soft">
                Deactivating blocks sign-in at once and keeps everything they have done on file.
              </p>
              <Button
                disabled={busy}
                onClick={() => act(() => api.setActive(user.id, false), `${user.first_name} deactivated.`)}
              >
                Deactivate account
              </Button>
            </>
          ) : (
            <Button
              variant="seal"
              disabled={busy}
              onClick={() => act(() => api.setActive(user.id, true), `${user.first_name} reactivated.`)}
            >
              Reactivate account
            </Button>
          )}
        </div>

        <div className="mt-8 border-t border-rule pt-5">
          <div className="field-label mb-2">Delete</div>
          <p className="mb-3 text-[13px] text-ink-soft">
            Only possible if this account has never been used on an application. Otherwise, deactivate it.
          </p>
          {!confirmDelete ? (
            <Button disabled={busy} onClick={() => setConfirmDelete(true)}>Delete account…</Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="seal"
                disabled={busy}
                onClick={async () => {
                  const ok = await act(() => api.deleteUser(user.id),
                    `${user.first_name} ${user.surname} deleted.`);
                  if (ok) onDeleted(); else setConfirmDelete(false);
                }}
              >
                Yes, delete permanently
              </Button>
              <Button disabled={busy} onClick={() => setConfirmDelete(false)}>Keep</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const ACTION_LABEL = {
  ADMIN_CREATED: 'Administrator set',
  ADMIN_UPDATED: 'Administrator updated',
  USER_CREATED: 'Account created',
  ROLE_CHANGED: 'Role changed',
  SCOPE_CHANGED: 'Qualifications changed',
  DETAILS_CHANGED: 'Name changed',
  PASSWORD_RESET: 'Password reset',
  USER_DEACTIVATED: 'Deactivated',
  USER_REACTIVATED: 'Reactivated',
  USER_DELETED: 'Deleted',
};

/** Every account change, newest first. Insert-only on the server. */
export function ActivityLog() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.userAudit().then((d) => setEntries(d.entries)).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <PageHeading
        title="Account activity"
        caption="Every change made to an account, and by whom. Entries cannot be edited or removed."
      />
      <Notice kind="error">{error}</Notice>
      {entries === null && <p className="text-[14px] text-ink-soft">Loading…</p>}
      {entries?.length === 0 && <Empty>No account changes recorded yet.</Empty>}

      {entries?.length > 0 && (
        <div className="register border-x border-rule">
          <div className="grid grid-cols-[10rem_11rem_1fr] border-b border-rule bg-paper">
            {['When', 'Change', 'Account and detail'].map((h) => (
              <div key={h} className="field-label px-4 py-2">{h}</div>
            ))}
          </div>
          {entries.map((e) => (
            <div key={e.id} className="grid grid-cols-[10rem_11rem_1fr] border-b border-[var(--color-rule-soft)] bg-leaf">
              <div className="ref px-4 py-3 text-ink-soft">{formatDateTime(e.created_at)}</div>
              <div className="px-4 py-3 text-[14px]">{ACTION_LABEL[e.action] ?? e.action}</div>
              <div className="px-4 py-3">
                <div className="ref text-[13px]">{e.target_email ?? '—'}</div>
                {e.detail && <div className="mt-0.5 text-[13px] text-ink-soft">{e.detail}</div>}
                <div className="mt-0.5 text-[12px] text-[#9aa6b1]">
                  by {e.actor_email ?? 'server script'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
