#!/usr/bin/env node
import { runCli } from './main.js';

// The only place the CLI touches the ambient process (Section 3 boundary:
// everything else is injectable through CliIo). `process.exitCode` rather than
// process.exit(): stdout/stderr stay flushable and the process exits naturally.
process.exitCode = runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
});
