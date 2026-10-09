export interface AtlasPoint {
  x: number;
  y: number;
}
export interface AtlasPlacement extends AtlasPoint {
  frameId: string;
  width?: number;
  height?: number;
}
export interface AtlasPlace {
  expected: string;
  placeId: string;
  parentPlaceId?: string | null;
  visited: boolean;
  placement?: AtlasPlacement;
  title: string;
  text: string;
  certainty: string;
}
export interface AtlasRoute {
  expected: string;
  id: string;
  from: string;
  to: string;
  bidirectional: boolean;
  kind: string;
  access: string;
  visibility: string;
  certainty: string;
  direction?: string;
  distance?: { value: number; unit: string };
  travel?: { mode: string; minutes: number; conditions?: string };
  drawing?: { frameId: string; points: AtlasPoint[] };
}
export interface AtlasFrame {
  expected: string;
  id: string;
  placeId: string;
  label: string;
  floor: string;
  width: number;
  height: number;
  visibility: string;
  calibration?: { distancePerUnit: number; unit: string };
  playerAssetId?: string;
}
export interface AtlasData {
  scope: string | null;
  position: string | null;
  breadcrumb: { id: string; title: string }[];
  places: AtlasPlace[];
  routes: AtlasRoute[];
  frames: AtlasFrame[];
  nextCursor: number | null;
  nextRouteCursor?: number | null;
}
export interface AtlasOptions {
  images: { mimeTypes: string[]; maxPixels: number };
  defaults: { visibility: string; certainty: string; origin: string };
  views: { id: string; label: string }[];
  routeKinds: { id: string; label: string }[];
  access: { id: string; label: string }[];
  units: { id: string; label: string }[];
}
