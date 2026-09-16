import { ExtractError } from './errors.js';

// Section 2.1 — pure glob-string → RegExp compilation. Never touches the disk;
// works whether or not the path exists. Consumed by the extractor (static checks)
// and, via compileManifest, by the guard (runtime canonical-path matching).
//
// Glob syntax is deliberately tiny: `*` matches within one path segment (never
// `/`), `**` as a complete segment matches any run of segments, everything else
// is literal. `**` anywhere else is E302; a whole-pattern bare `*`/`**` is E305.

const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;

function escapeLiteral(segment: string): string {
  return segment.replace(REGEX_ESCAPE, '\\$&');
}

function compileSegment(segment: string): string {
  // `*` → [^/]* ; every other character is escaped and literal.
  return segment
    .split('*')
    .map(escapeLiteral)
    .join('[^/]*');
}

export function globToRegex(glob: string): RegExp {
  if (glob === '') {
    throw new ExtractError({
      code: 'E302_EXTRACT_INVALID_GLOB',
      message: `pattern "" is empty`,
      hint: 'Capability patterns must be non-empty glob strings.',
    });
  }
  if (glob === '*' || glob === '**') {
    throw new ExtractError({
      code: 'E305_EXTRACT_OVERPRIVILEGED_WILDCARD',
      message: `"${glob}" is a bare match-everything pattern`,
      hint: 'Name the narrowest path/host that suffices, e.g. "/etc/config/*.json".',
    });
  }
  const segments = glob.split('/');
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.includes('**') && segment !== '**') {
      throw new ExtractError({
        code: 'E302_EXTRACT_INVALID_GLOB',
        message: `"${glob}" uses "**" inside the segment "${segment}"`,
        hint: '"**" is only valid as a complete path segment, e.g. "/var/log/**".',
      });
    }
    parts.push(segment === '**' ? '.*' : compileSegment(segment));
  }
  return new RegExp(`^${parts.join('/')}$`);
}

// Section 7.2 HostPattern: exact host, or a single leading label wildcard
// ("*.example.com"). Hosts are case-insensitive; patterns are lowercased so
// URL-derived (already-lowercase) hostnames compare directly.
export function hostToRegex(type: 'exact' | 'wildcard', pattern: string): RegExp {
  const host = pattern.toLowerCase();
  if (host === '') {
    throw new ExtractError({
      code: 'E302_EXTRACT_INVALID_GLOB',
      message: 'host pattern is empty',
      hint: 'Name the exact host, e.g. net("api.example.com").',
    });
  }
  if (host === '*' || host === '**') {
    throw new ExtractError({
      code: 'E305_EXTRACT_OVERPRIVILEGED_WILDCARD',
      message: `net("${pattern}") is a bare match-everything host pattern`,
      hint: 'Name the exact host, e.g. net("example.com"), or a single leading-label wildcard like "*.example.com".',
    });
  }
  if (type === 'wildcard') {
    const base = host.slice(2); // strip "*."
    return new RegExp(`^[^.]+\\.${escapeLiteral(base)}$`);
  }
  return new RegExp(`^${escapeLiteral(host)}$`);
}

// Section 2.3 — does every string matching glob `child` also match glob
// `parent`? Segment-structural subset check for the tiny glob syntax above
// (`**` = a complete segment matching >= 1 segments, `*` within a segment).
// ponytail: exponential worst case on adversarial star counts; patterns are
// short source literals — memoize if real inputs ever make it bite.
function segCovers(parent: string, child: string): boolean {
  if (parent === '') return child === '';
  if (parent[0] === '*') {
    return segCovers(parent.slice(1), child) || (child !== '' && segCovers(parent, child.slice(1)));
  }
  if (child === '') return false;
  if (child[0] === '*') return false; // a literal cannot cover a child star (it can match the empty tail)
  return parent[0] === child[0] && segCovers(parent.slice(1), child.slice(1));
}

function segsCovers(parent: string[], child: string[]): boolean {
  if (child.length === 0) return parent.length === 0;
  if (parent.length === 0) return false;
  const p0 = parent[0] as string; // non-empty: guarded by the length checks above
  const c0 = child[0] as string;
  if (p0 === '**') {
    // Parent ** absorbs child segments (>= 1): stay eating, or retire.
    if (c0 === '**') {
      // Absorb the child's whole **-expansion and stay (eat into the rest too),
      // or absorb exactly it and retire.
      return segsCovers(parent, child.slice(1)) || segsCovers(parent.slice(1), child.slice(1));
    }
    return segsCovers(parent, child.slice(1)) || segsCovers(parent.slice(1), child.slice(1));
  }
  if (c0 === '**') {
    // Child ** expands to k >= 1 arbitrary segments — parent front is fixed
    // ('*' or literal): only '*' can take the first one, and the remainder
    // must be covered for k = 1 and for k >= 2 alike.
    if (p0 !== '*') return false;
    return segsCovers(parent.slice(1), child.slice(1)) && segsCovers(parent.slice(1), child);
  }
  return segCovers(p0, c0) && segsCovers(parent.slice(1), child.slice(1));
}

export function globCovers(parent: string, child: string): boolean {
  return segsCovers(parent.split('/'), child.split('/'));
}
