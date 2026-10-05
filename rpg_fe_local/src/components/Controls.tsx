import type { ReactNode } from 'react';
export function Field({
  label,
  children,
  hint,
  tooltip,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  tooltip?: string;
}) {
  return (
    <label className="field">
      <span title={tooltip} tabIndex={tooltip ? 0 : undefined}>
        {label}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div className="notice error" role="alert">
      {message}
    </div>
  ) : null;
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function JsonEditor({
  value,
  onChange,
  label = 'Advanced JSON',
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <details className="advanced">
      <summary>{label}</summary>
      <Field label="JSON">
        <textarea
          className="code"
          rows={12}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          disabled={disabled}
        />
      </Field>
    </details>
  );
}
