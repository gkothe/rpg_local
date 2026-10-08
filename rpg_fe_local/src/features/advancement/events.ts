const EVENT = 'rpg-advancement-changed';
export function notifyAdvancement(campaignId: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: campaignId }));
}
export function subscribeAdvancement(campaignId: string, listener: () => void) {
  const handler = (event: Event) => {
    if ((event as CustomEvent<string>).detail === campaignId) listener();
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
