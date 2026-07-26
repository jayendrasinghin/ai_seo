import { z } from "zod";
import { loadEnvFile } from "./load-env";

loadEnvFile();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_APP_URL: z.string().url(),
  SCOPES: z
    .string()
    .default(
      "read_content,read_inventory,read_locations,read_online_store_navigation,read_products,write_app_proxy,write_inventory,write_online_store_navigation,write_products,read_fulfillments,read_orders,write_orders",
    ),
  CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
  PAYPAL_SANDBOX_BASE_URL: z
    .string()
    .url()
    .default("https://api-m.sandbox.paypal.com"),
  PAYPAL_LIVE_BASE_URL: z
    .string()
    .url()
    .default("https://api-m.paypal.com"),
  PAYPAL_TRACKING_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  SHOP_CUSTOM_DOMAIN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }
  return cachedEnv;
}

export function requireEncryptionKey(): string {
  const key = getEnv().CREDENTIAL_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY must be set (32+ char hex string)",
    );
  }
  return key;
}
