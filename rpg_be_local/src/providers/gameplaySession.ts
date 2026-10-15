import { Problem } from '../errors.js';
import type { GameplayToolDispatch } from './gameplayTools.js';
import type { PromptTraceContext } from './promptLog.js';

export type GameplayPhase = {
  prompt: string;
  schema: unknown;
  systemPrompt: string;
  tools: GameplayToolDispatch;
  trace?: PromptTraceContext;
};
export type GameplaySession = { runPhase: (phase: GameplayPhase) => Promise<unknown> };

/** A phase result releases the caller, never waits for orchestration in a protocol handler. */
export class GameplaySessionBridge implements GameplaySession {
  readonly first: Promise<GameplayPhase>;
  private firstResolve!: (phase: GameplayPhase) => void;
  private firstReject!: (error: unknown) => void;
  private send?: (phase: GameplayPhase) => void;
  private end?: () => void;
  private pending?: { resolve: (value: unknown) => void; reject: (error: unknown) => void };
  private failure?: unknown;
  private started = false;
  constructor() {
    this.first = new Promise((resolve, reject) => {
      this.firstResolve = resolve;
      this.firstReject = reject;
    });
  }
  runPhase(phase: GameplayPhase): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending)
      return Promise.reject(new Problem(409, 'gameplay_phase', 'A GM phase is already running'));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      if (!this.started) {
        this.started = true;
        this.firstResolve(phase);
      } else {
        try {
          if (!this.send) throw new Problem(409, 'gm_session_lost', 'GM conversation was lost');
          this.send(phase);
        } catch (error) {
          this.fail(error);
        }
      }
    });
  }
  attach(send: (phase: GameplayPhase) => void, end: () => void) {
    this.send = send;
    this.end = end;
  }
  complete(value: unknown) {
    if (!this.pending) throw new Problem(502, 'gameplay_phase', 'Unexpected GM phase result');
    const pending = this.pending;
    this.pending = undefined;
    pending.resolve(value);
  }
  fail(error: unknown) {
    this.failure = error;
    this.firstReject(error);
    this.pending?.reject(error);
    this.pending = undefined;
  }
  close() {
    this.fail(new Problem(409, 'gm_session_lost', 'GM conversation is closed'));
    this.end?.();
  }
}
