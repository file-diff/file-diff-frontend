import {
  DEFAULT_FONT_ID,
  getFontById,
  buildCodeFontFamily,
} from "../config/fonts";
import { readFontPreference } from "../utils/storage";

export function applyFont(fontId: string): void {
  const font = getFontById(fontId) ?? getFontById(DEFAULT_FONT_ID)!;
  document.documentElement.style.setProperty(
    "--code-font-family",
    buildCodeFontFamily(font),
  );
}

/** Reads the stored preference and applies the matching font to :root. */
export function initializeFont(): void {
  const stored = readFontPreference();
  applyFont(stored ?? DEFAULT_FONT_ID);
}
