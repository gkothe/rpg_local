import type { Provider, ProviderSettings } from '../../services/types';
import { useRef, useState } from 'react';
import { Field } from '../../components/Controls';
export default function ProviderPicker({
  providers,
  value,
  onChange,
  disabled = false,
  onRefresh,
}: {
  providers: Provider[];
  value: ProviderSettings;
  onChange: (value: ProviderSettings) => void;
  disabled?: boolean;
  onRefresh?: () => Promise<void>;
}) {
  const refreshGuard = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const provider = providers.find((p) => p.id === value.provider),
    model = provider?.models.find((m) => m.id === value.model);
  const readyProviders = providers.filter(
    (p) => p.available && p.supported && p.dice?.supported !== false && p.models.length
  );
  return (
    <div className="provider-picker">
      <Field label="AI provider">
        <select
          disabled={disabled}
          value={value.provider}
          onChange={(e) => {
            const p = providers.find((p) => p.id === e.target.value),
              m = p?.models.find((model) => model.dice?.supported !== false);
            onChange({ provider: p?.id || '', model: m?.id || '', effort: m?.efforts[0] || null });
          }}
        >
          <option value="">Select a provider</option>
          {providers.map((p) => (
            <option
              key={p.id}
              value={p.id}
              disabled={
                !p.available || !p.supported || p.dice?.supported === false || !p.models.length
              }
            >
              {p.name}
              {!p.available
                ? p.transport === 'api'
                  ? ' — not configured'
                  : ' — not detected'
                : !p.supported || p.dice?.supported === false || !p.models.length
                  ? p.transport === 'api'
                    ? ' — configuration incomplete'
                    : ' — installed, gameplay disabled'
                  : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Model">
        <select
          value={value.model}
          disabled={
            disabled ||
            !provider?.available ||
            !provider.supported ||
            provider.dice?.supported === false ||
            !provider.models.length
          }
          onChange={(e) => {
            const m = provider?.models.find((m) => m.id === e.target.value);
            onChange({ ...value, model: e.target.value, effort: m?.efforts[0] || null });
          }}
        >
          <option value="">Select a model</option>
          {provider?.models.map((m) => (
            <option key={m.id} value={m.id} disabled={m.dice?.supported === false}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Effort">
        <select
          value={value.effort || ''}
          disabled={
            disabled ||
            !provider?.available ||
            !provider.supported ||
            provider.dice?.supported === false ||
            model?.dice?.supported === false ||
            !model?.efforts.length
          }
          onChange={(e) => onChange({ ...value, effort: e.target.value || null })}
        >
          <option value="">Default</option>
          {model?.efforts.map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
      </Field>
      {provider?.reason && <small className="provider-reason">{provider.reason}</small>}
      {provider?.transport === 'api' && provider.supported && (
        <p className="notice" role="status">
          {provider.name} runs remotely: each request sends the assembled campaign context to it
          using the API key held by your backend. The key and model access are checked only when a
          request is made.
        </p>
      )}
      {provider?.compatibilityWarning && (
        <p className="notice" role="status">
          {provider.compatibilityWarning}
        </p>
      )}
      {model?.dice?.supported === false && (
        <small className="provider-reason">{model.dice.reason}</small>
      )}
      <div className="provider-reason stack">
        {!value.provider && (
          <small className="muted">
            {readyProviders.length
              ? 'Choose an AI provider first to unlock its models and effort options.'
              : 'No usable provider with models was found. Review the diagnostics below or Settings & connections.'}
          </small>
        )}
        {provider?.available && provider.supported && model && !model.efforts.length && (
          <small className="muted">
            This model uses its default effort; it has no effort options.
          </small>
        )}
        {providers
          .filter(
            (p) => !p.available || !p.supported || p.dice?.supported === false || !p.models.length
          )
          .map((p) => (
            <small key={p.id} className="muted">
              {p.name}: {p.dice?.reason || p.reason || 'No usable model catalog is available.'}
            </small>
          ))}
        {onRefresh && (
          <button
            type="button"
            disabled={disabled || refreshing}
            onClick={async () => {
              if (refreshGuard.current) return;
              refreshGuard.current = true;
              setRefreshing(true);
              try {
                await onRefresh();
              } finally {
                refreshGuard.current = false;
                setRefreshing(false);
              }
            }}
          >
            {refreshing ? 'Refreshing providers…' : 'Refresh provider diagnostics'}
          </button>
        )}
      </div>
    </div>
  );
}
