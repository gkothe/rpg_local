import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useResource } from '../hooks/useResource';
import { request, requestCollection, json, errorMessage } from '../services/client';
import type { RuleContext } from '../services/types';
import { ErrorNotice, Field } from '../components/Controls';
export default function Rules() {
  const systems = useResource<RuleContext[]>('/rule-systems', requestCollection<RuleContext>);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const navigate = useNavigate();
  return (
    <div className="page">
      <h1>Rules library</h1>
      <p>
        Reusable private books, original text and editable GM instructions. Campaigns always use the
        latest published version.
      </p>
      <ErrorNotice message={error || systems.error} />
      {systems.loading ? (
        <p role="status">Loading systems…</p>
      ) : (
        <ul>
          {systems.data?.map((system) => (
            <li key={system.systemId}>
              <Link to={`/rules/${system.systemId}`}>{system.systemName}</Link> — revision{' '}
              {system.revision}
            </li>
          ))}
        </ul>
      )}
      <form
        className="panel"
        onSubmit={async (event) => {
          event.preventDefault();
          if (guard.current) return;
          guard.current = true;
          setBusy(true);
          setError('');
          try {
            const system = await request<RuleContext>(
              '/rule-systems',
              json('POST', { systemKey: key, name })
            );
            navigate(`/rules/${system.systemId}`);
          } catch (error) {
            setError(errorMessage(error));
          } finally {
            guard.current = false;
            setBusy(false);
          }
        }}
      >
        <h2>Create system</h2>
        <Field label="System name">
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field
          label="Stable system key"
          hint="Use lowercase letters, numbers, hyphens or underscores."
        >
          <input value={key} onChange={(event) => setKey(event.target.value)} required />
        </Field>
        <button disabled={busy} type="submit">
          Create rule system
        </button>
      </form>
    </div>
  );
}
