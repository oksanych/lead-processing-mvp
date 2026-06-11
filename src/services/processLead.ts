import { ZodError } from "zod";
import { requireGoogleSheetsConfig, requireTelegramConfig, type AppConfig } from "../config.js";
import {
  aiLeadAnalysisSchema,
  leadInputSchema,
  type AiLeadAnalysis,
  type AiProviderUsed,
  type NormalizedLead
} from "../domain/lead.schema.js";
import { normalizeLead, type NormalizeOptions } from "../domain/normalizeLead.js";
import {
  analyzeLeadWithGemini,
  type GeminiAnalyzerConfig
} from "../integrations/ai/geminiAnalyzer.js";
import { analyzeLeadWithMock } from "../integrations/ai/mockAnalyzer.js";
import {
  appendLeadToSheet,
  type SheetAppendResult
} from "../integrations/sheetsClient.js";
import {
  sendTelegramNotification,
  type TelegramResult
} from "../integrations/telegramClient.js";

export class LeadProcessingError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "LeadProcessingError";
  }
}

export interface ProcessLeadResponse {
  leadId: string;
  status: "processed";
  classification: AiLeadAnalysis["classification"];
  priority: AiLeadAnalysis["priority"];
  summary: string;
  aiProviderUsed: AiProviderUsed;
  sheet: SheetAppendResult;
  telegram: TelegramResult;
}

export interface ProcessLeadDependencies {
  analyzeWithGemini?: (
    lead: NormalizedLead,
    config: GeminiAnalyzerConfig
  ) => Promise<AiLeadAnalysis>;
  analyzeWithMock?: (lead: NormalizedLead) => AiLeadAnalysis;
  appendLeadToSheet?: (
    config: ReturnType<typeof requireGoogleSheetsConfig>,
    lead: NormalizedLead,
    analysis: AiLeadAnalysis,
    aiProviderUsed: AiProviderUsed
  ) => Promise<SheetAppendResult>;
  sendTelegramNotification?: (
    config: ReturnType<typeof requireTelegramConfig>,
    lead: NormalizedLead,
    analysis: AiLeadAnalysis,
    sheet: SheetAppendResult
  ) => Promise<TelegramResult>;
  normalizeOptions?: NormalizeOptions;
}

const validationMessage = (error: ZodError) =>
  error.issues.map((issue) => issue.message).join("; ") || "Validation failed";

const analyzeLead = async (
  lead: NormalizedLead,
  config: AppConfig,
  dependencies: Required<
    Pick<ProcessLeadDependencies, "analyzeWithGemini" | "analyzeWithMock">
  >
): Promise<{ analysis: AiLeadAnalysis; aiProviderUsed: AiProviderUsed }> => {
  if (config.aiProvider === "mock") {
    return {
      analysis: dependencies.analyzeWithMock(lead),
      aiProviderUsed: "mock"
    };
  }

  if (config.aiProvider === "auto" && !config.geminiApiKey) {
    return {
      analysis: dependencies.analyzeWithMock(lead),
      aiProviderUsed: "mock"
    };
  }

  try {
    if (!config.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is required for gemini mode");
    }
    const analysis = await dependencies.analyzeWithGemini(lead, {
      apiKey: config.geminiApiKey,
      model: config.geminiModel
    });

    return {
      analysis: aiLeadAnalysisSchema.parse(analysis),
      aiProviderUsed: "gemini"
    };
  } catch (error) {
    if (config.aiProvider === "auto") {
      return {
        analysis: dependencies.analyzeWithMock(lead),
        aiProviderUsed: "mock"
      };
    }
    throw new LeadProcessingError(502, "Gemini analysis failed");
  }
};

export const processLead = async (
  rawPayload: unknown,
  config: AppConfig,
  dependencies: ProcessLeadDependencies = {}
): Promise<ProcessLeadResponse> => {
  const parsed = leadInputSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new LeadProcessingError(400, validationMessage(parsed.error));
  }

  const lead = normalizeLead(parsed.data, rawPayload, dependencies.normalizeOptions);
  const { analysis, aiProviderUsed } = await analyzeLead(lead, config, {
    analyzeWithGemini: dependencies.analyzeWithGemini ?? analyzeLeadWithGemini,
    analyzeWithMock: dependencies.analyzeWithMock ?? analyzeLeadWithMock
  });

  let sheet: SheetAppendResult;
  try {
    sheet = await (dependencies.appendLeadToSheet ?? appendLeadToSheet)(
      requireGoogleSheetsConfig(config),
      lead,
      analysis,
      aiProviderUsed
    );
  } catch {
    throw new LeadProcessingError(502, "Google Sheets append failed");
  }

  let telegram: TelegramResult;
  try {
    telegram = await (dependencies.sendTelegramNotification ?? sendTelegramNotification)(
      requireTelegramConfig(config),
      lead,
      analysis,
      sheet
    );
  } catch {
    telegram = { sent: false };
  }

  return {
    leadId: lead.leadId,
    status: "processed",
    classification: analysis.classification,
    priority: analysis.priority,
    summary: analysis.summary,
    aiProviderUsed,
    sheet,
    telegram
  };
};
