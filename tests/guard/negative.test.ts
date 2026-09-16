import { describe, expect, it } from 'vitest';
import type { BangCall, Program } from '../../src/ast/ast.js';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import { BANG_REGISTRY, extract } from '../../src/capability/extractor.js';
import { CapabilityGuard } from '../../src/capability/guard.js';
import { CapabilityViolationError } from '../../src/shared/errors.js';
import { PlacitumErrorSchema } from '../../src/shared/error-schema.js';
import { compileManifest } from '../../src/shared/manifest.js';
import { loadNegativeFixtures } from '../helpers/negative-fixtures.js';

// Phase 4: guard-phase negative fixtures. A guard fixture is a script whose
// bang-call literal *string-matches* its `needs` grant (so extraction passes)
// but whose *canonical resolution* escapes — the guard must deny with the
// exact E4xx code. Scans both negative dirs: guard fixtures live here, plus
// the Phase 0 traversal fixture in tests/capability/negative/.
const fixtures = [
  ...loadNegativeFixtures(new URL('./negative/', import.meta.url)),
  ...loadNegativeFixtures(new URL('../capability/negative/', import.meta.url)),
].filter((f) => f.expected.phase === 'guard');

// Until the Phase 5 evaluator exists, "executing" a guard fixture means driving
// the guard directly: parse, extract (must pass), compile the manifest, then
// authorize every registered bang-call's literal first argument.
function collectBangCalls(node: unknown, out: BangCall[] = []): BangCall[] {
  if (Array.isArray(node)) {
    for (const child of node) collectBangCalls(child, out);
  } else if (node !== null && typeof node === 'object') {
    if ((node as { kind?: unknown }).kind === 'BangCall') out.push(node as BangCall);
    for (const value of Object.values(node)) collectBangCalls(value, out);
  }
  return out;
}

function executeAgainstGuard(program: Program, source: string): CapabilityViolationError {
  const guard = new CapabilityGuard(compileManifest(extract(program)));
  let denied: CapabilityViolationError | null = null;
  for (const bang of collectBangCalls(program)) {
    const category = BANG_REGISTRY[bang.target];
    if (category === undefined) continue; // ambient / user-fn bangs aren't the guard's to check here
    const first = bang.args[0];
    if (first === undefined || first.kind !== 'StringLiteral') {
      throw new Error(
        `${source}: guard fixture bang "${bang.target}" must take a string literal as its first argument (pre-evaluator harness limitation)`,
      );
    }
    try {
      guard.authorize(
        category === 'net' ? { category, url: first.value } : { category, path: first.value },
      );
    } catch (err) {
      if (denied === null && err instanceof CapabilityViolationError) denied = err;
    }
  }
  if (denied === null) {
    throw new Error(`${source}: expected a CapabilityViolationError, got none`);
  }
  return denied;
}

describe('Phase 4: guard negatives (E4xx)', () => {
  it('executes at least the traversal and write-traversal fixtures, all expecting E4xx', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(2);
    for (const f of fixtures) expect(f.expected.code).toMatch(/^E4\d{2}_/);
  });

  for (const { basename, source, rawExpected } of fixtures) {
    it(`${basename}.negative.placitum throws the exact expected code`, () => {
      const expected = PlacitumErrorSchema.parse(rawExpected);
      const thrown = executeAgainstGuard(parse(lex(source)), basename);
      expect(thrown.code).toBe(expected.code);
      expect(PlacitumErrorSchema.safeParse(thrown.toEnvelope()).success).toBe(true);
    });
  }
});
