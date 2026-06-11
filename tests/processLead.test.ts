import { describe, expect, it, vi } from "vitest";
import { LeadProcessingError, processLead } from "../src/services/processLead.js";
import type { AiLeadAnalysis } from "../src/domain/lead.schema.js";

const payload = {
  name: "Ірина",
  phone: "+380671234567",
  message: "Потрібен лендинг швидко",
  budget: "2000-3000$"
};

const analysis: AiLeadAnalysis = {
  summary: "Клієнт шукає лендинг.",
  classification: "hot",
  priority: 1,
  need: "Лендинг",
  recommendedNextStep: "Звʼязатися протягом 1 години",
  reason: "Терміновість"
};

const baseConfig = {
  port: 3000,
  aiProvider: "mock" as const,
  geminiApiKey: undefined,
  geminiModel: "gemini-3.5-flash",
  googleSheetsSpreadsheetId: "sheet-id",
  googleSheetsRange: "Leads!A:X",
  googleServiceAccountEmail: "svc@example.com",
  googlePrivateKey: "key",
  telegramBotToken: "token",
  telegramChatId: "chat"
};

const makeDeps = () => ({
  analyzeWithGemini: vi.fn(async () => analysis),
  analyzeWithMock: vi.fn(() => analysis),
  appendLeadToSheet: vi.fn(async () => ({ appended: true, updatedRange: "Leads!A2:X2" })),
  sendTelegramNotification: vi.fn(async () => ({ sent: true })),
  normalizeOptions: {
    now: () => new Date("2026-06-10T10:00:00.000Z"),
    randomUUID: () => "550e8400-e29b-41d4-a716-446655440000"
  }
});

describe("processLead", () => {
  it("uses mock mode without calling Gemini", async () => {
    const deps = makeDeps();
    const result = await processLead(payload, baseConfig, deps);

    expect(result.status).toBe("processed");
    expect(result.aiProviderUsed).toBe("mock");
    expect(deps.analyzeWithMock).toHaveBeenCalledTimes(1);
    expect(deps.analyzeWithGemini).not.toHaveBeenCalled();
  });

  it("falls back to mock in auto mode when Gemini key is missing", async () => {
    const deps = makeDeps();
    const result = await processLead(payload, { ...baseConfig, aiProvider: "auto" }, deps);

    expect(result.aiProviderUsed).toBe("mock");
    expect(deps.analyzeWithGemini).not.toHaveBeenCalled();
  });

  it("falls back to mock in auto mode when Gemini fails", async () => {
    const deps = makeDeps();
    deps.analyzeWithGemini.mockRejectedValueOnce(new Error("invalid response"));

    const result = await processLead(
      payload,
      { ...baseConfig, aiProvider: "auto", geminiApiKey: "key" },
      deps
    );

    expect(result.aiProviderUsed).toBe("mock");
    expect(deps.appendLeadToSheet).toHaveBeenCalledTimes(1);
  });

  it("fails with 502 in gemini mode when Gemini fails and skips Sheets", async () => {
    const deps = makeDeps();
    deps.analyzeWithGemini.mockRejectedValueOnce(new Error("Gemini down"));

    await expect(
      processLead(payload, { ...baseConfig, aiProvider: "gemini", geminiApiKey: "key" }, deps)
    ).rejects.toMatchObject({ statusCode: 502 });
    expect(deps.appendLeadToSheet).not.toHaveBeenCalled();
  });

  it("stops before Telegram when Sheets append fails", async () => {
    const deps = makeDeps();
    deps.appendLeadToSheet.mockRejectedValueOnce(new Error("Sheets down"));

    await expect(processLead(payload, baseConfig, deps)).rejects.toMatchObject({
      statusCode: 502
    });
    expect(deps.sendTelegramNotification).not.toHaveBeenCalled();
  });

  it("keeps the lead successful when Telegram fails", async () => {
    const deps = makeDeps();
    deps.sendTelegramNotification.mockResolvedValueOnce({ sent: false });

    const result = await processLead(payload, baseConfig, deps);

    expect(result.telegram.sent).toBe(false);
    expect(result.sheet.appended).toBe(true);
  });

  it("preserves raw phone and budget strings when passing the lead to integrations", async () => {
    const deps = makeDeps();

    await processLead(
      {
        phone: "  +38 (067) 123-45-67  ",
        budget: "  2000 - 3000$  "
      },
      baseConfig,
      deps
    );

    expect(deps.appendLeadToSheet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        phoneRaw: "  +38 (067) 123-45-67  ",
        budgetRaw: "  2000 - 3000$  ",
        budgetMin: 2000,
        budgetMax: 3000,
        currency: "USD"
      }),
      expect.anything(),
      "mock"
    );
  });

  it("wraps validation failures as 400 errors", async () => {
    const deps = makeDeps();

    await expect(processLead({ message: "Без контакту" }, baseConfig, deps)).rejects.toBeInstanceOf(
      LeadProcessingError
    );
    await expect(processLead({ message: "Без контакту" }, baseConfig, deps)).rejects.toMatchObject({
      statusCode: 400
    });
  });
});
