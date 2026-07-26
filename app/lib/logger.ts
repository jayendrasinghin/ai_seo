import pino from "pino";
import { getEnv } from "./env";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: getEnv().LOG_LEVEL,
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        },
      }
    : {}),
});

export function createChildLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
