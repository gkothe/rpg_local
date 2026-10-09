import { useEffect, useRef, useState } from 'react';
import { request, errorMessage } from '../../services/client';
import type { AtlasData } from './types';
interface Draft {
  geography: {
    places: { key: string; title: string; text: string; certainty: string }[];
    changes: {
      frames?: { value: { label: string; floor: string } }[];
      routes?: {
        value: { from: unknown; to: unknown; kind: string; access: string; certainty: string };
      }[];
    };
  };
  observations: { key: string; uncertainty: string }[];
}
interface Job {
  auditOnly?: boolean;
  processing: boolean;
  reviewable: boolean;
  cancellable: boolean;
  restartable: boolean;
  id: string;
  status: string;
  draft: Draft | null;
  error: string | null;
  applied: boolean;
}
export default function AtlasImportReview({
  campaignId,
  map,
  onSaved,
  imageTypes,
}: {
  campaignId: string;
  map: AtlasData;
  onSaved: () => Promise<void>;
  imageTypes?: string[];
}) {
  const [file, setFile] = useState<File | null>(null),
    [legend, setLegend] = useState(''),
    [job, setJob] = useState<Job | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [routes, setRoutes] = useState<number[]>([]),
    [frames, setFrames] = useState<number[]>([]),
    [matches, setMatches] = useState<Record<string, string>>({}),
    [playerSafe, setPlayerSafe] = useState(false);
  const [imports, setImports] = useState<{
    jobs: { id: string; status: string; createdAt: string }[];
    nextCursor: number | null;
  } | null>(null);
  const initializedReview = useRef<string | null>(null);
  const guard = useRef(false),
    epoch = useRef(0),
    identity = useRef<{ file: File; legend: string; scope: string | null; id: string } | null>(
      null
    ),
    acceptId = useRef<{ body: string; id: string } | null>(null);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [campaignId]
  );
  useEffect(() => {
    if (!job?.processing) return;
    const generation = epoch.current;
    const timer = setTimeout(() => {
      void request<Job>(`/campaigns/${campaignId}/atlas/imports/${job.id}`)
        .then((result) => {
          if (generation === epoch.current) setJob(result);
        })
        .catch((e) => {
          if (generation === epoch.current) setError(errorMessage(e));
        });
    }, 1500);
    return () => clearTimeout(timer);
  }, [campaignId, job]);
  useEffect(() => {
    if (job?.draft && initializedReview.current !== job.id) {
      initializedReview.current = job.id;
      setMatches({});
      setPlayerSafe(false);
      setSelected(job.draft.geography.places.map((p) => p.key));
      setRoutes(job.draft.geography.changes.routes?.map((_, i) => i) ?? []);
      setFrames(job.draft.geography.changes.frames?.map((_, i) => i) ?? []);
    }
  }, [job?.draft, job?.id]);
  async function perform(action: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    const generation = epoch.current;
    try {
      await action();
    } catch (e) {
      if (generation === epoch.current) setError(errorMessage(e));
    } finally {
      if (generation === epoch.current) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  async function start() {
    if (!file) return;
    if (
      identity.current?.file !== file ||
      identity.current.legend !== legend ||
      identity.current.scope !== map.scope
    )
      identity.current = { file, legend, scope: map.scope, id: crypto.randomUUID() };
    const data = new FormData();
    data.append('file', file);
    data.append('requestId', identity.current.id);
    data.append('legend', legend);
    if (map.scope) data.append('scope', map.scope);
    const generation = epoch.current;
    const result = await request<Job>(`/campaigns/${campaignId}/atlas/imports`, {
      method: 'POST',
      body: data,
    });
    if (generation === epoch.current) setJob(result);
  }
  async function accept() {
    if (!job) return;
    const input = {
      selectedKeys: selected,
      selectedRoutes: routes,
      selectedFrames: frames,
      matches: Object.fromEntries(
        Object.entries(matches).filter(([key, id]) => selected.includes(key) && id)
      ),
      playerSafe,
    };
    const body = JSON.stringify(input);
    if (acceptId.current?.body !== body) acceptId.current = { body, id: crypto.randomUUID() };
    const generation = epoch.current;
    await request(`/campaigns/${campaignId}/atlas/imports/${job.id}/accept`, {
      method: 'POST',
      body: JSON.stringify({ ...input, requestId: acceptId.current.id }),
    });
    if (generation !== epoch.current) return;
    setJob({ ...job, applied: true });
    await onSaved();
  }
  const toggle = <T,>(values: T[], value: T) =>
    values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
  return (
    <details className="atlas-import">
      <summary>Import a map image</summary>
      <p>
        PNG or JPEG. Extraction creates a draft for review; it does not move the party. Image
        conversion requires a provider with native image attachments.
      </p>
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perform(start);
        }}
      >
        <label>
          Map image
          <input
            type="file"
            accept={imageTypes?.join(',')}
            required
            disabled={busy || job?.processing}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Legend and context
          <textarea value={legend} onChange={(e) => setLegend(e.target.value)} />
        </label>
        <button disabled={busy || !file || job?.processing || (job?.reviewable && !job.applied)}>
          Extract map draft
        </button>
      </form>
      {job && (
        <>
          <p role="status">Import: {job.status}</p>
          {job.error && <p role="alert">{job.error}</p>}
          {job.cancellable && !job.applied && (
            <button
              disabled={busy}
              onClick={() =>
                void perform(async () =>
                  setJob(await request<Job>(`/campaigns/${campaignId}/atlas/imports/${job.id}`))
                )
              }
            >
              Check extraction status
            </button>
          )}
          {job.cancellable && !job.applied && (
            <button
              disabled={busy}
              onClick={() =>
                void perform(async () =>
                  setJob(
                    await request<Job>(`/campaigns/${campaignId}/atlas/imports/${job.id}/cancel`, {
                      method: 'POST',
                    })
                  )
                )
              }
            >
              Discard import
            </button>
          )}
        </>
      )}
      {job && job.restartable && (
        <button
          disabled={busy}
          onClick={() => {
            identity.current = null;
            acceptId.current = null;
            setJob(null);
            setMatches({});
            setPlayerSafe(false);
          }}
        >
          Start a fresh import
        </button>
      )}
      <button
        disabled={busy}
        onClick={() =>
          void perform(async () => {
            setImports(await request(`/campaigns/${campaignId}/atlas/imports`));
          })
        }
      >
        Find saved image imports
      </button>
      {imports && (
        <div>
          <p>Recent image imports</p>
          {imports.jobs.map((i) => (
            <button
              key={i.id}
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  setJob(await request<Job>(`/campaigns/${campaignId}/atlas/imports/${i.id}`));
                })
              }
            >
              {i.status} — {new Date(i.createdAt).toLocaleString()}
            </button>
          ))}
          {imports.nextCursor !== null && (
            <button
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  setImports(
                    await request(
                      `/campaigns/${campaignId}/atlas/imports?cursor=${imports.nextCursor}`
                    )
                  );
                })
              }
            >
              Older imports
            </button>
          )}
        </div>
      )}
      {job?.auditOnly && (
        <p>
          Imported drafts are audit records. Start a fresh import to extract or accept new
          geography.
        </p>
      )}
      {job?.reviewable && !job.applied && job.draft && (
        <section>
          <h3>Review extracted geography</h3>
          <p>
            Check uncertain labels and passages. Reject dependent connections when rejecting a
            location. Existing matched layouts are preserved.
          </p>
          {job.draft.geography.places.map((p) => (
            <article key={p.key}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(p.key)}
                  onChange={() => setSelected(toggle(selected, p.key))}
                />
                Accept {p.title}
              </label>
              <p>
                {p.text} · {p.certainty}
              </p>
              <p>{job.draft!.observations.find((o) => o.key === p.key)?.uncertainty}</p>
              <label>
                Match existing place
                <select
                  value={matches[p.key] ?? ''}
                  onChange={(e) => setMatches({ ...matches, [p.key]: e.target.value })}
                >
                  <option value="">Create a new place</option>
                  {map.places.map((old) => (
                    <option key={old.placeId} value={old.placeId}>
                      {old.title}
                    </option>
                  ))}
                </select>
              </label>
            </article>
          ))}
          {job.draft.geography.changes.frames?.map((f, i) => (
            <label key={i}>
              <input
                type="checkbox"
                checked={frames.includes(i)}
                onChange={() => setFrames(toggle(frames, i))}
              />
              Accept floor {f.value.label} ({f.value.floor})
            </label>
          ))}
          {job.draft.geography.changes.routes?.map((r, i) => (
            <label key={i}>
              <input
                type="checkbox"
                checked={routes.includes(i)}
                onChange={() => setRoutes(toggle(routes, i))}
              />
              Accept connection {JSON.stringify(r.value.from)} → {JSON.stringify(r.value.to)} ·{' '}
              {r.value.kind} · {r.value.access} · {r.value.certainty}
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              checked={playerSafe}
              onChange={(e) => setPlayerSafe(e.target.checked)}
            />
            I reviewed the whole image: no hidden rooms, labels or GM notes. Allow player display.
          </label>
          <button
            disabled={busy || !selected.length || job.auditOnly}
            onClick={() => void perform(accept)}
          >
            Accept selected geography
          </button>
        </section>
      )}
    </details>
  );
}
