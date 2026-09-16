import { z } from 'zod';

// Section 9.3 — the error envelope schema. Lives apart from the error classes so
// the classes stay runtime-pure (no zod) — the purity smoke test depends on it.
// The interface is hand-written (zod cannot infer readonly tuple fields); the
// schema is annotated with it, so parse() output is a PlacitumError.
export interface PlacitumError {
  code: string; // e.g. "E403_GUARD_PATH_TRAVERSAL" — always matches ^E\d{3}_[A-Z_]+$
  phase: 'lex' | 'parse' | 'extract' | 'guard' | 'eval' | 'cli' | 'agent' | 'replay';
  severity: 'error' | 'warning';
  message: string;
  location?: { line: number; col: number; span?: readonly [number, number] | undefined } | undefined;
  hint?: string | undefined;
}

export const PlacitumErrorSchema: z.ZodType<PlacitumError> = z.object({
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
