import { availableModels, defaultModelId } from "../src/judge-api";

export async function GET() {
  const models = await availableModels();
  return Response.json(
    { models, default: defaultModelId(models) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
