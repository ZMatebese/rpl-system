import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import {
  Button, Empty, Field, Notice, PageHeading, Reference, StatusMark,
  formatDate, inputClass,
} from '../components/ui.jsx';

export function MyApplications() {
  const [applications, setApplications] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.myApplications()
      .then((d) => setApplications(d.applications))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <PageHeading
        title="My applications"
        caption="Each row is a file on the register. Open one to see its evidence and history."
      >
        <Button as="link" to="/applications/new" variant="seal">Start an application</Button>
      </PageHeading>

      <Notice kind="error">{error}</Notice>

      {applications === null && <p className="text-[14px] text-ink-soft">Loading…</p>}

      {applications?.length === 0 && (
        <Empty>
          Nothing on file yet. Starting an application opens a draft you can
          build up with evidence before submitting it.
        </Empty>
      )}

      {applications?.length > 0 && (
        <div className="register border-x border-rule">
          <div className="grid grid-cols-[7rem_1fr_9rem_7rem] border-b border-rule bg-paper">
            {['Reference', 'Qualification', 'Status', 'Updated'].map((h) => (
              <div key={h} className="field-label px-4 py-2">{h}</div>
            ))}
          </div>
          {applications.map((a) => (
            <Link
              key={a.id}
              to={`/applications/${a.id}`}
              className="grid grid-cols-[7rem_1fr_9rem_7rem] items-center border-b border-[var(--color-rule-soft)] bg-leaf hover:bg-paper"
            >
              <div className="px-4 py-3"><Reference id={a.id} /></div>
              <div className="px-4 py-3">
                <div className="text-[14px]">{a.qualification_title}</div>
                <div className="text-[13px] text-ink-soft">
                  {a.qualification_faculty ?? `NQF ${a.qualification_nqf_level}`} &middot; {a.evidence_count}{' '}
                  {a.evidence_count === 1 ? 'evidence item' : 'evidence items'}
                </div>
              </div>
              <div className="px-4 py-3"><StatusMark status={a.status} /></div>
              <div className="px-4 py-3 text-[13px] text-ink-soft">{formatDate(a.updated_at)}</div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export function NewApplication() {
  const navigate = useNavigate();
  const [qualifications, setQualifications] = useState([]);
  const [form, setForm] = useState({ qualificationId: '', rplRoute: 'ACCESS', motivation: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.qualifications()
      .then((d) => setQualifications(d.qualifications))
      .catch((e) => setError(e.message));
  }, []);

  const faculties = [...new Set(qualifications.map((q) => q.faculty ?? 'Other'))];
  const chosen = qualifications.find((q) => String(q.id) === String(form.qualificationId));
  const offersExemption = chosen?.rpl_type === 'ACCESS_EXEMPTION';

  function chooseQualification(id) {
    const q = qualifications.find((x) => String(x.id) === String(id));
    // An access-only qualification can only be applied for as access.
    setForm((f) => ({
      ...f,
      qualificationId: id,
      rplRoute: q?.rpl_type === 'ACCESS_EXEMPTION' ? f.rplRoute : 'ACCESS',
    }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { application } = await api.createApplication({
        qualificationId: Number(form.qualificationId),
        rplRoute: form.rplRoute,
        motivation: form.motivation,
      });
      navigate(`/applications/${application.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading
        title="Start an application"
        caption="This opens a draft. You can change it and add evidence until you submit. Apply for one qualification only."
      />
      <Notice kind="error">{error}</Notice>

      <form onSubmit={onSubmit} className="max-w-[46rem]">
        <Field
          label="Qualification"
          id="qualificationId"
          hint="Only qualifications CPUT currently accepts RPL applications for are listed."
        >
          <select
            id="qualificationId"
            className={inputClass}
            value={form.qualificationId}
            onChange={(e) => chooseQualification(e.target.value)}
            required
          >
            <option value="">Choose a qualification</option>
            {faculties.map((faculty) => (
              <optgroup key={faculty} label={faculty}>
                {qualifications
                  .filter((q) => (q.faculty ?? 'Other') === faculty)
                  .map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.title}{q.rpl_type === 'ACCESS' ? ' (access only)' : ''}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>

        {chosen && (
          <fieldset className="mb-5">
            <legend className="field-label mb-2">What are you applying for?</legend>
            <div className="grid gap-2">
              {[
                ['ACCESS', 'Access to the qualification',
                  'You do not meet the normal entry requirements, but have relevant work experience.'],
                ['EXEMPTION', 'Exemption from subjects',
                  'Your learning is matched against specific subjects. Exemptions are capped at 50% of the qualification.'],
                ['ACCESS_AND_EXEMPTION', 'Both access and exemption', 'Entry to the qualification and credit for subjects.'],
              ]
                .filter(([value]) => offersExemption || value === 'ACCESS')
                .map(([value, label, hint]) => (
                  <label key={value} className="flex items-start gap-3 border border-rule bg-leaf px-4 py-3">
                    <input
                      type="radio"
                      name="rplRoute"
                      className="mt-1"
                      value={value}
                      checked={form.rplRoute === value}
                      onChange={() => setForm((f) => ({ ...f, rplRoute: value }))}
                    />
                    <span>
                      <span className="block text-[14px]">{label}</span>
                      <span className="block text-[13px] text-ink-soft">{hint}</span>
                    </span>
                  </label>
                ))}
            </div>
            {!offersExemption && (
              <p className="mt-2 text-[13px] text-ink-soft">
                CPUT offers RPL for access only on this qualification.
              </p>
            )}
          </fieldset>
        )}

        <Field
          label="Motivation"
          id="motivation"
          hint="Your reasons for applying and an overview of your working life. Attach your CV, examples of your work and certified copies of certificates as evidence on the next page."
        >
          <textarea
            id="motivation"
            rows={9}
            className={inputClass}
            value={form.motivation}
            onChange={(e) => setForm((f) => ({ ...f, motivation: e.target.value }))}
            placeholder="Fifteen years administering identity and directory services, including…"
          />
        </Field>

        <div className="flex gap-3">
          <Button variant="seal" disabled={busy}>
            {busy ? 'Opening…' : 'Open draft'}
          </Button>
          <Button as="link" to="/applications">Cancel</Button>
        </div>
      </form>
    </>
  );
}
