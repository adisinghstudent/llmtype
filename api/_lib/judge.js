function normalize(text) {
  return text.toLowerCase().replace(/[^\w\s']/g, " ").replace(/\s+/g, " ").trim();
}
function tokenize(text) {
  const n = normalize(text);
  if (!n) return [];
  return n.split(" ").filter(Boolean);
}
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  const dp = Array.from(
    { length: m + 1 },
    () => new Array(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[m][n];
}
function tokenMatchScore(intended, typed) {
  if (intended === typed) return 1;
  const d = levenshtein(intended, typed);
  if (d === 1) return 0.85;
  if (d === 2 && intended.length >= 5) return 0.6;
  return 0;
}
function reconstruct(typed, intended) {
  const intendedTokens = tokenize(intended);
  const typedTokens = tokenize(typed);
  if (!typedTokens.length) return "";
  const used = /* @__PURE__ */ new Set();
  const out = [];
  for (const tok of typedTokens) {
    let best = 0;
    let bestIdx = -1;
    for (let i = 0; i < intendedTokens.length; i++) {
      if (used.has(i)) continue;
      const s = tokenMatchScore(intendedTokens[i], tok);
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && best > 0) {
      used.add(bestIdx);
      out.push(intendedTokens[bestIdx]);
    } else {
      out.push(tok);
    }
  }
  return out.join(" ");
}
function tokenOverlap(intended, inferred) {
  const a = tokenize(intended);
  const b = tokenize(inferred);
  const bUsed = /* @__PURE__ */ new Set();
  const matched = [];
  for (const tok of a) {
    let hit = -1;
    for (let i = 0; i < b.length; i++) {
      if (bUsed.has(i)) continue;
      if (tokenMatchScore(tok, b[i]) > 0) {
        hit = i;
        break;
      }
    }
    if (hit >= 0) {
      bUsed.add(hit);
      matched.push(tok);
    }
  }
  const missing = a.filter((tok) => !matched.includes(tok));
  const extra = b.filter((_, i) => !bUsed.has(i));
  const denom = a.length + b.length;
  const overlap = denom === 0 ? 100 : Math.round(2 * matched.length * 100 / denom);
  return { matched, missing, extra, overlap };
}
function pairMistakes(missing, extra) {
  const n = Math.max(missing.length, extra.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const wanted = missing[i];
    const got = extra[i];
    if (wanted && got) out.push({ got, wanted });
    else if (wanted) out.push({ got: "\u2014", wanted });
    else if (got) out.push({ got, wanted: "\u2014" });
  }
  return out;
}
function withReadout(result, intended, typed) {
  const inferred = result.inferred && result.inferred.trim() || reconstruct(typed, intended);
  const ov = tokenOverlap(intended, inferred);
  return {
    ...result,
    inferred,
    intended,
    typed,
    matched: result.matched?.length ? result.matched : ov.matched,
    missing: result.missing?.length ? result.missing : ov.missing,
    extra: result.extra?.length ? result.extra : ov.extra,
    overlap: result.overlap ?? ov.overlap,
    mistakes: result.mistakes && result.mistakes.length ? result.mistakes : pairMistakes(
      result.missing?.length ? result.missing : ov.missing,
      result.extra?.length ? result.extra : ov.extra
    )
  };
}
function localJudge(intended, typed) {
  const intendedTokens = tokenize(intended);
  const typedTokens = tokenize(typed);
  if (intendedTokens.length === 0) {
    return withReadout({
      score: typedTokens.length === 0 ? 100 : 0,
      understood: typedTokens.length === 0,
      gloss: typedTokens.length === 0 ? "Empty match." : "Nothing to judge against.",
      source: "local"
    }, intended, typed);
  }
  if (typedTokens.length === 0) {
    return withReadout({
      score: 0,
      understood: false,
      gloss: "Nothing was typed.",
      source: "local"
    }, intended, typed);
  }
  const used = /* @__PURE__ */ new Set();
  let matchSum = 0;
  let exactCount = 0;
  let nearCount = 0;
  let missCount = 0;
  for (const it of intendedTokens) {
    let bestScore = 0;
    let bestIdx = -1;
    for (let i = 0; i < typedTokens.length; i++) {
      if (used.has(i)) continue;
      const s = tokenMatchScore(it, typedTokens[i]);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestScore > 0) {
      used.add(bestIdx);
      matchSum += bestScore;
      if (bestScore === 1) exactCount++;
      else nearCount++;
    } else {
      missCount++;
    }
  }
  const covered = matchSum / intendedTokens.length;
  const extras = typedTokens.length - used.size;
  const extraPenalty = Math.min(0.12, extras * 0.015);
  const missPenalty = Math.min(0.4, missCount * 0.1);
  let raw = covered - extraPenalty - missPenalty * 0.3;
  if (missCount === 0 && covered >= 0.8) {
    raw = Math.max(raw, 0.9 + (covered - 0.8) * 0.5);
  }
  const score = Math.round(Math.max(0, Math.min(100, raw * 100)));
  const gloss = buildGloss(score, exactCount, nearCount, missCount, extras, intendedTokens.length);
  return withReadout({
    score,
    understood: score >= 90,
    gloss,
    source: "local",
    inferred: reconstruct(typed, intended)
  }, intended, typed);
}
function buildGloss(score, exact, near, miss, extras, total) {
  if (score >= 95 && near === 0 && miss === 0) {
    return extras > 0 ? `Crystal clear (ignored ${extras} extra word${extras === 1 ? "" : "s"}).` : "Perfectly understood.";
  }
  if (score >= 90) {
    if (near > 0) return `Understood despite ${near} typo${near === 1 ? "" : "s"}.`;
    return "Meaning clear enough for a model.";
  }
  if (score >= 70) {
    const bits = [];
    if (near) bits.push(`${near} near-miss${near === 1 ? "" : "es"}`);
    if (miss) bits.push(`${miss} missing`);
    return `Mostly got it (${bits.join(", ") || `${exact}/${total} exact`}).`;
  }
  if (score >= 40) {
    return `Partial understanding \u2014 ${miss} key word${miss === 1 ? "" : "s"} missing.`;
  }
  return "Meaning lost \u2014 would not understand this as intended.";
}
function runningLocalEstimate(intended, typed) {
  if (!typed.trim()) return 100;
  return localJudge(intended, typed).score;
}
export {
  levenshtein,
  localJudge,
  normalize,
  pairMistakes,
  reconstruct,
  runningLocalEstimate,
  tokenOverlap,
  tokenize,
  withReadout
};
