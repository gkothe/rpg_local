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
import { RuleStore, ruleContext } from './ruleStore.js';
import { DEFAULT_RULE_SYSTEM_ID } from '../domain/rules.js';
import { campaignRuleBindingSchema } from '../domain/schemas.js';
import {
  assertCharacterRemovable,
  assertManualAttributesEdit,
  assertManualStateEdit,
} from '../domain/combat.js';
export class CampaignService {
  constructor(
    readonly store: Store,
    readonly generator: Generator
  ) {}
  async create(input: z.infer<typeof campaignCreateSchema>) {
    if (input.settings?.provider) await this.generator.capacity(input.settings);
    const c = newCampaign(input);
    await this.store.transaction(async (client) => {
      await new RuleStore(this.store).resolve(c, client);
      if (c.ruleSystemId === DEFAULT_RULE_SYSTEM_ID) c.ruleSystemId = null;
      await this.store.insert(c, client);
    });
    return c;
  }
  async bindRules(id: string, input: z.infer<typeof campaignRuleBindingSchema>, resolving = false) {
    return this.store.transaction(async (client) => {
      const campaign = await this.store.campaign(id, client, true);
      const identity = { revision: input.revision, systemId: input.systemId, resolving };
      const prior = await client.query(
        'SELECT identity,result FROM campaign_rule_bindings WHERE campaign_id=$1 AND request_id=$2',
        [id, input.requestId]
      );
      if (prior.rows[0]) {
        const stored = prior.rows[0].identity;
        if (
          stored.revision !== identity.revision ||
          stored.systemId !== identity.systemId ||
          stored.resolving !== resolving
        )
          throw conflict('Rule binding request identity reused with changed input');
        return prior.rows[0].result;
      }
      await this.store.assertIdle(id, client);
      if (resolving && !campaign.ruleResolution)
        throw conflict('This campaign has no unresolved rule reference');
      const candidate = { ...campaign, ruleSystemId: input.systemId };
      delete candidate.ruleResolution;
      const selected = await new RuleStore(this.store).resolve(candidate, client);
      campaign.ruleSystemId =
        selected.systemId === DEFAULT_RULE_SYSTEM_ID ? null : selected.systemId;
      delete campaign.ruleReference;
      delete campaign.ruleResolution;
      campaign.revision++;
      await this.store.save(campaign, client);
      const result = {
        revision: campaign.revision,
        ruleSystemId: campaign.ruleSystemId,
        system: ruleContext(selected),
      };
      await client.query(
        'INSERT INTO campaign_rule_bindings(campaign_id,request_id,identity,result) VALUES($1,$2,$3,$4)',
        [id, input.requestId, identity, result]
      );
      return result;
    });
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
      if (patch.state) assertManualStateEdit(c.state, patch.state);
      Object.assign(c, patch);
    });
  }
  async delete(id: string, _revision: number) {
    await this.store.transaction(async (client) => {
      await this.store.campaign(id, client, true);
      await this.store.assertIdle(id, client);
      await client.query('DELETE FROM campaigns WHERE id=$1', [id]);
    });
  }
  async notes(id: string, input: { notes: string; notesRevision: number }) {
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(id, client, true);
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
      if (patch.attributes) assertManualAttributesEdit(c.state, characterId, patch.attributes);
      Object.assign(char, patch, { revision: c.revision + 1 });
    });
  }
  deleteCharacter(id: string, characterId: string, revision: number) {
    return this.store.edit(id, revision, (c) => {
      if (!c.characters.some((x) => x.id === characterId))
        throw new Problem(404, 'not_found', 'Character not found');
      if (c.continuity?.npcProfiles.some((p) => p.characterId === characterId))
        throw new Problem(
          409,
          'npc_profile_reference',
          'Remove this NPC profile before deleting the character'
        );
      assertCharacterRemovable(c.state, characterId);
      c.characters = c.characters.filter((x) => x.id !== characterId);
    });
  }
}
