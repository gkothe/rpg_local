import { useEffect, useRef, useState } from 'react';
import { useLanAccess } from './LanContext';
import { request, json, errorMessage } from '../../services/client';
import { ErrorNotice } from '../../components/Controls';
export default function LanConnection() {
  const lan = useLanAccess(),
    [approval, setApproval] = useState<{ code: string; expiresAt: string } | null>(null),
    [error, setError] = useState(''),
    [feedback, setFeedback] = useState(''),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now()),
    guard = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);
  async function action(path: string) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    if (path.endsWith('/code')) setApproval(null);
    try {
      const result = await request<{ code: string; expiresAt: string }>(path, json('POST', {}));
      if (alive.current) {
        if (path.endsWith('/code')) {
          setApproval(result);
          setFeedback('Connection code created. Enter it on your phone.');
        } else {
          setApproval(null);
          setFeedback('All device connections revoked. Devices must pair again.');
        }
        await lan.refresh();
      }
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      guard.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const expired = approval && new Date(approval.expiresAt).getTime() <= now;
  return (
    <section className="panel stack">
      <h2>Phone on the same Wi-Fi</h2>
      <ErrorNotice message={error || lan.error} />
      {feedback && <small role="status">{feedback}</small>}
      <p>LAN access is {lan.status?.enabled ? 'enabled' : 'disabled'}.</p>
      {lan.status?.desktop ? (
        <>
          <p>
            Open a permitted address below on your phone, then approve that device with a connection
            code. The game, database and AI CLIs continue running on this computer.
          </p>
          {lan.status.connectUrls.length > 0 ? (
            <ul>
              {lan.status.connectUrls.map((url) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No LAN addresses are configured. Follow the repository LAN setup guide to opt in;
              default access is localhost only.
            </p>
          )}
          <div className="row wrap">
            <button disabled={busy || !lan.status.enabled} onClick={() => void action('/lan/code')}>
              Create connection code
            </button>
            <button
              className="danger"
              disabled={busy || !lan.status.enabled}
              onClick={() => {
                if (confirm('Revoke all paired phone/device connections?'))
                  void action('/lan/revoke');
              }}
            >
              Revoke all devices
            </button>
          </div>
          {approval && (
            <div className="notice">
              <p>
                {expired ? 'Code expired. Create a new code.' : 'Enter this code on the phone:'}
              </p>
              {!expired && (
                <output className="pair-code" aria-label="Connection code">
                  {approval.code}
                </output>
              )}
              <small>
                Expires {new Date(approval.expiresAt).toLocaleTimeString()} · single use
              </small>
            </div>
          )}
        </>
      ) : (
        <>
          <p>
            {lan.status?.paired
              ? 'This device is connected.'
              : 'This device needs desktop approval.'}
          </p>
          {lan.status?.expiresAt && (
            <p>Connection expires {new Date(lan.status.expiresAt).toLocaleString()}.</p>
          )}
          <button onClick={lan.requirePairing}>Connect with a new desktop code</button>
        </>
      )}
      <button disabled={busy} onClick={() => void lan.refresh()}>
        Refresh connection status
      </button>
      <p className="muted">
        Keep the computer awake. Your phone must share its local network. Browser dictation needs
        trusted HTTPS; local HTTP still supports typed play. This screen never changes firewall
        rules, certificate trust or tunnels.
      </p>
    </section>
  );
}
