import { describe, expect, it } from 'vitest';
import { formatError } from '../../src/cli/format-error.js';
import type { PlacitumError } from '../../src/shared/error-schema.js';

// Phase 9 (Section 9.3) — the single CLI boundary formatter. Exact-string
// tests: the text shape is the user-facing contract, so it is pinned here.

const SPAN_SOURCE = 'line one\nlet x = fs.readFile!("secret")\nthird\n';

describe('Phase 9: error formatter (Section 9.3)', () => {
  it('renders header, location block with caret span, and hint', () => {
    const err: PlacitumError = {
      code: 'E403_GUARD_PATH_TRAVERSAL',
      phase: 'guard',
      severity: 'error',
      message: 'path traversal blocked',
      location: { line: 2, col: 9, span: [17, 39] },
      hint: 'request it explicitly',
    };
    const expected = [
      'error[E403_GUARD_PATH_TRAVERSAL]: path traversal blocked',
      ' --> script.placitum:2:9',
      '  |',
      '2 | let x = fs.readFile!("secret")',
      '  | ' + ' '.repeat(8) + '^'.repeat(22),
      '  |',
      '  = hint: request it explicitly',
      '',
    ].join('\n');
    expect(formatError(err, { name: 'script.placitum', text: SPAN_SOURCE })).toBe(expected);
  });

  it('renders header and hint only when there is no location', () => {
    const err: PlacitumError = {
      code: 'E602_CLI_INVALID_FLAG',
      phase: 'cli',
      severity: 'error',
      message: 'unknown command',
      hint: 'See the help.',
    };
    const expected = ['error[E602_CLI_INVALID_FLAG]: unknown command', '  = hint: See the help.', ''].join('\n');
    expect(formatError(err)).toBe(expected);
  });

  it('skips the location block when no source text is available', () => {
    const err: PlacitumError = {
      code: 'E403_GUARD_PATH_TRAVERSAL',
      phase: 'guard',
      severity: 'error',
      message: 'path traversal blocked',
      location: { line: 2, col: 9 },
    };
    expect(formatError(err)).toBe('error[E403_GUARD_PATH_TRAVERSAL]: path traversal blocked\n');
  });

  it('renders a single caret when the envelope has no span', () => {
    const err: PlacitumError = {
      code: 'E201_PARSE_UNEXPECTED_TOKEN',
      phase: 'parse',
      severity: 'error',
      message: 'unexpected token',
      location: { line: 1, col: 5 },
    };
    const expected = [
      'error[E201_PARSE_UNEXPECTED_TOKEN]: unexpected token',
      ' --> script.placitum:1:5',
      '  |',
      '1 | line one',
      '  |     ^',
      '  |',
      '',
    ].join('\n');
    expect(formatError(err, { name: 'script.placitum', text: SPAN_SOURCE })).toBe(expected);
  });

  it('clamps a span that runs past the end of the line', () => {
    const err: PlacitumError = {
      code: 'E201_PARSE_UNEXPECTED_TOKEN',
      phase: 'parse',
      severity: 'error',
      message: 'unexpected token',
      location: { line: 3, col: 1, span: [40, 999] },
    };
    const expected = [
      'error[E201_PARSE_UNEXPECTED_TOKEN]: unexpected token',
      ' --> script.placitum:3:1',
      '  |',
      '3 | third',
      '  | ^^^^^',
      '  |',
      '',
    ].join('\n');
    expect(formatError(err, { name: 'script.placitum', text: SPAN_SOURCE })).toBe(expected);
  });

  it('skips the excerpt when the location line is past the end of the source', () => {
    const err: PlacitumError = {
      code: 'E201_PARSE_UNEXPECTED_TOKEN',
      phase: 'parse',
      severity: 'error',
      message: 'unexpected token',
      location: { line: 999, col: 1 },
      hint: 'check the end of the file',
    };
    const expected = [
      'error[E201_PARSE_UNEXPECTED_TOKEN]: unexpected token',
      '  = hint: check the end of the file',
      '',
    ].join('\n');
    expect(formatError(err, { name: 'script.placitum', text: SPAN_SOURCE })).toBe(expected);
  });

  it('quotes control characters instead of letting them forge output lines', () => {
    const err: PlacitumError = {
      code: 'E101_LEX_UNTERMINATED_STRING',
      phase: 'lex',
      severity: 'error',
      message: 'bad\nforged line',
      hint: 'close the string',
    };
    const expected = [
      'error[E101_LEX_UNTERMINATED_STRING]: "bad\\nforged line"',
      '  = hint: close the string',
      '',
    ].join('\n');
    expect(formatError(err)).toBe(expected);
  });

  it('neutralizes terminal escapes in the excerpt without shifting the carets', () => {
    const source = 'ab\u001bcd\n';
    const err: PlacitumError = {
      code: 'E201_PARSE_UNEXPECTED_TOKEN',
      phase: 'parse',
      severity: 'error',
      message: 'unexpected token',
      location: { line: 1, col: 4, span: [3, 4] },
    };
    const expected = [
      'error[E201_PARSE_UNEXPECTED_TOKEN]: unexpected token',
      ' --> script.placitum:1:4',
      '  |',
      '1 | ab?cd',
      '  |    ^',
      '  |',
      '',
    ].join('\n');
    expect(formatError(err, { name: 'script.placitum', text: source })).toBe(expected);
  });

  it('prefixes warnings with the severity label', () => {
    const err: PlacitumError = {
      code: 'E602_CLI_INVALID_FLAG',
      phase: 'cli',
      severity: 'warning',
      message: 'deprecated flag',
    };
    expect(formatError(err)).toBe('warning[E602_CLI_INVALID_FLAG]: deprecated flag\n');
  });
});
