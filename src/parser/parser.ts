import type { Token, TokenKind } from '../lexer/lexer.js';
import type {
  ArrayLiteral,
  AssignExpr,
  BangCall,
  BinaryExpr,
  BinaryOperator,
  Block,
  BooleanLiteral,
  CallExpr,
  CapabilityToken,
  EnvCapability,
  ExecCapability,
  Expr,
  ExprStmt,
  ForStmt,
  FsReadCapability,
  FsWriteCapability,
  FnDecl,
  FStringExpr,
  Identifier,
  IfStmt,
  LetStmt,
  MemberExpr,
  NeedsDecl,
  NetCapability,
  NullLiteral,
  NumberLiteral,
  ObjectLiteral,
  ObjectProperty,
  OnlyCapability,
  Param,
  PipeExpr,
  Program,
  ReturnStmt,
  Statement,
  StringLiteral,
  UnaryExpr,
  WhileStmt,
} from '../ast/ast.js';
import { ParseError } from '../shared/errors.js';

// Section 4 EBNF, exactly: recursive-descent statements, Pratt expressions.
// Precedence (low -> high): `=` (right-assoc) | `|` | `||` | `&&` | `==`/`!=`
// | relational | additive | multiplicative | unary `not`/`-` | postfix | primary.
//
// Key order in every constructed node (kind, line, col, span, then Section 7.1
// field order) is load-bearing: parser goldens are compared byte-for-byte.
export function parse(tokens: Token[]): Program {
  return new Parser(tokens).run();
}

const TOKEN_DISPLAY: Partial<Record<TokenKind, string>> = {
  NEWLINE: 'end of line',
  EOF: 'end of input',
  NEEDS: 'needs',
  LET: 'let',
  FN: 'fn',
  IF: 'if',
  ELSE: 'else',
  WHILE: 'while',
  FOR: 'for',
  IN: 'in',
  RETURN: 'return',
  NOT: 'not',
  ONLY: 'only',
  TRUE: 'true',
  FALSE: 'false',
  NULL: 'null',
  LPAREN: '(',
  RPAREN: ')',
  LBRACE: '{',
  RBRACE: '}',
  LBRACKET: '[',
  RBRACKET: ']',
  COMMA: ',',
  DOT: '.',
  COLON: ':',
  QUESTION: '?',
  PIPE: '|',
  OR: '||',
  AND: '&&',
  EQ: '==',
  NEQ: '!=',
  LT: '<',
  GT: '>',
  LTE: '<=',
  GTE: '>=',
  ASSIGN: '=',
  PLUS: '+',
  MINUS: '-',
  STAR: '*',
  SLASH: '/',
  BANG: '!',
};

const OR_OPS: Partial<Record<TokenKind, BinaryOperator>> = { OR: '||' };
const AND_OPS: Partial<Record<TokenKind, BinaryOperator>> = { AND: '&&' };
const EQ_OPS: Partial<Record<TokenKind, BinaryOperator>> = { EQ: '==', NEQ: '!=' };
const REL_OPS: Partial<Record<TokenKind, BinaryOperator>> = {
  LT: '<',
  GT: '>',
  LTE: '<=',
  GTE: '>=',
};
const ADD_OPS: Partial<Record<TokenKind, BinaryOperator>> = { PLUS: '+', MINUS: '-' };
const MUL_OPS: Partial<Record<TokenKind, BinaryOperator>> = { STAR: '*', SLASH: '/' };

class Parser {
  private pos = 0;
  // Newlines terminate statements only at depth 0. Inside (...) argument
  // lists, [...] literals, {...} object literals, and f-string interpolations
  // they are skipped (the lexer allows newlines in interpolations, so this is
  // forced; one rule then covers multi-line calls for free). Block braces are
  // NOT tracked here — their statements keep newline terminators.
  private groupDepth = 0;
  // True when the most recent parsePrimary consumed a parenthesized group —
  // used to reject `(x).y!(...)` as a bang-call target (Section 4 rule).
  private primaryParenthesized = false;
  private readonly eofTok: Token;

  constructor(private readonly tokens: Token[]) {
    const last = tokens[tokens.length - 1];
    this.eofTok =
      last !== undefined && last.kind === 'EOF'
        ? last
        : { kind: 'EOF', line: 1, col: 1, span: [0, 0] };
  }

  // ---- Token access ----

  private raw(ahead: number): Token {
    const t = this.tokens[this.pos + ahead];
    return t ?? this.eofTok;
  }

  private tok(): Token {
    while (this.groupDepth > 0 && this.raw(0).kind === 'NEWLINE') {
      this.pos++;
    }
    return this.raw(0);
  }

  private consume(): void {
    if (this.raw(0).kind !== 'EOF') {
      this.pos++;
    }
  }

  // ---- Errors ----

  private failE201(t: Token, hint: string): never {
    const display = TOKEN_DISPLAY[t.kind] ?? String(t.value ?? t.kind);
    throw new ParseError({
      code: 'E201_PARSE_UNEXPECTED_TOKEN',
      message: `Unexpected token \`${display}\`.`,
      location: { line: t.line, col: t.col, span: [...t.span] },
      hint,
    });
  }

  private expect(kind: TokenKind, hint: string): Token {
    const t = this.tok();
    if (t.kind !== kind) {
      this.failE201(t, hint);
    }
    this.consume();
    return t;
  }

  private expectIdentifier(hint: string): Token {
    const t = this.tok();
    if (t.kind !== 'IDENTIFIER') {
      this.failE201(t, hint);
    }
    this.consume();
    return t;
  }

  // ---- Program & statements ----

  run(): Program {
    const first = this.raw(0);
    const pragmas: string[] = [];
    if (first.kind === 'PRAGMA') {
      pragmas.push(first.value as string);
      this.consume();
    }
    const needs: NeedsDecl[] = [];
    const body: Statement[] = [];
    for (;;) {
      this.skipBlankLines();
      const t = this.raw(0);
      if (t.kind === 'EOF') {
        break;
      }
      if (t.kind === 'NEEDS') {
        // Section 4: top-level `needs` only before the first non-needs statement.
        if (body.length > 0) {
          this.failE202(t);
        }
        needs.push(this.parseNeedsDecl());
        continue;
      }
      body.push(this.parseStatement());
      this.expectTerminator();
    }
    return {
      kind: 'Program',
      line: first.line,
      col: first.col,
      span: [first.span[0], this.eofTok.span[0]],
      pragmas,
      needs,
      body,
    };
  }

  private skipBlankLines(): void {
    while (this.raw(0).kind === 'NEWLINE') {
      this.pos++;
    }
  }

  private expectTerminator(): void {
    const t = this.raw(0);
    if (t.kind === 'NEWLINE') {
      this.pos++;
      return;
    }
    if (t.kind === 'RBRACE' || t.kind === 'EOF') {
      return; // lookahead: the enclosing block (or EOF) closes the statement
    }
    if (t.kind === 'ASSIGN') {
      this.failE201(t, 'Only a bare identifier can be assigned; expected end of statement.');
    }
    this.failE201(t, 'Expected end of statement (newline or `}`).');
  }

  private failE202(t: Token): never {
    throw new ParseError({
      code: 'E202_PARSE_NEEDS_NOT_AT_TOP',
      message:
        '`needs` is only allowed at the top of the program or directly after a function\u2019s parameter list.',
      location: { line: t.line, col: t.col, span: [...t.span] },
      hint: 'Move this declaration to a legal position.',
    });
  }

  private parseStatement(): Statement {
    const t = this.raw(0);
    switch (t.kind) {
      case 'LET':
        return this.parseLet();
      case 'FN':
        return this.parseFn();
      case 'IF':
        return this.parseIf();
      case 'WHILE':
        return this.parseWhile();
      case 'FOR':
        return this.parseFor();
      case 'RETURN':
        return this.parseReturn();
      case 'NEEDS':
        // Top-level placement is handled in run(); anything reaching statement
        // position is mid-block or after a function's first statement.
        return this.failE202(t);
      default: {
        const expression = this.parseExpr();
        const stmt: ExprStmt = {
          kind: 'ExprStmt',
          line: expression.line,
          col: expression.col,
          span: expression.span,
          expression,
        };
        return stmt;
      }
    }
  }

  private parseLet(): Statement {
    const start = this.raw(0);
    this.consume();
    const id = this.expectIdentifier('Expected a variable name after `let`.');
    this.expect('ASSIGN', 'Expected `=` after the variable name.');
    const init = this.parseExpr();
    const stmt: LetStmt = {
      kind: 'LetStmt',
      line: start.line,
      col: start.col,
      span: [start.span[0], init.span[1]],
      id: id.value as string,
      init,
    };
    return stmt;
  }

  private parseFn(): Statement {
    const start = this.raw(0);
    this.consume();
    const id = this.expectIdentifier('Expected a function name after `fn`.');
    this.expect('LPAREN', 'Expected `(` after the function name.');
    const params: Param[] = [];
    const seen = new Set<string>();
    if (this.tok().kind !== 'RPAREN') {
      for (;;) {
        const p = this.expectIdentifier('Expected a parameter name.');
        const name = p.value as string;
        if (seen.has(name)) {
          throw new ParseError({
            code: 'E206_PARSE_DUPLICATE_PARAM',
            message: `Duplicate parameter \`${name}\`.`,
            location: { line: p.line, col: p.col, span: [...p.span] },
            hint: 'Parameter names must be unique.',
          });
        }
        seen.add(name);
        params.push({ kind: 'Param', line: p.line, col: p.col, span: p.span, id: name });
        if (this.tok().kind === 'COMMA') {
          this.consume();
          continue;
        }
        break;
      }
    }
    this.expect('RPAREN', 'Expected `)` after the parameter list.');
    const needs =
      this.raw(0).kind === 'NEEDS' ? this.parseNeedsDecl() : null;
    const body = this.parseBlock();
    const decl: FnDecl = {
      kind: 'FnDecl',
      line: start.line,
      col: start.col,
      span: [start.span[0], body.span[1]],
      id: id.value as string,
      params,
      needs,
      body,
    };
    return decl;
  }

  private parseIf(): IfStmt {
    const start = this.raw(0);
    this.consume();
    const test = this.parseExpr();
    const consequent = this.parseBlock();
    let alternate: Block | IfStmt | null = null;
    if (this.raw(0).kind === 'ELSE') {
      this.consume();
      alternate = this.raw(0).kind === 'IF' ? this.parseIf() : this.parseBlock();
    }
    const stmt: IfStmt = {
      kind: 'IfStmt',
      line: start.line,
      col: start.col,
      span: [start.span[0], (alternate ?? consequent).span[1]],
      test,
      consequent,
      alternate,
    };
    return stmt;
  }

  private parseWhile(): Statement {
    const start = this.raw(0);
    this.consume();
    const test = this.parseExpr();
    const body = this.parseBlock();
    const stmt: WhileStmt = {
      kind: 'WhileStmt',
      line: start.line,
      col: start.col,
      span: [start.span[0], body.span[1]],
      test,
      body,
    };
    return stmt;
  }

  private parseFor(): Statement {
    const start = this.raw(0);
    this.consume();
    const iterator = this.expectIdentifier('Expected an iterator name.');
    this.expect('IN', 'Expected `in` after the iterator name.');
    const iterable = this.parseExpr();
    const body = this.parseBlock();
    const stmt: ForStmt = {
      kind: 'ForStmt',
      line: start.line,
      col: start.col,
      span: [start.span[0], body.span[1]],
      iterator: iterator.value as string,
      iterable,
      body,
    };
    return stmt;
  }

  private parseReturn(): Statement {
    const start = this.raw(0);
    this.consume();
    const t = this.raw(0);
    const argument =
      t.kind === 'NEWLINE' || t.kind === 'RBRACE' || t.kind === 'EOF'
        ? null
        : this.parseExpr();
    const stmt: ReturnStmt = {
      kind: 'ReturnStmt',
      line: start.line,
      col: start.col,
      span: [start.span[0], argument === null ? start.span[1] : argument.span[1]],
      argument,
    };
    return stmt;
  }

  private parseBlock(): Block {
    const open = this.tok();
    if (open.kind !== 'LBRACE') {
      this.failE201(open, 'Expected `{` to open a block.');
    }
    this.consume();
    const body: Statement[] = [];
    let close = open;
    for (;;) {
      this.skipBlankLines();
      const t = this.raw(0);
      if (t.kind === 'RBRACE') {
        close = t;
        this.consume();
        break;
      }
      if (t.kind === 'EOF') {
        throw new ParseError({
          code: 'E203_PARSE_UNTERMINATED_BLOCK',
          message: 'Block is not closed with `}` before end of input.',
          location: { line: t.line, col: t.col, span: [...t.span] },
          hint: 'Add the missing `}`.',
        });
      }
      body.push(this.parseStatement());
      this.expectTerminator();
    }
    const block: Block = {
      kind: 'Block',
      line: open.line,
      col: open.col,
      span: [open.span[0], close.span[1]],
      body,
    };
    return block;
  }

  // ---- Capabilities ----

  private parseNeedsDecl(): NeedsDecl {
    const start = this.tok();
    this.consume();
    const tokens: CapabilityToken[] = [this.parseCapabilityToken()];
    while (this.tok().kind === 'COMMA') {
      this.consume();
      tokens.push(this.parseCapabilityToken());
    }
    const last = tokens[tokens.length - 1];
    const decl: NeedsDecl = {
      kind: 'NeedsDecl',
      line: start.line,
      col: start.col,
      span: [start.span[0], last === undefined ? start.span[1] : last.span[1]],
      tokens,
    };
    return decl;
  }

  private failE204(
    loc: { line: number; col: number; span: readonly [number, number] },
    message: string,
    hint: string,
  ): never {
    throw new ParseError({
      code: 'E204_PARSE_INVALID_CAPABILITY_TOKEN',
      message,
      location: { line: loc.line, col: loc.col, span: [...loc.span] },
      hint,
    });
  }

  private expectPatternString(): string {
    const t = this.tok();
    if (t.kind !== 'STRING') {
      this.failE204(t, 'Expected a string literal as the capability pattern.', 'Wrap the pattern in double quotes.');
    }
    this.consume();
    return t.value as string;
  }

  private parseCapabilityToken(): CapabilityToken {
    const t = this.tok();
    // `only` is a keyword token (unlike fs/net/exec/env, which lex as
    // IDENTIFIER so they can double as member-path segments).
    if (t.kind !== 'IDENTIFIER' && t.kind !== 'ONLY') {
      this.failE204(t, 'Malformed capability token.', 'Valid capabilities: fs.read, fs.write, net, exec, env, only.');
    }
    const name = t.kind === 'ONLY' ? 'only' : (t.value as string);
    this.consume();
    if (name === 'fs') {
      this.expect('DOT', 'Expected `.` after `fs`.');
      const prop = this.tok();
      if (prop.kind !== 'IDENTIFIER' || (prop.value !== 'read' && prop.value !== 'write')) {
        this.failE204(prop, 'Expected `read` or `write` after `fs.`.', 'Valid capabilities: fs.read, fs.write, net, exec, env, only.');
      }
      this.consume();
      this.expect('LPAREN', 'Expected `(`.');
      const pattern = this.expectPatternString();
      const close = this.expect('RPAREN', 'Expected `)`.');
      const base = { line: t.line, col: t.col, span: [t.span[0], close.span[1]] as const };
      if (prop.value === 'read') {
        const cap: FsReadCapability = { kind: 'FsReadCapability', ...base, pattern };
        return cap;
      }
      const cap: FsWriteCapability = { kind: 'FsWriteCapability', ...base, pattern };
      return cap;
    }
    if (name === 'net' || name === 'exec') {
      this.expect('LPAREN', 'Expected `(`.');
      const pattern = this.expectPatternString();
      const close = this.expect('RPAREN', 'Expected `)`.');
      const base = { line: t.line, col: t.col, span: [t.span[0], close.span[1]] as const };
      if (name === 'net') {
        const cap: NetCapability = { kind: 'NetCapability', ...base, pattern };
        return cap;
      }
      const cap: ExecCapability = { kind: 'ExecCapability', ...base, pattern };
      return cap;
    }
    if (name === 'env') {
      this.expect('LPAREN', 'Expected `(`.');
      const id = this.expectIdentifier('Expected an environment variable name.');
      const optional = this.tok().kind === 'QUESTION';
      if (optional) {
        this.consume();
      }
      const close = this.expect('RPAREN', 'Expected `)`.');
      const cap: EnvCapability = {
        kind: 'EnvCapability',
        line: t.line,
        col: t.col,
        span: [t.span[0], close.span[1]],
        name: id.value as string,
        optional,
      };
      return cap;
    }
    if (name === 'only') {
      this.expect('LPAREN', 'Expected `(`.');
      const inner = this.parseCapabilityToken();
      if (inner.kind === 'OnlyCapability') {
        this.failE204(inner, '`only(...)` cannot be nested.', 'Use a single only() around a base capability token.');
      }
      const close = this.expect('RPAREN', 'Expected `)`.');
      const cap: OnlyCapability = {
        kind: 'OnlyCapability',
        line: t.line,
        col: t.col,
        span: [t.span[0], close.span[1]],
        inner,
      };
      return cap;
    }
    this.failE204(t, `Unknown capability \`${name}\`.`, 'Valid capabilities: fs.read, fs.write, net, exec, env, only.');
  }

  // ---- Expressions ----

  private parseExpr(): Expr {
    const t = this.tok();
    // Assignment: lowest precedence, right-associative, bare-identifier target.
    if (t.kind === 'IDENTIFIER' && this.raw(1).kind === 'ASSIGN') {
      this.consume();
      this.consume();
      const value = this.parseExpr();
      const expr: AssignExpr = {
        kind: 'AssignExpr',
        line: t.line,
        col: t.col,
        span: [t.span[0], value.span[1]],
        id: t.value as string,
        value,
      };
      return expr;
    }
    return this.parsePipe();
  }

  private parsePipe(): Expr {
    const first = this.parseOr();
    if (this.tok().kind !== 'PIPE') {
      return first;
    }
    // Section 5 rule 3: flat stage list, never nested PipeExpr.
    const stages: Expr[] = [first];
    let end = first.span[1];
    while (this.tok().kind === 'PIPE') {
      this.consume();
      const stage = this.parseOr();
      stages.push(stage);
      end = stage.span[1];
    }
    const pipe: PipeExpr = {
      kind: 'PipeExpr',
      line: first.line,
      col: first.col,
      span: [first.span[0], end],
      stages,
    };
    return pipe;
  }

  private parseOr(): Expr {
    return this.parseBinaryLevel(() => this.parseAnd(), OR_OPS);
  }

  private parseAnd(): Expr {
    return this.parseBinaryLevel(() => this.parseEq(), AND_OPS);
  }

  private parseEq(): Expr {
    return this.parseBinaryLevel(() => this.parseRel(), EQ_OPS);
  }

  private parseRel(): Expr {
    return this.parseBinaryLevel(() => this.parseAdd(), REL_OPS);
  }

  private parseAdd(): Expr {
    return this.parseBinaryLevel(() => this.parseMul(), ADD_OPS);
  }

  private parseMul(): Expr {
    return this.parseBinaryLevel(() => this.parseUnary(), MUL_OPS);
  }

  private parseBinaryLevel(next: () => Expr, ops: Partial<Record<TokenKind, BinaryOperator>>): Expr {
    let node = next();
    for (;;) {
      const t = this.tok();
      const op = ops[t.kind];
      if (op === undefined) {
        return node;
      }
      this.consume();
      const right = next();
      const bin: BinaryExpr = {
        kind: 'BinaryExpr',
        line: node.line,
        col: node.col,
        span: [node.span[0], right.span[1]],
        operator: op,
        left: node,
        right,
      };
      node = bin;
    }
  }

  private parseUnary(): Expr {
    const t = this.tok();
    if (t.kind === 'NOT' || t.kind === 'MINUS') {
      this.consume();
      const argument = this.parseUnary();
      const expr: UnaryExpr = {
        kind: 'UnaryExpr',
        line: t.line,
        col: t.col,
        span: [t.span[0], argument.span[1]],
        operator: t.kind === 'NOT' ? 'not' : '-',
        argument,
      };
      return expr;
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let node = this.parsePrimary();
    const rootParenthesized = this.primaryParenthesized;
    for (;;) {
      const t = this.tok();
      if (t.kind === 'DOT') {
        this.consume();
        const prop = this.tok();
        if (prop.kind !== 'IDENTIFIER') {
          this.failE201(prop, 'Expected a property name after `.`.');
        }
        this.consume();
        const member: MemberExpr = {
          kind: 'MemberExpr',
          line: node.line,
          col: node.col,
          span: [node.span[0], prop.span[1]],
          object: node,
          property: prop.value as string,
        };
        node = member;
        continue;
      }
      if (t.kind === 'LPAREN') {
        const { args, close } = this.parseArgList();
        const call: CallExpr = {
          kind: 'CallExpr',
          line: node.line,
          col: node.col,
          span: [node.span[0], close.span[1]],
          callee: node,
          args,
        };
        node = call;
        continue;
      }
      if (t.kind === 'BANG') {
        // Section 4: the chain must reduce to a bare identifier followed by
        // zero or more .identifier accesses — target is a static dotted string.
        const segments: string[] = [];
        let cursor: Expr = node;
        let ok = !rootParenthesized;
        while (ok) {
          if (cursor.kind === 'Identifier') {
            segments.unshift(cursor.name);
            break;
          }
          if (cursor.kind === 'MemberExpr') {
            segments.unshift(cursor.property);
            cursor = cursor.object;
            continue;
          }
          ok = false;
        }
        if (!ok) {
          throw new ParseError({
            code: 'E205_PARSE_INVALID_BANG_CALL_TARGET',
            message: 'Invalid bang-call target.',
            location: { line: t.line, col: t.col, span: [...t.span] },
            hint: 'The target must be a bare identifier or dotted member path, e.g. `fs.readFile!(...)`.',
          });
        }
        this.consume(); // BANG
        const lparen = this.tok();
        if (lparen.kind !== 'LPAREN') {
          this.failE201(lparen, 'Expected `(` to open the bang-call argument list.');
        }
        const { args, close } = this.parseArgList();
        const bang: BangCall = {
          kind: 'BangCall',
          line: node.line,
          col: node.col,
          span: [node.span[0], close.span[1]],
          target: segments.join('.'),
          args,
        };
        node = bang;
        continue;
      }
      return node;
    }
  }

  private parseArgList(): { args: Expr[]; close: Token } {
    this.consume(); // opening ( — already verified by the caller
    this.groupDepth++;
    const args: Expr[] = [];
    if (this.tok().kind !== 'RPAREN') {
      for (;;) {
        args.push(this.parseExpr());
        if (this.tok().kind === 'COMMA') {
          this.consume();
          continue;
        }
        break;
      }
    }
    const close = this.expect('RPAREN', 'Expected `)`.');
    this.groupDepth--;
    return { args, close };
  }

  private parsePrimary(): Expr {
    const t = this.tok();
    switch (t.kind) {
      case 'IDENTIFIER': {
        this.consume();
        const expr: Identifier = {
          kind: 'Identifier',
          line: t.line,
          col: t.col,
          span: t.span,
          name: t.value as string,
        };
        return expr;
      }
      case 'STRING': {
        this.consume();
        const expr: StringLiteral = {
          kind: 'StringLiteral',
          line: t.line,
          col: t.col,
          span: t.span,
          value: t.value as string,
        };
        return expr;
      }
      case 'NUMBER': {
        this.consume();
        const expr: NumberLiteral = {
          kind: 'NumberLiteral',
          line: t.line,
          col: t.col,
          span: t.span,
          value: t.value as number,
        };
        return expr;
      }
      case 'TRUE':
      case 'FALSE': {
        this.consume();
        const expr: BooleanLiteral = {
          kind: 'BooleanLiteral',
          line: t.line,
          col: t.col,
          span: t.span,
          value: t.kind === 'TRUE',
        };
        return expr;
      }
      case 'NULL': {
        this.consume();
        const expr: NullLiteral = { kind: 'NullLiteral', line: t.line, col: t.col, span: t.span };
        return expr;
      }
      case 'FSTRING_START':
        return this.parseFString(t);
      case 'LBRACKET':
        return this.parseArrayLiteral(t);
      case 'LBRACE':
        return this.parseObjectLiteral(t);
      case 'LPAREN': {
        this.consume();
        this.groupDepth++;
        const inner = this.parseExpr();
        this.groupDepth--;
        this.expect('RPAREN', 'Expected `)`.');
        this.primaryParenthesized = true;
        return inner;
      }
      default:
        return this.failE201(t, 'Expected an expression.');
    }
  }

  private parseArrayLiteral(start: Token): Expr {
    this.consume();
    this.groupDepth++;
    const elements: Expr[] = [];
    if (this.tok().kind !== 'RBRACKET') {
      for (;;) {
        elements.push(this.parseExpr());
        if (this.tok().kind === 'COMMA') {
          this.consume();
          continue;
        }
        break;
      }
    }
    const close = this.expect('RBRACKET', 'Expected `]`.');
    this.groupDepth--;
    const expr: ArrayLiteral = {
      kind: 'ArrayLiteral',
      line: start.line,
      col: start.col,
      span: [start.span[0], close.span[1]],
      elements,
    };
    return expr;
  }

  private parseObjectLiteral(start: Token): Expr {
    this.consume();
    this.groupDepth++;
    const properties: ObjectProperty[] = [];
    if (this.tok().kind !== 'RBRACE') {
      for (;;) {
        const key = this.tok();
        if (key.kind !== 'IDENTIFIER') {
          this.failE201(key, 'Expected a property name.');
        }
        this.consume();
        this.expect('COLON', 'Expected `:` after the property name.');
        const value = this.parseExpr();
        properties.push({
          kind: 'ObjectProperty',
          line: key.line,
          col: key.col,
          span: [key.span[0], value.span[1]],
          key: key.value as string,
          value,
        });
        if (this.tok().kind === 'COMMA') {
          this.consume();
          continue;
        }
        break;
      }
    }
    const close = this.expect('RBRACE', 'Expected `}`.');
    this.groupDepth--;
    const expr: ObjectLiteral = {
      kind: 'ObjectLiteral',
      line: start.line,
      col: start.col,
      span: [start.span[0], close.span[1]],
      properties,
    };
    return expr;
  }

  private parseFString(start: Token): Expr {
    this.consume();
    const parts: (string | Expr)[] = [];
    let end = start;
    for (;;) {
      const t = this.tok();
      if (t.kind === 'STRING_CHUNK') {
        parts.push(t.value as string);
        this.consume();
        continue;
      }
      if (t.kind === 'LBRACE') {
        this.consume();
        this.groupDepth++;
        const inner = this.parseExpr();
        const close = this.expect('RBRACE', 'Expected `}` to close the interpolation.');
        this.groupDepth--;
        parts.push(inner);
        end = close;
        continue;
      }
      if (t.kind === 'FSTRING_END') {
        this.consume();
        end = t;
        break;
      }
      this.failE201(t, 'Expected `}` to close the interpolation.');
    }
    const expr: FStringExpr = {
      kind: 'FStringExpr',
      line: start.line,
      col: start.col,
      span: [start.span[0], end.span[1]],
      parts,
    };
    return expr;
  }
}
