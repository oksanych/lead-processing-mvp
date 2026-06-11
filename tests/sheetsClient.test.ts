import { describe, expect, it, vi } from "vitest";
import { appendLeadToSheet, buildSheetRow } from "../src/integrations/sheetsClient.js";
import { analysisFixture, normalizedLeadFixture } from "./fixtures.js";

const config = {
  spreadsheetId: "sheet-id",
  range: "Leads!A:X",
  serviceAccountEmail: "svc@example.com",
  privateKey: "private-key"
};

describe("buildSheetRow", () => {
  it("maps lead data to the exact 24 Google Sheets columns", () => {
    const row = buildSheetRow(normalizedLeadFixture(), analysisFixture(), "mock");

    expect(row).toHaveLength(24);
    expect(row).toEqual([
      "lead_550e8400-e29b-41d4-a716-446655440000",
      "2026-06-10T10:00:00.000Z",
      "Ірина",
      "+380671234567",
      "+380671234567",
      "iryna@example.com",
      "Kovalenko Beauty",
      "Потрібен лендинг швидко",
      "2000-3000$",
      2000,
      3000,
      "USD",
      "landing-main",
      "facebook",
      "cpc",
      "summer-offer",
      "mock",
      "Клієнт шукає лендинг.",
      "hot",
      1,
      "Лендинг",
      "Звʼязатися протягом 1 години",
      "Терміновість",
      "{\"name\":\"Ірина\"}"
    ]);
  });
});

describe("appendLeadToSheet", () => {
  it("uses RAW, INSERT_ROWS, and returns updatedRange", async () => {
    const append = vi.fn(async () => ({
      data: { updates: { updatedRange: "Leads!A2:X2" } }
    }));
    const sheetsApi = {
      spreadsheets: {
        values: { append }
      }
    };

    const result = await appendLeadToSheet(
      config,
      normalizedLeadFixture(),
      analysisFixture(),
      "mock",
      sheetsApi
    );

    expect(result).toEqual({ appended: true, updatedRange: "Leads!A2:X2" });
    expect(append).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      range: "Leads!A:X",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [buildSheetRow(normalizedLeadFixture(), analysisFixture(), "mock")]
      }
    });
  });
});
