# Lead Processing MVP

Small Node.js + TypeScript Express API for landing-page leads. It validates and normalizes a JSON lead, parses budget deterministically, asks AI for semantic summary/classification, appends one row to Google Sheets, and sends a Telegram notification.

Ukrainian version: [README.uk.md](README.uk.md).

This is intentionally an MVP: no auth, database, queue, deduplication, CRM sync, admin UI, or production hardening.

## Architecture

- `POST /api/leads` accepts JSON only.
- Zod validates the input and requires at least `email` or `phone`.
- `normalizeLead` lowercases email, normalizes phone to E.164 when possible, collapses whitespace, generates `lead_*` IDs, stores compact raw JSON, and parses budget in code.
- AI provider selection:
  - `AI_PROVIDER=auto`: Gemini when `GEMINI_API_KEY` exists, otherwise mock.
  - `AI_PROVIDER=mock`: deterministic local analyzer, no Gemini key needed.
  - `AI_PROVIDER=gemini`: Gemini is required; Gemini failures return `502`.
- Google Sheets append happens before Telegram. If Sheets fails, Telegram is skipped. If Telegram fails, the lead remains processed and the API returns `telegram.sent=false`.

## Setup

```bash
npm install
cp .env.example .env
```

Fill `.env` with real values when you want the full flow:

```bash
PORT=3000
AI_PROVIDER=mock
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
GOOGLE_SHEETS_SPREADSHEET_ID=your-sheet-id
GOOGLE_SHEETS_RANGE=Leads!A:X
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
TELEGRAM_BOT_TOKEN=123456:token
TELEGRAM_CHAT_ID=123456789
```

Do not commit `.env` or real secrets.

## Run

```bash
npm run dev
```

Compiled ESM build:

```bash
npm run build
npm start
```

Health check:

```bash
curl http://localhost:3000/health
```

## Mock Mode

Set:

```bash
AI_PROVIDER=mock
```

Mock mode never calls Gemini and does not need `GEMINI_API_KEY`. It still writes to Google Sheets and attempts Telegram notification, so the Sheets and Telegram variables are needed for a real end-to-end run.

Mock classification rules:

- urgency words like `швидко`, `терміново`, `сьогодні` -> `hot`;
- clear service intent without urgency -> `warm`;
- short or vague legitimate text -> `cold`;
- obvious spam markers -> `spam`.

## Gemini Mode

Set:

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-3.5-flash
```

`GEMINI_MODEL` defaults to `gemini-3.5-flash` in code. If that model is unavailable for your API key, set this variable to a Gemini model available in your account.

The Gemini analyzer requests strict JSON with `responseMimeType: "application/json"` and a flat `responseSchema`. The response is still parsed and validated with Zod before use. In `AI_PROVIDER=auto`, Gemini errors fall back to mock. In `AI_PROVIDER=gemini`, Gemini errors return `502` and the lead is not written to Sheets.

## Google Sheets

Create a Google Sheet and a tab named exactly:

```text
Leads
```

Add this 24-column header row:

```text
lead_id, received_at, name, phone_raw, phone_normalized, email, company, message, budget_raw, budget_min, budget_max, currency, source, utm_source, utm_medium, utm_campaign, ai_provider_used, ai_summary, lead_class, priority, need, next_step, ai_reason, raw_payload_json
```

You can also use [examples/google-sheets-template.csv](examples/google-sheets-template.csv) as a ready header template for the `Leads` tab.

Create a Google Cloud service account with Sheets API access. Share the Google Sheet with `GOOGLE_SERVICE_ACCOUNT_EMAIL`; otherwise append will fail with a permission error.

The API uses `spreadsheets.values.append` with:

- `range=GOOGLE_SHEETS_RANGE` defaulting to `Leads!A:X`;
- `valueInputOption=RAW`;
- `insertDataOption=INSERT_ROWS`.

`RAW` reduces formula-injection risk for user text that starts with characters such as `=`, `+`, `-`, or `@`. Numeric budget values are sent as numbers. `raw_payload_json` is one compact JSON string.

## Telegram

Create a bot via BotFather and put its token in:

```bash
TELEGRAM_BOT_TOKEN=
```

To get `TELEGRAM_CHAT_ID`, send a message to the bot, then call:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates"
```

Use the `chat.id` value from the response. Telegram messages are sent as plain text without Markdown parse mode and are truncated to 3900 characters.

## Budget Parsing

Budget is parsed deterministically in `normalizeLead.ts`, not by AI.
UAH is recognized from `грн`, `uah`, `₴`, and full Ukrainian forms such as `гривень`, `гривня`, and `гривні`.

Examples:

| Input | Min | Max | Currency |
| --- | ---: | ---: | --- |
| `2000-3000$` | `2000` | `3000` | `USD` |
| `$2000 - $3000` | `2000` | `3000` | `USD` |
| `від 50000 грн` | `50000` | | `UAH` |
| `2000 до 3000 грн` | `2000` | `3000` | `UAH` |
| `до 1000 eur` | | `1000` | `EUR` |
| `500 usd` | `500` | | `USD` |
| `домовимось` | | | |

A bare amount like `500 usd` is treated as a lower bound (`budget_min=500`, `budget_max=null`) because leads often state the amount they are ready to start from.

## Curl Example

```bash
curl -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  --data @examples/payload.json
```

Expected success shape:

```json
{
  "leadId": "lead_...",
  "status": "processed",
  "classification": "hot",
  "priority": 1,
  "summary": "...",
  "aiProviderUsed": "mock",
  "sheet": {
    "appended": true,
    "updatedRange": "Leads!A2:X2"
  },
  "telegram": {
    "sent": true
  }
}
```

Manual checks:

- API returns `status=processed`.
- Google Sheets receives one row with the 24 columns above.
- Telegram receives a notification with class, priority, contact, budget, AI summary, next step, and sheet status.

## API Errors

- `400`: malformed JSON, invalid email, or missing both `email` and `phone`.
- `415`: non-JSON `Content-Type`.
- `429`: more than 10 `/api/leads` requests per minute per IP.
- `502`: Gemini required but failed, or Google Sheets append failed.
- `500`: unexpected server error.

## Tests

```bash
npm test
npm run build
```

The test suite covers schema validation, empty string handling, email and phone normalization, all budget examples, mock and Gemini fallback behavior, Sheets row mapping, Telegram failure behavior, malformed JSON, non-JSON content type, CORS, and rate limiting.

## Reviewer Test Guide

Use these steps to verify the MVP locally from the terminal.

1. Install dependencies:

```bash
npm install
```

2. Run automated checks:

```bash
npm test
npm run build
```

Both commands should pass.

3. Create `.env` from `.env.example` and start with mock AI:

```bash
cp .env.example .env
```

Set at minimum:

```bash
PORT=3000
AI_PROVIDER=mock
GOOGLE_SHEETS_SPREADSHEET_ID=<sheet-id>
GOOGLE_SHEETS_RANGE=Leads!A:X
GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email>
GOOGLE_PRIVATE_KEY="<private-key-with-\n-line-breaks>"
TELEGRAM_BOT_TOKEN=<bot-token>
TELEGRAM_CHAT_ID=<chat-id>
```

`GEMINI_API_KEY` is not needed for `AI_PROVIDER=mock`.

4. Prepare Google Sheets:

- create a tab named `Leads`;
- add the 24-column header from the Google Sheets section above;
- share the sheet with `GOOGLE_SERVICE_ACCOUNT_EMAIL`.

5. Start the compiled app:

```bash
npm start
```

6. In another terminal, submit the example lead:

```bash
curl -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  --data @examples/payload.json
```

Expected result:

- API returns `status: "processed"`;
- `aiProviderUsed` is `mock`;
- one row appears in Google Sheets with 24 columns;
- Telegram receives a notification;
- if Telegram fails, the API can still return success after the lead is saved to Sheets.

7. Check required error cases:

```bash
curl -i -X POST http://localhost:3000/api/leads \
  -H "Content-Type: text/plain" \
  --data "hello"
```

Expected: `415` JSON response.

```bash
curl -i -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  --data '{"name":'
```

Expected: `400` JSON response.

Rate limit can be verified by sending more than 10 valid requests within one minute from the same IP. Expected: `429` JSON response.

8. Optional Gemini check:

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=<gemini-key>
GEMINI_MODEL=<available-gemini-model>
```

Restart the app and send `examples/payload.json` again. Expected: the lead is analyzed by Gemini and saved to the same Google Sheet.

## MVP Limitations

- No authentication, so do not deploy publicly without additional protection.
- In-memory rate limiting resets on process restart and does not work across multiple instances.
- No durable queue; if Sheets is unavailable, the lead is not persisted elsewhere.
- Gemini free tier can use submitted content for product improvement; avoid sensitive real lead data in demo mode.
- Google Sheets is a simple visibility layer, not a robust database.
