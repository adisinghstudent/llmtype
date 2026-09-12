import { localJudge, withReadout, type JudgeResult } from "./judge";

export type ModelInfo = {
  id: string;
  label: string;
  provider: "local" | "openai" | "xai" | "anthropic";
};

const NON_TEXT = [
  "whisper", "tts", "transcribe", "audio", "realtime", "dall", "image",
  "embedding", "moderation", "sora", "gpt-image", "computer-use", "omni",
];

export function isTextModel(id: string): boolean {
  const n = id.toLowerCase();
  return !NON_TEXT.some((s) => n.includes(s));
}

export function prettyLabel(id: string): string {
  if (id === "gpt-5.6-luna") return "Luna 5.6";
  if (id === "gpt-5.6-sol") return "Sol 5.6";
  if (id === "gpt-5.6-terra") return "Terra 5.6";
  return id;
}

export function fallbackOpenAI(): ModelInfo[] {
  return [
    { id: "openai:gpt-5.6-luna", label: "Luna 5.6", provider: "openai" },
  ];
}

export function rankModel(id: string): number {
  const n = id.toLowerCase();
  if (n === "gpt-5.6-luna") return 0;
  if (n.startsWith("gpt-5.6")) return 1;
  if (n.startsWith("gpt-5.")) return 2;
  if (n.startsWith("gpt-6")) return 3;
  if (n.startsWith("gpt-")) return 4;
  return 10;
}

export async function fetchOpenAIModels(): Promise<ModelInfo[]> {
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

export async function availableModels(): Promise<ModelInfo[]> {
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

export function defaultModelId(models: ModelInfo[]): string {
  const luna = models.find((m) => m.id === "openai:gpt-5.6-luna");
  if (luna) return luna.id;
  const firstOpen = models.find((m) => m.provider === "openai");
  return firstOpen ? firstOpen.id : "local";
}

const JUDGE_SYSTEM = `You are an LLM reading a messy typed message.
1. inferred: rewrite what YOU think the person is saying, in clean English (your interpretation, not a copy of intended).
2. score 0-100: would you treat that inferred meaning as the intended meaning?
3. mistakes: only real meaning errors, as {got, wanted}. Example: {"got":"10 minutes","wanted":"20 minutes"}. Skip typos that you still understood. Empty if none.
Return ONLY JSON:
{"score":0-100,"understood":boolean,"inferred":"...","mistakes":[{"got":"...","wanted":"..."}]}
Be generous on typos and abbreviation; be strict if key meaning is missing or wrong.
score >= 90 means you would understand the typed text as the intended meaning.`;

export async function judgeWithOpenAI(
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

export async function judgeWithXai(
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

export async function judgeWithAnthropic(
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

export async function runJudge(
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

