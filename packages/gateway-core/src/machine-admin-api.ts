/**
 * Machine Admin API Routes — Fastify route registration for machine administration.
 *
 * Covers machine identity, hostname control, Linux user management,
 * agent management, and runtime installation.
 *
 * All endpoints are gated to private network only.
 */

import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { execFileSync, execFile } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { hostname, arch, cpus, totalmem } from "node:os";
import { promisify } from "node:util";
import { createComponentLogger } from "./logger.js";
import { probeGpus, probeThunderbolt } from "./hardware-probe.js";
import type { GpuDevice, ThunderboltInfo } from "./hardware-probe.js";
import type { Logger } from "./logger.js";
import type { DashboardUserStore, DashboardRole } from "./dashboard-user-store.js";
import { hasRole } from "./dashboard-user-store.js";
import type { LocalIdAuthProvider } from "./local-id-auth-provider.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function isPrivateNetwork(ip: string): boolean {
  if (isLoopback(ip)) return true;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  if (ip.startsWith("fe80:")) return true;
  return false;
}

function getClientIp(req: IncomingMessage & { ip?: string }): string {
  // Use Fastify's req.ip when available — it handles proxy trust correctly
  // based on the trustProxy configuration. Only fall back to raw socket address.
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

// ---------------------------------------------------------------------------
// Hardware/firmware probes — populate the Machine page's "complete snapshot"
// view. Every probe runs `dmidecode` / `lsblk` / `ip` etc. with a short
// timeout and degrades gracefully on failure.
// ---------------------------------------------------------------------------

function safeRun(file: string, args: string[], timeoutMs = 5_000, useSudo = false): string {
  try {
    const cmd = useSudo ? "sudo" : file;
    const argv = useSudo ? ["-n", file, ...args] : args;
    return execFileSync(cmd, argv, { timeout: timeoutMs, stdio: "pipe" }).toString().trim();
  } catch {
    return "";
  }
}

function dmi(field: string): string {
  // dmidecode requires root. The gateway runs as a non-root user with
  // sudoers entry for `dmidecode -s *`; falls back to empty when blocked.
  return safeRun("dmidecode", ["-s", field], 5_000, true);
}

function probeFirmware() {
  return {
    manufacturer:           dmi("system-manufacturer"),
    productName:            dmi("system-product-name"),
    serialNumber:           dmi("system-serial-number"),
    sku:                    dmi("system-version"),
    family:                 dmi("system-family"),
    baseboardManufacturer:  dmi("baseboard-manufacturer"),
    baseboardProductName:   dmi("baseboard-product-name"),
    baseboardVersion:       dmi("baseboard-version"),
    baseboardSerialNumber:  dmi("baseboard-serial-number"),
    biosVendor:             dmi("bios-vendor"),
    biosVersion:            dmi("bios-version"),
    biosReleaseDate:        dmi("bios-release-date"),
    chassisType:            dmi("chassis-type"),
  };
}

function probeStorage(): Array<{ name: string; size: string; model: string; type: string; mountpoint: string | null }> {
  const out = safeRun("lsblk", ["-J", "-o", "NAME,SIZE,MODEL,TYPE,MOUNTPOINT"]);
  if (!out) return [];
  try {
    const data = JSON.parse(out) as { blockdevices?: Array<{ name: string; size: string; model?: string; type: string; mountpoint?: string | null; children?: Array<{ name: string; size: string; type: string; mountpoint?: string | null }> }> };
    const devs: Array<{ name: string; size: string; model: string; type: string; mountpoint: string | null }> = [];
    for (const d of data.blockdevices ?? []) {
      if (d.type === "disk") {
        devs.push({ name: d.name, size: d.size, model: d.model ?? "", type: d.type, mountpoint: d.mountpoint ?? null });
        for (const c of d.children ?? []) {
          if (c.type === "part") {
            devs.push({ name: c.name, size: c.size, model: "", type: c.type, mountpoint: c.mountpoint ?? null });
          }
        }
      }
    }
    return devs;
  } catch {
    return [];
  }
}

function probeNetworkInterfaces(): Array<{ name: string; mac: string; addresses: string[]; state: string }> {
  const out = safeRun("ip", ["-j", "addr", "show"], 3_000);
  if (!out) return [];
  try {
    const data = JSON.parse(out) as Array<{
      ifname: string; address?: string; operstate?: string;
      addr_info?: Array<{ family: string; local: string; prefixlen: number }>;
    }>;
    return data
      .filter((iface) => iface.ifname !== "lo")
      .map((iface) => ({
        name: iface.ifname,
        mac: iface.address ?? "",
        state: iface.operstate ?? "UNKNOWN",
        addresses: (iface.addr_info ?? []).map((a) => `${a.local}/${String(a.prefixlen)}`),
      }));
  } catch {
    return [];
  }
}

function probeCpuDetail() {
  const lscpu = safeRun("lscpu", []);
  const field = (label: string): string => {
    const m = new RegExp(`^${label}\\s*:\\s*(.+)$`, "m").exec(lscpu);
    return m?.[1]?.trim() ?? "";
  };
  const flagsLine = field("Flags");
  const allFlags = flagsLine ? flagsLine.split(/\s+/) : [];
  // Cherry-pick the meaningful flags (virt, AVX, accel) — full flag list
  // is hundreds long and noisy.
  const interesting = ["vmx", "svm", "avx", "avx2", "avx512f", "sse4_1", "sse4_2", "aes", "sha_ni", "rdrand", "ept", "npt"];
  return {
    model: field("Model name") || cpus()[0]?.model || "Unknown",
    cores: Number(field("Core(s) per socket") || "0") * Number(field("Socket(s)") || "1") || cpus().length,
    threads: Number(field("CPU(s)") || "0") || cpus().length,
    arch: arch(),
    flags: allFlags.filter((f) => interesting.includes(f)),
    vendorId: field("Vendor ID"),
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export interface MachineAdminDeps {
  logger?: Logger;
  /** Dashboard user store — if provided, enables auth + admin user endpoints. */
  dashboardUserStore?: DashboardUserStore;
  /** Local-ID auth provider — if provided, enables Login via ID endpoints. */
  localIdAuthProvider?: LocalIdAuthProvider;
  /** Local-ID base URL — if provided, enables proxying admin CRUD to Local-ID. */
  idBaseUrl?: string;
  /** Path to gateway.json — used to update hosting.lanIp when network changes. */
  configPath?: string;
}

export function registerMachineAdminRoutes(
  fastify: FastifyInstance,
  deps: MachineAdminDeps,
): void {
  const log = createComponentLogger(deps.logger, "machine-admin-api");

  function guardPrivate(request: { raw: IncomingMessage }): string | null {
    const clientIp = getClientIp(request.raw);
    if (!isPrivateNetwork(clientIp)) return "Machine admin API only allowed from private network";
    return null;
  }

  // -----------------------------------------------------------------------
  // GET /api/machine/info — extended machine identity
  // -----------------------------------------------------------------------

  fastify.get("/api/machine/info", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    try {
      const hn = hostname();

      // Parse /etc/os-release for distro info
      let distro = "Unknown";
      let distroVersionId = "";
      let distroId = "";
      try {
        const osRelease = readFileSync("/etc/os-release", "utf-8");
        const prettyMatch = osRelease.match(/^PRETTY_NAME="?(.+?)"?$/m);
        if (prettyMatch?.[1]) distro = prettyMatch[1];
        const verMatch = osRelease.match(/^VERSION_ID="?(.+?)"?$/m);
        if (verMatch?.[1]) distroVersionId = verMatch[1];
        const idMatch = osRelease.match(/^ID=(.+)$/m);
        if (idMatch?.[1]) distroId = idMatch[1].replace(/"/g, "");
      } catch { /* ignore */ }

      // Kernel version
      const kernel = safeRun("uname", ["-r"]) || "Unknown";
      const kernelFull = safeRun("uname", ["-a"]);

      // Primary IP
      let ip = "Unknown";
      const hostIp = safeRun("hostname", ["-I"]);
      const first = hostIp.split(/\s+/)[0];
      if (first) ip = first;

      const cpuModel = cpus()[0]?.model ?? "Unknown";
      const totalMemoryGB = Math.round(totalmem() / (1024 * 1024 * 1024) * 10) / 10;

      return reply.send({
        // Backwards-compatible fields (existing UI consumers)
        hostname: hn,
        os: process.platform,
        kernel,
        arch: arch(),
        distro,
        ip,
        cpuModel,
        totalMemoryGB,
        // Extended snapshot fields (Machine page complete view)
        os_detail: {
          platform: process.platform,
          distro,
          distroId,
          distroVersionId,
          kernel,
          kernelFull,
          arch: arch(),
          nodeVersion: process.version,
        },
      });
    } catch (e) {
      log.error(`Failed to get machine info: ${e instanceof Error ? e.message : String(e)}`);
      return reply.code(500).send({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/machine/hardware — complete machine snapshot.
  //
  // This is the Machine page's primary data source: identity + firmware
  // (motherboard, BIOS, chassis), CPU detail (cores, flags, vendor),
  // memory, storage devices, network interfaces, OS detail. The HF
  // Marketplace ALSO consumes this for compatibility assessment — its
  // own /api/hf/hardware endpoint returns a subset projection of this
  // same data, never a separate probe.
  // -----------------------------------------------------------------------

  fastify.get("/api/machine/hardware", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    try {
      const fw = probeFirmware();
      const cpu = probeCpuDetail();
      const storage = probeStorage();
      const networkInterfaces = probeNetworkInterfaces();
      const gpus: GpuDevice[] = probeGpus();
      const thunderbolt: ThunderboltInfo = probeThunderbolt();

      // OS / kernel
      let distro = "Unknown";
      let distroVersionId = "";
      try {
        const osRelease = readFileSync("/etc/os-release", "utf-8");
        const prettyMatch = osRelease.match(/^PRETTY_NAME="?(.+?)"?$/m);
        if (prettyMatch?.[1]) distro = prettyMatch[1];
        const verMatch = osRelease.match(/^VERSION_ID="?(.+?)"?$/m);
        if (verMatch?.[1]) distroVersionId = verMatch[1];
      } catch { /* ignore */ }

      const totalMemoryBytes = totalmem();

      return reply.send({
        identity: {
          hostname: hostname(),
          manufacturer: fw.manufacturer,
          productName: fw.productName,
          serialNumber: fw.serialNumber,
          family: fw.family,
          chassisType: fw.chassisType,
        },
        firmware: {
          biosVendor: fw.biosVendor,
          biosVersion: fw.biosVersion,
          biosReleaseDate: fw.biosReleaseDate,
        },
        motherboard: {
          manufacturer: fw.baseboardManufacturer,
          productName: fw.baseboardProductName,
          version: fw.baseboardVersion,
          serialNumber: fw.baseboardSerialNumber,
        },
        os: {
          platform: process.platform,
          distro,
          distroVersionId,
          kernel: safeRun("uname", ["-r"]) || "Unknown",
          arch: arch(),
          nodeVersion: process.version,
        },
        cpu,
        memory: {
          totalBytes: totalMemoryBytes,
          totalGB: Math.round(totalMemoryBytes / (1024 * 1024 * 1024) * 10) / 10,
        },
        storage,
        network: networkInterfaces,
        gpus,
        thunderbolt,
      });
    } catch (e) {
      log.error(`Failed to get machine hardware snapshot: ${e instanceof Error ? e.message : String(e)}`);
      return reply.code(500).send({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/machine/hostname — rename the machine
  // -----------------------------------------------------------------------

  const HOSTNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;

  fastify.post("/api/machine/hostname", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    try {
      const body = request.body as { hostname?: string } | null;
      const newHostname = body?.hostname;

      if (typeof newHostname !== "string" || !HOSTNAME_RE.test(newHostname)) {
        return reply.code(400).send({
          error: "Invalid hostname. Must match RFC 1123: alphanumeric, may contain hyphens, 1-63 characters, cannot start with a hyphen.",
        });
      }

      const oldHostname = hostname();

      // Set hostname via hostnamectl
      execFileSync("sudo", ["hostnamectl", "set-hostname", newHostname], { timeout: 10_000 });

      // Update /etc/hosts: replace old hostname with new
      try {
        const hosts = readFileSync("/etc/hosts", "utf-8");
        const updated = hosts.replace(
          new RegExp(`\\b${oldHostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
          newHostname,
        );
        // Write via sudo tee to handle permissions
        execFileSync("sudo", ["tee", "/etc/hosts"], {
          input: updated,
          timeout: 10_000,
        });
      } catch (hostsErr) {
        log.warn(`Failed to update /etc/hosts: ${hostsErr instanceof Error ? hostsErr.message : String(hostsErr)}`);
      }

      log.info(`Hostname changed from "${oldHostname}" to "${newHostname}"`);
      return reply.send({ ok: true, hostname: newHostname });
    } catch (e) {
      log.error(`Failed to set hostname: ${e instanceof Error ? e.message : String(e)}`);
      return reply.code(500).send({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/machine/network — current network interface configuration
  // -----------------------------------------------------------------------

  fastify.get("/api/machine/network", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const os = await import("node:os");
    const plat = os.platform();

    // Only Linux with nmcli is fully supported for now
    if (plat !== "linux") {
      return reply.send({ supported: false, platform: plat, reason: "Network configuration is managed by your operating system." });
    }

    try {
      // Get the primary active connection
      const conName = execFileSync("nmcli", ["-t", "-f", "NAME", "con", "show", "--active"], { stdio: "pipe", timeout: 5_000 }).toString().trim().split("\n")[0] ?? "";
      if (!conName) {
        return reply.send({ supported: false, platform: plat, reason: "No active NetworkManager connection found." });
      }

      // Get connection details
      const details = execFileSync("nmcli", ["-t", "-f", "IP4.ADDRESS,IP4.GATEWAY,ipv4.method,connection.interface-name", "con", "show", conName], { stdio: "pipe", timeout: 5_000 }).toString().trim();

      let ip = "";
      let subnet = "24";
      let gateway = "";
      let method = "auto";
      let iface = "";

      for (const line of details.split("\n")) {
        if (line.startsWith("IP4.ADDRESS")) {
          const addr = line.split(":").slice(1).join(":").trim();
          const parts = addr.split("/");
          ip = parts[0] ?? "";
          subnet = parts[1] ?? "24";
        } else if (line.startsWith("IP4.GATEWAY")) {
          gateway = line.split(":").slice(1).join(":").trim();
        } else if (line.startsWith("ipv4.method")) {
          method = line.split(":").slice(1).join(":").trim();
        } else if (line.startsWith("connection.interface-name")) {
          iface = line.split(":").slice(1).join(":").trim();
        }
      }

      return reply.send({
        supported: true,
        connection: conName,
        interface: iface,
        ip,
        subnet,
        gateway,
        method: method === "manual" ? "static" : "dhcp",
      });
    } catch (e) {
      return reply.send({ supported: false, platform: plat, reason: e instanceof Error ? e.message : "Failed to query network" });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/machine/network — change IP configuration (static/DHCP)
  // -----------------------------------------------------------------------

  fastify.post("/api/machine/network", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const os = await import("node:os");
    if (os.platform() !== "linux") {
      return reply.code(400).send({ error: "Network configuration only supported on Linux" });
    }

    const body = request.body as {
      method?: "static" | "dhcp";
      ip?: string;
      subnet?: string;
      gateway?: string;
    } | null;

    if (!body?.method) {
      return reply.code(400).send({ error: "method is required (static or dhcp)" });
    }

    try {
      // Find active connection
      const conName = execFileSync("nmcli", ["-t", "-f", "NAME", "con", "show", "--active"], { stdio: "pipe", timeout: 5_000 }).toString().trim().split("\n")[0] ?? "";
      if (!conName) {
        return reply.code(400).send({ error: "No active NetworkManager connection found" });
      }

      if (body.method === "static") {
        if (!body.ip) return reply.code(400).send({ error: "ip is required for static configuration" });
        const prefix = body.subnet ?? "24";
        const args = ["con", "mod", conName, "ipv4.addresses", `${body.ip}/${prefix}`, "ipv4.method", "manual"];
        if (body.gateway) args.push("ipv4.gateway", body.gateway);
        execFileSync("sudo", ["nmcli", ...args], { stdio: "pipe", timeout: 10_000 });
      } else {
        execFileSync("sudo", ["nmcli", "con", "mod", conName, "ipv4.method", "auto"], { stdio: "pipe", timeout: 10_000 });
        execFileSync("sudo", ["nmcli", "con", "mod", conName, "ipv4.addresses", ""], { stdio: "pipe", timeout: 10_000 });
        execFileSync("sudo", ["nmcli", "con", "mod", conName, "ipv4.gateway", ""], { stdio: "pipe", timeout: 10_000 });
      }

      // Apply changes
      execFileSync("sudo", ["nmcli", "con", "up", conName], { stdio: "pipe", timeout: 15_000 });

      // Update hosting.lanIp in gateway.json to match
      const newIp = body.method === "static"
        ? body.ip!
        : execFileSync("hostname", ["-I"], { stdio: "pipe", timeout: 5_000 }).toString().trim().split(" ")[0] ?? "";

      if (deps.configPath && newIp) {
        try {
          const cfgRaw = readFileSync(deps.configPath, "utf-8");
          const cfg = JSON.parse(cfgRaw) as Record<string, unknown>;
          if (!cfg.hosting) cfg.hosting = {};
          (cfg.hosting as Record<string, unknown>).lanIp = newIp;
          writeFileSync(deps.configPath, JSON.stringify(cfg, null, 2));
          log.info(`Updated hosting.lanIp to ${newIp} in config`);
        } catch {
          log.warn("Failed to update hosting.lanIp in config");
        }
      }

      log.info(`Network changed to ${body.method}${body.method === "static" ? ` (${body.ip})` : ""}`);
      return reply.send({ ok: true, method: body.method, newIp });
    } catch (e) {
      log.error(`Failed to change network: ${e instanceof Error ? e.message : String(e)}`);
      return reply.code(500).send({ error: e instanceof Error ? e.message : "Failed to change network configuration" });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/machine/users — list Linux users (UID >= 1000 + root)
  // -----------------------------------------------------------------------

  fastify.get("/api/machine/users", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    try {
      const passwd = readFileSync("/etc/passwd", "utf-8");
      const lines = passwd.split("\n").filter(Boolean);

      // Get sudo group members
      let sudoMembers: string[] = [];
      try {
        const groupLine = readFileSync("/etc/group", "utf-8")
          .split("\n")
          .find((l) => l.startsWith("sudo:"));
        if (groupLine) {
          const parts = groupLine.split(":");
          sudoMembers = (parts[3] ?? "").split(",").filter(Boolean);
        }
      } catch { /* ignore */ }

      const users = [];
      for (const line of lines) {
        const parts = line.split(":");
        const username = parts[0]!;
        const uid = parseInt(parts[2] ?? "0", 10);
        const gid = parseInt(parts[3] ?? "0", 10);
        const gecos = parts[4] ?? "";
        const home = parts[5] ?? "";
        const shell = parts[6] ?? "";

        // Only show real users (UID >= 1000) and root
        if (uid < 1000 && username !== "root") continue;
        // Skip nobody and nfsnobody
        if (username === "nobody" || username === "nfsnobody") continue;

        // Check if user has SSH keys
        let hasSSHKeys = false;
        try {
          hasSSHKeys = existsSync(`${home}/.ssh/authorized_keys`);
        } catch { /* ignore */ }

        // Check lock status
        let locked = false;
        try {
          const status = execFileSync("sudo", ["passwd", "-S", username], { timeout: 5000 }).toString();
          locked = status.split(/\s+/)[1] === "L";
        } catch { /* ignore */ }

        // Get user's groups
        let groups: string[] = [];
        try {
          const groupOutput = execFileSync("groups", [username], { timeout: 5000 }).toString().trim();
          const colonIdx = groupOutput.indexOf(":");
          if (colonIdx !== -1) {
            groups = groupOutput.slice(colonIdx + 1).trim().split(/\s+/);
          }
        } catch { /* ignore */ }

        users.push({
          username,
          uid,
          gid,
          gecos,
          home,
          shell,
          groups,
          sudo: sudoMembers.includes(username) || (username === "root"),
          hasSSHKeys,
          locked,
        });
      }

      return reply.send({ users });
    } catch (e) {
      log.error(`Failed to list users: ${e instanceof Error ? e.message : String(e)}`);
      return reply.code(500).send({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/machine/users — create Linux user
  // -----------------------------------------------------------------------

  const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

  fastify.post("/api/machine/users", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    try {
      const body = request.body as {
        username?: string;
        password?: string;
        shell?: string;
        addToSudo?: boolean;
        sshPublicKey?: string;
      } | null;

      const username = body?.username;
      if (typeof username !== "string" || !USERNAME_RE.test(username)) {
        return reply.code(400).send({ error: "Invalid username. Must match /^[a-z_][a-z0-9_-]{0,31}$/" });
      }

      // Validate shell if provided
      const shell = body?.shell ?? "/bin/bash";
      try {
        const validShells = readFileSync("/etc/shells", "utf-8").split("\n").filter((l) => l.startsWith("/"));
        if (!validShells.includes(shell)) {
          return reply.code(400).send({ error: `Invalid shell: ${shell}. Must be listed in /etc/shells` });
        }
      } catch { /* ignore shell validation if /etc/shells unreadable */ }

      // Create user
      execFileSync("sudo", ["useradd", "-m", "-s", shell, username], { timeout: 15_000 });

      // Set password if provided
      if (body?.password) {
        execFileSync("sudo", ["chpasswd"], {
          input: `${username}:${body.password}`,
          timeout: 10_000,
        });
      }

      // Add to sudo group if requested
      if (body?.addToSudo) {
        execFileSync("sudo", ["usermod", "-aG", "sudo", username], { timeout: 10_000 });
      }

      // Add SSH key if provided
      if (body?.sshPublicKey) {
        const homeDir = `/home/${username}`;
        const sshDir = `${homeDir}/.ssh`;
        execFileSync("sudo", ["mkdir", "-p", sshDir], { timeout: 5000 });
        execFileSync("sudo", ["tee", `${sshDir}/authorized_keys`], {
          input: body.sshPublicKey + "\n",
          timeout: 5000,
        });
        execFileSync("sudo", ["chown", "-R", `${username}:${username}`, sshDir], { timeout: 5000 });
        execFileSync("sudo", ["chmod", "700", sshDir], { timeout: 5000 });
        execFileSync("sudo", ["chmod", "600", `${sshDir}/authorized_keys`], { timeout: 5000 });
      }

      log.info(`Created user "${username}"`);
      return reply.send({ ok: true, username });
    } catch (e) {
      log.error(`Failed to create user: ${e instanceof Error ? e.message : String(e)}`);
      return reply.code(500).send({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  // -----------------------------------------------------------------------
  // PUT /api/machine/users/:username — modify Linux user
  // -----------------------------------------------------------------------

  fastify.put("/api/machine/users/:username", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    try {
      const { username } = request.params as { username: string };
      if (!USERNAME_RE.test(username) && username !== "root") {
        return reply.code(400).send({ error: "Invalid username" });
      }

      const body = request.body as {
        shell?: string;
        addToSudo?: boolean;
        removeFromSudo?: boolean;
        locked?: boolean;
        sshPublicKey?: string;
      } | null;

      if (body?.shell) {
        execFileSync("sudo", ["usermod", "-s", body.shell, username], { timeout: 10_000 });
      }

      if (body?.addToSudo) {
        execFileSync("sudo", ["usermod", "-aG", "sudo", username], { timeout: 10_000 });
      }

      if (body?.removeFromSudo) {
        execFileSync("sudo", ["deluser", username, "sudo"], { timeout: 10_000 });
      }

      if (body?.locked === true) {
        execFileSync("sudo", ["passwd", "-l", username], { timeout: 10_000 });
      } else if (body?.locked === false) {
        execFileSync("sudo", ["passwd", "-u", username], { timeout: 10_000 });
      }

      log.info(`Modified user "${username}"`);
      return reply.send({ ok: true, username });
    } catch (e) {
      log.error(`Failed to modify user: ${e instanceof Error ? e.message : String(e)}`);
      return reply.code(500).send({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  // -----------------------------------------------------------------------
  // DELETE /api/machine/users/:username — delete Linux user
  // -----------------------------------------------------------------------

  fastify.delete("/api/machine/users/:username", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    try {
      const { username } = request.params as { username: string };
      const query = request.query as { removeHome?: string };

      // Safety: refuse to delete root or current process owner
      if (username === "root") {
        return reply.code(403).send({ error: "Cannot delete root user" });
      }

      const processOwner = execFileSync("whoami", [], { timeout: 5000 }).toString().trim();
      if (username === processOwner) {
        return reply.code(403).send({ error: `Cannot delete process owner (${processOwner})` });
      }

      const args = ["userdel"];
      if (query.removeHome === "true") args.push("-r");
      args.push(username);

      execFileSync("sudo", args, { timeout: 15_000 });

      log.info(`Deleted user "${username}" (removeHome: ${query.removeHome === "true"})`);
      return reply.send({ ok: true });
    } catch (e) {
      log.error(`Failed to delete user: ${e instanceof Error ? e.message : String(e)}`);
      return reply.code(500).send({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/machine/users/:username/ssh-keys — list SSH authorized_keys
  // -----------------------------------------------------------------------

  fastify.get("/api/machine/users/:username/ssh-keys", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    try {
      const { username } = request.params as { username: string };
      const home = username === "root" ? "/root" : `/home/${username}`;
      const keysPath = `${home}/.ssh/authorized_keys`;

      let keys: { index: number; type: string; key: string; comment: string }[] = [];
      try {
        const content = execFileSync("sudo", ["cat", keysPath], { timeout: 5000 }).toString();
        keys = content
          .split("\n")
          .filter(Boolean)
          .map((line, i) => {
            const parts = line.trim().split(/\s+/);
            return {
              index: i,
              type: parts[0] ?? "",
              key: parts[1] ?? "",
              comment: parts.slice(2).join(" "),
            };
          });
      } catch { /* file doesn't exist or can't be read */ }

      return reply.send({ keys });
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/machine/users/:username/ssh-keys — add SSH key
  // -----------------------------------------------------------------------

  fastify.post("/api/machine/users/:username/ssh-keys", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    try {
      const { username } = request.params as { username: string };
      const body = request.body as { key?: string } | null;
      const key = body?.key?.trim();

      if (!key) {
        return reply.code(400).send({ error: "SSH key is required" });
      }

      // Validate SSH key format
      try {
        execFileSync("ssh-keygen", ["-l", "-f", "-"], {
          input: key,
          timeout: 5000,
        });
      } catch {
        return reply.code(400).send({ error: "Invalid SSH key format" });
      }

      const home = username === "root" ? "/root" : `/home/${username}`;
      const sshDir = `${home}/.ssh`;

      execFileSync("sudo", ["mkdir", "-p", sshDir], { timeout: 5000 });

      // Append key
      const { stdout: existing } = await execFileAsync("sudo", ["cat", `${sshDir}/authorized_keys`], { timeout: 5000 }).catch(() => ({ stdout: "" }));
      const newContent = existing ? existing.trimEnd() + "\n" + key + "\n" : key + "\n";
      execFileSync("sudo", ["tee", `${sshDir}/authorized_keys`], {
        input: newContent,
        timeout: 5000,
      });

      execFileSync("sudo", ["chown", "-R", `${username}:${username}`, sshDir], { timeout: 5000 });
      execFileSync("sudo", ["chmod", "700", sshDir], { timeout: 5000 });
      execFileSync("sudo", ["chmod", "600", `${sshDir}/authorized_keys`], { timeout: 5000 });

      return reply.send({ ok: true });
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  // -----------------------------------------------------------------------
  // DELETE /api/machine/users/:username/ssh-keys/:index — remove SSH key
  // -----------------------------------------------------------------------

  fastify.delete("/api/machine/users/:username/ssh-keys/:index", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    try {
      const { username, index: indexStr } = request.params as { username: string; index: string };
      const idx = parseInt(indexStr, 10);
      if (isNaN(idx) || idx < 0) {
        return reply.code(400).send({ error: "Invalid key index" });
      }

      const home = username === "root" ? "/root" : `/home/${username}`;
      const keysPath = `${home}/.ssh/authorized_keys`;

      const content = execFileSync("sudo", ["cat", keysPath], { timeout: 5000 }).toString();
      const lines = content.split("\n").filter(Boolean);

      if (idx >= lines.length) {
        return reply.code(404).send({ error: "Key index out of range" });
      }

      lines.splice(idx, 1);
      const newContent = lines.join("\n") + (lines.length > 0 ? "\n" : "");
      execFileSync("sudo", ["tee", keysPath], { input: newContent, timeout: 5000 });

      return reply.send({ ok: true });
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/agents — list all agents with live status
  // -----------------------------------------------------------------------

  fastify.get("/api/agents", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    try {
      // Aionima is always the primary agent
      const agents = [
        {
          id: "aionima",
          name: "Aionima",
          type: "gateway" as const,
          status: "running" as const, // If API responds, it's running
          uptime: process.uptime(),
          pid: process.pid,
          memoryMB: Math.round(process.memoryUsage.rss() / (1024 * 1024)),
          channels: [],
          lastActivity: new Date().toISOString(),
        },
      ];

      return reply.send({ agents });
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/agents/:id — detailed agent info
  // -----------------------------------------------------------------------

  fastify.get("/api/agents/:id", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const { id } = request.params as { id: string };

    if (id === "aionima") {
      const mem = process.memoryUsage();
      return reply.send({
        id: "aionima",
        name: "Aionima",
        type: "gateway",
        status: "running",
        uptime: process.uptime(),
        pid: process.pid,
        memoryMB: Math.round(mem.rss / (1024 * 1024)),
        heapUsedMB: Math.round(mem.heapUsed / (1024 * 1024)),
        heapTotalMB: Math.round(mem.heapTotal / (1024 * 1024)),
        channels: [],
        lastActivity: new Date().toISOString(),
        nodeVersion: process.version,
      });
    }

    return reply.code(404).send({ error: `Agent "${id}" not found` });
  });

  // -----------------------------------------------------------------------
  // POST /api/agents/:id/restart — restart agent
  // -----------------------------------------------------------------------

  fastify.post("/api/agents/:id/restart", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const { id } = request.params as { id: string };

    if (id === "aionima") {
      // Reply first, then restart — the current process dies on restart,
      // so a synchronous call can never return a response.
      void reply.send({ ok: true });
      setTimeout(() => {
        const child = execFile("sudo", ["systemctl", "restart", "agi"], { timeout: 15_000 });
        child.unref();
      }, 200);
      return reply;
    }

    return reply.code(404).send({ error: `Agent "${id}" not found` });
  });

  // -----------------------------------------------------------------------
  // Dashboard Auth + User Management
  // -----------------------------------------------------------------------

  const userStore = deps.dashboardUserStore;

  /** Extract session from either provider. */
  function extractSessionFromAny(request: { raw: IncomingMessage }): import("./dashboard-user-store.js").DashboardSession | null {
    const authHeader = request.raw.headers["authorization"];
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);
    // Try internal store first
    if (userStore) {
      const session = userStore.verifySession(token);
      if (session) return session;
    }
    // Fall back to Local-ID provider
    if (deps.localIdAuthProvider) {
      return deps.localIdAuthProvider.verifySession(token);
    }
    return null;
  }

  if (userStore) {
    // POST /api/auth/login
    fastify.post("/api/auth/login", async (request, reply) => {
      const body = request.body as { username?: string; password?: string } | null;
      if (!body?.username || !body?.password) {
        return reply.code(400).send({ error: "Username and password are required" });
      }

      const result = userStore.authenticate(body.username, body.password);
      if (!result) {
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      return reply.send({ ok: true, token: result.token, user: result.user });
    });

    // GET /api/auth/me
    fastify.get("/api/auth/me", async (request, reply) => {
      // Try DashboardUserStore first, then LocalIdAuthProvider
      let session = extractSession(request, userStore);
      if (!session && deps.localIdAuthProvider) {
        const authHeader = request.raw.headers["authorization"];
        if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
          session = deps.localIdAuthProvider.verifySession(authHeader.slice(7));
        }
      }
      if (!session) {
        return reply.code(401).send({ error: "Not authenticated" });
      }
      // Try getting full user info from store, fall back to session data
      const user = userStore.getUser(session.userId);
      const userInfo = user ?? {
        id: session.userId,
        username: session.username,
        displayName: session.username,
        role: session.role,
        createdAt: new Date(session.issuedAt).toISOString(),
        lastLoginAt: null,
        disabled: false,
      };
      return reply.send({ user: userInfo, session: { role: session.role, expiresAt: session.expiresAt } });
    });

    // GET /api/auth/status — check if dashboard auth is enabled and has users
    fastify.get("/api/auth/status", async (_request, reply) => {
      const localIdAvailable = deps.localIdAuthProvider
        ? await deps.localIdAuthProvider.isAvailable()
        : false;
      return reply.send({
        enabled: true,
        hasUsers: userStore.hasUsers(),
        userCount: userStore.userCount(),
        provider: localIdAvailable ? "local-id" : "internal",
      });
    });

    // POST /api/auth/login-via-id — start Local-ID handoff login
    // On LAN the handoff is auto-approved at creation, so we immediately poll
    // and return the token — no popup needed. Only falls back to the popup flow
    // when the handoff is still pending (off-LAN).
    if (deps.localIdAuthProvider) {
      const idAuth = deps.localIdAuthProvider;

      fastify.post("/api/auth/login-via-id", async (_request, reply) => {
        try {
          const { handoffId, authUrl } = await idAuth.startLogin();

          // Immediate poll — if auto-approved (LAN), return token directly
          const poll = await idAuth.pollLogin(handoffId);
          if (poll.status === "completed" && poll.token) {
            return reply.send({ status: "completed", token: poll.token, user: poll.user });
          }

          // Not yet approved — caller needs the popup flow
          return reply.send({ status: "pending", handoffId, authUrl });
        } catch (e) {
          log.error(`Login-via-ID start failed: ${e instanceof Error ? e.message : String(e)}`);
          return reply.code(502).send({ error: "Cannot reach Aionima ID service" });
        }
      });

      // GET /api/auth/login-via-id/poll — poll handoff for completion
      fastify.get("/api/auth/login-via-id/poll", async (request, reply) => {
        const handoffId = (request.query as { handoffId?: string }).handoffId;
        if (!handoffId) {
          return reply.code(400).send({ error: "handoffId query parameter is required" });
        }

        try {
          const result = await idAuth.pollLogin(handoffId);
          return reply.send(result);
        } catch (e) {
          log.error(`Login-via-ID poll failed: ${e instanceof Error ? e.message : String(e)}`);
          return reply.code(502).send({ error: "Cannot reach Aionima ID service" });
        }
      });
    }

    // POST /api/auth/logout — end session (client-side token clear)
    fastify.post("/api/auth/logout", async (_request, reply) => {
      // Stateless HMAC tokens — no server state to clear.
      // Endpoint exists for API hygiene and future token blacklist support.
      return reply.send({ ok: true });
    });

    // GET /api/admin/users — list dashboard users (admin only)
    // Phase 3: queries Local-ID first, merges with DashboardUserStore fallback
    fastify.get("/api/admin/users", async (request, reply) => {
      const err = guardPrivate(request);
      if (err) return reply.code(403).send({ error: err });

      const session = extractSessionFromAny(request);
      if (!session || !hasRole(session.role, "admin")) {
        return reply.code(403).send({ error: "Admin role required" });
      }

      // Try Local-ID first
      if (deps.idBaseUrl) {
        try {
          const res = await fetch(`${deps.idBaseUrl}/api/users`, {
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = (await res.json()) as { users: unknown[] };
            // Merge: include Local-ID users, plus any DashboardUserStore users not in Local-ID
            const localIdUsers = data.users as Array<{ id: string; username: string; displayName: string; dashboardRole: string; entity: unknown }>;
            const localIdUsernames = new Set(localIdUsers.map((u) => u.username));
            const legacyOnly = userStore.listUsers().filter((u) => !localIdUsernames.has(u.username));
            const merged = [
              ...localIdUsers.map((u) => ({
                id: u.id,
                username: u.username,
                displayName: u.displayName,
                role: u.dashboardRole,
                source: "local-id" as const,
                entity: u.entity,
              })),
              ...legacyOnly.map((u) => ({
                id: u.id,
                username: u.username,
                displayName: u.displayName,
                role: u.role,
                source: "internal" as const,
                entity: null,
              })),
            ];
            return reply.send({ users: merged });
          }
        } catch {
          // Local-ID unreachable — fall through to DashboardUserStore
        }
      }

      return reply.send({ users: userStore.listUsers() });
    });

    // POST /api/admin/users — create dashboard user (admin only)
    // Phase 3: proxies to Local-ID when available
    fastify.post("/api/admin/users", async (request, reply) => {
      const err = guardPrivate(request);
      if (err) return reply.code(403).send({ error: err });

      const session = extractSessionFromAny(request);
      if (!session || !hasRole(session.role, "admin")) {
        return reply.code(403).send({ error: "Admin role required" });
      }

      const body = request.body as {
        username?: string;
        displayName?: string;
        password?: string;
        role?: DashboardRole;
      } | null;

      if (!body?.username || !body?.password) {
        return reply.code(400).send({ error: "Username and password are required" });
      }

      // Try Local-ID first
      if (deps.idBaseUrl) {
        try {
          const res = await fetch(`${deps.idBaseUrl}/api/users/create`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              username: body.username,
              password: body.password,
              displayName: body.displayName ?? body.username,
              dashboardRole: body.role ?? "viewer",
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (res.ok) {
            const data = (await res.json()) as { user: unknown; entity: unknown };
            return reply.send({ ok: true, user: data.user, entity: data.entity });
          }
          const errorBody = await res.json().catch(() => ({})) as { error?: string };
          if (res.status === 409 || res.status === 400) {
            return reply.code(res.status).send({ error: errorBody.error ?? "Failed to create user" });
          }
          // Other errors — fall through to legacy
        } catch {
          // Local-ID unreachable — fall through
        }
      }

      // Fallback: DashboardUserStore
      try {
        const user = userStore.createUser({
          username: body.username,
          displayName: body.displayName ?? body.username,
          password: body.password,
          role: body.role ?? "viewer",
        });
        return reply.send({ ok: true, user });
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : "Failed to create user" });
      }
    });

    // PUT /api/admin/users/:id — update dashboard user (admin only)
    // Phase 3: proxies to Local-ID when available
    fastify.put("/api/admin/users/:id", async (request, reply) => {
      const err = guardPrivate(request);
      if (err) return reply.code(403).send({ error: err });

      const session = extractSessionFromAny(request);
      if (!session || !hasRole(session.role, "admin")) {
        return reply.code(403).send({ error: "Admin role required" });
      }

      const { id } = request.params as { id: string };
      const body = request.body as {
        displayName?: string;
        role?: DashboardRole;
        disabled?: boolean;
      } | null;

      // Try Local-ID first
      if (deps.idBaseUrl) {
        try {
          const res = await fetch(`${deps.idBaseUrl}/api/users/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              displayName: body?.displayName,
              dashboardRole: body?.role,
            }),
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = (await res.json()) as { ok: boolean; user: unknown };
            return reply.send(data);
          }
          if (res.status === 404) {
            // Not in Local-ID — try DashboardUserStore below
          } else {
            const errorBody = await res.json().catch(() => ({})) as { error?: string };
            return reply.code(res.status).send({ error: errorBody.error ?? "Failed to update user" });
          }
        } catch {
          // Local-ID unreachable — fall through
        }
      }

      // Fallback: DashboardUserStore
      const user = userStore.updateUser(id, body ?? {});
      if (!user) return reply.code(404).send({ error: "User not found" });
      return reply.send({ ok: true, user });
    });

    // DELETE /api/admin/users/:id — delete dashboard user (admin only)
    // Phase 3: proxies to Local-ID when available
    fastify.delete("/api/admin/users/:id", async (request, reply) => {
      const err = guardPrivate(request);
      if (err) return reply.code(403).send({ error: err });

      const session = extractSessionFromAny(request);
      if (!session || !hasRole(session.role, "admin")) {
        return reply.code(403).send({ error: "Admin role required" });
      }

      const { id } = request.params as { id: string };

      // Cannot delete yourself
      if (id === session.userId) {
        return reply.code(400).send({ error: "Cannot delete your own account" });
      }

      // Try Local-ID first
      if (deps.idBaseUrl) {
        try {
          const res = await fetch(`${deps.idBaseUrl}/api/users/${encodeURIComponent(id)}`, {
            method: "DELETE",
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            return reply.send({ ok: true });
          }
          if (res.status === 404) {
            // Not in Local-ID — try DashboardUserStore below
          } else {
            const errorBody = await res.json().catch(() => ({})) as { error?: string };
            return reply.code(res.status).send({ error: errorBody.error ?? "Failed to delete user" });
          }
        } catch {
          // Local-ID unreachable — fall through
        }
      }

      // Fallback: DashboardUserStore
      const ok = userStore.deleteUser(id);
      if (!ok) return reply.code(404).send({ error: "User not found" });
      return reply.send({ ok: true });
    });

    // POST /api/admin/users/:id/reset-password — admin password reset
    // Phase 3: proxies to Local-ID when available
    fastify.post("/api/admin/users/:id/reset-password", async (request, reply) => {
      const err = guardPrivate(request);
      if (err) return reply.code(403).send({ error: err });

      const session = extractSessionFromAny(request);
      if (!session || !hasRole(session.role, "admin")) {
        return reply.code(403).send({ error: "Admin role required" });
      }

      const { id } = request.params as { id: string };
      const body = request.body as { password?: string } | null;
      if (!body?.password) {
        return reply.code(400).send({ error: "New password is required" });
      }

      // Try Local-ID first
      if (deps.idBaseUrl) {
        try {
          const res = await fetch(`${deps.idBaseUrl}/api/users/${encodeURIComponent(id)}/password`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password: body.password }),
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            return reply.send({ ok: true });
          }
          if (res.status === 404) {
            // Not in Local-ID — try DashboardUserStore below
          } else {
            const errorBody = await res.json().catch(() => ({})) as { error?: string };
            return reply.code(res.status).send({ error: errorBody.error ?? "Failed to reset password" });
          }
        } catch {
          // Local-ID unreachable — fall through
        }
      }

      // Fallback: DashboardUserStore
      const ok = userStore.changePassword(id, body.password);
      if (!ok) return reply.code(404).send({ error: "User not found" });
      return reply.send({ ok: true });
    });
  } else {
    // When dashboard auth is not configured, return disabled status
    fastify.get("/api/auth/status", async (_request, reply) => {
      return reply.send({ enabled: false, hasUsers: false, userCount: 0 });
    });
  }

  // -----------------------------------------------------------------------
  // Samba Network Shares
  // -----------------------------------------------------------------------

  const SAMBA_SHARES: Record<string, { comment: string; path: string }> = {
    Dropbox: { comment: "Shared Dropbox Folder", path: "/home/wishborn/_dropbox" },
    Projects: { comment: "Shared Projects Folder", path: "/home/wishborn/_projects" },
  };

  const SMB_CONF = "/etc/samba/smb.conf";

  function parseSmbShares(): { name: string; path: string; enabled: boolean }[] {
    let content: string;
    try {
      content = readFileSync(SMB_CONF, "utf-8");
    } catch {
      content = "";
    }

    return Object.entries(SAMBA_SHARES).map(([name, def]) => {
      const re = new RegExp(`^\\[${name}\\]`, "m");
      return { name, path: def.path, enabled: re.test(content) };
    });
  }

  function buildShareBlock(name: string, def: { comment: string; path: string }): string {
    return [
      "",
      `[${name}]`,
      `   comment = ${def.comment}`,
      `   path = ${def.path}`,
      "   browseable = yes",
      "   read only = no",
      "   valid users = wishborn",
      "   create mask = 0644",
      "   directory mask = 0755",
      "",
    ].join("\n");
  }

  // GET /api/samba/shares
  fastify.get("/api/samba/shares", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });
    return reply.send({ shares: parseSmbShares() });
  });

  // POST /api/samba/shares/:name/enable
  fastify.post("/api/samba/shares/:name/enable", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const { name } = request.params as { name: string };
    const def = SAMBA_SHARES[name];
    if (!def) return reply.code(400).send({ error: `Unknown share: ${name}. Allowed: ${Object.keys(SAMBA_SHARES).join(", ")}` });

    try {
      const content = readFileSync(SMB_CONF, "utf-8");
      const re = new RegExp(`^\\[${name}\\]`, "m");
      if (re.test(content)) {
        return reply.send({ ok: true }); // already enabled
      }

      const updated = content.trimEnd() + "\n" + buildShareBlock(name, def);
      execFileSync("sudo", ["tee", SMB_CONF], { input: updated, timeout: 10_000 });
      execFileSync("sudo", ["systemctl", "restart", "smbd"], { timeout: 15_000 });

      log.info(`Samba share "${name}" enabled`);
      return reply.send({ ok: true });
    } catch (e) {
      log.error(`Failed to enable Samba share "${name}": ${e instanceof Error ? e.message : String(e)}`);
      return reply.code(500).send({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  // POST /api/samba/shares/:name/disable
  fastify.post("/api/samba/shares/:name/disable", async (request, reply) => {
    const err = guardPrivate(request);
    if (err) return reply.code(403).send({ error: err });

    const { name } = request.params as { name: string };
    if (!SAMBA_SHARES[name]) return reply.code(400).send({ error: `Unknown share: ${name}. Allowed: ${Object.keys(SAMBA_SHARES).join(", ")}` });

    try {
      const content = readFileSync(SMB_CONF, "utf-8");
      // Remove the [Name] block: from [Name] to the next [header] or EOF
      const re = new RegExp(`\\n?\\[${name}\\][\\s\\S]*?(?=\\n\\[|$)`);
      const updated = content.replace(re, "");

      execFileSync("sudo", ["tee", SMB_CONF], { input: updated, timeout: 10_000 });
      execFileSync("sudo", ["systemctl", "restart", "smbd"], { timeout: 15_000 });

      log.info(`Samba share "${name}" disabled`);
      return reply.send({ ok: true });
    } catch (e) {
      log.error(`Failed to disable Samba share "${name}": ${e instanceof Error ? e.message : String(e)}`);
      return reply.code(500).send({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  log.info("Machine admin routes registered");
}

// ---------------------------------------------------------------------------
// Session extraction helper
// ---------------------------------------------------------------------------

function extractSession(
  request: { raw: IncomingMessage },
  store: DashboardUserStore,
) {
  const authHeader = request.raw.headers["authorization"];
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  return store.verifySession(token);
}
