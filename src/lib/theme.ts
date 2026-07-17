/**
 * Temas da UI (padrão da suíte — ver `docs/planos/padrao-apps.md`).
 *
 * Mora num módulo dedicado (e não no `App.tsx`) pra `TopBar` e outros
 * componentes importarem o tipo sem criar import circular App↔componentes.
 * As paletas em si vivem no `App.css`, em blocos `:root[data-theme="<nome>"]`.
 */

import type { MessageKey } from "./i18n";

export const THEMES = [
  "light",
  "dark",
  "nature",
  "darkblue",
  "calmgreen",
  "pastelpink",
  "punkprincess",
] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_KEY = "theme";

/** Chave i18n do rótulo de cada tema. */
export const THEME_LABEL_KEYS: Record<Theme, MessageKey> = {
  light: "theme.light",
  dark: "theme.dark",
  nature: "theme.nature",
  darkblue: "theme.darkblue",
  calmgreen: "theme.calmgreen",
  pastelpink: "theme.pastelpink",
  punkprincess: "theme.punkprincess",
};

function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && (THEMES as readonly string[]).includes(v);
}

/** Tema salvo; sem nada salvo, segue a preferência do sistema. */
export function loadTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (isTheme(saved)) return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
}
