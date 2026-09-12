import { availableModels, defaultModelId, runJudge } from "../src/judge-api";
import { withReadout } from "../src/judge";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
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
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      withReadout(
        {
          score: 0,
          understood: false,
          gloss: "Judge request failed — use Local.",
          source: "local-fallback",
        },
        "",
        ""
      ),
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
