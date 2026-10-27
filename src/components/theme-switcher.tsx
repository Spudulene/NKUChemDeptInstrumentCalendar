"use client";

import { useState } from "react";
import { Segmented } from "@/components/ui";

export type ThemeChoice = "system" | "light" | "dark";

const CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "Device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function applyTheme(value: ThemeChoice) {
  const root = document.documentElement;
  if (value === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", value);
  document.cookie = `theme=${value}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Light, dark, or whatever the device uses (the default, and what most people want),
 * in the account menu rather than the header since few people change it.
 *
 * The choice is kept in a cookie rather than localStorage so the server can render
 * the right theme on the first byte — no flash of light mode on a dark-mode laptop.
 * Switching applies immediately on the client; nothing round-trips.
 */
export function ThemeSwitcher({ initial }: { initial: ThemeChoice }) {
  const [choice, setChoice] = useState(initial);

  return (
    <Segmented
      legend="Appearance"
      options={CHOICES}
      value={choice}
      columns={3}
      onChange={(value) => {
        setChoice(value);
        applyTheme(value);
      }}
    />
  );
}
