export type ScoreSnapshot = {
  rawWpm: number;
  classicAccuracy: number;
  llmAccuracy: number;
  qualifiedWpm: number | null;
  effectiveWpm: number;
  charsTyped: number;
  correctChars: number;
  minutes: number;
};

export function computeScores(opts: {
  charsTyped: number;
  correctChars: number;
  elapsedMs: number;
  llmAccuracy: number;
}): ScoreSnapshot {
  const minutes = Math.max(opts.elapsedMs / 60000, 1 / 60000);
  const rawWpm = opts.charsTyped / 5 / minutes;
  const classicAccuracy =
    opts.charsTyped > 0 ? (opts.correctChars / opts.charsTyped) * 100 : 100;
  const llmAccuracy = Math.max(0, Math.min(100, opts.llmAccuracy));
  const qualifiedWpm = llmAccuracy >= 90 ? rawWpm : null;
  const effectiveWpm = rawWpm * (llmAccuracy / 100);
  return {
    rawWpm,
    classicAccuracy,
    llmAccuracy,
    qualifiedWpm,
    effectiveWpm,
    charsTyped: opts.charsTyped,
    correctChars: opts.correctChars,
    minutes,
  };
}

export function formatWpm(n: number | null): string {
  if (n === null || Number.isNaN(n)) return "—";
  return Math.round(n).toString();
}

export function formatPct(n: number): string {
  return `${Math.round(n)}%`;
}
