import { localJudge, withReadout } from "./judge.js";
const NON_TEXT = [
  "whisper",
  "tts",
  "transcribe",
  "audio",
  "realtime",
  "dall",
  "image",
  "embedding",
  "moderation",
  "sora",
  "gpt-image",
  "computer-use",
  "omni"
];
function isTextModel(id) {
  const n = id.toLowerCase();
  return !NON_TEXT.some((s) => n.includes(s));
}
function prettyLabel(id) {
  if (id === "gpt-5.6-luna") return "Luna 5.6";
  if (id === "gpt-5.6-sol") return "Sol 5.6";
  if (id === "gpt-5.6-terra") return "Terra 5.6";
  return id;
}
function fallbackOpenAI() {
  return [
    { id: "openai:gpt-5.6-luna", label: "Luna 5.6", provider: "openai" }
  ];
}
function rankModel(id) {
  const n = id.toLowerCase();
  if (n === "gpt-5.6-luna") return 0;
  if (n.startsWith("gpt-5.6")) return 1;
  if (n.startsWith("gpt-5.")) return 2;
  if (n.startsWith("gpt-6")) return 3;
  if (n.startsWith("gpt-")) return 4;
  return 10;
}
async function fetchOpenAIModels() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return [];
  const cutoff = Date.now() / 1e3 - 182.5 * 24 * 3600;
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` }
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const rows = (data.data ?? []).filter((m) => m.id && isTextModel(m.id) && (m.created ?? 0) >= cutoff).map((m) => ({ id: m.id, created: m.created ?? 0 }));
    const seen = /* @__PURE__ */ new Set();
    const ids = rows.sort((a, b) => rankModel(a.id) - rankModel(b.id) || b.created - a.created || a.id.localeCompare(b.id)).map((r) => r.id).filter((id) => seen.has(id) ? false : (seen.add(id), true));
    if (!ids.includes("gpt-5.6-luna")) ids.unshift("gpt-5.6-luna");
    return ids.map((id) => ({
      id: `openai:${id}`,
      label: prettyLabel(id),
      provider: "openai"
    }));
  } catch {
    return fallbackOpenAI();
  }
}
async function availableModels() {
  const models = [
    { id: "local", label: "Local (typo-tolerant)", provider: "local" }
  ];
  models.push(...await fetchOpenAIModels());
  if (process.env.XAI_API_KEY) {
    models.push({ id: "xai:grok-2-latest", label: "Grok", provider: "xai" });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    models.push({
      id: "anthropic:claude-3-5-haiku-latest",
      label: "Claude",
      provider: "anthropic"
    });
  }
  return models;
}
function defaultModelId(models) {
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
async function judgeWithOpenAI(intended, typed, model) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: 400,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: JSON.stringify({ intended, typed }) }
      ]
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content);
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
    mistakes: Array.isArray(parsed.mistakes) ? parsed.mistakes.filter((m) => m && (m.got || m.wanted)).map((m) => ({ got: String(m.got || "\u2014"), wanted: String(m.wanted || "\u2014") })) : []
  }, intended, typed);
}
async function judgeWithXai(intended, typed, model) {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY missing");
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: JSON.stringify({ intended, typed }) }
      ]
    })
  });
  if (!res.ok) throw new Error(`xAI ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
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
    mistakes: Array.isArray(parsed.mistakes) ? parsed.mistakes.filter((m) => m && (m.got || m.wanted)).map((m) => ({ got: String(m.got || "\u2014"), wanted: String(m.wanted || "\u2014") })) : []
  }, intended, typed);
}
async function judgeWithAnthropic(intended, typed, model) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      temperature: 0,
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify({ intended, typed }) }]
    })
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  const content = data.content?.find((c) => c.type === "text")?.text ?? "{}";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
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
    mistakes: Array.isArray(parsed.mistakes) ? parsed.mistakes.filter((m) => m && (m.got || m.wanted)).map((m) => ({ got: String(m.got || "\u2014"), wanted: String(m.wanted || "\u2014") })) : []
  }, intended, typed);
}
async function runJudge(intended, typed, modelId) {
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
  } catch (e) {
    const local = localJudge(intended, typed);
    const why = e instanceof Error ? e.message.slice(0, 160) : "unknown";
    console.error("judge api failed", why);
    return {
      ...local,
      source: "local-fallback",
      gloss: `${local.gloss} (API failed \u2014 local fallback. ${why})`
    };
  }
}
export {
  availableModels,
  defaultModelId,
  fallbackOpenAI,
  fetchOpenAIModels,
  isTextModel,
  judgeWithAnthropic,
  judgeWithOpenAI,
  judgeWithXai,
  prettyLabel,
  rankModel,
  runJudge
};
