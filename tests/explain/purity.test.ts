import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import { extract } from '../../src/capability/extractor.js';
import { explain } from '../../src/cli/explain.js';
import { loadVmModule } from '../helpers/vm-sandbox.js';

// Phase 6 DoD: the renderer runs with zero I/O. Its closure imports zod (the
// manifest schema — a pure validator), so zod is the one allowlisted bare
// import; fs/net/os/child_process still simply do not exist in the context.
const CLOSURE = [
  'src/cli/explain.ts',
  'src/shared/manifest.ts',
  'src/shared/glob-to-regex.ts',
  'src/shared/errors.ts',
  'src/shared/printable.ts',
] as const;

describe('Phase 6: purity smoke test (Section 11 — the renderer never does I/O)', () => {
  it('renders rosetta inside the vm, byte-identical to the normal run', () => {
    const vmExplain = loadVmModule<{ explain: (manifest: unknown) => string }>(
      { closure: CLOSURE, bareImports: { zod: { z } } },
      'src/cli/explain.ts',
    ).explain;
    const program = parse(lex(readFileSync(new URL('../parser/rosetta.placitum', import.meta.url), 'utf8')));
    const manifest = extract(program);
    expect(vmExplain(manifest)).toBe(explain(manifest));
  });
});
