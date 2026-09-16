// Section 7.1 — pure data definitions for ASTNodes. No logic lives here.

export interface BaseNode {
  readonly line: number;                    // 1-indexed line of the node's first token
  readonly col: number;                     // 1-indexed column of the node's first token
  readonly span: readonly [number, number]; // [startOffset, endOffset) into the source buffer
}

// ---- Root ----
export interface Program extends BaseNode {
  kind: 'Program';
  pragmas: string[];        // e.g. ["strict"], parsed from "#!strict" — line-1 only
  needs: NeedsDecl[];       // top-level needs blocks only (grammar-enforced position)
  body: Statement[];
}

// ---- Capabilities ----
export type CapabilityToken =
  | FsReadCapability
  | FsWriteCapability
  | NetCapability
  | ExecCapability
  | EnvCapability
  | OnlyCapability;

export interface FsReadCapability extends BaseNode {
  kind: 'FsReadCapability';
  pattern: string;              // raw glob, e.g. "/etc/config/*.json"
}
export interface FsWriteCapability extends BaseNode {
  kind: 'FsWriteCapability';
  pattern: string;
}
export interface NetCapability extends BaseNode {
  kind: 'NetCapability';
  pattern: string;               // exact host, or "*.<host>" — Section 7.2 HostPattern rules
}
export interface ExecCapability extends BaseNode {
  kind: 'ExecCapability';
  pattern: string;                // binary path or glob
}
export interface EnvCapability extends BaseNode {
  kind: 'EnvCapability';
  name: string;
  optional: boolean;              // true for env(NAME?)
}
export interface OnlyCapability extends BaseNode {
  kind: 'OnlyCapability';
  inner: Exclude<CapabilityToken, OnlyCapability>; // only() never nests
}

export interface NeedsDecl extends BaseNode {
  kind: 'NeedsDecl';
  tokens: CapabilityToken[];
}

// ---- Statements ----
export type Statement =
  | LetStmt | FnDecl | IfStmt | WhileStmt | ForStmt
  | ReturnStmt | ExprStmt | NeedsDecl;

export interface LetStmt extends BaseNode {
  kind: 'LetStmt';
  id: string;
  init: Expr;
}
export interface Param extends BaseNode {
  kind: 'Param';
  id: string;
}
export interface Block extends BaseNode {
  kind: 'Block';
  body: Statement[];
}
export interface FnDecl extends BaseNode {
  kind: 'FnDecl';
  id: string;
  params: Param[];
  needs: NeedsDecl | null;   // null = inherits enclosing scope's manifest unchanged (Section 2.3)
  body: Block;
}
export interface IfStmt extends BaseNode {
  kind: 'IfStmt';
  test: Expr;
  consequent: Block;
  alternate: Block | IfStmt | null;
}
export interface WhileStmt extends BaseNode {
  kind: 'WhileStmt';
  test: Expr;
  body: Block;
}
export interface ForStmt extends BaseNode {
  kind: 'ForStmt';
  iterator: string;
  iterable: Expr;
  body: Block;
}
export interface ReturnStmt extends BaseNode {
  kind: 'ReturnStmt';
  argument: Expr | null;
}
export interface ExprStmt extends BaseNode {
  kind: 'ExprStmt';
  expression: Expr;
}

// ---- Expressions ----
export type Expr =
  | PipeExpr | BangCall | CallExpr | MemberExpr | FStringExpr | Identifier
  | StringLiteral | NumberLiteral | BooleanLiteral | NullLiteral
  | ArrayLiteral | ObjectLiteral | BinaryExpr | UnaryExpr | AssignExpr;

export interface PipeExpr extends BaseNode {
  kind: 'PipeExpr';
  stages: Expr[];    // length >= 2, flat (Section 5, rule 3) — never nested PipeExpr
}
export interface BangCall extends BaseNode {
  kind: 'BangCall';
  target: string;     // compile-time-known dotted path, e.g. "curl", "fs.readFile" (Section 4 rule)
  args: Expr[];
}
export interface CallExpr extends BaseNode {
  kind: 'CallExpr';
  callee: Expr;        // user-defined fn or a pure stdlib reference — never an effectful binding
  args: Expr[];
}
export interface MemberExpr extends BaseNode {
  kind: 'MemberExpr';
  object: Expr;
  property: string;    // dot-access only; no computed/bracket indexing in v1
}
export interface FStringExpr extends BaseNode {
  kind: 'FStringExpr';
  parts: (string | Expr)[]; // alternating literal chunks and interpolated expressions
}
export interface Identifier extends BaseNode {
  kind: 'Identifier';
  name: string;
}
export interface StringLiteral extends BaseNode {
  kind: 'StringLiteral';
  value: string;
}
export interface NumberLiteral extends BaseNode {
  kind: 'NumberLiteral';
  value: number;
}
export interface BooleanLiteral extends BaseNode {
  kind: 'BooleanLiteral';
  value: boolean;
}
export interface NullLiteral extends BaseNode {
  kind: 'NullLiteral';
}
export interface ArrayLiteral extends BaseNode {
  kind: 'ArrayLiteral';
  elements: Expr[];
}
export interface ObjectProperty extends BaseNode {
  kind: 'ObjectProperty';
  key: string;
  value: Expr;
}
export interface ObjectLiteral extends BaseNode {
  kind: 'ObjectLiteral';
  properties: ObjectProperty[];
}
export type BinaryOperator = '+' | '-' | '*' | '/' | '==' | '!=' | '<' | '>' | '<=' | '>=' | '&&' | '||';
export interface BinaryExpr extends BaseNode {
  kind: 'BinaryExpr';
  operator: BinaryOperator;
  left: Expr;
  right: Expr;
}
export type UnaryOperator = '-' | 'not';
export interface UnaryExpr extends BaseNode {
  kind: 'UnaryExpr';
  operator: UnaryOperator;
  argument: Expr;
}
export interface AssignExpr extends BaseNode {
  kind: 'AssignExpr';
  id: string;
  value: Expr;
}

// ---- The complete union ----
export type ASTNode = Program | Statement | Expr | Param | Block | ObjectProperty;
