# MVP Lead Processing Implementation Plan

**Goal:** Build a working MVP that receives a landing-page lead JSON, normalizes it, creates an AI summary and lead classification, writes the result to Google Sheets, and sends a Telegram notification.

**Architecture:** A small Node.js + TypeScript Express API handles the whole flow synchronously. Deterministic code performs validation, contact normalization, and budget parsing; Gemini is used only for semantic summary/classification and has a mock fallback for no-cost local demo.

**Tech Stack:** Node.js 20+, TypeScript, Express, CORS, express-rate-limit, Zod, Google GenAI SDK, Google Sheets API, Telegram Bot API, Vitest, Supertest.

---

## 1. Scope And Decisions

This is intentionally an MVP, not a production-ready system.

In scope:

- Accept a JSON lead from a landing page.
- Validate and normalize lead data.
- Parse budget deterministically in code.
- Generate AI summary and classification.
- Append one row to Google Sheets.
- Send Telegram notification.
- Provide README, sample payload, and setup instructions.
- Add tests for validation, normalization, orchestration, and integration boundaries.

Out of scope:

- Authentication.
- Database persistence.
- Queues or background jobs.
- CRM integration.
- Deployment hardening.
- Deduplication.
- Complex retry policies.
- Admin UI.

Important decisions:

- Use `AI_PROVIDER=auto` as default: Gemini if `GEMINI_API_KEY` exists, otherwise mock analyzer.
- Keep `valueInputOption=RAW` for Google Sheets to reduce formula-injection risk.
- Parse budget in `normalizeLead.ts`, not with AI.
- Use `cors()` globally so browser landing pages can call the API.
- Use `express-rate-limit` on `/api/leads` to protect free-tier services.
- Use compact `JSON.stringify(payload)` for `raw_payload_json`.

Official references:

- Gemini structured output: <https://ai.google.dev/gemini-api/docs/structured-output>
- Gemini pricing/free tier: <https://ai.google.dev/gemini-api/docs/pricing>
- Google Sheets append: <https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append>
- Google Sheets limits: <https://developers.google.com/workspace/sheets/api/limits>
- Telegram `sendMessage`: <https://core.telegram.org/bots/api#sendmessage>

## 2. Repository Structure

Create this structure:

```text
.
├── README.md
├── .env.example
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── examples/
│   └── payload.json
├── src/
│   ├── server.ts
│   ├── config.ts
│   ├── domain/
│   │   ├── lead.schema.ts
│   │   └── normalizeLead.ts
│   ├── integrations/
│   │   ├── ai/
│   │   │   ├── geminiAnalyzer.ts
│   │   │   └── mockAnalyzer.ts
│   │   ├── sheetsClient.ts
│   │   └── telegramClient.ts
│   ├── routes/
│   │   └── leads.ts
│   └── services/
│       └── processLead.ts
└── tests/
    ├── lead.schema.test.ts
    ├── normalizeLead.test.ts
    ├── processLead.test.ts
    └── leads.route.test.ts
```

## 3. Public API

### `POST /api/leads`

Accepts JSON requests only. The implementation must use `req.is("application/json")` rather than strict header equality, so valid headers like `application/json; charset=utf-8` are accepted. Requests with another `Content-Type` (e.g. `text/plain`, `application/x-www-form-urlencoded`) get `415 Unsupported Media Type`. Without this explicit check `express.json()` silently skips parsing and the client would get a misleading `400` about missing contact fields.

At least one contact field is required: `email` or `phone`.

Example request:

```json
{
  "name": "Ірина Коваленко",
  "phone": "+38 (067) 123-45-67",
  "email": "iryna@example.com",
  "company": "Kovalenko Beauty",
  "message": "Хочу лендинг для салону краси. Бюджет приблизно 2000-3000$, потрібно запустити швидко.",
  "budget": "2000-3000$",
  "source": "landing-main",
  "utm": {
    "source": "facebook",
    "medium": "cpc",
    "campaign": "summer-offer"
  }
}
```

Example success response:

```json
{
  "leadId": "lead_550e8400-e29b-41d4-a716-446655440000",
  "status": "processed",
  "classification": "hot",
  "priority": 1,
  "summary": "Потенційний клієнт шукає швидкий запуск лендингу для салону краси з бюджетом 2000-3000$.",
  "aiProviderUsed": "gemini",
  "sheet": {
    "appended": true,
    "updatedRange": "Leads!A2:X2"
  },
  "telegram": {
    "sent": true
  }
}
```

Error responses:

- `400`: invalid JSON, invalid email format, or missing both `email` and `phone`.
- `415`: `Content-Type` is not `application/json`.
- `429`: rate limit exceeded.
- `502`: Gemini required but failed, or Google Sheets append failed.
- `500`: unexpected server error.

## 4. Environment

Create `.env.example`:

```bash
PORT=3000
AI_PROVIDER=auto
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
GOOGLE_SHEETS_SPREADSHEET_ID=
GOOGLE_SHEETS_RANGE=Leads!A:X
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Behavior:

- `AI_PROVIDER=auto`: use Gemini when `GEMINI_API_KEY` exists, otherwise use mock.
- `AI_PROVIDER=mock`: never call Gemini.
- `AI_PROVIDER=gemini`: fail with `502` if Gemini is unavailable or returns invalid JSON.

Google key handling:

```ts
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
```

## 5. Validation And Normalization

### Zod Input Schema

Use preprocessing so empty strings from HTML forms behave like absent fields.

```ts
import { z } from "zod";

const emptyToUndefined = (value: unknown) => {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
};

const optionalTrimmedString = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional()
);

export const leadInputSchema = z.object({
  name: optionalTrimmedString,
  email: z.preprocess(
    emptyToUndefined,
    z.string().trim().email().optional()
  ),
  phone: optionalTrimmedString,
  company: optionalTrimmedString,
  message: optionalTrimmedString,
  budget: optionalTrimmedString,
  source: optionalTrimmedString,
  utm: z.object({
    source: optionalTrimmedString,
    medium: optionalTrimmedString,
    campaign: optionalTrimmedString
  }).optional()
}).refine((data) => Boolean(data.email || data.phone), {
  message: "Either email or phone must be provided",
  path: ["email"]
});
```

### Normalization Rules

Normalize these fields in `src/domain/normalizeLead.ts`:

- `email`: trim and lowercase.
- `phoneRaw`: preserve original phone string.
- `phoneNormalized`: parse with `libphonenumber-js`; return E.164 if valid, otherwise `null`.
- `name`, `company`, `message`, `source`, `utm`: trim and collapse repeated whitespace.
- `receivedAt`: ISO string from `new Date().toISOString()`.
- `leadId`: `"lead_" + crypto.randomUUID()`.
- `rawPayloadJson`: `JSON.stringify(payload)`, compact, no indentation.

### Budget Parsing

Budget parsing must be deterministic and tested in `normalizeLead.ts`.

Rules:

| Input | budgetMin | budgetMax | currency |
| --- | ---: | ---: | --- |
| `2000-3000$` | `2000` | `3000` | `USD` |
| `$2000 - $3000` | `2000` | `3000` | `USD` |
| `від 50000 грн` | `50000` | `null` | `UAH` |
| `2000 до 3000 грн` | `2000` | `3000` | `UAH` |
| `до 1000 eur` | `null` | `1000` | `EUR` |
| `500 usd` | `500` | `null` | `USD` |
| `домовимось` | `null` | `null` | `null` |

Implementation approach:

- Normalize currency tokens:
  - `$`, `usd`, `дол`, `долар` -> `USD`
  - `грн`, `uah`, `₴` -> `UAH`
  - `eur`, `€`, `євро` -> `EUR`
- Remove spaces inside numbers: `50 000` -> `50000`.
- Detect range with separators `-`, `–`, `—`, `to`, `до`.
- Detect lower bound with prefixes `від`, `from`.
- Detect upper bound with prefixes `до`, `up to`.
- Parsing order matters because `до` is both a range separator and an upper-bound prefix. Check in this order:
  1. Range pattern `<number> <sep> <number>` (e.g. `2000 до 3000`, `2000-3000`) -> min and max.
  2. Upper-bound prefix before a single number (`до 1000 eur`) -> max only.
  3. Lower-bound prefix before a single number (`від 50000 грн`) -> min only.
  4. Bare single number (`500 usd`) -> min only.
- Single-value semantics: a bare amount like `500 usd` is treated as a lower bound (`budgetMin=500`, `budgetMax=null`), since leads typically state the amount they are ready to start from. Document this decision in the README.
- If parsing is ambiguous, preserve `budgetRaw` and set parsed numeric fields to `null`.

Gemini must not be responsible for numeric budget parsing. It can see both raw and parsed budget values and use them for classification.

## 6. AI Summary And Classification

### AI Result Schema

```ts
export const aiLeadAnalysisSchema = z.object({
  summary: z.string().min(1),
  classification: z.enum(["hot", "warm", "cold", "spam"]),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  need: z.string().min(1),
  recommendedNextStep: z.string().min(1),
  reason: z.string().min(1)
});
```

Classification guidance:

- `hot`: clear need, valid contact, urgency or meaningful budget.
- `warm`: clear need and valid contact, but no urgency.
- `cold`: vague request, still looks legitimate.
- `spam`: irrelevant, abusive, suspicious, or no real business intent.

Gemini prompt:

- Input: normalized lead JSON.
- Output: strict JSON matching `aiLeadAnalysisSchema`, enforced with `responseMimeType: "application/json"` and a matching `responseSchema` in the request config (Gemini supports a JSON-schema subset; keep the schema flat with string/enum/integer fields). For `priority`, use an integer enum with values `[1, 2, 3, 4]`, matching the Zod schema exactly. The response is still parsed and validated with Zod before use.
- Language: Ukrainian summary and next step.
- Do not invent missing facts.
- Mention uncertainty in `reason` when data is incomplete.

Mock analyzer:

- If message contains urgency words like `швидко`, `терміново`, `сьогодні`, return `hot`.
- If message has clear service intent but no urgency, return `warm`.
- If message is very short or vague, return `cold`.
- If message includes obvious spam markers, return `spam`.
- The mock must return **every** field of `aiLeadAnalysisSchema`, not only `classification`:
  - `priority`: map `hot -> 1`, `warm -> 2`, `cold -> 3`, `spam -> 4`.
  - `summary`: deterministic template from normalized fields, e.g. `"Заявка від <name/компанія>: <перші ~120 символів message>. Бюджет: <budgetRaw або 'не вказано'>."`.
  - `need`: first sentence of the message, or `"Не визначено"` when the message is missing.
  - `recommendedNextStep`: by class — `hot` -> `"Звʼязатися протягом 1 години"`, `warm` -> `"Звʼязатися протягом доби"`, `cold` -> `"Надіслати уточнюючі питання"`, `spam` -> `"Не контактувати"`.
  - `reason`: template naming the triggered rule, e.g. `"Mock-правило: знайдено слово терміновості 'швидко'"`.

## 7. Google Sheets

Use `spreadsheets.values.append`.

Settings:

- Auth: service-account JWT with scope `https://www.googleapis.com/auth/spreadsheets`.
- `spreadsheetId`: `GOOGLE_SHEETS_SPREADSHEET_ID`
- `range`: `GOOGLE_SHEETS_RANGE`, default `Leads!A:X` (24 columns)
- `valueInputOption`: `RAW`
- `insertDataOption`: `INSERT_ROWS`

Sheet columns:

```text
lead_id, received_at, name, phone_raw, phone_normalized, email, company, message, budget_raw, budget_min, budget_max, currency, source, utm_source, utm_medium, utm_campaign, ai_provider_used, ai_summary, lead_class, priority, need, next_step, ai_reason, raw_payload_json
```

Notes:

- The row intentionally has no `telegram_status` column: the Telegram notification is sent **after** the Sheets append (a Sheets failure must block Telegram), so the send result is unknown at append time. Telegram status is reported only in the API response (`telegram.sent`). Updating the cell afterwards via `values.update` is out of scope for the MVP.
- `RAW` reduces formula-injection risk if a user submits text beginning with `=`, `+`, `-`, or `@`.
- Numeric values like `budget_min` and `budget_max` should be sent as numbers, not strings.
- ISO dates may display as text in Sheets, which is acceptable for MVP.
- `raw_payload_json` must be one compact string.
- The README must tell the user to share the Google Sheet with `GOOGLE_SERVICE_ACCOUNT_EMAIL`.

## 8. Telegram Notification

Use Telegram Bot API `sendMessage`.

Message format: plain text, no Markdown parse mode. This avoids escaping bugs from user-submitted text.

Include:

- Lead class and priority.
- Name/company.
- Phone/email.
- Budget raw and parsed budget.
- AI summary.
- Recommended next step.
- Google Sheet append status.

Constraints:

- Telegram `text` limit is 1-4096 characters after parsing.
- Truncate message to 3900 characters to leave margin.
- If Telegram fails, the API response still succeeds with `telegram.sent=false`.

## 9. Server Middleware

In `src/server.ts`:

- `app.use(cors())`
- On `POST /api/leads`, before body parsing: if `req.is("application/json")` is false, return `415` with a JSON error body (otherwise `express.json()` silently skips the body and Zod produces a misleading `400`). This must accept `application/json; charset=utf-8`.
- `app.use("/api/leads", rateLimit({ windowMs: 60_000, limit: 10, handler: (_req, res) => res.status(429).json({ error: "Too many requests" }) }))`
- `app.use(express.json({ limit: "100kb" }))`
- A JSON parse error handler registered **after** `express.json()`: malformed JSON makes Express throw a `SyntaxError` with `status=400`, which by default renders an HTML error page. Catch it in error middleware and return `400` with a JSON body like `{ "error": "Invalid JSON" }`.
- `GET /health` returns `{ "ok": true }`
- Register `POST /api/leads`

Middleware order for `POST /api/leads` should be: CORS -> content-type check -> rate limit -> JSON parser -> malformed JSON handler -> route. This rejects unsupported or excessive requests before spending CPU on body parsing.

CORS is required because the landing page frontend may run on another origin.

Rate limiting protects:

- Gemini free tier.
- Telegram bot.
- Google Sheet from spam rows.

## 10. Failure Behavior

| Case | HTTP Status | Behavior |
| --- | ---: | --- |
| Invalid JSON | `400` | Return validation error |
| Non-JSON `Content-Type` | `415` | Return unsupported media type error |
| Missing both email and phone | `400` | Return validation error |
| Rate limit exceeded | `429` | Return rate limit error |
| Gemini fails in `auto` mode | `200` if Sheets succeeds | Use mock analyzer and set `aiProviderUsed=mock` |
| Gemini fails in `gemini` mode | `502` | Do not write to Sheets |
| Sheets append fails | `502` | Do not send Telegram |
| Telegram send fails | `200` | Lead remains stored; return `telegram.sent=false` |

## 11. Implementation Tasks

### Task 1: Project Setup

- [ ] Create `package.json` with `"type": "module"` (the `@google/genai` quickstart and modern tooling assume ESM) and scripts:

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] Install runtime dependencies:

```bash
npm install express cors express-rate-limit zod dotenv @google/genai googleapis libphonenumber-js
```

- [ ] Install dev dependencies:

```bash
npm install -D typescript tsx vitest supertest @types/express @types/cors @types/supertest @types/node
```

- [ ] Add `tsconfig.json` with strict TypeScript and ESM settings: `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"target": "ES2022"`, `"lib": ["ES2022"]`, `"strict": true`, `"outDir": "dist"`. `DOM` lib is not needed: global `fetch` in Node 20 is typed by `@types/node`.
- [ ] **Important NodeNext caveat:** all relative imports in `.ts` source must use the `.js` extension (e.g. `import { normalizeLead } from "../domain/normalizeLead.js"`). `tsx`/Vitest tolerate missing extensions, but the compiled `node dist/server.js` crashes with `ERR_MODULE_NOT_FOUND` without them — so `npm run build && npm start` must be part of acceptance.
- [ ] Add `vitest.config.ts`.

### Task 2: Config

- [ ] Create `src/config.ts`.
- [ ] Validate `AI_PROVIDER` as `auto | mock | gemini`.
- [ ] Default `PORT=3000`.
- [ ] Default `GEMINI_MODEL=gemini-3.5-flash`.
- [ ] Default `GOOGLE_SHEETS_RANGE=Leads!A:X`.
- [ ] Normalize `GOOGLE_PRIVATE_KEY` newlines.
- [ ] Do not require `GEMINI_API_KEY` when `AI_PROVIDER=auto` or `mock`.
- [ ] Require Google Sheets and Telegram env vars for real end-to-end run.

### Task 3: Lead Schemas

- [ ] Create `src/domain/lead.schema.ts`.
- [ ] Implement input schema with empty-string preprocessing.
- [ ] Implement `.refine()` requiring `email` or `phone`.
- [ ] Export TypeScript types with `z.infer`.
- [ ] Add AI result schema.
- [ ] Add tests for valid payload, empty strings, invalid email, and missing contact.

### Task 4: Normalization

- [ ] Create `src/domain/normalizeLead.ts`.
- [ ] Implement whitespace cleanup.
- [ ] Normalize email.
- [ ] Normalize Ukrainian/international phone values with `libphonenumber-js`.
- [ ] Implement deterministic budget parser.
- [ ] Preserve raw values.
- [ ] Add tests for all budget examples in this plan.

### Task 5: AI Analyzers

- [ ] Create `mockAnalyzer.ts`.
- [ ] Create `geminiAnalyzer.ts`.
- [ ] In Gemini analyzer, enable structured output via `config: { responseMimeType: "application/json", responseSchema: <Gemini schema> }`, then still validate the parsed response with `aiLeadAnalysisSchema` (Zod is the source of truth; the Gemini schema is a best-effort constraint).
- [ ] In the Gemini `responseSchema`, define `priority` as an integer enum with values `[1, 2, 3, 4]`, not a free-form number.
- [ ] In mock analyzer, return deterministic results from normalized lead text.
- [ ] Add tests for mock behavior and invalid Gemini output handling.

### Task 6: Google Sheets Client

- [ ] Create `src/integrations/sheetsClient.ts`.
- [ ] Authenticate with service account email/private key (JWT) with explicit scope `https://www.googleapis.com/auth/spreadsheets`; without this scope the append call fails with an auth/permission error.
- [ ] Append one row in the exact sheet column order.
- [ ] Use `RAW` and `INSERT_ROWS`.
- [ ] Return `updatedRange` from Sheets response.
- [ ] Add tests with mocked Google client to verify row mapping.

### Task 7: Telegram Client

- [ ] Create `src/integrations/telegramClient.ts`.
- [ ] Send plain-text POST to Telegram `sendMessage`.
- [ ] Include lead class, contact, summary, and next step.
- [ ] Truncate text to stay below 4096 characters.
- [ ] Add tests for message content and failure behavior.

### Task 8: Processing Service

- [ ] Create `src/services/processLead.ts`.
- [ ] Orchestrate validation result, normalization, AI analysis, sheet append, and Telegram send.
- [ ] Ensure Sheets failure stops before Telegram.
- [ ] Ensure Telegram failure does not fail the stored lead.
- [ ] Add tests for `auto`, `mock`, `gemini`, Sheets failure, and Telegram failure.

### Task 9: Express Routes

- [ ] Create `src/routes/leads.ts`.
- [ ] Add error middleware that returns JSON `400` for malformed-JSON `SyntaxError` from `express.json()`.
- [ ] Return `415` for non-JSON `Content-Type` on `POST /api/leads`, using `req.is("application/json")` so `application/json; charset=utf-8` remains valid.
- [ ] Configure `express-rate-limit` with a JSON `429` handler: `{ "error": "Too many requests" }`.
- [ ] Map validation errors to `400`.
- [ ] Map rate-limit errors to `429`.
- [ ] Map integration failures to `502`.
- [ ] Return the success response shape from this plan.
- [ ] Export an app factory (`createApp()`), so each test file gets its own Express app with a fresh in-memory rate limiter; otherwise the shared limiter leaks `429` responses into unrelated tests.
- [ ] Add Supertest coverage for `/health`, successful POST, CORS headers, validation errors, malformed JSON, and rate limit (rate-limit test in its own isolated app instance).

### Task 10: README And Example Payload

- [ ] Create `examples/payload.json` using the example from this plan.
- [ ] Create `.env.example`.
- [ ] Write README with:
  - Project purpose.
  - Architecture summary.
  - Setup steps.
  - How to create Telegram bot and get chat ID.
  - How to create/share Google Sheet with service account.
  - How to create a sheet tab named exactly `Leads` and add the 24-column header row from section 7 (the `append` call fails or writes to the wrong place without the tab).
  - Budget parsing semantics, including why a bare amount (`500 usd`) is treated as a lower bound.
  - How to run mock mode.
  - How to run Gemini mode.
  - Curl command.
  - Expected Google Sheet row and Telegram notification.
  - Notes about MVP limitations and free-tier privacy.

## 12. Test Plan

Automated tests:

- Valid lead returns `processed`.
- Malformed JSON body returns `400` with a JSON error response.
- Non-JSON `Content-Type` returns `415`.
- Missing both `email` and `phone` returns `400`.
- Empty strings are treated as absent fields.
- CORS headers are present.
- More than 10 requests/min/IP returns `429` with JSON body `{ "error": "Too many requests" }` (run against an isolated app instance so the limiter does not leak into other tests).
- Email is trimmed and lowercased.
- Phone normalizes to E.164 when valid.
- Invalid phone keeps raw value and sets normalized phone to `null`.
- Budget examples parse exactly as specified.
- `AI_PROVIDER=mock` never calls Gemini.
- `AI_PROVIDER=auto` falls back to mock if Gemini key is missing or Gemini response is invalid.
- `AI_PROVIDER=gemini` returns `502` if Gemini fails.
- Sheets append uses `RAW`, `INSERT_ROWS`, and compact `raw_payload_json`.
- Sheets failure skips Telegram and returns `502`.
- Telegram failure does not fail the whole request.
- Telegram text stays under 4096 characters.

Manual acceptance:

```bash
npm install
cp .env.example .env
npm run dev
curl -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  --data @examples/payload.json

# Verify the compiled ESM build also runs (catches missing .js import extensions):
npm run build && npm start
```

Verify:

- API returns `status=processed`.
- Google Sheets receives a new row.
- Telegram receives a notification.
- README explains the logic clearly enough for reviewer handoff.

## 13. Submission Checklist

Provide:

- GitHub repository link with view access.
- Google Sheet view link if safe to share.
- README link.
- Example payload.
- Short description of the processing logic.
- Candidate contact phone and email in the final message.

Suggested submission message:

```text
Добрий день!

Підготував MVP для обробки заявки з лендингу:
- прийом JSON payload;
- валідація і нормалізація даних;
- AI-summary та класифікація ліда;
- запис результату в Google Sheets;
- Telegram-сповіщення;
- README з інструкцією запуску і тестовим payload.

Посилання на репозиторій: <GitHub repo URL>
Посилання на таблицю: <Google Sheet URL>

Контактний телефон: <your phone>
Email: <your email>
```

## 14. Known MVP Limitations

- No authentication, so this should not be deployed publicly without additional protection.
- In-memory rate limiting resets on process restart and does not work across multiple instances.
- No durable queue, so if Sheets is unavailable the lead is not persisted elsewhere.
- Gemini free tier can use submitted content for product improvement; avoid sensitive real lead data in demo mode.
- Google Sheets is used as a simple visibility layer, not a robust database.
