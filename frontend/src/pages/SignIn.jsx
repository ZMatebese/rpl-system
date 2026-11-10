import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Button, Field, Notice, inputClass } from '../components/ui.jsx';

const LANDING = {
  APPLICANT: '/applications',
  ASSESSOR: '/assess',
  ADMINISTRATOR: '/admin',
};

export function SignIn() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({
    email: '', password: '', firstName: '', surname: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user =
        mode === 'signin'
          ? await login(form.email, form.password)
          : await register(form);
      navigate(LANDING[user.role] ?? '/applications');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[1.1fr_1fr]">
      {/* The record itself is the hero: a specimen register page, which is
          what this system produces and what the applicant is entering. */}
      <aside className="hidden border-r border-rule bg-leaf p-12 md:block">
        <p className="font-display text-[15px] text-ink-soft">
          Cape Peninsula University of Technology
        </p>
        <h1 className="mt-6 max-w-[14ch] text-[42px] leading-[1.1]">
          Every decision, on the record.
        </h1>
        <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-ink-soft">
          Recognition of Prior Learning turns work and life experience into
          credit. This register holds each application, the evidence behind it,
          and the reasoning for every outcome.
        </p>

        <div className="mt-12 border border-rule bg-paper">
          <div className="field-label border-b border-rule px-4 py-2">
            Specimen record
          </div>
          <dl className="divide-y divide-[var(--color-rule-soft)]">
            {[
              ['Reference', 'RPL/00148'],
              ['Qualification', 'Postgraduate Diploma in ICT'],
              ['Evidence on file', '6 items'],
              ['Outcome', 'Approved · two modules credited'],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[10rem_1fr] px-4 py-2.5">
                <dt className="field-label">{k}</dt>
                <dd className="text-[14px]">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>

      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-[26rem]">
          <h2 className="text-[24px]">
            {mode === 'signin' ? 'Sign in' : 'Create an applicant account'}
          </h2>
          <p className="mt-1 mb-7 text-[14px] text-ink-soft">
            {mode === 'signin'
              ? 'Applicants, assessors and registrar staff use the same entrance.'
              : 'New accounts begin as applicants. Staff roles are assigned by the registrar.'}
          </p>

          <Notice kind="error">{error}</Notice>

          <form onSubmit={onSubmit} noValidate>
            {mode === 'register' && (
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Field label="First name" id="firstName">
                  <input id="firstName" className={inputClass} value={form.firstName}
                         onChange={set('firstName')} autoComplete="given-name" required />
                </Field>
                <Field label="Surname" id="surname">
                  <input id="surname" className={inputClass} value={form.surname}
                         onChange={set('surname')} autoComplete="family-name" required />
                </Field>
              </div>
            )}

            <Field label="Email address" id="email">
              <input id="email" type="email" className={inputClass} value={form.email}
                     onChange={set('email')} autoComplete="email" required />
            </Field>

            <Field
              label="Password"
              id="password"
              hint={mode === 'register'
                ? 'At least 10 characters, with upper case, lower case and a digit.'
                : undefined}
            >
              <input id="password" type="password" className={inputClass} value={form.password}
                     onChange={set('password')}
                     autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required />
            </Field>

            <Button variant="seal" className="mt-2 w-full" disabled={busy}>
              {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <p className="mt-6 text-[14px] text-ink-soft">
            {mode === 'signin' ? 'No account yet? ' : 'Already registered? '}
            <button
              onClick={() => { setMode(mode === 'signin' ? 'register' : 'signin'); setError(''); }}
              className="text-seal underline underline-offset-4"
            >
              {mode === 'signin' ? 'Create one' : 'Sign in'}
            </button>
          </p>

          <details className="mt-10 border-t border-rule pt-4 text-[13px] text-ink-soft">
            <summary className="cursor-pointer">Demonstration accounts</summary>
            <ul className="mt-3 space-y-1">
              <li><span className="ref">applicant@rpl.local</span> &middot; Applicant#2026</li>
              <li><span className="ref">assessor@rpl.local</span> &middot; Assessor#2026</li>
              <li><span className="ref">moderator@rpl.local</span> &middot; Moderator#2026</li>
            </ul>
            <p className="mt-3">
              Synthetic data for a local prototype. The administrator account is set on the
              server, not listed here.
            </p>
          </details>
        </div>
      </div>
    </div>
  );
}
