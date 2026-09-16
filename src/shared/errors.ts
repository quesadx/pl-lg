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

// Section 9.3 — class hierarchy mirroring the phases. Every error, of any
// class, carries the envelope fields and reaches the CLI through one formatter.
export interface PlacitumErrorInit {
  code: string;
  phase: PlacitumError['phase'];
  message: string;
  severity?: 'error' | 'warning';
  location?: PlacitumError['location'];
  hint?: string;
}

export class PlacitumErrorBase extends Error {
  readonly code: string;
  readonly phase: PlacitumError['phase'];
  readonly severity: 'error' | 'warning';
  readonly location?: PlacitumError['location'];
  readonly hint?: string;

  constructor(init: PlacitumErrorInit) {
    super(init.message);
    this.name = new.target.name;
    this.code = init.code;
    this.phase = init.phase;
    this.severity = init.severity ?? 'error';
    if (init.location !== undefined) this.location = init.location;
    if (init.hint !== undefined) this.hint = init.hint;
  }

  toEnvelope(): PlacitumError {
    const envelope: PlacitumError = {
      code: this.code,
      phase: this.phase,
      severity: this.severity,
      message: this.message,
    };
    if (this.location !== undefined) envelope.location = this.location;
    if (this.hint !== undefined) envelope.hint = this.hint;
    return envelope;
  }
}

export class LexError extends PlacitumErrorBase {
  constructor(init: Omit<PlacitumErrorInit, 'phase'>) {
    super({ ...init, phase: 'lex' });
  }
}

export class ParseError extends PlacitumErrorBase {
  constructor(init: Omit<PlacitumErrorInit, 'phase'>) {
    super({ ...init, phase: 'parse' });
  }
}
