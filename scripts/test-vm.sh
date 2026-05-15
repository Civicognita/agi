#!/usr/bin/env bash
# Aionima VM lifecycle management for testing.
# Uses Multipass to create/destroy ephemeral Ubuntu VMs.
# Mounts all workspace repos (AGI, PRIME, local-ID) for full test coverage.
#
# Usage:
#   ./scripts/test-vm.sh create           # Launch fresh Ubuntu 24.04 VM with all repo mounts
#   ./scripts/test-vm.sh destroy          # Tear down the VM
#   ./scripts/test-vm.sh status           # Show VM status
#   ./scripts/test-vm.sh ssh              # SSH into the VM
#   ./scripts/test-vm.sh ip               # Print VM IP address
#   ./scripts/test-vm.sh setup            # Install Node 22 + pnpm, run pnpm install
#   ./scripts/test-vm.sh test             # Run vitest unit tests inside the VM
#   ./scripts/test-vm.sh exec CMD         # Run a command inside the VM
#   ./scripts/test-vm.sh services-setup   # Install PostgreSQL, Caddy, build+start ID & AGI
#   ./scripts/test-vm.sh services-start   # Start all services
#   ./scripts/test-vm.sh services-stop    # Stop all services
#   ./scripts/test-vm.sh services-status  # Show status of all services
#   ./scripts/test-vm.sh test-services    # Run service integration tests
set -euo pipefail

VM_NAME="agi-test"
VM_IMAGE="24.04"
VM_CPUS=4
# Memory bumped 8G → 12G (tynn #258). Full test suite + AGI gateway +
# Postgres + Caddy inside the VM routinely pushed past 8G during
# vitest runs, triggering OOM kills that showed up as "AGI service
# crashed mid-run" in the dashboard. 12G leaves headroom for the test
# worker + TS compile + pg checkpoints. Override via env if the host
# can't spare it: `VM_MEM=10G ./scripts/test-vm.sh create`.
VM_MEM="${VM_MEM:-12G}"
VM_CPUS="${VM_CPUS:-4}"
VM_DISK="${VM_DISK:-20G}"

# Structured JSON emitter for gateway streaming
emit_json() { echo "{\"phase\":\"$1\",\"status\":\"$2\",\"details\":\"${3:-}\"}"; }

# Detect paths: AGI repo dir and workspace root.
#
# Resolution order (Wish #25 fix, 2026-05-14):
#   1. $AGI_DEV_SOURCE env var (preferred — owner/agi-cli sets this)
#   2. dirname-based detection, with THREE possible shapes:
#      a. POST-t703 dev workspace: <ws>/_aionima/repos/<name>/
#         (script lives at <ws>/_aionima/repos/agi/scripts/test-vm.sh;
#          siblings are <ws>/_aionima/repos/prime, /id, /marketplace, ...)
#      b. PRE-t703 dev workspace: <ws>/_aionima/<name>/
#         (legacy flat layout; siblings are <ws>/_aionima/prime, /id, ...)
#      c. Ops / vanilla install: /opt/agi + /opt/agi-prime + /opt/agi-local-id
#         (dashed names under /opt)
#
# Use `-P` so symlinks get resolved — if this script is invoked via a
# symlinked path, we want the VM mounts anchored at the *physical*
# Dev-Mode workspace, NOT the user's scratchpad.

if [ -n "${AGI_DEV_SOURCE:-}" ] && [ -d "$AGI_DEV_SOURCE" ]; then
  # Env-var override (highest precedence).
  REPO_DIR="$(cd -P "$AGI_DEV_SOURCE" && pwd)"
else
  REPO_DIR="$(cd -P "$(dirname "$0")/.." && pwd)"
fi
WORKSPACE_DIR="$(cd -P "$REPO_DIR/.." && pwd)"
WORKSPACE_BASENAME="$(basename "$WORKSPACE_DIR")"

if [ "$WORKSPACE_BASENAME" = "repos" ] && [ "$(basename "$(dirname "$WORKSPACE_DIR")")" = "_aionima" ]; then
  # Shape (a): POST-t703 dev workspace. Siblings live alongside agi/
  # inside _aionima/repos/.
  PRIME_PATH="$WORKSPACE_DIR/prime"
  ID_PATH="$WORKSPACE_DIR/id"
elif [ "$WORKSPACE_BASENAME" = "_aionima" ]; then
  # Shape (b): PRE-t703 dev workspace (legacy flat layout). Siblings
  # under _aionima/ directly.
  PRIME_PATH="$WORKSPACE_DIR/prime"
  ID_PATH="$WORKSPACE_DIR/id"
else
  # Shape (c): Ops / vanilla install. Dashed names under the parent.
  PRIME_PATH="$WORKSPACE_DIR/agi-prime"
  ID_PATH="$WORKSPACE_DIR/agi-local-id"
fi

# Cloud-init: install Node 22, pnpm, and build deps so the VM is ready faster
CLOUD_INIT=$(cat <<'YAML'
#cloud-config
package_update: true
packages:
  - git
  - curl
  - ca-certificates
  - build-essential
  - python3
  - postgresql
  - postgresql-client
runcmd:
  - curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  - apt-get install -y nodejs
  - corepack enable pnpm
  # Pre-create the aionima user with passwordless sudo so install.sh and
  # Playwright browser installs work without a terminal
  - useradd -m -s /bin/bash aionima || true
  - echo "aionima ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/aionima
  - chmod 0440 /etc/sudoers.d/aionima
YAML
)

ensure_multipass() {
  if ! command -v multipass &>/dev/null; then
    echo "Error: multipass is not installed." >&2
    echo "Install with: sudo snap install multipass" >&2
    exit 1
  fi
}

vm_exists() {
  multipass info "$VM_NAME" &>/dev/null 2>&1
}

vm_running() {
  local state
  state=$(multipass info "$VM_NAME" --format csv 2>/dev/null | tail -1 | cut -d',' -f2)
  [[ "$state" == "Running" ]]
}

ensure_vm_running() {
  ensure_multipass
  if ! vm_exists; then
    echo "Error: VM '$VM_NAME' does not exist. Run '$0 create' first." >&2
    exit 1
  fi
  if ! vm_running; then
    echo "Error: VM '$VM_NAME' is not running. Run '$0 create' to start it." >&2
    exit 1
  fi
}

mount_repo() {
  local host_path="$1"
  local vm_mount="$2"
  local name="$3"

  if [ ! -d "$host_path" ]; then
    echo "  Warning: $name not found at $host_path — skipping mount"
    return 0
  fi

  echo "  Mounting $name → $vm_mount"
  multipass mount "$host_path" "$VM_NAME":"$vm_mount" 2>/dev/null || {
    echo "  Warning: mount failed for $name. Tests requiring $name may fail."
  }
}

cmd_create() {
  ensure_multipass

  if vm_exists; then
    emit_json "create" "skip" "VM already exists"
    echo "VM '$VM_NAME' already exists."
    if ! vm_running; then
      echo "Starting stopped VM..."
      multipass start "$VM_NAME"
    fi
    cmd_status
    return 0
  fi

  emit_json "create" "start" "Creating VM (${VM_IMAGE}, ${VM_CPUS} CPU, ${VM_MEM} RAM)"
  echo "==> Creating VM '$VM_NAME' (${VM_IMAGE}, ${VM_CPUS} CPU, ${VM_MEM} RAM, ${VM_DISK} disk)..."

  # Write cloud-init to a snap-accessible location with readable permissions
  local cloud_init_file
  cloud_init_file="$HOME/agi-cloud-init.yaml"
  echo "$CLOUD_INIT" > "$cloud_init_file"
  chmod 644 "$cloud_init_file"

  multipass launch "$VM_IMAGE" \
    --name "$VM_NAME" \
    --cpus "$VM_CPUS" \
    --memory "$VM_MEM" \
    --disk "$VM_DISK" \
    --cloud-init "$cloud_init_file"

  rm -f "$cloud_init_file"

  echo "==> Mounting workspace repos..."
  mount_repo "$REPO_DIR"                          "/mnt/agi"                 "AGI"
  mount_repo "$PRIME_PATH"                        "/mnt/agi-prime"           "PRIME"
  mount_repo "$ID_PATH"                           "/mnt/agi-local-id"        "ID"

  echo "==> Waiting for cloud-init to finish..."
  multipass exec "$VM_NAME" -- cloud-init status --wait 2>/dev/null || true

  emit_json "create" "done" "VM ready"
  echo ""
  echo "VM ready. Run '$0 setup' to install dependencies."
  cmd_status
}

cmd_destroy() {
  ensure_multipass

  if ! vm_exists; then
    echo "VM '$VM_NAME' does not exist."
    return 0
  fi

  echo "==> Destroying VM '$VM_NAME'..."
  multipass delete "$VM_NAME" --purge
  echo "Done."
}

cmd_status() {
  ensure_multipass

  if ! vm_exists; then
    echo "VM '$VM_NAME' does not exist."
    return 1
  fi

  multipass info "$VM_NAME"
}

cmd_ssh() {
  ensure_multipass
  multipass shell "$VM_NAME"
}

cmd_ip() {
  ensure_multipass
  multipass info "$VM_NAME" --format csv | tail -1 | cut -d',' -f3
}

cmd_exec() {
  ensure_multipass
  multipass exec "$VM_NAME" -- "$@"
}

cmd_setup() {
  ensure_vm_running
  emit_json "setup" "start" "Installing dependencies"

  echo "==> Checking Node.js installation..."
  if ! multipass exec "$VM_NAME" -- node --version &>/dev/null; then
    echo "  Waiting for cloud-init to finish installing Node.js..."
    multipass exec "$VM_NAME" -- cloud-init status --wait 2>/dev/null || true

    if ! multipass exec "$VM_NAME" -- node --version &>/dev/null; then
      echo "Error: Node.js not available in VM after cloud-init." >&2
      echo "Try destroying and recreating the VM." >&2
      exit 1
    fi
  fi

  local node_ver
  node_ver=$(multipass exec "$VM_NAME" -- node --version)
  echo "  Node.js $node_ver"

  echo "==> Ensuring pnpm is available..."
  multipass exec "$VM_NAME" -- bash -c 'command -v pnpm &>/dev/null || corepack enable pnpm' || {
    echo "Error: Could not enable pnpm via corepack." >&2
    exit 1
  }

  local pnpm_ver
  pnpm_ver=$(multipass exec "$VM_NAME" -- pnpm --version)
  echo "  pnpm $pnpm_ver"

  echo "==> Running pnpm install in /mnt/agi..."
  multipass exec "$VM_NAME" -- bash -c 'cd /mnt/agi && pnpm install --frozen-lockfile'

  emit_json "setup" "done" "Dependencies installed"
  echo ""
  echo "Setup complete. Run '$0 test' or 'pnpm test' to run tests."
}

cmd_remount() {
  ensure_vm_running

  echo "==> Re-mounting workspace repos..."

  # Unmount any stale mounts first (ignore errors if not mounted)
  multipass umount "$VM_NAME":/mnt/agi 2>/dev/null || true
  multipass umount "$VM_NAME":/mnt/agi-prime 2>/dev/null || true
  multipass umount "$VM_NAME":/mnt/agi-local-id 2>/dev/null || true

  mount_repo "$REPO_DIR"                          "/mnt/agi"                 "AGI"
  mount_repo "$PRIME_PATH"                        "/mnt/agi-prime"           "PRIME"
  mount_repo "$ID_PATH"                           "/mnt/agi-local-id"        "ID"

  echo "Done."
}

cmd_test() {
  ensure_vm_running

  # Verify setup has been run (check for node_modules)
  if ! multipass exec "$VM_NAME" -- test -d /mnt/agi/node_modules; then
    echo "Error: Dependencies not installed in VM." >&2
    echo "Run '$0 setup' first." >&2
    exit 1
  fi

  echo "==> Running vitest inside VM..."
  multipass exec "$VM_NAME" -- bash -c \
    'cd /mnt/agi && AIONIMA_TEST_VM=1 npx vitest run'
}

cmd_services_setup() {
  ensure_vm_running
  emit_json "services" "start" "Setting up services"

  echo "==> Installing agi CLI symlink in VM..."
  # Install /usr/local/bin/agi → /mnt/agi/scripts/agi-cli.sh so the test
  # VM has the same CLI surface as a real host. `agi` inside the VM auto-
  # detects test-mode via is_test_vm() and branches behavior (upgrade
  # rebuilds from mount, no git pull). `agi test <pat>` becomes the
  # canonical test invocation both inside VM and from host.
  multipass exec "$VM_NAME" -- sudo ln -sf /mnt/agi/scripts/agi-cli.sh /usr/local/bin/agi
  multipass exec "$VM_NAME" -- sudo chmod +x /mnt/agi/scripts/agi-cli.sh /mnt/agi/scripts/agi-test.sh

  echo "==> Installing PostgreSQL..."
  multipass exec "$VM_NAME" -- sudo apt-get install -y postgresql postgresql-client

  echo "==> Configuring PostgreSQL for password auth..."
  multipass exec "$VM_NAME" -- bash -c 'sudo bash -c '"'"'
    PG_HBA=$(find /etc/postgresql -name pg_hba.conf 2>/dev/null | head -1)
    if [ -n "$PG_HBA" ]; then
      sed -i "s/^host.*all.*all.*127.0.0.1\/32.*scram-sha-256/host all all 127.0.0.1\/32 md5/" "$PG_HBA"
      sed -i "s/^host.*all.*all.*127.0.0.1\/32.*peer/host all all 127.0.0.1\/32 md5/" "$PG_HBA"
      grep -q "^host.*all.*all.*127.0.0.1" "$PG_HBA" || echo "host all all 127.0.0.1/32 md5" >> "$PG_HBA"
      systemctl restart postgresql
    fi
  '"'"''

  echo "==> Creating gateway database (agi_data)..."
  # Credentials must match @agi/db-schema default connection string
  # (postgres://agi:aionima@localhost:5432/agi_data) — see
  # packages/db-schema/src/client.ts. Previously used testpass + db `agi`,
  # which left the gateway unable to connect in test VMs.
  multipass exec "$VM_NAME" -- bash -c "sudo -u postgres psql -c \"CREATE USER agi WITH PASSWORD 'aionima';\"" 2>/dev/null || \
    multipass exec "$VM_NAME" -- bash -c "sudo -u postgres psql -c \"ALTER USER agi WITH PASSWORD 'aionima';\""
  multipass exec "$VM_NAME" -- bash -c "sudo -u postgres psql -c \"CREATE DATABASE agi_data OWNER agi;\"" 2>/dev/null || true

  echo "==> Pushing drizzle schema to agi_data..."
  # drizzle-kit push from ./drizzle-push.config.ts which points at the built
  # dist/*.js (the TS sources use NodeNext .js imports that drizzle-kit's CJS
  # loader can't resolve). Requires @agi/db-schema to have been built first.
  multipass exec "$VM_NAME" -- bash -lc '
    cd /mnt/agi
    pnpm --filter @agi/db-schema build >/dev/null 2>&1 || true
    cd packages/db-schema
    DATABASE_URL="postgres://agi:aionima@localhost:5432/agi_data" \
      pnpm exec drizzle-kit push --config=drizzle-push.config.ts --force 2>&1 | tail -5
  '

  echo "==> Installing Caddy..."
  multipass exec "$VM_NAME" -- bash -c '
    sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" | sudo tee /etc/apt/sources.list.d/caddy-stable.list
    sudo apt-get update && sudo apt-get install -y caddy
  '

  echo "==> Configuring VM Caddy (static — hosting disabled in test VM)..."
  # Test VM is its own "production" instance. Hosting is disabled so
  # hosting-manager doesn't regenerate the Caddyfile; the static file
  # below is the source of truth. The `ai.on, test.ai.on` combined block
  # lets the same gateway handle both internal (ai.on from inside the VM)
  # and external (test.ai.on from the host) requests via a single cert +
  # reverse-proxy. Host DNS handles routing test.ai.on → VM_IP.
  multipass exec "$VM_NAME" -- sudo bash -c 'cat > /etc/caddy/Caddyfile << '"'"'EOF'"'"'
{
    local_certs
    servers {
        protocols h1
    }
}

ai.on, test.ai.on {
    tls internal
    reverse_proxy localhost:3100
}

id.ai.on {
    tls internal
    reverse_proxy localhost:4100
}
EOF
systemctl restart caddy'

  echo "==> Adding /etc/hosts entries..."
  multipass exec "$VM_NAME" -- bash -c 'grep -q "ai.on" /etc/hosts || echo "127.0.0.1 ai.on id.ai.on db.ai.on test.ai.on" | sudo tee -a /etc/hosts > /dev/null'

  echo "==> Updating host DNS for test.ai.on → VM direct..."
  VM_IP=$(multipass info "$VM_NAME" --format csv | tail -1 | cut -d',' -f3)

  # test.ai.on is the VM's own production hostname served by the VM's
  # own Caddy. Host DNS points directly at the VM IP — no host-side
  # Caddy proxying needed. This is architecturally correct: the VM is
  # a self-contained "production" instance, not a sub-route of the host
  # gateway. LAN clients that need to reach test.ai.on must either
  # query this host's dnsmasq or add a /etc/hosts entry themselves.
  sudo sed -i '/test\.ai\.on/d' /etc/dnsmasq.d/ai-on.conf
  echo "address=/test.ai.on/$VM_IP" | sudo tee -a /etc/dnsmasq.d/ai-on.conf
  sudo systemctl restart dnsmasq
  echo "    test.ai.on → $VM_IP (direct to VM Caddy)"

  # No host-Caddy test.ai.on stanza — DNS points straight at the VM and
  # the VM's own Caddy serves test.ai.on. Clean up any legacy stanza from
  # pre-2026-04-24 test-vm setups (which used the host as a reverse proxy
  # to the VM — architecturally wrong; VM is self-contained).
  sudo sed -i '/^test\.ai\.on {/,/^}/d' /etc/caddy/Caddyfile 2>/dev/null || true

  # Reload Caddy if it's running to pick up the stanza removal.
  if podman container exists agi-caddy >/dev/null 2>&1; then
    podman exec agi-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
      && echo "    host agi-caddy reloaded (legacy stanza removed)" \
      || echo "    WARN: agi-caddy reload failed; run 'agi doctor' to diagnose"
  elif sudo systemctl is-active --quiet caddy 2>/dev/null; then
    sudo systemctl reload caddy
    echo "    host systemd caddy reloaded (legacy stanza removed)"
  else
    echo "    host Caddy not present — not required now that DNS points direct at VM"
  fi

  echo "==> Building ID service..."
  multipass exec "$VM_NAME" -- bash -c '
    cd /mnt/agi-local-id
    npm install
    npm run build
    # Mirror the Dockerfile COPY step: tsc does not copy HTML views to dist/
    mkdir -p dist/views && cp src/views/*.html dist/views/

    # Generate encryption key
    ENC_KEY=$(openssl rand -hex 32)

    cat > .env << ENVEOF
ID_SERVICE_MODE=local
AIONIMA_ID_BASE_URL=https://id.ai.on
PORT=4100
DATABASE_URL=postgres://agi:testpass@localhost/agi
ENCRYPTION_KEY=$ENC_KEY
OWNER_NODE_URL=http://localhost:3100
ENVEOF

    # Run migrations
    set -a && source .env && set +a
    npx drizzle-kit migrate
  '

  echo "==> Building AGI..."
  multipass exec "$VM_NAME" -- bash -c '
    cd /mnt/agi
    pnpm install
    pnpm build

    # Create minimal config with absolute paths
    mkdir -p ~/.agi
    cat > ~/.agi/gateway.json << CFGEOF
{
  "gateway": { "host": "0.0.0.0", "port": 3100, "state": "ONLINE" },
  "channels": [],
  "entities": { "path": "$HOME/.agi/entities.db" },
  "idService": {
    "dir": "/mnt/agi-local-id",
    "local": {
      "enabled": true,
      "port": 4100,
      "subdomain": "id",
      "databaseUrl": "postgres://agi:testpass@localhost/agi",
      "postgresContainer": false
    }
  },
  "workers": {}
}
CFGEOF
  '

  echo "==> Writing onboarding state (skip onboarding for test VM)..."
  multipass exec "$VM_NAME" -- bash -c 'cat > ~/.agi/onboarding-state.json << OBEOF
{
  "firstbootCompleted": true,
  "steps": {
    "aiKeys": "completed",
    "aionimaId": "completed",
    "ownerProfile": "completed",
    "channels": "completed",
    "zeroMeMind": "completed",
    "zeroMeSoul": "completed",
    "zeroMeSkill": "completed"
  },
  "completedAt": "2026-03-07T00:00:00.000Z"
}
OBEOF'

  emit_json "services" "done" "Services setup complete"
  echo "==> Services setup complete."
  echo "    Run '$0 services-start' to start all services."
}

cmd_services_start() {
  ensure_vm_running

  echo "==> Starting PostgreSQL..."
  multipass exec "$VM_NAME" -- sudo systemctl start postgresql

  echo "==> Starting Caddy..."
  multipass exec "$VM_NAME" -- sudo systemctl start caddy

  echo "==> Starting ID service..."
  # Auto-generate .env at ~/.agi/agi-local-id/.env — per CLAUDE.md § 9,
  # runtime config lives under ~/.agi/, NEVER in the source-mount root
  # (/mnt/agi-local-id is mapped from the source repo and shouldn't carry
  # deployment secrets). DATABASE_URL points at the agi-owned agi_data DB
  # on the VM's local Postgres (per .env.example). ENCRYPTION_KEY is
  # generated fresh on first run — test VM sessions reset on restart so
  # rotating per fresh boot is fine.
  multipass exec "$VM_NAME" -- bash -c '
    ENV_DIR="$HOME/.agi/agi-local-id"
    ENV_FILE="$ENV_DIR/.env"
    mkdir -p "$ENV_DIR"
    if [ ! -f "$ENV_FILE" ]; then
      echo "  .env absent at $ENV_FILE — generating test-VM defaults"
      ENC_KEY=$(node -e "console.log(require(\"crypto\").randomBytes(32).toString(\"hex\"))")
      cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgres://agi:aionima@localhost:5432/agi_data
ENCRYPTION_KEY=${ENC_KEY}
ID_SERVICE_MODE=local
PORT=4100
EOF
    fi
    cd /mnt/agi-local-id
    set -a && source "$ENV_FILE" && set +a
    nohup node dist/index.js > /tmp/agi-local-id.log 2>&1 &
    echo $! > /tmp/agi-local-id.pid
    sleep 2
    echo "  ID service PID: $(cat /tmp/agi-local-id.pid)"
  '

  echo "==> Starting AGI gateway..."
  # AIONIMA_TEST_VM=1 marks this gateway process as "running inside the test
  # VM" — gates test-only endpoints (e.g. /api/services/circuit-breakers/
  # force-trip from s143 t573) so production gateways never expose them
  # even on a private network.
  multipass exec "$VM_NAME" -- bash -c '
    if [ ! -f /mnt/agi/cli/dist/index.js ]; then
      echo "  ERROR: cli/dist/index.js not found — run services-setup or pnpm build on host first"
      exit 1
    fi
    cd /mnt/agi
    nohup env AIONIMA_TEST_VM=1 node cli/dist/index.js run > /tmp/agi.log 2>&1 &
    echo $! > /tmp/agi.pid
    sleep 3
    echo "  AGI PID: $(cat /tmp/agi.pid)"
  '

  # Ensure Ollama is running. The initial qwen2.5:3b pull (~1.9 GB) is kicked
  # off in the background so services-start returns quickly — callers that need
  # the model should poll /api/tags until it appears. Idempotent: the install
  # and pull are both skip-if-present.
  echo "==> Ensuring Ollama is running..."
  multipass exec "$VM_NAME" -- bash -lc '
    if ! which ollama >/dev/null 2>&1; then
      echo "  Ollama not installed — installing (may take a minute)..."
      timeout 120 bash -c "curl -fsSL https://ollama.com/install.sh | sh" >/dev/null 2>&1 \
        || { echo "  WARN: Ollama install timed out or failed — skipping"; exit 0; }
    fi
    sudo systemctl enable --now ollama >/dev/null 2>&1 || true
    for i in 1 2 3 4 5; do
      curl -s --max-time 3 -o /dev/null http://127.0.0.1:11434/api/tags && break
      sleep 2
    done
    if ! ollama list 2>/dev/null | grep -q "qwen2.5:3b"; then
      echo "  qwen2.5:3b absent — pulling in background (1.9 GB, see /tmp/ollama-pull.log)"
      nohup ollama pull qwen2.5:3b >/tmp/ollama-pull.log 2>&1 &
      echo "  pull PID: $!"
    fi
    echo "  ollama: $(systemctl is-active ollama 2>/dev/null || echo unknown) · models: $(ollama list 2>/dev/null | tail -n +2 | awk "{print \$1}" | paste -sd, - || echo none)"
  '

  # Seed the owner entity so chat:send doesn't error "Owner not configured".
  # Uses the onboarding-api endpoint which creates ~/.agi/gateway.json's
  # owner block + registers with ID service (non-fatal if ID is down).
  # We also need owner.channels.telegram so server.ts loads ownerEntityId
  # from the entity store (otherwise ownerEntityId is undefined and
  # chat:send short-circuits with "Owner not configured" per server.ts:2486).
  echo "==> Seeding owner entity for chat tests + disabling hosting..."
  multipass exec "$VM_NAME" -- bash -lc '
    GW=http://127.0.0.1:3100
    curl -s -X POST $GW/api/onboarding/owner-profile \
      -H "Content-Type: application/json" \
      -d "{\"displayName\":\"Wishborn\",\"dmPolicy\":\"open\"}" >/dev/null 2>&1
    python3 - << "PYEOF"
import json, os
p = os.path.expanduser("~/.agi/gateway.json")
cfg = json.load(open(p))
cfg.setdefault("owner", {})
cfg["owner"]["channels"] = {"telegram": "owner-0"}
# Test VM is NOT hosting user projects — disable so hosting-manager does
# not regenerate the Caddyfile and wipe the static ai.on/test.ai.on blocks.
cfg.setdefault("hosting", {})["enabled"] = False
# Default boot state is OFFLINE per server.ts. The test VM needs ONLINE to
# actually invoke the LLM; without it, chat:send short-circuits with
# "Aionima is currently offline." (the empirical t326 probe surfaced this:
# all chat replies returned the placeholder until gateway.state=ONLINE was
# set in config).
cfg.setdefault("gateway", {})["state"] = "ONLINE"
json.dump(cfg, open(p, "w"), indent=2)
print("    owner + hosting + state seeded: state=" + cfg["gateway"]["state"] + " hosting.enabled=" + str(cfg["hosting"]["enabled"]))
PYEOF
  '

  # Wire the gateway to Ollama with costMode=local for Phase 10 acceptance
  # (#323). Hot-config-reloaded — no restart required to pick up. Idempotent.
  echo "==> Wiring gateway for Ollama + local-only routing..."
  multipass exec "$VM_NAME" -- bash -lc '
    python3 - << "PYEOF"
import json, os
p = os.path.expanduser("~/.agi/gateway.json")
cfg = json.load(open(p)) if os.path.exists(p) else {}
cfg.setdefault("agent", {})
cfg["agent"]["provider"] = "ollama"
cfg["agent"]["model"] = "qwen2.5:3b"
cfg["agent"].setdefault("router", {})
cfg["agent"]["router"]["costMode"] = "local"
cfg["agent"]["router"]["escalation"] = False
cfg["ollama"] = {"baseUrl": "http://127.0.0.1:11434"}
json.dump(cfg, open(p, "w"), indent=2)
PYEOF
    echo "    agent.provider=ollama · agent.model=qwen2.5:3b · router.costMode=local"
  '

  echo "==> Checking health..."
  multipass exec "$VM_NAME" -- bash -c '
    sleep 2
    echo "  AGI:  $(curl -sk --connect-timeout 5 --max-time 10 https://ai.on/health 2>/dev/null || echo "NOT RESPONDING")"
    echo "  ID:   $(curl -sk --connect-timeout 5 --max-time 10 https://id.ai.on/health 2>/dev/null || echo "NOT RESPONDING")"
  '

  # Categorize the sample project fixtures so every official MApp has at
  # least one compatible project in the picker. Writes ~/.agi/{slug}/project.json
  # for the three fixtures whose category can't be inferred from content:
  # sample-ops (ops), sample-admin (administration), sample-monorepo (monorepo).
  # See tynn #312. Idempotent — overwrites existing configs with the same shape.
  echo "==> Categorizing sample project fixtures..."
  multipass exec "$VM_NAME" -- bash -lc '
    declare -A CATS
    CATS[sample-ops]="ops"
    CATS[sample-admin]="administration"
    CATS[sample-monorepo]="monorepo"
    for name in sample-ops sample-admin sample-monorepo; do
      slug="mnt-agi-test-fixtures-projects-$name"
      mkdir -p ~/.agi/$slug
      cat > ~/.agi/$slug/project.json << EOF
{
  "name": "$name",
  "createdAt": "2026-04-24T00:00:00.000Z",
  "category": "${CATS[$name]}"
}
EOF
    done
    echo "    seeded 3 category configs (ops, administration, monorepo)"
  '

  # Seed the 11 official MApps in the test VM so MApp-walk/render tests
  # have fixtures. Pull the marketplace catalog first, then POST install
  # for each app. Idempotent — subsequent boots re-POST and the server
  # short-circuits on already-installed entries. Implements alpha-stable-1
  # exit criterion #4 (tynn task #304).
  echo "==> Seeding official MApps from marketplace..."
  multipass exec "$VM_NAME" -- bash -lc '
    GW=http://127.0.0.1:3100
    for i in 1 2 3 4 5; do
      curl -s -o /dev/null -w "%{http_code}" $GW/api/system/stats | grep -q "200" && break
      sleep 2
    done
    curl -s -X POST $GW/api/mapp-marketplace/pull >/dev/null 2>&1 || true
    APPS=(admin-editor code-browser dashboard-viewer dev-workbench gallery media-studio mind-mapper ops-monitor project-analyzer reader runbook-editor)
    OK=0
    for app in "${APPS[@]}"; do
      if curl -s -X POST -H "Content-Type: application/json" \
          -d "{\"appId\":\"$app\",\"sourceId\":1}" \
          $GW/api/mapp-marketplace/install 2>/dev/null | grep -q "\"ok\":true"; then
        OK=$((OK + 1))
      fi
    done
    INSTALLED=$(curl -s $GW/api/dashboard/magic-apps | grep -o "\"id\":" | wc -l)
    echo "    installed: $INSTALLED / 11"
  '

  # Auto-exit safemode if boot landed in it. The test VM gets killed by
  # multipass abruptly more often than a dev host does, so every second
  # boot tends to start in safemode — which blocks mutation endpoints AND
  # redirects all routes to the Admin Dashboard, breaking e2e specs that
  # navigate to /projects, /magic-apps, etc. See tynn task #310.
  echo "==> Clearing safemode if active..."
  multipass exec "$VM_NAME" -- bash -c '
    for i in 1 2 3 4 5; do
      if curl -s -X POST http://127.0.0.1:3100/api/admin/safemode/exit 2>/dev/null | grep -q "\"ok\":true"; then
        echo "    safemode cleared"
        exit 0
      fi
      sleep 2
    done
    echo "    safemode endpoint did not respond — likely not in safemode"
  '
}

cmd_services_stop() {
  ensure_vm_running
  multipass exec "$VM_NAME" -- bash -c '
    # Write graceful shutdown marker so AGI does not enter safemode on next start
    mkdir -p ~/.agi
    echo "{\"version\":1,\"shutdownAt\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"reason\":\"sigterm\",\"pid\":$(cat /tmp/agi.pid 2>/dev/null || echo 0),\"projects\":[],\"models\":[]}" > ~/.agi/shutdown-state.json

    # AGI: SIGTERM → wait up to 5s for graceful exit → SIGKILL → verify port 3100
    # is released. Previous version did kill $(cat pid) without waiting, which
    # left stale processes bound to 3100 even after services-stop returned —
    # forcing manual force-kill cycles in dev workflows.
    if [ -f /tmp/agi.pid ]; then
      AGI_PID=$(cat /tmp/agi.pid)
      if kill -0 $AGI_PID 2>/dev/null; then
        kill $AGI_PID 2>/dev/null
        for i in 1 2 3 4 5; do
          if ! kill -0 $AGI_PID 2>/dev/null; then break; fi
          sleep 1
        done
        if kill -0 $AGI_PID 2>/dev/null; then
          echo "  AGI did not exit after 5s SIGTERM — sending SIGKILL"
          kill -9 $AGI_PID 2>/dev/null
          sleep 1
        fi
      fi
      rm -f /tmp/agi.pid
      # Belt-and-braces: any orphaned node process bound to the cli/dist entrypoint
      # (e.g. PID file mismatch from prior crash) gets cleaned too.
      sudo pkill -9 -f "node.*cli/dist/index" 2>/dev/null || true
      # Verify port 3100 is actually released before reporting stopped
      for i in 1 2 3 4 5; do
        if ! sudo ss -ltn 2>/dev/null | grep -q ":3100\b"; then break; fi
        sleep 1
      done
      if sudo ss -ltn 2>/dev/null | grep -q ":3100\b"; then
        echo "  WARN: AGI stopped but port 3100 still bound (may be a stale process)"
      else
        echo "AGI stopped"
      fi
    fi

    if [ -f /tmp/agi-local-id.pid ]; then
      ID_PID=$(cat /tmp/agi-local-id.pid)
      if kill -0 $ID_PID 2>/dev/null; then
        kill $ID_PID 2>/dev/null
        for i in 1 2 3; do
          if ! kill -0 $ID_PID 2>/dev/null; then break; fi
          sleep 1
        done
        kill -9 $ID_PID 2>/dev/null || true
      fi
      rm -f /tmp/agi-local-id.pid
      echo "ID stopped"
    fi
  '
}

cmd_services_status() {
  ensure_vm_running
  multipass exec "$VM_NAME" -- bash -c '
    echo "PostgreSQL: $(systemctl is-active postgresql)"
    echo "Caddy:      $(systemctl is-active caddy)"
    echo "AGI:        $([ -f /tmp/agi.pid ] && kill -0 $(cat /tmp/agi.pid) 2>/dev/null && echo "running (PID $(cat /tmp/agi.pid))" || echo "stopped")"
    echo "ID:         $([ -f /tmp/agi-local-id.pid ] && kill -0 $(cat /tmp/agi-local-id.pid) 2>/dev/null && echo "running (PID $(cat /tmp/agi-local-id.pid))" || echo "stopped")"
    echo ""
    echo "Health checks:"
    echo "  AGI:  $(curl -sk --connect-timeout 5 --max-time 10 https://ai.on/health 2>/dev/null || echo "unreachable")"
    echo "  ID:   $(curl -sk --connect-timeout 5 --max-time 10 https://id.ai.on/health 2>/dev/null || echo "unreachable")"
  '
}

cmd_services_restart() {
  ensure_vm_running
  echo "==> Stopping VM services..."
  cmd_services_stop
  echo "==> Starting VM services..."
  cmd_services_start
}

# Realign the test VM with the host's intended state in one shot:
# 1. Stop VM services (with proper kill + port-release verification)
# 2. Build the host (cli/dist + dashboard) so the VM's mounted source has
#    fresh artifacts — the VM runs `node cli/dist/index.js`, so a stale
#    cli/dist means stale-code runs even after restart.
# 3. Start VM services
# 4. Poll /health until the VM reports the host's version
# 5. Report aligned OR fail with a diagnostic
#
# Used after any host-side code change that should be reflected in the VM
# (committed or uncommitted). Replaces the prior cycle of stop → manual
# pnpm build → manual pkill if stale → start.
cmd_services_align() {
  ensure_vm_running
  echo "==> Aligning test VM with host source..."

  local host_version
  host_version=$(grep -m1 '"version"' "$REPO_DIR/package.json" 2>/dev/null | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
  [ -z "$host_version" ] && host_version="unknown"
  echo "    Host source version: ${host_version}"

  echo "==> Stopping VM services..."
  cmd_services_stop

  echo "==> Building host (cli/dist + dashboard)..."
  # set -o pipefail propagates pnpm build's exit status through the | tail -3
  # pipe. Without it, tail's success masks build failures, leaving cli/dist
  # stale silently (cycle 119 root cause: activity-summary route was added
  # cycle 105 but cli/dist hadn't been rebuilt since cycle 87 because every
  # services-align reported "build complete" on a failed/skipped build).
  if (cd "$REPO_DIR" && set -o pipefail && pnpm build 2>&1 | tail -3); then
    echo "    build complete"
  else
    echo "    WARN: build failed; VM will run whatever's in cli/dist now"
  fi

  echo "==> Starting VM services..."
  cmd_services_start

  echo "==> Polling /health until VM reports host version (${host_version})..."
  local vm_version waited=0
  while [ $waited -lt 30 ]; do
    vm_version=$(multipass exec "$VM_NAME" -- bash -c "curl -sk https://test.ai.on/health 2>/dev/null" 2>/dev/null \
      | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
      | tr -d '\r\n ')
    if [ "$vm_version" = "$host_version" ]; then
      break
    fi
    sleep 2
    waited=$((waited + 2))
  done

  if [ "$vm_version" != "$host_version" ]; then
    echo ""
    echo "    DRIFT: VM reports v${vm_version:-unreachable}, expected v${host_version}"
    echo "    Common causes:"
    echo "      - Stale process bound to port 3100 (try '$0 services-stop' again)"
    echo "      - Build failed silently (check 'cd $REPO_DIR && pnpm build')"
    echo "      - Mount stale (try 'multipass restart $VM_NAME')"
    return 1
  fi

  # In-VM /health passed but the host needs test.ai.on reachable too
  # (cycle 119 root cause: agi test --e2e fell back to VM IP and got
  # SSL_PROTOCOL_ERROR because Caddy's bound to test.ai.on, not the IP).
  echo "==> Polling test.ai.on reachability from host..."
  local host_check_waited=0
  while [ $host_check_waited -lt 30 ]; do
    if curl -sk -o /dev/null -w "%{http_code}" --connect-timeout 3 "https://test.ai.on/api/system/stats" 2>/dev/null | grep -q "^2"; then
      echo "    aligned: VM reports v${vm_version}, test.ai.on reachable from host"
      return 0
    fi
    sleep 2
    host_check_waited=$((host_check_waited + 2))
  done
  echo "    DRIFT: VM at v${vm_version} but test.ai.on unreachable from host"
  echo "      - Caddy may not have bound test.ai.on yet — wait + retry"
  echo "      - Verify host /etc/hosts maps test.ai.on to the VM IP"
  return 1
}

cmd_services_version() {
  ensure_vm_running

  local host_version vm_version
  host_version=$(grep -m1 '"version"' "$REPO_DIR/package.json" 2>/dev/null | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
  [ -z "$host_version" ] && host_version="unknown"

  vm_version=$(multipass exec "$VM_NAME" -- bash -c "curl -sk https://test.ai.on/health 2>/dev/null" 2>/dev/null \
    | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
    | tr -d '\r\n ')
  [ -z "$vm_version" ] && vm_version="unreachable"

  echo "Host source: ${host_version}"
  echo "VM running:  ${vm_version}"

  if [ "$vm_version" = "unreachable" ]; then
    echo ""
    echo "VM service is not reachable. Run '$0 services-start'."
    return 1
  fi

  if [ "$host_version" = "$vm_version" ]; then
    echo ""
    echo "VM is in sync with host source."
    return 0
  fi

  echo ""
  echo "VM is running stale code. Run '$0 services-restart' to pick up the latest."
  return 2
}

cmd_test_ui() {
  ensure_vm_running

  echo "==> Verifying test.ai.on is reachable..."
  if ! curl -sk --max-time 5 "https://test.ai.on/api/system/stats" >/dev/null 2>&1; then
    echo "Error: Gateway not reachable at https://test.ai.on" >&2
    echo "Run: $0 services-start" >&2
    exit 1
  fi

  echo "==> Running Playwright against test.ai.on..."
  cd "$REPO_DIR"
  BASE_URL="https://test.ai.on" npx playwright test "${@}"
}

cmd_test_services() {
  ensure_vm_running
  echo "==> Running service integration tests..."
  multipass exec "$VM_NAME" -- bash -c '
    PASS=0; FAIL=0

    check() {
      local name="$1" cmd="$2"
      if eval "$cmd" >/dev/null 2>&1; then
        echo "  PASS $name"
        PASS=$((PASS+1))
      else
        echo "  FAIL $name"
        FAIL=$((FAIL+1))
      fi
    }

    echo "Service health:"
    check "AGI health" "curl -sk https://ai.on/health | grep -q ok"
    check "ID health" "curl -sk https://id.ai.on/health | grep -q ok"

    echo ""
    echo "ID service local auth:"
    check "Dashboard (no login required)" "curl -sk -o /dev/null -w %{http_code} https://id.ai.on/dashboard | grep -q 200"
    check "Channels page" "curl -sk -o /dev/null -w %{http_code} https://id.ai.on/channels | grep -q 200"
    check "Connections API" "curl -sk https://id.ai.on/api/connections | grep -qv Unauthorized"

    echo ""
    echo "AGI dashboard:"
    check "Dashboard loads" "curl -sk -o /dev/null -w %{http_code} https://ai.on/ | grep -q 200"
    check "Projects API" "curl -sk https://ai.on/api/projects | grep -q projects"
    check "System connections" "curl -sk https://ai.on/api/system/connections | grep -q idService"

    echo ""
    echo "Cross-service:"
    check "AGI sees ID service" "curl -sk https://ai.on/api/system/connections | grep -q connected"
    check "ID iframe headers" "curl -sk -I https://id.ai.on/ | grep -qi frame-ancestors"

    echo ""
    echo "Results: $PASS passed, $FAIL failed"
    [ "$FAIL" -eq 0 ] || exit 1
  '
}

cmd_provision() {
  emit_json "provision" "start" "Full provisioning: create → setup → services-setup → services-start"
  cmd_create
  cmd_setup
  cmd_services_setup
  cmd_services_start
  emit_json "provision" "done" "Test VM fully provisioned — test.ai.on is ready"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
case "${1:-help}" in
  create)  cmd_create ;;
  destroy) cmd_destroy ;;
  status)  cmd_status ;;
  ssh)     cmd_ssh ;;
  ip)      cmd_ip ;;
  setup)   cmd_setup ;;
  test)    cmd_test ;;
  remount)          cmd_remount ;;
  exec)             shift; cmd_exec "$@" ;;
  services-setup)   cmd_services_setup ;;
  services-start)   cmd_services_start ;;
  services-stop)    cmd_services_stop ;;
  services-restart) cmd_services_restart ;;
  services-status)  cmd_services_status ;;
  services-version) cmd_services_version ;;
  services-align|align) cmd_services_align ;;
  provision)        cmd_provision ;;
  test-services)    cmd_test_services ;;
  test-ui)          cmd_test_ui "${@:2}" ;;
  help|--help|-h)
    echo "Usage: $0 {create|destroy|status|ssh|ip|setup|provision|test|remount|exec|services-setup|services-start|services-stop|services-restart|services-status|services-version|test-services|test-ui}"
    echo ""
    echo "Commands:"
    echo "  create           Launch a fresh Ubuntu ${VM_IMAGE} VM with all repo mounts"
    echo "  destroy          Tear down and purge the VM"
    echo "  status           Show VM info"
    echo "  ssh              Open a shell inside the VM"
    echo "  ip               Print the VM's IP address"
    echo "  setup            Install Node 22 + pnpm, run pnpm install in VM"
    echo "  test             Run vitest unit tests inside the VM"
    echo "  remount          Re-mount all workspace repos (fixes stale mounts)"
    echo "  exec             Run a command inside the VM"
    echo ""
    echo "Integration test stack:"
    echo "  services-setup   Install PostgreSQL + Caddy, build and configure ID service + AGI"
    echo "  services-start   Start all services (PostgreSQL, Caddy, ID service, AGI)"
    echo "  services-stop    Stop ID service and AGI background processes"
    echo "  services-restart Stop and start all services (fastest way to pick up host source changes)"
    echo "  services-status  Show status and health of all services"
    echo "  services-version Compare VM-running AGI version vs host source package.json (warns when stale)"
    echo "  services-align   Realign VM with host (stop → build → start → poll until version matches). Alias: align"
    echo "  test-services    Run service integration tests against the running stack"
    echo "  test-ui          Run Playwright UI tests against https://test.ai.on"
    ;;
  *)
    echo "Unknown command: $1" >&2
    echo "Run '$0 help' for usage." >&2
    exit 1
    ;;
esac
