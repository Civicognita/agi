/**
 * Hardware probes — GPU enumeration + Thunderbolt/USB4 enumeration.
 *
 * These run shell tools (lspci, nvidia-smi, boltctl) via execFileSync with
 * short timeouts and degrade gracefully when the tool is missing. Used by
 * the Machine page's complete-snapshot view; detection-driven so the page
 * dynamically reflects whatever is actually plugged in.
 */

import { execFileSync } from "node:child_process";

function safeRun(file: string, args: string[], timeoutMs = 5_000): string {
  try {
    return execFileSync(file, args, { timeout: timeoutMs, stdio: "pipe" }).toString().trim();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// GPU probe — enumerate every PCIe display device (VGA / 3D / Display
// controller class) via `lspci -D -k`, then overlay nvidia-smi data when
// available. Returns one row per device regardless of vendor; the frontend
// renders all of them. Detection-driven, no hardcoded NVIDIA assumption.
// ---------------------------------------------------------------------------

export interface GpuDevice {
  /** PCI address — "0000:c5:00.0" (domain:bus:device.function). */
  busId: string;
  /** lspci device class — VGA / 3D / Display. */
  classDesc: string;
  /** Vendor name, normalized to short form when known. */
  vendor: string;
  /** Device name + revision. */
  model: string;
  /** Kernel module currently bound (`nvidia`, `amdgpu`, `i915`, …) or null. */
  driver: string | null;
  /** Total VRAM in MiB. NVIDIA-only — populated from nvidia-smi when present. */
  memoryMB: number | null;
  /** Userspace driver version. NVIDIA-only — populated from nvidia-smi when present. */
  driverVersion: string | null;
}

const VENDOR_PREFIXES = [
  "NVIDIA Corporation",
  "Advanced Micro Devices, Inc. [AMD/ATI]",
  "Advanced Micro Devices, Inc.",
  "Intel Corporation",
  "Matrox Electronics Systems Ltd.",
  "ASPEED Technology, Inc.",
  "VMware",
  "Red Hat, Inc.",
];

export function probeGpus(): GpuDevice[] {
  const out = safeRun("lspci", ["-D", "-k"], 5_000);
  if (!out) return [];
  const devices: GpuDevice[] = [];
  // Each device occupies one line at column 0 plus indented continuation
  // lines. Split before any line that starts with a hex digit.
  const blocks = out.split(/\n(?=[0-9a-f])/i);
  for (const block of blocks) {
    const lines = block.split("\n");
    const head = lines[0] ?? "";
    const m = /^([\w:.]+)\s+(VGA compatible controller|3D controller|Display controller):\s+(.+)$/.exec(head);
    if (!m?.[1] || !m[2] || !m[3]) continue;
    const busId = m[1];
    const classDesc = m[2];
    const rest = m[3];
    let vendor = "Unknown";
    let model = rest;
    for (const v of VENDOR_PREFIXES) {
      if (rest.startsWith(`${v} `)) {
        vendor = v;
        model = rest.slice(v.length + 1);
        break;
      }
    }
    let driver: string | null = null;
    for (const line of lines) {
      const dm = /^\s+Kernel driver in use:\s*(\S+)/.exec(line);
      if (dm?.[1]) {
        driver = dm[1];
        break;
      }
    }
    devices.push({ busId, classDesc, vendor, model, driver, memoryMB: null, driverVersion: null });
  }
  // Overlay NVIDIA-specific fields when nvidia-smi is installed.
  const smi = safeRun(
    "nvidia-smi",
    ["--query-gpu=pci.bus_id,memory.total,driver_version", "--format=csv,noheader,nounits"],
    3_000,
  );
  if (smi) {
    for (const row of smi.split("\n")) {
      const cols = row.split(",").map((s) => s.trim());
      if (cols.length < 3 || !cols[0]) continue;
      const smiBus = cols[0].toLowerCase();
      const memMb = Number(cols[1]);
      const driverVersion = cols[2] ?? "";
      // nvidia-smi reports 8-hex-digit PCI domain ("00000000:C5:00.0"); lspci
      // uses 4-digit ("0000:c5:00.0"). Match on the trailing :BB:DD.F portion.
      const tail = smiBus.slice(-9);
      for (const dev of devices) {
        if (dev.busId.toLowerCase().endsWith(tail)) {
          dev.memoryMB = Number.isFinite(memMb) ? memMb : null;
          dev.driverVersion = driverVersion || null;
          break;
        }
      }
    }
  }
  return devices;
}

// ---------------------------------------------------------------------------
// Thunderbolt / USB4 probe — surfaces every Thunderbolt domain and connected
// device known to bolt(8). Reads `boltctl list -a` (the userspace daemon's
// view; matches what the kernel exposes via /sys/bus/thunderbolt/devices/).
// Fully degrades to { available: false } when boltctl is not installed or
// the system has no Thunderbolt controllers.
// ---------------------------------------------------------------------------

export interface ThunderboltDevice {
  name: string;
  /** "host" (a system port) or "peripheral" (a connected enclosure). */
  type: string;
  vendor: string;
  /** "USB4" | "Thunderbolt 4" | "Thunderbolt 3" | etc. */
  generation: string;
  /** "authorized" | "auth-error" | "pending" | etc. */
  status: string;
  uuid: string;
}

export interface ThunderboltInfo {
  available: boolean;
  devices: ThunderboltDevice[];
}

export function probeThunderbolt(): ThunderboltInfo {
  const out = safeRun("boltctl", ["list", "-a"], 3_000);
  if (!out) return { available: false, devices: [] };
  const devices: ThunderboltDevice[] = [];
  // Each device starts with a line beginning with " * "; attribute lines
  // start with "   |- key: value" or "   `- key: value".
  const blocks = out.split(/\n(?=\s*\*\s)/);
  for (const block of blocks) {
    const headMatch = /^\s*\*\s+(.+)/.exec(block);
    if (!headMatch?.[1]) continue;
    const name = headMatch[1].trim();
    const get = (key: string): string => {
      const re = new RegExp(`[|\`]-\\s+${key}:\\s+(.+)`);
      const m = re.exec(block);
      return m?.[1]?.trim() ?? "";
    };
    devices.push({
      name,
      type: get("type"),
      vendor: get("vendor"),
      generation: get("generation"),
      status: get("status"),
      uuid: get("uuid"),
    });
  }
  return { available: true, devices };
}

// ---------------------------------------------------------------------------
// Live per-GPU stats — utilization, VRAM, temp, power. Sampled every poll.
// NVIDIA path uses nvidia-smi --query-gpu (single shell-out covers all
// fields). AMD path is a future addition (rocm-smi --showuse --showmemuse
// --showtemp --showpower) once the iGPU vs dGPU enrichment matters more.
// ---------------------------------------------------------------------------

export interface GpuLiveStats {
  busId: string;
  name: string;
  gpuUtilPct: number | null;
  memUtilPct: number | null;
  memUsedMB: number | null;
  memTotalMB: number | null;
  tempC: number | null;
  powerW: number | null;
  powerLimitW: number | null;
}

export function probeGpuStats(): GpuLiveStats[] {
  const out = safeRun(
    "nvidia-smi",
    [
      "--query-gpu=pci.bus_id,name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,power.limit",
      "--format=csv,noheader,nounits",
    ],
    3_000,
  );
  if (!out) return [];
  const rows: GpuLiveStats[] = [];
  for (const row of out.split("\n")) {
    const cols = row.split(",").map((s) => s.trim());
    if (cols.length < 9 || !cols[0]) continue;
    const num = (s: string | undefined): number | null => {
      if (s === undefined || s === "" || s === "[N/A]" || s === "[Not Supported]") return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };
    rows.push({
      busId: cols[0]!.toLowerCase(),
      name: cols[1] ?? "",
      gpuUtilPct: num(cols[2]),
      memUtilPct: num(cols[3]),
      memUsedMB: num(cols[4]),
      memTotalMB: num(cols[5]),
      tempC: num(cols[6]),
      powerW: num(cols[7]),
      powerLimitW: num(cols[8]),
    });
  }
  return rows;
}
