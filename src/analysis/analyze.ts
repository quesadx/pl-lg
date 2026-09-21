import type { Program } from '../ast/ast.js';
import { extract } from '../capability/extractor.js';
import { lexTolerant } from '../lexer/lexer.js';
import type { CommentTrivia, Token } from '../lexer/lexer.js';
import { parseTolerant } from '../parser/parser.js';
import { PlacitumErrorBase } from '../shared/errors.js';
import type { PlacitumError } from '../shared/errors.js';
import type { SerializedManifest } from '../shared/manifest.js';

// LSP contract (placitum-lsp-implementation.md §5.2) — the language server's
// single entry point into the core. Never throws on malformed input:
//   program   recovered AST when lexing is clean (failed statements are
//             dropped when parse diagnostics exist); null otherwise
//   manifest  extractor output, present only when diagnostics is empty
//   complete  no diagnostics at all — the only state where extract() runs
// Diagnostics gate each other: a lex error skips parsing, and a parse error
// skips extraction, so the server never reports cascades from a broken tree.
export interface AnalysisResult {
  program: Program | null;
  manifest: SerializedManifest | null;
  diagnostics: PlacitumError[];
  tokens: Token[];
  comments: CommentTrivia[];
  complete: boolean;
}

export function analyzeSource(source: string): AnalysisResult {
  const lexed = lexTolerant(source);
  const diagnostics = [...lexed.diagnostics];
  let program: Program | null = null;
  let manifest: SerializedManifest | null = null;
  if (diagnostics.length === 0) {
    const parsed = parseTolerant(lexed.tokens);
    diagnostics.push(...parsed.diagnostics);
    program = parsed.program;
    if (diagnostics.length === 0) {
      try {
        manifest = extract(parsed.program);
      } catch (err) {
        if (!(err instanceof PlacitumErrorBase)) throw err;
        diagnostics.push(err.toEnvelope());
      }
    }
  }
  return {
    program,
    manifest,
    diagnostics,
    tokens: lexed.tokens,
    comments: lexed.comments,
    complete: diagnostics.length === 0,
  };
}
