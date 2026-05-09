# Federation & Identity System

Technical guide for the federated identity system — GEID keypairs, COA addresses, EntityMap, federation wiring, and the VM dev sandbox.

## Architecture Overview

Every Aionima node can be a sovereign identity provider. The system has five layers:

| Layer | Component | Location |
|-------|-----------|----------|
| Identity primitives | GEID keypairs, COA addresses | `packages/entity-model/src/geid.ts` |
| Portable profile | EntityMap (dual-signed) | `packages/entity-model/src/entity-map.ts` |
| Schema | 4 new tables + federation columns | `packages/entity-model/src/schema.sql.ts` |
| Local ID provider | Identity issuance, OAuth, visitor auth | `packages/gateway-core/src/identity-provider.ts` |
| Federation protocol | Mycelium handshake, ring announce, peer store | `packages/gateway-core/src/federation-*.ts` |

## Enabling Federation

Add to `gateway.json`:

```json
{
  "federation": {
    "enabled": true,
    "publicUrl": "https://your-node.example.com",
    "seedPeers": [],
    "autoGeid": true,
    "allowVisitors": true
  }
}
```

Optional OAuth (for local identity binding):

```json
{
  "identity": {
    "oauth": {
      "github": {
        "clientId": "...",
        "clientSecret": "..."
      },
      "google": {
        "clientId": "...",
        "clientSecret": "..."
      }
    }
  }
}
```

Config schemas are in `config/src/schema.ts` (`FederationConfigSchema`, `IdentityConfigSchema`).

## GEID (Global Entity ID)

Every entity automatically gets an Ed25519 keypair on creation. The GEID is derived from the public key:

```
geid:<base58-encoded-public-key>
```

- Generated in `EntityStore.createEntity()` via `generateEntityKeypair()`
- Stored in `geid_mappings` table (private key only for locally-owned entities)
- Source: `packages/entity-model/src/geid.ts`

### COA Address Format

```
<entity_alias>[.<agent_alias>]@<node_alias>
```

Examples:
- `#E0@#O0` — Entity 0 at node 0 (owner)
- `#E0.$A0@#O0` — Entity 0's agent at node 0
- `#E3@#O7` — Entity 3 visiting from node 7

Functions: `formatAddress()`, `parseAddress()` in `geid.ts`.

## Database Schema

### New tables (in `schema.sql.ts`)

| Table | Purpose |
|-------|---------|
| `geid_mappings` | GEID keypair storage per entity |
| `federation_peers` | Persistent peer storage (replaces in-memory Map) |
| `entity_map_cache` | Cached EntityMaps from remote nodes |
| `access_grants` | Access control for sub-users/visitors |

### Federation columns (via migration)

Added to `entities`: `geid`, `public_key_pem`, `home_node_id`, `federation_consent`
Added to `impact_interactions`: `origin_node_id`, `relay_signature`

Migration runs in `db.ts` via `FEDERATION_MIGRATIONS` — uses `ALTER TABLE` with try/catch for idempotency. SQL comments are stripped before splitting on `;` to prevent comment lines from swallowing statements.

## EntityMap (Portable Profile)

A dual-signed document that travels with an entity across nodes:

```typescript
interface EntityMap {
  geid: GEID;
  address: string;           // "#E0@#O0"
  displayName: string;
  entityType: string;
  verificationTier: string;
  impact: { totalImpScore, interactionCount, topWorkTypes };
  homeNode: { nodeId, endpoint, publicKey };
  signature: string;          // Entity's Ed25519 signature
  nodeEndorsement: string;    // Home node's counter-signature
  expiresAt: string;          // 24h TTL
}
```

Functions in `entity-map.ts`: `generateEntityMap()`, `verifyEntityMap()`, `isEntityMapExpired()`.

## API Endpoints

### Identity API (`identity-api.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/identity/:entityId` | Get entity identity info |
| GET | `/api/identity/resolve/:geid` | Resolve entity by GEID |
| GET | `/api/auth/providers` | List available OAuth providers |
| POST | `/api/auth/start/:provider` | Start OAuth flow |
| GET | `/api/auth/callback/:provider` | OAuth callback |

### Sub-User API (`sub-user-api.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/sub-users` | Create sub-user (tenant) |
| GET | `/api/sub-users` | List sub-users |
| POST | `/api/visitor/challenge` | Issue GEID challenge |
| POST | `/api/visitor/verify` | Verify challenge response |
| GET | `/api/visitor/session` | Verify visitor session |

### Federation endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/.well-known/mycelium-node.json` | Node manifest (no auth) |
| POST | `/mycelium/handshake` | Peer handshake |
| POST | `/mycelium/ring/announce` | Ring announce (trust >= 1) |
| GET | `/mycelium/identity/map/:geid` | Fetch EntityMap (trust >= 1) |

## Third-party API gateway (s149 unified pattern)

Aionima distinguishes **two provider classes** for any third-party API
the system integrates with. The class drives where the OAuth flow runs,
where credentials live, and where API calls happen.

| Class | Examples | OAuth happens at | Tokens live at | API calls happen at |
|-------|----------|------------------|----------------|---------------------|
| Public-client OAuth | GitHub | Local-ID | Local-ID `connections` | Node-side (just Bearer access_token; no `client_secret` needed) |
| Proxied | Plaid, Google, Discord, Stripe, Twilio, … | Hive-ID | Hive-ID `connections` (never leave) | Hive-ID `/api/proxy/<provider>/<endpoint>` (DToken-bearer auth from nodes) |

Memory rules driving this:

- `feedback_oauth_with_secret_routes_through_hive_id` — third-party APIs
  requiring a server-held `client_secret` OR a publicly-resolvable HTTPS
  URL (webhooks, OAuth redirects) route through Hive-ID. Local-ID's
  `id.ai.on` is LAN-only DNS — fundamentally cannot satisfy public-URL
  requirements.
- `feedback_localid_private_be_careful_what_ships_in_agi` — agi source
  becomes public; never hardcode owner-specific or per-deployment
  secrets there.
- `feedback_third_party_oauth_lives_in_localid` — narrowed scope
  post-cycle 215: applies to **public-client** OAuth (GitHub) only;
  proxied providers go to Hive-ID.

### Public-client class (GitHub)

GitHub uses RFC 8628 Device Authorization Grant — no `client_secret`
required at any step. Local-ID's `device-flow.ts:LOCAL_PROVIDERS = new
Set(["github"])` is the authoritative list. Flow:

1. Owner clicks Connect at Local-ID dashboard
2. Local-ID hits GitHub's `/login/device/code` with `GITHUB_CLIENT_ID`
   (a public value, baked into source)
3. Owner completes authorization on github.com using the user_code
4. Local-ID polls `/login/oauth/access_token` until it gets the token
5. access_token stored encrypted in Local-ID `connections.accessToken`
6. agi gateway broker call: `GET id.ai.on/api/auth/device-flow/token
   ?provider=github&role=owner` returns the decrypted access_token
7. agi attaches Bearer access_token + calls api.github.com directly

No Hive-ID involvement. agi holds the access_token only after the LAN
broker call (private-network gated; not stored agi-side).

### Proxied class — DToken model

Aionima nodes hold **DTokens** (delegation tokens) instead of raw
provider access_tokens. DTokens are 32-byte random bearers,
SHA-256-hashed at Hive-ID's `dtokens` table, mapping to a `connections`
row. They're scoped + revocable + carry an optional expiry. The plaintext
is returned ONCE at issuance (during OAuth completion) and stored
encrypted node-side; never retrievable from Hive-ID after.

DToken issuance happens at OAuth-completion paths in Hive-ID
(plaid-link/exchange-public-token, oauth/{google,discord}/callback). The
caller (Local-ID typically) receives the plaintext via the response body
+ stores it encrypted on `connections.dtoken`.

Validation: every `/api/proxy/<provider>/<endpoint>` call accepts the
DToken via `Authorization: Bearer dtok_…` or `X-DToken` header. Hive-ID
hashes + looks up the `dtokens` row → `connections` row → resolves the
`client_id`+`client_secret`+`access_token` → calls upstream → returns
mapped response.

### Plaid integration (s147 + s149 t624/t626/t627)

Plaid is **system-level for Aion** (registered globally to the agent's
tool palette so Aion can read bank accounts directly), with MApps as
secondary consumers via mini-agent auto-discovery. End-to-end:

```
┌──────────────────────────────────────┐                  ┌──────────────────────┐
│  Owner browser                        │                  │ Plaid                │
│  https://id.ai.on/dashboard           │  Plaid Link      │ (api.plaid.com)      │
│  "Connect Bank Account"               │ ◄──widget──┐     │                      │
└────────────┬─────────────────────────┘            │     └──────────┬───────────┘
              │  POST plaid-link/{create-link-token, │                ▲
              │   exchange-public-token}             │                │
              ▼                                      │                │
┌──────────────────────────────────────┐            │                │
│  Local-ID  (id.ai.on, LAN)            │            │                │
│  connections row                       │            │                │
│  role="plaid-item:<itemId>"            │            │                │
│  dtoken encrypted (AES-256-GCM)        │            │                │
└────────────┬─────────────────────────┘            │                │
              │  POST /api/oauth/plaid-link/<…>      │                │
              ▼                                      │                │ /link/token/create
┌──────────────────────────────────────┐            │                │ /item/public_token/exchange
│  Hive-ID  (cloud, public HTTPS)       │ ◄──user OAuth completion────┘ /accounts/get
│  connections row holds access_token   │ ─────────────────────────────► /transactions/get
│  providerSettings holds Plaid creds   │                                /accounts/balance/get
│  dtokens table maps DToken→connection │                                /identity/get
│  /api/proxy/plaid/<endpoint>          │                                /item/remove
└────────────▲─────────────────────────┘                                
              │  POST /api/proxy/plaid/<endpoint>?role=plaid-item:<id>
              │  Authorization: Bearer dtok_…
              │
┌──────────────────────────────────────┐
│  Local-ID /api/proxy/plaid/<endpoint> │
│  (private-network gated; forwards    │
│   DToken from connections.dtoken)    │
└────────────▲─────────────────────────┘
              │  POST /api/proxy/plaid/<endpoint>?role=plaid-item:<id>
              │
┌──────────────────────────────────────┐
│  agi gateway                          │
│  plugin-plaid-api (4 tools, system-   │
│  level; no creds, no Hive-ID URL,     │
│  no Plaid-specific config)            │
└──────────────────────────────────────┘
```

#### Hive-ID routes (`agi-hive-id/src/routes/oauth/plaid-link.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/oauth/plaid-link/create-link-token` | Issue Plaid `link_token` for browser widget |
| POST | `/api/oauth/plaid-link/exchange-public-token` | Exchange `public_token` → encrypted access_token + mint DToken |
| POST | `/api/proxy/plaid/<endpoint>` | Generic gateway proxy (DToken bearer); endpoints: `accounts-get`, `transactions-get`, `balance-get`, `identity-get`, `item-remove` |
| POST | `/webhook/plaid` | Webhook receiver (signature verification flagged as future-scope; sandbox+development tiers don't sign) |

`/api/proxy/plaid/*` lives at `agi-hive-id/src/services/proxy-gateway.ts`
+ `agi-hive-id/src/providers/proxy/plaid.ts` (the ProxyProviderDef).

#### Local-ID routes (`agi-local-id/src/routes/{plaid-link,proxy-forward}.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/plaid-link/create-link-token` | Forwards to Hive-ID (browser-side widget callback chain) |
| POST | `/api/auth/plaid-link/exchange-public-token` | Forwards to Hive-ID; receives DToken; stores encrypted on `connections.dtoken` |
| POST | `/api/auth/plaid-link/items/:itemId/remove` | Forwards proxy `item-remove` + drops local connection row |
| GET | `/api/auth/plaid-link/items` | Lists locally-mirrored connections (no Hive-ID round-trip) |
| POST | `/api/proxy/<provider>/<endpoint>` | Generic per-provider forwarding to Hive-ID's gateway with DToken bearer |

#### agi-side caller pattern (`plugin-plaid-api/src/index.ts`)

```ts
async function callLocalIdProxy<T>(endpoint: string, body: object, opts: {role: string}): Promise<T> {
  const base = process.env.LOCAL_ID_BASE_URL ?? "https://id.ai.on";
  const url = `${base}/api/proxy/plaid/${endpoint}?role=${encodeURIComponent(opts.role)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // …error handling that points user at id.ai.on/dashboard for re-link
  return (await res.json()) as T;
}

// Tool handler (e.g., plaid:list-accounts):
const data = await callLocalIdProxy<{accounts: PlaidAccount[]}>(
  "accounts-get", {}, { role: `plaid-item:${itemId}` }
);
```

agi never sees: PLAID_CLIENT_ID, PLAID_SECRET, Plaid access_tokens,
Hive-ID's URL (Local-ID is the only public-internet hop from agi's
perspective). Per `feedback_localid_private_be_careful_what_ships_in_agi`.

#### Multi-bank support: role-encoding

The `connections` table's existing unique index is `(user_id, provider,
role)`. For Plaid, encode the Plaid `item_id` into the `role` field as
`plaid-item:<itemId>`. One linked bank per row; unlimited banks per
user. **No schema migration needed.** The role-encoding is mirrored at
Hive-ID's `connections` table — both ends use the same convention.

#### Plaid-specific behaviors

- **`/item/remove` cleanup on disconnect** — Plaid requires server-side
  notification when a bank is unlinked. Local-ID forwards the proxy call
  via `/api/proxy/plaid/item-remove` + drops the local connection row.
  Hive-ID's gateway proxies to Plaid `/item/remove`. Cleanup is
  best-effort; local row drops even if Hive-ID call fails.
- **Webhooks** — Plaid pushes events (`TRANSACTIONS_UPDATED`,
  `ITEM_LOGIN_REQUIRED`, etc.) to a configured public HTTPS URL.
  Hive-ID hosts the receiver at `/webhook/plaid` (scaffold; signature
  verification flagged for follow-up). Production webhooks should stay
  disabled at the Plaid app level until JWS signature verification
  ships.
- **Reauth flow UI** — when an item gets `ITEM_LOGIN_REQUIRED`, dashboard
  should surface a reauth prompt. Future scope; mirrors the analogous
  GitHub flow.

### Generalizing to Google + Discord (s149 t625, pending)

Google and Discord adopt the same proxied-class pattern. Hive-ID already
handles the OAuth dance for both via authorization-code flow at
`/oauth/google/{start,callback}` + `/oauth/discord/{start,callback}` —
the cycle 215 unification flips the **token-transfer** step (which used
to hand raw access_tokens via the handoff mechanism) to **DToken
issuance**. Local-ID's existing `device-flow.ts:223-227` stubs (`501
not_implemented` for Google + Discord) get replaced with the same
proxy-forwarding shape.

Per-provider proxy definitions live at `agi-hive-id/src/providers/proxy/
{google,discord}.ts` (pending t625). Endpoints:

- Google: `gmail.users.messages.send`, `gmail.users.messages.list`,
  `calendar.events.list`, `calendar.events.insert`, `drive.files.list`,
  `drive.files.get`, `oauth2.userinfo.get`
- Discord: `users/@me`, `users/@me/guilds`, `channels/<id>/messages`

Both providers use Bearer `access_token` upstream (unlike Plaid's per-call
`client_id`+`secret`+`access_token` body). The ProxyProviderDef
abstraction handles either shape via the `buildRequest` transformer per
`agi-hive-id/src/services/proxy-gateway.ts`.

### When to use which class

If you're integrating a new third-party API:

1. **Does the API support public-client OAuth (no `client_secret`)?** If
   yes (RFC 8628 Device Authorization Grant or equivalent), it can run
   in Local-ID. Add to `LOCAL_PROVIDERS` at `device-flow.ts`.
2. **Otherwise it's proxied.** Add a ProxyProviderDef under
   `agi-hive-id/src/providers/proxy/<provider>.ts`, an OAuth-bootstrap
   route under `agi-hive-id/src/routes/oauth/<provider>.ts` (auth-code
   flow → use the existing `provider-factory.ts`; widget flow → custom
   like `plaid-link.ts`), a webhook receiver if applicable, and the
   agi-side plugin calls Local-ID's `/api/proxy/<provider>/<endpoint>`
   forwarding route.
3. **Always cite memory rules inline in code comments** — future agents
   need to know why GitHub is the exception, not the rule.

## Server Wiring

Federation components are initialized in `server.ts` (Step 3f) when `federation.enabled` is true:

1. `generateNodeKeypair()` — Ed25519 keypair for the node
2. `FederationPeerStore(db)` — SQLite-backed peer persistence
3. `FederationNode(config)` — node identity + manifest
4. `FederationRouter(node)` — handles `/mycelium/*` routes
5. `IdentityProvider(entityStore, federationNode)` — local ID management
6. `VisitorAuthManager({ sessionSecret })` — challenge-response auth
7. `OAuthHandler(config, baseUrl)` — Google/GitHub OAuth flows

Routes are registered in `server-runtime-state.ts` before the static file handler:
- `registerIdentityRoutes(fastify, deps)`
- `registerSubUserRoutes(fastify, deps)`
- `fastify.get("/.well-known/mycelium-node.json", ...)`
- `fastify.all("/mycelium/*", ...)` — delegates to `FederationRouter.handleRequest()`

## Files Reference

### Entity Model (`packages/entity-model/src/`)

| File | Purpose |
|------|---------|
| `geid.ts` | GEID generation, COA address format/parse |
| `entity-map.ts` | EntityMap generation, dual-signing, verification |
| `schema.sql.ts` | DDL for new tables + `FEDERATION_MIGRATIONS` |
| `db.ts` | Migration runner (comment-stripping, idempotent ALTER TABLE) |
| `store.ts` | `getByGeid()`, `getGeidMapping()`, `updateFederation()`, `getByAddress()` |
| `impact.ts` | `origin_node_id` / `relay_signature` tracking |

### Gateway Core (`packages/gateway-core/src/`)

| File | Purpose |
|------|---------|
| `federation-node.ts` | Node identity, manifest, peer management |
| `federation-router.ts` | Request routing + ring/announce, EntityMap endpoints |
| `federation-peer-store.ts` | SQLite-backed persistent peer storage |
| `federation-types.ts` | Ring protocol types, visitor auth types |
| `identity-provider.ts` | Local ID issuance, GEID binding, OAuth binding |
| `oauth-handler.ts` | Google/GitHub OAuth2 flows |
| `identity-api.ts` | Fastify routes for identity operations |
| `visitor-auth.ts` | GEID challenge-response authentication |
| `sub-user-api.ts` | Sub-user management routes |
| `server.ts` | Federation initialization (Step 3f) |
| `server-runtime-state.ts` | Route registration |

### Config (`config/src/`)

| File | Purpose |
|------|---------|
| `schema.ts` | `FederationConfigSchema`, `OAuthProviderSchema`, `IdentityConfigSchema` |
| `index.ts` | Re-exports `FederationConfig`, `IdentityConfig` |

## VM Dev Sandbox

Federation development uses the Multipass VM sandbox. This is critical for testing because federation involves database migrations, new API routes, and crypto operations that can break the production instance if shipped untested.

### Setup

```bash
sudo snap install multipass         # Install Multipass
./scripts/test-vm.sh create         # Launch VM
```

### Known VM Issues

**git safe.directory**: The mounted repo at `/mnt/agi` has different ownership than the `aionima` user created by `install.sh`. Before running `install.sh`, set:

```bash
multipass exec aionima-test -- sudo git config --system --add safe.directory /mnt/agi
multipass exec aionima-test -- sudo git config --system --add safe.directory /mnt/agi/.git
# Also for the aionima user specifically:
multipass exec aionima-test -- sudo -u aionima git config --global --add safe.directory /mnt/agi
multipass exec aionima-test -- sudo -u aionima git config --global --add safe.directory /mnt/agi/.git
```

**Native modules**: The clone from `/mnt/agi` copies host-compiled native binaries (`better-sqlite3`, `node-pty`). Rebuild inside the VM:

```bash
multipass exec aionima-test -- sudo -u aionima env HOME=/home/aionima bash << 'SCRIPT'
cd /home/aionima/_projects/agi
cd node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3
npm run build-release
cd /home/aionima/_projects/agi/node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty
npm run install
SCRIPT
```

**upgrade.sh fails**: `install.sh` calls `upgrade.sh` which expects `/opt/agi` to be a git repo. For VM testing, skip deploy and run directly from the cloned repo:

```bash
multipass exec aionima-test -- sudo -u aionima env HOME=/home/aionima bash << 'SCRIPT'
cd /home/aionima/_projects/agi
mkdir -p data
node cli/dist/index.js run
SCRIPT
```

### Testing federation endpoints in the VM

```bash
# Create config with federation enabled
multipass exec aionima-test -- sudo -u aionima tee /home/aionima/_projects/agi/gateway.json << 'EOF'
{
  "gateway": { "host": "0.0.0.0", "port": 3000 },
  "owner": { "displayName": "Test Owner" },
  "federation": {
    "enabled": true,
    "publicUrl": "http://localhost:3000",
    "seedPeers": [],
    "autoGeid": true,
    "allowVisitors": true
  }
}
EOF

# Start server and test
VM_IP=$(./scripts/test-vm.sh ip)
curl -s http://$VM_IP:3000/health
curl -s http://$VM_IP:3000/.well-known/mycelium-node.json
curl -s http://$VM_IP:3000/api/auth/providers
curl -s -X POST http://$VM_IP:3000/api/sub-users \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Alice","username":"alice","password":"test1234"}'
```

### Syncing uncommitted changes to the VM

The VM clones from the host mount at create time, but subsequent uncommitted changes need to be copied:

```bash
# Copy a specific changed file from mount
multipass exec aionima-test -- sudo -u aionima cp \
  /mnt/agi/packages/entity-model/src/db.ts \
  /home/aionima/_projects/agi/packages/entity-model/src/db.ts

# Then rebuild
multipass exec aionima-test -- sudo -u aionima env HOME=/home/aionima bash -c \
  'cd /home/aionima/_projects/agi && pnpm build'
```

Or commit + pull:

```bash
# On host
git add . && git commit -m "WIP"
# In VM
multipass exec aionima-test -- sudo -u aionima env HOME=/home/aionima bash -c \
  'cd /home/aionima/_projects/agi && git pull /mnt/agi main && pnpm build'
```
