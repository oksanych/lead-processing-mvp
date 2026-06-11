import { z } from "zod";

export const emptyToUndefined = (value: unknown) => {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
};

const optionalTrimmedString = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional()
);

export const leadInputSchema = z
  .object({
    name: optionalTrimmedString,
    email: z.preprocess(emptyToUndefined, z.string().trim().email().optional()),
    phone: optionalTrimmedString,
    company: optionalTrimmedString,
    message: optionalTrimmedString,
    budget: optionalTrimmedString,
    source: optionalTrimmedString,
    utm: z
      .object({
        source: optionalTrimmedString,
        medium: optionalTrimmedString,
        campaign: optionalTrimmedString
      })
      .optional()
  })
  .refine((data) => Boolean(data.email || data.phone), {
    message: "Either email or phone must be provided",
    path: ["email"]
  });

export const aiLeadAnalysisSchema = z.object({
  summary: z.string().min(1),
  classification: z.enum(["hot", "warm", "cold", "spam"]),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  need: z.string().min(1),
  recommendedNextStep: z.string().min(1),
  reason: z.string().min(1)
});

export type LeadInput = z.infer<typeof leadInputSchema>;
export type AiLeadAnalysis = z.infer<typeof aiLeadAnalysisSchema>;
export type LeadClassification = AiLeadAnalysis["classification"];
export type AiProvider = "auto" | "mock" | "gemini";
export type AiProviderUsed = "mock" | "gemini";
export type BudgetCurrency = "USD" | "UAH" | "EUR" | null;

export interface NormalizedLead {
  leadId: string;
  receivedAt: string;
  name?: string;
  phoneRaw?: string;
  phoneNormalized: string | null;
  email?: string;
  company?: string;
  message?: string;
  budgetRaw?: string;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: BudgetCurrency;
  source?: string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
  };
  rawPayloadJson: string;
}
