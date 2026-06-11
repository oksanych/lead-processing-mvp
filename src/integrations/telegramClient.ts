import type { AiLeadAnalysis, NormalizedLead } from "../domain/lead.schema.js";
import type { SheetAppendResult } from "./sheetsClient.js";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface TelegramResult {
  sent: boolean;
}

export type FetchLike = (
  url: string,
  init: {
    method: "POST";
    headers: { "Content-Type": "application/json" };
    body: string;
  }
) => Promise<{ ok: boolean }>;

const display = (value: string | undefined | null) => value || "не вказано";

const displayBudget = (lead: NormalizedLead) => {
  const min = lead.budgetMin ?? "";
  const max = lead.budgetMax ?? "";
  const separator = lead.budgetMin !== null && lead.budgetMax !== null ? "-" : "";
  const parsed = lead.budgetMin === null && lead.budgetMax === null ? "не розпізнано" : `${min}${separator}${max} ${lead.currency ?? ""}`.trim();
  return `${display(lead.budgetRaw)} (${parsed})`;
};

export const buildTelegramText = (
  lead: NormalizedLead,
  analysis: AiLeadAnalysis,
  sheet: SheetAppendResult
) => {
  const text = [
    "New lead",
    `Class: ${analysis.classification}`,
    `Priority: ${analysis.priority}`,
    `Name/company: ${display(lead.name)} / ${display(lead.company)}`,
    `Phone/email: ${display(lead.phoneRaw)} / ${display(lead.email)}`,
    `Budget: ${displayBudget(lead)}`,
    `AI summary: ${analysis.summary}`,
    `Next step: ${analysis.recommendedNextStep}`,
    `Sheet: appended ${sheet.updatedRange ?? ""}`.trim()
  ].join("\n");

  return text.length > 3900 ? text.slice(0, 3900) : text;
};

export const sendTelegramNotification = async (
  config: TelegramConfig,
  lead: NormalizedLead,
  analysis: AiLeadAnalysis,
  sheet: SheetAppendResult,
  fetchFn: FetchLike = fetch
): Promise<TelegramResult> => {
  try {
    const response = await fetchFn(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: buildTelegramText(lead, analysis, sheet)
      })
    });

    return { sent: response.ok };
  } catch {
    return { sent: false };
  }
};
