# 0REALTALK — significance in Aionima

0REALTALK is the contextual learning language that Aionima agents ("0MINDs") use to compress knowledge, accountability, and impact into a tight symbolic form. It is not a programming language and not a markup format — it is a **natural-dialog language** extended with a small set of symbol switches and confidence markers that let the agent talk about its own certainty, its scope of responsibility, and the maturity of a claim.

This document captures why 0REALTALK matters to the gateway today, even though the generator and parser are still early-stage. For the spec itself, see the PRIME corpus entries listed below — PRIME is the source of truth.

---

## Source material in PRIME

| File | Role | Status |
|---|---|---|
| `aionima-prime/WIP/knowledge/0R-whitepaper.md` | The 0REALTALK whitepaper | DRAFT v0.1 |
| `aionima-prime/core/0TERMS.md` | LAW-status lexicon — 32 foundational terms | LAW v0.1 \|+.9\| |
| `aionima-prime/core/0WRITER.md` | Generator spec | prototype / alpha-spore.0.001 |
| `aionima-prime/core/0READER.md` | Parser spec | spec-only, stubs |
| `aionima-prime/core/0COA.md` | COA-as-0REALTALK reference | LAW |
| `aionima-prime/core/0SCALE.md` | Confidence / maturity scale | LAW |

PRIME is read-only at runtime. Do not copy these files into the gateway repo; link them by path.

---

## What 0REALTALK gives us

### 1. A packing grammar

Long prose flattens into compact bracketed forms without losing meaning. The canonical example from the whitepaper:

```
"Chain of Accountability scoped to upgrading core specs"
→ :(COA{upgrade-core-specs}):
```

`pack()` and `unpack()` are inverses. A competent agent — and any 0WRITER / 0READER — round-trips cleanly between the two.

### 2. A confidence and maturity scale

Every claim carries its own epistemic weight via markers defined in `0TERMS.md`:

| Marker | Meaning |
|---|---|
| `\|+.9\|` | Confidence 0.9 on the 0BOOL_SCALE — LAW-level |
| `?` | Uncertain / open question |
| `~` | Approximate / handwavy |
| `!` | Assertion of fact |
| `:` | Scope delimiter |
| `MUSING → THEORY → LAW` | Maturity progression |

Markers travel with the claim, so a downstream reader (human or agent) always knows whether they are being told a hunch, a tested hypothesis, or a settled invariant.

### 3. A ROOT-prefix namespace

The `0` prefix marks a term as ABSOLUTE / foundational — the ROOT meaning, independent of local dialect. `0TRUTH` means the same thing in every fork. This is what lets federation work across installs without shared vocabulary negotiation.

---

## Where 0REALTALK already lives in production

It would be fair to say 0REALTALK today is "99% spec, 1% wire format" — but that 1% is load-bearing:

- **COA fingerprints are 0REALTALK.** The format `$A0.#E0.@A0.C001` is a packed 0REALTALK expression: resource `$A0` operating on entity `#E0` via node `@A0` in chain `C001`. The packer/unpacker is `packages/coa-chain/src/format.ts`, which parses and validates these fingerprints per the 0REALTALK grammar today.
- **Impact accounting uses 0REALTALK maturity markers.** When the impact ledger records the confidence of a causal claim, it uses `|+.9|`-style markers from `0SCALE.md`.
- **Federation trust signals route through 0REALTALK-encoded COA scoping.** A node publishing "I attest to X under scope Y" does so in a 0REALTALK form that any receiver can parse without shared dialect.
- **Knowledge entries** (`aionima-prime/knowledge/0K-*.md`) follow 0REALTALK conventions in their internal cross-references — `#E0`, `@A0`, `$W1` notation appears directly in headers and bullets.

Everything else — full 0WRITER pack flows over arbitrary prose, full 0READER unpack across the entire lexicon — is **not yet implemented**. Those are Phase 2/3 of the 0WRITER spec, plus the entire 0READER spec, and are out of scope for alpha-stable-1.

---

## Why Aionima's scripting choice affects 0REALTALK

Phase 8 of the alpha-stable-1 sweep will select a secure embedded scripting language for Dev Workbench MApps (candidates: Lua, Starlark, Rhai, QuickJS, WASM, custom DSL). That decision directly constrains how efficient 0REALTALK packers and unpackers can be:

- The **runtime** of pack / unpack must survive inside the sandbox the MApp lives in. If the language can't parse structured text performantly, pack becomes a bottleneck.
- **Determinism** matters. A 0REALTALK packer has to round-trip identically — same input, same output, always. Languages without strict determinism (e.g. JS date leakage) make round-trips fragile.
- **Gas metering** — 0REALTALK expressions are sometimes unbounded in practice (a packed chain can reference many entities). The scripting language must allow the ADF to cap execution time without the script being able to defeat the cap.
- **Size** — 0WRITER / 0READER builds are likely to ship as part of every MApp that wants local pack/unpack. A 2 MB runtime is fine for a backend; less fine for a MApp that expects to launch in <100 ms.

Phase 8's decision document (`temp_core/_plans/dev-workbench-scripting.md`, attached to a future tynn story) will call out this constraint explicitly. The scripting-language choice is not independent of 0REALTALK.

---

## Scope for alpha-stable-1

Per the owner directive "do not worry about the 0REALTALK stuff for now, just document the significance":

- ✅ **In scope**: this document. Significance captured, source files linked, production surface identified, constraint-on-scripting-choice noted.
- ❌ **Out of scope**: implementing 0WRITER Phase 2/3, implementing 0READER, unifying the COA fingerprint parser with a general 0REALTALK parser, packer/unpacker performance work.

A tynn task **"0REALTALK production implementation"** will be filed as post-alpha-stable-1 work when 0WRITER Phase 2/3 + 0READER implementation are ready to start.

---

## Related docs

- [adf.md](./adf.md) — the Agent Development Framework, which is where 0WRITER / 0READER would eventually plug in.
- [entity-model.md](./entity-model.md) — the COA / entity / impact chain that 0REALTALK encodes.
- [taskmaster.md](./taskmaster.md) — task orchestration is itself a 0REALTALK-adjacent protocol (scope-delimited, accountability-aware).
