import { useRef, useState, type ReactNode } from 'react';
const MIN_VIEW_ZOOM = 0.4;
const MAX_VIEW_ZOOM = 6;
export default function AtlasCanvas({
  label,
  width,
  height,
  offsetX = 0,
  offsetY = 0,
  children,
}: {
  label: string;
  width: number;
  height: number;
  offsetX?: number;
  offsetY?: number;
  children: ReactNode;
}) {
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    pan: { x: number; y: number };
    ratioX: number;
    ratioY: number;
  } | null>(null);
  const changeZoom = (factor: number) =>
    setZoom((value) => Math.max(MIN_VIEW_ZOOM, Math.min(MAX_VIEW_ZOOM, value * factor)));
  return (
    <div className="atlas-canvas">
      <div className="atlas-toolbar">
        <button aria-label="Zoom map in" onClick={() => changeZoom(1.25)}>
          Zoom in
        </button>
        <button aria-label="Zoom map out" onClick={() => changeZoom(0.8)}>
          Zoom out
        </button>
        <button
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Reset map view
        </button>
        <span>View magnification {zoom.toFixed(1)}×</span>
      </div>
      <svg
        viewBox={`${offsetX + pan.x + (width - width / zoom) / 2} ${offsetY + pan.y + (height - height / zoom) / 2} ${width / zoom} ${height / zoom}`}
        role="img"
        aria-label={label}
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('[role="button"]')) return;
          const bounds = e.currentTarget.getBoundingClientRect();
          drag.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            pan,
            ratioX: width / zoom / bounds.width,
            ratioY: height / zoom / bounds.height,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d?.id === e.pointerId)
            setPan({
              x: d.pan.x - (e.clientX - d.x) * d.ratioX,
              y: d.pan.y - (e.clientY - d.y) * d.ratioY,
            });
        }}
        onPointerUp={(e) => {
          if (drag.current?.id === e.pointerId) {
            drag.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        {children}
      </svg>
      <p className="muted">
        Drag the background to pan. Zoom changes the view, not recorded distances.
      </p>
    </div>
  );
}
