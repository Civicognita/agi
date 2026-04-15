# Federation & Identity

Aionima supports a federated identity system where every node is a sovereign identity provider. Entities get cryptographic identities, can carry their reputation across nodes, and visitors from other nodes can authenticate without creating local passwords.

---

## What is Federation?

Federation means multiple Aionima nodes can communicate with each other as peers. Each node:

- Issues its own cryptographic identities (no central authority required)
- Can verify identities from other nodes
- Shares impact scores and reputation across the network
- Allows visitors from other nodes to authenticate

Think of it like email: anyone can run their own server, but they can all talk to each other.

---

## Enabling Federation

Federation is opt-in. Add this to your `gateway.json`:

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

| Setting | Default | Purpose |
|---------|---------|---------|
| `enabled` | `false` | Turn federation on |
| `publicUrl` | auto | Your node's public URL (how other nodes reach you) |
| `seedPeers` | `[]` | URLs of nodes to connect to on startup |
| `autoGeid` | `true` | Automatically generate identity keys for new entities |
| `allowVisitors` | `true` | Allow users from other nodes to authenticate |

---

## Your Identity

When federation is enabled, every entity on your node gets a **GEID** (Global Entity ID) -- an Ed25519 cryptographic keypair. This gives each entity:

- A globally unique identifier derived from their public key
- The ability to sign statements that prove their identity
- A COA address like `#E0@#O0` (Entity 0 at Node 0)

The owner entity (you) is `#E0` -- the first entity created on the node. Your full address includes the node alias: `#E0@#O0`.

---

## Node Identity

Your node itself has an identity. When federation is enabled, it:

- Generates its own Ed25519 keypair
- Publishes a manifest at `/.well-known/mycelium-node.json`
- Can participate in peer handshakes with other nodes

The manifest advertises your node's capabilities, public key, and endpoint to other nodes.

---

## Sub-Users

You can create sub-user accounts on your node. Sub-users get:

- Their own entity with a GEID
- A COA address (e.g., `#E1@#O0`, `#E2@#O0`)
- Access to the dashboard (with role-based permissions)
- Impact tracking separate from yours

Create sub-users via the API:

```
POST /api/sub-users
{ "displayName": "Alice", "username": "alice", "password": "..." }
```

---

## Visitors

Visitors are users from other federated nodes. When a visitor arrives:

1. They present their GEID and home node ID
2. Your node issues a cryptographic challenge
3. They sign the challenge with their private key
4. Your node verifies the signature and creates a temporary session

No passwords are stored locally for visitors -- authentication is purely cryptographic.

---

## OAuth Identity Binding

Optionally connect OAuth providers (Google, GitHub) so users can link their social accounts to their entity:

```json
{
  "identity": {
    "oauth": {
      "github": {
        "clientId": "your-github-client-id",
        "clientSecret": "your-github-client-secret"
      }
    }
  }
}
```

This is for convenience -- your GEID is your primary identity, not your GitHub account.

---

## EntityMap (Portable Profile)

An EntityMap is a signed document that represents an entity's identity and reputation. It includes:

- Display name and entity type
- Verification tier and seal status
- Impact score summary
- Home node information
- Two signatures: the entity's own + the home node's endorsement

EntityMaps are cached by remote nodes and expire after 24 hours.

---

## Impact Federation

Impact interactions can track where they originated:

- `origin_node_id` -- which node the interaction came from
- `relay_signature` -- cryptographic proof from the originating node

This means your impact score is verifiable across the network.

---

## Current Status

Federation is new and evolving. At this stage:

- GEID generation works for all entities
- The node manifest is served at `/.well-known/mycelium-node.json`
- Sub-user creation and visitor challenge-response are functional
- Peer-to-peer handshake protocol is implemented but requires another node to test against
- OAuth identity binding is ready but requires registering OAuth apps with Google/GitHub

As a single-node setup, federation provides the identity infrastructure (GEIDs, addresses, sub-users) but cross-node features activate when you connect to peers.

---

## API Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/.well-known/mycelium-node.json` | GET | Node manifest |
| `/api/identity/:entityId` | GET | Entity identity info |
| `/api/identity/resolve/:geid` | GET | Resolve entity by GEID |
| `/api/auth/providers` | GET | List OAuth providers |
| `/api/auth/start/:provider` | POST | Start OAuth flow |
| `/api/auth/callback/:provider` | GET | OAuth callback |
| `/api/sub-users` | POST | Create sub-user |
| `/api/sub-users` | GET | List sub-users |
| `/api/visitor/challenge` | POST | Issue visitor challenge |
| `/api/visitor/verify` | POST | Verify visitor response |
| `/api/visitor/session` | GET | Check visitor session |
| `/mycelium/handshake` | POST | Peer handshake |
