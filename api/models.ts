import { availableModels, defaultModelId } from "./_lib/judge-api.js";

export default async function handler(
  _req: { method?: string },
  res: {
    setHeader: (k: string, v: string) => void;
    status: (n: number) => { json: (b: unknown) => void; end: () => void };
    json: (b: unknown) => void;
  }
) {
  const models = await availableModels();
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ models, default: defaultModelId(models) });
}
