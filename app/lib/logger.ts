import pino from "pino";

const isDev = process.env.NODE_ENV === "development";

function resolveLogLevel(): string {
  return process.env.LOG_LEVEL || (isDev ? "debug" : "info");
}

export const logger = pino({
  level: resolveLogLevel(),
  // Never require pino-pretty in production — it is a devDependency and
  // crashes the app when NODE_ENV is unset (common under PM2).
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
