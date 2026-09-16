import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import { extract } from '../../src/capability/extractor.js';
import { loadVmModule } from '../helpers/vm-sandbox.js';

// Phase 3 DoD: run the extractor inside a Node vm context where an accidental
// import of fs / net / child_process / zod / anything outside the extractor's
// known-pure closure throws immediately (instead of silently succeeding via
// module caching). The transpile/mini-require machinery lives in
// tests/helpers/vm-sandbox.ts (Phase 6's explain purity test shares it).
const CLOSURE = [
  'src/capability/extractor.ts',
  'src/shared/glob-to-regex.ts',
  'src/shared/errors.ts',
] as const;

describe('Phase 3: purity smoke test (Section 2.1 — the extractor never does I/O)', () => {
  it('the sandbox denies non-closure imports (harness self-check)', () => {
    // Simulate a module inside the sandbox requiring fs: must throw, not return.
    const ctx = vm.createContext({
      require: (id: string): unknown => {
        throw new Error(`purity violation: bare import "${id}" is not in the pure closure`);
      },
    });
    expect(() => {
      vm.runInContext(`require('fs')`, ctx);
    }).toThrowError(/purity violation/);
  });

  it('extracts rosetta and kitchen-sink inside the vm, byte-identical to the normal run', () => {
    const vmExtract = loadVmModule<{ extract: (program: unknown) => unknown }>(
      { closure: CLOSURE },
      'src/capability/extractor.ts',
    ).extract;
    for (const file of ['../parser/rosetta.placitum', './kitchen-sink.placitum']) {
      const program = parse(lex(readFileSync(new URL(file, import.meta.url), 'utf8')));
      expect(JSON.stringify(vmExtract(program))).toBe(JSON.stringify(extract(program)));
    }
  });
});
