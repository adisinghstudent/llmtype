# LLMType

**Type messy. Be understood.**

In the AI era you can type sloppy and still get your point across. Classic Monkeytype scores character accuracy. LLMType scores **LLM accuracy** — did a model still get the intended meaning? Raw speed only **qualifies** if LLM accuracy ≥ 90%.

## Run

```bash
npm install
npm run dev
```

Open **http://localhost:5173** (binds `0.0.0.0:5173`).

```bash
npm test   # local judge unit tests
```

## Modes

- **words** — timed 15 / 30 / 60s stream from `english.json`. Target = word sequence shown; typed keeps typos.
- **intent** — clear intended request; type as you would to ChatGPT. Timer and/or **Enter** to submit early (`↵` duration).

## Scoring

| Metric | Formula |
|--------|---------|
| `rawWpm` | `(charsTyped / 5) / minutes` |
| `classicAccuracy` | `correctChars / typedChars * 100` |
| `llmAccuracy` | 0–100 from the judge |
| `qualifiedWpm` | `rawWpm` if `llmAccuracy >= 90`, else DQ (`—`) |
| `effectiveWpm` | `rawWpm * (llmAccuracy / 100)` |

Live HUD: WPM, LLM% (local running estimate), classic %.

## Judge

### Local (always available)

Typo-tolerant meaning match (no network): normalize, tokenize, best-match intended tokens via Damerau–Levenshtein. Extra typed tokens are cheap; missing intended tokens hurt more.

### Live models (optional)

If env keys are set at server start, the model picker lists last-6-months OpenAI text models. **Default is Luna 5.6 (`gpt-5.6-luna`)** when `OPENAI_API_KEY` is present. Local remains a fallback if the API fails. Never commit `.env`.

```bash
# .env (gitignored) — see .env.example
OPENAI_API_KEY=
XAI_API_KEY=
ANTHROPIC_API_KEY=
```

`POST /api/judge` `{ intended, typed, model }` → `{ score, understood, gloss, source }`

## Keys

- **Tab** — restart / new test after results  
- **Esc** — reset  
- **Enter** — submit (intent mode)

## Stack

Vite + vanilla TypeScript. One process (`tsx server.ts`) serves the UI and `/api/judge` on port 5173.


## Secrets

Copy `.env.example` to `.env` locally. `.env` is gitignored. Do not paste API keys into source, issues, or this README.
