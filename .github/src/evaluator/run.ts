import { extract } from '../capability/extractor.js';
import { CapabilityGuard } from '../capability/guard.js';
import type { Guard } from '../capability/guard.js';
import { hostBindings } from '../host-bindings/index.js';
import type { HostBindings } from '../host-bindings/index.js';
import { lex } from '../lexer/lexer.js';
import { parse } from '../parser/parser.js';
import { compileManifest } from '../shared/manifest.js';
import { buildStdlib } from '../stdlib/stdlib.js';
import { evaluate } from './interpreter.js';

// Phase 5 wiring: lex -> parse -> extract -> compile -> evaluate. The guard and
// host bindings are injectable so tests get deterministic stubs; production
// callers get the real guard built from the script's own manifest.

export interface RunOptions {
  env?: Record<string, string | undefined>;
  guard?: Guard;
  hosts?: HostBindings;
}

export function runSource(source: string, opts: RunOptions = {}): void {
  const program = parse(lex(source));
  const guard = opts.guard ?? new CapabilityGuard(compileManifest(extract(program)));
  guard.requireEnv(opts.env ?? process.env);
  const stdlib = buildStdlib(opts.hosts ?? hostBindings);
  evaluate(program, { globals: stdlib.globals, bangs: stdlib.bangs, guard });
}
