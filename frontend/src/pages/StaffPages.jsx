import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import {
  Empty, Notice, PageHeading, Reference, StatusMark, formatDate,
} from '../components/ui.jsx';

function ApplicationRegister({ applications, columns = 'full' }) {
  const grid =
    columns === 'full'
      ? 'grid-cols-[7rem_1fr_11rem_9rem_7rem]'
      : 'grid-cols-[7rem_1fr_11rem_7rem]';

  const headers =
    columns === 'full'
      ? ['Reference', 'Qualification', 'Applicant', 'Status', 'Updated']
      : ['Reference', 'Qualification', 'Applicant', 'Updated'];

  return (
    <div className="register border-x border-rule">
      <div className={`grid ${grid} border-b border-rule bg-paper`}>
        {headers.map((h) => <div key={h} className="field-label px-4 py-2">{h}</div>)}
      </div>
      {applications.map((a) => (
        <Link
          key={a.id}
          to={`/applications/${a.id}`}
          className={`grid ${grid} items-center border-b border-[var(--color-rule-soft)] bg-leaf hover:bg-paper`}
        >
          <div className="px-4 py-3"><Reference id={a.id} /></div>
          <div className="px-4 py-3">
            <div className="text-[14px]">{a.qualification_title}</div>
            <div className="text-[13px] text-ink-soft">
              NQF {a.qualification_nqf_level} &middot; {a.evidence_count}{' '}
              {a.evidence_count === 1 ? 'item' : 'items'}
            </div>
          </div>
          <div className="px-4 py-3 text-[14px]">
            {a.applicant_first_name} {a.applicant_surname}
          </div>
          {columns === 'full' && (
            <div className="px-4 py-3"><StatusMark status={a.status} /></div>
          )}
          <div className="px-4 py-3 text-[13px] text-ink-soft">{formatDate(a.updated_at)}</div>
        </Link>
      ))}
    </div>
  );
}

export function AssessorWorkspace() {
  const [applications, setApplications] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.allocated().then((d) => setApplications(d.applications)).catch((e) => setError(e.message));
  }, []);

  const open = applications?.filter((a) => a.status === 'UNDER_REVIEW') ?? [];
  const closed = applications?.filter((a) => a.status !== 'UNDER_REVIEW') ?? [];

  return (
    <>
      <PageHeading
        title="Allocated to me"
        caption="Applications the registrar has assigned to you for assessment."
      />
      <Notice kind="error">{error}</Notice>

      {applications === null && <p className="text-[14px] text-ink-soft">Loading…</p>}

      {applications?.length === 0 && (
        <Empty>Nothing allocated to you at the moment.</Empty>
      )}

      {open.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 font-display text-[18px]">Awaiting your assessment</h2>
          <ApplicationRegister applications={open} columns="compact" />
        </section>
      )}

      {closed.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-[18px]">Previously assessed</h2>
          <ApplicationRegister applications={closed} />
        </section>
      )}
    </>
  );
}

export function TriageQueue() {
  const [applications, setApplications] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.queue('SUBMITTED'), api.statistics()])
      .then(([q, s]) => { setApplications(q.applications); setStats(s); })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <PageHeading
        title="Triage queue"
        caption="Submitted applications waiting to be allocated to an assessor."
      />
      <Notice kind="error">{error}</Notice>

      {stats && (
        <div className="mb-8 grid grid-cols-2 border border-rule bg-leaf sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(stats.byStatus).map(([status, count]) => (
            <div key={status} className="border-b border-r border-[var(--color-rule-soft)] px-4 py-3">
              <div className="font-display text-[24px] leading-none">{count}</div>
              <div className="mt-1.5"><StatusMark status={status} /></div>
            </div>
          ))}
        </div>
      )}

      {applications === null && <p className="text-[14px] text-ink-soft">Loading…</p>}

      {applications?.length === 0 && (
        <Empty>The queue is clear. Nothing is waiting for allocation.</Empty>
      )}

      {applications?.length > 0 && (
        <ApplicationRegister applications={applications} columns="compact" />
      )}
    </>
  );
}

export function AllApplications() {
  const [applications, setApplications] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    api.allApplications().then((d) => setApplications(d.applications)).catch((e) => setError(e.message));
  }, []);

  const shown = applications?.filter((a) => filter === 'ALL' || a.status === filter) ?? [];

  const FILTERS = ['ALL', 'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ASSESSMENT_COMPLETE', 'APPROVED', 'REJECTED'];
  const FILTER_LABEL = {
    ALL: 'Everything', DRAFT: 'Draft', SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under review',
    ASSESSMENT_COMPLETE: 'Assessed', APPROVED: 'Approved', REJECTED: 'Not approved',
  };

  return (
    <>
      <PageHeading title="All applications" caption="The complete register." />
      <Notice kind="error">{error}</Notice>

      <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`border-b-2 pb-0.5 text-[14px] ${
              filter === f ? 'border-seal text-ink' : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      {applications === null && <p className="text-[14px] text-ink-soft">Loading…</p>}
      {applications && shown.length === 0 && <Empty>Nothing matches that filter.</Empty>}
      {shown.length > 0 && <ApplicationRegister applications={shown} />}
    </>
  );
}

export function ModeratorWorkspace() {
  const [applications, setApplications] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.moderationQueue().then((d) => setApplications(d.applications)).catch((e) => setError(e.message));
  }, []);

  const awaiting = applications?.filter((a) => a.status === 'ASSESSMENT_COMPLETE') ?? [];
  const decided = applications?.filter((a) => a.status !== 'ASSESSMENT_COMPLETE') ?? [];

  return (
    <>
      <PageHeading
        title="For moderation"
        caption="Assessed applications for the qualifications you moderate. Confirm the assessment or record concerns."
      />
      <Notice kind="error">{error}</Notice>

      {applications === null && <p className="text-[14px] text-ink-soft">Loading…</p>}

      {applications?.length === 0 && (
        <Empty>No assessed applications in your qualifications yet.</Empty>
      )}

      {awaiting.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 font-display text-[18px]">Assessed, awaiting the registrar</h2>
          <ApplicationRegister applications={awaiting} columns="compact" />
        </section>
      )}

      {decided.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-[18px]">Decided</h2>
          <ApplicationRegister applications={decided} />
        </section>
      )}
    </>
  );
}
