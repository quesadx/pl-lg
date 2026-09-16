import { describe, expect, it } from 'vitest';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import { extract } from '../../src/capability/extractor.js';
import { ExtractError } from '../../src/shared/errors.js';
import type { SerializedManifest } from '../../src/shared/manifest.js';

const extractSource = (source: string): SerializedManifest => extract(parse(lex(source)));

describe('Phase 3: extractor behavior (Sections 2.2-2.3, 5)', () => {
  it('defers a curl! literal that is not an absolute URL (guard checks it at runtime)', () => {
    const m = extractSource('needs net("api.example.com")\nlet page = curl!("not-a-url")\n');
    expect(m.deferredToRuntime).toHaveLength(1);
    expect(m.deferredToRuntime[0]?.category).toBe('net');
    expect(m.deferredToRuntime[0]?.reason).toContain('not an absolute URL');
  });

  it('checks a fn body against the ATTENUATED manifest, not the parent (Section 2.3)', () => {
    // Parent grants net + fs.read; the fn attenuates to only(net), so a literal
    // fs.readFile! inside it is uncovered BY THE CHILD manifest -> E301.
    const source = [
      'needs fs.read("/etc/**"), net("api.example.com")',
      '',
      'fn grab(u) needs only(net("api.example.com")) {',
      '    let x = fs.readFile!("/etc/passwd")',
      '    return x',
      '}',
      '',
      'grab("u")',
    ].join('\n');
    let thrown: unknown;
    try {
      extractSource(source);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ExtractError);
    expect((thrown as ExtractError).code).toBe('E301_EXTRACT_UNCOVERED_CAPABILITY');
  });

  it('a fn without needs inherits the parent manifest: covered literal passes, no scoped entry', () => {
    const source = [
      'needs fs.read("/etc/**")',
      '',
      'fn read_all() {',
      '    let x = fs.readFile!("/etc/passwd")',
      '    return x',
      '}',
    ].join('\n');
    const m = extractSource(source);
    expect(Object.keys(m.scoped)).toEqual([]);
    expect(m.deferredToRuntime).toEqual([]);
  });
});
