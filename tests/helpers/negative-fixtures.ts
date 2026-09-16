import { readdirSync, readFileSync } from 'node:fs';

// Section 10 — every *.negative.placitum pairs 1:1 with an
// *.expected-error.json of the same basename. One loader for every phase
// runner; an unpaired fixture fails the importing suite loudly.
export interface NegativeFixture {
  basename: string;
  source: string;
  rawExpected: unknown;
  expected: { code: string; phase: string };
}

export function loadNegativeFixtures(dir: URL): NegativeFixture[] {
  const scriptBasenames = readdirSync(dir)
    .filter((f) => f.endsWith('.negative.placitum'))
    .map((f) => f.replace(/\.negative\.placitum$/, ''))
    .sort();
  const jsonBasenames = readdirSync(dir)
    .filter((f) => f.endsWith('.expected-error.json'))
    .map((f) => f.replace(/\.expected-error\.json$/, ''))
    .sort();
  const paired =
    scriptBasenames.length === jsonBasenames.length &&
    scriptBasenames.every((b, i) => b === jsonBasenames[i]);
  if (!paired) {
    throw new Error(
      `negative fixture pairing broken in ${dir.pathname}\n` +
        `  scripts: ${scriptBasenames.join(', ') || '(none)'}\n` +
        `  expected-error json: ${jsonBasenames.join(', ') || '(none)'}`,
    );
  }
  return scriptBasenames.map((basename) => {
    const rawExpected: unknown = JSON.parse(
      readFileSync(new URL(`${basename}.expected-error.json`, dir), 'utf8'),
    );
    return {
      basename,
      source: readFileSync(new URL(`${basename}.negative.placitum`, dir), 'utf8'),
      rawExpected,
      expected: rawExpected as { code: string; phase: string },
    };
  });
}
