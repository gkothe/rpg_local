import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../store.js';
import { Problem, conflict } from '../errors.js';
import { newCampaign } from '../domain/campaign.js';
import { campaignCreateSchema, campaignPatchSchema, characterInput } from '../domain/schemas.js';
import { sourceSections } from '../domain/sourceSections.js';
import type { Character } from '../domain/types.js';
import type { Generator } from '../providers/service.js';
import { SourceStatus } from '../domain/options.js';
export class CampaignService {
  constructor(
    readonly store: Store,
    readonly generator: Generator
  ) {}
  async create(input: z.infer<typeof campaignCreateSchema>) {
    if (input.settings?.provider) await this.generator.capacity(input.settings);
    const c = newCampaign(input);
    await this.store.insert(c);
    return c;
  }
  async patch(
    id: string,
    revision: number,
    patch: Omit<z.infer<typeof campaignPatchSchema>, 'revision'>
  ) {
    if (patch.settings?.provider) await this.generator.capacity(patch.settings);
    return this.store.edit(id, revision, (c) => {
      if (
        patch.pinnedSourceIds?.some(
          (id) => !c.sources.some((s) => s.id === id && s.status === SourceStatus.Confirmed)
        )
      )
        throw new Problem(
          422,
          'source_reference',
          'Pinned sources must be confirmed campaign sources'
        );
      if (
        patch.pinnedSourceSections?.some((pin) => {
          const source = c.sources.find(
            (s) =>
              s.id === pin.sourceId &&
              s.version === pin.version &&
              s.status === SourceStatus.Confirmed
          );
          return !source || !sourceSections(source)[pin.index];
        })
      )
        throw new Problem(
          422,
          'source_reference',
          'Pinned sections must reference current confirmed source sections'
        );
      Object.assign(c, patch);
    });
  }
  async delete(id: string, revision: number) {
    await this.store.transaction(async (client) => {
      const c = await this.store.campaign(id, client, true);
      if (c.revision !== revision) throw conflict('Campaign changed');
      await this.store.assertIdle(id, client);
      await client.query('DELETE FROM campaigns WHERE id=$1', [id]);
    });
  }
  async notes(id: string, input: { notes: string; notesRevision: number }) {
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(id, client, true);
      if (c.notesRevision !== input.notesRevision)
        throw conflict('Notes changed; refresh before saving');
      c.notes = input.notes;
      c.notesRevision++;
      await this.store.save(c, client);
      return c;
    });
  }
  addCharacter(id: string, revision: number, input: z.infer<typeof characterInput>) {
    return this.store.edit(id, revision, (c) => {
      c.characters.push({ ...input, id: randomUUID(), revision: c.revision + 1 });
    });
  }
  patchCharacter(
    id: string,
    characterId: string,
    revision: number,
    patch: Partial<Omit<Character, 'id' | 'type' | 'revision'>>
  ) {
    return this.store.edit(id, revision, (c) => {
      const char = c.characters.find((x) => x.id === characterId);
      if (!char) throw new Problem(404, 'not_found', 'Character not found');
      Object.assign(char, patch, { revision: c.revision + 1 });
    });
  }
  deleteCharacter(id: string, characterId: string, revision: number) {
    return this.store.edit(id, revision, (c) => {
      if (!c.characters.some((x) => x.id === characterId))
        throw new Problem(404, 'not_found', 'Character not found');
      c.characters = c.characters.filter((x) => x.id !== characterId);
    });
  }
}
