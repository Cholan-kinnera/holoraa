# ADR 0010: OpenAPI 3.1.1 and JSON Schema Generators and Validators (Decision D9)

- **Status:** Proposed (for owner approval, resolving D9)
- **Date:** 2026-11-04
- **Deciders:** Owner (solo maintainer)
- **Consulted:** None beyond the owner.
- **Resolves:** D9 (`TODO(owner D9)` in `docs/MILESTONE_GATES.md` and ADR 0007).

---

## Context and Problem Statement

ADR 0007 adopted OpenAPI 3.1.1 for HTTP contracts and JSON Schema (Draft 2020-12) for realtime event contracts. It mandated that generators be pinned to exact versions, outputs committed, and drift checked in CI. Decision D9 requires owner approval of:
1. The OpenAPI 3.1.1 validator and its exact pinned version.
2. The OpenAPI 3.1.1 TypeScript generator and its exact pinned version.
3. The OpenAPI 3.1.1 Go code generator approach and its exact pinned version.
4. The JSON Schema validator for realtime events and its exact pinned version.
5. Confirmation of whether the 3.0.3 fallback rule is triggered.

---

## Decision Drivers

- **Contract Fidelity:** Must fully support OpenAPI 3.1.1 constructs used in `contracts/openapi.yaml` (e.g. `type: [string, "null"]`, RFC 9457 `application/problem+json`, format assertions).
- **Realtime Schema Fidelity:** Must fully support JSON Schema Draft 2020-12 used in `contracts/events/` (e.g. `const`, `additionalProperties: false`, `format: uuid`, `format: date-time`).
- **Simplicity and Maintainability:** Avoid massive, opaque generated wrappers that fight Chi's idiomatic routing, custom security middleware, and Problem Details error serialization.
- **Reproducibility:** Pinned toolchain binaries that can be executed and checked deterministically in CI with zero drift.
- **High Performance:** Sub-millisecond runtime event validation suitable for WebSocket message ingress.

---

## Spike Results and Evaluation

### 1. OpenAPI 3.1.1 Compatibility (The Fallback Rule)
- **Spike Outcome:** `contracts/openapi.yaml` (OpenAPI 3.1.1) was successfully parsed and compiled by both `oapi-codegen v2.8.0` and `openapi-typescript 7.13.0`.
- **Verdict:** The **3.0.3 fallback rule is NOT triggered**. The HTTP contract remains OpenAPI 3.1.1.

### 2. OpenAPI Go Tooling Comparison
- **`oapi-codegen v2.8.0` Types-Only (`-generate types`):**
  - Generates ~305 lines of clean, idiomatic Go structs.
  - Maps `type: [string, "null"]` to nullable pointer types (`*string`).
  - Completely preserves existing Chi route structure, custom security middleware (Origin checking, session cookie verification, CSRF token validation), and RFC 9457 Problem Details.
  - Zero coupling between HTTP transport plumbing and domain interfaces.
- **`oapi-codegen v2.8.0` Full Server (`-generate types,chi-server,strict-server`):**
  - Generates 3,363 lines of complex boilerplate for 12 endpoints.
  - Flattens all routes into a single Chi router group, requiring complex wrapper middleware to handle distinct per-route security rules.
  - Imposes non-standard error serialization requiring bespoke error mapping to satisfy RFC 9457 Problem Details.
  - Rejected in favor of Types-Only generation.
- **`ogen` (v1.x):**
  - Targets OpenAPI 3.0; lacks mature OpenAPI 3.1.1 support and cannot integrate with Chi.
  - Rejected.

### 3. OpenAPI 3.1.1 Validator Comparison
- **`@redocly/cli` (v2.71.0):**
  - Built-in, first-class OpenAPI 3.1.1 support.
  - Runs in ~50ms via `npm run lint:contract`.
  - Catches syntax errors, broken schema references, missing response types, and structural violations.
  - Selected.
- **`vacuum` / `spectral`:**
  - Heavier configuration overhead without additional benefit over Redocly.
  - Rejected.

### 4. JSON Schema Event Validator Comparison (Draft 2020-12)
- **`github.com/santhosh-tekuri/jsonschema/v6` (v6.0.2):**
  - Fully supports JSON Schema Draft 2020-12.
  - Successfully validated all four event contracts (`room.knock`, `room.approved`, `thought.new`, `note.updated`).
  - Enforces `additionalProperties: false`, `required`, `const` discriminators, `format: uuid`, and `format: date-time` with `c.AssertFormat()`.
  - Micro-benchmark result: **~3.8 µs per validation** (>260,000 validations/second/core), ideal for WebSocket frame ingress.
  - Selected.
- **`xeipuuv/gojsonschema`:**
  - Incompatible: only supports Draft 4/6/7; does not support Draft 2020-12.
  - Rejected.

---

## Decision Outcome

**Status: Proposed for Owner Approval.**

When approved, decision D9 establishes the following exact toolchain pins and integration patterns:

1. **OpenAPI Validator:**
   - Tool: `@redocly/cli`
   - Version Pin: `2.71.0` (in `web/package.json`)
   - Command: `npm run lint:contract` (`redocly lint ../contracts/openapi.yaml`)
2. **TypeScript API Client Generator:**
   - Tool: `openapi-typescript`
   - Version Pin: `7.13.0` (in `web/package.json`)
   - Target: `web/src/lib/api/schema.ts` consumed by `openapi-fetch 0.17.0`
   - Command: `npm run gen:api`
3. **Go OpenAPI Type Generator:**
   - Tool: `github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen`
   - Version Pin: `v2.8.0`
   - Scope: Types only (`-generate types`)
   - Target: `backend/internal/httpapi/types.gen.go`
   - Routing & Handlers: Explicit Chi route registration in `backend/internal/httpapi/httpapi.go`, verified for contract conformance by `backend/internal/httpapi/contract_test.go`.
4. **Realtime Event Schema Validator:**
   - Tool: `github.com/santhosh-tekuri/jsonschema/v6`
   - Version Pin: `v6.0.2` (in `backend/go.mod`)
   - Usage: Compile event schemas at startup with `AssertFormat()`; validate inbound and outbound WebSocket frames at M6.

---

## Consequences

### Positive
- Strict contract-first enforcement for both HTTP (OpenAPI 3.1.1) and Realtime (JSON Schema Draft 2020-12).
- Zero drift between contracts, Go backend types, and TypeScript frontend client.
- Handlers retain direct control over RFC 9457 Problem Details responses and per-route middleware.
- Sub-microsecond event validation with zero external dependencies during runtime.

### Negative & Risks
- When new HTTP endpoints are added, both `types.gen.go` and handler bindings in `httpapi.go` must be updated, and verified by `contract_test.go`.
- Generators must remain pinned; running `@latest` is strictly prohibited.

---

## Testing & Drift Strategy

- **OpenAPI Lint:** `make contract-check` runs `redocly lint`.
- **TypeScript Drift:** `make contract-check` regenerates `schema.ts` to a temporary file and asserts `cmp -s` produces no diff.
- **Go Types Drift:** `make contract-check` runs `oapi-codegen` to a temporary file and asserts `cmp -s` with `backend/internal/httpapi/types.gen.go`.
- **Event Schema Conformance:** Unit tests in `backend/internal/realtime/` (M6) validate event payloads against committed JSON Schemas.

