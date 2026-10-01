import { useRef, useState } from 'react';
import { useResource } from '../../hooks/useResource';
import type { Campaign, Source, SourceSection } from '../../services/types';
import { request, json, errorMessage } from '../../services/client';
import { ErrorNotice } from '../../components/Controls';
export function SourceSections({
  campaign,
  source,
  onSaved,
}: {
  campaign: Campaign;
  source: Source;
  onSaved: () => Promise<void>;
}) {
  const sections = useResource<SourceSection[]>(
      `/campaigns/${campaign.id}/sources/${source.id}/sections`
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    guard = useRef(false),
    [feedback, setFeedback] = useState('');
  const wholePinned = campaign.pinnedSourceIds.includes(source.id);
  return (
    <details className="panel">
      <summary>Inspect & pin source sections</summary>
      <p className="muted">
        Pin only the rules needed every turn. Section references include this source version;
        correcting the source invalidates older section pins.
      </p>
      <ErrorNotice message={error || sections.error} />
      {feedback && <small role="status">{feedback}</small>}
      {wholePinned && (
        <p className="notice">
          This entire source is pinned in Journal. Unpin the whole source there to use section-only
          pins.
        </p>
      )}
      {sections.loading ? (
        <p role="status">Loading sections…</p>
      ) : (
        sections.data?.map((section) => {
          const selected = (campaign.pinnedSourceSections || []).some(
            (ref) =>
              ref.sourceId === source.id &&
              ref.version === section.version &&
              ref.index === section.index
          );
          return (
            <article className="source-section" key={section.id}>
              <div className="row wrap">
                <strong>
                  Section {section.index + 1}
                  {section.page !== null ? ` · page ${section.page}` : ''}
                </strong>
                <small>Source version {section.version}</small>
                <button
                  disabled={busy || wholePinned}
                  onClick={async () => {
                    if (guard.current) return;
                    guard.current = true;
                    setBusy(true);
                    setError('');
                    const ref = {
                      sourceId: source.id,
                      version: section.version,
                      index: section.index,
                    };
                    const pins = campaign.pinnedSourceSections || [];
                    try {
                      await request(
                        `/campaigns/${campaign.id}`,
                        json('PATCH', {
                          revision: campaign.revision,
                          pinnedSourceSections: selected
                            ? pins.filter(
                                (p) =>
                                  !(
                                    p.sourceId === ref.sourceId &&
                                    p.version === ref.version &&
                                    p.index === ref.index
                                  )
                              )
                            : [...pins, ref],
                        })
                      );
                      await onSaved();
                      await sections.reload();
                      setFeedback(
                        selected ? 'Section unpinned.' : 'Section pinned for future turns.'
                      );
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      guard.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  {selected ? 'Unpin section' : 'Pin section'}
                </button>
              </div>
              <p>{section.text}</p>
            </article>
          );
        })
      )}
      <button disabled={busy} onClick={() => void sections.reload()}>
        Refresh source sections
      </button>
    </details>
  );
}
