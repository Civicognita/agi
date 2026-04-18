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
