import { serve } from "@hono/node-server";
import { app } from "./api.js";
import { config } from "./config.js";
import { log } from "./logger.js";

serve({ fetch: app.fetch, port: config.port });
log.info("server.listening", { port: config.port, model: config.model, referenceApi: config.referenceApiUrl });
