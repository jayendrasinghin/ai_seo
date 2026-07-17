import prisma from "./db.server";
import { sendMail } from "./mail.server";
import { LOW_STOCK_THRESHOLD } from "./inventory-stock";

export { LOW_STOCK_THRESHOLD } from "./inventory-stock";

export type LowStockLine = {
  inventoryItemId: string;
  locationId: string;
  productTitle: string;
  variantLabel: string;
  locationName: string;
  quantity: number;
};

const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function getInventoryAlertSettings(shop: string) {
  return prisma.inventoryAlertSettings.upsert({
    where: { shop },
    update: {},
    create: { shop, alertsEnabled: true, threshold: LOW_STOCK_THRESHOLD },
  });
}

export async function saveInventoryAlertSettings(
  shop: string,
  input: { alertEmail: string; alertsEnabled: boolean },
) {
  const email = input.alertEmail.trim().toLowerCase();
  return prisma.inventoryAlertSettings.upsert({
    where: { shop },
    update: {
      alertEmail: email || null,
      alertsEnabled: input.alertsEnabled,
      threshold: LOW_STOCK_THRESHOLD,
    },
    create: {
      shop,
      alertEmail: email || null,
      alertsEnabled: input.alertsEnabled,
      threshold: LOW_STOCK_THRESHOLD,
    },
  });
}

export async function clearResolvedLowStock(
  shop: string,
  inventoryItemId: string,
  quantity: number,
) {
  if (quantity >= LOW_STOCK_THRESHOLD) {
    await prisma.lowStockNotification.deleteMany({
      where: { shop, inventoryItemId },
    });
  }
}

export async function notifyLowStockLines(
  shop: string,
  lines: LowStockLine[],
  options?: { forceEmail?: string | null },
): Promise<{ sent: number; skipped: number }> {
  const settings = await getInventoryAlertSettings(shop);
  const to =
    (options?.forceEmail?.trim() || settings.alertEmail?.trim() || "").toLowerCase();

  if (!settings.alertsEnabled || !to || !to.includes("@")) {
    return { sent: 0, skipped: lines.length };
  }

  const low = lines.filter((l) => l.quantity < (settings.threshold || LOW_STOCK_THRESHOLD));
  if (low.length === 0) return { sent: 0, skipped: 0 };

  const now = Date.now();
  const toSend: LowStockLine[] = [];

  for (const line of low) {
    const existing = await prisma.lowStockNotification.findUnique({
      where: {
        shop_inventoryItemId_locationId: {
          shop,
          inventoryItemId: line.inventoryItemId,
          locationId: line.locationId,
        },
      },
    });
    if (
      existing &&
      now - existing.notifiedAt.getTime() < ALERT_COOLDOWN_MS &&
      existing.quantity === line.quantity
    ) {
      continue;
    }
    toSend.push(line);
  }

  if (toSend.length === 0) return { sent: 0, skipped: low.length };

  const bodyLines = toSend.map(
    (l) =>
      `• ${l.productTitle} / ${l.variantLabel} @ ${l.locationName}: ${l.quantity} available`,
  );
  const text = `Low stock alert for ${shop}\n\nThe following items are below ${settings.threshold} available:\n\n${bodyLines.join("\n")}\n\nOpen Stock & New Product in SEOI to restock.`;

  const result = await sendMail({
    to,
    subject: `Low stock alert: ${toSend.length} item(s) below ${settings.threshold} (${shop})`,
    text,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
        <h2 style="margin:0 0 12px">Low stock alert</h2>
        <p style="color:#475569;margin:0 0 16px">
          These items at <strong>${escapeHtml(shop)}</strong> are below
          <strong>${settings.threshold}</strong> available units.
        </p>
        <ul style="padding-left:1.2rem;margin:0 0 16px;line-height:1.6">
          ${toSend
            .map(
              (l) =>
                `<li><strong>${escapeHtml(l.productTitle)}</strong> / ${escapeHtml(l.variantLabel)} @ ${escapeHtml(l.locationName)}: <span style="color:#991b1b;font-weight:700">${l.quantity}</span></li>`,
            )
            .join("")}
        </ul>
        <p style="color:#94a3b8;font-size:13px;margin:0">Open Stock &amp; New Product in SEOI to restock.</p>
      </div>
    `,
  });

  if (!result.ok) return { sent: 0, skipped: toSend.length };

  for (const line of toSend) {
    await prisma.lowStockNotification.upsert({
      where: {
        shop_inventoryItemId_locationId: {
          shop,
          inventoryItemId: line.inventoryItemId,
          locationId: line.locationId,
        },
      },
      update: {
        quantity: line.quantity,
        productTitle: line.productTitle,
        variantLabel: line.variantLabel,
        locationName: line.locationName,
        notifiedAt: new Date(),
      },
      create: {
        shop,
        inventoryItemId: line.inventoryItemId,
        locationId: line.locationId,
        productTitle: line.productTitle,
        variantLabel: line.variantLabel,
        locationName: line.locationName,
        quantity: line.quantity,
      },
    });
  }

  await prisma.inventoryAlertSettings.update({
    where: { shop },
    data: { lastCheckedAt: new Date() },
  });

  return { sent: toSend.length, skipped: low.length - toSend.length };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
