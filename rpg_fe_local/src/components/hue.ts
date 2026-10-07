// Presentation only: a stable hue (0-359) derived from an entity id, used for covers and portraits.
export const hueFromId = (id: string) =>
  [...id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 7);
