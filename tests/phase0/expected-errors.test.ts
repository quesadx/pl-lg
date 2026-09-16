import { describe, expect, it } from 'vitest';
import { PlacitumErrorSchema } from '../../src/shared/error-schema.js';
import { loadNegativeFixtures } from '../helpers/negative-fixtures.js';

const fixtures = loadNegativeFixtures(new URL('../capability/negative/', import.meta.url));

// Phase 0 DoD: the adversarial corpus exists and is schema-valid before any
// language feature does. The .placitum scripts stay inert until their phase
// wires them to a real pipeline stage.
describe('Phase 0: negative fixtures (Section 10)', () => {
  it('has at least 3 .negative.placitum scripts', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
  });

  for (const { basename, rawExpected } of fixtures) {
    describe(basename, () => {
      it('validates its .expected-error.json against PlacitumErrorSchema (Section 9.3)', () => {
        const result = PlacitumErrorSchema.safeParse(rawExpected);
        if (!result.success) {
          throw new Error(`${basename}.expected-error.json: ${result.error.message}`);
        }
      });
    });
  }
});
