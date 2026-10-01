import { useCallback, useEffect, useRef, useState } from 'react';
import type { CampaignDetail, ProviderSettings, Turn, Settings } from '../../services/types';
import { request, json, errorMessage, ApiError } from '../../services/client';
import { isActive as activeTurn } from '../../services/options';
export function useTurn(
  campaign: CampaignDetail | null,
  onRefresh: () => Promise<void>,
  options: Settings | null
) {
  const [turn, setTurn] = useState<Turn | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uncertainAction, setUncertainAction] = useState<string | null>(null);
  const [uncertainDiceRetry, setUncertainDiceRetry] = useState(false);
  const pendingDiceRetry = useRef<{
    turnId: string;
    input: { revision: number; requestId: string; settings: ProviderSettings };
  } | null>(null);
  const alive = useRef(true),
    guard = useRef(false),
    epoch = useRef(0),
    refresh = useRef(onRefresh);
  const pendingRequest = useRef<{
    action: string;
    settings: ProviderSettings;
    revision: number;
    requestId: string;
  } | null>(null);
  refresh.current = onRefresh;
  const campaignId = campaign?.id;
  const invalidate = useCallback(() => {
    alive.current = false;
    epoch.current++;
  }, []);
  useEffect(() => {
    alive.current = true;
    epoch.current++;
    setTurn(null);
    setError('');
    pendingRequest.current = null;
    setUncertainAction(null);
    pendingDiceRetry.current = null;
    setUncertainDiceRetry(false);
    return invalidate;
  }, [campaignId, invalidate]);
  useEffect(() => {
    const active = campaign?.turns.find((t) => activeTurn(t, options));
    if (active) setTurn(active);
  }, [campaign, options]);
  useEffect(() => {
    if (!turn || !activeTurn(turn, options) || !campaignId) return;
    const captured = epoch.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const updated = await request<Turn>(`/campaigns/${campaignId}/turns/${turn!.id}`);
        if (cancelled || captured !== epoch.current) return;
        setTurn(updated);
        if (!activeTurn(updated, options)) {
          setError(updated.error || '');
          await refresh.current();
        } else timer = setTimeout(() => void poll(), 1000);
      } catch (e) {
        if (!cancelled) {
          setError(errorMessage(e));
          timer = setTimeout(() => void poll(), 2000);
        }
      }
    }
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [turn, campaignId, options]);
  const send = useCallback(
    async (action: string, settings: ProviderSettings) => {
      if (!campaign || guard.current || (turn && activeTurn(turn, options))) return false;
      if (pendingDiceRetry.current) {
        setError('Resolve the uncertain dice retry before sending a new action.');
        return false;
      }
      if (
        pendingRequest.current &&
        (pendingRequest.current.action !== action ||
          JSON.stringify(pendingRequest.current.settings) !== JSON.stringify(settings))
      ) {
        setError(
          'The previous action has an uncertain result. Retry that original action before sending another.'
        );
        return false;
      }
      guard.current = true;
      setSubmitting(true);
      setError('');
      const captured = epoch.current;
      if (
        !pendingRequest.current ||
        pendingRequest.current.action !== action ||
        JSON.stringify(pendingRequest.current.settings) !== JSON.stringify(settings)
      ) {
        pendingRequest.current = {
          revision: campaign.revision,
          requestId: crypto.randomUUID(),
          action,
          settings,
        };
      }
      try {
        const result = await request<Turn>(
          `/campaigns/${campaign.id}/turns`,
          json('POST', pendingRequest.current)
        );
        if (alive.current && captured === epoch.current) {
          setTurn(result);
          pendingRequest.current = null;
          setUncertainAction(null);
          if (!activeTurn(result, options)) await refresh.current();
          return true;
        }
        return false;
      } catch (e) {
        if (e instanceof ApiError && e.status < 500 && e.status >= 400) {
          pendingRequest.current = null;
          setUncertainAction(null);
        } else if (alive.current && captured === epoch.current) setUncertainAction(action);
        if (alive.current && captured === epoch.current) setError(errorMessage(e));
        return false;
      } finally {
        guard.current = false;
        if (alive.current && captured === epoch.current) setSubmitting(false);
      }
    },
    [campaign, turn, options]
  );
  async function cancel() {
    if (!campaign || !turn || guard.current) return;
    guard.current = true;
    const captured = epoch.current;
    try {
      const value = await request<Turn>(
        `/campaigns/${campaign.id}/turns/${turn.id}/cancel`,
        json('POST', {})
      );
      if (alive.current && captured === epoch.current) {
        setTurn(value);
        await refresh.current();
      }
    } catch (e) {
      if (alive.current && captured === epoch.current) setError(errorMessage(e));
    } finally {
      guard.current = false;
    }
  }
  async function retryDice(attempt?: Turn) {
    if (!campaign || guard.current || (turn && activeTurn(turn, options)) || pendingRequest.current)
      return false;
    if (!pendingDiceRetry.current) {
      if (!attempt?.diceRetry?.available) return false;
      pendingDiceRetry.current = {
        turnId: attempt.id,
        input: {
          revision: campaign.revision,
          requestId: crypto.randomUUID(),
          settings: { ...campaign.settings },
        },
      };
    }
    const pending = pendingDiceRetry.current;
    const captured = epoch.current;
    guard.current = true;
    setSubmitting(true);
    setError('');
    try {
      const result = await request<Turn>(
        `/campaigns/${campaign.id}/turns/${pending.turnId}/retry`,
        json('POST', pending.input)
      );
      if (!alive.current || captured !== epoch.current) return false;
      setTurn(result);
      pendingDiceRetry.current = null;
      setUncertainDiceRetry(false);
      if (!activeTurn(result, options)) await refresh.current();
      return true;
    } catch (e) {
      if (alive.current && captured === epoch.current) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          pendingDiceRetry.current = null;
          setUncertainDiceRetry(false);
        } else setUncertainDiceRetry(true);
        setError(errorMessage(e));
      }
      return false;
    } finally {
      guard.current = false;
      if (alive.current && captured === epoch.current) setSubmitting(false);
    }
  }
  async function undo() {
    if (!campaign || guard.current) return;
    guard.current = true;
    setSubmitting(true);
    const captured = epoch.current;
    try {
      await request(
        `/campaigns/${campaign.id}/undo`,
        json('POST', { revision: campaign.revision })
      );
      if (alive.current && captured === epoch.current) {
        await refresh.current();
        setTurn(null);
        setError('');
      }
    } catch (e) {
      if (alive.current && captured === epoch.current) setError(errorMessage(e));
    } finally {
      guard.current = false;
      if (alive.current && captured === epoch.current) setSubmitting(false);
    }
  }
  return {
    turn,
    error,
    submitting,
    busy: submitting || !!(turn && activeTurn(turn, options)),
    send,
    cancel,
    undo,
    uncertainAction,
    uncertainDiceRetry,
    retryDice,
    retryOriginal: () =>
      pendingRequest.current
        ? send(pendingRequest.current.action, pendingRequest.current.settings)
        : Promise.resolve(false),
  };
}
