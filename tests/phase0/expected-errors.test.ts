import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PlacitumErrorSchema } from '../../src/shared/error-schema.js';

const negativeDir = new URL('../capability/negative/', import.meta.url);

const scripts = readdirSync(negativeDir)
  .filter((f) => f.endsWith('.negative.placitum'))
  .sort();

// Phase 0 DoD: the adversarial corpus exists and is schema-valid before any
// language feature does. The .placitum scripts stay inert until their phase
// wires them to a real pipeline stage.
describe('Phase 0: negative fixtures (Section 10)', () => {
  it('has at least 3 .negative.placitum scripts', () => {
    expect(scripts.length).toBeGreaterThanOrEqual(3);
  });

  it('pairs scripts and .expected-error.json 1:1 in both directions', () => {
    const jsonBasenames = readdirSync(negativeDir)
      .filter((f) => f.endsWith('.expected-error.json'))
      .map((f) => f.replace(/\.expected-error\.json$/, ''))
      .sort();
    const scriptBasenames = scripts.map((f) => f.replace(/\.negative\.placitum$/, ''));
    expect(jsonBasenames).toEqual(scriptBasenames);
  });

  for (const script of scripts) {
    const basename = script.replace(/\.negative\.placitum$/, '');

    describe(script, () => {
      it('validates its .expected-error.json against PlacitumErrorSchema (Section 9.3)', () => {
        const raw = JSON.parse(
          readFileSync(new URL(`${basename}.expected-error.json`, negativeDir), 'utf8'),
        ) as unknown;
        const result = PlacitumErrorSchema.safeParse(raw);
        if (!result.success) {
          throw new Error(`${basename}.expected-error.json: ${result.error.message}`);
        }
      });
    });
  }
});
