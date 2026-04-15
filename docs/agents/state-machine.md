# Gateway State Machine

The gateway's operational state is a **read-only status** computed from AGI's connection to Aionima-prime and Hive-ID. It is not a setting. Any UI or config surface that lets a user "pick" a state is a bug.

## States

| State | Meaning | Common causes |
|-------|---------|---------------|
| **Initial** / **Unknown** | Boot has not yet resolved the state. Transient. | Gateway just started; peer probes haven't returned. |
| **Limbo** | Running locally, but local COA<>COI has not been validated with the **0PRIME Schema**. The gateway can read/write local memory and Tynn MCP; remote sync and HIVE-level operations are disabled. | The current expected steady state for every running Aionima — because 0PRIME (the Hive mind) is not yet operational. |
| **Offline** | Either local-id or local-prime is unavailable. The gateway runs degraded: no identity, no PRIME lookups, no impact registration. | ID service container not running; PRIME corpus directory missing. |
| **Online** | Everything aligned: local identity is HIVE-registered, local PRIME mirrors 0PRIME, COA<>COI validates against 0PRIME Schema. | Future — reachable only when 0PRIME comes up. Not achievable today. |

## Capabilities by state

| State | `remoteOps` | `tynn` | `memory` | `deletions` |
|-------|-------------|--------|----------|-------------|
| Online | ✓ | ✓ | ✓ | ✓ |
| Limbo  | — | ✓ | ✓ | — |
| Offline | — | — | ✓ | — |
| Unknown | — | — | — | — |

Deletions are only allowed in `ONLINE` to prevent local deletions that then can't sync to PRIME.

## 0PRIME

**0PRIME** is the Hive mind of Aionima — the distributed AI substrate and Impactium blockchain. It holds the canonical schema that local COA<>COI chains validate against. 0PRIME is not yet operational, which is why every running Aionima is currently in Limbo. When 0PRIME is available and a node's local state validates, the state machine transitions to Online.

## API surface

- `GET /api/gateway/state` — returns `{ state, capabilities }`. Read-only.
- `GET /api/system/connections` — returns detailed per-peer breakdown (AGI / prime / workspace / idService). Dashboards use this for deeper diagnostics.
- `POST /api/gateway/restart` — graceful restart. Writes the shutdown marker, exits on SIGTERM, service supervisor brings the gateway back up.

## Dashboard surface

The Gateway card on Settings → Gateway → General shows the computed state as a colored pill and a **Restart gateway** button in place of what used to be a (misguided) "Initial State" select:

- **Limbo** — yellow pill
- **Offline** — red pill
- **Online** — green pill (future)
- **Initial** / **Unknown** — muted pill

The pill polls `GET /api/gateway/state` every 5 seconds while the settings page is open.

## Implementation

- Transition table + capabilities: `packages/gateway-core/src/state-machine.ts`.
- Boot-time initial value: `packages/gateway-core/src/server.ts` around line 327 (`new GatewayStateMachine(gw.state)`). The constructor argument is legacy — today the schema still accepts `gateway.state` for back-compat but it should be removed once all instances have migrated off. Follow-up: strip `state` from `GatewayConfigSchema` and pass `"UNKNOWN"` explicitly; the probes then drive all transitions.
- Peer probes that should drive transitions: `/api/system/connections` already does the probing work (see `idService` + `prime` status fields). Wiring probe results back into `stateMachine.transition(...)` is a separate refactor; right now state only changes when something inside the gateway explicitly calls `transition()`.

## Rule of thumb

When writing any code or UI that reads the state, treat it as a live computed value — never a stored config field. When writing any code that might "set" the state, think twice: only internal subsystems reacting to observable peer status should ever call `stateMachine.transition(...)`.
