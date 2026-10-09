import AtlasCanvas from './AtlasCanvas';
import AtlasImportReview from './AtlasImportReview';
import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../../services/client';
import { atlasLayout } from './atlasLayout';
import AtlasFloorPlan from './AtlasFloorPlan';
import AtlasEditor from './AtlasEditor';
import type { AtlasData, AtlasOptions } from './types';
import './atlas.css';

function AtlasPanelContent({
  campaignId,
  revision,
  options,
  onTravel,
  onSaved,
}: {
  campaignId: string;
  revision: number;
  options?: AtlasOptions;
  onTravel: (text: string) => void;
  onSaved: () => void;
}) {
  const [scope, setScope] = useState<string | undefined>(),
    [map, setMap] = useState<AtlasData | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [floor, setFloor] = useState(''),
    [floorPlan, setFloorPlan] = useState(false);
  const epoch = useRef(0);
  const load = useCallback(async () => {
    const generation = ++epoch.current;
    setLoading(true);
    setError('');
    try {
      let routeCursor: number | null = 0;
      let cursor: number | null = 0;
      let merged: AtlasData | null = null;
      do {
        const params: URLSearchParams = new URLSearchParams({
          cursor: String(cursor),
          routeCursor: String(routeCursor),
        });
        if (scope) params.set('scope', scope);
        const result: AtlasData = await request<AtlasData>(
          `/campaigns/${campaignId}/atlas?${params}`
        );
        if (generation !== epoch.current) return;
        if (!merged) merged = result;
        else {
          merged.places = [
            ...new Map([...merged.places, ...result.places].map((p) => [p.placeId, p])).values(),
          ];
          merged.routes = [
            ...new Map([...merged.routes, ...result.routes].map((r) => [r.id, r])).values(),
          ];
          merged.frames = [
            ...new Map([...merged.frames, ...result.frames].map((f) => [f.id, f])).values(),
          ];
        }
        if (result.nextRouteCursor != null) routeCursor = result.nextRouteCursor;
        else {
          routeCursor = 0;
          cursor = result.nextCursor;
        }
      } while (cursor !== null);
      setMap(merged);
    } catch (e) {
      if (generation === epoch.current)
        setError(e instanceof Error ? e.message : 'Atlas could not be loaded.');
    } finally {
      if (generation === epoch.current) setLoading(false);
    }
  }, [campaignId, scope]);
  const invalidate = useCallback(() => {
    epoch.current++;
  }, []);
  useEffect(() => {
    void load();
    return () => {
      invalidate();
    }; /* the loader captures this exact campaign/scope */
  }, [load, revision, invalidate]);
  if (!map)
    return (
      <section className="atlas-panel">
        <h2>Campaign atlas</h2>
        {error ? <p role="alert">{error}</p> : <p role="status">Loading atlas…</p>}
      </section>
    );
  const layout = atlasLayout(map.places, map.routes),
    current = map.places.find((p) => p.placeId === map.position),
    detail = map.places.find((p) => p.placeId === selected);
  const frame = map.frames.find((f) => f.id === floor) ?? map.frames[0];
  const names = new Map(map.places.map((p) => [p.placeId, p.title]));
  return (
    <section className="atlas-panel stack">
      <div className="atlas-toolbar">
        <h2>Campaign atlas</h2>
        <button
          onClick={() => {
            setScope(undefined);
            setSelected(map.position);
          }}
        >
          Focus current place
        </button>
        <button onClick={() => setScope(undefined)}>Current area</button>
        <button onClick={() => setScope('world')}>World view</button>
        <button onClick={() => void load()}>Refresh view</button>
      </div>
      <p>Current position: {current?.title ?? (map.position ? 'Outside this view' : 'Unknown')}</p>
      <nav aria-label="Map breadcrumb" className="atlas-toolbar">
        <button
          onClick={() => {
            setScope('world');
            setSelected(null);
          }}
        >
          World
        </button>
        {map.breadcrumb.map((p) => (
          <button key={p.id} onClick={() => setScope(p.id)}>
            {p.title}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Refreshing atlas…</p>}
      {frame && (
        <div className="atlas-toolbar">
          <button aria-pressed={!floorPlan} onClick={() => setFloorPlan(false)}>
            Connected diagram
          </button>
          <button aria-pressed={floorPlan} onClick={() => setFloorPlan(true)}>
            Floor plan
          </button>
          <label>
            Floor
            <select
              aria-label="Displayed floor"
              value={frame.id}
              onChange={(e) => setFloor(e.target.value)}
            >
              {map.frames.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.floor}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {floorPlan && frame ? (
        <AtlasFloorPlan
          frame={frame}
          places={map.places}
          routes={map.routes}
          position={map.position}
          onSelect={setSelected}
        />
      ) : (
        <div className="atlas-diagram">
          <p>Connections show known routes. Diagram spacing does not represent distance.</p>
          <AtlasCanvas
            key={map.scope ?? 'world'}
            label="Connected places diagram"
            offsetX={-10}
            offsetY={-10}
            width={layout.width + 20}
            height={layout.height + 20}
          >
            {map.routes.map((r) => {
              const a = layout.positions.get(r.from),
                b = layout.positions.get(r.to);
              return a && b ? (
                <g key={r.id}>
                  <line
                    className="atlas-route-line"
                    x1={a.x + layout.nodeWidth / 2}
                    y1={a.y + layout.nodeHeight / 2}
                    x2={b.x + layout.nodeWidth / 2}
                    y2={b.y + layout.nodeHeight / 2}
                  />
                  <title>
                    {r.kind} · {r.access}
                    {r.distance
                      ? ` · ${r.distance.value} ${r.distance.unit}`
                      : ' · distance unknown'}
                  </title>
                </g>
              ) : null;
            })}
            {map.places.map((p) => {
              const point = layout.positions.get(p.placeId)!;
              return (
                <g
                  key={p.placeId}
                  className={p.placeId === map.position ? 'atlas-node atlas-current' : 'atlas-node'}
                  role="button"
                  tabIndex={0}
                  aria-label={p.title}
                  onClick={() => setSelected(p.placeId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected(p.placeId);
                    }
                  }}
                >
                  <rect
                    x={point.x}
                    y={point.y}
                    width={layout.nodeWidth}
                    height={layout.nodeHeight}
                    rx="8"
                  />
                  <text
                    x={point.x + layout.nodeWidth / 2}
                    y={point.y + layout.nodeHeight / 2}
                    textAnchor="middle"
                  >
                    {p.title.length > 22 ? `${p.title.slice(0, 21)}…` : p.title}
                  </text>
                </g>
              );
            })}
          </AtlasCanvas>
        </div>
      )}
      {!map.places.length && (
        <p>No geography recorded here yet. Add a place or import a map to start.</p>
      )}
      <div className="atlas-place-list" aria-label="Known places">
        {map.places.map((p) => (
          <article key={p.placeId}>
            <button onClick={() => setSelected(p.placeId)}>{p.title}</button>
            <small>
              {p.visited ? 'Visited' : 'Known, unvisited'} · {p.certainty}
            </small>
            <button
              onClick={() => {
                setScope(p.placeId);
                setSelected(p.placeId);
              }}
            >
              Open area
            </button>
          </article>
        ))}
      </div>
      {detail && (
        <article>
          <h3>{detail.title}</h3>
          <p>{detail.text}</p>
          <button
            onClick={() =>
              onTravel(
                `I try to travel to ${detail.title}, using a known route if one is available.`
              )
            }
          >
            Prepare travel action
          </button>
          <button onClick={() => setScope(detail.placeId)}>Explore this place</button>
        </article>
      )}
      <h3>Known connections</h3>
      <ul className="atlas-routes">
        {map.routes.map((r) => (
          <li key={r.id}>
            {names.get(r.from)} {r.bidirectional ? '↔' : '→'} {names.get(r.to)} · {r.kind} ·{' '}
            {r.access} · {r.certainty}
            {r.direction ? ` · ${r.direction}` : ''}
            {r.distance ? ` · ${r.distance.value} ${r.distance.unit}` : ' · distance unknown'}
            {r.travel
              ? ` · ${r.travel.minutes} minutes by ${r.travel.mode}${r.travel.conditions ? ` (${r.travel.conditions})` : ''}`
              : ' · travel time unknown'}
          </li>
        ))}
      </ul>
      {frame?.playerAssetId && (
        <figure>
          <img
            className="atlas-source-image"
            src={`/api/campaigns/${campaignId}/atlas/images/${frame.playerAssetId}`}
            alt={`Reviewed map of ${frame.label}`}
          />
          <figcaption>Reviewed source image. Use the saved connections to navigate.</figcaption>
        </figure>
      )}
      <AtlasImportReview
        imageTypes={options?.images?.mimeTypes}
        campaignId={campaignId}
        map={map}
        onSaved={async () => {
          await load();
          onSaved();
        }}
      />
      {options && (
        <AtlasEditor
          campaignId={campaignId}
          map={map}
          options={options}
          onSaved={async () => {
            await load();
            onSaved();
          }}
        />
      )}
    </section>
  );
}

export default function AtlasPanel(props: Parameters<typeof AtlasPanelContent>[0]) {
  return <AtlasPanelContent key={props.campaignId} {...props} />;
}
