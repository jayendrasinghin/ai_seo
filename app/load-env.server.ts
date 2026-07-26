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
 * Force OPENAI_* from `.env` so a shell-exported key cannot silently
 * diverge from the app (Node --env-file also does not override existing env).
 * Leaves Shopify CLI tunnel vars untouched.
 */
if (envFilePath) {
  try {
    const text = readFileSync(envFilePath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(
        /^(OPENAI_[A-Z0-9_]+)\s*=\s*(.*)$/,
      );
      if (!match) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  } catch {
    // ignore unreadable .env
  }
}
