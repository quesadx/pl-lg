import type { PlacitumError } from '../shared/error-schema.js';
import { printable } from '../shared/printable.js';

// Phase 9 (Section 9.3) — the single formatter every PlacitumError passes
// through on its way to the CLI boundary. Pure string -> string: the CLI owns
// stdout/stderr, this module only decides the text. Never throws while
// formatting (diagnostics must not fail the diagnostics path), so the source
// excerpt is clamped rather than validated.

export interface ErrorSource {
  name: string;
  text: string;
}

// Section 9.3 layout (gutter width w = digits of the line number):
//   error[E403]: message
//    --> file:12:19
//      |
//   12 |   let secrets = ...
//      |     ^^^^^^^^^^^^
//      |
//      = hint: ...
//
// The excerpt is script-controlled text (a shared .placitum file can carry
// terminal escapes), so every control character except tab renders as "?",
// one-for-one: the line stays safe and caret columns stay aligned.
function sanitize(line: string): string {
  let out = '';
  for (const char of line) {
    const code = char.charCodeAt(0);
    const safe = code === 0x09 || (code >= 0x20 && code !== 0x7f);
    out += safe ? char : '?';
  }
  return out;
}

function excerpt(err: PlacitumError, source: ErrorSource): string[] {
  const location = err.location;
  if (location === undefined) return [];
  const lines = source.text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  const lineText = lines[location.line - 1];
  if (lineText === undefined) return [];
  const w = String(location.line).length;
  const arrow = `${' '.repeat(w)}--> ${printable(source.name)}:${location.line}:${location.col}`;
  const gutter = `${' '.repeat(w)} |`;
  const excerptLine = `${String(location.line).padStart(w)} | ${sanitize(lineText)}`;
  // Line start offset: sum of all preceding lines plus their newlines.
  let lineStart = 0;
  for (let i = 0; i < location.line - 1; i++) lineStart += (lines[i] as string).length + 1;
  const span = location.span;
  const caretCol = span === undefined ? location.col - 1 : Math.max(0, span[0] - lineStart);
  const caretEnd = span === undefined ? caretCol + 1 : Math.min(span[1] - lineStart, lineText.length);
  const caretCount = Math.max(1, caretEnd - caretCol);
  return [arrow, gutter, excerptLine, `${gutter} ${' '.repeat(caretCol)}${'^'.repeat(caretCount)}`, gutter];
}

export function formatError(err: PlacitumError, source?: ErrorSource): string {
  const lines = [`${err.severity}[${err.code}]: ${printable(err.message)}`];
  const excerptLines = err.location !== undefined && source !== undefined ? excerpt(err, source) : [];
  lines.push(...excerptLines);
  if (err.hint !== undefined) {
    const indent = excerptLines.length > 0 ? String(err.location?.line).length + 1 : 2;
    lines.push(`${' '.repeat(indent)}= hint: ${printable(err.hint)}`);
  }
  return lines.join('\n') + '\n';
}
