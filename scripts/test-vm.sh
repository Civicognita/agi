#!/usr/bin/env bash
# Aionima VM lifecycle management for testing.
# Uses Multipass to create/destroy ephemeral Ubuntu VMs.
# Mounts all workspace repos (AGI, PRIME, ID) for full test coverage.
#
# Usage:
#   ./scripts/test-vm.sh create    # Launch fresh Ubuntu 24.04 VM with all repo mounts
#   ./scripts/test-vm.sh destroy   # Tear down the VM
#   ./scripts/test-vm.sh status    # Show VM status
#   ./scripts/test-vm.sh ssh       # SSH into the VM
#   ./scripts/test-vm.sh ip        # Print VM IP address
#   ./scripts/test-vm.sh setup     # Install Node 22 + pnpm, run pnpm install
#   ./scripts/test-vm.sh test      # Run vitest unit tests inside the VM
#   ./scripts/test-vm.sh exec CMD  # Run a command inside the VM
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
  mount_repo "$REPO_DIR"                          "/mnt/agi"           "AGI"
  mount_repo "$WORKSPACE_DIR/aionima-prime"        "/mnt/aionima-prime" "PRIME"
  mount_repo "$WORKSPACE_DIR/aionima-id"           "/mnt/aionima-id"    "ID"

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
  multipass umount "$VM_NAME":/mnt/aionima-id 2>/dev/null || true

  mount_repo "$REPO_DIR"                          "/mnt/agi"           "AGI"
  mount_repo "$WORKSPACE_DIR/aionima-prime"        "/mnt/aionima-prime" "PRIME"
  mount_repo "$WORKSPACE_DIR/aionima-id"           "/mnt/aionima-id"    "ID"

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
  remount) cmd_remount ;;
  exec)    shift; cmd_exec "$@" ;;
  help|--help|-h)
    echo "Usage: $0 {create|destroy|status|ssh|ip|setup|test|remount|exec}"
    echo ""
    echo "Commands:"
    echo "  create   Launch a fresh Ubuntu ${VM_IMAGE} VM with all repo mounts"
    echo "  destroy  Tear down and purge the VM"
    echo "  status   Show VM info"
    echo "  ssh      Open a shell inside the VM"
    echo "  ip       Print the VM's IP address"
    echo "  setup    Install Node 22 + pnpm, run pnpm install in VM"
    echo "  test     Run vitest unit tests inside the VM"
    echo "  remount  Re-mount all workspace repos (fixes stale mounts)"
    echo "  exec     Run a command inside the VM"
    ;;
  *)
    echo "Unknown command: $1" >&2
    echo "Run '$0 help' for usage." >&2
    exit 1
    ;;
esac
