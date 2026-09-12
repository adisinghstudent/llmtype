import { availableModels, defaultModelId, runJudge } from "./_lib/judge-api.js";
import { withReadout } from "./_lib/judge.js";

export default async function handler(
  req: { method?: string; body?: unknown },
  res: {
    setHeader: (k: string, v: string) => void;
    status: (n: number) => { json: (b: unknown) => void; end: () => void };
    json: (b: unknown) => void;
  }
) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const body = (req.body ?? {}) as {
      intended?: string;
      typed?: string;
      model?: string;
    };
    const models = await availableModels();
    const def = defaultModelId(models);
    const result = await runJudge(
      String(body.intended ?? ""),
      String(body.typed ?? ""),
      String(body.model ?? def)
    );
    return res.status(200).json(result);
  } catch {
    return res.status(200).json(
      withReadout(
        {
          score: 0,
          understood: false,
          gloss: "Judge request failed — use Local.",
          source: "local-fallback",
        },
        "",
        ""
      )
    );
  }
}
