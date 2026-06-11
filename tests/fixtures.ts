import type { AiLeadAnalysis, NormalizedLead } from "../src/domain/lead.schema.js";

export const analysisFixture = (): AiLeadAnalysis => ({
  summary: "Клієнт шукає лендинг.",
  classification: "hot",
  priority: 1,
  need: "Лендинг",
  recommendedNextStep: "Звʼязатися протягом 1 години",
  reason: "Терміновість"
});

export const normalizedLeadFixture = (): NormalizedLead => ({
  leadId: "lead_550e8400-e29b-41d4-a716-446655440000",
  receivedAt: "2026-06-10T10:00:00.000Z",
  name: "Ірина",
  phoneRaw: "+380671234567",
  phoneNormalized: "+380671234567",
  email: "iryna@example.com",
  company: "Kovalenko Beauty",
  message: "Потрібен лендинг швидко",
  budgetRaw: "2000-3000$",
  budgetMin: 2000,
  budgetMax: 3000,
  currency: "USD",
  source: "landing-main",
  utm: {
    source: "facebook",
    medium: "cpc",
    campaign: "summer-offer"
  },
  rawPayloadJson: "{\"name\":\"Ірина\"}"
});
