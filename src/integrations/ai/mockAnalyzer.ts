import type {
  AiLeadAnalysis,
  LeadClassification,
  NormalizedLead
} from "../../domain/lead.schema.js";

const urgencyWords = ["швидко", "терміново", "сьогодні"];
const spamMarkers = ["casino", "казино", "viagra", "crypto", "крипта", "spam"];
const serviceIntentWords = ["лендинг", "сайт", "crm", "розроб", "запуст", "дизайн", "бот"];

const priorityByClass: Record<LeadClassification, 1 | 2 | 3 | 4> = {
  hot: 1,
  warm: 2,
  cold: 3,
  spam: 4
};

const nextStepByClass: Record<LeadClassification, string> = {
  hot: "Звʼязатися протягом 1 години",
  warm: "Звʼязатися протягом доби",
  cold: "Надіслати уточнюючі питання",
  spam: "Не контактувати"
};

const firstSentence = (message: string | undefined) => {
  if (!message) return "Не визначено";
  return message.split(/[.!?]/u)[0]?.trim() || message;
};

const truncate = (value: string, maxLength: number) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

export const analyzeLeadWithMock = (lead: NormalizedLead): AiLeadAnalysis => {
  const text = `${lead.message ?? ""} ${lead.source ?? ""}`.toLowerCase();
  const urgencyWord = urgencyWords.find((word) => text.includes(word));
  const spamMarker = spamMarkers.find((word) => text.includes(word));
  const hasServiceIntent = serviceIntentWords.some((word) => text.includes(word));

  let classification: LeadClassification = "cold";
  let reason = "Mock-правило: короткий або нечіткий запит";

  if (spamMarker) {
    classification = "spam";
    reason = `Mock-правило: знайдено spam-маркер '${spamMarker}'`;
  } else if (urgencyWord) {
    classification = "hot";
    reason = `Mock-правило: знайдено слово терміновості '${urgencyWord}'`;
  } else if (hasServiceIntent) {
    classification = "warm";
    reason = "Mock-правило: знайдено зрозумілий сервісний намір";
  }

  const identity = lead.name ?? lead.company ?? "компанія";
  const message = truncate(lead.message ?? "без повідомлення", 120);

  return {
    summary: `Заявка від ${identity}: ${message}. Бюджет: ${lead.budgetRaw ?? "не вказано"}.`,
    classification,
    priority: priorityByClass[classification],
    need: firstSentence(lead.message),
    recommendedNextStep: nextStepByClass[classification],
    reason
  };
};
