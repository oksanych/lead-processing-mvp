import { Router, type Request, type Response } from "express";
import { loadConfig, type AppConfig } from "../config.js";
import {
  LeadProcessingError,
  processLead,
  type ProcessLeadResponse
} from "../services/processLead.js";

export type ProcessLeadHandler = (
  rawPayload: unknown,
  config: AppConfig
) => Promise<ProcessLeadResponse>;

export interface LeadsRouterOptions {
  config?: AppConfig;
  processLead?: ProcessLeadHandler;
}

export const createLeadsRouter = (options: LeadsRouterOptions = {}) => {
  const router = Router();
  const config = options.config ?? loadConfig();
  const processLeadHandler = options.processLead ?? processLead;

  router.post("/", async (req: Request, res: Response) => {
    try {
      const result = await processLeadHandler(req.body, config);
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof LeadProcessingError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  return router;
};
