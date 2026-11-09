import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("published public styles cannot introduce chromatic literals outside the semantic palette", () => {
  const css = readFileSync(new URL("../src/app/public-theme.css", import.meta.url), "utf8");
  const colors = [...css.matchAll(/#([a-f0-9]{3,8})\b/gi)];
  assert.ok(colors.length > 0);
  for (const [, value] of colors) {
    const rgb = value!.length <= 4 ? value!.slice(0, 3).split("").map(v => v + v) : value!.slice(0, 6).match(/../g)!;
    assert.equal(rgb[0]!.toLowerCase(), rgb[1]!.toLowerCase(), `Chromatic literal #${value}`);
    assert.equal(rgb[1]!.toLowerCase(), rgb[2]!.toLowerCase(), `Chromatic literal #${value}`);
  }
  assert.doesNotMatch(css, /rgba?\(|hsla?\(/i, "Use semantic tokens or neutral hex overlays");
});
