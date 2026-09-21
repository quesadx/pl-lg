// Public API barrel (placitum-lsp-implementation.md §5.1) — the only import
// surface external tools (the language server) may use. It exposes the pure
// pipeline plus the tables needed for completion/hover; it deliberately does
// NOT export the evaluator, the guard, the stdlib runtime or host-bindings.
// Importing this module performs no I/O.

export { lex, lexTolerant } from './lexer/lexer.js';
export type { CommentTrivia, Token, TokenKind, TolerantLexResult } from './lexer/lexer.js';

export { parse, parseTolerant } from './parser/parser.js';
export type { TolerantParseResult } from './parser/parser.js';

export type * from './ast/ast.js';

export { BANG_REGISTRY, extract } from './capability/extractor.js';
export type { EffectCategory } from './capability/extractor.js';

export { explain } from './cli/explain.js';
export { formatError } from './cli/format-error.js';
export type { ErrorSource } from './cli/format-error.js';

export { analyzeSource } from './analysis/analyze.js';
export type { AnalysisResult } from './analysis/analyze.js';
export { calleeSignature, collectStrictDiagnostics, inferType } from './analysis/strict.js';

export { compileManifest, SerializedCapabilityManifestSchema } from './shared/manifest.js';
export type {
  CapabilityManifest,
  DeferredCheck,
  EnvRequirement,
  ExecPattern,
  GlobPattern,
  HostPattern,
  SerializedGlobPattern,
  SerializedManifest,
} from './shared/manifest.js';

export { globCovers, globToRegex, hostToRegex } from './shared/glob-to-regex.js';

export {
  AMBIENT_BANGS,
  BANG_SIGNATURES,
  EFFECTFUL_STDLIB,
  PURE_SIGNATURES,
} from './stdlib/stdlib.js';
export type { BangFn, Stdlib } from './stdlib/stdlib.js';

export { deepEquals, display, isCallable, typeName } from './shared/values.js';
export type { CallableValue, NativeSig, TypeName, Value } from './shared/values.js';

export {
  CapabilityViolationError,
  CliError,
  EvalError,
  ExtractError,
  LexError,
  ParseError,
  PlacitumErrorBase,
} from './shared/errors.js';
export type { PlacitumErrorInit } from './shared/errors.js';
export { PlacitumErrorSchema } from './shared/error-schema.js';
export type { PlacitumError } from './shared/error-schema.js';
