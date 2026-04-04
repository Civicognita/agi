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

VM_NAME="aionima-test"
VM_IMAGE="24.04"
VM_CPUS=2
VM_MEM="4G"
VM_DISK="20G"

# Detect paths: AGI repo dir and workspace root (parent of agi/)
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE_DIR="$(cd "$REPO_DIR/.." && pwd)"

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
    echo "VM '$VM_NAME' already exists."
    if ! vm_running; then
      echo "Starting stopped VM..."
      multipass start "$VM_NAME"
    fi
    echo "Use '$0 destroy' first for a fresh VM."
    cmd_status
    return 0
  fi

  echo "==> Creating VM '$VM_NAME' (${VM_IMAGE}, ${VM_CPUS} CPU, ${VM_MEM} RAM, ${VM_DISK} disk)..."

  # Write cloud-init to a snap-accessible location with readable permissions
  local cloud_init_file
  cloud_init_file="$HOME/aionima-cloud-init.yaml"
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
  mount_repo "$WORKSPACE_DIR/aionima-prime"        "/mnt/aionima-prime"       "PRIME"
  mount_repo "$WORKSPACE_DIR/aionima-local-id"     "/mnt/aionima-local-id"    "ID"

  echo "==> Waiting for cloud-init to finish..."
  multipass exec "$VM_NAME" -- cloud-init status --wait 2>/dev/null || true

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

  echo ""
  echo "Setup complete. Run '$0 test' or 'pnpm test' to run tests."
}

cmd_remount() {
  ensure_vm_running

  echo "==> Re-mounting workspace repos..."

  # Unmount any stale mounts first (ignore errors if not mounted)
  multipass umount "$VM_NAME":/mnt/agi 2>/dev/null || true
  multipass umount "$VM_NAME":/mnt/aionima-prime 2>/dev/null || true
  multipass umount "$VM_NAME":/mnt/aionima-local-id 2>/dev/null || true

  mount_repo "$REPO_DIR"                          "/mnt/agi"                 "AGI"
  mount_repo "$WORKSPACE_DIR/aionima-prime"        "/mnt/aionima-prime"       "PRIME"
  mount_repo "$WORKSPACE_DIR/aionima-local-id"     "/mnt/aionima-local-id"    "ID"

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

  echo "==> Installing PostgreSQL..."
  multipass exec "$VM_NAME" -- sudo apt-get install -y postgresql postgresql-client

  echo "==> Configuring PostgreSQL for password auth..."
  multipass exec "$VM_NAME" -- sudo bash -c '
    # Enable md5 auth for local TCP connections (default is peer which blocks password login)
    PG_HBA=$(find /etc/postgresql -name pg_hba.conf 2>/dev/null | head -1)
    if [ -n "$PG_HBA" ]; then
      sed -i "s/^host.*all.*all.*127.0.0.1\/32.*scram-sha-256/host all all 127.0.0.1\/32 md5/" "$PG_HBA"
      sed -i "s/^host.*all.*all.*127.0.0.1\/32.*peer/host all all 127.0.0.1\/32 md5/" "$PG_HBA"
      # Also ensure there IS a host line for 127.0.0.1
      grep -q "^host.*all.*all.*127.0.0.1" "$PG_HBA" || echo "host all all 127.0.0.1/32 md5" >> "$PG_HBA"
      systemctl restart postgresql
    fi
  '

  echo "==> Creating ID service database..."
  multipass exec "$VM_NAME" -- bash -c "sudo -u postgres psql -c \"CREATE USER aionima_id WITH PASSWORD 'testpass';\"" 2>/dev/null || true
  multipass exec "$VM_NAME" -- bash -c "sudo -u postgres psql -c \"CREATE DATABASE aionima_id OWNER aionima_id;\"" 2>/dev/null || true

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
EOF
systemctl restart caddy'

  echo "==> Adding /etc/hosts entries..."
  multipass exec "$VM_NAME" -- sudo bash -c '
    grep -q "ai.on id.ai.on" /etc/hosts || echo "127.0.0.1 ai.on id.ai.on db.ai.on" >> /etc/hosts
  '

  echo "==> Building ID service..."
  multipass exec "$VM_NAME" -- bash -c '
    cd /mnt/aionima-local-id
    npm install
    npm run build

    # Generate encryption key
    ENC_KEY=$(openssl rand -hex 32)

    cat > .env << ENVEOF
ID_SERVICE_MODE=local
AIONIMA_ID_BASE_URL=https://id.ai.on
PORT=4100
DATABASE_URL=postgres://aionima_id:testpass@localhost/aionima_id
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

    # Create minimal config
    mkdir -p ~/.agi
    cat > ~/.agi/aionima.json << CFGEOF
{
  "gateway": { "host": "0.0.0.0", "port": 3100, "state": "ONLINE" },
  "channels": [],
  "entities": { "path": "~/.agi/entities.db" },
  "identity": { "provider": "local-id", "baseUrl": "https://id.ai.on" },
  "workers": {}
}
CFGEOF
  '

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
    cd /mnt/aionima-local-id
    set -a && source .env && set +a
    nohup node dist/index.js > /tmp/aionima-local-id.log 2>&1 &
    echo $! > /tmp/aionima-local-id.pid
    sleep 2
    echo "  ID service PID: $(cat /tmp/aionima-local-id.pid)"
  '

  echo "==> Starting AGI gateway..."
  multipass exec "$VM_NAME" -- bash -c '
    cd /mnt/agi
    nohup node cli/dist/index.js run > /tmp/aionima.log 2>&1 &
    echo $! > /tmp/aionima.pid
    sleep 3
    echo "  AGI PID: $(cat /tmp/aionima.pid)"
  '

  echo "==> Checking health..."
  multipass exec "$VM_NAME" -- bash -c '
    sleep 2
    echo "  AGI:  $(curl -sk https://ai.on/health 2>/dev/null || echo "NOT RESPONDING")"
    echo "  ID:   $(curl -sk https://id.ai.on/health 2>/dev/null || echo "NOT RESPONDING")"
  '
}

cmd_services_stop() {
  ensure_vm_running
  multipass exec "$VM_NAME" -- bash -c '
    [ -f /tmp/aionima.pid ] && kill $(cat /tmp/aionima.pid) 2>/dev/null && rm /tmp/aionima.pid && echo "AGI stopped"
    [ -f /tmp/aionima-local-id.pid ] && kill $(cat /tmp/aionima-local-id.pid) 2>/dev/null && rm /tmp/aionima-local-id.pid && echo "ID stopped"
  '
}

cmd_services_status() {
  ensure_vm_running
  multipass exec "$VM_NAME" -- bash -c '
    echo "PostgreSQL: $(systemctl is-active postgresql)"
    echo "Caddy:      $(systemctl is-active caddy)"
    echo "AGI:        $([ -f /tmp/aionima.pid ] && kill -0 $(cat /tmp/aionima.pid) 2>/dev/null && echo "running (PID $(cat /tmp/aionima.pid))" || echo "stopped")"
    echo "ID:         $([ -f /tmp/aionima-local-id.pid ] && kill -0 $(cat /tmp/aionima-local-id.pid) 2>/dev/null && echo "running (PID $(cat /tmp/aionima-local-id.pid))" || echo "stopped")"
    echo ""
    echo "Health checks:"
    echo "  AGI:  $(curl -sk https://ai.on/health 2>/dev/null || echo "unreachable")"
    echo "  ID:   $(curl -sk https://id.ai.on/health 2>/dev/null || echo "unreachable")"
  '
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
  test-services)    cmd_test_services ;;
  help|--help|-h)
    echo "Usage: $0 {create|destroy|status|ssh|ip|setup|test|remount|exec|services-setup|services-start|services-stop|services-status|test-services}"
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
    ;;
  *)
    echo "Unknown command: $1" >&2
    echo "Run '$0 help' for usage." >&2
    exit 1
    ;;
esac
