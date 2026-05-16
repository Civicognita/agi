/**
 * Dashboard User Store — file-based JSON store for dashboard user accounts.
 *
 * Passwords are hashed using Node's built-in scrypt (no external dependencies).
 * Sessions are HMAC-signed tokens (no JWT library needed).
 *
 * @deprecated Phase 3 Auth Unification — Local-ID is now the single authority
 * for user identity. This store is kept as a read-only fallback for pre-existing
 * users whose scrypt password hashes can't be migrated to Local-ID's bcrypt.
 * New users should be created through Local-ID. This store will be removed
 * in a future cleanup pass once all users have migrated.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DashboardRole = "admin" | "operator" | "viewer";

export interface DashboardUser {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: DashboardRole;
  createdAt: string;
  lastLoginAt: string | null;
  disabled: boolean;
}

export interface DashboardSession {
  userId: string;
  username: string;
  role: DashboardRole;
  issuedAt: number;
  expiresAt: number;
}

/** User info safe for API responses (no password hash). */
export type DashboardUserPublic = Omit<DashboardUser, "passwordHash">;

// ---------------------------------------------------------------------------
// Password hashing (scrypt-based)
// ---------------------------------------------------------------------------

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// ---------------------------------------------------------------------------
// ULID-like ID generator (timestamp + random, sortable)
// ---------------------------------------------------------------------------

function generateId(): string {
  const ts = Date.now().toString(36).padStart(9, "0");
  const rand = randomBytes(10).toString("hex");
  return `${ts}${rand}`;
}

// ---------------------------------------------------------------------------
// Token signing / verification
// ---------------------------------------------------------------------------

function signToken(payload: object, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyToken<T>(token: string, secret: string): T | null {
  const dotIdx = token.indexOf(".");
  if (dotIdx === -1) return null;

  const data = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);

  const expectedSig = createHmac("sha256", secret).update(data).digest("base64url");
  if (sig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;

  try {
    return JSON.parse(Buffer.from(data, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * @deprecated Use Local-ID for new user creation. This store is a read-only fallback.
 */
export class DashboardUserStore {
  private users: DashboardUser[] = [];
  private readonly filePath: string;
  private readonly secret: string;
  private readonly sessionTtlMs: number;
  constructor(dataDir: string, secret: string, sessionTtlMs = 86400000) {
    this.filePath = join(dataDir, "dashboard-users.json");
    this.secret = secret;
    this.sessionTtlMs = sessionTtlMs;
    this.load();
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private load(): void {
    if (!existsSync(this.filePath)) {
      this.users = [];
      return;
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      this.users = JSON.parse(raw) as DashboardUser[];
    } catch {
      this.users = [];
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.users, null, 2), "utf-8");
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  listUsers(): DashboardUserPublic[] {
    return this.users.map(stripHash);
  }

  getUser(id: string): DashboardUserPublic | null {
    const user = this.users.find((u) => u.id === id);
    return user ? stripHash(user) : null;
  }

  getUserByUsername(username: string): DashboardUserPublic | null {
    const user = this.users.find((u) => u.username === username);
    return user ? stripHash(user) : null;
  }

  createUser(params: {
    username: string;
    displayName: string;
    password: string;
    role: DashboardRole;
  }): DashboardUserPublic {
    // Check uniqueness
    if (this.users.some((u) => u.username === params.username)) {
      throw new Error(`Username "${params.username}" already exists`);
    }

    const user: DashboardUser = {
      id: generateId(),
      username: params.username,
      displayName: params.displayName,
      passwordHash: hashPassword(params.password),
      role: params.role,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      disabled: false,
    };

    this.users.push(user);
    this.save();
    return stripHash(user);
  }

  updateUser(id: string, params: {
    displayName?: string;
    role?: DashboardRole;
    disabled?: boolean;
  }): DashboardUserPublic | null {
    const user = this.users.find((u) => u.id === id);
    if (!user) return null;

    if (params.displayName !== undefined) user.displayName = params.displayName;
    if (params.role !== undefined) user.role = params.role;
    if (params.disabled !== undefined) user.disabled = params.disabled;

    this.save();
    return stripHash(user);
  }

  deleteUser(id: string): boolean {
    const idx = this.users.findIndex((u) => u.id === id);
    if (idx === -1) return false;
    this.users.splice(idx, 1);
    this.save();
    return true;
  }

  changePassword(id: string, newPassword: string): boolean {
    const user = this.users.find((u) => u.id === id);
    if (!user) return false;
    user.passwordHash = hashPassword(newPassword);
    this.save();
    return true;
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  authenticate(username: string, password: string): { token: string; user: DashboardUserPublic } | null {
    const user = this.users.find((u) => u.username === username);
    if (!user) return null;
    if (user.disabled) return null;
    if (!verifyPassword(password, user.passwordHash)) return null;

    // Update last login
    user.lastLoginAt = new Date().toISOString();
    this.save();

    const now = Date.now();
    const session: DashboardSession = {
      userId: user.id,
      username: user.username,
      role: user.role,
      issuedAt: now,
      expiresAt: now + this.sessionTtlMs,
    };

    const token = signToken(session, this.secret);
    return { token, user: stripHash(user) };
  }

  /** Sign a session payload with this store's secret. Used when an external
   *  auth backend (e.g. DB argon2) verifies the password but session tokens
   *  must remain compatible with this store's HMAC scheme. */
  createSessionToken(session: DashboardSession): string {
    return signToken(session, this.secret);
  }

  /** TTL in ms for new sessions. */
  getSessionTtlMs(): number {
    return this.sessionTtlMs;
  }

  verifySession(token: string): DashboardSession | null {
    const session = verifyToken<DashboardSession>(token, this.secret);
    if (!session) return null;

    // Check expiry
    if (Date.now() > session.expiresAt) return null;

    // Verify user still exists and is not disabled
    const user = this.users.find((u) => u.id === session.userId);
    if (!user || user.disabled) return null;

    // Refresh role from stored user (in case it changed)
    session.role = user.role;

    return session;
  }

  /** Check if any users exist. */
  hasUsers(): boolean {
    return this.users.length > 0;
  }

  /** Count users. */
  userCount(): number {
    return this.users.length;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripHash(user: DashboardUser): DashboardUserPublic {
  const { passwordHash: _, ...pub } = user;
  return pub;
}

// ---------------------------------------------------------------------------
// Role hierarchy
// ---------------------------------------------------------------------------

const ROLE_LEVELS: Record<DashboardRole, number> = {
  admin: 3,
  operator: 2,
  viewer: 1,
};

/** Check if a role meets the required minimum. */
export function hasRole(userRole: DashboardRole, requiredRole: DashboardRole): boolean {
  return ROLE_LEVELS[userRole] >= ROLE_LEVELS[requiredRole];
}
