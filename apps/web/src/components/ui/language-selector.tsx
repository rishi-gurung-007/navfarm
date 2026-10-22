"use client";

import { Globe, ChevronDown } from "lucide-react";
import { useLanguage } from "../../hooks/useLanguage";
import { Select } from "./select";

// Each language's own name, in its own script — not the English name and
// not a 2-letter code — so a reader who can't read English can still find
// their language in the list.
const NATIVE_NAMES: Record<string, string> = {
  en: "English",
  hi: "हिन्दी",
  mr: "मराठी",
  es: "Español",
  fr: "Français",
  bn: "বাংলা",
  te: "తెలుగు",
  ta: "தமிழ்",
};

/**
 * Hover and focus are CSS state, not JS state. This used to mutate
 * `style.borderColor` from onMouseEnter/onMouseLeave — opening the native
 * dropdown swallows the matching mouseleave, so the accent border stayed
 * painted on afterwards and looked like a stuck error ring. It also set
 * `outline: none` with nothing in its place, which apple.design.md §29 rules
 * out. Both are handled by the shared `.nf-lang-select` class in global.css.
 */
export function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <div className="nf-lang">
      <Globe size={14} className="nf-lang-icon" aria-hidden="true" />
      <Select
        value={language}
        fullWidth={false}
        onChange={(e) => setLanguage(e.target.value as any)}
        aria-label={t("settingsLanguage")}
        className="nf-lang-select"
      >
        {Object.entries(NATIVE_NAMES).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </Select>
      <ChevronDown size={13} className="nf-lang-chevron" aria-hidden="true" />
    </div>
  );
}

export default LanguageSelector;
