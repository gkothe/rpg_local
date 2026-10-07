import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Problem } from '../errors.js';
import {
  ResponseFieldProblem,
  ResponseFieldProblems,
  type ResponsePath,
} from '../domain/responseFields.js';
import { RESPONSE_RETRY_COUNT, responseRetryFeedback } from '../domain/responseRetry.js';
import type { Generator } from '../providers/service.js';
import type { ProviderSettings } from '../domain/types.js';
import { traceEvent, safeTraceFailure, type PromptTraceContext } from '../providers/promptLog.js';
import { selectRepairEvidence } from './responseRepairContext.js';
import { KNOWLEDGE_PROVENANCE_GUIDANCE } from '../domain/gameplayNarrator.js';
import { participantReferenceSchema } from '../domain/combat.js';

const editableFields = new Set([
  'operations',
  'knowledgeChanges',
  'ruleCitations',
  'operationExplanations',
  'rollInterpretations',
  'combatEffects',
  'participantReferences',
]);
/** Reserved identities and receipts come from combat_prepare; corrections may not alter them. */
function preparedIdentities(response: unknown, corrected?: unknown): string {
  const operations = (response as { operations?: unknown })?.operations;
  const correctedOperations = (corrected as { operations?: unknown })?.operations;
  return JSON.stringify(
    Array.isArray(operations)
      ? operations.flatMap((op, index) => {
          const replacement = Array.isArray(correctedOperations)
            ? correctedOperations[index]
            : undefined;
          // Ordinary creates receive server IDs. Dropping an unreceipted proposal
          // is repairable; changing a prepared identity or assigning another ID is not.
          if (
            op?.op === 'create' &&
            op.characterId !== undefined &&
            op.preparationReceiptId === undefined &&
            replacement?.op === 'create' &&
            replacement.characterId === undefined &&
            replacement.preparationReceiptId === undefined
          )
            return [];
          return op &&
            typeof op === 'object' &&
            ('characterId' in op || 'preparationReceiptId' in op) &&
            (op as { op?: unknown }).op === 'create'
            ? [[index, op.characterId, op.preparationReceiptId]]
            : [];
        })
      : []
  );
}
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function repairPaths(error: unknown): ResponsePath[] {
  const paths =
    error instanceof ResponseFieldProblems
      ? error.problems.map((problem) => problem.path)
      : error instanceof ResponseFieldProblem
        ? [error.path]
        : error instanceof z.ZodError
          ? error.issues.map((issue) => issue.path as ResponsePath)
          : [];
  const safe = paths.filter(
    (path) =>
      editableFields.has(String(path[0])) &&
      path.every((part) =>
        typeof part === 'number' ? Number.isInteger(part) && part >= 0 : !forbidden.has(part)
      )
  );
  // A root/narrative/version error cannot authorize editing another part of the response.
  if (safe.length !== paths.length) return [];
  return safe.filter(
    (path, index) =>
      !safe.some(
        (other, i) =>
          i !== index &&
          other.length <= path.length &&
          other.every((part, n) => part === path[n]) &&
          (other.length < path.length || i < index)
      )
  );
}
export function applyResponseCorrections<T>(original: T, paths: ResponsePath[], raw: unknown): T {
  if (
    paths.some(
      (path) =>
        !path.length ||
        !editableFields.has(String(path[0])) ||
        path.some((part) => typeof part === 'string' && forbidden.has(part))
    )
  )
    throw new Problem(502, 'response_repair_failed', 'Unsafe correction path');
  const corrections = z
    .object({
      corrections: z.array(
        z
          .object({
            path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
            value: z.unknown(),
          })
          .strict()
      ),
    })
    .strict()
    .parse(raw).corrections;
  if (
    corrections.length !== paths.length ||
    corrections.some(
      (correction, index) => JSON.stringify(correction.path) !== JSON.stringify(paths[index])
    )
  )
    throw new Problem(
      502,
      'response_repair_failed',
      'Correction attempted to change a field outside the allowed paths'
    );
  const copy = structuredClone(original);
  for (const correction of corrections) {
    const parent = correction.path
      .slice(0, -1)
      .reduce<unknown>(
        (value, key) =>
          value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
        copy
      );
    if (!parent || typeof parent !== 'object')
      throw new Problem(
        502,
        'response_repair_failed',
        'Correction path is not present in the original response'
      );
    (parent as Record<string, unknown>)[correction.path.at(-1)!] = structuredClone(
      correction.value
    );
  }
  if (preparedIdentities(copy) !== preparedIdentities(original, copy))
    throw new Problem(
      502,
      'response_repair_failed',
      'Correction attempted to change a prepared character identity or receipt'
    );
  return copy;
}
/** No tools or new scene generation; validation and commit remain owned by the caller. */
export async function validateWithFieldRepair<T>(
  original: T,
  validate: (response: T) => Promise<void>,
  generator: Generator,
  settings: ProviderSettings,
  signal?: AbortSignal,
  trace?: PromptTraceContext,
  evidence?: () => Promise<unknown>
): Promise<T> {
  let candidate = structuredClone(original);
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new Problem(409, 'cancelled', 'Request cancelled');
    try {
      await validate(candidate);
      return candidate;
    } catch (error) {
      const paths = repairPaths(error);
      if (!paths.length || attempt >= RESPONSE_RETRY_COUNT) {
        if (error instanceof ResponseFieldProblem || responseRetryFeedback(error) !== null)
          throw new Problem(
            502,
            'response_repair_failed',
            `The saved response could not be corrected: ${
              error instanceof ResponseFieldProblem
                ? `${error.path.join('.')}: ${error.message}`
                : responseRetryFeedback(error)
            }. The scene and saved dice were preserved.`
          );
        throw error;
      }
      const child = trace
        ? {
            ...trace,
            executionId: randomUUID(),
            purpose: 'response_repair',
            correctionAttempt: attempt,
          }
        : undefined;
      await traceEvent(child, 'field_repair_requested', {
        paths,
        reason: error instanceof Error ? error.message : 'Invalid response',
      });
      const schema = {
        type: 'object',
        additionalProperties: false,
        required: ['corrections'],
        properties: {
          corrections: {
            type: 'array',
            minItems: paths.length,
            maxItems: paths.length,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'value'],
              properties: { path: { enum: paths }, value: {} },
              oneOf: paths.map((path) => ({
                properties: {
                  path: { const: path },
                  value:
                    path[0] === 'participantReferences' && path.length <= 2
                      ? z.toJSONSchema(
                          path.length === 1
                            ? z.array(participantReferenceSchema)
                            : participantReferenceSchema
                        )
                      : {},
                },
              })),
            },
          },
        },
      };
      const fullEvidence = await evidence?.();
      const selection = selectRepairEvidence(candidate, paths, fullEvidence);
      await traceEvent(child, 'field_repair_context', {
        mode: selection.mode,
        fallbackReasons: selection.fallbackReasons,
        fullEvidenceBytes: Buffer.byteLength(JSON.stringify(fullEvidence) ?? '', 'utf8'),
        selectedEvidenceBytes: Buffer.byteLength(JSON.stringify(selection.evidence) ?? '', 'utf8'),
      });
      const prompt = JSON.stringify({
        task: 'Correct only the listed invalid fields of this saved GM response. Return corrections in exactly the allowed path order. Preserve the narrative, scenario, valid operations, facts and authoritative dice. No tools, new events, invented receipts or rerolls. Use exact quotes from the supplied evidence; the app calculates citation offsets and pages. Do not remove valid material to evade validation.',
        invalid: error instanceof Error ? error.message : 'Invalid response',
        allowedPaths: paths,
        ...(paths.some((path) => path[0] === 'participantReferences')
          ? {
              participantReferenceGuidance:
                'References contain only UUID strings of participants in the prior or proposed structured encounter, never ordinary narrative mentions or operationIndex aliases. With no encounter participants, replace the permitted participantReferences collection with []. Preserve references required by valid combat effects and combat rolls.',
            }
          : {}),
        ...(paths.some((path) => path[0] === 'knowledgeChanges' || path[0] === 'operations')
          ? { knowledgeProvenance: KNOWLEDGE_PROVENANCE_GUIDANCE }
          : {}),
        response: candidate,
        evidence: selection.evidence,
      });
      try {
        const raw = await generator.generate(settings, prompt, schema, signal, child);
        candidate = applyResponseCorrections(candidate, paths, raw);
        await traceEvent(child, 'field_repair_received', { paths });
      } catch (repairError) {
        await traceEvent(child, 'field_repair_failed', {
          ...safeTraceFailure(repairError),
          paths,
          reason:
            repairError instanceof Problem && repairError.code === 'response_repair_failed'
              ? repairError.message
              : null,
        });
        if (
          repairError instanceof Problem &&
          ![
            'provider_json',
            'provider_protocol',
            'provider_failure',
            'response_repair_failed',
          ].includes(repairError.code)
        )
          throw repairError;
        throw new Problem(
          502,
          'response_repair_failed',
          'Field correction failed; the scene and saved dice were preserved'
        );
      }
    }
  }
}
