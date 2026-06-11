# Lead Processing MVP

Невеликий Node.js + TypeScript Express API для обробки лідів із landing page. API приймає JSON, валідує і нормалізує дані, детерміновано парсить бюджет, формує AI summary/classification, додає один рядок у Google Sheets і надсилає Telegram notification.

English version: [README.md](README.md).

Це навмисно MVP: без auth, бази даних, черги, deduplication, CRM sync, admin UI або production hardening.

## Архітектура

- `POST /api/leads` приймає тільки JSON.
- Zod валідує payload і вимагає хоча б `email` або `phone`.
- `normalizeLead` приводить email до lowercase, нормалізує phone в E.164 якщо можливо, прибирає зайві пробіли, генерує `lead_*` ID, зберігає compact raw JSON і парсить budget у коді.
- Вибір AI provider:
  - `AI_PROVIDER=auto`: Gemini, якщо є `GEMINI_API_KEY`; інакше mock.
  - `AI_PROVIDER=mock`: детермінований локальний analyzer, Gemini key не потрібен.
  - `AI_PROVIDER=gemini`: Gemini обов'язковий; помилки Gemini повертають `502`.
- Google Sheets append виконується перед Telegram. Якщо Sheets падає, Telegram не надсилається. Якщо Telegram падає, lead залишається обробленим і API повертає `telegram.sent=false`.

## Налаштування

```bash
npm install
cp .env.example .env
```

Заповни `.env` реальними значеннями, якщо потрібен повний end-to-end flow:

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

Не коміть `.env` або реальні секрети.

## Запуск

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

Встанови:

```bash
AI_PROVIDER=mock
```

Mock mode ніколи не викликає Gemini і не потребує `GEMINI_API_KEY`. Він все одно пише в Google Sheets і пробує надіслати Telegram notification, тому Sheets і Telegram змінні потрібні для реального end-to-end запуску.

Правила mock classification:

- слова терміновості на кшталт `швидко`, `терміново`, `сьогодні` -> `hot`;
- зрозумілий запит на послугу без терміновості -> `warm`;
- короткий або нечіткий, але схожий на справжній запит текст -> `cold`;
- очевидні spam markers -> `spam`.

## Gemini Mode

Встанови:

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-3.5-flash
```

`GEMINI_MODEL` за замовчуванням у коді дорівнює `gemini-3.5-flash`. Якщо ця модель недоступна для твого API key, встанови модель Gemini, доступну у твоєму акаунті.

Gemini analyzer запитує strict JSON через `responseMimeType: "application/json"` і flat `responseSchema`. Відповідь додатково парситься і валідується через Zod. У `AI_PROVIDER=auto` помилки Gemini переводять обробку на mock. У `AI_PROVIDER=gemini` помилки Gemini повертають `502`, і lead не записується в Sheets.

## Google Sheets

Створи Google Sheet і вкладку з точною назвою:

```text
Leads
```

Додай header row із 24 колонками:

```text
lead_id, received_at, name, phone_raw, phone_normalized, email, company, message, budget_raw, budget_min, budget_max, currency, source, utm_source, utm_medium, utm_campaign, ai_provider_used, ai_summary, lead_class, priority, need, next_step, ai_reason, raw_payload_json
```

Можна використати [examples/google-sheets-template.csv](examples/google-sheets-template.csv) як готовий template для вкладки `Leads`.

Створи Google Cloud service account із доступом до Sheets API. Пошир доступ до Google Sheet на `GOOGLE_SERVICE_ACCOUNT_EMAIL`; інакше append впаде з permission error.

API використовує `spreadsheets.values.append` з:

- `range=GOOGLE_SHEETS_RANGE`, default `Leads!A:X`;
- `valueInputOption=RAW`;
- `insertDataOption=INSERT_ROWS`.

`RAW` зменшує ризик formula injection для user text, який починається з `=`, `+`, `-` або `@`. Numeric budget values відправляються як numbers. `raw_payload_json` це один compact JSON string.

## Telegram

Створи bot через BotFather і додай token у:

```bash
TELEGRAM_BOT_TOKEN=
```

Щоб отримати `TELEGRAM_CHAT_ID`, надішли повідомлення боту, потім виконай:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates"
```

Візьми `chat.id` із response. Telegram messages надсилаються plain text без Markdown parse mode і обрізаються до 3900 characters.

## Budget Parsing

Budget парситься детерміновано в `normalizeLead.ts`, не AI.
UAH розпізнається з `грн`, `uah`, `₴`, а також із повних українських форм `гривень`, `гривня` і `гривні`.

Приклади:

| Input | Min | Max | Currency |
| --- | ---: | ---: | --- |
| `2000-3000$` | `2000` | `3000` | `USD` |
| `$2000 - $3000` | `2000` | `3000` | `USD` |
| `від 50000 грн` | `50000` | | `UAH` |
| `2000 до 3000 грн` | `2000` | `3000` | `UAH` |
| `до 1000 eur` | | `1000` | `EUR` |
| `500 usd` | `500` | | `USD` |
| `домовимось` | | | |

Bare amount на кшталт `500 usd` трактується як lower bound (`budget_min=500`, `budget_max=null`), бо leads часто вказують суму, з якої готові стартувати.

## Curl Example

```bash
curl -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  --data @examples/payload.json
```

Очікувана форма успішної відповіді:

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

Ручна перевірка:

- API повертає `status=processed`.
- Google Sheets отримує один row із 24 columns вище.
- Telegram отримує notification з class, priority, contact, budget, AI summary, next step і sheet status.

## API Errors

- `400`: malformed JSON, invalid email або missing both `email` and `phone`.
- `415`: non-JSON `Content-Type`.
- `429`: більше ніж 10 `/api/leads` requests per minute per IP.
- `502`: Gemini required but failed або Google Sheets append failed.
- `500`: unexpected server error.

## Tests

```bash
npm test
npm run build
```

Test suite покриває schema validation, empty string handling, email і phone normalization, budget examples, mock і Gemini fallback behavior, Sheets row mapping, Telegram failure behavior, malformed JSON, non-JSON content type, CORS і rate limiting.

## Reviewer Test Guide

Використай ці кроки для локальної перевірки MVP через terminal.

1. Встанови dependencies:

```bash
npm install
```

2. Запусти automated checks:

```bash
npm test
npm run build
```

Обидві команди мають пройти.

3. Створи `.env` із `.env.example` і стартуй з mock AI:

```bash
cp .env.example .env
```

Мінімально встанови:

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

`GEMINI_API_KEY` не потрібен для `AI_PROVIDER=mock`.

4. Підготуй Google Sheets:

- створи вкладку `Leads`;
- додай 24-column header із Google Sheets section вище;
- пошир доступ до sheet на `GOOGLE_SERVICE_ACCOUNT_EMAIL`.

5. Запусти compiled app:

```bash
npm start
```

6. В іншому terminal відправ example lead:

```bash
curl -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  --data @examples/payload.json
```

Очікуваний результат:

- API повертає `status: "processed"`;
- `aiProviderUsed` дорівнює `mock`;
- один row з'являється в Google Sheets із 24 columns;
- Telegram отримує notification;
- якщо Telegram fail-иться, API все одно може повернути success після збереження lead у Sheets.

7. Перевір required error cases:

```bash
curl -i -X POST http://localhost:3000/api/leads \
  -H "Content-Type: text/plain" \
  --data "hello"
```

Очікувано: `415` JSON response.

```bash
curl -i -X POST http://localhost:3000/api/leads \
  -H "Content-Type: application/json" \
  --data '{"name":'
```

Очікувано: `400` JSON response.

Rate limit можна перевірити, відправивши більше ніж 10 valid requests за одну хвилину з одного IP. Очікувано: `429` JSON response.

8. Optional Gemini check:

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=<gemini-key>
GEMINI_MODEL=<available-gemini-model>
```

Перезапусти app і відправ `examples/payload.json` ще раз. Очікувано: lead буде проаналізований Gemini і збережений у тій самій Google Sheet.

## MVP Limitations

- Немає authentication, тому не варто публічно деплоїти API без додаткового захисту.
- Rate limiting зберігається в пам'яті процесу: він скидається після restart і не працює спільно між кількома інстансами.
- Немає durable queue: якщо Google Sheets недоступний, lead не зберігається в іншому місці.
- Gemini free tier може використовувати надісланий контент для покращення продукту; не використовуй чутливі реальні дані лідів у demo mode.
- Google Sheets використовується як простий visibility layer, а не як повноцінна надійна база даних.
