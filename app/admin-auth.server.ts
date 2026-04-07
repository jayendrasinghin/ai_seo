import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createCookie } from "react-router";
import prisma from "./db.server";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_DAYS = 7;
const SESSION_COOKIE = "admin_session";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return scryptSync(token, "admin-session-salt", 64).toString("hex");
}

function hashPassword(password: string): string {
  return scryptSync(password, "admin-password-salt", 64).toString("hex");
}

function passwordMatches(input: string, storedHash: string): boolean {
  const a = Buffer.from(hashPassword(input), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const adminSessionCookie = createCookie(SESSION_COOKIE, {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
});

export function adminPanelEnabled(): boolean {
  return process.env.ADMIN_PANEL_ENABLED === "true";
}

/**
 * Optional bootstrap for first admin account.
 * Set ADMIN_EMAIL + ADMIN_PASSWORD in env and first login will seed the user.
 */
export async function ensureAdminSeedUser(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!email || !password) return;

  const normalized = normalizeEmail(email);
  const existing = await prisma.adminUser.findUnique({
    where: { email: normalized },
    select: { id: true },
  });
  if (existing) return;

  await prisma.adminUser.create({
    data: {
      email: normalized,
      passwordHash: hashPassword(password),
      role: "admin",
      isActive: true,
    },
  });
}

export async function createAdminSession(adminUserId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * ONE_DAY_MS);
  await prisma.adminSession.create({
    data: {
      adminUserId,
      tokenHash: hashToken(token),
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export async function destroyAdminSession(token: string | null): Promise<void> {
  if (!token) return;
  await prisma.adminSession.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function authenticateAdminLogin(
  email: string,
  password: string,
): Promise<{ ok: true; adminUserId: string } | { ok: false; message: string }> {
  await ensureAdminSeedUser();
  const normalized = normalizeEmail(email);
  const user = await prisma.adminUser.findUnique({
    where: { email: normalized },
    select: { id: true, passwordHash: true, isActive: true },
  });
  if (!user || !user.isActive) {
    return { ok: false, message: "Invalid email or password." };
  }
  if (!passwordMatches(password, user.passwordHash)) {
    return { ok: false, message: "Invalid email or password." };
  }
  return { ok: true, adminUserId: user.id };
}

export async function requireAdminSession(request: Request): Promise<{
  adminUserId: string;
}> {
  if (!adminPanelEnabled()) throw new Response("Not found", { status: 404 });
  const cookieHeader = request.headers.get("Cookie");
  const token = await adminSessionCookie.parse(cookieHeader);
  if (!token || typeof token !== "string") throw new Response("Unauthorized", { status: 401 });

  const session = await prisma.adminSession.findFirst({
    where: {
      tokenHash: hashToken(token),
      expiresAt: { gt: new Date() },
      adminUser: { isActive: true },
    },
    select: { adminUserId: true },
  });
  if (!session) throw new Response("Unauthorized", { status: 401 });
  return { adminUserId: session.adminUserId };
}
