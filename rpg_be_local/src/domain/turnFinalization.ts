import { z } from 'zod';

export enum TurnFinalizationStage {
  NarrativeEditing = 'narrative_editing',
  IndexUpdating = 'index_updating',
  Committing = 'committing',
}
export const TURN_FINALIZATION_STAGE_OPTIONS = [
  { id: TurnFinalizationStage.NarrativeEditing, label: 'Editing narration' },
  { id: TurnFinalizationStage.IndexUpdating, label: 'Updating GM index' },
  { id: TurnFinalizationStage.Committing, label: 'Saving turn' },
] as const;
export const turnFinalizationSchema = z
  .object({
    stage: z.enum(TurnFinalizationStage),
    resume: z.object({ available: z.boolean(), reason: z.string().nullable() }).strict(),
  })
  .strict();
export type TurnFinalization = z.infer<typeof turnFinalizationSchema>;
