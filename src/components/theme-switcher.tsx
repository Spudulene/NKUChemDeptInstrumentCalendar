"use client";

import { useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "Match device theme" },
  { value: "light", label: "Light theme" },
  { value: "dark", label: "Dark theme" },
];

function applyTheme(value: ThemeChoice) {
  const root = document.documentElement;
  if (value === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", value);
  document.cookie = `theme=${value}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * The choice is kept in a cookie rather than localStorage so the server can render
 * the right theme on the first byte — no flash of light mode on a dark-mode laptop.
 * Switching applies immediately on the client; nothing round-trips.
 */
export function ThemeSwitcher({ initial }: { initial: ThemeChoice }) {
  const [choice, setChoice] = useState(initial);

  const pick = (value: ThemeChoice) => {
    setChoice(value);
    applyTheme(value);
  };

  return (
    <div role="group" aria-label="Color theme" className="flex gap-0.5 rounded-xl bg-chrome-2 p-[3px]">
      {CHOICES.map(({ value, label }) => {
        const on = value === choice;
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={on}
            onClick={() => pick(value)}
            className={`flex size-10 items-center justify-center rounded-[9px] ${
              on ? "bg-gold text-on-gold" : "text-chrome-ink-2 hover:text-chrome-ink"
            }`}
          >
            <ThemeIcon value={value} />
          </button>
        );
      })}
    </div>
  );
}

function ThemeIcon({ value }: { value: ThemeChoice }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (value === "system") {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    );
  }
  if (value === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
