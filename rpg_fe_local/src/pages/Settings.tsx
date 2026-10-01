import { useResource } from '../hooks/useResource';
import { useRef, useState } from 'react';
import type { Provider, Settings } from '../services/types';
import { ErrorNotice } from '../components/Controls';
import LanConnection from '../features/connections/LanConnection';
export default function SettingsPage() {
  const refreshGuard = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const settings = useResource<Settings>('/settings'),
    providers = useResource<Provider[]>('/providers');
  return (
    <div className="page narrow">
      <p className="eyebrow">This computer</p>
      <h1>Settings & connections</h1>
      <ErrorNotice message={settings.error || providers.error} />
      <section className="panel stack">
        <h2>Installed AI CLIs</h2>
        {providers.data?.map((p) => (
          <article key={p.id}>
            <h3>{p.name}</h3>
            <p>
              {p.available && p.supported
                ? 'Ready for gameplay'
                : p.available
                  ? 'Installed — gameplay disabled'
                  : 'Not detected'}
              {p.version ? ` · ${p.version}` : ''}
            </p>
            {p.reason && <p className="notice">{p.reason}</p>}
            <small className="muted">{p.catalogProvenance}</small>
          </article>
        ))}
        <button
          disabled={refreshing}
          onClick={async () => {
            if (refreshGuard.current) return;
            refreshGuard.current = true;
            setRefreshing(true);
            try {
              await providers.reload('/providers?refresh=true');
              await settings.reload();
            } finally {
              refreshGuard.current = false;
              setRefreshing(false);
            }
          }}
        >
          {refreshing ? 'Refreshing diagnostics…' : 'Refresh diagnostics'}
        </button>
      </section>
      <section className="panel stack">
        <h2>Voice input</h2>
        <p>
          {settings.data?.audio.available
            ? 'Local transcription is available.'
            : settings.data?.audio.reason || 'Checking transcription availability…'}
        </p>
        <p className="muted">
          Recording is explicit and limited to 60 seconds. Review the resulting text before sending.
          Transcription uses no campaign history.
        </p>
        <h3>Read aloud</h3>
        <p className="muted">
          Use Read aloud on a GM response. Only browser voices marked as installed locally are
          offered.
        </p>
      </section>
      <LanConnection />
      <section className="panel stack">
        <h2>Network setup</h2>
        <p>LAN access is {settings.data?.lan.enabled ? 'enabled' : 'disabled'}.</p>
        <p>
          Run the game on your Windows computer. Optional LAN setup must explicitly allow your local
          host and browser origin. The phone runs only the browser; AI CLIs and PostgreSQL stay on
          the computer.
        </p>
        <p className="muted">
          For phone dictation, use trusted HTTPS. Firewall permissions, certificate trust, device
          pairing and any tunnel require a separate setup step. This screen does not change them.
        </p>
        <p className="notice">
          Default access is localhost only. See the repository LAN setup guide before enabling
          network access.
        </p>
      </section>
    </div>
  );
}
