import { z } from 'zod';
import { globToRegex } from './glob-to-regex.js';

// Section 7.2 — the in-memory capability manifest. The single representation of
// "what this script may do"; produced once by the extractor, consumed read-only
// by explain (Phase 6) and CapabilityGuard (Phase 4). No module re-derives it.

export interface HostPattern {
  type: 'exact' | 'wildcard';
  pattern: string;
}

export interface GlobPattern {
  raw: string;
  regex: RegExp;
}

export interface ExecPattern {
  raw: string;
  regex: RegExp;
}

export interface EnvRequirement {
  name: string;
  optional: boolean;
}

export interface DeferredCheck {
  nodeSpan: readonly [number, number];
  category: 'net' | 'fsRead' | 'fsWrite' | 'exec';
  reason: string;
}

export interface CapabilityManifest {
  net: HostPattern[];
  fsRead: GlobPattern[];
  fsWrite: GlobPattern[];
  exec: ExecPattern[];
  env: EnvRequirement[];
  scoped: Record<string, CapabilityManifest>;
  deferredToRuntime: DeferredCheck[];
}

// Section 7.3 — serialization boundary. Only `raw` strings ever cross a trust
// boundary; `regex` is always recompiled locally through the same Phase 3
// compiler (never deserialized from untrusted JSON).

export interface SerializedGlobPattern {
  raw: string;
}

export interface SerializedManifest {
  net: HostPattern[];
  fsRead: SerializedGlobPattern[];
  fsWrite: SerializedGlobPattern[];
  exec: SerializedGlobPattern[];
  env: EnvRequirement[];
  scoped: Record<string, SerializedManifest>;
  deferredToRuntime: DeferredCheck[];
}

export const SerializedCapabilityManifestSchema: z.ZodType<SerializedManifest> = z.lazy(() =>
  z.object({
    net: z.array(
      z.object({
        type: z.enum(['exact', 'wildcard']),
        pattern: z.string().min(1),
      }),
    ),
    fsRead: z.array(z.object({ raw: z.string().min(1) })),
    fsWrite: z.array(z.object({ raw: z.string().min(1) })),
    exec: z.array(z.object({ raw: z.string().min(1) })),
    env: z.array(
      z.object({
        name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
        optional: z.boolean(),
      }),
    ),
    scoped: z.record(z.string(), SerializedCapabilityManifestSchema),
    deferredToRuntime: z.array(
      z.object({
        nodeSpan: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
        category: z.enum(['net', 'fsRead', 'fsWrite', 'exec']),
        reason: z.string().min(1),
      }),
    ),
  }),
);

// The single pure function turning validated raw strings into RegExps —
// called on load by every consumer of a (re)constructed manifest.
export function compileManifest(s: SerializedManifest): CapabilityManifest {
  return {
    net: s.net.map((h) => ({ ...h })),
    fsRead: s.fsRead.map((g) => ({ raw: g.raw, regex: globToRegex(g.raw) })),
    fsWrite: s.fsWrite.map((g) => ({ raw: g.raw, regex: globToRegex(g.raw) })),
    exec: s.exec.map((g) => ({ raw: g.raw, regex: globToRegex(g.raw) })),
    env: s.env.map((e) => ({ ...e })),
    scoped: Object.fromEntries(
      Object.entries(s.scoped).map(([id, child]) => [id, compileManifest(child)]),
    ),
    deferredToRuntime: s.deferredToRuntime.map((d) => ({ ...d })),
  };
}
