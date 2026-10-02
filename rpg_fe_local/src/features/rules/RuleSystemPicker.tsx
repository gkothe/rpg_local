import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RuleReference, RuleSystemOption, RuleContext } from '../../services/types';
import { request, requestCollection, errorMessage } from '../../services/client';
import { ErrorNotice, Field } from '../../components/Controls';

export default function RuleSystemPicker({
  value,
  onChange,
  disabled,
  unresolved,
  campaignId,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  unresolved?: RuleReference;
  campaignId?: string;
}) {
  const [options, setOptions] = useState<RuleSystemOption[]>([]);
  const [error, setError] = useState('');
  const [candidate, setCandidate] = useState<RuleContext | null>(null);
  useEffect(() => {
    let active = true;
    void requestCollection<RuleSystemOption>('/rule-systems')
      .then((result) => {
        if (active) setOptions(result);
      })
      .catch((error) => {
        if (active) setError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!campaignId || !unresolved) return;
    let active = true;
    void request<{ candidate: RuleContext | null }>(
      `/campaigns/${campaignId}/rule-system/resolution`
    )
      .then((result) => {
        if (active) setCandidate(result.candidate);
      })
      .catch((error) => {
        if (active) setError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [campaignId, unresolved]);
  const selected = unresolved
    ? 'unresolved'
    : (value ?? options.find((option) => option.isDefault)?.systemId ?? '');
  return (
    <section className="stack rule-system-selection" aria-label="Rule system selection">
      <Field
        label="System rules"
        hint="The next new action uses the latest published instructions and books. An update ends an older attempt and blocks its retry."
      >
        <select
          aria-label="System rules"
          value={selected}
          disabled={disabled || !options.length}
          onChange={(event) => {
            const option = options.find((option) => option.systemId === event.target.value);
            if (option?.selectable) onChange(option.isDefault ? null : option.systemId);
          }}
        >
          {!options.length && <option value="">Loading rule systems…</option>}
          {unresolved && (
            <option value="unresolved" disabled>
              Unresolved: {unresolved.systemName}
            </option>
          )}
          {options.map((option) => (
            <option key={option.systemId} value={option.systemId} disabled={!option.selectable}>
              {option.systemName}
              {option.isDefault
                ? ' · memory and model knowledge'
                : option.selectable
                  ? ` · revision ${option.revision}`
                  : ' · publish a book first'}
            </option>
          ))}
        </select>
      </Field>
      {unresolved && (
        <p className="notice">
          This save references {unresolved.systemKey}, hash {unresolved.contentHash}. Restore the
          private library or explicitly choose a published system or the default to resume.
        </p>
      )}
      {unresolved && candidate && (
        <p className="notice">
          Matching stable key: {candidate.systemName}, current revision {candidate.revision}, hash{' '}
          {candidate.contentHash}.{' '}
          {candidate.contentHash === unresolved.contentHash
            ? 'The saved content hash matches.'
            : 'The current content differs from the save. Choosing it explicitly uses this latest version.'}
        </p>
      )}
      <ErrorNotice message={error} />
      <Link to="/rules">Manage rule libraries</Link>
    </section>
  );
}
