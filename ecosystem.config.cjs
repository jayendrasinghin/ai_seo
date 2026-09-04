/** PM2 config — SEOi on PORT 3001 when Briefwire (or other app) uses 3000. */
const nodeInterpreter =
  process.env.SEOI_NODE ||
  "/home/secureuser/.nvm/versions/node/v20.20.2/bin/node";

module.exports = {
  apps: [
    {
      name: "shopify-app-ai_seo",
      cwd: __dirname,
      script: "node_modules/.bin/react-router-serve",
      args: "./build/server/index.js",
      interpreter: nodeInterpreter,
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3001",
      },
    },
    {
      name: "seoi-paysync-worker",
      cwd: __dirname,
      script: "npm",
      args: "run worker",
      interpreter: nodeInterpreter,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
