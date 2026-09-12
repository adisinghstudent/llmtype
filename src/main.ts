import english from "./english.json";
import { runningLocalEstimate } from "./judge";
import { pickIntent, type Intent } from "./intents";
import { computeScores, formatPct, formatWpm } from "./scoring";

type Mode = "words" | "intent";
type Duration = 15 | 30 | 60 | "enter";

type ModelInfo = { id: string; label: string; provider: string };

const WORD_BANK: string[] = (english as { words: string[] }).words;

const els = {
  modeSeg: document.getElementById("modeSeg")!,
  durSeg: document.getElementById("durSeg")!,
  enterDur: document.getElementById("enterDur") as HTMLButtonElement,
  modelSeg: document.getElementById("modelSeg")!,
  modelPicker: document.getElementById("modelPicker")!,
  modelSearch: document.getElementById("modelSearch") as HTMLInputElement,
  modelList: document.getElementById("modelList") as HTMLUListElement,
  hud: document.getElementById("hud")!,
  hudWpm: document.getElementById("hudWpm")!,
  hudLlm: document.getElementById("hudLlm")!,
  hudClassic: document.getElementById("hudClassic")!,
  hudTime: document.getElementById("hudTime")!,
  intentBanner: document.getElementById("intentBanner")!,
  intentText: document.getElementById("intentText")!,
  words: document.getElementById("words")!,
  wordsWrap: document.getElementById("wordsWrap")!,
  hiddenInput: document.getElementById("hiddenInput") as HTMLInputElement,
  hint: document.getElementById("hint")!,
  results: document.getElementById("results")!,
  badge: document.getElementById("badge")!,
  resQualified: document.getElementById("resQualified")!,
  resRaw: document.getElementById("resRaw")!,
  resLlm: document.getElementById("resLlm")!,
  resClassic: document.getElementById("resClassic")!,
  resEffective: document.getElementById("resEffective")!,
  resMeta: document.getElementById("resMeta")!,
  newTest: document.getElementById("newTest") as HTMLButtonElement,
  llmStat: document.getElementById("llmStat")!,
  effStat: document.getElementById("effStat")!,
  effExplain: document.getElementById("effExplain")!,
  readout: document.getElementById("readout")!,
  roTyped: document.getElementById("roTyped")!,
  roIntended: document.getElementById("roIntended")!,
  roInferred: document.getElementById("roInferred")!,
  roOverlap: document.getElementById("roOverlap")!,
  roMatched: document.getElementById("roMatched")!,
  roMissing: document.getElementById("roMissing")!,
  roExtra: document.getElementById("roExtra")!,
  roMistakes: document.getElementById("roMistakes")!,
};

const state = {
  mode: "intent" as Mode,
  duration: "enter" as Duration,
  modelId: "local",
  models: [] as ModelInfo[],
  started: false,
  finished: false,
  startTime: 0,
  timerId: 0 as number | ReturnType<typeof setInterval>,
  tickId: 0 as number | ReturnType<typeof setInterval>,
  words: [] as string[],
  target: "", // full intended string
  typed: "",
  wordIndex: 0,
  charIndex: 0, // within current word (words mode)
  extras: [] as string[], // extras on current word
  correctChars: 0,
  typedChars: 0,
  intent: null as Intent | null,
  intentTyped: "", // freeform for intent mode
  lastJudge: null as null | {
    typed: string;
    intended: string;
    inferred: string;
    matched: string[];
    missing: string[];
    extra: string[];
    overlap: number;
    mistakes: { got: string; wanted: string }[];
    rawWpm: number;
    llmAccuracy: number;
    effectiveWpm: number;
  },
};

function randomWords(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)]);
  }
  return out;
}

function durationSeconds(): number {
  if (state.duration === "enter") return 60; // soft cap for enter mode
  return state.duration;
}

function setActiveSeg(seg: HTMLElement, attr: string, value: string) {
  seg.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.getAttribute(attr) === value);
  });
}

function currentModelLabel(): string {
  return state.models.find((x) => x.id === state.modelId)?.label || state.modelId;
}

function filteredModels(q: string): ModelInfo[] {
  const n = q.trim().toLowerCase();
  if (!n || n === currentModelLabel().toLowerCase()) return state.models;
  return state.models.filter(
    (m) => m.label.toLowerCase().includes(n) || m.id.toLowerCase().includes(n)
  );
}

function closeModelList() {
  els.modelList.hidden = true;
  els.modelSearch.value = currentModelLabel();
}

function openModelList(q?: string) {
  const items = filteredModels(q ?? els.modelSearch.value);
  els.modelList.innerHTML = "";
  for (const m of items) {
    const li = document.createElement("li");
    li.textContent = m.label;
    li.dataset.model = m.id;
    if (m.id === state.modelId) li.classList.add("active");
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (state.started && !state.finished) return;
      state.modelId = m.id;
      closeModelList();
    });
    els.modelList.appendChild(li);
  }
  els.modelList.hidden = items.length === 0;
}

function renderModelSeg() {
  els.modelSearch.value = currentModelLabel();
  els.modelSearch.disabled = state.started && !state.finished;
}

function bindModelPicker() {
  els.modelSearch.addEventListener("focus", () => {
    els.modelSearch.select();
    openModelList("");
  });
  els.modelSearch.addEventListener("input", () => openModelList(els.modelSearch.value));
  els.modelSearch.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeModelList();
      els.modelSearch.blur();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const first = filteredModels(els.modelSearch.value)[0];
      if (first && !(state.started && !state.finished)) {
        state.modelId = first.id;
      }
      closeModelList();
      els.modelSearch.blur();
    }
    e.stopPropagation();
  });
  document.addEventListener("click", (e) => {
    if (!els.modelPicker.contains(e.target as Node)) closeModelList();
  });
}

async function loadModels() {
  try {
    const res = await fetch("/api/models");
    const data = (await res.json()) as { models: ModelInfo[]; default: string };
    state.models = data.models;
    state.modelId = data.default;
  } catch {
    state.models = [{ id: "local", label: "Local (typo-tolerant)", provider: "local" }];
    state.modelId = "local";
  }
  renderModelSeg();
}

function resetTest() {
  clearInterval(state.timerId as number);
  clearInterval(state.tickId as number);
  state.started = false;
  state.finished = false;
  state.startTime = 0;
  state.typed = "";
  state.wordIndex = 0;
  state.charIndex = 0;
  state.extras = [];
  state.correctChars = 0;
  state.typedChars = 0;
  state.intentTyped = "";
  els.results.hidden = true;
  els.results.style.display = "none";
  els.readout.hidden = false;
  els.effExplain.hidden = true;
  els.llmStat.classList.add("open");
  els.effStat.classList.remove("open");
  state.lastJudge = null;
  els.hud.hidden = true;
  els.hint.hidden = false;
  els.words.classList.remove("judging", "intent-mode");

  els.intentBanner.hidden = false;
  els.enterDur.hidden = false;
  els.words.classList.add("intent-mode", "empty-prompt");

  if (state.mode === "words") {
    state.words = randomWords(22);
    state.target = state.words.join(" ");
    state.intent = null;
    els.intentText.textContent = state.target;
  } else {
    state.intent = pickIntent(state.intent?.id);
    state.target = state.intent.text;
    state.words = [];
    els.intentText.textContent = state.intent.text;
  }
  renderIntentTyped();

  els.hiddenInput.value = "";
  focusInput();
}

function renderWords() {
  const parts: string[] = [];
  for (let wi = 0; wi < state.words.length; wi++) {
    const word = state.words[wi];
    let html = '<span class="word">';
    if (wi < state.wordIndex) {
      const typedPast = getTypedHistory()[wi] || "";
      const maxLen = Math.max(word.length, typedPast.length);
      for (let ci = 0; ci < maxLen; ci++) {
        if (ci < word.length && ci < typedPast.length) {
          const ok = typedPast[ci] === word[ci];
          html += `<span class="char ${ok ? "correct" : "incorrect"}">${escapeHtml(ok ? word[ci] : typedPast[ci])}</span>`;
        } else if (ci < word.length) {
          html += `<span class="char incorrect">${escapeHtml(word[ci])}</span>`;
        } else {
          html += `<span class="char extra">${escapeHtml(typedPast[ci])}</span>`;
        }
      }
    } else if (wi === state.wordIndex) {
      for (let ci = 0; ci < word.length; ci++) {
        let cls = "char";
        if (ci < state.charIndex) {
          // compare against what was typed for this word
          const typedChar = state.typedWordChars[ci];
          cls += typedChar === word[ci] ? " correct" : " incorrect";
        } else if (ci === state.charIndex && state.extras.length === 0) {
          cls += " current";
        }
        html += `<span class="${cls}">${escapeHtml(word[ci])}</span>`;
      }
      for (const ex of state.extras) {
        html += `<span class="char extra">${escapeHtml(ex)}</span>`;
      }
      if (state.extras.length > 0 || state.charIndex >= word.length) {
        html += `<span class="char current over"></span>`;
      }
    } else {
      for (let ci = 0; ci < word.length; ci++) {
        html += `<span class="char">${escapeHtml(word[ci])}</span>`;
      }
    }
    html += "</span>";
    parts.push(html);
  }
  els.words.innerHTML = parts.join("");
}

// Track chars typed for current word
type Augmented = typeof state & { typedWordChars: string[]; typedHistory: string[] };
(state as Augmented).typedWordChars = [];
(state as Augmented).typedHistory = [];

function getTypedWordChars(): string[] {
  return (state as Augmented).typedWordChars;
}
function setTypedWordChars(v: string[]) {
  (state as Augmented).typedWordChars = v;
}
function getTypedHistory(): string[] {
  return (state as Augmented).typedHistory;
}

function escapeHtml(c: string): string {
  return c === "&"
    ? "&amp;"
    : c === "<"
      ? "&lt;"
      : c === ">"
        ? "&gt;"
        : c === '"'
          ? "&quot;"
          : c;
}

function focusInput() {
  els.hiddenInput.focus();
}

function startIfNeeded() {
  if (state.started || state.finished) return;
  state.started = true;
  state.startTime = performance.now();
  els.hud.hidden = false;
  els.hint.hidden = true;
  updateHud();

  const secs = durationSeconds();
  state.timerId = setInterval(() => {
    const elapsed = (performance.now() - state.startTime) / 1000;
    const left = Math.max(0, secs - elapsed);
    els.hudTime.textContent =
      state.duration === "enter" ? "↵" : String(Math.ceil(left));
    if (left <= 0 && state.duration !== "enter") {
      void finishTest();
    }
  }, 100);

  state.tickId = setInterval(updateHud, 200);
}

function updateHud() {
  if (!state.started) return;
  const elapsedMs = Math.max(performance.now() - state.startTime, 1);
  const typed =
    state.mode === "words"
      ? [...getTypedHistory(), getTypedWordChars().join("") + state.extras.join("")].join(" ")
      : state.intentTyped;
  const charsTyped = state.typedChars;
  const minutes = elapsedMs / 60000;
  const wpm = charsTyped / 5 / Math.max(minutes, 1 / 60000);
  els.hudWpm.textContent = String(Math.round(wpm));
  els.hudTime.textContent =
    state.duration === "enter"
      ? "↵"
      : String(Math.ceil(Math.max(0, durationSeconds() - elapsedMs / 1000)));
}

function renderIntentTyped() {
  const text = state.intentTyped;
  if (!text) {
    els.words.innerHTML = '<span class="char current">&nbsp;</span>';
    return;
  }
  let html = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] === " " ? " " : text[i];
    html += `<span class="char typed">${ch === " " ? "&nbsp;" : escapeHtml(ch)}</span>`;
  }
  html += '<span class="char current over"></span>';
  els.words.innerHTML = html;
}

function handleWordsKey(e: KeyboardEvent) {
  if (e.key === "Tab" || e.key === "Escape") return;
  if (e.key === "Enter") {
    e.preventDefault();
    return;
  }

  startIfNeeded();
  if (state.finished) return;

  const word = state.words[state.wordIndex];
  if (!word) return;

  if (e.key === "Backspace") {
    e.preventDefault();
    if (state.extras.length > 0) {
      state.extras.pop();
      state.typedChars = Math.max(0, state.typedChars - 1);
    } else if (state.charIndex > 0) {
      const removed = getTypedWordChars().pop();
      state.charIndex--;
      state.typedChars = Math.max(0, state.typedChars - 1);
      if (removed === word[state.charIndex]) {
        state.correctChars = Math.max(0, state.correctChars - 1);
      }
    } else if (state.wordIndex > 0) {
      // go back to previous word
      state.wordIndex--;
      const prev = getTypedHistory().pop() || "";
      setTypedWordChars(prev.split(""));
      state.charIndex = prev.length;
      state.extras = [];
      // recount is approximate — skip perfect recount for UX
    }
    renderWords();
    updateHud();
    return;
  }

  if (e.key === " ") {
    e.preventDefault();
    // advance word
    const typedWord = getTypedWordChars().join("") + state.extras.join("");
    getTypedHistory().push(typedWord);
    state.typedChars += 1; // space
    if (typedWord === word) {
      // space after correct word counts as correct
      state.correctChars += 1;
    }
    state.wordIndex++;
    state.charIndex = 0;
    state.extras = [];
    setTypedWordChars([]);
    if (state.wordIndex >= state.words.length - 10) {
      state.words.push(...randomWords(40));
      state.target = state.words.join(" ");
    }
    renderWords();
    updateHud();
    return;
  }

  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (state.charIndex >= word.length) {
      state.extras.push(e.key);
      state.typedChars += 1;
    } else {
      getTypedWordChars().push(e.key);
      if (e.key === word[state.charIndex]) state.correctChars += 1;
      state.charIndex++;
      state.typedChars += 1;
    }
    renderWords();
    updateHud();
  }
}

function handleIntentKey(e: KeyboardEvent) {
  if (e.key === "Tab" || e.key === "Escape") return;

  if (e.key === "Enter") {
    e.preventDefault();
    if (!state.started) return;
    void finishTest();
    return;
  }

  startIfNeeded();
  if (state.finished) return;

  if (e.key === "Backspace") {
    e.preventDefault();
    if (!state.intentTyped) return;
    const removed = state.intentTyped.slice(-1);
    state.intentTyped = state.intentTyped.slice(0, -1);
    state.typedChars = Math.max(0, state.typedChars - 1);
    // classic: compare against intended prefix loosely
    recountIntentClassic();
    renderIntentTyped();
    updateHud();
    void removed;
    return;
  }

  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    state.intentTyped += e.key;
    state.typedChars += 1;
    recountIntentClassic();
    renderIntentTyped();
    updateHud();
  }
}

function recountIntentClassic() {
  const intended = state.target;
  const typed = state.intentTyped;
  let correct = 0;
  const n = typed.length;
  for (let i = 0; i < n; i++) {
    if (typed[i] === intended[i]) correct++;
  }
  state.correctChars = correct;
  state.typedChars = n;
}

function fullTypedText(): string {
  return state.intentTyped;
}

async function finishTest() {
  if (state.finished) return;
  state.finished = true;
  clearInterval(state.timerId as number);
  clearInterval(state.tickId as number);

  const elapsedMs = Math.max(performance.now() - state.startTime, 1);
  const typed = fullTypedText();
  els.words.classList.add("judging");
  els.results.hidden = false;
  els.results.style.display = "flex";
  els.badge.textContent = "…";
  els.badge.className = "badge";

  let llmAccuracy = runningLocalEstimate(state.target, typed);
  let gloss = "";
  let modelLabel = state.modelId;
  let source = "local";

  try {
    const res = await fetch("/api/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intended: state.target,
        typed,
        model: state.modelId,
      }),
    });
    const data = (await res.json()) as {
      score: number;
      gloss: string;
      source: string;
      inferred?: string;
      intended?: string;
      typed?: string;
      matched?: string[];
      missing?: string[];
      extra?: string[];
      overlap?: number;
      mistakes?: { got: string; wanted: string }[];
    };
    llmAccuracy = data.score;
    gloss = data.gloss;
    source = data.source;
    state.lastJudge = {
      typed: data.typed ?? typed,
      intended: data.intended ?? state.target,
      inferred: data.inferred ?? "",
      matched: data.matched ?? [],
      missing: data.missing ?? [],
      extra: data.extra ?? [],
      overlap: data.overlap ?? 0,
      mistakes: data.mistakes ?? [],
      rawWpm: 0,
      llmAccuracy: data.score,
      effectiveWpm: 0,
    };
  } catch {
    const local = runningLocalEstimate(state.target, typed);
    llmAccuracy = local;
    gloss = "Local estimate (network error).";
    source = "local-fallback";
  }

  const scores = computeScores({
    charsTyped: state.typedChars,
    correctChars: state.correctChars,
    elapsedMs,
    llmAccuracy,
  });

  const qualified = scores.qualifiedWpm !== null;
  els.badge.textContent = qualified ? "QUALIFIED" : "DQ";
  els.badge.className = `badge ${qualified ? "qualified" : "dq"}`;
  els.resQualified.textContent = formatWpm(scores.qualifiedWpm);
  els.resRaw.textContent = formatWpm(scores.rawWpm);
  els.resLlm.textContent = formatPct(scores.llmAccuracy);
  els.resClassic.textContent = formatPct(scores.classicAccuracy);
  els.resEffective.textContent = formatWpm(scores.effectiveWpm);

  const modelName =
    state.models.find((m) => m.id === state.modelId)?.label || state.modelId;
  const durLabel =
    state.duration === "enter"
      ? `until enter (${(elapsedMs / 1000).toFixed(1)}s)`
      : `${state.duration}s`;
  els.resMeta.textContent = `${state.mode} · ${durLabel} · ${modelName} · judge: ${source}`;
  if (state.lastJudge) {
    state.lastJudge.rawWpm = scores.rawWpm;
    state.lastJudge.effectiveWpm = scores.effectiveWpm;
    state.lastJudge.llmAccuracy = scores.llmAccuracy;
    fillReadout(state.lastJudge);
    els.readout.hidden = false;
    els.llmStat.classList.add("open");
  }
  void modelLabel;
}

function fillReadout(j: NonNullable<typeof state.lastJudge>) {
  els.roTyped.textContent = j.typed || "—";
  els.roIntended.textContent = j.intended || "—";
  els.roInferred.textContent = j.inferred || "—";
  if (els.roOverlap) els.roOverlap.textContent = "";
  const mistakes = j.mistakes && j.mistakes.length
    ? j.mistakes
    : [];
  els.roMistakes.textContent = mistakes.length
    ? mistakes.map((x) => `${x.got} → ${x.wanted}`).join("\n")
    : "none";
}


// Controls
els.modeSeg.querySelectorAll("button").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (state.started && !state.finished) return;
    const mode = btn.getAttribute("data-mode") as Mode;
    state.mode = mode;
    setActiveSeg(els.modeSeg, "data-mode", mode);
    resetTest();
  });
});

els.durSeg.querySelectorAll("button").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (state.started && !state.finished) return;
    const raw = btn.getAttribute("data-dur")!;
    state.duration = raw === "enter" ? "enter" : (Number(raw) as 15 | 30 | 60);
    setActiveSeg(els.durSeg, "data-dur", raw);
    resetTest();
  });
});

els.llmStat.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = els.readout.hidden;
  els.readout.hidden = !open;
  els.llmStat.classList.toggle("open", open);
  els.effExplain.hidden = true;
  els.effStat.classList.remove("open");
});

els.effStat.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = els.effExplain.hidden;
  els.effExplain.hidden = !open;
  els.effStat.classList.toggle("open", open);
});

els.newTest.addEventListener("click", (e) => {
  e.stopPropagation();
  resetTest();
});

els.results.addEventListener("click", (e) => {
  if (e.target === els.results) resetTest();
});

function isModelPickerEvent(e: Event): boolean {
  const t = e.target as Node | null;
  return !!(t && els.modelPicker.contains(t));
}

document.addEventListener("keydown", (e) => {
  if (isModelPickerEvent(e)) return;
  if (e.key === "Tab" || e.key === "Escape") {
    e.preventDefault();
    resetTest();
    return;
  }
  if (state.finished && (e.key === " " || e.key === "Enter")) {
    e.preventDefault();
    resetTest();
    return;
  }
  if (state.finished) return;

  handleIntentKey(e);
});

els.wordsWrap.addEventListener("click", focusInput);
document.body.addEventListener("click", (e) => {
  if (isModelPickerEvent(e)) return;
  if (!state.finished) focusInput();
});

await loadModels();
bindModelPicker();
(window as unknown as { __llmtypeReset: () => void }).__llmtypeReset = resetTest;
resetTest();
