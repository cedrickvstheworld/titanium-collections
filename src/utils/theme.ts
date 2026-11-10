export type Theme = "dark" | "light";

export const THEME_KEY = "theme";
export const BG_KEY = "bg";

export const DEFAULT_BG: Record<Theme, string> = { dark: "#141414", light: "#f3f3f1" };
const FG: Record<Theme, string> = { dark: "#ededed", light: "#141414" };

// Runs in <head> before first paint so saved choices never flash the wrong
// colors. A saved custom background wins over the saved light/dark theme.
// (Same logic as applyBg/hexTheme below — keep them in sync.)
export const THEME_INIT_SCRIPT = `try{var d=document.documentElement,s=localStorage,b=s.getItem("${BG_KEY}"),t=s.getItem("${THEME_KEY}");if(/^#[0-9a-f]{6}$/i.test(b||"")){var c=[1,3,5].map(function(i){var v=parseInt(b.substr(i,2),16)/255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)}),l=.2126*c[0]+.7152*c[1]+.0722*c[2]>.179?"light":"dark";d.dataset.theme=l;d.dataset.bg=b;d.style.setProperty("--background",b);d.style.setProperty("--foreground",l==="light"?"${FG.light}":"${FG.dark}");d.style.colorScheme=l}else if(t==="light"||t==="dark")d.dataset.theme=t}catch(e){}`;

const listeners = new Set<() => void>();

export function subscribeTheme(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emit() {
  listeners.forEach((cb) => cb());
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked (private mode etc.) — the choice just won't persist
  }
}

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function getServerTheme(): Theme {
  return "dark";
}

// "" when no custom background is active.
export function getCustomBg(): string {
  return document.documentElement.dataset.bg ?? "";
}

export function getServerCustomBg(): string {
  return "";
}

// Which text color (and so which theme) reads well on this background.
function hexTheme(hex: string): Theme {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.substr(i, 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "light" : "dark";
}

function clearBg(root: HTMLElement) {
  delete root.dataset.bg;
  root.style.removeProperty("--background");
  root.style.removeProperty("--foreground");
  root.style.removeProperty("color-scheme");
}

// Pick a custom background. Text color + light/dark state follow its brightness.
export function setCustomBg(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
  const root = document.documentElement;
  const theme = hexTheme(hex);
  root.dataset.theme = theme;
  root.dataset.bg = hex;
  root.style.setProperty("--background", hex);
  root.style.setProperty("--foreground", FG[theme]);
  root.style.colorScheme = theme;
  store(BG_KEY, hex);
  store(THEME_KEY, theme);
  emit();
}

// Choosing light/dark overrides any custom background.
export function setTheme(theme: Theme) {
  const root = document.documentElement;
  clearBg(root);
  root.dataset.theme = theme;
  store(BG_KEY, null);
  store(THEME_KEY, theme);
  emit();
}
