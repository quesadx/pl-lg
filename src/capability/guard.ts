import { realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { CapabilityViolationError } from '../shared/errors.js';
import { hostToRegex } from '../shared/glob-to-regex.js';
import type { CapabilityManifest } from '../shared/manifest.js';
import { assertNever } from '../shared/assert-never.js';

// Phase 4 — the runtime enforcer (Sections 2.2, 11). The only module besides
// /host-bindings allowed to import fs, and only for realpathSync: this is the
// sole canonicalization point in the runtime. Instantiate once per run with
// the manifest the extractor produced, already compiled via compileManifest
// (regexes are always recompiled locally — Section 7.3).

export type GuardRequest =
  | { category: 'net'; url: string }
  | { category: 'fsRead'; path: string }
  | { category: 'fsWrite'; path: string }
  | { category: 'exec'; path: string }
  // Section 1: print!/eprint! still route through this one choke point (so the
  // Phase 8 audit log stays complete) but are unconditionally authorized and
  // never appear in a manifest.
  | { category: 'ambient-write'; text: string; stream: 'stdout' | 'stderr' };

// The evaluator and stdlib depend on this interface, not the concrete class,
// so tests can inject stubs without realpath/fs behavior.
export interface Guard {
  authorize(request: GuardRequest): string;
  forScope(fnId: string): Guard;
  requireEnv(env: Record<string, string | undefined>): void;
}

type PathCategory = 'fsRead' | 'fsWrite' | 'exec';

interface CompiledPattern {
  raw: string;
  regex: RegExp;
}

type PlainDenyCode = 'E402_GUARD_FS_READ_DENIED' | 'E404_GUARD_FS_WRITE_DENIED' | 'E405_GUARD_EXEC_DENIED';

// Canonicalize a path that should already exist. On ENOENT, fall back to
// lexical resolution: a path with missing components cannot be resolved
// differently by a host operation that *succeeds* (the host op ENOENTs too),
// so the fallback grants nothing. Any other errno propagates — it is an I/O
// error, not a capability question.
function canonicalizeExisting(path: string): string {
  try {
    return realpathSync(path);
  } catch (err) {
    if (err instanceof Error && (err as { code?: unknown }).code === 'ENOENT') return resolve(path);
    throw err;
  }
}

export class CapabilityGuard implements Guard {
  private readonly manifest: CapabilityManifest;

  constructor(manifest: CapabilityManifest) {
    this.manifest = manifest;
  }

  authorize(request: GuardRequest): string {
    switch (request.category) {
      case 'net':
        return this.authorizeNet(request.url);
      case 'fsRead':
        return this.authorizePath(request.path, this.manifest.fsRead, 'E402_GUARD_FS_READ_DENIED', 'fsRead');
      case 'fsWrite':
        return this.authorizeWrite(request.path);
      case 'exec':
        return this.authorizePath(request.path, this.manifest.exec, 'E405_GUARD_EXEC_DENIED', 'exec');
      case 'ambient-write':
        return request.text; // Section 1: the invoking process's own terminal is always writable
      default:
        return assertNever(request);
    }
  }

  // A fn with its own `needs` clause gets its attenuated child manifest
  // (Section 2.3); inheriting fns keep using the enclosing guard. Missing id
  // is an internal wiring error, never a capability denial.
  forScope(fnId: string): CapabilityGuard {
    // hasOwn: scoped is keyed by source-controlled fn ids; a plain index would
    // return Object.prototype members for names like `constructor`.
    const child = Object.hasOwn(this.manifest.scoped, fnId) ? this.manifest.scoped[fnId] : undefined;
    if (child === undefined) {
      throw new Error(
        `no scoped manifest for fn "${fnId}" — forScope() is only valid for fns with their own needs clause`,
      );
    }
    return new CapabilityGuard(child);
  }

  // E406: every non-optional env(...) requirement must be present. The env
  // source is injected (callers pass process.env) so the guard itself stays
  // free of ambient state reads.
  requireEnv(env: Record<string, string | undefined>): void {
    for (const req of this.manifest.env) {
      if (!req.optional && env[req.name] === undefined) {
        throw new CapabilityViolationError({
          code: 'E406_GUARD_ENV_MISSING',
          message: `env(${req.name}) is declared non-optional but unset at runtime`,
          hint: `Set ${req.name} in the invoking environment, or declare it env(${req.name}?).`,
        });
      }
    }
  }

  private authorizeNet(url: string): string {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      throw new CapabilityViolationError({
        code: 'E401_GUARD_NET_DENIED',
        message: `"${url}" is not an absolute URL — no net() grant can cover it`,
        hint: 'Pass a full URL (e.g. "https://host/path"); relative or malformed values fail closed.',
      });
    }
    const granted = this.manifest.net.some((h) => hostToRegex(h.type, h.pattern).test(host));
    if (granted) return url;
    throw new CapabilityViolationError({
      code: 'E401_GUARD_NET_DENIED',
      message: `host "${host}" (from "${url}") matches no granted net() capability`,
      hint: `Request it explicitly, e.g. needs net("${host}").`,
    });
  }

  // Existing-path categories (fsRead, exec): realpath, then match. Write
  // targets follow Section 2.2 step 5.2 in authorizeWrite.
  private authorizePath(path: string, patterns: CompiledPattern[], plainCode: PlainDenyCode, what: PathCategory): string {
    const canonical = canonicalizeExisting(path);
    return this.matchCanonical(path, canonical, patterns, plainCode, what);
  }

  private authorizeWrite(path: string): string {
    const leaf = basename(path);
    if (leaf === '..' || leaf === '.') {
      throw new CapabilityViolationError({
        code: 'E403_GUARD_PATH_TRAVERSAL',
        message: `write target "${path}" ends in the residual segment "${leaf}"`,
        hint: 'Name the file being written; a trailing ".."/"." cannot be canonicalized safely.',
      });
    }
    const canonical = `${canonicalizeExisting(dirname(path))}/${leaf}`;
    return this.matchCanonical(path, canonical, this.manifest.fsWrite, 'E404_GUARD_FS_WRITE_DENIED', 'fsWrite');
  }

  // Canonicalize-before-match is the whole security model: only the canonical
  // value may match. Deny-code split: the raw string matched a grant but the
  // canonical value does not -> E403 (symlink/".." escape); neither matched ->
  // the category's plain denial. On success the canonical value is returned
  // and must be handed to /host-bindings verbatim (TOCTOU, Section 2.2 step 6).
  private matchCanonical(
    raw: string,
    canonical: string,
    patterns: CompiledPattern[],
    plainCode: PlainDenyCode,
    what: PathCategory,
  ): string {
    if (patterns.some((p) => p.regex.test(canonical))) return canonical;
    if (patterns.some((p) => p.regex.test(raw))) {
      throw new CapabilityViolationError({
        code: 'E403_GUARD_PATH_TRAVERSAL',
        message: `Canonicalization of "${raw}" (${what}) resolves outside every granted capability.`,
        hint: 'The value string-matched a needs grant, but symlink or ".." resolution escapes it. Request the canonical target explicitly, or remove the traversal.',
      });
    }
    throw new CapabilityViolationError({
      code: plainCode,
      message: `"${canonical}" (${what}, canonicalized from "${raw}") matches no granted capability`,
      hint: 'Request the exact path/glob in a needs declaration.',
    });
  }
}
