import "dotenv/config";
import { z } from "zod";
import type { AiProvider } from "./domain/lead.schema.js";

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  AI_PROVIDER: z.enum(["auto", "mock", "gemini"]).default("auto"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash"),
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional(),
  GOOGLE_SHEETS_RANGE: z.string().default("Leads!A:X"),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional()
});

export interface AppConfig {
  port: number;
  aiProvider: AiProvider;
  geminiApiKey?: string;
  geminiModel: string;
  googleSheetsSpreadsheetId?: string;
  googleSheetsRange: string;
  googleServiceAccountEmail?: string;
  googlePrivateKey?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = configSchema.parse(env);

  return {
    port: parsed.PORT,
    aiProvider: parsed.AI_PROVIDER,
    geminiApiKey: parsed.GEMINI_API_KEY || undefined,
    geminiModel: parsed.GEMINI_MODEL,
    googleSheetsSpreadsheetId: parsed.GOOGLE_SHEETS_SPREADSHEET_ID || undefined,
    googleSheetsRange: parsed.GOOGLE_SHEETS_RANGE,
    googleServiceAccountEmail: parsed.GOOGLE_SERVICE_ACCOUNT_EMAIL || undefined,
    googlePrivateKey: parsed.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") || undefined,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN || undefined,
    telegramChatId: parsed.TELEGRAM_CHAT_ID || undefined
  };
};

export const requireGoogleSheetsConfig = (config: AppConfig) => {
  if (
    !config.googleSheetsSpreadsheetId ||
    !config.googleServiceAccountEmail ||
    !config.googlePrivateKey
  ) {
    throw new Error("Google Sheets environment variables are required");
  }

  return {
    spreadsheetId: config.googleSheetsSpreadsheetId,
    range: config.googleSheetsRange,
    serviceAccountEmail: config.googleServiceAccountEmail,
    privateKey: config.googlePrivateKey
  };
};

export const requireTelegramConfig = (config: AppConfig) => {
  if (!config.telegramBotToken || !config.telegramChatId) {
    throw new Error("Telegram environment variables are required");
  }

  return {
    botToken: config.telegramBotToken,
    chatId: config.telegramChatId
  };
};
