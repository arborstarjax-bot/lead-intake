import test from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "./safeRedirect.ts";

test("returns fallback for empty or non-string input", () => {
  assert.equal(safeNext(undefined), "/");
  assert.equal(safeNext(null), "/");
  assert.equal(safeNext(""), "/");
});

test("allows normal internal paths", () => {
  assert.equal(safeNext("/dashboard"), "/dashboard");
  assert.equal(safeNext("/leads/abc-123?tab=notes#top"), "/leads/abc-123?tab=notes#top");
});

test("rejects protocol-relative and backslash URLs", () => {
  assert.equal(safeNext("//evil.com"), "/");
  assert.equal(safeNext("/\\evil.com"), "/");
  assert.equal(safeNext("\\evil.com"), "/");
  assert.equal(safeNext("https://evil.com"), "/");
});

test("rejects control characters that browsers strip before parsing", () => {
  // Tab — decodes to `/<TAB>/evil.com`, which browsers turn into //evil.com
  assert.equal(safeNext("/\t/evil.com"), "/");
  assert.equal(safeNext(decodeURIComponent("/%09/evil.com")), "/");
  // Newline and carriage return
  assert.equal(safeNext("/\n/evil.com"), "/");
  assert.equal(safeNext("/\r/evil.com"), "/");
  // Other control chars and DEL
  assert.equal(safeNext("/\x0b/evil.com"), "/");
  assert.equal(safeNext("/\x7f/evil.com"), "/");
});

test("rejects scheme-relative tricks after parsing", () => {
  assert.equal(safeNext("///evil.com"), "/");
  // Dot segments normalize to a protocol-relative path after parsing.
  assert.equal(safeNext("/./..//evil.com"), "/");
  // A literal space is safe: it parses as a same-origin path, not //host.
  assert.equal(safeNext("/ /evil.com"), "/%20/evil.com");
});

test("honours a custom fallback", () => {
  assert.equal(safeNext("//evil.com", "/login"), "/login");
});
