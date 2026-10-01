import { useEffect, useRef, useState } from 'react';
import { Field, ErrorNotice } from '../../components/Controls';
import { request, json, errorMessage } from '../../services/client';
import { useLanAccess } from './LanContext';
export function LanPairing({ open }: { open: boolean }) {
  const lan = useLanAccess(),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    guard = useRef(false),
    dialog = useRef<HTMLDialogElement>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const node = dialog.current;
    if (open) {
      setCode('');
      setError('');
      setBusy(false);
      guard.current = false;
      node?.showModal();
    } else node?.close();
    return () => {
      alive.current = false;
    };
  }, [open]);
  return (
    <dialog
      className="pairing-dialog"
      ref={dialog}
      onCancel={(e) => e.preventDefault()}
      aria-labelledby="pair-heading"
    >
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (guard.current) return;
          guard.current = true;
          setBusy(true);
          setError('');
          try {
            await request('/lan/pair', json('POST', { code: code.trim().toUpperCase() }));
            await lan.refresh();
            if (alive.current) {
              lan.paired();
              setCode('');
            }
          } catch (e) {
            if (alive.current) setError(errorMessage(e));
          } finally {
            guard.current = false;
            if (alive.current) setBusy(false);
          }
        }}
      >
        <p className="eyebrow">Local network connection</p>
        <h1 id="pair-heading">Connect this device</h1>
        <p>
          On your computer, open Settings and create a connection code. Enter that code here. It is
          short-lived and can be used once.
        </p>
        <ErrorNotice message={error || lan.error} />
        <Field label="Desktop connection code">
          <input
            autoFocus
            autoComplete="off"
            maxLength={32}
            value={code}
            disabled={busy}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
          />
        </Field>
        <button className="primary" disabled={busy || !code.trim()}>
          {busy ? 'Connecting…' : 'Connect device'}
        </button>
        <button type="button" disabled={busy} onClick={() => void lan.refresh()}>
          Check connection again
        </button>
        <small>
          Expired or revoked connections need a new desktop code. Your unsent action remains in this
          browser while you reconnect.
        </small>
      </form>
    </dialog>
  );
}
