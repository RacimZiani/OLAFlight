/**
 * Point d’entrée Vercel (serverless) : toute la plateforme Express.
 * @see https://vercel.com/docs/functions/serverless-functions/runtimes/node-js
 */
import serverless from "serverless-http";
import { createApp } from "../src/app.js";
import { getStore } from "../src/db/index.js";
import { seedAdminIfNeeded } from "../src/seeds/admin.js";

let bootstrap;

function getHandler() {
  if (!bootstrap) {
    bootstrap = (async () => {
      await getStore();
      await seedAdminIfNeeded();
      const app = createApp();
      return serverless(app);
    })();
  }
  return bootstrap;
}

export default async function handler(req, res) {
  const h = await getHandler();
  return h(req, res);
}
