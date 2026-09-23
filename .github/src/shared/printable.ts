// Strings that reach a human-facing rendering surface can legally contain
// control characters (`\n` is a source string escape, so a script can publish
// one; Phase 7 manifests are untrusted JSON). Rendered raw, they would inject
// lines indistinguishable from genuine output. Escape any control-bearing
// value instead of trusting it. Shared by `explain` (Phase 6) and the CLI
// error formatter (Phase 9).
export function printable(value: string): string {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return JSON.stringify(value);
  }
  return value;
}
