// Literal example generated from the actual gameplay wire schema.
export const responseSchemaExample = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    continuityChanges: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            properties: {
              characterId: {
                anyOf: [
                  {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  {
                    type: 'object',
                    properties: {
                      operationIndex: {
                        type: 'integer',
                        minimum: 0,
                        maximum: 9007199254740991,
                      },
                    },
                    required: ['operationIndex'],
                    additionalProperties: false,
                  },
                ],
              },
              explanation: {
                type: 'string',
                minLength: 1,
                maxLength: 100000,
              },
              origin: {
                type: 'string',
                enum: ['source', 'gm', 'player', 'unknown'],
              },
              evidence: {
                type: 'array',
                items: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        type: {
                          type: 'string',
                          const: 'map_asset',
                        },
                        assetId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        observationId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        region: {
                          type: 'object',
                          properties: {
                            x: {
                              type: 'number',
                              minimum: 0,
                              maximum: 1,
                            },
                            y: {
                              type: 'number',
                              minimum: 0,
                              maximum: 1,
                            },
                            width: {
                              type: 'number',
                              exclusiveMinimum: 0,
                              maximum: 1,
                            },
                            height: {
                              type: 'number',
                              exclusiveMinimum: 0,
                              maximum: 1,
                            },
                          },
                          required: ['x', 'y', 'width', 'height'],
                          additionalProperties: false,
                        },
                      },
                      required: ['type', 'assetId', 'observationId', 'region'],
                      additionalProperties: false,
                    },
                    {
                      type: 'object',
                      properties: {
                        type: {
                          type: 'string',
                          const: 'campaign_source',
                        },
                        sourceId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        version: {
                          type: 'integer',
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                        },
                        sourceName: {
                          type: 'string',
                        },
                        quote: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 100000,
                        },
                        start: {
                          type: 'integer',
                          minimum: 0,
                          maximum: 9007199254740991,
                        },
                        end: {
                          type: 'integer',
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                        },
                      },
                      required: ['type', 'sourceId', 'version', 'sourceName', 'quote'],
                      additionalProperties: false,
                      description:
                        'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                    },
                    {
                      type: 'object',
                      properties: {
                        type: {
                          type: 'string',
                          const: 'book',
                        },
                        citation: {
                          type: 'object',
                          properties: {
                            receiptId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            path: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 512,
                            },
                            quote: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 600,
                            },
                            start: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                            end: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                            source: {
                              type: 'string',
                              maxLength: 80,
                              pattern: '^[a-z0-9][a-z0-9_-]*$',
                            },
                            systemId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            revision: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                            contentHash: {
                              type: 'string',
                              pattern: '^[a-f0-9]{64}$',
                            },
                            precision: {
                              type: 'string',
                              enum: ['exact', 'approximate', 'unknown'],
                            },
                            pdfPages: {
                              maxItems: 2000,
                              type: 'array',
                              items: {
                                type: 'integer',
                                minimum: 1,
                                maximum: 2000,
                              },
                            },
                            printedPages: {
                              maxItems: 2000,
                              type: 'array',
                              items: {
                                type: 'string',
                                maxLength: 120,
                              },
                            },
                          },
                          required: [
                            'receiptId',
                            'path',
                            'quote',
                            'source',
                            'systemId',
                            'revision',
                            'contentHash',
                          ],
                          additionalProperties: false,
                          description:
                            'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                        },
                      },
                      required: ['type', 'citation'],
                      additionalProperties: false,
                    },
                  ],
                },
              },
              op: {
                type: 'string',
                const: 'create',
              },
              expected: {
                type: 'null',
              },
              next: {
                type: 'object',
                properties: {
                  shortTermGoal: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                  longTermGoal: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                  boundaries: {
                    maxItems: 20,
                    type: 'array',
                    items: {
                      type: 'string',
                      minLength: 1,
                      maxLength: 2000,
                    },
                  },
                  relationshipKnowledgeIds: {
                    maxItems: 1000,
                    type: 'array',
                    items: {
                      anyOf: [
                        {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        {
                          type: 'object',
                          properties: {
                            knowledgeChangeIndex: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['knowledgeChangeIndex'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            npcIntroductionOperationIndex: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['npcIntroductionOperationIndex'],
                          additionalProperties: false,
                        },
                      ],
                    },
                  },
                  revealedTraitKnowledgeIds: {
                    maxItems: 1000,
                    type: 'array',
                    items: {
                      anyOf: [
                        {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        {
                          type: 'object',
                          properties: {
                            knowledgeChangeIndex: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['knowledgeChangeIndex'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            npcIntroductionOperationIndex: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['npcIntroductionOperationIndex'],
                          additionalProperties: false,
                        },
                      ],
                    },
                  },
                  tension: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                  secret: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                },
                required: [
                  'shortTermGoal',
                  'longTermGoal',
                  'boundaries',
                  'relationshipKnowledgeIds',
                  'revealedTraitKnowledgeIds',
                ],
                additionalProperties: false,
              },
            },
            required: [
              'characterId',
              'explanation',
              'origin',
              'evidence',
              'op',
              'expected',
              'next',
            ],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              characterId: {
                anyOf: [
                  {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  {
                    type: 'object',
                    properties: {
                      operationIndex: {
                        type: 'integer',
                        minimum: 0,
                        maximum: 9007199254740991,
                      },
                    },
                    required: ['operationIndex'],
                    additionalProperties: false,
                  },
                ],
              },
              explanation: {
                type: 'string',
                minLength: 1,
                maxLength: 100000,
              },
              origin: {
                type: 'string',
                enum: ['source', 'gm', 'player', 'unknown'],
              },
              evidence: {
                type: 'array',
                items: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        type: {
                          type: 'string',
                          const: 'map_asset',
                        },
                        assetId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        observationId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        region: {
                          type: 'object',
                          properties: {
                            x: {
                              type: 'number',
                              minimum: 0,
                              maximum: 1,
                            },
                            y: {
                              type: 'number',
                              minimum: 0,
                              maximum: 1,
                            },
                            width: {
                              type: 'number',
                              exclusiveMinimum: 0,
                              maximum: 1,
                            },
                            height: {
                              type: 'number',
                              exclusiveMinimum: 0,
                              maximum: 1,
                            },
                          },
                          required: ['x', 'y', 'width', 'height'],
                          additionalProperties: false,
                        },
                      },
                      required: ['type', 'assetId', 'observationId', 'region'],
                      additionalProperties: false,
                    },
                    {
                      type: 'object',
                      properties: {
                        type: {
                          type: 'string',
                          const: 'campaign_source',
                        },
                        sourceId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        version: {
                          type: 'integer',
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                        },
                        sourceName: {
                          type: 'string',
                        },
                        quote: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 100000,
                        },
                        start: {
                          type: 'integer',
                          minimum: 0,
                          maximum: 9007199254740991,
                        },
                        end: {
                          type: 'integer',
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                        },
                      },
                      required: ['type', 'sourceId', 'version', 'sourceName', 'quote'],
                      additionalProperties: false,
                      description:
                        'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                    },
                    {
                      type: 'object',
                      properties: {
                        type: {
                          type: 'string',
                          const: 'book',
                        },
                        citation: {
                          type: 'object',
                          properties: {
                            receiptId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            path: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 512,
                            },
                            quote: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 600,
                            },
                            start: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                            end: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                            source: {
                              type: 'string',
                              maxLength: 80,
                              pattern: '^[a-z0-9][a-z0-9_-]*$',
                            },
                            systemId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            revision: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                            contentHash: {
                              type: 'string',
                              pattern: '^[a-f0-9]{64}$',
                            },
                            precision: {
                              type: 'string',
                              enum: ['exact', 'approximate', 'unknown'],
                            },
                            pdfPages: {
                              maxItems: 2000,
                              type: 'array',
                              items: {
                                type: 'integer',
                                minimum: 1,
                                maximum: 2000,
                              },
                            },
                            printedPages: {
                              maxItems: 2000,
                              type: 'array',
                              items: {
                                type: 'string',
                                maxLength: 120,
                              },
                            },
                          },
                          required: [
                            'receiptId',
                            'path',
                            'quote',
                            'source',
                            'systemId',
                            'revision',
                            'contentHash',
                          ],
                          additionalProperties: false,
                          description:
                            'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                        },
                      },
                      required: ['type', 'citation'],
                      additionalProperties: false,
                    },
                  ],
                },
              },
              op: {
                type: 'string',
                const: 'update',
              },
              expected: {
                type: 'object',
                properties: {
                  shortTermGoal: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                  longTermGoal: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                  boundaries: {
                    maxItems: 20,
                    type: 'array',
                    items: {
                      type: 'string',
                      minLength: 1,
                      maxLength: 2000,
                    },
                  },
                  relationshipKnowledgeIds: {
                    maxItems: 1000,
                    type: 'array',
                    items: {
                      type: 'string',
                      format: 'uuid',
                      pattern:
                        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                    },
                  },
                  revealedTraitKnowledgeIds: {
                    maxItems: 1000,
                    type: 'array',
                    items: {
                      type: 'string',
                      format: 'uuid',
                      pattern:
                        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                    },
                  },
                  tension: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                  secret: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                  characterId: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                },
                required: [
                  'shortTermGoal',
                  'longTermGoal',
                  'boundaries',
                  'relationshipKnowledgeIds',
                  'revealedTraitKnowledgeIds',
                  'characterId',
                ],
                additionalProperties: false,
              },
              next: {
                type: 'object',
                properties: {
                  shortTermGoal: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                  longTermGoal: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                  boundaries: {
                    maxItems: 20,
                    type: 'array',
                    items: {
                      type: 'string',
                      minLength: 1,
                      maxLength: 2000,
                    },
                  },
                  relationshipKnowledgeIds: {
                    maxItems: 1000,
                    type: 'array',
                    items: {
                      anyOf: [
                        {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        {
                          type: 'object',
                          properties: {
                            knowledgeChangeIndex: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['knowledgeChangeIndex'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            npcIntroductionOperationIndex: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['npcIntroductionOperationIndex'],
                          additionalProperties: false,
                        },
                      ],
                    },
                  },
                  revealedTraitKnowledgeIds: {
                    maxItems: 1000,
                    type: 'array',
                    items: {
                      anyOf: [
                        {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        {
                          type: 'object',
                          properties: {
                            knowledgeChangeIndex: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['knowledgeChangeIndex'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            npcIntroductionOperationIndex: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['npcIntroductionOperationIndex'],
                          additionalProperties: false,
                        },
                      ],
                    },
                  },
                  tension: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                  secret: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                },
                required: [
                  'shortTermGoal',
                  'longTermGoal',
                  'boundaries',
                  'relationshipKnowledgeIds',
                  'revealedTraitKnowledgeIds',
                ],
                additionalProperties: false,
              },
            },
            required: [
              'characterId',
              'explanation',
              'origin',
              'evidence',
              'op',
              'expected',
              'next',
            ],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              characterId: {
                anyOf: [
                  {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  {
                    type: 'object',
                    properties: {
                      operationIndex: {
                        type: 'integer',
                        minimum: 0,
                        maximum: 9007199254740991,
                      },
                    },
                    required: ['operationIndex'],
                    additionalProperties: false,
                  },
                ],
              },
              explanation: {
                type: 'string',
                minLength: 1,
                maxLength: 100000,
              },
              origin: {
                type: 'string',
                enum: ['source', 'gm', 'player', 'unknown'],
              },
              evidence: {
                type: 'array',
                items: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        type: {
                          type: 'string',
                          const: 'map_asset',
                        },
                        assetId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        observationId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        region: {
                          type: 'object',
                          properties: {
                            x: {
                              type: 'number',
                              minimum: 0,
                              maximum: 1,
                            },
                            y: {
                              type: 'number',
                              minimum: 0,
                              maximum: 1,
                            },
                            width: {
                              type: 'number',
                              exclusiveMinimum: 0,
                              maximum: 1,
                            },
                            height: {
                              type: 'number',
                              exclusiveMinimum: 0,
                              maximum: 1,
                            },
                          },
                          required: ['x', 'y', 'width', 'height'],
                          additionalProperties: false,
                        },
                      },
                      required: ['type', 'assetId', 'observationId', 'region'],
                      additionalProperties: false,
                    },
                    {
                      type: 'object',
                      properties: {
                        type: {
                          type: 'string',
                          const: 'campaign_source',
                        },
                        sourceId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        version: {
                          type: 'integer',
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                        },
                        sourceName: {
                          type: 'string',
                        },
                        quote: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 100000,
                        },
                        start: {
                          type: 'integer',
                          minimum: 0,
                          maximum: 9007199254740991,
                        },
                        end: {
                          type: 'integer',
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                        },
                      },
                      required: ['type', 'sourceId', 'version', 'sourceName', 'quote'],
                      additionalProperties: false,
                      description:
                        'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                    },
                    {
                      type: 'object',
                      properties: {
                        type: {
                          type: 'string',
                          const: 'book',
                        },
                        citation: {
                          type: 'object',
                          properties: {
                            receiptId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            path: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 512,
                            },
                            quote: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 600,
                            },
                            start: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                            end: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                            source: {
                              type: 'string',
                              maxLength: 80,
                              pattern: '^[a-z0-9][a-z0-9_-]*$',
                            },
                            systemId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            revision: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                            contentHash: {
                              type: 'string',
                              pattern: '^[a-f0-9]{64}$',
                            },
                            precision: {
                              type: 'string',
                              enum: ['exact', 'approximate', 'unknown'],
                            },
                            pdfPages: {
                              maxItems: 2000,
                              type: 'array',
                              items: {
                                type: 'integer',
                                minimum: 1,
                                maximum: 2000,
                              },
                            },
                            printedPages: {
                              maxItems: 2000,
                              type: 'array',
                              items: {
                                type: 'string',
                                maxLength: 120,
                              },
                            },
                          },
                          required: [
                            'receiptId',
                            'path',
                            'quote',
                            'source',
                            'systemId',
                            'revision',
                            'contentHash',
                          ],
                          additionalProperties: false,
                          description:
                            'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                        },
                      },
                      required: ['type', 'citation'],
                      additionalProperties: false,
                    },
                  ],
                },
              },
              op: {
                type: 'string',
                const: 'remove',
              },
              expected: {
                type: 'object',
                properties: {
                  shortTermGoal: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                  longTermGoal: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                  boundaries: {
                    maxItems: 20,
                    type: 'array',
                    items: {
                      type: 'string',
                      minLength: 1,
                      maxLength: 2000,
                    },
                  },
                  relationshipKnowledgeIds: {
                    maxItems: 1000,
                    type: 'array',
                    items: {
                      type: 'string',
                      format: 'uuid',
                      pattern:
                        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                    },
                  },
                  revealedTraitKnowledgeIds: {
                    maxItems: 1000,
                    type: 'array',
                    items: {
                      type: 'string',
                      format: 'uuid',
                      pattern:
                        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                    },
                  },
                  tension: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                  secret: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2000,
                  },
                  characterId: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                },
                required: [
                  'shortTermGoal',
                  'longTermGoal',
                  'boundaries',
                  'relationshipKnowledgeIds',
                  'revealedTraitKnowledgeIds',
                  'characterId',
                ],
                additionalProperties: false,
              },
              next: {
                type: 'null',
              },
            },
            required: [
              'characterId',
              'explanation',
              'origin',
              'evidence',
              'op',
              'expected',
              'next',
            ],
            additionalProperties: false,
          },
        ],
      },
    },
    atlasChanges: {
      type: 'object',
      properties: {
        createPlaces: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                minLength: 1,
                maxLength: 200,
              },
              title: {
                type: 'string',
                minLength: 1,
                maxLength: 200,
              },
              text: {
                type: 'string',
                minLength: 1,
                maxLength: 100000,
              },
              visibility: {
                type: 'string',
                enum: ['player', 'gm_only'],
              },
              certainty: {
                type: 'string',
                enum: ['established', 'rumor', 'belief'],
              },
            },
            required: ['key', 'title', 'text', 'visibility', 'certainty'],
            additionalProperties: false,
          },
        },
        places: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: {
                type: 'object',
                properties: {
                  placeId: {
                    anyOf: [
                      {
                        anyOf: [
                          {
                            type: 'string',
                            format: 'uuid',
                            pattern:
                              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                          },
                          {
                            type: 'object',
                            properties: {
                              knowledgeChangeIndex: {
                                type: 'integer',
                                minimum: 0,
                                maximum: 9007199254740991,
                              },
                            },
                            required: ['knowledgeChangeIndex'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              npcIntroductionOperationIndex: {
                                type: 'integer',
                                minimum: 0,
                                maximum: 9007199254740991,
                              },
                            },
                            required: ['npcIntroductionOperationIndex'],
                            additionalProperties: false,
                          },
                        ],
                      },
                      {
                        type: 'object',
                        properties: {
                          localKey: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 200,
                          },
                        },
                        required: ['localKey'],
                        additionalProperties: false,
                      },
                    ],
                  },
                  parentPlaceId: {
                    anyOf: [
                      {
                        anyOf: [
                          {
                            anyOf: [
                              {
                                type: 'string',
                                format: 'uuid',
                                pattern:
                                  '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                              },
                              {
                                type: 'object',
                                properties: {
                                  knowledgeChangeIndex: {
                                    type: 'integer',
                                    minimum: 0,
                                    maximum: 9007199254740991,
                                  },
                                },
                                required: ['knowledgeChangeIndex'],
                                additionalProperties: false,
                              },
                              {
                                type: 'object',
                                properties: {
                                  npcIntroductionOperationIndex: {
                                    type: 'integer',
                                    minimum: 0,
                                    maximum: 9007199254740991,
                                  },
                                },
                                required: ['npcIntroductionOperationIndex'],
                                additionalProperties: false,
                              },
                            ],
                          },
                          {
                            type: 'object',
                            properties: {
                              localKey: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 200,
                              },
                            },
                            required: ['localKey'],
                            additionalProperties: false,
                          },
                        ],
                      },
                      {
                        type: 'null',
                      },
                    ],
                  },
                  visited: {
                    type: 'boolean',
                  },
                  placement: {
                    type: 'object',
                    properties: {
                      frameId: {
                        anyOf: [
                          {
                            type: 'string',
                            format: 'uuid',
                            pattern:
                              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                          },
                          {
                            type: 'object',
                            properties: {
                              localKey: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 200,
                              },
                            },
                            required: ['localKey'],
                            additionalProperties: false,
                          },
                        ],
                      },
                      x: {
                        type: 'number',
                        minimum: 0,
                      },
                      y: {
                        type: 'number',
                        minimum: 0,
                      },
                      width: {
                        type: 'number',
                        exclusiveMinimum: 0,
                      },
                      height: {
                        type: 'number',
                        exclusiveMinimum: 0,
                      },
                    },
                    required: ['frameId', 'x', 'y'],
                    additionalProperties: false,
                  },
                },
                required: ['placeId', 'visited'],
                additionalProperties: false,
              },
              expected: {
                anyOf: [
                  {
                    anyOf: [
                      {
                        type: 'object',
                        properties: {
                          placeId: {
                            type: 'string',
                            format: 'uuid',
                            pattern:
                              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                          },
                          parentPlaceId: {
                            anyOf: [
                              {
                                type: 'string',
                                format: 'uuid',
                                pattern:
                                  '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                              },
                              {
                                type: 'null',
                              },
                            ],
                          },
                          visited: {
                            type: 'boolean',
                          },
                          placement: {
                            type: 'object',
                            properties: {
                              frameId: {
                                type: 'string',
                                format: 'uuid',
                                pattern:
                                  '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                              },
                              x: {
                                type: 'number',
                                minimum: 0,
                              },
                              y: {
                                type: 'number',
                                minimum: 0,
                              },
                              width: {
                                type: 'number',
                                exclusiveMinimum: 0,
                              },
                              height: {
                                type: 'number',
                                exclusiveMinimum: 0,
                              },
                            },
                            required: ['frameId', 'x', 'y'],
                            additionalProperties: false,
                          },
                        },
                        required: ['placeId', 'visited'],
                        additionalProperties: false,
                      },
                      {
                        type: 'string',
                        pattern: '^[a-f0-9]{64}$',
                      },
                    ],
                  },
                  {
                    type: 'null',
                  },
                ],
              },
            },
            required: ['value', 'expected'],
            additionalProperties: false,
          },
        },
        routes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  from: {
                    anyOf: [
                      {
                        anyOf: [
                          {
                            type: 'string',
                            format: 'uuid',
                            pattern:
                              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                          },
                          {
                            type: 'object',
                            properties: {
                              knowledgeChangeIndex: {
                                type: 'integer',
                                minimum: 0,
                                maximum: 9007199254740991,
                              },
                            },
                            required: ['knowledgeChangeIndex'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              npcIntroductionOperationIndex: {
                                type: 'integer',
                                minimum: 0,
                                maximum: 9007199254740991,
                              },
                            },
                            required: ['npcIntroductionOperationIndex'],
                            additionalProperties: false,
                          },
                        ],
                      },
                      {
                        type: 'object',
                        properties: {
                          localKey: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 200,
                          },
                        },
                        required: ['localKey'],
                        additionalProperties: false,
                      },
                    ],
                  },
                  to: {
                    anyOf: [
                      {
                        anyOf: [
                          {
                            type: 'string',
                            format: 'uuid',
                            pattern:
                              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                          },
                          {
                            type: 'object',
                            properties: {
                              knowledgeChangeIndex: {
                                type: 'integer',
                                minimum: 0,
                                maximum: 9007199254740991,
                              },
                            },
                            required: ['knowledgeChangeIndex'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              npcIntroductionOperationIndex: {
                                type: 'integer',
                                minimum: 0,
                                maximum: 9007199254740991,
                              },
                            },
                            required: ['npcIntroductionOperationIndex'],
                            additionalProperties: false,
                          },
                        ],
                      },
                      {
                        type: 'object',
                        properties: {
                          localKey: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 200,
                          },
                        },
                        required: ['localKey'],
                        additionalProperties: false,
                      },
                    ],
                  },
                  bidirectional: {
                    type: 'boolean',
                  },
                  kind: {
                    type: 'string',
                    enum: [
                      'road',
                      'path',
                      'passage',
                      'door',
                      'stairs',
                      'ladder',
                      'waterway',
                      'other',
                    ],
                  },
                  access: {
                    type: 'string',
                    enum: ['open', 'closed', 'locked', 'blocked', 'unknown'],
                  },
                  visibility: {
                    type: 'string',
                    enum: ['player', 'gm_only'],
                  },
                  certainty: {
                    type: 'string',
                    enum: ['established', 'rumor', 'belief'],
                  },
                  direction: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 200,
                  },
                  distance: {
                    type: 'object',
                    properties: {
                      value: {
                        type: 'number',
                        exclusiveMinimum: 0,
                      },
                      unit: {
                        type: 'string',
                        enum: ['m', 'km', 'ft', 'mi'],
                      },
                    },
                    required: ['value', 'unit'],
                    additionalProperties: false,
                  },
                  travel: {
                    type: 'object',
                    properties: {
                      mode: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 200,
                      },
                      minutes: {
                        type: 'number',
                        exclusiveMinimum: 0,
                      },
                      conditions: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 100000,
                      },
                    },
                    required: ['mode', 'minutes'],
                    additionalProperties: false,
                  },
                  drawing: {
                    type: 'object',
                    properties: {
                      frameId: {
                        anyOf: [
                          {
                            type: 'string',
                            format: 'uuid',
                            pattern:
                              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                          },
                          {
                            type: 'object',
                            properties: {
                              localKey: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 200,
                              },
                            },
                            required: ['localKey'],
                            additionalProperties: false,
                          },
                        ],
                      },
                      points: {
                        minItems: 2,
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            x: {
                              type: 'number',
                              minimum: 0,
                            },
                            y: {
                              type: 'number',
                              minimum: 0,
                            },
                          },
                          required: ['x', 'y'],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ['frameId', 'points'],
                    additionalProperties: false,
                  },
                  origin: {
                    type: 'string',
                    enum: ['source', 'gm', 'player', 'unknown'],
                  },
                  evidence: {
                    type: 'array',
                    items: {
                      oneOf: [
                        {
                          type: 'object',
                          properties: {
                            type: {
                              type: 'string',
                              const: 'map_asset',
                            },
                            assetId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            observationId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            region: {
                              type: 'object',
                              properties: {
                                x: {
                                  type: 'number',
                                  minimum: 0,
                                  maximum: 1,
                                },
                                y: {
                                  type: 'number',
                                  minimum: 0,
                                  maximum: 1,
                                },
                                width: {
                                  type: 'number',
                                  exclusiveMinimum: 0,
                                  maximum: 1,
                                },
                                height: {
                                  type: 'number',
                                  exclusiveMinimum: 0,
                                  maximum: 1,
                                },
                              },
                              required: ['x', 'y', 'width', 'height'],
                              additionalProperties: false,
                            },
                          },
                          required: ['type', 'assetId', 'observationId', 'region'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            type: {
                              type: 'string',
                              const: 'campaign_source',
                            },
                            sourceId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            version: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                            sourceName: {
                              type: 'string',
                            },
                            quote: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 100000,
                            },
                            start: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                            end: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['type', 'sourceId', 'version', 'sourceName', 'quote'],
                          additionalProperties: false,
                          description:
                            'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                        },
                        {
                          type: 'object',
                          properties: {
                            type: {
                              type: 'string',
                              const: 'book',
                            },
                            citation: {
                              type: 'object',
                              properties: {
                                receiptId: {
                                  type: 'string',
                                  format: 'uuid',
                                  pattern:
                                    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                },
                                path: {
                                  type: 'string',
                                  minLength: 1,
                                  maxLength: 512,
                                },
                                quote: {
                                  type: 'string',
                                  minLength: 1,
                                  maxLength: 600,
                                },
                                start: {
                                  type: 'integer',
                                  minimum: 0,
                                  maximum: 9007199254740991,
                                },
                                end: {
                                  type: 'integer',
                                  exclusiveMinimum: 0,
                                  maximum: 9007199254740991,
                                },
                                source: {
                                  type: 'string',
                                  maxLength: 80,
                                  pattern: '^[a-z0-9][a-z0-9_-]*$',
                                },
                                systemId: {
                                  type: 'string',
                                  format: 'uuid',
                                  pattern:
                                    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                },
                                revision: {
                                  type: 'integer',
                                  exclusiveMinimum: 0,
                                  maximum: 9007199254740991,
                                },
                                contentHash: {
                                  type: 'string',
                                  pattern: '^[a-f0-9]{64}$',
                                },
                                precision: {
                                  type: 'string',
                                  enum: ['exact', 'approximate', 'unknown'],
                                },
                                pdfPages: {
                                  maxItems: 2000,
                                  type: 'array',
                                  items: {
                                    type: 'integer',
                                    minimum: 1,
                                    maximum: 2000,
                                  },
                                },
                                printedPages: {
                                  maxItems: 2000,
                                  type: 'array',
                                  items: {
                                    type: 'string',
                                    maxLength: 120,
                                  },
                                },
                              },
                              required: [
                                'receiptId',
                                'path',
                                'quote',
                                'source',
                                'systemId',
                                'revision',
                                'contentHash',
                              ],
                              additionalProperties: false,
                              description:
                                'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                            },
                          },
                          required: ['type', 'citation'],
                          additionalProperties: false,
                        },
                      ],
                    },
                  },
                },
                required: [
                  'from',
                  'to',
                  'bidirectional',
                  'kind',
                  'access',
                  'visibility',
                  'certainty',
                  'origin',
                  'evidence',
                ],
                additionalProperties: false,
              },
              expected: {
                anyOf: [
                  {
                    anyOf: [
                      {
                        type: 'object',
                        properties: {
                          id: {
                            type: 'string',
                            format: 'uuid',
                            pattern:
                              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                          },
                          from: {
                            type: 'string',
                            format: 'uuid',
                            pattern:
                              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                          },
                          to: {
                            type: 'string',
                            format: 'uuid',
                            pattern:
                              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                          },
                          bidirectional: {
                            type: 'boolean',
                          },
                          kind: {
                            type: 'string',
                            enum: [
                              'road',
                              'path',
                              'passage',
                              'door',
                              'stairs',
                              'ladder',
                              'waterway',
                              'other',
                            ],
                          },
                          access: {
                            type: 'string',
                            enum: ['open', 'closed', 'locked', 'blocked', 'unknown'],
                          },
                          visibility: {
                            type: 'string',
                            enum: ['player', 'gm_only'],
                          },
                          certainty: {
                            type: 'string',
                            enum: ['established', 'rumor', 'belief'],
                          },
                          direction: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 200,
                          },
                          distance: {
                            type: 'object',
                            properties: {
                              value: {
                                type: 'number',
                                exclusiveMinimum: 0,
                              },
                              unit: {
                                type: 'string',
                                enum: ['m', 'km', 'ft', 'mi'],
                              },
                            },
                            required: ['value', 'unit'],
                            additionalProperties: false,
                          },
                          travel: {
                            type: 'object',
                            properties: {
                              mode: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 200,
                              },
                              minutes: {
                                type: 'number',
                                exclusiveMinimum: 0,
                              },
                              conditions: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 100000,
                              },
                            },
                            required: ['mode', 'minutes'],
                            additionalProperties: false,
                          },
                          drawing: {
                            type: 'object',
                            properties: {
                              frameId: {
                                type: 'string',
                                format: 'uuid',
                                pattern:
                                  '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                              },
                              points: {
                                minItems: 2,
                                type: 'array',
                                items: {
                                  type: 'object',
                                  properties: {
                                    x: {
                                      type: 'number',
                                      minimum: 0,
                                    },
                                    y: {
                                      type: 'number',
                                      minimum: 0,
                                    },
                                  },
                                  required: ['x', 'y'],
                                  additionalProperties: false,
                                },
                              },
                            },
                            required: ['frameId', 'points'],
                            additionalProperties: false,
                          },
                          origin: {
                            type: 'string',
                            enum: ['source', 'gm', 'player', 'unknown'],
                          },
                          evidence: {
                            type: 'array',
                            items: {
                              oneOf: [
                                {
                                  type: 'object',
                                  properties: {
                                    type: {
                                      type: 'string',
                                      const: 'map_asset',
                                    },
                                    assetId: {
                                      type: 'string',
                                      format: 'uuid',
                                      pattern:
                                        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                    },
                                    observationId: {
                                      type: 'string',
                                      format: 'uuid',
                                      pattern:
                                        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                    },
                                    region: {
                                      type: 'object',
                                      properties: {
                                        x: {
                                          type: 'number',
                                          minimum: 0,
                                          maximum: 1,
                                        },
                                        y: {
                                          type: 'number',
                                          minimum: 0,
                                          maximum: 1,
                                        },
                                        width: {
                                          type: 'number',
                                          exclusiveMinimum: 0,
                                          maximum: 1,
                                        },
                                        height: {
                                          type: 'number',
                                          exclusiveMinimum: 0,
                                          maximum: 1,
                                        },
                                      },
                                      required: ['x', 'y', 'width', 'height'],
                                      additionalProperties: false,
                                    },
                                  },
                                  required: ['type', 'assetId', 'observationId', 'region'],
                                  additionalProperties: false,
                                },
                                {
                                  type: 'object',
                                  properties: {
                                    type: {
                                      type: 'string',
                                      const: 'campaign_source',
                                    },
                                    sourceId: {
                                      type: 'string',
                                      format: 'uuid',
                                      pattern:
                                        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                    },
                                    version: {
                                      type: 'integer',
                                      exclusiveMinimum: 0,
                                      maximum: 9007199254740991,
                                    },
                                    sourceName: {
                                      type: 'string',
                                    },
                                    quote: {
                                      type: 'string',
                                      minLength: 1,
                                      maxLength: 100000,
                                    },
                                    start: {
                                      type: 'integer',
                                      minimum: 0,
                                      maximum: 9007199254740991,
                                    },
                                    end: {
                                      type: 'integer',
                                      exclusiveMinimum: 0,
                                      maximum: 9007199254740991,
                                    },
                                  },
                                  required: ['type', 'sourceId', 'version', 'sourceName', 'quote'],
                                  additionalProperties: false,
                                  description:
                                    'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                                },
                                {
                                  type: 'object',
                                  properties: {
                                    type: {
                                      type: 'string',
                                      const: 'book',
                                    },
                                    citation: {
                                      type: 'object',
                                      properties: {
                                        receiptId: {
                                          type: 'string',
                                          format: 'uuid',
                                          pattern:
                                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                        },
                                        path: {
                                          type: 'string',
                                          minLength: 1,
                                          maxLength: 512,
                                        },
                                        quote: {
                                          type: 'string',
                                          minLength: 1,
                                          maxLength: 600,
                                        },
                                        start: {
                                          type: 'integer',
                                          minimum: 0,
                                          maximum: 9007199254740991,
                                        },
                                        end: {
                                          type: 'integer',
                                          exclusiveMinimum: 0,
                                          maximum: 9007199254740991,
                                        },
                                        source: {
                                          type: 'string',
                                          maxLength: 80,
                                          pattern: '^[a-z0-9][a-z0-9_-]*$',
                                        },
                                        systemId: {
                                          type: 'string',
                                          format: 'uuid',
                                          pattern:
                                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                        },
                                        revision: {
                                          type: 'integer',
                                          exclusiveMinimum: 0,
                                          maximum: 9007199254740991,
                                        },
                                        contentHash: {
                                          type: 'string',
                                          pattern: '^[a-f0-9]{64}$',
                                        },
                                        precision: {
                                          type: 'string',
                                          enum: ['exact', 'approximate', 'unknown'],
                                        },
                                        pdfPages: {
                                          maxItems: 2000,
                                          type: 'array',
                                          items: {
                                            type: 'integer',
                                            minimum: 1,
                                            maximum: 2000,
                                          },
                                        },
                                        printedPages: {
                                          maxItems: 2000,
                                          type: 'array',
                                          items: {
                                            type: 'string',
                                            maxLength: 120,
                                          },
                                        },
                                      },
                                      required: [
                                        'receiptId',
                                        'path',
                                        'quote',
                                        'source',
                                        'systemId',
                                        'revision',
                                        'contentHash',
                                      ],
                                      additionalProperties: false,
                                      description:
                                        'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                                    },
                                  },
                                  required: ['type', 'citation'],
                                  additionalProperties: false,
                                },
                              ],
                            },
                          },
                        },
                        required: [
                          'id',
                          'from',
                          'to',
                          'bidirectional',
                          'kind',
                          'access',
                          'visibility',
                          'certainty',
                          'origin',
                          'evidence',
                        ],
                        additionalProperties: false,
                      },
                      {
                        type: 'string',
                        pattern: '^[a-f0-9]{64}$',
                      },
                    ],
                  },
                  {
                    type: 'null',
                  },
                ],
              },
            },
            required: ['value', 'expected'],
            additionalProperties: false,
          },
        },
        frames: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  placeId: {
                    anyOf: [
                      {
                        anyOf: [
                          {
                            type: 'string',
                            format: 'uuid',
                            pattern:
                              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                          },
                          {
                            type: 'object',
                            properties: {
                              knowledgeChangeIndex: {
                                type: 'integer',
                                minimum: 0,
                                maximum: 9007199254740991,
                              },
                            },
                            required: ['knowledgeChangeIndex'],
                            additionalProperties: false,
                          },
                          {
                            type: 'object',
                            properties: {
                              npcIntroductionOperationIndex: {
                                type: 'integer',
                                minimum: 0,
                                maximum: 9007199254740991,
                              },
                            },
                            required: ['npcIntroductionOperationIndex'],
                            additionalProperties: false,
                          },
                        ],
                      },
                      {
                        type: 'object',
                        properties: {
                          localKey: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 200,
                          },
                        },
                        required: ['localKey'],
                        additionalProperties: false,
                      },
                    ],
                  },
                  label: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 200,
                  },
                  floor: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 200,
                  },
                  width: {
                    type: 'number',
                    exclusiveMinimum: 0,
                  },
                  height: {
                    type: 'number',
                    exclusiveMinimum: 0,
                  },
                  calibration: {
                    type: 'object',
                    properties: {
                      distancePerUnit: {
                        type: 'number',
                        exclusiveMinimum: 0,
                      },
                      unit: {
                        type: 'string',
                        enum: ['m', 'km', 'ft', 'mi'],
                      },
                    },
                    required: ['distancePerUnit', 'unit'],
                    additionalProperties: false,
                  },
                  visibility: {
                    type: 'string',
                    enum: ['player', 'gm_only'],
                  },
                  origin: {
                    type: 'string',
                    enum: ['source', 'gm', 'player', 'unknown'],
                  },
                  evidence: {
                    type: 'array',
                    items: {
                      oneOf: [
                        {
                          type: 'object',
                          properties: {
                            type: {
                              type: 'string',
                              const: 'map_asset',
                            },
                            assetId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            observationId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            region: {
                              type: 'object',
                              properties: {
                                x: {
                                  type: 'number',
                                  minimum: 0,
                                  maximum: 1,
                                },
                                y: {
                                  type: 'number',
                                  minimum: 0,
                                  maximum: 1,
                                },
                                width: {
                                  type: 'number',
                                  exclusiveMinimum: 0,
                                  maximum: 1,
                                },
                                height: {
                                  type: 'number',
                                  exclusiveMinimum: 0,
                                  maximum: 1,
                                },
                              },
                              required: ['x', 'y', 'width', 'height'],
                              additionalProperties: false,
                            },
                          },
                          required: ['type', 'assetId', 'observationId', 'region'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            type: {
                              type: 'string',
                              const: 'campaign_source',
                            },
                            sourceId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            version: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                            sourceName: {
                              type: 'string',
                            },
                            quote: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 100000,
                            },
                            start: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                            end: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['type', 'sourceId', 'version', 'sourceName', 'quote'],
                          additionalProperties: false,
                          description:
                            'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                        },
                        {
                          type: 'object',
                          properties: {
                            type: {
                              type: 'string',
                              const: 'book',
                            },
                            citation: {
                              type: 'object',
                              properties: {
                                receiptId: {
                                  type: 'string',
                                  format: 'uuid',
                                  pattern:
                                    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                },
                                path: {
                                  type: 'string',
                                  minLength: 1,
                                  maxLength: 512,
                                },
                                quote: {
                                  type: 'string',
                                  minLength: 1,
                                  maxLength: 600,
                                },
                                start: {
                                  type: 'integer',
                                  minimum: 0,
                                  maximum: 9007199254740991,
                                },
                                end: {
                                  type: 'integer',
                                  exclusiveMinimum: 0,
                                  maximum: 9007199254740991,
                                },
                                source: {
                                  type: 'string',
                                  maxLength: 80,
                                  pattern: '^[a-z0-9][a-z0-9_-]*$',
                                },
                                systemId: {
                                  type: 'string',
                                  format: 'uuid',
                                  pattern:
                                    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                },
                                revision: {
                                  type: 'integer',
                                  exclusiveMinimum: 0,
                                  maximum: 9007199254740991,
                                },
                                contentHash: {
                                  type: 'string',
                                  pattern: '^[a-f0-9]{64}$',
                                },
                                precision: {
                                  type: 'string',
                                  enum: ['exact', 'approximate', 'unknown'],
                                },
                                pdfPages: {
                                  maxItems: 2000,
                                  type: 'array',
                                  items: {
                                    type: 'integer',
                                    minimum: 1,
                                    maximum: 2000,
                                  },
                                },
                                printedPages: {
                                  maxItems: 2000,
                                  type: 'array',
                                  items: {
                                    type: 'string',
                                    maxLength: 120,
                                  },
                                },
                              },
                              required: [
                                'receiptId',
                                'path',
                                'quote',
                                'source',
                                'systemId',
                                'revision',
                                'contentHash',
                              ],
                              additionalProperties: false,
                              description:
                                'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                            },
                          },
                          required: ['type', 'citation'],
                          additionalProperties: false,
                        },
                      ],
                    },
                  },
                  privateAssetId: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  playerAssetId: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  key: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 200,
                  },
                },
                required: [
                  'placeId',
                  'label',
                  'floor',
                  'width',
                  'height',
                  'visibility',
                  'origin',
                  'evidence',
                ],
                additionalProperties: false,
              },
              expected: {
                anyOf: [
                  {
                    anyOf: [
                      {
                        type: 'object',
                        properties: {
                          id: {
                            type: 'string',
                            format: 'uuid',
                            pattern:
                              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                          },
                          placeId: {
                            type: 'string',
                            format: 'uuid',
                            pattern:
                              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                          },
                          label: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 200,
                          },
                          floor: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 200,
                          },
                          width: {
                            type: 'number',
                            exclusiveMinimum: 0,
                          },
                          height: {
                            type: 'number',
                            exclusiveMinimum: 0,
                          },
                          calibration: {
                            type: 'object',
                            properties: {
                              distancePerUnit: {
                                type: 'number',
                                exclusiveMinimum: 0,
                              },
                              unit: {
                                type: 'string',
                                enum: ['m', 'km', 'ft', 'mi'],
                              },
                            },
                            required: ['distancePerUnit', 'unit'],
                            additionalProperties: false,
                          },
                          visibility: {
                            type: 'string',
                            enum: ['player', 'gm_only'],
                          },
                          origin: {
                            type: 'string',
                            enum: ['source', 'gm', 'player', 'unknown'],
                          },
                          evidence: {
                            type: 'array',
                            items: {
                              oneOf: [
                                {
                                  type: 'object',
                                  properties: {
                                    type: {
                                      type: 'string',
                                      const: 'map_asset',
                                    },
                                    assetId: {
                                      type: 'string',
                                      format: 'uuid',
                                      pattern:
                                        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                    },
                                    observationId: {
                                      type: 'string',
                                      format: 'uuid',
                                      pattern:
                                        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                    },
                                    region: {
                                      type: 'object',
                                      properties: {
                                        x: {
                                          type: 'number',
                                          minimum: 0,
                                          maximum: 1,
                                        },
                                        y: {
                                          type: 'number',
                                          minimum: 0,
                                          maximum: 1,
                                        },
                                        width: {
                                          type: 'number',
                                          exclusiveMinimum: 0,
                                          maximum: 1,
                                        },
                                        height: {
                                          type: 'number',
                                          exclusiveMinimum: 0,
                                          maximum: 1,
                                        },
                                      },
                                      required: ['x', 'y', 'width', 'height'],
                                      additionalProperties: false,
                                    },
                                  },
                                  required: ['type', 'assetId', 'observationId', 'region'],
                                  additionalProperties: false,
                                },
                                {
                                  type: 'object',
                                  properties: {
                                    type: {
                                      type: 'string',
                                      const: 'campaign_source',
                                    },
                                    sourceId: {
                                      type: 'string',
                                      format: 'uuid',
                                      pattern:
                                        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                    },
                                    version: {
                                      type: 'integer',
                                      exclusiveMinimum: 0,
                                      maximum: 9007199254740991,
                                    },
                                    sourceName: {
                                      type: 'string',
                                    },
                                    quote: {
                                      type: 'string',
                                      minLength: 1,
                                      maxLength: 100000,
                                    },
                                    start: {
                                      type: 'integer',
                                      minimum: 0,
                                      maximum: 9007199254740991,
                                    },
                                    end: {
                                      type: 'integer',
                                      exclusiveMinimum: 0,
                                      maximum: 9007199254740991,
                                    },
                                  },
                                  required: ['type', 'sourceId', 'version', 'sourceName', 'quote'],
                                  additionalProperties: false,
                                  description:
                                    'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                                },
                                {
                                  type: 'object',
                                  properties: {
                                    type: {
                                      type: 'string',
                                      const: 'book',
                                    },
                                    citation: {
                                      type: 'object',
                                      properties: {
                                        receiptId: {
                                          type: 'string',
                                          format: 'uuid',
                                          pattern:
                                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                        },
                                        path: {
                                          type: 'string',
                                          minLength: 1,
                                          maxLength: 512,
                                        },
                                        quote: {
                                          type: 'string',
                                          minLength: 1,
                                          maxLength: 600,
                                        },
                                        start: {
                                          type: 'integer',
                                          minimum: 0,
                                          maximum: 9007199254740991,
                                        },
                                        end: {
                                          type: 'integer',
                                          exclusiveMinimum: 0,
                                          maximum: 9007199254740991,
                                        },
                                        source: {
                                          type: 'string',
                                          maxLength: 80,
                                          pattern: '^[a-z0-9][a-z0-9_-]*$',
                                        },
                                        systemId: {
                                          type: 'string',
                                          format: 'uuid',
                                          pattern:
                                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                        },
                                        revision: {
                                          type: 'integer',
                                          exclusiveMinimum: 0,
                                          maximum: 9007199254740991,
                                        },
                                        contentHash: {
                                          type: 'string',
                                          pattern: '^[a-f0-9]{64}$',
                                        },
                                        precision: {
                                          type: 'string',
                                          enum: ['exact', 'approximate', 'unknown'],
                                        },
                                        pdfPages: {
                                          maxItems: 2000,
                                          type: 'array',
                                          items: {
                                            type: 'integer',
                                            minimum: 1,
                                            maximum: 2000,
                                          },
                                        },
                                        printedPages: {
                                          maxItems: 2000,
                                          type: 'array',
                                          items: {
                                            type: 'string',
                                            maxLength: 120,
                                          },
                                        },
                                      },
                                      required: [
                                        'receiptId',
                                        'path',
                                        'quote',
                                        'source',
                                        'systemId',
                                        'revision',
                                        'contentHash',
                                      ],
                                      additionalProperties: false,
                                      description:
                                        'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                                    },
                                  },
                                  required: ['type', 'citation'],
                                  additionalProperties: false,
                                },
                              ],
                            },
                          },
                          privateAssetId: {
                            type: 'string',
                            format: 'uuid',
                            pattern:
                              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                          },
                          playerAssetId: {
                            type: 'string',
                            format: 'uuid',
                            pattern:
                              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                          },
                        },
                        required: [
                          'id',
                          'placeId',
                          'label',
                          'floor',
                          'width',
                          'height',
                          'visibility',
                          'origin',
                          'evidence',
                        ],
                        additionalProperties: false,
                      },
                      {
                        type: 'string',
                        pattern: '^[a-f0-9]{64}$',
                      },
                    ],
                  },
                  {
                    type: 'null',
                  },
                ],
              },
            },
            required: ['value', 'expected'],
            additionalProperties: false,
          },
        },
        removePlaces: {
          type: 'array',
          items: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  placeId: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  parentPlaceId: {
                    anyOf: [
                      {
                        type: 'string',
                        format: 'uuid',
                        pattern:
                          '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                      },
                      {
                        type: 'null',
                      },
                    ],
                  },
                  visited: {
                    type: 'boolean',
                  },
                  placement: {
                    type: 'object',
                    properties: {
                      frameId: {
                        type: 'string',
                        format: 'uuid',
                        pattern:
                          '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                      },
                      x: {
                        type: 'number',
                        minimum: 0,
                      },
                      y: {
                        type: 'number',
                        minimum: 0,
                      },
                      width: {
                        type: 'number',
                        exclusiveMinimum: 0,
                      },
                      height: {
                        type: 'number',
                        exclusiveMinimum: 0,
                      },
                    },
                    required: ['frameId', 'x', 'y'],
                    additionalProperties: false,
                  },
                },
                required: ['placeId', 'visited'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  placeId: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  expected: {
                    type: 'string',
                    pattern: '^[a-f0-9]{64}$',
                  },
                },
                required: ['placeId', 'expected'],
                additionalProperties: false,
              },
            ],
          },
        },
        removeRoutes: {
          type: 'array',
          items: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  from: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  to: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  bidirectional: {
                    type: 'boolean',
                  },
                  kind: {
                    type: 'string',
                    enum: [
                      'road',
                      'path',
                      'passage',
                      'door',
                      'stairs',
                      'ladder',
                      'waterway',
                      'other',
                    ],
                  },
                  access: {
                    type: 'string',
                    enum: ['open', 'closed', 'locked', 'blocked', 'unknown'],
                  },
                  visibility: {
                    type: 'string',
                    enum: ['player', 'gm_only'],
                  },
                  certainty: {
                    type: 'string',
                    enum: ['established', 'rumor', 'belief'],
                  },
                  direction: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 200,
                  },
                  distance: {
                    type: 'object',
                    properties: {
                      value: {
                        type: 'number',
                        exclusiveMinimum: 0,
                      },
                      unit: {
                        type: 'string',
                        enum: ['m', 'km', 'ft', 'mi'],
                      },
                    },
                    required: ['value', 'unit'],
                    additionalProperties: false,
                  },
                  travel: {
                    type: 'object',
                    properties: {
                      mode: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 200,
                      },
                      minutes: {
                        type: 'number',
                        exclusiveMinimum: 0,
                      },
                      conditions: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 100000,
                      },
                    },
                    required: ['mode', 'minutes'],
                    additionalProperties: false,
                  },
                  drawing: {
                    type: 'object',
                    properties: {
                      frameId: {
                        type: 'string',
                        format: 'uuid',
                        pattern:
                          '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                      },
                      points: {
                        minItems: 2,
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            x: {
                              type: 'number',
                              minimum: 0,
                            },
                            y: {
                              type: 'number',
                              minimum: 0,
                            },
                          },
                          required: ['x', 'y'],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ['frameId', 'points'],
                    additionalProperties: false,
                  },
                  origin: {
                    type: 'string',
                    enum: ['source', 'gm', 'player', 'unknown'],
                  },
                  evidence: {
                    type: 'array',
                    items: {
                      oneOf: [
                        {
                          type: 'object',
                          properties: {
                            type: {
                              type: 'string',
                              const: 'map_asset',
                            },
                            assetId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            observationId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            region: {
                              type: 'object',
                              properties: {
                                x: {
                                  type: 'number',
                                  minimum: 0,
                                  maximum: 1,
                                },
                                y: {
                                  type: 'number',
                                  minimum: 0,
                                  maximum: 1,
                                },
                                width: {
                                  type: 'number',
                                  exclusiveMinimum: 0,
                                  maximum: 1,
                                },
                                height: {
                                  type: 'number',
                                  exclusiveMinimum: 0,
                                  maximum: 1,
                                },
                              },
                              required: ['x', 'y', 'width', 'height'],
                              additionalProperties: false,
                            },
                          },
                          required: ['type', 'assetId', 'observationId', 'region'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            type: {
                              type: 'string',
                              const: 'campaign_source',
                            },
                            sourceId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            version: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                            sourceName: {
                              type: 'string',
                            },
                            quote: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 100000,
                            },
                            start: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                            end: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['type', 'sourceId', 'version', 'sourceName', 'quote'],
                          additionalProperties: false,
                          description:
                            'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                        },
                        {
                          type: 'object',
                          properties: {
                            type: {
                              type: 'string',
                              const: 'book',
                            },
                            citation: {
                              type: 'object',
                              properties: {
                                receiptId: {
                                  type: 'string',
                                  format: 'uuid',
                                  pattern:
                                    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                },
                                path: {
                                  type: 'string',
                                  minLength: 1,
                                  maxLength: 512,
                                },
                                quote: {
                                  type: 'string',
                                  minLength: 1,
                                  maxLength: 600,
                                },
                                start: {
                                  type: 'integer',
                                  minimum: 0,
                                  maximum: 9007199254740991,
                                },
                                end: {
                                  type: 'integer',
                                  exclusiveMinimum: 0,
                                  maximum: 9007199254740991,
                                },
                                source: {
                                  type: 'string',
                                  maxLength: 80,
                                  pattern: '^[a-z0-9][a-z0-9_-]*$',
                                },
                                systemId: {
                                  type: 'string',
                                  format: 'uuid',
                                  pattern:
                                    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                },
                                revision: {
                                  type: 'integer',
                                  exclusiveMinimum: 0,
                                  maximum: 9007199254740991,
                                },
                                contentHash: {
                                  type: 'string',
                                  pattern: '^[a-f0-9]{64}$',
                                },
                                precision: {
                                  type: 'string',
                                  enum: ['exact', 'approximate', 'unknown'],
                                },
                                pdfPages: {
                                  maxItems: 2000,
                                  type: 'array',
                                  items: {
                                    type: 'integer',
                                    minimum: 1,
                                    maximum: 2000,
                                  },
                                },
                                printedPages: {
                                  maxItems: 2000,
                                  type: 'array',
                                  items: {
                                    type: 'string',
                                    maxLength: 120,
                                  },
                                },
                              },
                              required: [
                                'receiptId',
                                'path',
                                'quote',
                                'source',
                                'systemId',
                                'revision',
                                'contentHash',
                              ],
                              additionalProperties: false,
                              description:
                                'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                            },
                          },
                          required: ['type', 'citation'],
                          additionalProperties: false,
                        },
                      ],
                    },
                  },
                },
                required: [
                  'id',
                  'from',
                  'to',
                  'bidirectional',
                  'kind',
                  'access',
                  'visibility',
                  'certainty',
                  'origin',
                  'evidence',
                ],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  expected: {
                    type: 'string',
                    pattern: '^[a-f0-9]{64}$',
                  },
                },
                required: ['id', 'expected'],
                additionalProperties: false,
              },
            ],
          },
        },
        removeFrames: {
          type: 'array',
          items: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  placeId: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  label: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 200,
                  },
                  floor: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 200,
                  },
                  width: {
                    type: 'number',
                    exclusiveMinimum: 0,
                  },
                  height: {
                    type: 'number',
                    exclusiveMinimum: 0,
                  },
                  calibration: {
                    type: 'object',
                    properties: {
                      distancePerUnit: {
                        type: 'number',
                        exclusiveMinimum: 0,
                      },
                      unit: {
                        type: 'string',
                        enum: ['m', 'km', 'ft', 'mi'],
                      },
                    },
                    required: ['distancePerUnit', 'unit'],
                    additionalProperties: false,
                  },
                  visibility: {
                    type: 'string',
                    enum: ['player', 'gm_only'],
                  },
                  origin: {
                    type: 'string',
                    enum: ['source', 'gm', 'player', 'unknown'],
                  },
                  evidence: {
                    type: 'array',
                    items: {
                      oneOf: [
                        {
                          type: 'object',
                          properties: {
                            type: {
                              type: 'string',
                              const: 'map_asset',
                            },
                            assetId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            observationId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            region: {
                              type: 'object',
                              properties: {
                                x: {
                                  type: 'number',
                                  minimum: 0,
                                  maximum: 1,
                                },
                                y: {
                                  type: 'number',
                                  minimum: 0,
                                  maximum: 1,
                                },
                                width: {
                                  type: 'number',
                                  exclusiveMinimum: 0,
                                  maximum: 1,
                                },
                                height: {
                                  type: 'number',
                                  exclusiveMinimum: 0,
                                  maximum: 1,
                                },
                              },
                              required: ['x', 'y', 'width', 'height'],
                              additionalProperties: false,
                            },
                          },
                          required: ['type', 'assetId', 'observationId', 'region'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            type: {
                              type: 'string',
                              const: 'campaign_source',
                            },
                            sourceId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            version: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                            sourceName: {
                              type: 'string',
                            },
                            quote: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 100000,
                            },
                            start: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                            end: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['type', 'sourceId', 'version', 'sourceName', 'quote'],
                          additionalProperties: false,
                          description:
                            'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                        },
                        {
                          type: 'object',
                          properties: {
                            type: {
                              type: 'string',
                              const: 'book',
                            },
                            citation: {
                              type: 'object',
                              properties: {
                                receiptId: {
                                  type: 'string',
                                  format: 'uuid',
                                  pattern:
                                    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                },
                                path: {
                                  type: 'string',
                                  minLength: 1,
                                  maxLength: 512,
                                },
                                quote: {
                                  type: 'string',
                                  minLength: 1,
                                  maxLength: 600,
                                },
                                start: {
                                  type: 'integer',
                                  minimum: 0,
                                  maximum: 9007199254740991,
                                },
                                end: {
                                  type: 'integer',
                                  exclusiveMinimum: 0,
                                  maximum: 9007199254740991,
                                },
                                source: {
                                  type: 'string',
                                  maxLength: 80,
                                  pattern: '^[a-z0-9][a-z0-9_-]*$',
                                },
                                systemId: {
                                  type: 'string',
                                  format: 'uuid',
                                  pattern:
                                    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                },
                                revision: {
                                  type: 'integer',
                                  exclusiveMinimum: 0,
                                  maximum: 9007199254740991,
                                },
                                contentHash: {
                                  type: 'string',
                                  pattern: '^[a-f0-9]{64}$',
                                },
                                precision: {
                                  type: 'string',
                                  enum: ['exact', 'approximate', 'unknown'],
                                },
                                pdfPages: {
                                  maxItems: 2000,
                                  type: 'array',
                                  items: {
                                    type: 'integer',
                                    minimum: 1,
                                    maximum: 2000,
                                  },
                                },
                                printedPages: {
                                  maxItems: 2000,
                                  type: 'array',
                                  items: {
                                    type: 'string',
                                    maxLength: 120,
                                  },
                                },
                              },
                              required: [
                                'receiptId',
                                'path',
                                'quote',
                                'source',
                                'systemId',
                                'revision',
                                'contentHash',
                              ],
                              additionalProperties: false,
                              description:
                                'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                            },
                          },
                          required: ['type', 'citation'],
                          additionalProperties: false,
                        },
                      ],
                    },
                  },
                  privateAssetId: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  playerAssetId: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                },
                required: [
                  'id',
                  'placeId',
                  'label',
                  'floor',
                  'width',
                  'height',
                  'visibility',
                  'origin',
                  'evidence',
                ],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    format: 'uuid',
                    pattern:
                      '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                  },
                  expected: {
                    type: 'string',
                    pattern: '^[a-f0-9]{64}$',
                  },
                },
                required: ['id', 'expected'],
                additionalProperties: false,
              },
            ],
          },
        },
        position: {
          type: 'object',
          properties: {
            placeId: {
              anyOf: [
                {
                  anyOf: [
                    {
                      anyOf: [
                        {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        {
                          type: 'object',
                          properties: {
                            knowledgeChangeIndex: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['knowledgeChangeIndex'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            npcIntroductionOperationIndex: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['npcIntroductionOperationIndex'],
                          additionalProperties: false,
                        },
                      ],
                    },
                    {
                      type: 'object',
                      properties: {
                        localKey: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 200,
                        },
                      },
                      required: ['localKey'],
                      additionalProperties: false,
                    },
                  ],
                },
                {
                  type: 'null',
                },
              ],
            },
            expected: {
              anyOf: [
                {
                  type: 'string',
                  format: 'uuid',
                  pattern:
                    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                },
                {
                  type: 'null',
                },
              ],
            },
            exception: {
              type: 'string',
              minLength: 1,
              maxLength: 100000,
            },
          },
          required: ['placeId', 'expected'],
          additionalProperties: false,
        },
        preparedReceiptIds: {
          type: 'array',
          items: {
            type: 'string',
            format: 'uuid',
            pattern:
              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          },
        },
      },
      additionalProperties: false,
    },
    narrative: {
      type: 'string',
      minLength: 1,
    },
    operations: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                const: 'create',
              },
              character: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 200,
                  },
                  type: {
                    default: 'player',
                    type: 'string',
                    enum: ['player', 'npc'],
                  },
                  attributes: {
                    default: {},
                    type: 'object',
                    propertyNames: {
                      type: 'string',
                    },
                    additionalProperties: {},
                  },
                  inventory: {
                    default: {},
                    type: 'object',
                    propertyNames: {
                      type: 'string',
                    },
                    additionalProperties: {},
                  },
                  description: {
                    default: {},
                    type: 'object',
                    propertyNames: {
                      type: 'string',
                    },
                    additionalProperties: {},
                  },
                },
                required: ['name', 'type', 'attributes', 'inventory', 'description'],
                additionalProperties: false,
              },
              introduction: {
                type: 'object',
                properties: {
                  origin: {
                    type: 'string',
                    enum: ['source', 'gm', 'player', 'unknown'],
                  },
                  evidence: {
                    type: 'array',
                    items: {
                      oneOf: [
                        {
                          type: 'object',
                          properties: {
                            type: {
                              type: 'string',
                              const: 'map_asset',
                            },
                            assetId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            observationId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            region: {
                              type: 'object',
                              properties: {
                                x: {
                                  type: 'number',
                                  minimum: 0,
                                  maximum: 1,
                                },
                                y: {
                                  type: 'number',
                                  minimum: 0,
                                  maximum: 1,
                                },
                                width: {
                                  type: 'number',
                                  exclusiveMinimum: 0,
                                  maximum: 1,
                                },
                                height: {
                                  type: 'number',
                                  exclusiveMinimum: 0,
                                  maximum: 1,
                                },
                              },
                              required: ['x', 'y', 'width', 'height'],
                              additionalProperties: false,
                            },
                          },
                          required: ['type', 'assetId', 'observationId', 'region'],
                          additionalProperties: false,
                        },
                        {
                          type: 'object',
                          properties: {
                            type: {
                              type: 'string',
                              const: 'campaign_source',
                            },
                            sourceId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            version: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                            sourceName: {
                              type: 'string',
                            },
                            quote: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 100000,
                            },
                            start: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                            end: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['type', 'sourceId', 'version', 'sourceName', 'quote'],
                          additionalProperties: false,
                          description:
                            'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                        },
                        {
                          type: 'object',
                          properties: {
                            type: {
                              type: 'string',
                              const: 'book',
                            },
                            citation: {
                              type: 'object',
                              properties: {
                                receiptId: {
                                  type: 'string',
                                  format: 'uuid',
                                  pattern:
                                    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                },
                                path: {
                                  type: 'string',
                                  minLength: 1,
                                  maxLength: 512,
                                },
                                quote: {
                                  type: 'string',
                                  minLength: 1,
                                  maxLength: 600,
                                },
                                start: {
                                  type: 'integer',
                                  minimum: 0,
                                  maximum: 9007199254740991,
                                },
                                end: {
                                  type: 'integer',
                                  exclusiveMinimum: 0,
                                  maximum: 9007199254740991,
                                },
                                source: {
                                  type: 'string',
                                  maxLength: 80,
                                  pattern: '^[a-z0-9][a-z0-9_-]*$',
                                },
                                systemId: {
                                  type: 'string',
                                  format: 'uuid',
                                  pattern:
                                    '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                                },
                                revision: {
                                  type: 'integer',
                                  exclusiveMinimum: 0,
                                  maximum: 9007199254740991,
                                },
                                contentHash: {
                                  type: 'string',
                                  pattern: '^[a-f0-9]{64}$',
                                },
                                precision: {
                                  type: 'string',
                                  enum: ['exact', 'approximate', 'unknown'],
                                },
                                pdfPages: {
                                  maxItems: 2000,
                                  type: 'array',
                                  items: {
                                    type: 'integer',
                                    minimum: 1,
                                    maximum: 2000,
                                  },
                                },
                                printedPages: {
                                  maxItems: 2000,
                                  type: 'array',
                                  items: {
                                    type: 'string',
                                    maxLength: 120,
                                  },
                                },
                              },
                              required: [
                                'receiptId',
                                'path',
                                'quote',
                                'source',
                                'systemId',
                                'revision',
                                'contentHash',
                              ],
                              additionalProperties: false,
                              description:
                                'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                            },
                          },
                          required: ['type', 'citation'],
                          additionalProperties: false,
                        },
                      ],
                    },
                  },
                  visibility: {
                    type: 'string',
                    enum: ['player', 'gm_only'],
                  },
                },
                required: ['origin', 'evidence', 'visibility'],
                additionalProperties: false,
              },
              characterId: {
                type: 'string',
                format: 'uuid',
                pattern:
                  '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
              },
              preparationReceiptId: {
                type: 'string',
                format: 'uuid',
                pattern:
                  '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
              },
              npcPreparationReceiptId: {
                type: 'string',
                format: 'uuid',
                pattern:
                  '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
              },
            },
            required: ['op', 'character', 'introduction'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                const: 'set',
              },
              characterId: {
                type: 'string',
                format: 'uuid',
                pattern:
                  '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
              },
              field: {
                type: 'string',
                enum: ['name', 'attributes', 'inventory', 'description'],
              },
              expected: {},
              value: {},
            },
            required: ['op', 'characterId', 'field', 'expected', 'value'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                const: 'state',
              },
              expected: {
                type: 'object',
                propertyNames: {
                  type: 'string',
                },
                additionalProperties: {},
              },
              value: {
                type: 'object',
                propertyNames: {
                  type: 'string',
                },
                additionalProperties: {},
              },
            },
            required: ['op', 'expected', 'value'],
            additionalProperties: false,
          },
        ],
      },
    },
    rollInterpretations: {
      maxItems: 12,
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rollId: {
            type: 'string',
            format: 'uuid',
            pattern:
              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          },
          explanation: {
            type: 'string',
            minLength: 1,
            maxLength: 600,
          },
          corrections: {
            maxItems: 12,
            type: 'array',
            items: {
              type: 'object',
              properties: {
                explanation: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 600,
                },
              },
              required: ['explanation'],
              additionalProperties: false,
            },
          },
          afterParagraph: {
            type: 'integer',
            exclusiveMinimum: 0,
            maximum: 9007199254740991,
          },
        },
        required: ['rollId', 'explanation'],
        additionalProperties: false,
      },
    },
    ruleCitations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          receiptId: {
            type: 'string',
            format: 'uuid',
            pattern:
              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          },
          path: {
            type: 'string',
            minLength: 1,
            maxLength: 512,
          },
          quote: {
            type: 'string',
            minLength: 1,
            maxLength: 600,
          },
          start: {
            type: 'integer',
            minimum: 0,
            maximum: 9007199254740991,
          },
          end: {
            type: 'integer',
            exclusiveMinimum: 0,
            maximum: 9007199254740991,
          },
          source: {
            type: 'string',
            maxLength: 80,
            pattern: '^[a-z0-9][a-z0-9_-]*$',
          },
          systemId: {
            type: 'string',
            format: 'uuid',
            pattern:
              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          },
          revision: {
            type: 'integer',
            exclusiveMinimum: 0,
            maximum: 9007199254740991,
          },
          contentHash: {
            type: 'string',
            pattern: '^[a-f0-9]{64}$',
          },
          precision: {
            type: 'string',
            enum: ['exact', 'approximate', 'unknown'],
          },
          pdfPages: {
            maxItems: 2000,
            type: 'array',
            items: {
              type: 'integer',
              minimum: 1,
              maximum: 2000,
            },
          },
          printedPages: {
            maxItems: 2000,
            type: 'array',
            items: {
              type: 'string',
              maxLength: 120,
            },
          },
        },
        required: ['receiptId', 'path', 'quote', 'source', 'systemId', 'revision', 'contentHash'],
        additionalProperties: false,
        description:
          'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
      },
    },
    knowledgeChanges: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                const: 'create',
              },
              kind: {
                type: 'string',
                enum: ['npc', 'place', 'relationship', 'debt', 'objective', 'event', 'other'],
              },
              title: {
                type: 'string',
                minLength: 1,
                maxLength: 200,
              },
              text: {
                type: 'string',
                minLength: 1,
                maxLength: 100000,
              },
              certainty: {
                type: 'string',
                enum: ['established', 'rumor', 'belief'],
              },
              status: {
                type: 'string',
                enum: ['active', 'resolved', 'retracted'],
              },
              characterIds: {
                type: 'array',
                items: {
                  anyOf: [
                    {
                      type: 'string',
                      format: 'uuid',
                      pattern:
                        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                    },
                    {
                      type: 'object',
                      properties: {
                        operationIndex: {
                          type: 'integer',
                          minimum: 0,
                          maximum: 9007199254740991,
                        },
                      },
                      required: ['operationIndex'],
                      additionalProperties: false,
                    },
                  ],
                },
              },
              holderId: {
                anyOf: [
                  {
                    anyOf: [
                      {
                        type: 'string',
                        format: 'uuid',
                        pattern:
                          '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                      },
                      {
                        type: 'object',
                        properties: {
                          operationIndex: {
                            type: 'integer',
                            minimum: 0,
                            maximum: 9007199254740991,
                          },
                        },
                        required: ['operationIndex'],
                        additionalProperties: false,
                      },
                    ],
                  },
                  {
                    type: 'null',
                  },
                ],
              },
              origin: {
                type: 'string',
                enum: ['source', 'gm', 'player', 'unknown'],
              },
              evidence: {
                type: 'array',
                items: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        type: {
                          type: 'string',
                          const: 'map_asset',
                        },
                        assetId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        observationId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        region: {
                          type: 'object',
                          properties: {
                            x: {
                              type: 'number',
                              minimum: 0,
                              maximum: 1,
                            },
                            y: {
                              type: 'number',
                              minimum: 0,
                              maximum: 1,
                            },
                            width: {
                              type: 'number',
                              exclusiveMinimum: 0,
                              maximum: 1,
                            },
                            height: {
                              type: 'number',
                              exclusiveMinimum: 0,
                              maximum: 1,
                            },
                          },
                          required: ['x', 'y', 'width', 'height'],
                          additionalProperties: false,
                        },
                      },
                      required: ['type', 'assetId', 'observationId', 'region'],
                      additionalProperties: false,
                    },
                    {
                      type: 'object',
                      properties: {
                        type: {
                          type: 'string',
                          const: 'campaign_source',
                        },
                        sourceId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        version: {
                          type: 'integer',
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                        },
                        sourceName: {
                          type: 'string',
                        },
                        quote: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 100000,
                        },
                        start: {
                          type: 'integer',
                          minimum: 0,
                          maximum: 9007199254740991,
                        },
                        end: {
                          type: 'integer',
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                        },
                      },
                      required: ['type', 'sourceId', 'version', 'sourceName', 'quote'],
                      additionalProperties: false,
                      description:
                        'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                    },
                    {
                      type: 'object',
                      properties: {
                        type: {
                          type: 'string',
                          const: 'book',
                        },
                        citation: {
                          type: 'object',
                          properties: {
                            receiptId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            path: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 512,
                            },
                            quote: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 600,
                            },
                            start: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                            end: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                            source: {
                              type: 'string',
                              maxLength: 80,
                              pattern: '^[a-z0-9][a-z0-9_-]*$',
                            },
                            systemId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            revision: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                            contentHash: {
                              type: 'string',
                              pattern: '^[a-f0-9]{64}$',
                            },
                            precision: {
                              type: 'string',
                              enum: ['exact', 'approximate', 'unknown'],
                            },
                            pdfPages: {
                              maxItems: 2000,
                              type: 'array',
                              items: {
                                type: 'integer',
                                minimum: 1,
                                maximum: 2000,
                              },
                            },
                            printedPages: {
                              maxItems: 2000,
                              type: 'array',
                              items: {
                                type: 'string',
                                maxLength: 120,
                              },
                            },
                          },
                          required: [
                            'receiptId',
                            'path',
                            'quote',
                            'source',
                            'systemId',
                            'revision',
                            'contentHash',
                          ],
                          additionalProperties: false,
                          description:
                            'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                        },
                      },
                      required: ['type', 'citation'],
                      additionalProperties: false,
                    },
                  ],
                },
              },
              visibility: {
                type: 'string',
                enum: ['player', 'gm_only'],
              },
            },
            required: [
              'op',
              'kind',
              'title',
              'text',
              'certainty',
              'status',
              'characterIds',
              'origin',
              'evidence',
              'visibility',
            ],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                const: 'update',
              },
              id: {
                type: 'string',
                format: 'uuid',
                pattern:
                  '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
              },
              expectedRevision: {
                type: 'integer',
                exclusiveMinimum: 0,
                maximum: 9007199254740991,
              },
              changes: {
                type: 'object',
                properties: {
                  kind: {
                    type: 'string',
                    enum: ['npc', 'place', 'relationship', 'debt', 'objective', 'event', 'other'],
                  },
                  title: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 200,
                  },
                  text: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 100000,
                  },
                  certainty: {
                    type: 'string',
                    enum: ['established', 'rumor', 'belief'],
                  },
                  status: {
                    type: 'string',
                    enum: ['active', 'resolved', 'retracted'],
                  },
                  characterIds: {
                    type: 'array',
                    items: {
                      anyOf: [
                        {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        {
                          type: 'object',
                          properties: {
                            operationIndex: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                          },
                          required: ['operationIndex'],
                          additionalProperties: false,
                        },
                      ],
                    },
                  },
                  holderId: {
                    anyOf: [
                      {
                        anyOf: [
                          {
                            type: 'string',
                            format: 'uuid',
                            pattern:
                              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                          },
                          {
                            type: 'object',
                            properties: {
                              operationIndex: {
                                type: 'integer',
                                minimum: 0,
                                maximum: 9007199254740991,
                              },
                            },
                            required: ['operationIndex'],
                            additionalProperties: false,
                          },
                        ],
                      },
                      {
                        type: 'null',
                      },
                    ],
                  },
                  visibility: {
                    type: 'string',
                    enum: ['player', 'gm_only'],
                  },
                },
                additionalProperties: false,
              },
              origin: {
                type: 'string',
                enum: ['source', 'gm', 'player', 'unknown'],
              },
              evidence: {
                type: 'array',
                items: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        type: {
                          type: 'string',
                          const: 'map_asset',
                        },
                        assetId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        observationId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        region: {
                          type: 'object',
                          properties: {
                            x: {
                              type: 'number',
                              minimum: 0,
                              maximum: 1,
                            },
                            y: {
                              type: 'number',
                              minimum: 0,
                              maximum: 1,
                            },
                            width: {
                              type: 'number',
                              exclusiveMinimum: 0,
                              maximum: 1,
                            },
                            height: {
                              type: 'number',
                              exclusiveMinimum: 0,
                              maximum: 1,
                            },
                          },
                          required: ['x', 'y', 'width', 'height'],
                          additionalProperties: false,
                        },
                      },
                      required: ['type', 'assetId', 'observationId', 'region'],
                      additionalProperties: false,
                    },
                    {
                      type: 'object',
                      properties: {
                        type: {
                          type: 'string',
                          const: 'campaign_source',
                        },
                        sourceId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        version: {
                          type: 'integer',
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                        },
                        sourceName: {
                          type: 'string',
                        },
                        quote: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 100000,
                        },
                        start: {
                          type: 'integer',
                          minimum: 0,
                          maximum: 9007199254740991,
                        },
                        end: {
                          type: 'integer',
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                        },
                      },
                      required: ['type', 'sourceId', 'version', 'sourceName', 'quote'],
                      additionalProperties: false,
                      description:
                        'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                    },
                    {
                      type: 'object',
                      properties: {
                        type: {
                          type: 'string',
                          const: 'book',
                        },
                        citation: {
                          type: 'object',
                          properties: {
                            receiptId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            path: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 512,
                            },
                            quote: {
                              type: 'string',
                              minLength: 1,
                              maxLength: 600,
                            },
                            start: {
                              type: 'integer',
                              minimum: 0,
                              maximum: 9007199254740991,
                            },
                            end: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                            source: {
                              type: 'string',
                              maxLength: 80,
                              pattern: '^[a-z0-9][a-z0-9_-]*$',
                            },
                            systemId: {
                              type: 'string',
                              format: 'uuid',
                              pattern:
                                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                            },
                            revision: {
                              type: 'integer',
                              exclusiveMinimum: 0,
                              maximum: 9007199254740991,
                            },
                            contentHash: {
                              type: 'string',
                              pattern: '^[a-f0-9]{64}$',
                            },
                            precision: {
                              type: 'string',
                              enum: ['exact', 'approximate', 'unknown'],
                            },
                            pdfPages: {
                              maxItems: 2000,
                              type: 'array',
                              items: {
                                type: 'integer',
                                minimum: 1,
                                maximum: 2000,
                              },
                            },
                            printedPages: {
                              maxItems: 2000,
                              type: 'array',
                              items: {
                                type: 'string',
                                maxLength: 120,
                              },
                            },
                          },
                          required: [
                            'receiptId',
                            'path',
                            'quote',
                            'source',
                            'systemId',
                            'revision',
                            'contentHash',
                          ],
                          additionalProperties: false,
                          description:
                            'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                        },
                      },
                      required: ['type', 'citation'],
                      additionalProperties: false,
                    },
                  ],
                },
              },
              revealReason: {
                type: 'string',
                minLength: 1,
                maxLength: 100000,
              },
            },
            required: ['op', 'id', 'expectedRevision', 'changes', 'origin', 'evidence'],
            additionalProperties: false,
          },
        ],
      },
    },
    operationExplanations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          operationIndex: {
            type: 'integer',
            minimum: 0,
            maximum: 9007199254740991,
          },
          reason: {
            type: 'string',
            minLength: 1,
            maxLength: 100000,
          },
          basis: {
            type: 'string',
            enum: ['initial_state', 'established_state', 'rule', 'provisional', 'dice', 'source'],
          },
          rollIds: {
            type: 'array',
            items: {
              type: 'string',
              format: 'uuid',
              pattern:
                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
            },
          },
          evidence: {
            type: 'array',
            items: {
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      const: 'map_asset',
                    },
                    assetId: {
                      type: 'string',
                      format: 'uuid',
                      pattern:
                        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                    },
                    observationId: {
                      type: 'string',
                      format: 'uuid',
                      pattern:
                        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                    },
                    region: {
                      type: 'object',
                      properties: {
                        x: {
                          type: 'number',
                          minimum: 0,
                          maximum: 1,
                        },
                        y: {
                          type: 'number',
                          minimum: 0,
                          maximum: 1,
                        },
                        width: {
                          type: 'number',
                          exclusiveMinimum: 0,
                          maximum: 1,
                        },
                        height: {
                          type: 'number',
                          exclusiveMinimum: 0,
                          maximum: 1,
                        },
                      },
                      required: ['x', 'y', 'width', 'height'],
                      additionalProperties: false,
                    },
                  },
                  required: ['type', 'assetId', 'observationId', 'region'],
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      const: 'campaign_source',
                    },
                    sourceId: {
                      type: 'string',
                      format: 'uuid',
                      pattern:
                        '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                    },
                    version: {
                      type: 'integer',
                      exclusiveMinimum: 0,
                      maximum: 9007199254740991,
                    },
                    sourceName: {
                      type: 'string',
                    },
                    quote: {
                      type: 'string',
                      minLength: 1,
                      maxLength: 100000,
                    },
                    start: {
                      type: 'integer',
                      minimum: 0,
                      maximum: 9007199254740991,
                    },
                    end: {
                      type: 'integer',
                      exclusiveMinimum: 0,
                      maximum: 9007199254740991,
                    },
                  },
                  required: ['type', 'sourceId', 'version', 'sourceName', 'quote'],
                  additionalProperties: false,
                  description:
                    'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                },
                {
                  type: 'object',
                  properties: {
                    type: {
                      type: 'string',
                      const: 'book',
                    },
                    citation: {
                      type: 'object',
                      properties: {
                        receiptId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        path: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 512,
                        },
                        quote: {
                          type: 'string',
                          minLength: 1,
                          maxLength: 600,
                        },
                        start: {
                          type: 'integer',
                          minimum: 0,
                          maximum: 9007199254740991,
                        },
                        end: {
                          type: 'integer',
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                        },
                        source: {
                          type: 'string',
                          maxLength: 80,
                          pattern: '^[a-z0-9][a-z0-9_-]*$',
                        },
                        systemId: {
                          type: 'string',
                          format: 'uuid',
                          pattern:
                            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
                        },
                        revision: {
                          type: 'integer',
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                        },
                        contentHash: {
                          type: 'string',
                          pattern: '^[a-f0-9]{64}$',
                        },
                        precision: {
                          type: 'string',
                          enum: ['exact', 'approximate', 'unknown'],
                        },
                        pdfPages: {
                          maxItems: 2000,
                          type: 'array',
                          items: {
                            type: 'integer',
                            minimum: 1,
                            maximum: 2000,
                          },
                        },
                        printedPages: {
                          maxItems: 2000,
                          type: 'array',
                          items: {
                            type: 'string',
                            maxLength: 120,
                          },
                        },
                      },
                      required: [
                        'receiptId',
                        'path',
                        'quote',
                        'source',
                        'systemId',
                        'revision',
                        'contentHash',
                      ],
                      additionalProperties: false,
                      description:
                        'Provide an exact quote and source identity. The application calculates offsets and page metadata.',
                    },
                  },
                  required: ['type', 'citation'],
                  additionalProperties: false,
                },
              ],
            },
          },
          visibility: {
            type: 'string',
            enum: ['player', 'gm_only'],
          },
        },
        required: ['operationIndex', 'reason', 'basis', 'rollIds', 'evidence', 'visibility'],
        additionalProperties: false,
      },
    },
    combatEffects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          characterId: {
            type: 'string',
            format: 'uuid',
            pattern:
              '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
          },
          operationIndex: {
            type: 'integer',
            minimum: 0,
            maximum: 9007199254740991,
          },
          paths: {
            minItems: 1,
            maxItems: 64,
            type: 'array',
            items: {
              minItems: 1,
              maxItems: 16,
              type: 'array',
              items: {
                type: 'string',
                minLength: 1,
                maxLength: 200,
              },
            },
          },
          reason: {
            type: 'string',
            minLength: 1,
            maxLength: 100000,
          },
          rollIds: {
            type: 'array',
            items: {
              type: 'string',
              format: 'uuid',
              pattern:
                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
            },
          },
          afterParagraph: {
            type: 'integer',
            exclusiveMinimum: 0,
            maximum: 9007199254740991,
          },
        },
        required: ['characterId', 'operationIndex', 'paths', 'reason', 'rollIds', 'afterParagraph'],
        additionalProperties: false,
      },
    },
    participantReferences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          afterParagraph: {
            type: 'integer',
            exclusiveMinimum: 0,
            maximum: 9007199254740991,
          },
          characterIds: {
            minItems: 1,
            maxItems: 1000,
            type: 'array',
            items: {
              type: 'string',
              format: 'uuid',
              pattern:
                '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
            },
          },
        },
        required: ['afterParagraph', 'characterIds'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'narrative',
    'operations',
    'rollInterpretations',
    'ruleCitations',
    'knowledgeChanges',
    'operationExplanations',
    'combatEffects',
    'participantReferences',
  ],
  additionalProperties: false,
} as const;
