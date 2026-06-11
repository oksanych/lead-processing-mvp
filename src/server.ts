import { pathToFileURL } from "node:url";
import cors from "cors";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { loadConfig } from "./config.js";
import { createLeadsRouter, type ProcessLeadHandler } from "./routes/leads.js";

export interface CreateAppOptions {
  processLead?: ProcessLeadHandler;
}

const jsonContentTypeCheck: RequestHandler = (req, res, next) => {
  if (req.method === "POST" && !req.is("application/json")) {
    res.status(415).json({ error: "Unsupported Media Type" });
    return;
  }
  next();
};

export const malformedJsonHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  next(error);
};

export const createApp = (options: CreateAppOptions = {}) => {
  const app = express();
  const config = loadConfig();

  app.use(cors());
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/leads", jsonContentTypeCheck);
  app.use(
    "/api/leads",
    rateLimit({
      windowMs: 60_000,
      limit: 10,
      handler: (_req, res) => res.status(429).json({ error: "Too many requests" })
    })
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(malformedJsonHandler);
  app.use("/api/leads", createLeadsRouter({ config, processLead: options.processLead }));

  return app;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const app = createApp();

  app.listen(config.port, () => {
    console.log(`Lead processing MVP listening on port ${config.port}`);
  });
}
