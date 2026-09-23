// Section 7 — exhaustiveness backstop. Every switch over a discriminated
// union ends in `default: return assertNever(x)`, never a bare default.
export function assertNever(x: never): never {
  throw new Error(`Unhandled node: ${JSON.stringify(x)}`);
}
