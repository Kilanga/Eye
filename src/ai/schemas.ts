import { Schema } from 'firebase/ai';
import { CATEGORIES } from '../core/types';

/** On-device output constraint (plain JSON Schema, passed to Chrome's Prompt API). */
export const classificationJsonSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          category: { type: 'string', enum: [...CATEGORIES] },
        },
        required: ['i', 'category'],
      },
    },
  },
  required: ['items'],
} as const;

/** Cloud output schema for the 90-day plan. */
export const planSchema = Schema.object({
  properties: {
    summary: Schema.string(),
    steps: Schema.array({
      items: Schema.object({
        properties: {
          i: Schema.integer(),
          action: Schema.string(),
          why: Schema.string(),
        },
      }),
    }),
  },
});

/** Cloud output schema for the letter template (placeholders only, never real values). */
export const letterSchema = Schema.object({
  properties: {
    template: Schema.string(),
    placeholders: Schema.array({ items: Schema.string() }),
  },
});
