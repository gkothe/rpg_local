import { core } from './npcFixture.js';
import type { Generator } from '../src/providers/service.js';

/** Mock only the external creator boundary; real services still bind and validate sheets. */
export function completeNpcGenerate(fallback: Generator['generate']): Generator['generate'] {
  return async (settings, prompt, schema, signal, trace) => {
    if (prompt.startsWith('{')) {
      const input = JSON.parse(prompt);
      if (input.task?.startsWith('Establish the COMPLETE')) {
        return {
          action: 'finish',
          requirements: {
            version: 1,
            systemName: 'Synthetic compact health game',
            edition: '1',
            category: 'Mortal',
            basis: 'model_knowledge',
            citations: [],
            applicability: ['Compact health block; no separate skill catalog'],
            fields: [
              { path: ['attributes', 'health', 'max'], type: 'number', min: 1, reason: 'Vitality' },
              {
                path: ['attributes', 'health', 'damage'],
                type: 'number',
                min: 0,
                reason: 'Wounds',
              },
            ],
          },
        };
      }
      if (input.input?.sheetRequirements)
        return {
          name: input.input.establishedCharacter.name,
          description: { role: 'Guard' },
          profile: core,
          sheet: {
            attributes: input.input.establishedCharacter.attributes,
            inventory: input.input.establishedCharacter.inventory,
            rationales: [
              { path: ['attributes', 'health', 'max'], reason: 'Established vitality' },
              { path: ['attributes', 'health', 'damage'], reason: 'Established wounds' },
            ],
            conflicts: [],
          },
        };
    }
    return fallback(settings, prompt, schema, signal, trace);
  };
}
