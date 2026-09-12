import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { localJudge, levenshtein, tokenize, normalize } from "./judge.ts";

describe("normalize / tokenize", () => {
  it("lowercases and strips punctuation except apostrophe", () => {
    assert.equal(normalize("Hello, World's!"), "hello world's");
    assert.deepEqual(tokenize("  Fix  the BUG!! "), ["fix", "the", "bug"]);
  });
});

describe("levenshtein", () => {
  it("counts edits (adjacent transposition = 1)", () => {
    assert.equal(levenshtein("world", "wrold"), 1); // transposition
    assert.equal(levenshtein("hello", "hello"), 0);
    assert.equal(levenshtein("cat", "cut"), 1);
    assert.equal(levenshtein("kitten", "sitting"), 3);
  });
});

describe("localJudge", () => {
  it("hello wrold vs hello world is >= 90", () => {
    const r = localJudge("hello world", "hello wrold");
    assert.ok(r.score >= 90, `expected >= 90, got ${r.score} (${r.gloss})`);
  });

  it("random garbage vs sentence is < 40", () => {
    const r = localJudge(
      "please summarize the quarterly revenue report for the board",
      "asdf qwer zxcv hjkl poiu mnbv"
    );
    assert.ok(r.score < 40, `expected < 40, got ${r.score} (${r.gloss})`);
  });

  it("reordered but complete word set stays high", () => {
    const intended = "deploy the staging server after tests pass";
    const typed = "after tests pass deploy the staging server";
    const r = localJudge(intended, typed);
    assert.ok(r.score >= 85, `expected >= 85, got ${r.score} (${r.gloss})`);
  });

  it("exact match is 100", () => {
    const r = localJudge("write a unit test", "write a unit test");
    assert.equal(r.score, 100);
    assert.equal(r.understood, true);
  });

  it("single-char typos stay high", () => {
    const r = localJudge("send the email tomorrow", "send teh email tomorrow");
    assert.ok(r.score >= 90, `expected >= 90, got ${r.score}`);
  });

  it("empty typed is 0", () => {
    const r = localJudge("hello world", "");
    assert.equal(r.score, 0);
  });
});
