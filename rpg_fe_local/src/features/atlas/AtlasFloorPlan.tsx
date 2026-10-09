import AtlasCanvas from './AtlasCanvas';
import type { AtlasFrame, AtlasPlace, AtlasRoute } from './types';

export default function AtlasFloorPlan({
  frame,
  places,
  routes,
  position,
  onSelect,
}: {
  frame: AtlasFrame;
  places: AtlasPlace[];
  routes: AtlasRoute[];
  position: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="atlas-floor">
      <p>
        {frame.floor} ·{' '}
        {frame.calibration
          ? `Scale: ${frame.calibration.distancePerUnit} ${frame.calibration.unit} per drawing unit`
          : 'Schematic; not to scale'}
      </p>
      <AtlasCanvas
        key={frame.id}
        label={`${frame.label} floor plan`}
        offsetX={-5}
        offsetY={-5}
        width={frame.width + 10}
        height={frame.height + 10}
      >
        <rect
          x="0"
          y="0"
          width={frame.width}
          height={frame.height}
          className="atlas-floor-boundary"
        />
        {routes
          .filter((r) => r.drawing?.frameId === frame.id)
          .map((r) => (
            <polyline
              key={r.id}
              className="atlas-route-line"
              points={r.drawing!.points.map((p) => `${p.x},${p.y}`).join(' ')}
            >
              <title>
                {r.kind}: {r.access}
                {r.bidirectional ? '' : ' (one way)'}
              </title>
            </polyline>
          ))}
        {places
          .filter((p) => p.placement?.frameId === frame.id)
          .map((p) => {
            const box = p.placement!;
            return (
              <g
                key={p.placeId}
                role="button"
                tabIndex={0}
                aria-label={`${p.title}${p.placeId === position ? ', current position' : ''}`}
                className={p.placeId === position ? 'atlas-room atlas-current' : 'atlas-room'}
                onClick={() => onSelect(p.placeId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(p.placeId);
                  }
                }}
              >
                {box.width ? (
                  <rect x={box.x} y={box.y} width={box.width} height={box.height} />
                ) : (
                  <circle cx={box.x} cy={box.y} r="2" />
                )}
                <text
                  x={box.x + (box.width ?? 0) / 2}
                  y={box.y + (box.height ?? 0) / 2}
                  textAnchor="middle"
                >
                  {p.title}
                </text>
              </g>
            );
          })}
      </AtlasCanvas>
    </div>
  );
}
