import { LexError } from '../shared/errors.js';
import type { PlacitumError } from '../shared/errors.js';

export type TokenKind =
  | 'PRAGMA'
  | 'IDENTIFIER'
  | 'STRING'
  | 'NUMBER'
  | 'STRING_CHUNK'
  | 'FSTRING_START'
  | 'FSTRING_END'
  | 'NEWLINE'
  | 'EOF'
  | 'NEEDS'
  | 'LET'
  | 'FN'
  | 'IF'
  | 'ELSE'
  | 'WHILE'
  | 'FOR'
  | 'IN'
  | 'RETURN'
  | 'NOT'
  | 'ONLY'
  | 'TRUE'
  | 'FALSE'
  | 'NULL'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACE'
  | 'RBRACE'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'COMMA'
  | 'DOT'
  | 'COLON'
  | 'QUESTION'
  | 'PIPE'
  | 'OR'
  | 'AND'
  | 'EQ'
  | 'NEQ'
  | 'LT'
  | 'GT'
  | 'LTE'
  | 'GTE'
  | 'ASSIGN'
  | 'PLUS'
  | 'MINUS'
  | 'STAR'
  | 'SLASH'
  | 'BANG';

export interface Token {
  kind: TokenKind;
  value?: string | number;
  line: number;
  col: number;
  span: readonly [number, number];
}

// LSP contract (placitum-lsp-implementation.md §5.2): comments are trivia the
// rigid Token stream drops; analyzeSource publishes their spans so the server
// can style them without re-scanning strings by hand.
export interface CommentTrivia {
  span: readonly [number, number];
}

export interface TolerantLexResult {
  tokens: Token[];
  comments: CommentTrivia[];
  diagnostics: PlacitumError[];
}

// `fs`/`net`/`exec`/`env`/`read`/`write` are deliberately NOT keywords: they
// also appear as member-path segments (fs.readFile!), so the parser interprets
// them in needs-context instead.
const KEYWORDS: Record<string, TokenKind> = {
  needs: 'NEEDS',
  let: 'LET',
  fn: 'FN',
  if: 'IF',
  else: 'ELSE',
  while: 'WHILE',
  for: 'FOR',
  in: 'IN',
  return: 'RETURN',
  not: 'NOT',
  only: 'ONLY',
  true: 'TRUE',
  false: 'FALSE',
  null: 'NULL',
};

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isIdentStart = (c: string): boolean => /^[A-Za-z_]$/.test(c);
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);

const SINGLE_PUNCT: Record<string, TokenKind> = {
  '(': 'LPAREN',
  ')': 'RPAREN',
  '[': 'LBRACKET',
  ']': 'RBRACKET',
  ',': 'COMMA',
  '.': 'DOT',
  ':': 'COLON',
  '?': 'QUESTION',
  '+': 'PLUS',
  '-': 'MINUS',
  '*': 'STAR',
  '/': 'SLASH',
};

// Maximal munch: `next` forms `two` when it directly follows; otherwise `one`
// (undefined = the lone char is not an operator, e.g. `&`).
const DOUBLE_PUNCT: Record<string, { next: string; two: TokenKind; one?: TokenKind }> = {
  '|': { next: '|', two: 'OR', one: 'PIPE' },
  '&': { next: '&', two: 'AND' },
  '=': { next: '=', two: 'EQ', one: 'ASSIGN' },
  '<': { next: '=', two: 'LTE', one: 'LT' },
  '>': { next: '=', two: 'GTE', one: 'GT' },
};

class Lexer {
  private pos = 0;
  private line = 1;
  private col = 1;
  private braceDepth = 0;
  // braceDepth recorded at each f-string interpolation `{`; a `}` that brings
  // braceDepth back to the top entry closes the interpolation and resumes
  // f-string text mode. Handles nested f-strings for free (it's a stack).
  private readonly fstringDepths: number[] = [];
  private readonly tokens: Token[] = [];
  // Tolerant mode (LSP): record instead of throw, so one bad character does
  // not cost the editor its whole token stream. lex() keeps the strict
  // fail-fast contract; lexTolerant() reads these out.
  readonly comments: CommentTrivia[] = [];
  readonly errors: PlacitumError[] = [];

  constructor(private readonly source: string, private readonly tolerant = false) {}

  run(): Token[] {
    while (this.pos < this.source.length) {
      this.step();
    }
    if (this.fstringDepths.length > 0) {
      if (!this.tolerant) {
        return this.fail(
          'E102_LEX_UNTERMINATED_FSTRING_EXPR',
          '`{` inside f"..." is not closed before the string ends.',
          this.line,
          this.col,
          [this.pos, this.pos],
          'Close the interpolation with }.',
        );
      }
      this.report(
        'E102_LEX_UNTERMINATED_FSTRING_EXPR',
        '`{` inside f"..." is not closed before the string ends.',
        this.line,
        this.col,
        [this.pos, this.pos],
        'Close the interpolation with }.',
      );
      this.fstringDepths.length = 0;
    }
    this.push('EOF', this.pos, this.line, this.col);
    return this.tokens;
  }

  private ch(): string {
    return this.source.charAt(this.pos);
  }

  private peek(offset: number): string {
    return this.source.charAt(this.pos + offset);
  }

  private advance(): void {
    if (this.ch() === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    this.pos++;
  }

  private push(
    kind: TokenKind,
    start: number,
    line: number,
    col: number,
    value?: string | number,
  ): void {
    // Key order (kind, value, line, col, span) is load-bearing: lexer goldens
    // are compared byte-for-byte.
    const token: Token =
      value === undefined
        ? { kind, line, col, span: [start, this.pos] as const }
        : { kind, value, line, col, span: [start, this.pos] as const };
    this.tokens.push(token);
  }

  private fail(
    code: string,
    message: string,
    line: number,
    col: number,
    span: [number, number],
    hint?: string,
  ): never {
    throw new LexError({
      code,
      message,
      location: { line, col, span },
      ...(hint !== undefined ? { hint } : {}),
    });
  }

  // Same envelope as fail(), pushed instead of thrown. Recovery is the
  // caller's job: every report site must guarantee pos advanced.
  private report(
    code: string,
    message: string,
    line: number,
    col: number,
    span: [number, number],
    hint?: string,
  ): void {
    this.errors.push(
      new LexError({
        code,
        message,
        location: { line, col, span },
        ...(hint !== undefined ? { hint } : {}),
      }).toEnvelope(),
    );
  }

  private step(): void {
    const c = this.ch();
    if (c === ' ' || c === '\t' || c === '\r') {
      this.advance();
      return;
    }
    if (c === '\n') {
      this.scanNewlineRun();
      return;
    }
    if (c === '#') {
      this.scanHash();
      return;
    }
    if (c === '"') {
      this.scanString();
      return;
    }
    if (c === 'f' && this.peek(1) === '"') {
      this.scanFString();
      return;
    }
    if (isDigit(c)) {
      this.scanNumber();
      return;
    }
    if (isIdentStart(c)) {
      this.scanIdent();
      return;
    }
    this.scanPunct(c);
  }

  // Newlines are significant (statement terminators) but collapsed: a run of
  // blank lines and comment-only lines emits one NEWLINE token.
  private scanNewlineRun(): void {
    const start = this.pos;
    const line = this.line;
    const col = this.col;
    for (;;) {
      const c = this.ch();
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        this.advance();
        continue;
      }
      if (c === '#') {
        const commentStart = this.pos;
        if (this.peek(1) === '!') {
          if (!this.tolerant) {
            return this.fail(
              'E105_LEX_INVALID_PRAGMA',
              '`#!` is only recognized on physical line 1.',
              this.line,
              this.col,
              [this.pos, this.pos + 2],
              'Move the pragma to the first line, or use `#` for a comment.',
            );
          }
          this.report(
            'E105_LEX_INVALID_PRAGMA',
            '`#!` is only recognized on physical line 1.',
            this.line,
            this.col,
            [this.pos, this.pos + 2],
            'Move the pragma to the first line, or use `#` for a comment.',
          );
          this.advance();
          this.advance();
          this.skipToEol();
          this.comments.push({ span: [commentStart, this.pos] });
          continue;
        }
        this.skipToEol();
        this.comments.push({ span: [commentStart, this.pos] });
        continue;
      }
      break;
    }
    this.push('NEWLINE', start, line, col);
  }

  private skipToEol(): void {
    while (this.pos < this.source.length && this.ch() !== '\n') {
      this.advance();
    }
  }

  private scanHash(): void {
    const start = this.pos;
    const line = this.line;
    const col = this.col;
    if (this.peek(1) === '!') {
      if (line !== 1) {
        if (!this.tolerant) {
          return this.fail(
            'E105_LEX_INVALID_PRAGMA',
            '`#!` is only recognized on physical line 1.',
            line,
            col,
            [start, start + 2],
            'Move the pragma to the first line, or use `#` for a comment.',
          );
        }
        this.report(
          'E105_LEX_INVALID_PRAGMA',
          '`#!` is only recognized on physical line 1.',
          line,
          col,
          [start, start + 2],
          'Move the pragma to the first line, or use `#` for a comment.',
        );
        this.advance();
        this.advance();
        this.skipToEol();
        this.comments.push({ span: [start, this.pos] });
        return;
      }
      this.advance();
      this.advance();
      if (!isIdentStart(this.ch())) {
        if (!this.tolerant) {
          return this.fail(
            'E105_LEX_INVALID_PRAGMA',
            '`#!` must be followed immediately by a pragma name.',
            this.line,
            this.col,
            [start, this.pos],
          );
        }
        this.report(
          'E105_LEX_INVALID_PRAGMA',
          '`#!` must be followed immediately by a pragma name.',
          this.line,
          this.col,
          [start, this.pos],
        );
        this.skipToEol();
        this.comments.push({ span: [start, this.pos] });
        return;
      }
      const nameStart = this.pos;
      while (isIdentPart(this.ch())) {
        this.advance();
      }
      this.push('PRAGMA', start, line, col, this.source.slice(nameStart, this.pos));
      return;
    }
    // Bare `#`: line comment, anywhere.
    this.skipToEol();
    this.comments.push({ span: [start, this.pos] });
  }

  private scanString(): void {
    const start = this.pos;
    const line = this.line;
    const col = this.col;
    this.advance(); // opening "
    let value = '';
    for (;;) {
      if (this.pos >= this.source.length || this.ch() === '\n') {
        if (!this.tolerant) {
          return this.fail(
            'E101_LEX_UNTERMINATED_STRING',
            'String literal is not closed before end of line/input.',
            line,
            col,
            [start, this.pos],
            'Close the string with a matching ".',
          );
        }
        this.report(
          'E101_LEX_UNTERMINATED_STRING',
          'String literal is not closed before end of line/input.',
          line,
          col,
          [start, this.pos],
          'Close the string with a matching ".',
        );
        this.push('STRING', start, line, col, value);
        return;
      }
      const c = this.ch();
      if (c === '"') {
        this.advance();
        this.push('STRING', start, line, col, value);
        return;
      }
      if (c === '\\') {
        value += this.scanEscape(false);
        continue;
      }
      value += c;
      this.advance();
    }
  }

  private scanFString(): void {
    const start = this.pos;
    const line = this.line;
    const col = this.col;
    this.advance();
    this.advance(); // f"
    this.push('FSTRING_START', start, line, col);
    this.scanFText();
  }

  // F-string text mode: accumulate literal text until an unescaped `{` (emit
  // chunk, open interpolation, back to normal mode) or closing `"` (done).
  private scanFText(): void {
    const chunkStart = this.pos;
    const chunkLine = this.line;
    const chunkCol = this.col;
    let value = '';
    const flush = (): void => {
      if (value.length > 0) {
        this.push('STRING_CHUNK', chunkStart, chunkLine, chunkCol, value);
      }
    };
    for (;;) {
      if (this.pos >= this.source.length || this.ch() === '\n') {
        if (!this.tolerant) {
          return this.fail(
            'E101_LEX_UNTERMINATED_STRING',
            'f-string is not closed before end of line/input.',
            chunkLine,
            chunkCol,
            [chunkStart, this.pos],
            'Close the string with a matching ".',
          );
        }
        this.report(
          'E101_LEX_UNTERMINATED_STRING',
          'f-string is not closed before end of line/input.',
          chunkLine,
          chunkCol,
          [chunkStart, this.pos],
          'Close the string with a matching ".',
        );
        flush();
        return;
      }
      const c = this.ch();
      if (c === '"') {
        flush();
        const endStart = this.pos;
        const endLine = this.line;
        const endCol = this.col;
        this.advance();
        this.push('FSTRING_END', endStart, endLine, endCol);
        return;
      }
      if (c === '{') {
        flush();
        const braceStart = this.pos;
        const braceLine = this.line;
        const braceCol = this.col;
        this.fstringDepths.push(this.braceDepth);
        this.braceDepth++;
        this.advance();
        this.push('LBRACE', braceStart, braceLine, braceCol);
        return;
      }
      if (c === '\\') {
        value += this.scanEscape(true);
        continue;
      }
      value += c;
      this.advance();
    }
  }

  private scanEscape(inFText: boolean): string {
    const start = this.pos;
    const line = this.line;
    const col = this.col;
    this.advance(); // backslash
    const c = this.ch();
    const simple: Record<string, string> = {
      n: '\n',
      t: '\t',
      r: '\r',
      '\\': '\\',
      '"': '"',
    };
    const mapped = simple[c];
    if (mapped !== undefined) {
      this.advance();
      return mapped;
    }
    if (inFText && (c === '{' || c === '}')) {
      this.advance();
      return c;
    }
    if (!this.tolerant) {
      return this.fail(
        'E103_LEX_INVALID_ESCAPE',
        `Unknown escape sequence \\${c}.`,
        line,
        col,
        [start, this.pos + (this.pos < this.source.length ? 1 : 0)],
        `Valid escapes are \\n, \\t, \\r, \\\\, \\"${inFText ? ', \\{, \\}' : ''}.`,
      );
    }
    this.report(
      'E103_LEX_INVALID_ESCAPE',
      `Unknown escape sequence \\${c}.`,
      line,
      col,
      [start, this.pos + (this.pos < this.source.length ? 1 : 0)],
      `Valid escapes are \\n, \\t, \\r, \\\\, \\"${inFText ? ', \\{, \\}' : ''}.`,
    );
    if (c === '') return '\\';
    this.advance();
    return `\\${c}`;
  }

  private scanNumber(): void {
    const start = this.pos;
    const line = this.line;
    const col = this.col;
    while (isDigit(this.ch())) {
      this.advance();
    }
    if (this.ch() === '.' && isDigit(this.peek(1))) {
      this.advance();
      while (isDigit(this.ch())) {
        this.advance();
      }
    }
    const c = this.ch();
    // ponytail: numbers have no members and no exponent/hex forms, so a `.`
    // or letter directly after a number is always a mistake — that's E106.
    if (c === '.' || isIdentStart(c)) {
      if (!this.tolerant) {
        return this.fail(
          'E106_LEX_INVALID_NUMBER',
          'Malformed numeric literal.',
          line,
          col,
          [start, this.pos + (this.pos < this.source.length ? 1 : 0)],
          'Use digits with an optional single decimal point, e.g. 42 or 3.14.',
        );
      }
      this.report(
        'E106_LEX_INVALID_NUMBER',
        'Malformed numeric literal.',
        line,
        col,
        [start, this.pos + (this.pos < this.source.length ? 1 : 0)],
        'Use digits with an optional single decimal point, e.g. 42 or 3.14.',
      );
    }
    this.push('NUMBER', start, line, col, Number(this.source.slice(start, this.pos)));
  }

  private scanIdent(): void {
    const start = this.pos;
    const line = this.line;
    const col = this.col;
    while (isIdentPart(this.ch())) {
      this.advance();
    }
    const text = this.source.slice(start, this.pos);
    // hasOwn: a plain-object table would leak Object.prototype members, so an
    // identifier like `constructor`/`toString` would lex as a garbage "keyword".
    const keyword = Object.hasOwn(KEYWORDS, text) ? KEYWORDS[text] : undefined;
    if (keyword !== undefined) {
      this.push(keyword, start, line, col);
    } else {
      this.push('IDENTIFIER', start, line, col, text);
    }
  }

  // Section 4: `!` is a BANG only immediately (no whitespace) after an
  // identifier; `!=` wins by maximal munch; anything else is E104. The
  // chain-shape rule (no calls before `!`) is the parser's job (E205).
  private scanBang(start: number, line: number, col: number): void {
    if (this.peek(1) === '=') {
      this.advance();
      this.advance();
      this.push('NEQ', start, line, col);
      return;
    }
    const last = this.tokens[this.tokens.length - 1];
    if (last !== undefined && last.kind === 'IDENTIFIER' && last.span[1] === start) {
      this.advance();
      this.push('BANG', start, line, col);
      return;
    }
    const message =
      last !== undefined && last.kind === 'IDENTIFIER'
        ? 'Whitespace is not allowed between a bang-call target and `!`.'
        : '`!` is only valid immediately after a bang-call target (identifier or member-access chain) or as part of `!=`.';
    const hint =
      last !== undefined && last.kind === 'IDENTIFIER'
        ? 'Write the call as `foo!(...)` with no space before the bang.'
        : 'Use the `not` keyword for logical negation.';
    if (!this.tolerant) {
      return this.fail('E104_LEX_UNEXPECTED_CHARACTER', message, line, col, [start, start + 1], hint);
    }
    this.report('E104_LEX_UNEXPECTED_CHARACTER', message, line, col, [start, start + 1], hint);
    this.advance();
  }

  private scanPunct(c: string): void {
    const start = this.pos;
    const line = this.line;
    const col = this.col;
    // Braces carry f-string interpolation bookkeeping; `!` has its own rule.
    if (c === '{' || c === '}') {
      this.advance();
      this.braceDepth += c === '{' ? 1 : -1;
      this.push(c === '{' ? 'LBRACE' : 'RBRACE', start, line, col);
      const top = this.fstringDepths[this.fstringDepths.length - 1];
      if (c === '}' && top !== undefined && top === this.braceDepth) {
        this.fstringDepths.pop();
        this.scanFText();
      }
      return;
    }
    if (c === '!') {
      this.scanBang(start, line, col);
      return;
    }
    const single = SINGLE_PUNCT[c];
    if (single !== undefined) {
      this.advance();
      this.push(single, start, line, col);
      return;
    }
    const double = DOUBLE_PUNCT[c];
    if (double !== undefined) {
      if (this.peek(1) === double.next) {
        this.advance();
        this.advance();
        this.push(double.two, start, line, col);
      } else if (double.one !== undefined) {
        this.advance();
        this.push(double.one, start, line, col);
      } else {
        if (!this.tolerant) {
          return this.fail(
            'E104_LEX_UNEXPECTED_CHARACTER',
            `\`${c}\` is not an operator; did you mean \`${c}${double.next}\`?`,
            line,
            col,
            [start, start + 1],
          );
        }
        this.report(
          'E104_LEX_UNEXPECTED_CHARACTER',
          `\`${c}\` is not an operator; did you mean \`${c}${double.next}\`?`,
          line,
          col,
          [start, start + 1],
        );
        this.advance();
      }
      return;
    }
    if (!this.tolerant) {
      return this.fail(
        'E104_LEX_UNEXPECTED_CHARACTER',
        `Unexpected character ${JSON.stringify(c)}.`,
        line,
        col,
        [start, start + 1],
      );
    }
    this.report(
      'E104_LEX_UNEXPECTED_CHARACTER',
      `Unexpected character ${JSON.stringify(c)}.`,
      line,
      col,
      [start, start + 1],
    );
    this.advance();
  }
}

export function lex(source: string): Token[] {
  return new Lexer(source).run();
}

// Never throws: records every lexical error and returns the partial stream.
export function lexTolerant(source: string): TolerantLexResult {
  const lexer = new Lexer(source, true);
  const tokens = lexer.run();
  return { tokens, comments: lexer.comments, diagnostics: lexer.errors };
}
