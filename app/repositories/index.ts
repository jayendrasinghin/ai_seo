import prisma from "../db.server";
import type { PayPalMode, PaymentProvider, Prisma, SyncStatus } from "@prisma/client";

export const shopRepository = {
  async upsertByDomain(shopDomain: string) {
    return prisma.shop.upsert({
      where: { shopDomain },
      create: { shopDomain },
      update: { uninstalledAt: null },
    });
  },

  async markUninstalled(shopDomain: string) {
    return prisma.shop.update({
      where: { shopDomain },
      data: { uninstalledAt: new Date() },
    });
  },

  async findByDomain(shopDomain: string) {
    return prisma.shop.findUnique({
      where: { shopDomain },
      include: {
        settings: true,
        paypalConnections: { orderBy: [{ isDefault: "desc" }, { connectedAt: "desc" }] },
        razorpayConnections: { orderBy: [{ isDefault: "desc" }, { connectedAt: "desc" }] },
      },
    });
  },

  async getOrCreateSettings(shopId: string) {
    return prisma.shopSettings.upsert({
      where: { shopId },
      create: { shopId },
      update: {},
    });
  },
};

export const orderSyncRepository = {
  async upsert(data: {
    shopId: string;
    shopifyOrderGid: string;
    shopifyOrderName: string;
    shopifyCreatedAt?: Date | null;
    customerName?: string | null;
    itemsSummary?: string | null;
    paymentProvider: PaymentProvider;
    paymentStatus: string;
    providerOrderId?: string | null;
    providerCaptureId?: string | null;
    fulfillmentStatus?: string;
    trackingStatus?: string;
    syncStatus?: SyncStatus;
    lastError?: string | null;
    lastSyncedAt?: Date | null;
  }) {
    const { shopId, shopifyOrderGid, ...rest } = data;
    return prisma.orderSync.upsert({
      where: { shopId_shopifyOrderGid: { shopId, shopifyOrderGid } },
      create: { shopId, shopifyOrderGid, ...rest },
      update: rest,
    });
  },

  async findById(id: string) {
    return prisma.orderSync.findUnique({
      where: { id },
      include: { shipments: { include: { syncAttempts: { orderBy: { createdAt: "desc" }, take: 10 } } }, shop: true },
    });
  },

  async findByShopifyGid(shopId: string, shopifyOrderGid: string) {
    return prisma.orderSync.findUnique({
      where: { shopId_shopifyOrderGid: { shopId, shopifyOrderGid } },
      include: { shipments: true },
    });
  },

  async list(shopId: string, filters: {
    provider?: PaymentProvider;
    syncStatus?: SyncStatus;
    paymentStatus?: string;
    failuresOnly?: boolean;
    needsMappingOnly?: boolean;
    search?: string;
    from?: Date;
    to?: Date;
    skip?: number;
    take?: number;
  }) {
    const where: Record<string, unknown> = { shopId };
    if (filters.provider) where.paymentProvider = filters.provider;
    if (filters.syncStatus) where.syncStatus = filters.syncStatus;
    if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
    if (filters.failuresOnly) {
      where.syncStatus = { in: ["failed", "failed_permanent"] };
    }
    if (filters.needsMappingOnly) where.syncStatus = "needs_mapping";
    if (filters.search) {
      where.shopifyOrderName = { contains: filters.search, mode: "insensitive" };
    }
    if (filters.from || filters.to) {
      where.updatedAt = {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      };
    }

    const [items, total] = await Promise.all([
      prisma.orderSync.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: filters.skip ?? 0,
        take: filters.take ?? 25,
        include: { shipments: true },
      }),
      prisma.orderSync.count({ where }),
    ]);
    return { items, total };
  },

  async getOverviewStats(shopId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [processedToday, synced, waiting, needsAction, failed, providerDist, recent] =
      await Promise.all([
        prisma.orderSync.count({
          where: { shopId, updatedAt: { gte: today } },
        }),
        prisma.shipmentSync.count({
          where: { orderSync: { shopId }, syncStatus: "synced" },
        }),
        prisma.orderSync.count({
          where: {
            shopId,
            paymentStatus: "paid",
            fulfillmentStatus: { in: ["unfulfilled", "partial"] },
          },
        }),
        prisma.orderSync.count({
          where: { shopId, syncStatus: "needs_mapping" },
        }),
        prisma.shipmentSync.count({
          where: {
            orderSync: { shopId },
            syncStatus: { in: ["failed", "failed_permanent"] },
          },
        }),
        prisma.orderSync.groupBy({
          by: ["paymentProvider"],
          where: { shopId },
          _count: true,
        }),
        prisma.orderSync.findMany({
          where: { shopId },
          orderBy: { updatedAt: "desc" },
          take: 10,
          select: {
            id: true,
            shopifyOrderName: true,
            shopifyCreatedAt: true,
            customerName: true,
            itemsSummary: true,
            paymentProvider: true,
            paymentStatus: true,
            syncStatus: true,
            lastSyncedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ]);

    return {
      processedToday,
      synced,
      waiting,
      needsAction,
      failed,
      providerDist,
      recent,
    };
  },
};

export const shipmentSyncRepository = {
  async upsert(data: {
    orderSyncId: string;
    trackingNumber: string;
    carrier: string;
    carrierRaw?: string | null;
    shopifyFulfillmentGid?: string | null;
    shipmentStatus?: string;
    syncStatus?: SyncStatus;
  }) {
    const { orderSyncId, trackingNumber, ...rest } = data;
    return prisma.shipmentSync.upsert({
      where: { orderSyncId_trackingNumber: { orderSyncId, trackingNumber } },
      create: { orderSyncId, trackingNumber, ...rest },
      update: rest,
    });
  },

  async updateSyncState(
    id: string,
    data: {
      syncStatus: SyncStatus;
      retryCount?: number;
      nextRetryAt?: Date | null;
      lastError?: string | null;
      syncedAt?: Date | null;
      paypalTrackerId?: string | null;
    },
  ) {
    return prisma.shipmentSync.update({ where: { id }, data });
  },

  async listQueue(shopId: string, status?: SyncStatus) {
    return prisma.shipmentSync.findMany({
      where: {
        orderSync: { shopId },
        ...(status ? { syncStatus: status } : {}),
      },
      include: { orderSync: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
  },

  async findRetryable() {
    return prisma.shipmentSync.findMany({
      where: {
        syncStatus: { in: ["retrying", "failed"] },
        nextRetryAt: { lte: new Date() },
        retryCount: { lt: 5 },
      },
      include: { orderSync: { include: { shop: true } } },
      take: 50,
    });
  },

  async findById(id: string) {
    return prisma.shipmentSync.findUnique({
      where: { id },
      include: { orderSync: { include: { shop: true } } },
    });
  },
};

export const providerMappingRepository = {
  async upsert(data: {
    shopId: string;
    shopifyOrderGid: string;
    provider: PaymentProvider;
    providerOrderId: string;
    mappingSource: "AUTO" | "MANUAL" | "IMPORT";
    mappedBy?: string;
    verifiedAt?: Date;
  }) {
    const { shopId, shopifyOrderGid, provider, ...rest } = data;
    return prisma.providerMapping.upsert({
      where: {
        shopId_shopifyOrderGid_provider: { shopId, shopifyOrderGid, provider },
      },
      create: { shopId, shopifyOrderGid, provider, ...rest },
      update: rest,
    });
  },

  async findMapping(
    shopId: string,
    shopifyOrderGid: string,
    provider: PaymentProvider,
  ) {
    return prisma.providerMapping.findUnique({
      where: {
        shopId_shopifyOrderGid_provider: { shopId, shopifyOrderGid, provider },
      },
    });
  },
};

export const webhookEventRepository = {
  async createIfNotExists(data: {
    shopId?: string;
    topic: string;
    webhookId?: string;
    payloadHash: string;
  }) {
    try {
      return await prisma.webhookEvent.create({
        data: { ...data, status: "received" },
      });
    } catch (error: unknown) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      ) {
        return null;
      }
      throw error;
    }
  },

  async markProcessed(id: string, error?: string) {
    return prisma.webhookEvent.update({
      where: { id },
      data: {
        processedAt: new Date(),
        status: error ? "failed" : "processed",
        error,
      },
    });
  },
};

export const paypalConnectionRepository = {
  /** Default (or first) PayPal account for the shop — used by sync jobs. */
  async findByShopId(shopId: string) {
    const preferred = await prisma.payPalConnection.findFirst({
      where: { shopId, isDefault: true },
    });
    if (preferred) return preferred;
    return prisma.payPalConnection.findFirst({
      where: { shopId },
      orderBy: { connectedAt: "desc" },
    });
  },

  async listByShopId(shopId: string) {
    return prisma.payPalConnection.findMany({
      where: { shopId },
      orderBy: [{ isDefault: "desc" }, { connectedAt: "desc" }],
    });
  },

  async findById(id: string) {
    return prisma.payPalConnection.findUnique({ where: { id } });
  },

  async create(
    shopId: string,
    data: {
      mode: PayPalMode;
      label?: string;
      encryptedClientId: string;
      encryptedClientSecret: string;
      makeDefault?: boolean;
    },
  ) {
    const existing = await prisma.payPalConnection.count({ where: { shopId } });
    const makeDefault = data.makeDefault ?? existing === 0;
    if (makeDefault) {
      await prisma.payPalConnection.updateMany({
        where: { shopId },
        data: { isDefault: false },
      });
    }
    return prisma.payPalConnection.create({
      data: {
        shopId,
        mode: data.mode,
        label: data.label?.trim() || "PayPal",
        isDefault: makeDefault,
        encryptedClientId: data.encryptedClientId,
        encryptedClientSecret: data.encryptedClientSecret,
      },
    });
  },

  /**
   * Onboarding / simple connect: update default account, or create the first one.
   */
  async upsert(
    shopId: string,
    data: {
      mode: PayPalMode;
      label?: string;
      encryptedClientId: string;
      encryptedClientSecret: string;
    },
  ) {
    const existing = await this.findByShopId(shopId);
    if (existing) {
      return prisma.payPalConnection.update({
        where: { id: existing.id },
        data: {
          mode: data.mode,
          label: data.label?.trim() || existing.label,
          encryptedClientId: data.encryptedClientId,
          encryptedClientSecret: data.encryptedClientSecret,
          connectedAt: new Date(),
          lastValidationError: null,
        },
      });
    }
    return this.create(shopId, { ...data, makeDefault: true });
  },

  async deleteByShopId(shopId: string) {
    return prisma.payPalConnection.deleteMany({ where: { shopId } });
  },

  async deleteById(shopId: string, id: string) {
    const deleted = await prisma.payPalConnection.deleteMany({
      where: { id, shopId },
    });
    const stillDefault = await prisma.payPalConnection.findFirst({
      where: { shopId, isDefault: true },
    });
    if (!stillDefault) {
      const next = await prisma.payPalConnection.findFirst({
        where: { shopId },
        orderBy: { connectedAt: "desc" },
      });
      if (next) {
        await prisma.payPalConnection.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }
    return deleted;
  },

  async setDefault(shopId: string, id: string) {
    await prisma.payPalConnection.updateMany({
      where: { shopId },
      data: { isDefault: false },
    });
    return prisma.payPalConnection.updateMany({
      where: { id, shopId },
      data: { isDefault: true },
    });
  },

  async updateValidation(shopId: string, success: boolean, error?: string) {
    const connection = await this.findByShopId(shopId);
    if (!connection) return null;
    return prisma.payPalConnection.update({
      where: { id: connection.id },
      data: {
        lastValidatedAt: new Date(),
        lastValidationError: success ? null : error,
      },
    });
  },

  async updateValidationById(id: string, success: boolean, error?: string) {
    return prisma.payPalConnection.update({
      where: { id },
      data: {
        lastValidatedAt: new Date(),
        lastValidationError: success ? null : error,
      },
    });
  },

  async updateLabel(shopId: string, id: string, label: string) {
    const name = label.trim();
    if (!name) return null;
    const updated = await prisma.payPalConnection.updateMany({
      where: { id, shopId },
      data: { label: name },
    });
    if (updated.count === 0) return null;
    return prisma.payPalConnection.findUnique({ where: { id } });
  },
};

export const razorpayConnectionRepository = {
  async findByShopId(shopId: string) {
    const preferred = await prisma.razorpayConnection.findFirst({
      where: { shopId, isDefault: true },
    });
    if (preferred) return preferred;
    return prisma.razorpayConnection.findFirst({
      where: { shopId },
      orderBy: { connectedAt: "desc" },
    });
  },

  async listByShopId(shopId: string) {
    return prisma.razorpayConnection.findMany({
      where: { shopId },
      orderBy: [{ isDefault: "desc" }, { connectedAt: "desc" }],
    });
  },

  async create(
    shopId: string,
    data: {
      label?: string;
      encryptedKeyId: string;
      encryptedKeySecret: string;
      makeDefault?: boolean;
    },
  ) {
    const existing = await prisma.razorpayConnection.count({ where: { shopId } });
    const makeDefault = data.makeDefault ?? existing === 0;
    if (makeDefault) {
      await prisma.razorpayConnection.updateMany({
        where: { shopId },
        data: { isDefault: false },
      });
    }
    return prisma.razorpayConnection.create({
      data: {
        shopId,
        label: data.label?.trim() || "Razorpay",
        isDefault: makeDefault,
        encryptedKeyId: data.encryptedKeyId,
        encryptedKeySecret: data.encryptedKeySecret,
      },
    });
  },

  async deleteByShopId(shopId: string) {
    return prisma.razorpayConnection.deleteMany({ where: { shopId } });
  },

  async deleteById(shopId: string, id: string) {
    const deleted = await prisma.razorpayConnection.deleteMany({
      where: { id, shopId },
    });
    const stillDefault = await prisma.razorpayConnection.findFirst({
      where: { shopId, isDefault: true },
    });
    if (!stillDefault) {
      const next = await prisma.razorpayConnection.findFirst({
        where: { shopId },
        orderBy: { connectedAt: "desc" },
      });
      if (next) {
        await prisma.razorpayConnection.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }
    return deleted;
  },

  async setDefault(shopId: string, id: string) {
    await prisma.razorpayConnection.updateMany({
      where: { shopId },
      data: { isDefault: false },
    });
    return prisma.razorpayConnection.updateMany({
      where: { id, shopId },
      data: { isDefault: true },
    });
  },

  async updateValidationById(id: string, success: boolean, error?: string) {
    return prisma.razorpayConnection.update({
      where: { id },
      data: {
        lastValidatedAt: new Date(),
        lastValidationError: success ? null : error,
      },
    });
  },
};

export const syncAttemptRepository = {
  async create(data: {
    shipmentSyncId: string;
    provider: string;
    requestSummary: Record<string, unknown>;
    responseStatus?: number;
    responseSummary?: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
    correlationId?: string;
  }) {
    return prisma.syncAttempt.create({
      data: {
        ...data,
        requestSummary: data.requestSummary as Prisma.InputJsonValue,
        responseSummary: data.responseSummary as Prisma.InputJsonValue | undefined,
      },
    });
  },
};

export const settingsRepository = {
  async update(shopId: string, data: Partial<{
    autoTaggingEnabled: boolean;
    notifyBuyerDefault: boolean;
    tagUnfulfilledPhysical: boolean;
    dataRetentionDays: number;
    carrierMappings: Record<string, string>;
    onboardingCompletedAt: Date | null;
  }>) {
    return prisma.shopSettings.upsert({
      where: { shopId },
      create: { shopId, ...data },
      update: data,
    });
  },

  async completeOnboarding(shopId: string) {
    return prisma.shopSettings.upsert({
      where: { shopId },
      create: { shopId, onboardingCompletedAt: new Date() },
      update: { onboardingCompletedAt: new Date() },
    });
  },
};
