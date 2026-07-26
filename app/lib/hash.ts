import { createHash } from "node:crypto";

export function payloadHash(payload: string | Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}

export function correlationId(): string {
  return createHash("sha256")
    .update(`${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 16);
}
