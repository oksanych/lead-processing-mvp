import { GoogleGenAI, Type } from "@google/genai";
import {
  aiLeadAnalysisSchema,
  type AiLeadAnalysis,
  type NormalizedLead
} from "../../domain/lead.schema.js";

export interface GeminiAnalyzerConfig {
  apiKey: string;
  model: string;
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    classification: { type: Type.STRING, enum: ["hot", "warm", "cold", "spam"] },
    priority: { type: Type.INTEGER, format: "enum", enum: ["1", "2", "3", "4"] },
    need: { type: Type.STRING },
    recommendedNextStep: { type: Type.STRING },
    reason: { type: Type.STRING }
  },
  required: ["summary", "classification", "priority", "need", "recommendedNextStep", "reason"]
};

export const analyzeLeadWithGemini = async (
  lead: NormalizedLead,
  config: GeminiAnalyzerConfig
): Promise<AiLeadAnalysis> => {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const response = await ai.models.generateContent({
    model: config.model,
    contents: [
      "Проаналізуй normalized lead JSON для MVP lead processing.",
      "Поверни лише strict JSON українською мовою згідно зі schema.",
      "Не вигадуй відсутні факти. Якщо даних мало, вкажи невизначеність у reason.",
      "Для бюджету поля budgetRaw, budgetMin, budgetMax, currency є джерелом істини. Якщо message містить інший бюджет, не використовуй його як поточний бюджет.",
      JSON.stringify(lead)
    ].join("\n")
    ,
    config: {
      responseMimeType: "application/json",
      responseSchema
    }
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  return aiLeadAnalysisSchema.parse(JSON.parse(text));
};
