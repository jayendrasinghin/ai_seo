import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { createCookie } from "react-router";
import prisma from "./db.server";
import { sendAdminOtpEmail } from "./mail.server";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_DAYS = 7;
const SESSION_COOKIE = "admin_session";
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const PENDING_COOKIE = "admin_otp_pending";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return scryptSync(token, "admin-session-salt", 64).toString("hex");
}

function hashPassword(password: string): string {
  return scryptSync(password, "admin-password-salt", 64).toString("hex");
}

function hashOtp(code: string): string {
  return scryptSync(code, "admin-otp-salt", 64).toString("hex");
}

function passwordMatches(input: string, storedHash: string): boolean {
  const a = Buffer.from(hashPassword(input), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function otpMatches(input: string, storedHash: string): boolean {
  const a = Buffer.from(hashOtp(input), "hex");
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

/** Holds pending OTP challenge id between password step and OTP step. */
export const adminOtpPendingCookie = createCookie(PENDING_COOKIE, {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 15 * 60,
});

export function adminPanelEnabled(): boolean {
  return process.env.ADMIN_PANEL_ENABLED === "true";
}

/** OTP is on by default when the admin panel is enabled. Set ADMIN_OTP_ENABLED=false to skip. */
export function adminOtpEnabled(): boolean {
  const raw = process.env.ADMIN_OTP_ENABLED?.trim().toLowerCase();
  if (raw === "false" || raw === "0") return false;
  return true;
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

export async function ensureSupportApps(): Promise<void> {
  const defaults = [
    {
      slug: "seoi",
      name: "Product Image SEO Optimizer",
      description: "AI product SEO & image optimization (seoi.in)",
      sortOrder: 1,
    },
    {
      slug: "pay-sync",
      name: "Pay Sync",
      description: "Payment sync support",
      sortOrder: 2,
    },
  ];
  for (const app of defaults) {
    await prisma.supportApp.upsert({
      where: { slug: app.slug },
      create: app,
      update: {
        name: app.name,
        description: app.description,
        sortOrder: app.sortOrder,
        isActive: true,
      },
    });
  }
}

export async function getDefaultSupportAppId(): Promise<string | null> {
  await ensureSupportApps();
  const app = await prisma.supportApp.findUnique({
    where: { slug: "seoi" },
    select: { id: true },
  });
  return app?.id ?? null;
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

export type PasswordStepResult =
  | { ok: true; needsOtp: false; adminUserId: string }
  | { ok: true; needsOtp: true; challengeId: string; emailMasked: string; delivery: string }
  | { ok: false; message: string };

export async function authenticateAdminPassword(
  email: string,
  password: string,
): Promise<PasswordStepResult> {
  await ensureAdminSeedUser();
  const normalized = normalizeEmail(email);
  const user = await prisma.adminUser.findUnique({
    where: { email: normalized },
    select: { id: true, email: true, passwordHash: true, isActive: true },
  });
  if (!user || !user.isActive) {
    return { ok: false, message: "Invalid email or password." };
  }
  if (!passwordMatches(password, user.passwordHash)) {
    return { ok: false, message: "Invalid email or password." };
  }

  if (!adminOtpEnabled()) {
    return { ok: true, needsOtp: false, adminUserId: user.id };
  }

  // Invalidate prior open challenges for this user.
  await prisma.adminOtpChallenge.updateMany({
    where: { adminUserId: user.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = String(randomInt(100000, 1000000));
  const challenge = await prisma.adminOtpChallenge.create({
    data: {
      adminUserId: user.id,
      codeHash: hashOtp(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  const sent = await sendAdminOtpEmail(user.email, code);
  if (!sent.ok) {
    return {
      ok: false,
      message: "Could not send the login code. Check mail settings and try again.",
    };
  }

  const [local, domain] = user.email.split("@");
  const maskedLocal =
    local.length <= 2 ? `${local[0] ?? "*"}*` : `${local.slice(0, 2)}***`;
  return {
    ok: true,
    needsOtp: true,
    challengeId: challenge.id,
    emailMasked: `${maskedLocal}@${domain}`,
    delivery: sent.via,
  };
}

export type OtpStepResult =
  | { ok: true; adminUserId: string }
  | { ok: false; message: string };

export async function verifyAdminOtp(
  challengeId: string,
  codeRaw: string,
): Promise<OtpStepResult> {
  const code = codeRaw.trim().replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, message: "Enter the 6-digit code from your email." };
  }

  const challenge = await prisma.adminOtpChallenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      adminUserId: true,
      codeHash: true,
      expiresAt: true,
      attempts: true,
      consumedAt: true,
      adminUser: { select: { isActive: true } },
    },
  });

  if (!challenge || challenge.consumedAt || !challenge.adminUser.isActive) {
    return { ok: false, message: "This code is no longer valid. Sign in again." };
  }
  if (challenge.expiresAt.getTime() < Date.now()) {
    return { ok: false, message: "This code expired. Sign in again to get a new one." };
  }
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, message: "Too many attempts. Sign in again to get a new code." };
  }

  const match = otpMatches(code, challenge.codeHash);
  await prisma.adminOtpChallenge.update({
    where: { id: challenge.id },
    data: {
      attempts: { increment: 1 },
      ...(match ? { consumedAt: new Date() } : {}),
    },
  });

  if (!match) {
    return { ok: false, message: "Incorrect code. Check your email and try again." };
  }

  return { ok: true, adminUserId: challenge.adminUserId };
}

/** @deprecated Prefer authenticateAdminPassword + OTP. Kept for simple password-only path. */
export async function authenticateAdminLogin(
  email: string,
  password: string,
): Promise<{ ok: true; adminUserId: string } | { ok: false; message: string }> {
  const result = await authenticateAdminPassword(email, password);
  if (!result.ok) return result;
  if (result.needsOtp) {
    return { ok: false, message: "OTP verification required." };
  }
  return { ok: true, adminUserId: result.adminUserId };
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
