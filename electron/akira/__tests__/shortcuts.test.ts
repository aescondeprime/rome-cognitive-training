import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CONSOLE_SHORTCUT,
  DEFAULT_CONVERSATION_SHORTCUT,
  matchesAkiraShortcut,
  normalizeAkiraShortcut,
  parseAkiraShortcut,
} from "../../../shared/akira";

/**
 * Akira V3 shortcut matching.
 *
 * These exist because V2's binding was matched with hand-written modifier
 * checks in three separate files, which is how `Control+Escape` ended up
 * firing alongside the Constellation's bare-Escape handler. Matching is now
 * one function, and it is exact: extra modifiers disqualify a match rather
 * than being ignored.
 */

const keyEvent = (
  key: string,
  modifiers: Partial<{ code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {},
) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers });

test("the conversation shortcut fires on Command+apostrophe", () => {
  assert.equal(matchesAkiraShortcut("Command+'", keyEvent("'", { metaKey: true })), true);
});

test("a bare apostrophe never fires it, so typing stays safe", () => {
  assert.equal(matchesAkiraShortcut("Command+'", keyEvent("'")), false);
});

test("modifiers must match exactly, so the two bindings never overlap", () => {
  const withShift = keyEvent("'", { metaKey: true, shiftKey: true });
  assert.equal(matchesAkiraShortcut(DEFAULT_CONSOLE_SHORTCUT, withShift), true);
  assert.equal(matchesAkiraShortcut(DEFAULT_CONVERSATION_SHORTCUT, withShift), false);
  assert.notEqual(DEFAULT_CONVERSATION_SHORTCUT, DEFAULT_CONSOLE_SHORTCUT);
});

test("Shift-shifted punctuation still matches via key code", () => {
  // On a US layout, holding Shift turns the apostrophe key into a double
  // quote, so `event.key` is '"' and matching on the character alone would
  // silently fail. `event.code` names the physical key and does not shift.
  const shiftedQuote = keyEvent('"', { code: "Quote", metaKey: true, shiftKey: true });
  assert.equal(matchesAkiraShortcut(DEFAULT_CONSOLE_SHORTCUT, shiftedQuote), true);
  assert.equal(matchesAkiraShortcut(DEFAULT_CONVERSATION_SHORTCUT, shiftedQuote), false);
});

test("Shift-shifted slash matches Command+/ style bindings", () => {
  assert.equal(matchesAkiraShortcut("Command+Shift+/", keyEvent("?", { code: "Slash", metaKey: true, shiftKey: true })), true);
});

test("a matching code with the wrong modifiers is still rejected", () => {
  assert.equal(matchesAkiraShortcut(DEFAULT_CONSOLE_SHORTCUT, keyEvent('"', { code: "Quote", shiftKey: true })), false);
});

test("events without a code field still match on character", () => {
  // Renderer KeyboardEvents always carry `code`, but the field is optional in
  // the signature so callers can pass minimal objects.
  assert.equal(matchesAkiraShortcut("Command+'", keyEvent("'", { metaKey: true })), true);
});

test("Alt disqualifies a match rather than being ignored", () => {
  assert.equal(matchesAkiraShortcut("Command+'", keyEvent("'", { metaKey: true, altKey: true })), false);
});

test("Control does not stand in for Command", () => {
  assert.equal(matchesAkiraShortcut("Command+'", keyEvent("'", { ctrlKey: true })), false);
});

test("Escape can no longer trigger Akira in any form", () => {
  // The V2 regression: Akira listened for Control+Escape while
  // ConstellationMenu listened for bare Escape, so one keypress did both.
  for (const accelerator of [DEFAULT_CONVERSATION_SHORTCUT, DEFAULT_CONSOLE_SHORTCUT]) {
    assert.equal(matchesAkiraShortcut(accelerator, keyEvent("Escape")), false);
    assert.equal(matchesAkiraShortcut(accelerator, keyEvent("Escape", { ctrlKey: true })), false);
    assert.equal(matchesAkiraShortcut(accelerator, keyEvent("Escape", { metaKey: true })), false);
    assert.equal(matchesAkiraShortcut(accelerator, keyEvent("Escape", { ctrlKey: true, shiftKey: true })), false);
  }
});

test("CommandOrControl accepts either modifier", () => {
  assert.equal(matchesAkiraShortcut("CommandOrControl+'", keyEvent("'", { metaKey: true })), true);
  assert.equal(matchesAkiraShortcut("CommandOrControl+'", keyEvent("'", { ctrlKey: true })), true);
  assert.equal(matchesAkiraShortcut("CommandOrControl+'", keyEvent("'")), false);
});

test("accelerator aliases parse to the same flags", () => {
  assert.deepEqual(parseAkiraShortcut("Cmd+Shift+'"), parseAkiraShortcut("Command+Shift+'"));
  assert.deepEqual(parseAkiraShortcut("Ctrl+'"), parseAkiraShortcut("Control+'"));
});

test("an accelerator with no key never matches", () => {
  assert.equal(matchesAkiraShortcut("", keyEvent("'", { metaKey: true })), false);
  assert.equal(matchesAkiraShortcut("Command", keyEvent("'", { metaKey: true })), false);
});

test("a persisted V2 shortcut falls back to the V3 default", () => {
  assert.equal(normalizeAkiraShortcut("Control+Escape", DEFAULT_CONVERSATION_SHORTCUT), DEFAULT_CONVERSATION_SHORTCUT);
  assert.equal(normalizeAkiraShortcut("Command+/", DEFAULT_CONVERSATION_SHORTCUT), "Command+/");
  assert.equal(normalizeAkiraShortcut(undefined, DEFAULT_CONSOLE_SHORTCUT), DEFAULT_CONSOLE_SHORTCUT);
});
