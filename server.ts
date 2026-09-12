import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { localJudge, withReadout, type JudgeResult } from "./src/judge.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile(resolve(__dirname, ".env"));

type ModelInfo = {
  id: string;
  label: string;
  provider: "local" | "openai" | "xai" | "anthropic";
};

const NON_TEXT = [
  "whisper", "tts", "transcribe", "audio", "realtime", "dall", "image",
  "embedding", "moderation", "sora", "gpt-image", "computer-use", "omni",
];

function isTextModel(id: string): boolean {
  const n = id.toLowerCase();
  return !NON_TEXT.some((s) => n.includes(s));
}

function prettyLabel(id: string): string {
  if (id === "gpt-5.6-luna") return "Luna 5.6";
  if (id === "gpt-5.6-sol") return "Sol 5.6";
  if (id === "gpt-5.6-terra") return "Terra 5.6";
  return id;
}

function fallbackOpenAI(): ModelInfo[] {
  return [
    { id: "openai:gpt-5.6-luna", label: "Luna 5.6", provider: "openai" },
  ];
}

function rankModel(id: string): number {
  const n = id.toLowerCase();
  if (n === "gpt-5.6-luna") return 0;
  if (n.startsWith("gpt-5.6")) return 1;
  if (n.startsWith("gpt-5.")) return 2;
  if (n.startsWith("gpt-6")) return 3;
  if (n.startsWith("gpt-")) return 4;
  return 10;
}

async function fetchOpenAIModels(): Promise<ModelInfo[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return [];
  const cutoff = Date.now() / 1000 - 182.5 * 24 * 3600;
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { data?: { id?: string; created?: number }[] };
    const rows = (data.data ?? [])
      .filter((m) => m.id && isTextModel(m.id) && (m.created ?? 0) >= cutoff)
      .map((m) => ({ id: m.id as string, created: m.created ?? 0 }));
    const seen = new Set<string>();
    const ids = rows
      .sort((a, b) => rankModel(a.id) - rankModel(b.id) || b.created - a.created || a.id.localeCompare(b.id))
      .map((r) => r.id)
      .filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
    if (!ids.includes("gpt-5.6-luna")) ids.unshift("gpt-5.6-luna");
    return ids.map((id) => ({
      id: `openai:${id}`,
      label: prettyLabel(id),
      provider: "openai" as const,
    }));
  } catch {
    return fallbackOpenAI();
  }
}

async function availableModels(): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [
    { id: "local", label: "Local (typo-tolerant)", provider: "local" },
  ];
  models.push(...(await fetchOpenAIModels()));
  if (process.env.XAI_API_KEY) {
    models.push({ id: "xai:grok-2-latest", label: "Grok", provider: "xai" });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    models.push({
      id: "anthropic:claude-3-5-haiku-latest",
      label: "Claude",
      provider: "anthropic",
    });
  }
  return models;
}

function defaultModelId(models: ModelInfo[]): string {
  const luna = models.find((m) => m.id === "openai:gpt-5.6-luna");
  if (luna) return luna.id;
  const firstOpen = models.find((m) => m.provider === "openai");
  return firstOpen ? firstOpen.id : "local";
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

const JUDGE_SYSTEM = `You are an LLM reading a messy typed message.
1. inferred: rewrite what YOU think the person is saying, in clean English (your interpretation, not a copy of intended).
2. score 0-100: would you treat that inferred meaning as the intended meaning?
3. mistakes: only real meaning errors, as {got, wanted}. Example: {"got":"10 minutes","wanted":"20 minutes"}. Skip typos that you still understood. Empty if none.
Return ONLY JSON:
{"score":0-100,"understood":boolean,"inferred":"...","mistakes":[{"got":"...","wanted":"..."}]}
Be generous on typos and abbreviation; be strict if key meaning is missing or wrong.
score >= 90 means you would understand the typed text as the intended meaning.`;

async function judgeWithOpenAI(
  intended: string,
  typed: string,
  model: string
): Promise<JudgeResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: JSON.stringify({ intended, typed }) },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as {
    score?: number;
    understood?: boolean;
    gloss?: string;
    inferred?: string;
    matched?: string[];
    missing?: string[];
    extra?: string[];
    mistakes?: { got?: string; wanted?: string }[];
  };
  const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
  return withReadout({
    score,
    understood: parsed.understood ?? score >= 90,
    gloss: String(parsed.gloss || "Judged by OpenAI."),
    source: "openai",
    inferred: parsed.inferred,
    matched: Array.isArray(parsed.matched) ? parsed.matched.map(String) : [],
    missing: Array.isArray(parsed.missing) ? parsed.missing.map(String) : [],
    extra: Array.isArray(parsed.extra) ? parsed.extra.map(String) : [],
    mistakes: Array.isArray(parsed.mistakes)
      ? parsed.mistakes
          .filter((m) => m && (m.got || m.wanted))
          .map((m) => ({ got: String(m.got || "—"), wanted: String(m.wanted || "—") }))
      : [],
  }, intended, typed);
}

async function judgeWithXai(
  intended: string,
  typed: string,
  model: string
): Promise<JudgeResult> {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY missing");
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: JSON.stringify({ intended, typed }) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`xAI ${res.status}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : "{}") as {
    score?: number;
    understood?: boolean;
    gloss?: string;
    inferred?: string;
    matched?: string[];
    missing?: string[];
    extra?: string[];
    mistakes?: { got?: string; wanted?: string }[];
  };
  const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
  return withReadout({
    score,
    understood: parsed.understood ?? score >= 90,
    gloss: String(parsed.gloss || "Judged by Grok."),
    source: "xai",
    inferred: parsed.inferred,
    matched: Array.isArray(parsed.matched) ? parsed.matched.map(String) : [],
    missing: Array.isArray(parsed.missing) ? parsed.missing.map(String) : [],
    extra: Array.isArray(parsed.extra) ? parsed.extra.map(String) : [],
    mistakes: Array.isArray(parsed.mistakes)
      ? parsed.mistakes
          .filter((m) => m && (m.got || m.wanted))
          .map((m) => ({ got: String(m.got || "—"), wanted: String(m.wanted || "—") }))
      : [],
  }, intended, typed);
}

async function judgeWithAnthropic(
  intended: string,
  typed: string,
  model: string
): Promise<JudgeResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      temperature: 0,
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify({ intended, typed }) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const content = data.content?.find((c) => c.type === "text")?.text ?? "{}";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : "{}") as {
    score?: number;
    understood?: boolean;
    gloss?: string;
    inferred?: string;
    matched?: string[];
    missing?: string[];
    extra?: string[];
    mistakes?: { got?: string; wanted?: string }[];
  };
  const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
  return withReadout({
    score,
    understood: parsed.understood ?? score >= 90,
    gloss: String(parsed.gloss || "Judged by Claude."),
    source: "anthropic",
    inferred: parsed.inferred,
    matched: Array.isArray(parsed.matched) ? parsed.matched.map(String) : [],
    missing: Array.isArray(parsed.missing) ? parsed.missing.map(String) : [],
    extra: Array.isArray(parsed.extra) ? parsed.extra.map(String) : [],
    mistakes: Array.isArray(parsed.mistakes)
      ? parsed.mistakes
          .filter((m) => m && (m.got || m.wanted))
          .map((m) => ({ got: String(m.got || "—"), wanted: String(m.wanted || "—") }))
      : [],
  }, intended, typed);
}

async function runJudge(
  intended: string,
  typed: string,
  modelId: string
): Promise<JudgeResult> {
  if (!modelId || modelId === "local") {
    return localJudge(intended, typed);
  }
  try {
    if (modelId.startsWith("openai:")) {
      return await judgeWithOpenAI(intended, typed, modelId.slice("openai:".length));
    }
    if (modelId.startsWith("xai:")) {
      return await judgeWithXai(intended, typed, modelId.slice("xai:".length));
    }
    if (modelId.startsWith("anthropic:")) {
      return await judgeWithAnthropic(
        intended,
        typed,
        modelId.slice("anthropic:".length)
      );
    }
    return localJudge(intended, typed);
  } catch {
    const local = localJudge(intended, typed);
    return {
      ...local,
      source: "local-fallback",
      gloss: `${local.gloss} (API failed — local fallback.)`,
    };
  }
}

async function main() {
  const models = await availableModels();
  const def = defaultModelId(models);

  const vite = await createViteServer({
    configFile: resolve(__dirname, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
  });

  const PORT = Number(process.env.PORT || 5173);

  const app = createServer(async (req, res) => {
    const url = req.url || "/";

    if (req.method === "GET" && url.startsWith("/api/models")) {
      return json(res, 200, { models, default: def });
    }

    if (req.method === "POST" && url.startsWith("/api/judge")) {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as {
          intended?: string;
          typed?: string;
          model?: string;
        };
        const result = await runJudge(
          String(body.intended ?? ""),
          String(body.typed ?? ""),
          String(body.model ?? def)
        );
        return json(res, 200, result);
      } catch {
        return json(res, 200, withReadout({
          score: 0,
          understood: false,
          gloss: "Judge request failed — use Local.",
          source: "local-fallback",
        }, "", ""));
      }
    }

    vite.middlewares(req, res, async () => {
      try {
        const indexPath = resolve(__dirname, "index.html");
        let html = readFileSync(indexPath, "utf8");
        html = await vite.transformIndexHtml(url, html);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      } catch (e) {
        res.statusCode = 500;
        res.end(String(e));
      }
    });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`LLMType listening on http://0.0.0.0:${PORT}`);
    console.log(`Models: ${models.map((m) => m.id).join(", ")}`);
    console.log(`Default: ${def}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
