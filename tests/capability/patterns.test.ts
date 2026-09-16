import { describe, expect, it } from 'vitest';
import { globCovers, globToRegex, hostToRegex } from '../../src/shared/glob-to-regex.js';
import { ExtractError } from '../../src/shared/errors.js';
import { compileManifest } from '../../src/shared/manifest.js';

const re = (glob: string): RegExp => globToRegex(glob);

const code = (fn: () => void): string => {
  try {
    fn();
  } catch (err) {
    if (err instanceof ExtractError) return err.code;
    throw err;
  }
  throw new Error('expected ExtractError, nothing thrown');
};

describe('globToRegex (Section 2.1 — pure string transform, no disk contact)', () => {
  it('single * does not cross /', () => {
    expect(re('/etc/config/*.json').test('/etc/config/app.json')).toBe(true);
    expect(re('/etc/config/*.json').test('/etc/config/sub/app.json')).toBe(false);
  });

  it('** crosses / (traversal fixture depends on this)', () => {
    expect(re('/safe/**').test('/safe/../etc/passwd')).toBe(true);
    expect(re('/safe/**').test('/safe/a/b/c.json')).toBe(true);
    expect(re('/safe/**').test('/safe')).toBe(false);
  });

  it('** as a middle segment requires at least one segment', () => {
    expect(re('/a/**/z').test('/a/b/z')).toBe(true);
    expect(re('/a/**/z').test('/a/z')).toBe(false);
  });

  it('regex metacharacters in globs are literal', () => {
    expect(re('/etc/config.d/*.json').test('/etc/config.d/app.json')).toBe(true);
    expect(re('/etc/config.d/*.json').test('/etc/configXd/app.json')).toBe(false);
    expect(re('/a+b/*.c').test('/a+b/x.c')).toBe(true);
    expect(re('/a+b/*.c').test('/ab/x.c')).toBe(false);
  });

  it('matches are anchored', () => {
    expect(re('/etc/*.json').test('prefix/etc/a.json')).toBe(false);
    expect(re('/etc/*.json').test('/etc/a.json/suffix')).toBe(false);
  });

  it('empty pattern is E302', () => {
    expect(code(() => re(''))).toBe('E302_EXTRACT_INVALID_GLOB');
  });

  it('** outside a whole segment is E302', () => {
    expect(code(() => re('a**b/x'))).toBe('E302_EXTRACT_INVALID_GLOB');
    expect(code(() => re('/x/**y'))).toBe('E302_EXTRACT_INVALID_GLOB');
  });

  it('bare * and ** are E305', () => {
    expect(code(() => re('*'))).toBe('E305_EXTRACT_OVERPRIVILEGED_WILDCARD');
    expect(code(() => re('**'))).toBe('E305_EXTRACT_OVERPRIVILEGED_WILDCARD');
  });
});

describe('hostToRegex (Section 7.2 HostPattern rules)', () => {
  it('exact match is exact', () => {
    const r = hostToRegex('exact', 'api.example.com');
    expect(r.test('api.example.com')).toBe(true);
    expect(r.test('xapi.example.com')).toBe(false);
    expect(r.test('api.example.com.evil.net')).toBe(false);
  });

  it('*.example.com accepts one leading label only (substring class rejected)', () => {
    const r = hostToRegex('wildcard', '*.example.com');
    expect(r.test('api.example.com')).toBe(true);
    expect(r.test('notexample.com')).toBe(false);
    expect(r.test('evil.com')).toBe(false);
    expect(r.test('example.com')).toBe(false);
    expect(r.test('a.b.example.com')).toBe(false);
  });

  it('host comparison is case-insensitive', () => {
    expect(hostToRegex('exact', 'API.Example.com').test('api.example.com')).toBe(true);
  });

  it('bare * / empty are rejected', () => {
    expect(code(() => hostToRegex('exact', '*'))).toBe('E305_EXTRACT_OVERPRIVILEGED_WILDCARD');
    expect(code(() => hostToRegex('exact', ''))).toBe('E302_EXTRACT_INVALID_GLOB');
  });
});

describe('globCovers (Section 2.3 — child ⊆ parent for E303)', () => {
  it('identical patterns cover', () => {
    expect(globCovers('/etc/**', '/etc/**')).toBe(true);
    expect(globCovers('/a/**/z', '/a/**/z')).toBe(true);
    expect(globCovers('**/x', '**/x')).toBe(true);
  });

  it('parent ** absorbs narrower children', () => {
    expect(globCovers('/etc/**', '/etc/config/*.json')).toBe(true);
    expect(globCovers('/etc/**', '/etc/a')).toBe(true);
    expect(globCovers('/a/**/z', '/a/b/z')).toBe(true);
    expect(globCovers('/a/**', '/a/*')).toBe(true);
    // **/x covers **/x via absorption of the child's own ** expansion
    expect(globCovers('**/x', '/a/**/x')).toBe(true);
  });

  it('wider children are not covered', () => {
    expect(globCovers('/etc/*', '/etc/**')).toBe(false);
    expect(globCovers('/etc/config/*.json', '/etc/**')).toBe(false);
    expect(globCovers('/etc/*', '/etc/a/b')).toBe(false);
  });

  it('zero-segment ** mismatch is not covered', () => {
    expect(globCovers('/a/**/z', '/a/z')).toBe(false);
  });

  it('disjoint prefixes are not covered', () => {
    expect(globCovers('/safe/**', '/etc/**')).toBe(false);
    expect(globCovers('/safe/**', '/etc/passwd')).toBe(false);
  });

  it('child ** requires parent **', () => {
    expect(globCovers('/a/*', '/a/**')).toBe(false);
    expect(globCovers('/a/**', '/a/**')).toBe(true);
  });
});

describe('compileManifest (Section 7.3 — regex always recompiled locally)', () => {
  it('compiles raw strings through the same glob compiler', () => {
    const m = compileManifest({
      net: [{ type: 'exact', pattern: 'api.example.com' }],
      fsRead: [{ raw: '/etc/*.json' }],
      fsWrite: [],
      exec: [],
      env: [],
      scoped: {},
      deferredToRuntime: [],
    });
    expect(m.fsRead[0]?.regex.test('/etc/a.json')).toBe(true);
    expect(m.net[0]?.type).toBe('exact');
  });
});
