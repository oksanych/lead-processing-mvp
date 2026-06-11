import { describe, expect, it, vi } from "vitest";
import {
  buildTelegramText,
  sendTelegramNotification
} from "../src/integrations/telegramClient.js";
import { analysisFixture, normalizedLeadFixture } from "./fixtures.js";

describe("buildTelegramText", () => {
  it("includes class, contacts, budget, summary, next step, and sheet status", () => {
    const text = buildTelegramText(normalizedLeadFixture(), analysisFixture(), {
      appended: true,
      updatedRange: "Leads!A2:X2"
    });

    expect(text).toContain("Class: hot");
    expect(text).toContain("Priority: 1");
    expect(text).toContain("Name/company: Ірина / Kovalenko Beauty");
    expect(text).toContain("Phone/email: +380671234567 / iryna@example.com");
    expect(text).toContain("Budget: 2000-3000$ (2000-3000 USD)");
    expect(text).toContain("AI summary: Клієнт шукає лендинг.");
    expect(text).toContain("Next step: Звʼязатися протягом 1 години");
    expect(text).toContain("Sheet: appended Leads!A2:X2");
  });

  it("stays under the Telegram limit with long user text", () => {
    const longLead = {
      ...normalizedLeadFixture(),
      message: "x".repeat(5000)
    };
    const longAnalysis = {
      ...analysisFixture(),
      summary: "y".repeat(5000)
    };

    expect(buildTelegramText(longLead, longAnalysis, { appended: true })).toHaveLength(3900);
  });
});

describe("sendTelegramNotification", () => {
  it("sends a plain JSON request to Telegram", async () => {
    const fetchFn = vi.fn(async () => ({ ok: true }));

    const result = await sendTelegramNotification(
      { botToken: "token", chatId: "chat" },
      normalizedLeadFixture(),
      analysisFixture(),
      { appended: true },
      fetchFn
    );

    expect(result).toEqual({ sent: true });
    expect(fetchFn).toHaveBeenCalledWith("https://api.telegram.org/bottoken/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.stringContaining("\"chat_id\":\"chat\"")
    });
    expect(fetchFn.mock.calls[0]?.[1]?.body).not.toContain("parse_mode");
  });

  it("returns sent=false when Telegram fails", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false }));

    await expect(
      sendTelegramNotification(
        { botToken: "token", chatId: "chat" },
        normalizedLeadFixture(),
        analysisFixture(),
        { appended: true },
        fetchFn
      )
    ).resolves.toEqual({ sent: false });
  });
});
