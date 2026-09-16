import { z } from 'zod';

// Section 9.3 — the single error envelope every phase emits and the CLI renders.
export const PlacitumErrorSchema = z.object({
  code: z.string().regex(/^E\d{3}_[A-Z_]+$/),
  phase: z.enum(['lex', 'parse', 'extract', 'guard', 'eval', 'cli', 'agent', 'replay']),
  severity: z.enum(['error', 'warning']),
  message: z.string().min(1),
  location: z
    .object({
      line: z.number().int().positive(),
      col: z.number().int().positive(),
      span: z
        .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
        .optional(),
    })
    .optional(),
  hint: z.string().optional(),
});

export type PlacitumError = z.infer<typeof PlacitumErrorSchema>;
