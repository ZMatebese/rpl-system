import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, downloadEvidence } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { AuditLedger } from '../components/AuditLedger.jsx';
import { AssessmentForm, AssessmentRecord } from '../components/Assessment.jsx';
import {
  Button, Empty, Field, Notice, Reference, StatusMark,
  formatBytes, formatDate, inputClass, nqfLabel, RPL_ROUTE_LABEL, RPL_TYPE_LABEL,
} from '../components/ui.jsx';

export function ApplicationDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileInput = useRef(null);

  const [application, setApplication] = useState(null);
  const [assessments, setAssessments] = useState([]);
  const [assessors, setAssessors] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const { application: app } = await api.application(id);
      setApplication(app);
      const { assessments: list } = await api.assessments(id).catch(() => ({ assessments: [] }));
      setAssessments(list ?? []);
      if (user.role === 'ADMINISTRATOR' && app.status === 'SUBMITTED') {
        // Only active assessors scoped to this qualification are offered.
        const { assessors: a } = await api.assessors(app.qualification_id);
        setAssessors(a);
      }
    } catch (err) {
      setError(err.message);
    }
  }, [id, user.role]);

  useEffect(() => { load(); }, [load]);

  async function act(fn, successMessage) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await load();
      if (successMessage) setMessage(successMessage);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    body.append('evidenceType', 'OTHER');
    await act(() => api.uploadEvidence(id, body), `${file.name} added to the file.`);
    if (fileInput.current) fileInput.current.value = '';
  }

  if (error && !application) return <Notice kind="error">{error}</Notice>;
  if (!application) return <p className="text-[14px] text-ink-soft">Loading…</p>;

  const isOwner = application.applicant_id === user.id;
  const isDraft = application.status === 'DRAFT';
  const canSubmit = isOwner && isDraft;
  const canAssess =
    user.role === 'ASSESSOR' &&
    application.assigned_assessor_id === user.id &&
    application.status === 'UNDER_REVIEW';
  const isAdmin = user.role === 'ADMINISTRATOR';
  const canModerate = Boolean(application.canModerate);

  return (
    <>
      {/* File header band — the dossier cover */}
      <header className="mb-8 border border-rule bg-leaf">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-paper px-5 py-2.5">
          <Reference id={application.id} />
          <StatusMark status={application.status} />
        </div>

        <div className="px-5 py-5">
          <h1 className="text-[26px] leading-tight">{application.qualification_title}</h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            {[application.qualification_faculty, nqfLabel(application.qualification_nqf_level)]
              .filter(Boolean).join(' · ')}
            {application.qualification_saqa_id && (
              <> &middot; SAQA <span className="ref">{application.qualification_saqa_id}</span></>
            )}
          </p>

          <dl className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="field-label">Applicant</dt>
              <dd className="text-[14px]">
                {application.applicant_first_name} {application.applicant_surname}
              </dd>
            </div>
            <div>
              <dt className="field-label">Allocated assessor</dt>
              <dd className="text-[14px]">
                {application.assessor_first_name
                  ? `${application.assessor_first_name} ${application.assessor_surname}`
                  : 'Not yet allocated'}
              </dd>
            </div>
            <div>
              <dt className="field-label">RPL route requested</dt>
              <dd className="text-[14px]">
                {RPL_ROUTE_LABEL[application.rpl_route] ?? application.rpl_route}
                {application.qualification_rpl_type && (
                  <span className="text-ink-soft">
                    {' '}&middot; CPUT offers {RPL_TYPE_LABEL[application.qualification_rpl_type]?.toLowerCase()}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="field-label">Opened</dt>
              <dd className="text-[14px]">{formatDate(application.created_at)}</dd>
            </div>
          </dl>
        </div>
      </header>

      <Notice kind="error">{error}</Notice>
      <Notice kind="good">{message}</Notice>

      <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
        <div>
          <Section title="Motivation">
            {isOwner && isDraft ? (
              <MotivationEditor
                application={application}
                onSave={(motivation) =>
                  act(() => api.updateDraft(id, { motivation }), 'Motivation saved.')
                }
                busy={busy}
              />
            ) : application.motivation ? (
              <p className="max-w-[70ch] whitespace-pre-wrap text-[15px] leading-relaxed">
                {application.motivation}
              </p>
            ) : (
              <p className="text-[14px] text-ink-soft">No motivation recorded.</p>
            )}
          </Section>

          <Section
            title="Evidence"
            caption={
              isOwner && isDraft
                ? 'PDF, JPEG, PNG or Word, up to 10 MB each. Evidence is locked once you submit.'
                : undefined
            }
          >
            {application.evidence?.length ? (
              <div className="register border-x border-rule">
                {application.evidence.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--color-rule-soft)] bg-leaf px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px]">{ev.original_filename}</div>
                      <div className="text-[13px] text-ink-soft">
                        {formatBytes(ev.size_bytes)} &middot; added {formatDate(ev.uploaded_at)}
                      </div>
                    </div>
                    <button
                      onClick={() => downloadEvidence(ev.id, ev.original_filename).catch((e) => setError(e.message))}
                      className="text-[13px] text-seal underline underline-offset-4"
                    >
                      Download
                    </button>
                    {isOwner && isDraft && (
                      <button
                        onClick={() => act(() => api.deleteEvidence(ev.id), 'Evidence removed.')}
                        disabled={busy}
                        className="text-[13px] text-ink-soft underline underline-offset-4 hover:text-ink"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty>
                No evidence attached. An application needs at least one item before it can be submitted.
              </Empty>
            )}

            {isOwner && isDraft && (
              <div className="mt-4">
                <input
                  ref={fileInput}
                  type="file"
                  id="evidence-file"
                  onChange={onUpload}
                  disabled={busy}
                  accept=".pdf,.jpg,.jpeg,.png,.docx"
                  className="block w-full text-[14px] file:mr-4 file:border file:border-rule file:bg-leaf file:px-4 file:py-2 file:text-[14px] file:text-ink hover:file:bg-paper"
                />
              </div>
            )}
          </Section>

          {canAssess && (
            <Section
              title="Record your assessment"
              caption="Rate every criterion and give the reasoning. This closes the review."
            >
              <AssessmentForm
                applicationId={id}
                onDone={() => act(async () => {}, 'Assessment recorded. The registrar will ratify the outcome.')}
                onError={setError}
              />
            </Section>
          )}

          {assessments.length > 0 && (
            <Section title="Assessment">
              {assessments.map((a) => <AssessmentRecord key={a.id} assessment={a} />)}
            </Section>
          )}

          {canModerate && (
            <Section
              title="Moderate this assessment"
              caption="Check the ratings against the evidence. Your verdict is recorded on the file and seen by the registrar and the assessor."
            >
              <ModerationForm
                busy={busy}
                onRecord={(payload) =>
                  act(() => api.recordModeration(id, payload), 'Moderation recorded.')
                }
              />
            </Section>
          )}

          {application.moderations?.length > 0 && (
            <Section title="Moderation">
              {application.moderations.map((m) => (
                <article key={m.id} className="mb-4 border border-rule bg-leaf">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule bg-paper px-4 py-2">
                    <span className="text-[13px] text-ink-soft">
                      {m.moderator_first_name} {m.moderator_surname}
                      <span className="text-[#9aa6b1]"> &middot; {formatDate(m.created_at)}</span>
                    </span>
                    <span className="text-[13px]" style={{ color: 'var(--color-seal)' }}>
                      {m.verdict === 'CONFIRMED' ? 'Assessment confirmed' : 'Concerns recorded'}
                    </span>
                  </div>
                  <p className="max-w-[70ch] whitespace-pre-wrap px-4 py-3 text-[14px]">{m.comments}</p>
                </article>
              ))}
            </Section>
          )}

          {application.outcome_rationale && (
            <Section title="Outcome">
              <div className="border-l-2 border-seal bg-leaf px-4 py-3">
                <StatusMark status={application.status} />
                <p className="mt-2 max-w-[70ch] whitespace-pre-wrap text-[15px]">
                  {application.outcome_rationale}
                </p>
              </div>
            </Section>
          )}

          {application.history && (
            <Section title="History" caption="Every status change, with the responsible party.">
              <AuditLedger history={application.history} />
            </Section>
          )}
        </div>

        {/* Actions rail */}
        <aside className="lg:border-l lg:border-rule lg:pl-6">
          <h2 className="field-label mb-3">Available actions</h2>

          {canSubmit && (
            <div className="mb-5">
              <Button
                variant="seal"
                className="w-full"
                disabled={busy || application.evidence.length === 0 || !application.motivation?.trim()}
                onClick={() => act(() => api.submit(id), 'Submitted for assessment.')}
              >
                Submit for assessment
              </Button>
              {(application.evidence.length === 0 || !application.motivation?.trim()) && (
                <p className="mt-2 text-[13px] text-ink-soft">
                  Add at least one evidence item and a motivation to submit.
                </p>
              )}
            </div>
          )}

          {isAdmin && application.status === 'SUBMITTED' && (
            <AllocateForm
              assessors={assessors}
              busy={busy}
              onAllocate={(assessorId) =>
                act(() => api.allocate(id, assessorId), 'Allocated. The application is now under review.')
              }
              onReturn={(note) =>
                act(() => api.returnToDraft(id, note), 'Returned to the applicant.')
              }
            />
          )}

          {isAdmin && application.status === 'ASSESSMENT_COMPLETE' && (
            <OutcomeForm
              busy={busy}
              onDecide={(decision, rationale) =>
                act(() => api.recordOutcome(id, decision, rationale), 'Outcome recorded.')
              }
            />
          )}

          {!canSubmit && !canAssess && !canModerate &&
            !(isAdmin && ['SUBMITTED', 'ASSESSMENT_COMPLETE'].includes(application.status)) && (
              <p className="text-[14px] text-ink-soft">
                Nothing for you to do on this file right now.
              </p>
            )}

          <button
            onClick={() => navigate(-1)}
            className="mt-8 text-[14px] text-ink-soft underline underline-offset-4 hover:text-ink"
          >
            Back
          </button>
        </aside>
      </div>
    </>
  );
}

function Section({ title, caption, children }) {
  return (
    <section className="mb-10">
      <h2 className="mb-1 border-b border-rule pb-2 font-display text-[18px]">{title}</h2>
      {caption && <p className="mb-3 mt-2 text-[13px] text-ink-soft">{caption}</p>}
      <div className={caption ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

function MotivationEditor({ application, onSave, busy }) {
  const [value, setValue] = useState(application.motivation ?? '');
  const dirty = value !== (application.motivation ?? '');
  return (
    <div className="max-w-[70ch]">
      <textarea
        rows={8}
        className={inputClass}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Motivation"
      />
      <Button className="mt-3" disabled={!dirty || busy} onClick={() => onSave(value)}>
        Save motivation
      </Button>
    </div>
  );
}

function AllocateForm({ assessors, busy, onAllocate, onReturn }) {
  const [assessorId, setAssessorId] = useState('');
  const [note, setNote] = useState('');
  return (
    <div>
      <Field label="Allocate to an assessor" id="assessorId">
        <select
          id="assessorId"
          className={inputClass}
          value={assessorId}
          onChange={(e) => setAssessorId(e.target.value)}
        >
          <option value="">Choose an assessor</option>
          {assessors.map((a) => (
            <option key={a.id} value={a.id}>{a.first_name} {a.surname}</option>
          ))}
        </select>
      </Field>
      {assessors.length === 0 && (
        <p className="-mt-3 mb-4 text-[13px] text-seal">
          No active assessor covers this qualification. Add it to an assessor under People.
        </p>
      )}
      <Button
        variant="seal"
        className="w-full"
        disabled={!assessorId || busy}
        onClick={() => onAllocate(Number(assessorId))}
      >
        Allocate and open review
      </Button>

      <div className="mt-8 border-t border-rule pt-5">
        <Field label="Or return for more evidence" id="returnNote">
          <textarea id="returnNote" rows={3} className={inputClass} value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What the applicant still needs to provide" />
        </Field>
        <Button className="w-full" disabled={busy} onClick={() => onReturn(note)}>
          Return to applicant
        </Button>
      </div>
    </div>
  );
}

function OutcomeForm({ busy, onDecide }) {
  const [rationale, setRationale] = useState('');
  return (
    <div>
      <Field
        label="Outcome rationale"
        id="rationale"
        hint="Recorded against the file permanently and shown to the applicant."
      >
        <textarea id="rationale" rows={5} className={inputClass} value={rationale}
                  onChange={(e) => setRationale(e.target.value)} />
      </Field>
      <div className="grid gap-2">
        <Button variant="seal" disabled={!rationale.trim() || busy}
                onClick={() => onDecide('approve', rationale)}>
          Approve application
        </Button>
        <Button disabled={!rationale.trim() || busy}
                onClick={() => onDecide('reject', rationale)}>
          Record as not approved
        </Button>
      </div>
    </div>
  );
}

function ModerationForm({ busy, onRecord }) {
  const [verdict, setVerdict] = useState('CONFIRMED');
  const [comments, setComments] = useState('');
  return (
    <div className="max-w-[70ch]">
      <fieldset className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
        <legend className="field-label mb-2">Verdict</legend>
        {[
          ['CONFIRMED', 'Assessment confirmed'],
          ['CONCERNS', 'Concerns about the assessment'],
        ].map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-[14px]">
            <input type="radio" name="verdict" value={value}
                   checked={verdict === value} onChange={() => setVerdict(value)} />
            {label}
          </label>
        ))}
      </fieldset>
      <Field label="Comments" id="moderation-comments">
        <textarea id="moderation-comments" rows={5} className={inputClass}
                  value={comments} onChange={(e) => setComments(e.target.value)} />
      </Field>
      <Button
        variant="seal"
        disabled={!comments.trim() || busy}
        onClick={() => { onRecord({ verdict, comments }); setComments(''); }}
      >
        Record moderation
      </Button>
    </div>
  );
}
