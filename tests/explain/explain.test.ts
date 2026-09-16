import { describe, expect, it } from 'vitest';
import type { SerializedManifest } from '../../src/shared/manifest.js';
import { CliError } from '../../src/shared/errors.js';
import { explain } from '../../src/cli/explain.js';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import { extract } from '../../src/capability/extractor.js';

const EMPTY: SerializedManifest = {
  net: [],
  fsRead: [],
  fsWrite: [],
  exec: [],
  env: [],
  scoped: {},
  deferredToRuntime: [],
};

describe('Phase 6: explain renderer', () => {
  it('renders an empty manifest with explicit (none) categories and no canonicalization note', () => {
    expect(explain(EMPTY)).toBe(
      [
        'grants (statically proven):',
        '  fs.read   (none)',
        '  fs.write  (none)',
        '  exec      (none)',
        '  net       (none)',
        '  env       (none)',
        '',
        'deferred to runtime:',
        '  (none)',
        '',
      ].join('\n'),
    );
  });

  it('shows the canonicalization note only when a path-like grant exists', () => {
    expect(explain({ ...EMPTY, net: [{ type: 'exact', pattern: 'api.example.com' }] })).not.toContain(
      'canonicalized',
    );
    expect(explain({ ...EMPTY, fsRead: [{ raw: '/etc/config/*.json' }] })).toContain(
      'note: path grants match the canonicalized path',
    );
  });

  it('renders nested scoped fns under their parent fn section (the extractor can nest them)', () => {
    const nested: SerializedManifest = {
      ...EMPTY,
      scoped: {
        outer: {
          ...EMPTY,
          scoped: { inner: { ...EMPTY, fsRead: [{ raw: '/data/*.json' }] } },
        },
      },
    };
    const out = explain(nested);
    expect(out).toContain('fn outer (attenuated needs only(...)):');
    expect(out).toContain('  fn inner (attenuated needs only(...)):');
    expect(out).toContain('      fs.read   /data/*.json');
  });

  it('renders scoped fns literally named __proto__ at any depth (zod z.record drops them)', () => {
    const manifest: SerializedManifest = {
      ...EMPTY,
      scoped: {
        ['__proto__']: { ...EMPTY, net: [{ type: 'exact', pattern: 'api.example.com' }] },
        outer: { ...EMPTY, scoped: { ['__proto__']: { ...EMPTY, fsRead: [{ raw: '/data/*.json' }] } } },
      },
    };
    const out = explain(manifest);
    expect(out).toContain('\nfn __proto__ (attenuated needs only(...)):');
    expect(out).toContain('    net       api.example.com');
    expect(out).toContain('  fn __proto__ (attenuated needs only(...)):');
    expect(out).toContain('      fs.read   /data/*.json');
  });

  it('drops nothing end-to-end: fn __proto__ survives lex/parse/extract (null-proto scoped)', () => {
    const source = 'needs net("api.example.com")\nfn __proto__() needs only(net("api.example.com")) { }\n';
    const manifest = extract(parse(lex(source)));
    const out = explain(manifest);
    expect(out).toContain('fn __proto__ (attenuated needs only(...)):');
    expect(out).toContain('    net       api.example.com');
  });

  it('escapes control characters so manifest strings cannot forge output lines', () => {
    // `\n` is a legal escape in source string literals, so the extractor can
    // publish a pattern containing a newline; Phase 7 manifests are untrusted
    // JSON. Rendered raw, such a value would inject lines indistinguishable
    // from genuine grant lines into the transparency tool's output.
    const manifest: SerializedManifest = {
      ...EMPTY,
      fsRead: [{ raw: '/a\nb' }],
      net: [{ type: 'exact', pattern: 'evil\n  exec      /bin/rm' }],
      scoped: { ['fn\nsneak']: { ...EMPTY } },
      deferredToRuntime: [{ nodeSpan: [0, 1], category: 'net', reason: 'r\nfake' }],
    };
    const out = explain(manifest);
    // The forged text must stay inside the quoted net value on exactly one
    // line — never become a line of its own that mimics a real grant.
    const forged = out.split('\n').filter((line) => line.includes('/bin/rm'));
    expect(forged).toEqual(['  net       "evil\\n  exec      /bin/rm"']);
    expect(out).toContain('"/a\\nb"');
    expect(out).toContain('fn "fn\\nsneak" (attenuated needs only(...)):');
    expect(out).toContain('"r\\nfake"');
  });

  const MALFORMED: Array<[string, unknown]> = [
    ['not an object', null],
    ['missing fields', {}],
    ['empty raw pattern', { ...EMPTY, fsRead: [{ raw: '' }] }],
    [
      'unknown deferred category',
      { ...EMPTY, deferredToRuntime: [{ nodeSpan: [0, 1], category: 'http', reason: 'x' }] },
    ],
    ['invalid env name', { ...EMPTY, env: [{ name: '1BAD', optional: false }] }],
  ];

  it('E603 fires on malformed manifests (exact code, CliError)', () => {
    for (const [label, bad] of MALFORMED) {
      let thrown: unknown;
      try {
        explain(bad);
      } catch (err) {
        thrown = err;
      }
      expect(thrown, label).toBeInstanceOf(CliError);
      expect((thrown as CliError).code, label).toBe('E603_EXPLAIN_RENDER_FAILURE');
    }
  });
});
