import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { availableModels, defaultModelId, runJudge } from "./src/judge-api.ts";
import { withReadout } from "./src/judge.ts";

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
