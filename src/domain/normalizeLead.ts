import { randomUUID } from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { BudgetCurrency, LeadInput, NormalizedLead } from "./lead.schema.js";

export interface NormalizeOptions {
  now?: () => Date;
  randomUUID?: () => string;
}

export interface ParsedBudget {
  budgetRaw?: string;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: BudgetCurrency;
}

const collapseWhitespace = (value: string | undefined) =>
  value?.trim().replace(/\s+/g, " ");

const parseNumber = (value: string) => Number(value.replace(",", "."));

const normalizeNumberSpaces = (value: string) =>
  value.replace(/\b\d{1,3}(?:\s\d{3})+\b/gu, (match) => match.replace(/\s/g, ""));

const detectCurrency = (value: string): BudgetCurrency => {
  if (/(?:\$|usd|дол|долар)/iu.test(value)) return "USD";
  if (/(?:грн|uah|₴|грив(?:ень|ня|ні)?)/iu.test(value)) return "UAH";
  if (/(?:eur|€|євро)/iu.test(value)) return "EUR";
  return null;
};

const removeCurrencyTokens = (value: string) =>
  value.replace(/(?:\$|usd|долар(?:ів|и|а)?|дол|грн|uah|₴|грив(?:ень|ня|ні)?|eur|€|євро)/giu, " ");

export const parseBudget = (budget: string | undefined): ParsedBudget => {
  if (!budget) {
    return {
      budgetRaw: budget,
      budgetMin: null,
      budgetMax: null,
      currency: null
    };
  }

  const normalized = budget
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
  const currency = detectCurrency(normalized);
  const searchable = removeCurrencyTokens(normalizeNumberSpaces(normalized)).replace(/\s+/g, " ");
  const numberPattern = "(\\d+(?:[.,]\\d+)?)";

  const rangeMatch = searchable.match(
    new RegExp(`${numberPattern}\\s*(?:-|to|до)\\s*${numberPattern}`, "iu")
  );
  if (rangeMatch?.[1] && rangeMatch[2]) {
    return {
      budgetRaw: budget,
      budgetMin: parseNumber(rangeMatch[1]),
      budgetMax: parseNumber(rangeMatch[2]),
      currency
    };
  }

  const allNumbers = searchable.match(new RegExp(numberPattern, "giu")) ?? [];
  if (allNumbers.length > 1) {
    return {
      budgetRaw: budget,
      budgetMin: null,
      budgetMax: null,
      currency
    };
  }

  const upperMatch = searchable.match(new RegExp(`(?:^|\\s)(?:до|up\\s+to)\\s*${numberPattern}`, "iu"));
  if (upperMatch?.[1]) {
    return {
      budgetRaw: budget,
      budgetMin: null,
      budgetMax: parseNumber(upperMatch[1]),
      currency
    };
  }

  const lowerMatch = searchable.match(new RegExp(`(?:^|\\s)(?:від|from)\\s*${numberPattern}`, "iu"));
  if (lowerMatch?.[1]) {
    return {
      budgetRaw: budget,
      budgetMin: parseNumber(lowerMatch[1]),
      budgetMax: null,
      currency
    };
  }

  const singleMatch = searchable.match(new RegExp(numberPattern, "iu"));
  if (singleMatch?.[1]) {
    return {
      budgetRaw: budget,
      budgetMin: parseNumber(singleMatch[1]),
      budgetMax: null,
      currency
    };
  }

  return {
    budgetRaw: budget,
    budgetMin: null,
    budgetMax: null,
    currency: null
  };
};

const normalizePhone = (phone: string | undefined) => {
  if (!phone) return null;
  const parsed = parsePhoneNumberFromString(phone, "UA");
  return parsed?.isValid() ? parsed.number : null;
};

const rawStringField = (rawPayload: unknown, field: "phone" | "budget") => {
  if (!rawPayload || typeof rawPayload !== "object") return undefined;
  const value = (rawPayload as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
};

export const normalizeLead = (
  payload: LeadInput,
  rawPayload: unknown = payload,
  options: NormalizeOptions = {}
): NormalizedLead => {
  const budgetRaw =
    payload.budget === undefined ? undefined : rawStringField(rawPayload, "budget") ?? payload.budget;
  const parsedBudget = parseBudget(budgetRaw);
  const phoneRaw =
    payload.phone === undefined ? undefined : rawStringField(rawPayload, "phone") ?? payload.phone;
  const now = options.now ?? (() => new Date());
  const uuid = options.randomUUID ?? randomUUID;

  return {
    leadId: `lead_${uuid()}`,
    receivedAt: now().toISOString(),
    name: collapseWhitespace(payload.name),
    phoneRaw,
    phoneNormalized: normalizePhone(phoneRaw),
    email: payload.email?.trim().toLowerCase(),
    company: collapseWhitespace(payload.company),
    message: collapseWhitespace(payload.message),
    budgetRaw,
    budgetMin: parsedBudget.budgetMin,
    budgetMax: parsedBudget.budgetMax,
    currency: parsedBudget.currency,
    source: collapseWhitespace(payload.source),
    utm: payload.utm
      ? {
          source: collapseWhitespace(payload.utm.source),
          medium: collapseWhitespace(payload.utm.medium),
          campaign: collapseWhitespace(payload.utm.campaign)
        }
      : undefined,
    rawPayloadJson: JSON.stringify(rawPayload)
  };
};
