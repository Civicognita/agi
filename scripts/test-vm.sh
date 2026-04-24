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

# Detect paths: AGI repo dir and workspace root (parent of agi/).
# Use `-P` so symlinks get resolved — if this script is invoked via a
# symlinked path (e.g. a user-workspace convenience link like
# ~/temp_core/agi → ~/_projects/_aionima/agi), we still want the VM
# mounts anchored at the *physical* Dev-Mode workspace, NOT the user's
# scratchpad. temp_core is the user's workspace, not AGI's.
REPO_DIR="$(cd -P "$(dirname "$0")/.." && pwd)"
WORKSPACE_DIR="$(cd -P "$REPO_DIR/.." && pwd)"

# Sibling layout detection: Dev-Mode provisioned workspace uses slugs
# (prime, id, marketplace, mapp-marketplace) under `_aionima/`. Ops /
# vanilla installs use the legacy dashed names (agi-prime, agi-local-id)
# under /opt. Pick the right set for mount sources.
if [ "$(basename "$WORKSPACE_DIR")" = "_aionima" ]; then
  PRIME_PATH="$WORKSPACE_DIR/prime"
  ID_PATH="$WORKSPACE_DIR/id"
else
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

  echo "==> Configuring Caddy..."
  multipass exec "$VM_NAME" -- sudo bash -c 'cat > /etc/caddy/Caddyfile << '"'"'EOF'"'"'
{
  local_certs
}

ai.on {
  tls internal
  reverse_proxy localhost:3100
}

id.ai.on {
  tls internal
  reverse_proxy localhost:4100
}

test.ai.on {
  tls internal
  reverse_proxy localhost:3100
}
EOF
systemctl restart caddy'

  echo "==> Adding /etc/hosts entries..."
  multipass exec "$VM_NAME" -- bash -c 'grep -q "ai.on" /etc/hosts || echo "127.0.0.1 ai.on id.ai.on db.ai.on test.ai.on" | sudo tee -a /etc/hosts > /dev/null'

  echo "==> Updating host DNS + Caddy for test.ai.on..."
  VM_IP=$(multipass info "$VM_NAME" --format csv | tail -1 | cut -d',' -f3)
  HOST_IP=$(hostname -I | awk '{print $1}')

  # DNS: point test.ai.on to the HOST (not VM) so LAN clients can reach it
  sudo sed -i '/test\.ai\.on/d' /etc/dnsmasq.d/ai-on.conf
  echo "address=/test.ai.on/$HOST_IP" | sudo tee -a /etc/dnsmasq.d/ai-on.conf
  sudo systemctl restart dnsmasq
  echo "    test.ai.on → $HOST_IP (host proxies to VM at $VM_IP)"

  # Caddy: add reverse proxy with offline fallback page
  # Remove existing block and re-create with correct VM IP
  sudo sed -i '/^test\.ai\.on {/,/^}/d' /etc/caddy/Caddyfile 2>/dev/null
  sudo sed -i "/# --- END CUSTOM ---/i\\
\\
test.ai.on {\\
    tls internal\\
    reverse_proxy $VM_IP:3100 {\\
        fail_duration 1s\\
    }\\
    handle_errors {\\
        rewrite * /test-vm-offline.html\\
        file_server {\\
            root /etc/caddy\\
        }\\
    }\\
}" /etc/caddy/Caddyfile

  # Install offline page if not present
  if [ ! -f /etc/caddy/test-vm-offline.html ]; then
    sudo cp "$REPO_DIR/containers/test-vm-offline.html" /etc/caddy/test-vm-offline.html 2>/dev/null || true
  fi

  # Reload Caddy — post-Story-#100 the host runs Caddy as a podman container
  # (rootless, owned by the invoking user). Fall back to systemd unit for
  # pre-#100 installs that still have the apt-managed caddy.service.
  if podman container exists agi-caddy >/dev/null 2>&1; then
    podman exec agi-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 \
      && echo "    Caddy proxy: test.ai.on → $VM_IP:3100 (via agi-caddy container)" \
      || echo "    WARN: agi-caddy reload failed; run 'agi doctor' to diagnose"
  elif sudo systemctl is-active --quiet caddy 2>/dev/null; then
    sudo systemctl reload caddy
    echo "    Caddy proxy: test.ai.on → $VM_IP:3100 (via systemd caddy)"
  else
    echo "    WARN: no host Caddy found (neither agi-caddy container nor systemd caddy); test.ai.on routing is incomplete"
  fi

  echo "==> Building ID service..."
  multipass exec "$VM_NAME" -- bash -c '
    cd /mnt/agi-local-id
    npm install
    npm run build

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
  multipass exec "$VM_NAME" -- bash -c '
    cd /mnt/agi-local-id
    set -a && source .env && set +a
    nohup node dist/index.js > /tmp/agi-local-id.log 2>&1 &
    echo $! > /tmp/agi-local-id.pid
    sleep 2
    echo "  ID service PID: $(cat /tmp/agi-local-id.pid)"
  '

  echo "==> Starting AGI gateway..."
  multipass exec "$VM_NAME" -- bash -c '
    cd /mnt/agi
    nohup node cli/dist/index.js run > /tmp/agi.log 2>&1 &
    echo $! > /tmp/agi.pid
    sleep 3
    echo "  AGI PID: $(cat /tmp/agi.pid)"
  '

  echo "==> Checking health..."
  multipass exec "$VM_NAME" -- bash -c '
    sleep 2
    echo "  AGI:  $(curl -sk https://ai.on/health 2>/dev/null || echo "NOT RESPONDING")"
    echo "  ID:   $(curl -sk https://id.ai.on/health 2>/dev/null || echo "NOT RESPONDING")"
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
    [ -f /tmp/agi.pid ] && kill $(cat /tmp/agi.pid) 2>/dev/null && rm /tmp/agi.pid && echo "AGI stopped"
    [ -f /tmp/agi-local-id.pid ] && kill $(cat /tmp/agi-local-id.pid) 2>/dev/null && rm /tmp/agi-local-id.pid && echo "ID stopped"
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
    echo "  AGI:  $(curl -sk https://ai.on/health 2>/dev/null || echo "unreachable")"
    echo "  ID:   $(curl -sk https://id.ai.on/health 2>/dev/null || echo "unreachable")"
  '
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
  services-status)  cmd_services_status ;;
  provision)        cmd_provision ;;
  test-services)    cmd_test_services ;;
  test-ui)          cmd_test_ui "${@:2}" ;;
  help|--help|-h)
    echo "Usage: $0 {create|destroy|status|ssh|ip|setup|provision|test|remount|exec|services-setup|services-start|services-stop|services-status|test-services|test-ui}"
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
    echo "  services-status  Show status and health of all services"
    echo "  test-services    Run service integration tests against the running stack"
    echo "  test-ui          Run Playwright UI tests against https://test.ai.on"
    ;;
  *)
    echo "Unknown command: $1" >&2
    echo "Run '$0 help' for usage." >&2
    exit 1
    ;;
esac
