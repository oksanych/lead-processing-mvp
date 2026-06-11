import { google, type sheets_v4 } from "googleapis";
import type {
  AiLeadAnalysis,
  AiProviderUsed,
  NormalizedLead
} from "../domain/lead.schema.js";

export interface SheetsConfig {
  spreadsheetId: string;
  range: string;
  serviceAccountEmail: string;
  privateKey: string;
}

export interface SheetAppendResult {
  appended: true;
  updatedRange?: string;
}

export type SheetRowValue = string | number | null;

export interface SheetsApi {
  spreadsheets: {
    values: {
      append: (args: {
        spreadsheetId: string;
        range: string;
        valueInputOption: "RAW";
        insertDataOption: "INSERT_ROWS";
        requestBody: { values: SheetRowValue[][] };
      }) => Promise<{ data: { updates?: { updatedRange?: string | null } } }>;
    };
  };
}

const valueOrEmpty = (value: string | undefined | null) => value ?? "";

export const buildSheetRow = (
  lead: NormalizedLead,
  analysis: AiLeadAnalysis,
  aiProviderUsed: AiProviderUsed
): SheetRowValue[] => [
  lead.leadId,
  lead.receivedAt,
  valueOrEmpty(lead.name),
  valueOrEmpty(lead.phoneRaw),
  valueOrEmpty(lead.phoneNormalized),
  valueOrEmpty(lead.email),
  valueOrEmpty(lead.company),
  valueOrEmpty(lead.message),
  valueOrEmpty(lead.budgetRaw),
  lead.budgetMin,
  lead.budgetMax,
  valueOrEmpty(lead.currency),
  valueOrEmpty(lead.source),
  valueOrEmpty(lead.utm?.source),
  valueOrEmpty(lead.utm?.medium),
  valueOrEmpty(lead.utm?.campaign),
  aiProviderUsed,
  analysis.summary,
  analysis.classification,
  analysis.priority,
  analysis.need,
  analysis.recommendedNextStep,
  analysis.reason,
  lead.rawPayloadJson
];

export const createSheetsApi = (config: SheetsConfig): SheetsApi => {
  const auth = new google.auth.JWT({
    email: config.serviceAccountEmail,
    key: config.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth }) as sheets_v4.Sheets & SheetsApi;
};

export const appendLeadToSheet = async (
  config: SheetsConfig,
  lead: NormalizedLead,
  analysis: AiLeadAnalysis,
  aiProviderUsed: AiProviderUsed,
  sheetsApi: SheetsApi = createSheetsApi(config)
): Promise<SheetAppendResult> => {
  const response = await sheetsApi.spreadsheets.values.append({
    spreadsheetId: config.spreadsheetId,
    range: config.range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [buildSheetRow(lead, analysis, aiProviderUsed)]
    }
  });

  return {
    appended: true,
    updatedRange: response.data.updates?.updatedRange ?? undefined
  };
};
