import { Command, CommanderError } from 'commander';
import type { Guard } from '../capability/guard.js';
import { runSource } from '../evaluator/run.js';
import { readSourceFile } from '../host-bindings/index.js';
import type { HostBindings } from '../host-bindings/index.js';
import { extract } from '../capability/extractor.js';
import { lex } from '../lexer/lexer.js';
import { parse } from '../parser/parser.js';
import { CliError, PlacitumErrorBase } from '../shared/errors.js';
import { explain } from './explain.js';
import { formatError } from './format-error.js';

// Phase 9 (Section 11) — the 1.0 CLI surface: `run` and `explain`. runCli is
// the whole CLI minus process wiring (bin.ts owns process.argv/stdout/exitCode)
// so the release gate is testable in-process. Every failure that leaves this
// module is a PlacitumError rendered by the one Section 9.3 formatter.

export const VERSION = '1.0.0';

export interface CliIo {
  stdout: { write(text: string): void };
  stderr: { write(text: string): void };
  // Test/embedder seams; production defaults are the real file reader,
  // process.env, the real guard (built from the script's manifest) and the
  // real host bindings.
  readFile?: (path: string) => string;
  env?: Record<string, string | undefined>;
  guard?: Guard;
  hosts?: HostBindings;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Section 9.2: E601 is "input script path doesn't exist". Any read failure is
// reported under it (permission, directory, ...) with the real errno text —
// fail closed, and the message carries the truth.
function readScript(file: string, io: CliIo): { name: string; text: string } {
  try {
    return { name: file, text: (io.readFile ?? readSourceFile)(file) };
  } catch (err) {
    throw new CliError({
      code: 'E601_CLI_FILE_NOT_FOUND',
      message: `cannot read script "${file}": ${describe(err)}`,
      hint: 'Check the path; placitum reads the file before lexing it.',
    });
  }
}

export function runCli(argv: readonly string[], io: CliIo): number {
  const fail = (err: PlacitumErrorBase, source?: { name: string; text: string }): number => {
    io.stderr.write(formatError(err.toEnvelope(), source));
    return 1;
  };

  const program = new Command();
  program
    .name('placitum')
    .description('Capability-secure shell language')
    .version(VERSION)
    .exitOverride()
    .allowExcessArguments(false)
    .configureOutput({
      // Commander's own error text is suppressed: every failure below is
      // re-rendered as a Placitum envelope so stderr has exactly one shape.
      writeOut: (text: string): void => io.stdout.write(text),
      writeErr: (): void => undefined,
    });

  let parsed: { name: string; text: string } | null = null;
  const script = (file: string): { name: string; text: string } => (parsed ??= readScript(file, io));

  program
    .command('run')
    .description('Execute a .placitum script through the CapabilityGuard')
    .argument('<file>', 'path to the script')
    .action(function handleRun(file: string): void {
      const { text } = script(file);
      runSource(text, {
        env: io.env ?? process.env,
        ...(io.guard !== undefined ? { guard: io.guard } : {}),
        ...(io.hosts !== undefined ? { hosts: io.hosts } : {}),
      });
    });

  program
    .command('explain')
    .description('Show the capability manifest extracted from a script')
    .argument('<file>', 'path to the script')
    .action(function handleExplain(file: string): void {
      const { text } = script(file);
      io.stdout.write(explain(extract(parse(lex(text)))));
    });

  // Bare `placitum` shows help and succeeds; with any other word commander's
  // unknown-command path takes over (E602).
  if (argv.length === 0) {
    io.stdout.write(program.helpInformation());
    return 0;
  }

  try {
    program.parse([...argv], { from: 'user' });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help / --version already wrote their output through configureOutput.
      if (err.exitCode === 0) return 0;
      // Section 9.2: E602 covers unrecognized flags/subcommands and malformed
      // invocations (missing/excess arguments included).
      return fail(
        new CliError({
          code: 'E602_CLI_INVALID_FLAG',
          message: err.message,
          hint: 'See `placitum --help` for usage.',
        }),
      );
    }
    if (err instanceof PlacitumErrorBase) return fail(err, parsed ?? undefined);
    throw err; // a bug in placitum itself — crash loudly, do not disguise it
  }
}
