import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CapabilityGuard } from '../../src/capability/guard.js';
import { CapabilityViolationError } from '../../src/shared/errors.js';
import { compileManifest } from '../../src/shared/manifest.js';
import type { CapabilityManifest, SerializedManifest } from '../../src/shared/manifest.js';

// Phase 4 DoD unit tests. Sandboxes live in realpathSync(tmpdir()) — on macOS
// /var is a symlink to /private/var, and the guard's canonical-only matching
// means grants built from the unresolved tmpdir string would self-destruct.

const tmpRoots: string[] = [];

function sandbox(name: string): string {
  const root = realpathSync(mkdtempSync(`${tmpdir()}/pl-guard-${name}-`));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function manifestOf(partial: Partial<SerializedManifest>): CapabilityManifest {
  return compileManifest({
    net: [],
    fsRead: [],
    fsWrite: [],
    exec: [],
    env: [],
    scoped: {},
    deferredToRuntime: [],
    ...partial,
  });
}

function deniedBy(fn: () => unknown): CapabilityViolationError {
  try {
    fn();
  } catch (err) {
    if (err instanceof CapabilityViolationError) return err;
    throw new Error(`expected CapabilityViolationError, got: ${String(err)}`);
  }
  throw new Error('expected CapabilityViolationError, got none');
}

describe('Phase 4: CapabilityGuard.authorize — net', () => {
  it('authorizes an exact-host match and returns the url unchanged', () => {
    const guard = new CapabilityGuard(
      manifestOf({ net: [{ type: 'exact', pattern: 'api.example.com' }] }),
    );
    expect(guard.authorize({ category: 'net', url: 'https://api.example.com/status' })).toBe(
      'https://api.example.com/status',
    );
  });

  it('E401 on an exact-host mismatch', () => {
    const guard = new CapabilityGuard(
      manifestOf({ net: [{ type: 'exact', pattern: 'api.example.com' }] }),
    );
    expect(deniedBy(() => guard.authorize({ category: 'net', url: 'https://evil.com/x' })).code).toBe(
      'E401_GUARD_NET_DENIED',
    );
  });

  it('wildcard "*.example.com" accepts api.example.com, rejects evil.com and notexample.com', () => {
    const guard = new CapabilityGuard(
      manifestOf({ net: [{ type: 'wildcard', pattern: '*.example.com' }] }),
    );
    expect(guard.authorize({ category: 'net', url: 'https://api.example.com/' })).toBe(
      'https://api.example.com/',
    );
    expect(deniedBy(() => guard.authorize({ category: 'net', url: 'https://evil.com/' })).code).toBe(
      'E401_GUARD_NET_DENIED',
    );
    expect(
      deniedBy(() => guard.authorize({ category: 'net', url: 'https://notexample.com/' })).code,
    ).toBe('E401_GUARD_NET_DENIED');
    // example.com itself has no leading label — a single-label wildcard must not cover it
    expect(
      deniedBy(() => guard.authorize({ category: 'net', url: 'https://example.com/' })).code,
    ).toBe('E401_GUARD_NET_DENIED');
  });

  it('E401 (fail-closed) on a runtime value that is not an absolute URL', () => {
    const guard = new CapabilityGuard(
      manifestOf({ net: [{ type: 'exact', pattern: 'api.example.com' }] }),
    );
    expect(deniedBy(() => guard.authorize({ category: 'net', url: 'not a url' })).code).toBe(
      'E401_GUARD_NET_DENIED',
    );
  });
});

describe('Phase 4: CapabilityGuard.authorize — fsRead', () => {
  it('authorizes an existing path inside the grant, returning the canonical path', () => {
    const safe = sandbox('read-ok');
    writeFileSync(`${safe}/data.json`, '{}');
    const guard = new CapabilityGuard(manifestOf({ fsRead: [{ raw: `${safe}/**` }] }));
    expect(guard.authorize({ category: 'fsRead', path: `${safe}/data.json` })).toBe(
      `${safe}/data.json`,
    );
  });

  it('E402 on a plainly-outside existing path', () => {
    const safe = sandbox('read-deny');
    const other = sandbox('read-other');
    writeFileSync(`${other}/file.txt`, 'x');
    const guard = new CapabilityGuard(manifestOf({ fsRead: [{ raw: `${safe}/**` }] }));
    expect(
      deniedBy(() => guard.authorize({ category: 'fsRead', path: `${other}/file.txt` })).code,
    ).toBe('E402_GUARD_FS_READ_DENIED');
  });

  it('E403 on a symlink pointing outside every granted glob (DoD 1)', () => {
    const safe = sandbox('read-link');
    const outside = sandbox('read-outside');
    writeFileSync(`${outside}/secret.json`, '{}');
    symlinkSync(outside, `${safe}/link`);
    const guard = new CapabilityGuard(manifestOf({ fsRead: [{ raw: `${safe}/**` }] }));
    expect(
      deniedBy(() => guard.authorize({ category: 'fsRead', path: `${safe}/link/secret.json` })).code,
    ).toBe('E403_GUARD_PATH_TRAVERSAL');
  });

  it('E403 on an existing ../ traversal whose string still matches the grant (DoD 2)', () => {
    const root = sandbox('read-dotdot');
    const safe = `${root}/safe`;
    mkdirSync(safe);
    writeFileSync(`${root}/escape.txt`, 'x');
    const guard = new CapabilityGuard(manifestOf({ fsRead: [{ raw: `${safe}/**` }] }));
    expect(
      deniedBy(() => guard.authorize({ category: 'fsRead', path: `${safe}/../escape.txt` })).code,
    ).toBe('E403_GUARD_PATH_TRAVERSAL');
  });

  it('ENOENT falls back to lexical resolution: authorized inside, E403 outside', () => {
    const safe = sandbox('read-lex');
    const guard = new CapabilityGuard(manifestOf({ fsRead: [{ raw: `${safe}/**` }] }));
    expect(guard.authorize({ category: 'fsRead', path: `${safe}/new/file.json` })).toBe(
      resolve(`${safe}/new/file.json`),
    );
    expect(
      deniedBy(() => guard.authorize({ category: 'fsRead', path: `${safe}/../secret` })).code,
    ).toBe('E403_GUARD_PATH_TRAVERSAL');
  });

  it('TOCTOU: the authorized payload is byte-identical to the canonical value, not the raw input (DoD 5)', () => {
    const root = sandbox('toctou');
    const safe = `${root}/safe`;
    mkdirSync(safe);
    writeFileSync(`${safe}/data.json`, '{}');
    const guard = new CapabilityGuard(manifestOf({ fsRead: [{ raw: `${safe}/**` }] }));
    const raw = `${safe}/../${basename(safe)}/data.json`; // traversal that canonicalizes back inside
    const authorized = guard.authorize({ category: 'fsRead', path: raw });
    expect(authorized).toBe(realpathSync(`${safe}/data.json`));
    expect(authorized).not.toBe(raw);
  });
});

describe('Phase 4: CapabilityGuard.authorize — fsWrite', () => {
  it('authorizes a new file under an existing parent, returning parent-realpath + leaf', () => {
    const safe = sandbox('write-ok');
    mkdirSync(`${safe}/sub`);
    const guard = new CapabilityGuard(manifestOf({ fsWrite: [{ raw: `${safe}/**` }] }));
    expect(guard.authorize({ category: 'fsWrite', path: `${safe}/sub/out.txt` })).toBe(
      `${realpathSync(`${safe}/sub`)}/out.txt`,
    );
  });

  it('E404 on a plainly-outside write target', () => {
    const safe = sandbox('write-deny');
    const other = sandbox('write-other');
    const guard = new CapabilityGuard(manifestOf({ fsWrite: [{ raw: `${safe}/**` }] }));
    expect(
      deniedBy(() => guard.authorize({ category: 'fsWrite', path: `${other}/out.txt` })).code,
    ).toBe('E404_GUARD_FS_WRITE_DENIED');
  });

  it('E403 on a parent-dir traversal whose string still matches the grant', () => {
    const root = sandbox('write-dotdot');
    const safe = `${root}/safe`;
    mkdirSync(safe);
    const guard = new CapabilityGuard(manifestOf({ fsWrite: [{ raw: `${safe}/**` }] }));
    expect(
      deniedBy(() => guard.authorize({ category: 'fsWrite', path: `${safe}/../evil.txt` })).code,
    ).toBe('E403_GUARD_PATH_TRAVERSAL');
  });

  it('E403 on a leaf that is itself ".." (Section 2.2 step 5.2 residual-leaf rule)', () => {
    const safe = sandbox('write-leaf');
    const guard = new CapabilityGuard(manifestOf({ fsWrite: [{ raw: `${safe}/**` }] }));
    expect(deniedBy(() => guard.authorize({ category: 'fsWrite', path: `${safe}/..` })).code).toBe(
      'E403_GUARD_PATH_TRAVERSAL',
    );
  });
});

describe('Phase 4: CapabilityGuard.authorize — exec', () => {
  it('authorizes an existing binary inside the grant', () => {
    const safe = sandbox('exec-ok');
    mkdirSync(`${safe}/bin`);
    writeFileSync(`${safe}/bin/tool`, '#!/bin/sh\n');
    const guard = new CapabilityGuard(manifestOf({ exec: [{ raw: `${safe}/bin/*` }] }));
    expect(guard.authorize({ category: 'exec', path: `${safe}/bin/tool` })).toBe(
      `${safe}/bin/tool`,
    );
  });

  it('E405 on a plainly-outside binary', () => {
    const safe = sandbox('exec-deny');
    const other = sandbox('exec-other');
    mkdirSync(`${other}/bin`);
    writeFileSync(`${other}/bin/tool`, '#!/bin/sh\n');
    const guard = new CapabilityGuard(manifestOf({ exec: [{ raw: `${safe}/bin/*` }] }));
    expect(
      deniedBy(() => guard.authorize({ category: 'exec', path: `${other}/bin/tool` })).code,
    ).toBe('E405_GUARD_EXEC_DENIED');
  });

  it('E403 on a symlinked binary outside the granted exec pattern (DoD 4)', () => {
    const safe = sandbox('exec-link');
    const other = sandbox('exec-outside');
    mkdirSync(`${safe}/bin`);
    mkdirSync(`${other}/bin`);
    writeFileSync(`${other}/bin/tool`, '#!/bin/sh\n');
    symlinkSync(`${other}/bin/tool`, `${safe}/bin/tool`);
    const guard = new CapabilityGuard(manifestOf({ exec: [{ raw: `${safe}/bin/*` }] }));
    expect(
      deniedBy(() => guard.authorize({ category: 'exec', path: `${safe}/bin/tool` })).code,
    ).toBe('E403_GUARD_PATH_TRAVERSAL');
  });
});

describe('Phase 4: CapabilityGuard scoping & env', () => {
  it('forScope enforces the attenuated child manifest, not the parent grant', () => {
    const child = manifestOf({ net: [{ type: 'exact', pattern: 'api.example.com' }] });
    const parent = new CapabilityGuard(
      manifestOf({
        net: [{ type: 'exact', pattern: 'evil.com' }],
        scoped: { fetch_status: { ...child } },
      }),
    );
    const scoped = parent.forScope('fetch_status');
    expect(scoped.authorize({ category: 'net', url: 'https://api.example.com/' })).toBe(
      'https://api.example.com/',
    );
    // parent granted evil.com; the child manifest did not — attenuation holds
    expect(deniedBy(() => scoped.authorize({ category: 'net', url: 'https://evil.com/' })).code).toBe(
      'E401_GUARD_NET_DENIED',
    );
  });

  it('forScope on an unrecorded fn id is an internal wiring error, not a capability denial', () => {
    const guard = new CapabilityGuard(manifestOf({}));
    expect(() => guard.forScope('missing')).toThrow(Error);
    expect(() => guard.forScope('missing')).not.toThrow(CapabilityViolationError);
  });

  it('requireEnv throws E406 for a missing non-optional env var; optional absence is fine', () => {
    const guard = new CapabilityGuard(
      manifestOf({
        env: [
          { name: 'MUST_HAVE', optional: false },
          { name: 'MAY_HAVE', optional: true },
        ],
      }),
    );
    expect(deniedBy(() => guard.requireEnv({})).code).toBe('E406_GUARD_ENV_MISSING');
    guard.requireEnv({ MUST_HAVE: 'x' });
  });
});
