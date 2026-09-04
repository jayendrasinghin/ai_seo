/**
 * Must be imported before `shopify.server.ts` (first side-effect import there).
 * ESM hoists `import` above inline code, so dotenv cannot run after other imports
 * in the same file — this module only loads env.
 *
 * Do NOT use dotenv `override: true` for the whole file — `shopify app dev`
 * injects tunnel `SHOPIFY_APP_URL` / host vars that must win over `.env`.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
let loaded = false;
let envFilePath: string | null = null;
for (const envPath of [
  path.join(process.cwd(), ".env"),
  path.resolve(__dir, "..", "..", ".env"),
  path.resolve(__dir, "..", ".env"),
]) {
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
    envFilePath = envPath;
    loaded = true;
    break;
  }
}
if (!loaded) {
  loadDotenv();
}

/**
 * Force these keys from `.env` so a PM2/shell-exported value cannot silently
 * diverge from the file (dotenv does not override existing env by default).
 * Do NOT force SHOPIFY_APP_URL — `shopify app dev` tunnel URL must win.
 */
const FORCE_FROM_ENV =
  /^(OPENAI_[A-Z0-9_]+|SHOPIFY_API_KEY|SHOPIFY_API_SECRET|SCOPES|PAYSYNC_ENABLED)$/;

function parseEnvValue(raw: string): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

if (envFilePath) {
  try {
    const text = readFileSync(envFilePath, "utf8");
    let paysyncInFile = false;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!match || !FORCE_FROM_ENV.test(match[1])) continue;
      if (match[1] === "PAYSYNC_ENABLED") paysyncInFile = true;
      process.env[match[1]] = parseEnvValue(match[2]);
    }
    // PaySync is on by default; only .env can set PAYSYNC_ENABLED=false (ignore PM2/shell leaks).
    if (!paysyncInFile) {
      delete process.env.PAYSYNC_ENABLED;
    }
  } catch {
    // ignore unreadable .env
  }
}
