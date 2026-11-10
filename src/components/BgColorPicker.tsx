"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_BG,
  getCustomBg,
  getServerCustomBg,
  getServerTheme,
  getTheme,
  setCustomBg,
  subscribeTheme,
} from "@/utils/theme";

// A round swatch that opens the native color picker. Rainbow ring until a
// custom color is chosen; then it shows that color. Picking light/dark with
// the toggle resets it.
export default function BgColorPicker() {
  const custom = useSyncExternalStore(subscribeTheme, getCustomBg, getServerCustomBg);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);

  return (
    <label
      title="Pick a background color"
      className="relative block size-7 shrink-0 cursor-pointer rounded-full border border-foreground/20 transition-colors hover:border-foreground/40 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-foreground sm:size-9"
      style={{
        background: custom
          ? custom
          : "conic-gradient(from 0deg, #ff5f6d, #ffc371, #f9f871, #5ee7a0, #4facfe, #b57bff, #ff5f6d)",
      }}
    >
      <span className="sr-only">Background color</span>
      <input
        type="color"
        aria-label="Background color"
        value={custom || DEFAULT_BG[theme]}
        onChange={(e) => setCustomBg(e.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </label>
  );
}
