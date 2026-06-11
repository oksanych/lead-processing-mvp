import { describe, expect, it, vi } from "vitest";
import { analyzeLeadWithGemini } from "../src/integrations/ai/geminiAnalyzer.js";
import { analyzeLeadWithMock } from "../src/integrations/ai/mockAnalyzer.js";
import { normalizedLeadFixture } from "./fixtures.js";

const { generateContentMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn()
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function GoogleGenAI() {
    return {
      models: {
        generateContent: generateContentMock
      }
    };
  }),
  Type: {
    OBJECT: "OBJECT",
    STRING: "STRING",
    INTEGER: "INTEGER"
  }
}));

describe("analyzeLeadWithMock", () => {
  it("classifies urgency as hot and returns the full AI contract", () => {
    const result = analyzeLeadWithMock({
      ...normalizedLeadFixture(),
      message: "Потрібно запустити лендинг швидко"
    });

    expect(result).toMatchObject({
      classification: "hot",
      priority: 1,
      recommendedNextStep: "Звʼязатися протягом 1 години"
    });
    expect(result.summary).toContain("Заявка від Ірина");
    expect(result.need).toBe("Потрібно запустити лендинг швидко");
    expect(result.reason).toContain("швидко");
  });

  it("classifies clear service intent without urgency as warm", () => {
    expect(
      analyzeLeadWithMock({
        ...normalizedLeadFixture(),
        message: "Потрібен сайт для салону краси"
      })
    ).toMatchObject({
      classification: "warm",
      priority: 2,
      recommendedNextStep: "Звʼязатися протягом доби"
    });
  });

  it("classifies vague messages as cold", () => {
    expect(
      analyzeLeadWithMock({
        ...normalizedLeadFixture(),
        message: "Цікаво"
      })
    ).toMatchObject({
      classification: "cold",
      priority: 3,
      recommendedNextStep: "Надіслати уточнюючі питання"
    });
  });

  it("classifies obvious spam markers as spam", () => {
    expect(
      analyzeLeadWithMock({
        ...normalizedLeadFixture(),
        message: "Casino promo"
      })
    ).toMatchObject({
      classification: "spam",
      priority: 4,
      recommendedNextStep: "Не контактувати"
    });
  });
});

describe("analyzeLeadWithGemini", () => {
  it("rejects invalid Gemini JSON that does not match the AI result schema", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Неповна відповідь"
      })
    });

    await expect(
      analyzeLeadWithGemini(normalizedLeadFixture(), {
        apiKey: "key",
        model: "gemini-3.5-flash"
      })
    ).rejects.toThrow();
  });

  it("requests structured JSON output with priority as an integer enum [1, 2, 3, 4]", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Клієнт шукає лендинг.",
        classification: "hot",
        priority: 1,
        need: "Лендинг",
        recommendedNextStep: "Звʼязатися протягом 1 години",
        reason: "Є терміновість"
      })
    });

    await analyzeLeadWithGemini(normalizedLeadFixture(), {
      apiKey: "key",
      model: "gemini-3.5-flash"
    });

    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          responseMimeType: "application/json",
          responseSchema: expect.objectContaining({
            properties: expect.objectContaining({
              priority: expect.objectContaining({
                type: "INTEGER",
                format: "enum",
                enum: ["1", "2", "3", "4"]
              })
            })
          })
        })
      })
    );
  });

  it("instructs Gemini to prefer normalized budget fields over conflicting message text", async () => {
    generateContentMock.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Клієнт шукає лендинг з бюджетом 2017 гривень.",
        classification: "hot",
        priority: 1,
        need: "Лендинг",
        recommendedNextStep: "Звʼязатися протягом 1 години",
        reason: "Є терміновість"
      })
    });

    await analyzeLeadWithGemini(
      {
        ...normalizedLeadFixture(),
        message: "Потрібен лендинг швидко. Бюджет приблизно 2000-3000$.",
        budgetRaw: "2017 гривень",
        budgetMin: 2017,
        budgetMax: null,
        currency: "UAH"
      },
      {
        apiKey: "key",
        model: "gemini-3.5-flash"
      }
    );

    const call = generateContentMock.mock.calls[0]?.[0];
    expect(call.contents).toContain("budgetRaw, budgetMin, budgetMax, currency");
    expect(call.contents).toContain("джерелом істини");
  });
});
