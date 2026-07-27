import type { Config } from "@react-router/dev/config";

export default {
  // Avoid post-deploy "No result found for routeId …" from lazy route discovery cache.
  routeDiscovery: { mode: "initial" },
} satisfies Config;
