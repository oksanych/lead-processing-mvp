import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server.js";
import { LeadProcessingError } from "../src/services/processLead.js";

const successResponse = {
  leadId: "lead_550e8400-e29b-41d4-a716-446655440000",
  status: "processed",
  classification: "hot",
  priority: 1,
  summary: "Клієнт шукає лендинг.",
  aiProviderUsed: "mock",
  sheet: {
    appended: true,
    updatedRange: "Leads!A2:X2"
  },
  telegram: {
    sent: true
  }
};

describe("createApp", () => {
  it("returns health status", async () => {
    const app = createApp({ processLead: vi.fn() });

    await request(app).get("/health").expect(200, { ok: true });
  });

  it("returns processed for a valid lead and includes CORS headers", async () => {
    const app = createApp({ processLead: vi.fn(async () => successResponse) });

    const response = await request(app)
      .post("/api/leads")
      .set("Origin", "https://example.com")
      .set("Content-Type", "application/json; charset=utf-8")
      .send({ phone: "+380671234567", message: "Потрібен лендинг" })
      .expect(200);

    expect(response.body).toEqual(successResponse);
    expect(response.headers["access-control-allow-origin"]).toBe("*");
  });

  it("returns 415 for non-JSON Content-Type", async () => {
    const app = createApp({ processLead: vi.fn() });

    await request(app)
      .post("/api/leads")
      .set("Content-Type", "text/plain")
      .send("hello")
      .expect(415, { error: "Unsupported Media Type" });
  });

  it("returns JSON 400 for malformed JSON", async () => {
    const app = createApp({ processLead: vi.fn() });

    const response = await request(app)
      .post("/api/leads")
      .set("Content-Type", "application/json")
      .send("{ bad json")
      .expect(400);

    expect(response.type).toBe("application/json");
    expect(response.body).toEqual({ error: "Invalid JSON" });
  });

  it("maps validation errors to 400", async () => {
    const app = createApp({
      processLead: vi.fn(async () => {
        throw new LeadProcessingError(400, "Validation failed");
      })
    });

    await request(app)
      .post("/api/leads")
      .set("Content-Type", "application/json")
      .send({ message: "Без контакту" })
      .expect(400, { error: "Validation failed" });
  });

  it("maps integration errors to 502", async () => {
    const app = createApp({
      processLead: vi.fn(async () => {
        throw new LeadProcessingError(502, "Google Sheets append failed");
      })
    });

    await request(app)
      .post("/api/leads")
      .set("Content-Type", "application/json")
      .send({ phone: "+380671234567" })
      .expect(502, { error: "Google Sheets append failed" });
  });

  it("returns JSON 429 after more than 10 requests per minute in an isolated app", async () => {
    const app = createApp({ processLead: vi.fn(async () => successResponse) });

    for (let index = 0; index < 10; index += 1) {
      await request(app)
        .post("/api/leads")
        .set("Content-Type", "application/json")
        .send({ phone: "+380671234567" })
        .expect(200);
    }

    await request(app)
      .post("/api/leads")
      .set("Content-Type", "application/json")
      .send({ phone: "+380671234567" })
      .expect(429, { error: "Too many requests" });
  });
});
