import { useState } from 'react';
import type { AtlasData, AtlasOptions } from './types';
export default function AtlasCorrections({
  map,
  options,
  busy,
  save,
}: {
  map: AtlasData;
  options: AtlasOptions;
  busy: boolean;
  save: (changes: unknown) => Promise<void>;
}) {
  const [placeId, setPlaceId] = useState(''),
    [parent, setParent] = useState(''),
    [frameId, setFrameId] = useState(''),
    [x, setX] = useState('0'),
    [y, setY] = useState('0'),
    [width, setWidth] = useState(''),
    [height, setHeight] = useState('');
  const [routeId, setRouteId] = useState(''),
    [access, setAccess] = useState(''),
    [distance, setDistance] = useState(''),
    [unit, setUnit] = useState(''),
    [minutes, setMinutes] = useState(''),
    [mode, setMode] = useState(''),
    [both, setBoth] = useState(true);
  const [floorId, setFloorId] = useState(''),
    [floorWidth, setFloorWidth] = useState(''),
    [floorHeight, setFloorHeight] = useState(''),
    [scale, setScale] = useState(''),
    [scaleUnit, setScaleUnit] = useState('');
  const place = map.places.find((p) => p.placeId === placeId),
    route = map.routes.find((r) => r.id === routeId),
    floor = map.frames.find((f) => f.id === floorId);
  const places = (
    <>
      <option value="">Choose place</option>
      {map.places.map((p) => (
        <option key={p.placeId} value={p.placeId}>
          {p.title}
        </option>
      ))}
    </>
  );
  return (
    <section>
      <h3>Correct saved geography</h3>
      <label>
        Saved place
        <select
          value={placeId}
          onChange={(e) => {
            const p = map.places.find((p) => p.placeId === e.target.value);
            setPlaceId(e.target.value);
            setParent(p?.parentPlaceId ?? '');
            setFrameId(p?.placement?.frameId ?? '');
            setX(String(p?.placement?.x ?? 0));
            setY(String(p?.placement?.y ?? 0));
            setWidth(p?.placement?.width === undefined ? '' : String(p.placement.width));
            setHeight(p?.placement?.height === undefined ? '' : String(p.placement.height));
          }}
        >
          {places}
        </select>
      </label>
      {place && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save({
                places: [
                  {
                    expected: place.expected,
                    value: {
                      placeId,
                      parentPlaceId: parent || null,
                      visited: place.visited,
                      ...(frameId
                        ? {
                            placement: {
                              frameId,
                              x: Number(x),
                              y: Number(y),
                              ...(width && height
                                ? { width: Number(width), height: Number(height) }
                                : {}),
                            },
                          }
                        : {}),
                    },
                  },
                ],
              });
            }}
          >
            <label>
              Containing place
              <select value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value="">World level</option>
                {map.places
                  .filter((p) => p.placeId !== placeId)
                  .map((p) => (
                    <option key={p.placeId} value={p.placeId}>
                      {p.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Floor
              <select value={frameId} onChange={(e) => setFrameId(e.target.value)}>
                <option value="">No floor placement</option>
                {map.frames.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.floor}
                  </option>
                ))}
              </select>
            </label>
            {frameId && (
              <div className="atlas-fields">
                {[
                  ['X', x, setX],
                  ['Y', y, setY],
                  ['Room width (empty for junction)', width, setWidth],
                  ['Room height (empty for junction)', height, setHeight],
                ].map(([name, value, setter]) => (
                  <label key={String(name)}>
                    {String(name)}
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={String(value)}
                      onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                    />
                  </label>
                ))}
              </div>
            )}
            <button disabled={busy}>Save place layout</button>
          </form>
          <button
            disabled={busy}
            onClick={() => void save({ position: { placeId, expected: map.position } })}
          >
            Set current position here
          </button>
          <button
            disabled={busy}
            onClick={() => void save({ removePlaces: [{ placeId, expected: place.expected }] })}
          >
            Remove from atlas
          </button>
        </>
      )}
      <button
        disabled={busy || map.position === null}
        onClick={() => void save({ position: { placeId: null, expected: map.position } })}
      >
        Clear current position
      </button>
      <label>
        Saved connection
        <select
          value={routeId}
          onChange={(e) => {
            const r = map.routes.find((r) => r.id === e.target.value);
            setRouteId(e.target.value);
            setAccess(r?.access ?? '');
            setDistance(r?.distance ? String(r.distance.value) : '');
            setUnit(r?.distance?.unit ?? '');
            setMinutes(r?.travel ? String(r.travel.minutes) : '');
            setMode(r?.travel?.mode ?? '');
            setBoth(r?.bidirectional ?? true);
          }}
        >
          <option value="">Choose connection</option>
          {map.routes.map((r) => (
            <option key={r.id} value={r.id}>
              {map.places.find((p) => p.placeId === r.from)?.title} to{' '}
              {map.places.find((p) => p.placeId === r.to)?.title}
            </option>
          ))}
        </select>
      </label>
      {route && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const { expected: _expected, distance: _distance, travel: _travel, ...value } = route;
            void _expected;
            void _distance;
            void _travel;
            void save({
              routes: [
                {
                  expected: route.expected,
                  value: {
                    ...value,
                    access,
                    bidirectional: both,
                    origin: options.defaults.origin,
                    evidence: [],
                    ...(distance ? { distance: { value: Number(distance), unit } } : {}),
                    ...(minutes
                      ? {
                          travel: {
                            minutes: Number(minutes),
                            mode,
                            ...(route.travel?.conditions
                              ? { conditions: route.travel.conditions }
                              : {}),
                          },
                        }
                      : {}),
                  },
                },
              ],
            });
          }}
        >
          <label>
            Access
            <select value={access} onChange={(e) => setAccess(e.target.value)}>
              {options.access.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={both} onChange={(e) => setBoth(e.target.checked)} />
            Travel in both directions
          </label>
          <label>
            Distance (empty means unknown)
            <input
              type="number"
              min="0.01"
              step="any"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
            />
          </label>
          <label>
            Unit
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
            Minutes (empty means unknown)
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
          <button disabled={busy}>Save connection correction</button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void save({ removeRoutes: [{ id: route.id, expected: route.expected }] })
            }
          >
            Remove connection
          </button>
        </form>
      )}
      <label>
        Saved floor
        <select
          value={floorId}
          onChange={(e) => {
            const f = map.frames.find((f) => f.id === e.target.value);
            setFloorId(e.target.value);
            setFloorWidth(String(f?.width ?? ''));
            setFloorHeight(String(f?.height ?? ''));
            setScale(f?.calibration ? String(f.calibration.distancePerUnit) : '');
            setScaleUnit(f?.calibration?.unit ?? '');
          }}
        >
          <option value="">Choose floor</option>
          {map.frames.map((f) => (
            <option key={f.id} value={f.id}>
              {f.floor}
            </option>
          ))}
        </select>
      </label>
      {floor && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const { expected: _expected, calibration: _calibration, ...value } = floor;
            void _expected;
            void _calibration;
            void save({
              frames: [
                {
                  expected: floor.expected,
                  value: {
                    ...value,
                    width: Number(floorWidth),
                    height: Number(floorHeight),
                    origin: options.defaults.origin,
                    evidence: [],
                    ...(scale
                      ? { calibration: { distancePerUnit: Number(scale), unit: scaleUnit } }
                      : {}),
                  },
                },
              ],
            });
          }}
        >
          <label>
            Canvas width
            <input
              required
              type="number"
              min="0.01"
              step="any"
              value={floorWidth}
              onChange={(e) => setFloorWidth(e.target.value)}
            />
          </label>
          <label>
            Canvas height
            <input
              required
              type="number"
              min="0.01"
              step="any"
              value={floorHeight}
              onChange={(e) => setFloorHeight(e.target.value)}
            />
          </label>
          <label>
            Distance per drawing unit (empty means schematic)
            <input
              type="number"
              min="0.01"
              step="any"
              value={scale}
              onChange={(e) => setScale(e.target.value)}
            />
          </label>
          <label>
            Scale unit
            <select
              required={Boolean(scale)}
              value={scaleUnit}
              onChange={(e) => setScaleUnit(e.target.value)}
            >
              <option value="">Choose unit</option>
              {options.units.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy}>Save floor correction</button>
          <button
            disabled={busy}
            type="button"
            onClick={() =>
              void save({ removeFrames: [{ id: floor.id, expected: floor.expected }] })
            }
          >
            Remove floor
          </button>
        </form>
      )}
      <p>
        Remove dependent rooms and connections before removing their parent or floor. Corrections do
        not advance time.
      </p>
    </section>
  );
}
