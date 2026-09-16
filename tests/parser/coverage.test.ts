import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import type { ASTNode, CapabilityToken } from '../../src/ast/ast.js';
import { assertNever } from '../../src/shared/assert-never.js';

const parserDir = new URL('./', import.meta.url);

// The DoD's "satisfies ASTNode" check: an exhaustive switch over every kind in
// the Section 7.1 unions (ASTNode plus the CapabilityToken sub-union — token
// nodes are reachable only through NeedsDecl/OnlyCapability, not ASTNode
// directly). A kind outside the unions (or an unhandled member) fails here —
// assertNever at runtime, tsc at compile time.
function collectKinds(node: ASTNode | CapabilityToken, into: Set<string>): void {
  into.add(node.kind);
  switch (node.kind) {
    case 'Program':
      for (const decl of node.needs) collectKinds(decl, into);
      for (const stmt of node.body) collectKinds(stmt, into);
      return;
    case 'NeedsDecl':
      for (const token of node.tokens) collectKinds(token, into);
      return;
    case 'FsReadCapability':
    case 'FsWriteCapability':
    case 'NetCapability':
    case 'ExecCapability':
    case 'EnvCapability':
      return;
    case 'OnlyCapability':
      collectKinds(node.inner, into);
      return;
    case 'LetStmt':
      collectKinds(node.init, into);
      return;
    case 'Param':
      return;
    case 'Block':
      for (const stmt of node.body) collectKinds(stmt, into);
      return;
    case 'FnDecl':
      for (const param of node.params) collectKinds(param, into);
      if (node.needs !== null) collectKinds(node.needs, into);
      collectKinds(node.body, into);
      return;
    case 'IfStmt':
      collectKinds(node.test, into);
      collectKinds(node.consequent, into);
      if (node.alternate !== null) collectKinds(node.alternate, into);
      return;
    case 'WhileStmt':
      collectKinds(node.test, into);
      collectKinds(node.body, into);
      return;
    case 'ForStmt':
      collectKinds(node.iterable, into);
      collectKinds(node.body, into);
      return;
    case 'ReturnStmt':
      if (node.argument !== null) collectKinds(node.argument, into);
      return;
    case 'ExprStmt':
      collectKinds(node.expression, into);
      return;
    case 'PipeExpr':
      for (const stage of node.stages) collectKinds(stage, into);
      return;
    case 'BangCall':
      for (const arg of node.args) collectKinds(arg, into);
      return;
    case 'CallExpr':
      collectKinds(node.callee, into);
      for (const arg of node.args) collectKinds(arg, into);
      return;
    case 'MemberExpr':
      collectKinds(node.object, into);
      return;
    case 'FStringExpr':
      for (const part of node.parts) {
        if (typeof part !== 'string') collectKinds(part, into);
      }
      return;
    case 'Identifier':
    case 'StringLiteral':
    case 'NumberLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
      return;
    case 'ArrayLiteral':
      for (const element of node.elements) collectKinds(element, into);
      return;
    case 'ObjectLiteral':
      for (const prop of node.properties) collectKinds(prop, into);
      return;
    case 'ObjectProperty':
      collectKinds(node.value, into);
      return;
    case 'BinaryExpr':
      collectKinds(node.left, into);
      collectKinds(node.right, into);
      return;
    case 'UnaryExpr':
      collectKinds(node.argument, into);
      return;
    case 'AssignExpr':
      collectKinds(node.value, into);
      return;
    default:
      return assertNever(node);
  }
}

const FULL_UNION = [
  'Program', 'NeedsDecl',
  'FsReadCapability', 'FsWriteCapability', 'NetCapability', 'ExecCapability',
  'EnvCapability', 'OnlyCapability',
  'LetStmt', 'Param', 'Block', 'FnDecl', 'IfStmt', 'WhileStmt', 'ForStmt',
  'ReturnStmt', 'ExprStmt',
  'PipeExpr', 'BangCall', 'CallExpr', 'MemberExpr', 'FStringExpr', 'Identifier',
  'StringLiteral', 'NumberLiteral', 'BooleanLiteral', 'NullLiteral',
  'ArrayLiteral', 'ObjectLiteral', 'ObjectProperty', 'BinaryExpr', 'UnaryExpr',
  'AssignExpr',
].sort();

describe('Phase 2: parser output stays inside the ASTNode union', () => {
  it('rosetta + kitchen-sink produce every grammar-producible kind, and nothing outside the union', () => {
    const kinds = new Set<string>();
    for (const file of ['rosetta.placitum', 'kitchen-sink.placitum']) {
      const source = readFileSync(new URL(file, parserDir), 'utf8');
      collectKinds(parse(lex(source)), kinds);
    }
    expect([...kinds].sort()).toEqual(FULL_UNION);
  });
});
