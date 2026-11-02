"use client";

import { useEffect, useState } from "react";
import { applyTheme, readTheme, saveTheme, type Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>("auto");

  useEffect(() => {
    // The saved choice lives in browser storage, which only exists after the page loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(readTheme());
  }, []);

  const choose = (value: Theme) => {
    setTheme(value);
    saveTheme(value);
    applyTheme(value);
  };

  return (
    <div className="theme-switch" role="radiogroup" aria-label="Display">
      <span>Display</span>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={theme === option.value}
          onClick={() => choose(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
