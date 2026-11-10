import { Link } from 'react-router-dom';

export const STATE_META = {
  DRAFT:               { label: 'Draft',               color: 'var(--color-state-draft)' },
  SUBMITTED:           { label: 'Submitted',           color: 'var(--color-state-progress)' },
  UNDER_REVIEW:        { label: 'Under review',        color: 'var(--color-state-review)' },
  ASSESSMENT_COMPLETE: { label: 'Assessment complete', color: 'var(--color-state-review)' },
  APPROVED:            { label: 'Approved',            color: 'var(--color-state-approved)' },
  REJECTED:            { label: 'Not approved',        color: 'var(--color-state-rejected)' },
};

/** A square register mark rather than a pill badge — this is a file status,
 *  the way a registrar would annotate a record. */
export function StatusMark({ status, className = '' }) {
  const meta = STATE_META[status] ?? { label: status, color: 'var(--color-ink-soft)' };
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0"
        style={{ backgroundColor: meta.color }}
      />
      <span className="text-[13px]" style={{ color: meta.color }}>{meta.label}</span>
    </span>
  );
}

export function Reference({ id }) {
  return <span className="ref text-ink-soft">RPL/{String(id).padStart(5, '0')}</span>;
}

export function Button({ as = 'button', variant = 'default', className = '', ...props }) {
  const base =
    'inline-flex items-center justify-center px-4 py-2 text-[14px] font-medium ' +
    'transition-colors disabled:opacity-45 disabled:cursor-not-allowed';
  const variants = {
    default: 'border border-rule bg-leaf text-ink hover:bg-paper',
    seal: 'bg-seal text-white hover:bg-[#67262c] border border-seal',
    quiet: 'text-ink-soft hover:text-ink underline underline-offset-4 px-0 py-0',
  };
  const Component = as === 'link' ? Link : as;
  return <Component className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Field({ label, hint, children, id }) {
  return (
    <div className="mb-5">
      <label htmlFor={id} className="field-label mb-1.5 block">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-[13px] text-ink-soft">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'w-full border border-rule bg-leaf px-3 py-2 text-[15px] text-ink ' +
  'placeholder:text-[#8d9aa6] focus:border-seal focus:outline-none';

export function Notice({ kind = 'info', children }) {
  if (!children) return null;
  const colors = {
    info:  { border: 'var(--color-rule)',      bg: 'var(--color-leaf)',      fg: 'var(--color-ink)' },
    error: { border: '#d7b5b5',                bg: 'var(--color-seal-weak)', fg: '#6d272d' },
    good:  { border: '#b7cfc1',                bg: '#eaf3ee',                fg: '#235540' },
  }[kind];
  return (
    <div
      role={kind === 'error' ? 'alert' : undefined}
      className="mb-5 border-l-2 px-4 py-3 text-[14px]"
      style={{ borderLeftColor: colors.border, background: colors.bg, color: colors.fg }}
    >
      {children}
    </div>
  );
}

export function PageHeading({ title, caption, children }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-4">
      <div>
        <h1 className="text-[28px] leading-tight">{title}</h1>
        {caption && <p className="mt-1 text-[14px] text-ink-soft">{caption}</p>}
      </div>
      {children && <div className="flex gap-2">{children}</div>}
    </header>
  );
}

export function Empty({ children }) {
  return (
    <div className="border border-dashed border-rule bg-leaf px-6 py-10 text-center text-[14px] text-ink-soft">
      {children}
    </div>
  );
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'));
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z'));
  return d.toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
