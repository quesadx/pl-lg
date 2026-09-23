import type { PlacitumError } from './error-schema.js';

export type { PlacitumError } from './error-schema.js';

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

export class ExtractError extends PlacitumErrorBase {
  constructor(init: Omit<PlacitumErrorInit, 'phase'>) {
    super({ ...init, phase: 'extract' });
  }
}

export class CapabilityViolationError extends PlacitumErrorBase {
  constructor(init: Omit<PlacitumErrorInit, 'phase'>) {
    super({ ...init, phase: 'guard' });
  }
}

export class EvalError extends PlacitumErrorBase {
  constructor(init: Omit<PlacitumErrorInit, 'phase'>) {
    super({ ...init, phase: 'eval' });
  }
}

export class CliError extends PlacitumErrorBase {
  constructor(init: Omit<PlacitumErrorInit, 'phase'>) {
    super({ ...init, phase: 'cli' });
  }
}
