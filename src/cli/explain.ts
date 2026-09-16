import type { SerializedManifest } from '../shared/manifest.js';
import { SerializedCapabilityManifestSchema } from '../shared/manifest.js';
import { CliError } from '../shared/errors.js';
import { printable } from '../shared/printable.js';

// Phase 6 (Section 11) — SerializedCapabilityManifest -> stdout string, zero
// I/O. The renderer is read-only over the manifest the extractor published
// (Section 1, single source of truth): it re-derives nothing, prints nothing
// (the Phase 9 CLI prints the returned string), and touches no filesystem.

const GRANT_LABEL_WIDTH = 10;
const CATEGORY_LABEL_WIDTH = 9;

// Every category is always shown; `(none)` is an explicit claim, not an
// omission. Values render verbatim from the manifest — raw patterns, no
// re-compilation, no canonicalization (that is the guard's job, at runtime).
function renderGrants(m: SerializedManifest, indent: string): string[] {
  const categories: Array<[string, string[]]> = [
    ['fs.read', m.fsRead.map((p) => printable(p.raw))],
    ['fs.write', m.fsWrite.map((p) => printable(p.raw))],
    ['exec', m.exec.map((p) => printable(p.raw))],
    ['net', m.net.map((h) => printable(h.pattern))],
    ['env', m.env.map((e) => `${printable(e.name)} (${e.optional ? 'optional' : 'required'})`)],
  ];
  const lines: string[] = [];
  for (const [label, values] of categories) {
    if (values.length === 0) {
      lines.push(`${indent}${label.padEnd(GRANT_LABEL_WIDTH)}(none)`);
      continue;
    }
    for (const value of values) lines.push(`${indent}${label.padEnd(GRANT_LABEL_WIDTH)}${value}`);
  }
  return lines;
}

// Spans are raw source offsets: the renderer has no source text (zero I/O), so
// it cannot translate them to line:col.
function renderDeferred(m: SerializedManifest, indent: string): string[] {
  if (m.deferredToRuntime.length === 0) return [`${indent}(none)`];
  return m.deferredToRuntime.map(
    (d) =>
      `${indent}${d.category.padEnd(CATEGORY_LABEL_WIDTH)}[${d.nodeSpan[0]}..${d.nodeSpan[1]}]  ${printable(d.reason)}`,
  );
}

// Flat grants first, then each attenuated fn (recursively — the extractor nests
// scoped manifests for fns declared inside fns), then deferred entries. Object
// entry order = source declaration order, so output is deterministic.
function renderScope(m: SerializedManifest, indent: string): string[] {
  const lines: string[] = [];
  lines.push(`${indent}grants (statically proven):`);
  lines.push(...renderGrants(m, `${indent}  `));
  for (const [fnId, child] of Object.entries(m.scoped)) {
    lines.push('');
    lines.push(`${indent}fn ${printable(fnId)} (attenuated needs only(...)):`);
    lines.push(...renderScope(child, `${indent}  `));
  }
  lines.push('');
  lines.push(`${indent}deferred to runtime:`);
  lines.push(...renderDeferred(m, `${indent}  `));
  return lines;
}

function malformed(detail: string): CliError {
  return new CliError({
    code: 'E603_EXPLAIN_RENDER_FAILURE',
    message: `cannot render malformed capability manifest: ${detail}`,
    hint: 'The manifest must come from the Phase 3 extractor (Section 7.3); only raw pattern strings cross this boundary.',
  });
}

function parseOrThrow(manifest: unknown): SerializedManifest {
  const parsed = SerializedCapabilityManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw malformed(printable(detail));
  }
  return parsed.data;
}

// zod's z.record assigns entries into a plain object, so an own "__proto__" key
// (a legal fn id — the extractor deliberately preserves it) silently becomes the
// record's prototype and vanishes from the rendered output. Explain is the
// security-transparency surface: it must never under-report a scoped manifest,
// so re-attach any dropped children from the raw input — re-validated through
// the same schema, never trusted because they "should" have passed.
function repairScoped(raw: unknown, parsed: SerializedManifest): SerializedManifest {
  const rawScoped = (raw as { scoped?: unknown }).scoped;
  if (typeof rawScoped !== 'object' || rawScoped === null) return parsed;
  const scoped: Record<string, SerializedManifest> = Object.create(null) as Record<string, SerializedManifest>;
  for (const [key, rawChild] of Object.entries(rawScoped as Record<string, unknown>)) {
    const parsedChild = Object.hasOwn(parsed.scoped, key) ? parsed.scoped[key] : undefined;
    if (parsedChild !== undefined) {
      scoped[key] = repairScoped(rawChild, parsedChild);
      continue;
    }
    const child = parseOrThrow(rawChild);
    scoped[key] = repairScoped(rawChild, child);
  }
  return { ...parsed, scoped };
}

export function explain(manifest: unknown): string {
  const data = repairScoped(manifest, parseOrThrow(manifest));
  const lines = renderScope(data, '');
  // A scoped child can never carry a path grant the top level lacks (E303
  // attenuation), so the top-level check is complete for the note.
  if (data.fsRead.length > 0 || data.fsWrite.length > 0 || data.exec.length > 0) {
    lines.push('');
    lines.push('note: path grants match the canonicalized path (symlinks and .. are resolved before matching)');
  }
  return lines.join('\n') + '\n';
}
