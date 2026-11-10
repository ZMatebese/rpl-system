import { STATE_META, formatDateTime } from './ui.jsx';

/**
 * The audit trail, rendered as a bound register: a ruled date gutter on the
 * left, the transition itself in the body, and the responsible actor in the
 * margin. Auditability is the point of this system, so this is the one place
 * the interface is emphatic.
 */
export function AuditLedger({ history }) {
  if (!history?.length) {
    return <p className="text-[14px] text-ink-soft">No entries recorded.</p>;
  }

  return (
    <div className="border border-rule bg-leaf">
      <div className="grid grid-cols-[auto_1fr] border-b border-rule bg-paper">
        <div className="field-label border-r border-rule px-4 py-2">Recorded</div>
        <div className="field-label px-4 py-2">Transition and responsible party</div>
      </div>

      <ol className="divide-y divide-[var(--color-rule-soft)]">
        {history.map((entry, index) => {
          const to = STATE_META[entry.new_status];
          const from = entry.previous_status ? STATE_META[entry.previous_status] : null;
          return (
            <li key={entry.id} className="grid grid-cols-[auto_1fr]">
              <div className="w-[9.5rem] border-r border-rule px-4 py-3">
                <div className="ref text-ink-soft">{formatDateTime(entry.changed_at)}</div>
                <div className="ref mt-0.5 text-[11px] text-[#8d9aa6]">
                  entry {String(index + 1).padStart(2, '0')}
                </div>
              </div>

              <div className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {from && entry.previous_status === entry.new_status ? (
                    <span className="text-[14px] text-ink-soft">Note on file at</span>
                  ) : from ? (
                    <>
                      <span className="text-[14px] text-ink-soft">{from.label}</span>
                      <span aria-hidden="true" className="text-[#a9b4bf]">&rarr;</span>
                    </>
                  ) : (
                    <span className="text-[14px] text-ink-soft">Opened as</span>
                  )}
                  <span
                    className="inline-flex items-center gap-1.5 text-[14px]"
                    style={{ color: to?.color }}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2 w-2"
                      style={{ backgroundColor: to?.color }}
                    />
                    {to?.label ?? entry.new_status}
                  </span>
                </div>

                <div className="mt-1 text-[13px] text-ink-soft">
                  {entry.actor_first_name} {entry.actor_surname}
                  <span className="text-[#9aa6b1]"> &middot; {entry.actor_role.toLowerCase()}</span>
                </div>

                {entry.note && (
                  <p className="mt-2 border-l-2 border-rule pl-3 text-[13px] text-ink">
                    {entry.note}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
