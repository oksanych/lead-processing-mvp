import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aiLeadAnalysisSchema, leadInputSchema } from "../src/domain/lead.schema.js";

describe("leadInputSchema", () => {
  it("accepts a valid lead payload", () => {
    const result = leadInputSchema.parse({
      name: " Ірина ",
      phone: "+38 (067) 123-45-67",
      email: " IRYNA@EXAMPLE.COM ",
      company: "Kovalenko Beauty",
      message: "Потрібен лендинг",
      budget: "2000-3000$",
      source: "landing-main",
      utm: {
        source: "facebook",
        medium: "cpc",
        campaign: "summer-offer"
      }
    });

    expect(result.name).toBe("Ірина");
    expect(result.email).toBe("IRYNA@EXAMPLE.COM");
  });

  it("treats empty strings as absent fields", () => {
    const result = leadInputSchema.parse({
      name: "",
      email: "",
      phone: " +380671234567 ",
      company: "",
      utm: {
        source: "",
        medium: "",
        campaign: ""
      }
    });

    expect(result.name).toBeUndefined();
    expect(result.email).toBeUndefined();
    expect(result.phone).toBe("+380671234567");
    expect(result.utm?.source).toBeUndefined();
  });

  it("rejects invalid email format", () => {
    const result = leadInputSchema.safeParse({
      email: "not-an-email",
      phone: "+380671234567"
    });

    expect(result.success).toBe(false);
  });

  it("accepts examples/payload.json, which matches the plan example", () => {
    const payload = JSON.parse(
      readFileSync(new URL("../examples/payload.json", import.meta.url), "utf8")
    );

    const result = leadInputSchema.safeParse(payload);

    expect(result.success).toBe(true);
    expect(payload.budget).toBe("2000-3000$");
    expect(payload.message).toContain("2000-3000$");
  });

  it("requires either email or phone", () => {
    const result = leadInputSchema.safeParse({
      name: "Ірина",
      message: "Потрібен лендинг"
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Either email or phone must be provided");
  });
});

describe("aiLeadAnalysisSchema", () => {
  it("requires the full AI result contract", () => {
    const result = aiLeadAnalysisSchema.safeParse({
      summary: "Клієнт шукає лендинг.",
      classification: "hot",
      priority: 1,
      need: "Лендинг",
      recommendedNextStep: "Звʼязатися протягом 1 години",
      reason: "Є бюджет і терміновість"
    });

    expect(result.success).toBe(true);
  });
});
