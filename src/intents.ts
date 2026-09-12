/** ~25 clear intended requests for intent mode. */

export type Intent = {
  id: string;
  category: "coding" | "email" | "research" | "ops";
  text: string;
};

export const INTENTS: Intent[] = [
  {
    id: "c1",
    category: "coding",
    text: "Write a TypeScript function that debounces an async callback by 300ms",
  },
  {
    id: "c2",
    category: "coding",
    text: "Explain why my React useEffect is running twice in development",
  },
  {
    id: "c3",
    category: "coding",
    text: "Refactor this nested for-loop into a map and filter chain",
  },
  {
    id: "c4",
    category: "coding",
    text: "Add unit tests for the login form validation helpers",
  },
  {
    id: "c5",
    category: "coding",
    text: "Generate a SQL migration that adds an indexed email column to users",
  },
  {
    id: "c6",
    category: "coding",
    text: "Find the memory leak in this Node stream pipeline and suggest a fix",
  },
  {
    id: "e1",
    category: "email",
    text: "Draft a polite follow-up email to the hiring manager after my interview",
  },
  {
    id: "e2",
    category: "email",
    text: "Write a short apology to the client about the delayed shipment",
  },
  {
    id: "e3",
    category: "email",
    text: "Summarize tomorrow's all-hands agenda in three bullet points for Slack",
  },
  {
    id: "e4",
    category: "email",
    text: "Compose a cold outreach message to a potential design partner",
  },
  {
    id: "e5",
    category: "email",
    text: "Reply declining the meeting invite and propose two alternate times",
  },
  {
    id: "r1",
    category: "research",
    text: "Compare Postgres JSONB vs MongoDB for a product catalog of one million SKUs",
  },
  {
    id: "r2",
    category: "research",
    text: "What are the main privacy risks of embedding customer support chats in a vector DB",
  },
  {
    id: "r3",
    category: "research",
    text: "Summarize the latest research on retrieval-augmented generation failure modes",
  },
  {
    id: "r4",
    category: "research",
    text: "List open-source alternatives to Datadog for Kubernetes metrics",
  },
  {
    id: "r5",
    category: "research",
    text: "Explain the tradeoffs between WebSockets and server-sent events for live dashboards",
  },
  {
    id: "r6",
    category: "research",
    text: "Find papers on typo-tolerant semantic matching for short queries",
  },
  {
    id: "o1",
    category: "ops",
    text: "Roll back the staging deploy to the previous green commit and page on-call",
  },
  {
    id: "o2",
    category: "ops",
    text: "Increase the Redis maxmemory policy to allkeys-lru on the cache cluster",
  },
  {
    id: "o3",
    category: "ops",
    text: "Write a runbook step for rotating the production Postgres password",
  },
  {
    id: "o4",
    category: "ops",
    text: "Diagnose why the canary pods are CrashLooping after the image bump",
  },
  {
    id: "o5",
    category: "ops",
    text: "Scale the worker pool to 12 replicas and watch the queue depth for ten minutes",
  },
  {
    id: "o6",
    category: "ops",
    text: "Create an alert if p99 API latency exceeds 800ms for five minutes",
  },
  {
    id: "c7",
    category: "coding",
    text: "Convert this Python script into a FastAPI endpoint with request validation",
  },
  {
    id: "e6",
    category: "email",
    text: "Thank the open-source maintainer for merging my pull request",
  },
];

export function pickIntent(excludeId?: string): Intent {
  const pool = excludeId ? INTENTS.filter((i) => i.id !== excludeId) : INTENTS;
  return pool[Math.floor(Math.random() * pool.length)];
}
