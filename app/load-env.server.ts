/**
 * Must be imported before `shopify.server.ts` (first side-effect import there).
 * ESM hoists `import` above inline code, so dotenv cannot run after other imports
 * in the same file — this module only loads env.
 */
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
let loaded = false;
for (const envPath of [
  path.join(process.cwd(), ".env"),
  path.resolve(__dir, "..", "..", ".env"),
  path.resolve(__dir, "..", ".env"),
]) {
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
    loaded = true;
    break;
  }
}
if (!loaded) {
  loadDotenv();
}
