import { translations } from "../src/utils/translations";

/**
 * t() fills {{name}} placeholders only. A single-brace {name} reaches the
 * screen verbatim — "Permanently delete {code}?" shipped that way (11 Oct).
 */
describe("translation placeholders", () => {
  it("uses {{name}}, never a single-brace {name}", () => {
    const bad = Object.entries(translations.en as Record<string, string>)
      .filter(([, text]) => typeof text === "string" && /(^|[^{])\{[a-zA-Z]+\}(?!\})/.test(text))
      .map(([key, text]) => `${key}: ${text}`);
    expect(bad).toEqual([]);
  });
});
