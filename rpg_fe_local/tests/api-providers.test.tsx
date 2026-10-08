import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ProviderPicker from '../src/features/providers/ProviderPicker';
import SettingsPage from '../src/pages/Settings';
import { LanContext } from '../src/features/connections/LanContext';
import { MemoryRouter } from 'react-router-dom';
import { options, providers } from './fixtures';
import type { Provider } from '../src/services/types';

afterEach(() => vi.unstubAllGlobals());

const apiModel = (id: string) => ({
  id,
  label: id,
  efforts: [],
  inputTokens: 16000,
  dice: { supported: true, reason: null },
  rules: { supported: true, reason: null, efforts: [] },
});
const gemini: Provider = {
  id: 'gemini-api',
  transport: 'api',
  name: 'Gemini API',
  available: true,
  supported: true,
  reason: null,
  version: null,
  models: [apiModel('gemini-test')],
  catalogProvenance: 'Administrator model list from the backend environment',
  dice: { supported: true, reason: null },
};
const openrouter: Provider = {
  ...gemini,
  id: 'openrouter',
  name: 'OpenRouter',
  available: false,
  supported: false,
  reason: 'Set OPENROUTER_API_KEY in the backend .env and restart the backend',
  models: [],
  dice: {
    supported: false,
    reason: 'Set OPENROUTER_API_KEY in the backend .env and restart the backend',
  },
};
const incomplete: Provider = {
  ...gemini,
  id: 'incomplete',
  name: 'Half configured',
  supported: false,
  reason: 'Set GEMINI_MODELS to a comma-separated list of model ids and restart the backend',
  models: [],
};

it('mixes CLI and API providers, labels unconfigured API rows and keeps CLI choices usable', () => {
  render(
    <ProviderPicker
      providers={[...providers, gemini, openrouter, incomplete]}
      value={{ provider: '', model: '', effort: null }}
      onChange={vi.fn()}
    />
  );
  expect((screen.getByRole('option', { name: 'Claude Code' }) as HTMLOptionElement).disabled).toBe(
    false
  );
  expect((screen.getByRole('option', { name: 'Gemini API' }) as HTMLOptionElement).disabled).toBe(
    false
  );
  const missing = screen.getByRole('option', { name: 'OpenRouter — not configured' });
  expect((missing as HTMLOptionElement).disabled).toBe(true);
  expect(
    (
      screen.getByRole('option', {
        name: 'Half configured — configuration incomplete',
      }) as HTMLOptionElement
    ).disabled
  ).toBe(true);
  expect(screen.getByText(/OpenRouter: Set OPENROUTER_API_KEY/)).toBeVisible();
});

it('selecting an API model keeps effort empty, explains remote execution and stays editable', () => {
  const onChange = vi.fn();
  render(
    <ProviderPicker
      providers={[...providers, gemini]}
      value={{ provider: 'gemini-api', model: 'gemini-test', effort: null }}
      onChange={onChange}
    />
  );
  expect(screen.getByRole('status')).toHaveTextContent(/Gemini API runs remotely/);
  expect(screen.getByLabelText('Effort')).toBeDisabled();
  expect(screen.getByLabelText('Model')).toHaveValue('gemini-test');
  fireEvent.change(screen.getByLabelText('AI provider'), { target: { value: 'gemini-api' } });
  expect(onChange).toHaveBeenCalledWith({
    provider: 'gemini-api',
    model: 'gemini-test',
    effort: null,
  });
  expect(
    screen.getByText('This model uses its default effort; it has no effort options.')
  ).toBeVisible();
});

it('does not show the remote-execution notice for CLI providers', () => {
  render(
    <ProviderPicker
      providers={[...providers, gemini]}
      value={{ provider: providers[0]!.id, model: providers[0]!.models[0]!.id, effort: null }}
      onChange={vi.fn()}
    />
  );
  expect(screen.queryByText(/runs remotely/)).toBeNull();
});

it('settings distinguish installed CLIs from configured API providers and remote access checks', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (path: string) => {
      const data = path.startsWith('/api/providers')
        ? [...providers, gemini, openrouter, incomplete]
        : options;
      return new Response(JSON.stringify({ data }), { status: 200 });
    })
  );
  render(
    <MemoryRouter>
      <LanContext.Provider
        value={{
          status: null,
          error: '',
          refresh: vi.fn(),
          requirePairing: vi.fn(),
          paired: vi.fn(),
        }}
      >
        <SettingsPage />
      </LanContext.Provider>
    </MemoryRouter>
  );
  expect(await screen.findByRole('heading', { name: 'AI providers' })).toBeVisible();
  expect(
    await screen.findByText(/Configured — runs remotely; the key and model access/)
  ).toBeVisible();
  expect(screen.getByText('Not configured')).toBeVisible();
  expect(screen.getByText('API key found — gameplay disabled')).toBeVisible();
  expect(screen.getByText(/^Ready for gameplay/)).toBeVisible();
  expect(screen.getByText(/Set GEMINI_MODELS/)).toBeVisible();
});
