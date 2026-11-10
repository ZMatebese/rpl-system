import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { Button, Field, formatDateTime, inputClass } from './ui.jsx';

const RATINGS = [
  { value: 'NOT_MET', label: 'Not met' },
  { value: 'PARTIALLY_MET', label: 'Partially met' },
  { value: 'MET', label: 'Met' },
  { value: 'EXCEEDED', label: 'Exceeded' },
];

const RATING_LABEL = Object.fromEntries(RATINGS.map((r) => [r.value, r.label]));

export function AssessmentForm({ applicationId, onDone, onError }) {
  const [criteria, setCriteria] = useState([]);
  const [ratings, setRatings] = useState({});
  const [comments, setComments] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.criteria().then((d) => setCriteria(d.criteria)).catch((e) => onError(e.message));
  }, [onError]);

  const complete =
    criteria.length > 0 &&
    criteria.every((c) => ratings[c.key]) &&
    comments.trim() &&
    recommendation;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.recordAssessment(applicationId, {
        criterionRatings: ratings, comments, recommendation,
      });
      onDone();
    } catch (err) {
      onError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="register border-x border-rule">
        {criteria.map((c) => (
          <fieldset key={c.key} className="border-b border-[var(--color-rule-soft)] bg-leaf px-4 py-4">
            <legend className="sr-only">{c.label}</legend>
            <div className="mb-3">
              <div className="text-[15px]">{c.label}</div>
              <p className="mt-0.5 max-w-[60ch] text-[13px] text-ink-soft">{c.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {RATINGS.map((r) => {
                const checked = ratings[c.key] === r.value;
                return (
                  <label
                    key={r.value}
                    className={`cursor-pointer border px-3 py-1.5 text-[13px] ${
                      checked
                        ? 'border-seal bg-seal text-white'
                        : 'border-rule bg-paper text-ink hover:border-ink-soft'
                    }`}
                  >
                    <input
                      type="radio"
                      name={c.key}
                      value={r.value}
                      checked={checked}
                      onChange={() => setRatings((p) => ({ ...p, [c.key]: r.value }))}
                      className="sr-only"
                    />
                    {r.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-6 max-w-[70ch]">
        <Field
          label="Reasoning"
          id="comments"
          hint="What the evidence showed, and where it fell short. This is read at audit."
        >
          <textarea id="comments" rows={6} className={inputClass} value={comments}
                    onChange={(e) => setComments(e.target.value)} />
        </Field>

        <Field label="Recommendation" id="recommendation">
          <select id="recommendation" className={inputClass} value={recommendation}
                  onChange={(e) => setRecommendation(e.target.value)}>
            <option value="">Choose a recommendation</option>
            <option value="RECOMMEND_APPROVE">Recommend approval</option>
            <option value="RECOMMEND_REJECT">Recommend refusal</option>
          </select>
        </Field>

        <Button variant="seal" disabled={!complete || busy}>
          {busy ? 'Recording…' : 'Record assessment'}
        </Button>
        {!complete && (
          <p className="mt-2 text-[13px] text-ink-soft">
            Every criterion needs a rating, with reasoning and a recommendation.
          </p>
        )}
      </div>
    </form>
  );
}

export function AssessmentRecord({ assessment }) {
  const ratings = assessment.criterion_ratings ?? {};
  return (
    <article className={`mb-5 border border-rule bg-leaf ${assessment.superseded ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule bg-paper px-4 py-2">
        <span className="text-[13px] text-ink-soft">
          {assessment.assessor_first_name} {assessment.assessor_surname}
          <span className="text-[#9aa6b1]"> &middot; {formatDateTime(assessment.created_at)}</span>
        </span>
        <span className="text-[13px]" style={{ color: 'var(--color-seal)' }}>
          {assessment.recommendation === 'RECOMMEND_APPROVE'
            ? 'Recommended for approval'
            : 'Recommended for refusal'}
          {assessment.superseded ? ' · superseded' : ''}
        </span>
      </div>

      <dl className="divide-y divide-[var(--color-rule-soft)]">
        {Object.entries(ratings).map(([key, value]) => (
          <div key={key} className="grid grid-cols-[1fr_auto] gap-4 px-4 py-2">
            <dt className="text-[14px] capitalize">{key.replace(/_/g, ' ')}</dt>
            <dd className="text-[14px] text-ink-soft">{RATING_LABEL[value] ?? value}</dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-rule px-4 py-3">
        <p className="max-w-[70ch] whitespace-pre-wrap text-[14px]">{assessment.comments}</p>
      </div>
    </article>
  );
}
