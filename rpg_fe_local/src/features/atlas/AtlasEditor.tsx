import AtlasCorrections from './AtlasCorrections';
import { useRef, useState } from 'react';
import { request } from '../../services/client';
import type { AtlasData, AtlasOptions } from './types';

export default function AtlasEditor({
  campaignId,
  map,
  options,
  onSaved,
}: {
  campaignId: string;
  map: AtlasData;
  options: AtlasOptions;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(''),
    [description, setDescription] = useState('');
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [kind, setKind] = useState(''),
    [access, setAccess] = useState('');
  const [distance, setDistance] = useState(''),
    [unit, setUnit] = useState(''),
    [minutes, setMinutes] = useState(''),
    [mode, setMode] = useState('');
  const [frame, setFrame] = useState(''),
    [x, setX] = useState('0'),
    [y, setY] = useState('0'),
    [width, setWidth] = useState('10'),
    [height, setHeight] = useState('8');
  const [floorLabel, setFloorLabel] = useState(''),
    [floorWidth, setFloorWidth] = useState('100'),
    [floorHeight, setFloorHeight] = useState('100');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [feedback, setFeedback] = useState('');
  const guard = useRef(false),
    identity = useRef<{ body: string; id: string } | null>(null);
  async function save(changes: unknown) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    setFeedback('');
    const body = JSON.stringify(changes);
    if (identity.current?.body !== body) identity.current = { body, id: crypto.randomUUID() };
    try {
      await request(`/campaigns/${campaignId}/atlas/changes`, {
        method: 'POST',
        body: JSON.stringify({ requestId: identity.current.id, changes }),
      });
      await onSaved();
      setFeedback('Atlas saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Atlas save failed.');
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  const number = (value: string) => Number(value);
  const selectPlaces = (
    <>
      <option value="">Choose a place</option>
      {map.places.map((p) => (
        <option key={p.placeId} value={p.placeId}>
          {p.title}
        </option>
      ))}
    </>
  );
  return (
    <details className="atlas-editor">
      <summary>Create or correct geography</summary>
      {error && <p role="alert">{error}</p>}
      {feedback && <p role="status">{feedback}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim() || !description.trim()) return;
          void save({
            createPlaces: [
              {
                key: 'new-place',
                title,
                text: description,
                visibility: options.defaults.visibility,
                certainty: options.defaults.certainty,
              },
            ],
            places: [
              {
                expected: null,
                value: {
                  placeId: { localKey: 'new-place' },
                  ...(map.scope ? { parentPlaceId: map.scope } : {}),
                  visited: false,
                  ...(frame
                    ? {
                        placement: {
                          frameId: frame,
                          x: number(x),
                          y: number(y),
                          width: number(width),
                          height: number(height),
                        },
                      }
                    : {}),
                },
              },
            ],
          });
        }}
      >
        <h3>Add a place or room</h3>
        <label>
          Name
          <input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Short description
          <textarea required value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          Floor plan
          <select value={frame} onChange={(e) => setFrame(e.target.value)}>
            <option value="">No placement</option>
            {map.frames.map((f) => (
              <option key={f.id} value={f.id}>
                {f.floor}
              </option>
            ))}
          </select>
        </label>
        {frame && (
          <div className="atlas-fields">
            {[
              ['X', x, setX],
              ['Y', y, setY],
              ['Width', width, setWidth],
              ['Height', height, setHeight],
            ].map(([label, value, setter]) => (
              <label key={String(label)}>
                {String(label)}
                <input
                  type="number"
                  required
                  min={label === 'X' || label === 'Y' ? '0' : '0.01'}
                  step="any"
                  value={String(value)}
                  onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                />
              </label>
            ))}
          </div>
        )}
        <button disabled={busy}>Save place</button>
      </form>
      {map.scope && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({
              frames: [
                {
                  expected: null,
                  value: {
                    placeId: map.scope,
                    label: floorLabel,
                    floor: floorLabel,
                    width: number(floorWidth),
                    height: number(floorHeight),
                    visibility: options.defaults.visibility,
                    origin: options.defaults.origin,
                    evidence: [],
                  },
                },
              ],
            });
          }}
        >
          <h3>Add a floor</h3>
          <label>
            Floor label
            <input required value={floorLabel} onChange={(e) => setFloorLabel(e.target.value)} />
          </label>
          <div className="atlas-fields">
            <label>
              Canvas width
              <input
                type="number"
                required
                min="1"
                value={floorWidth}
                onChange={(e) => setFloorWidth(e.target.value)}
              />
            </label>
            <label>
              Canvas height
              <input
                type="number"
                required
                min="1"
                value={floorHeight}
                onChange={(e) => setFloorHeight(e.target.value)}
              />
            </label>
          </div>
          <button disabled={busy}>Save floor</button>
        </form>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (from === to) {
            setError('Choose two different places.');
            return;
          }
          void save({
            routes: [
              {
                expected: null,
                value: {
                  from,
                  to,
                  kind,
                  access,
                  bidirectional: true,
                  visibility: options.defaults.visibility,
                  certainty: options.defaults.certainty,
                  origin: options.defaults.origin,
                  evidence: [],
                  ...(distance ? { distance: { value: number(distance), unit } } : {}),
                  ...(minutes ? { travel: { mode, minutes: number(minutes) } } : {}),
                },
              },
            ],
          });
        }}
      >
        <h3>Add a connection</h3>
        <div className="atlas-fields">
          <label>
            From
            <select required value={from} onChange={(e) => setFrom(e.target.value)}>
              {selectPlaces}
            </select>
          </label>
          <label>
            To
            <select required value={to} onChange={(e) => setTo(e.target.value)}>
              {selectPlaces}
            </select>
          </label>
          <label>
            Connection
            <select required value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Choose a kind</option>
              {options.routeKinds.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Access
            <select required value={access} onChange={(e) => setAccess(e.target.value)}>
              <option value="">Choose access</option>
              {options.access.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Distance (optional)
            <input
              type="number"
              min="0.01"
              step="any"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
            />
          </label>
          <label>
            Distance unit
            <select
              required={Boolean(distance)}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              <option value="">Choose unit</option>
              {options.units.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Travel minutes (optional)
            <input
              type="number"
              min="0.01"
              step="any"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <label>
            Travel mode
            <input
              required={Boolean(minutes)}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            />
          </label>
        </div>
        <button disabled={busy}>Save connection</button>
      </form>
      <AtlasCorrections map={map} options={options} busy={busy} save={save} />
    </details>
  );
}
