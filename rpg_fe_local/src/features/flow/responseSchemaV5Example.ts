// Reviewed teaching snapshot; backend contract tests detect schema drift.
export const responseSchemaV5Example = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    version: {
      type: 'number',
      const: 5,
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
                          required: [
                            'type',
                            'sourceId',
                            'version',
                            'sourceName',
                            'quote',
                            'start',
                            'end',
                          ],
                          additionalProperties: false,
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
                                'start',
                                'end',
                                'source',
                                'systemId',
                                'revision',
                                'contentHash',
                                'precision',
                                'pdfPages',
                                'printedPages',
                              ],
                              additionalProperties: false,
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
        required: [
          'receiptId',
          'path',
          'quote',
          'start',
          'end',
          'source',
          'systemId',
          'revision',
          'contentHash',
          'precision',
          'pdfPages',
          'printedPages',
        ],
        additionalProperties: false,
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
                      required: [
                        'type',
                        'sourceId',
                        'version',
                        'sourceName',
                        'quote',
                        'start',
                        'end',
                      ],
                      additionalProperties: false,
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
                            'start',
                            'end',
                            'source',
                            'systemId',
                            'revision',
                            'contentHash',
                            'precision',
                            'pdfPages',
                            'printedPages',
                          ],
                          additionalProperties: false,
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
                      required: [
                        'type',
                        'sourceId',
                        'version',
                        'sourceName',
                        'quote',
                        'start',
                        'end',
                      ],
                      additionalProperties: false,
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
                            'start',
                            'end',
                            'source',
                            'systemId',
                            'revision',
                            'contentHash',
                            'precision',
                            'pdfPages',
                            'printedPages',
                          ],
                          additionalProperties: false,
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
                  required: ['type', 'sourceId', 'version', 'sourceName', 'quote', 'start', 'end'],
                  additionalProperties: false,
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
                        'start',
                        'end',
                        'source',
                        'systemId',
                        'revision',
                        'contentHash',
                        'precision',
                        'pdfPages',
                        'printedPages',
                      ],
                      additionalProperties: false,
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
  },
  required: [
    'version',
    'narrative',
    'operations',
    'rollInterpretations',
    'ruleCitations',
    'knowledgeChanges',
    'operationExplanations',
  ],
  additionalProperties: false,
};
