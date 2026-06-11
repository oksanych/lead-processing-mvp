import { describe, expect, it } from "vitest";
import { normalizeLead, parseBudget } from "../src/domain/normalizeLead.js";

describe("normalizeLead", () => {
  it("normalizes email, whitespace, phone, IDs, dates, and raw JSON", () => {
    const lead = normalizeLead(
      {
        name: "  Ірина   Коваленко ",
        phone: "+38 (067) 123-45-67",
        email: " IRYNA@EXAMPLE.COM ",
        company: " Kovalenko   Beauty ",
        message: " Хочу   лендинг ",
        budget: "2000-3000$",
        source: " landing-main ",
        utm: {
          source: " facebook ",
          medium: " cpc ",
          campaign: " summer-offer "
        }
      },
      { email: " IRYNA@EXAMPLE.COM ", phone: "+38 (067) 123-45-67" },
      {
        now: () => new Date("2026-06-10T10:00:00.000Z"),
        randomUUID: () => "550e8400-e29b-41d4-a716-446655440000"
      }
    );

    expect(lead.leadId).toBe("lead_550e8400-e29b-41d4-a716-446655440000");
    expect(lead.receivedAt).toBe("2026-06-10T10:00:00.000Z");
    expect(lead.email).toBe("iryna@example.com");
    expect(lead.phoneRaw).toBe("+38 (067) 123-45-67");
    expect(lead.phoneNormalized).toBe("+380671234567");
    expect(lead.name).toBe("Ірина Коваленко");
    expect(lead.company).toBe("Kovalenko Beauty");
    expect(lead.rawPayloadJson).toBe("{\"email\":\" IRYNA@EXAMPLE.COM \",\"phone\":\"+38 (067) 123-45-67\"}");
  });

  it("sets invalid phone normalization to null while keeping the raw value", () => {
    const lead = normalizeLead({
      phone: "not-a-phone"
    });

    expect(lead.phoneRaw).toBe("not-a-phone");
    expect(lead.phoneNormalized).toBeNull();
  });
});

describe("parseBudget", () => {
  it.each([
    ["2000-3000$", 2000, 3000, "USD"],
    ["$2000 - $3000", 2000, 3000, "USD"],
    ["від 50000 грн", 50000, null, "UAH"],
    ["2000 до 3000 грн", 2000, 3000, "UAH"],
    ["2017 гривень", 2017, null, "UAH"],
    ["до 1000 eur", null, 1000, "EUR"],
    ["500 usd", 500, null, "USD"],
    ["домовимось", null, null, null],
    ["50 000 грн", 50000, null, "UAH"]
  ])("parses %s", (input, budgetMin, budgetMax, currency) => {
    expect(parseBudget(input)).toEqual({
      budgetRaw: input,
      budgetMin,
      budgetMax,
      currency
    });
  });

  it("treats multiple numbers without a range separator as ambiguous", () => {
    expect(parseBudget("1000 2000 usd")).toEqual({
      budgetRaw: "1000 2000 usd",
      budgetMin: null,
      budgetMax: null,
      currency: "USD"
    });
  });
});
