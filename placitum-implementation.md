---
moc: "[[02-universidad/eif400-paradigmas-de-programación/moc|moc]]"
tags: []
---

title: Placitum Master Specification Document
status: Active / v1.0
tech_stack: TypeScript, Node.js (Strict Mode, Zero Any)
target_audience: Autonomous AI Coding Agents
---

# Placitum — Implementation Architecture & Build Plan

## 1. Project Philosophy & Core Constraints

Placitum is a security-first, capability-secure shell language. The core architectural constraint of this project is the **absolute isolation of effectful operations**. 

*   **Single Source of Truth:** The `CapabilityManifest` is the canonical data structure. It is extracted statically and consumed by *both* the `explain` renderer and the runtime `CapabilityGuard`. No parallel implementations are permitted.
*   **Zero Implicit Reachability:** I/O operations (file system, network, child processes) are strictly forbidden in the evaluator and standard library. The interpreter must not trust itself. 
*   **The Choke Point:** Node.js OS-level modules (`fs`, `child_process`, `net`, `http`) exist in exactly *one* directory (`/host-bindings`). Every standard library function is a thin wrapper that routes through an instantiated `CapabilityGuard`. If the guard denies the request, the syscall physically cannot execute.
*   **Defense-in-Depth:** Static verification (compile-time) proves coverage wherever possible. Runtime guarding (defense-in-depth) catches dynamic/computed values that bypass static checks.
*   **Type Safety as Security:** Use strict TypeScript discriminated unions with exhaustiveness checking (`strict: true`, default to `never`). The compiler must fail the build if an AST node is unhandled in the capability extractor or evaluator.

## 2. Architecture Diagram

```mermaid
flowchart TD
    A[Source Code .placitum] --> B[Lexer]
    B -->|Token Stream with line/col| C[Parser]
    C -->|AST: Discriminated Union| D[Static Capability Extractor]
    
    D -->|Pure extraction| E[(Capability Manifest)]
    
    E --> F[Explain Renderer]
    E --> G[CapabilityGuard]
    
    C -->|AST| H[Evaluator]
    H -->|Syscall Requests| G
    
    G -->|Authorized Syscalls| I[Host Bindings fs/net/exec]
    
    style E fill:#f9f,stroke:#333,stroke-width:2px
    style G fill:#f96,stroke:#333,stroke-width:2px
    style I fill:#f69,stroke:#333,stroke-width:2px
````

## 3. Directory Structure

Plaintext

```
/
├── ast/               # Pure data definitions for ASTNodes (Discriminated Unions).
├── capability/        # CapabilityExtractor (AST -> Manifest) and CapabilityGuard.
├── cli/               # CLI entrypoints (run, explain, audit, rewind).
├── evaluator/         # Tree-walking interpreter and environment closures.
├── host-bindings/     # THE ONLY MODULE ALLOWED TO IMPORT OS PRIMITIVES.
├── lexer/             # Hand-rolled character scanner.
├── parser/            # Recursive descent / Pratt parser.
├── stdlib/            # Builtin functions (wrap CapabilityGuard methods, no direct I/O).
└── tests/             # Golden files, negative tests, adversarial scripts.
```

**Architectural Import Boundary:** A CI lint rule must enforce that NO module outside of `/host-bindings` may import `fs`, `path`, `child_process`, `net`, `http`, or `os`.

## 4. Phased Build Plan

### Phase 0 — Scaffolding & Security-First Test Harness

- **Goal:** Establish the CI pipeline, import boundaries, and adversarial test corpus before writing language features.
    
      
    
- **Inputs/Outputs:** TypeScript configs, ESLint/Dependency rules -> Green CI build.
    
      
    
- **Critical Rules:** Define golden-file tests for `explain` outputs and a negative test suite (scripts that _must_ fail, e.g., path traversal `..`, overprivileged `net *`). Security is adversarially tested from commit #1.
    
      
    

### Phase 1 — Lexer

- **Goal:** Hand-rolled character scanner.
    
      
    
- **Inputs/Outputs:** `Source String` -> `Token[]`.
    
      
    
- **Critical Rules:** Every token must carry exact line/column metadata for error reporting. Must correctly handle stateful `f"{expr}"` string lexing (switching to expression mode and back), `#!` pragmas, and the load-bearing trailing `!` token.
    
      
    

### Phase 2 — Parser & AST

- **Goal:** Hand-rolled recursive descent (statements) and Pratt/precedence-climbing (expressions) parser.
    
      
    
- **Inputs/Outputs:** `Token[]` -> `ASTNode` (Strict Discriminated Union).
    
      
    
- **Critical Rules:** Grammar-level security enforcement. `needs` declarations are ONLY syntactically valid at the top of a script or the top of a function block. The parser must reject them elsewhere immediately.
    
      
    

### Phase 3 — Static Capability Extraction (Single Source of Truth)

- **Goal:** A pure, side-effect-free AST walk that generates the static manifest.
    
      
    
- **Inputs/Outputs:** `ASTNode` -> `CapabilityManifest`.
    
      
    
- **Critical Rules:** This phase does NO I/O. It identifies all effectful nodes (e.g., `fs.*`, `bang-calls`) and attempts to prove they are covered by in-scope `needs`. Dynamic paths/values that cannot be statically proven must be tagged as `deferred-to-runtime`.
    
      
    

### Phase 4 — CapabilityGuard (The Security Core)

- **Goal:** The runtime enforcer. A class instantiated per run exposing the _only_ entry points to OS bindings.
    
      
    
- **Inputs/Outputs:** `CapabilityManifest` + `Execution Requests` -> `Approved Payload` OR throws `CapabilityViolationError`.
    
      
    
- **Critical Rules:**
    
      
    1. Glob-to-regex matching must include path canonicalization (`realpath`) _before_ matching to defeat `../../etc/passwd` directory traversal.
        
          
        
    2. Network hosts default to exact string match; wildcards require explicit, restrictive parsing.
        
          
        
    3. Function attenuation (`needs only(TOKEN)`): The static checker must enforce that a child's manifest is a strict subset of its parent's. No lateral privilege escalation is allowed.
        
          
        

### Phase 5 — Tree-Walking Evaluator

- **Goal:** Visitor-pattern interpreter with lexical scoping.
    
      
    
- **Inputs/Outputs:** `ASTNode` + `Runtime Environment` -> `Execution Output`.
    
      
    
- **Critical Rules:** All standard library functions must call `CapabilityGuard` methods. `#!strict` must trigger a lightweight, side-effect-free type inference pass over pipe chains before evaluation begins.
    
      
    

### Phase 6 — placitum explain (Deterministic Mode)

- **Goal:** CLI tool to render the parsed capabilities into human-readable text.
    
      
    
- **Inputs/Outputs:** `CapabilityManifest` -> `Stdout String`.
    
      
    
- **Critical Rules:** Must execute instantly with zero network or file system calls. It strictly formats the output of Phase 3. It must clearly delineate static guarantees vs. `deferred-to-runtime` checks.
    
      
    

### Phase 7 — AI-Agent Mode (infer, audit, run --attenuate)

- **Goal:** Helper utilities for migrating and minimizing capabilities.
    
      
    
- **Inputs/Outputs:** Shell Scripts/Execution Traces -> Proposed `CapabilityManifest` Diffs.
    
      
    
- **Critical Rules:** LLM outputs are unconditionally treated as untrusted text. All LLM-generated code/manifests MUST be passed back through the Phase 2 parser and Phase 3 static verifier. The LLM never bypasses the compiler.
    
      
    

### Phase 8 — rewind (Replay Debugger)

- **Goal:** Append-only log of effectful I/O, allowing deterministic replay up to step N.
    
      
    
- **Inputs/Outputs:** `CapabilityGuard` Logs <-> `Replay Environment`.
    
      
    
- **Critical Rules:** Record external state content-hashes. On replay, verify external hashes before resuming live execution from step N. Loudly fail on state divergence; never silently replay against stale data.
    
      
    

### Phase 9 — CLI, Packaging, & Hardening

- **Goal:** Final binary generation and documentation.
    
      
    
- **Inputs/Outputs:** User CLI arguments -> System execution.
    
      
    
- **Critical Rules:** Maintain clear error UX. (Optional: Wrap final compiled binary in Deno OS-level permission flags as a secondary sandbox layer).

## 5. Data Structures Reference

The AI agent must adhere strictly to these TypeScript type shapes. Exhaustiveness checking must rely on the `kind` discriminator.

TypeScript

```
// AST Definition
type ASTNode =
  | NeedsDecl
  | LetStmt
  | FnDecl
  | PipeExpr
  | BangCall
  | IfStmt
  | WhileStmt
  | ForStmt
  | FStringExpr;

interface BaseNode {
  line: number;
  col: number;
}

interface NeedsDecl extends BaseNode {
  kind: 'NeedsDecl';
  // ... specific fields
}

interface FnDecl extends BaseNode {
  kind: 'FnDecl';
  id: string;
  body: ASTNode[];
  // ... specific fields
}

interface BangCall extends BaseNode {
  kind: 'BangCall';
  target: string;
  args: ASTNode[];
}

// ... definitions for other union members

// Capability Manifest Definition
type CapabilityManifest = {
  net: HostPattern[];
  fsRead: GlobPattern[];
  fsWrite: GlobPattern[];
  exec: string[];
  env: { name: string; optional: boolean }[];
  scoped: Map<string, CapabilityManifest>; // Maps FnId to its attenuated child manifest
};

type HostPattern = {
  type: 'exact' | 'wildcard';
  pattern: string;
};

type GlobPattern = {
  raw: string;
  regex: RegExp;
};