import prisma from "./db.server";
import { FOUNDING_MEMBER_LIMIT, FOUNDING_MONTHS } from "./pricing";

export type FoundingFields = {
  foundingMember: boolean;
  foundingMemberNumber: number | null;
  foundingGrantedAt: Date | null;
  foundingExpiresAt: Date | null;
};

export function isFoundingStarterActive(
  usage: FoundingFields,
  now: Date = new Date(),
): boolean {
  if (!usage.foundingMember || !usage.foundingExpiresAt) return false;
  return usage.foundingExpiresAt.getTime() > now.getTime();
}

export function foundingDaysRemaining(
  usage: FoundingFields,
  now: Date = new Date(),
): number | null {
  if (!isFoundingStarterActive(usage, now) || !usage.foundingExpiresAt) {
    return null;
  }
  const ms = usage.foundingExpiresAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Grant Founding Member (Starter free for 12 months) to the first
 * FOUNDING_MEMBER_LIMIT production stores. Dev stores never consume a slot.
 * Reinstalls keep the same shop's existing founding row.
 */
export async function maybeGrantFoundingMember(
  shop: string,
  options: { partnerDevelopment: boolean },
): Promise<FoundingFields | null> {
  if (options.partnerDevelopment) return null;

  const existing = await prisma.storeUsage.findUnique({ where: { shop } });
  if (existing?.foundingMember) {
    return {
      foundingMember: existing.foundingMember,
      foundingMemberNumber: existing.foundingMemberNumber,
      foundingGrantedAt: existing.foundingGrantedAt,
      foundingExpiresAt: existing.foundingExpiresAt,
    };
  }

  return prisma.$transaction(async (tx) => {
    const again = await tx.storeUsage.findUnique({ where: { shop } });
    if (again?.foundingMember) {
      return {
        foundingMember: again.foundingMember,
        foundingMemberNumber: again.foundingMemberNumber,
        foundingGrantedAt: again.foundingGrantedAt,
        foundingExpiresAt: again.foundingExpiresAt,
      };
    }

    const grantedCount = await tx.storeUsage.count({
      where: { foundingMember: true },
    });
    if (grantedCount >= FOUNDING_MEMBER_LIMIT) return null;

    const now = new Date();
    const expires = addMonths(now, FOUNDING_MONTHS);
    const number = grantedCount + 1;

    const row = await tx.storeUsage.upsert({
      where: { shop },
      create: {
        shop,
        foundingMember: true,
        foundingMemberNumber: number,
        foundingGrantedAt: now,
        foundingExpiresAt: expires,
      },
      update: {
        foundingMember: true,
        foundingMemberNumber: number,
        foundingGrantedAt: now,
        foundingExpiresAt: expires,
      },
    });

    return {
      foundingMember: row.foundingMember,
      foundingMemberNumber: row.foundingMemberNumber,
      foundingGrantedAt: row.foundingGrantedAt,
      foundingExpiresAt: row.foundingExpiresAt,
    };
  });
}

export async function getFoundingOfferStats() {
  const used = await prisma.storeUsage.count({
    where: { foundingMember: true },
  });
  return {
    used,
    limit: FOUNDING_MEMBER_LIMIT,
    remaining: Math.max(0, FOUNDING_MEMBER_LIMIT - used),
    months: FOUNDING_MONTHS,
  };
}
