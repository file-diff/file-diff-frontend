export interface MonospaceFont {
  id: string;
  label: string;
  fontFamily: string;
}

export const MONOSPACE_FONTS: readonly MonospaceFont[] = [
  { id: "jetbrains-mono", label: "JetBrains Mono", fontFamily: '"JetBrains Mono"' },
  { id: "fira-code", label: "Fira Code", fontFamily: '"Fira Code"' },
  { id: "source-code-pro", label: "Source Code Pro", fontFamily: '"Source Code Pro"' },
  { id: "roboto-mono", label: "Roboto Mono", fontFamily: '"Roboto Mono"' },
  { id: "ubuntu-mono", label: "Ubuntu Mono", fontFamily: '"Ubuntu Mono"' },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", fontFamily: '"IBM Plex Mono"' },
  { id: "inconsolata", label: "Inconsolata", fontFamily: '"Inconsolata"' },
] as const;

export const DEFAULT_FONT_ID = "jetbrains-mono";

export function getFontById(id: string): MonospaceFont | undefined {
  return MONOSPACE_FONTS.find((f) => f.id === id);
}

export function buildCodeFontFamily(font: MonospaceFont): string {
  return `${font.fontFamily}, monospace`;
}
