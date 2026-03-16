import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { buildTokenizeUrl } from "../config/api";
import "./TokenizePage.css";

interface Token {
  content: string;
  offset: number;
  color?: string;
  fontStyle?: number;
}

interface TokenizeResponse {
  tokens: Token[][];
  fg?: string;
  bg?: string;
  themeName?: string;
}

type FontStyleFlag = number;
const FONT_STYLE_ITALIC: FontStyleFlag = 1;
const FONT_STYLE_BOLD: FontStyleFlag = 2;
const FONT_STYLE_UNDERLINE: FontStyleFlag = 4;
const DEFAULT_DARK_THEME_BACKGROUND = "#0d1117";
const MIN_DARK_THEME_CONTRAST = 4.5;

function parseHexColor(color?: string): [number, number, number] | null {
  if (!color) {
    return null;
  }

  const match = color.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) {
    return null;
  }

  const hex = match[1];
  const normalized =
    hex.length === 3
      ? hex
          .split("")
          .map((value) => value + value)
          .join("")
      : hex;

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const toLinear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  };

  return (
    0.2126 * toLinear(red) +
    0.7152 * toLinear(green) +
    0.0722 * toLinear(blue)
  );
}

function contrastRatio(
  foreground: [number, number, number],
  background: [number, number, number]
): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixWithWhite(
  [red, green, blue]: [number, number, number],
  weight: number
): [number, number, number] {
  const mixChannel = (channel: number) =>
    Math.round(channel + (255 - channel) * weight);

  return [mixChannel(red), mixChannel(green), mixChannel(blue)];
}

function toHexColor([red, green, blue]: [number, number, number]): string {
  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function ensureContrastAgainstDarkTheme(
  color: string | undefined,
  background: string
): string | undefined {
  if (!color) {
    return undefined;
  }

  const foregroundRgb = parseHexColor(color);
  const backgroundRgb = parseHexColor(background);
  if (!foregroundRgb || !backgroundRgb) {
    return color;
  }

  if (contrastRatio(foregroundRgb, backgroundRgb) >= MIN_DARK_THEME_CONTRAST) {
    return color;
  }

  let low = 0;
  let high = 1;

  for (let index = 0; index < 12; index += 1) {
    const midpoint = (low + high) / 2;
    const adjusted = mixWithWhite(foregroundRgb, midpoint);
    if (contrastRatio(adjusted, backgroundRgb) >= MIN_DARK_THEME_CONTRAST) {
      high = midpoint;
    } else {
      low = midpoint;
    }
  }

  return toHexColor(mixWithWhite(foregroundRgb, high));
}

function shouldUseDarkTokenizerTheme(result: TokenizeResponse): boolean {
  const backgroundRgb = parseHexColor(result.bg);
  const hasLightBackground =
    backgroundRgb !== null && relativeLuminance(backgroundRgb) > 0.5;

  return hasLightBackground || result.themeName?.toLowerCase().includes("light") === true;
}

function formatColorValue(
  originalColor: string | undefined,
  displayedColor: string | undefined
): string | undefined {
  if (!displayedColor) {
    return undefined;
  }

  if (!originalColor || originalColor === displayedColor) {
    return displayedColor;
  }

  return `${originalColor} → ${displayedColor}`;
}

function tokenFontStyle(flags?: number): React.CSSProperties | undefined {
  if (!flags) {
    return undefined;
  }

  const style: React.CSSProperties = {};

  if (flags & FONT_STYLE_ITALIC) {
    style.fontStyle = "italic";
  }

  if (flags & FONT_STYLE_BOLD) {
    style.fontWeight = "bold";
  }

  if (flags & FONT_STYLE_UNDERLINE) {
    style.textDecoration = "underline";
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

export default function TokenizePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialHash = searchParams.get("hash") ?? "";

  const [hash, setHash] = useState(initialHash);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TokenizeResponse | null>(null);
  const [selectedLineIndex, setSelectedLineIndex] = useState<number | null>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectedLine =
    selectedLineIndex !== null ? result?.tokens[selectedLineIndex] ?? null : null;
  const selectedLineJson =
    selectedLine && selectedLineIndex !== null
      ? JSON.stringify(
          {
            lineNumber: selectedLineIndex + 1,
            tokens: selectedLine,
          },
          null,
          2
        )
      : "";
  const previewUsesDarkTheme = result ? shouldUseDarkTokenizerTheme(result) : false;
  const displayedBackground = previewUsesDarkTheme
    ? DEFAULT_DARK_THEME_BACKGROUND
    : result?.bg ?? DEFAULT_DARK_THEME_BACKGROUND;
  const displayedForeground = result
    ? ensureContrastAgainstDarkTheme(
        previewUsesDarkTheme ? result.fg ?? "#24292e" : result.fg,
        displayedBackground
      )
    : undefined;
  const displayedThemeName =
    result?.themeName && previewUsesDarkTheme
      ? `${result.themeName} → dark preview`
      : result?.themeName;
  const displayedForegroundValue = formatColorValue(result?.fg, displayedForeground);
  const displayedBackgroundValue = formatColorValue(result?.bg, displayedBackground);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (selectedLine && !dialog.open) {
      dialog.showModal();
    } else if (!selectedLine && dialog.open) {
      dialog.close();
    }
  }, [selectedLine]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const handleClose = () => setSelectedLineIndex(null);
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, []);

  const handleTokenize = useCallback(async () => {
    const trimmed = hash.trim();

    if (!trimmed) {
      setError("Enter a file hash to tokenize.");
      return;
    }

    setError("");
    setLoading(true);
    setResult(null);
    setSelectedLineIndex(null);

    setSearchParams({ hash: trimmed }, { replace: true });

    try {
      const response = await fetch(buildTokenizeUrl(trimmed));

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message =
          (body as { error?: string } | null)?.error ??
          `Request failed with status ${response.status}`;
        throw new Error(message);
      }

      const data = (await response.json()) as TokenizeResponse;
      setResult(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch tokenization result."
      );
    } finally {
      setLoading(false);
    }
  }, [hash, setSearchParams]);

  return (
    <div className="tokenize-page">
      <div className="page-header">
        <h1>🎨 Tokenize Preview</h1>
        <p className="page-subtitle">
          Enter a file blob hash to preview Shiki tokenization output.
        </p>
      </div>

      <div className="tokenize-card">
        <form
          className="tokenize-form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleTokenize();
          }}
        >
          <div className="tokenize-field">
            <label htmlFor="tokenize-hash">File blob hash</label>
            <input
              id="tokenize-hash"
              type="text"
              placeholder="e.g. 1111111111111111111111111111111111111111"
              value={hash}
              onChange={(e) => setHash(e.target.value)}
            />
          </div>
          <button type="submit" disabled={loading}>
            {loading ? "Loading…" : "Tokenize"}
          </button>
        </form>

        {error && <div className="tokenize-error">{error}</div>}

        {loading && (
          <div className="tokenize-loading">Fetching tokenization result…</div>
        )}

        {result && (
          <>
            <div className="tokenize-meta">
              {result.themeName && (
                <div className="tokenize-meta-item">
                  <span className="tokenize-meta-label">Theme</span>
                  <span className="tokenize-meta-value">{displayedThemeName}</span>
                </div>
              )}
              {displayedForegroundValue && (
                <div className="tokenize-meta-item">
                  <span className="tokenize-meta-label">Foreground</span>
                  <span className="tokenize-meta-value">
                    <span
                      style={{
                        display: "inline-block",
                        width: 12,
                        height: 12,
                        background: displayedForeground,
                        borderRadius: 2,
                        marginRight: 6,
                        verticalAlign: "middle",
                        border: "1px solid #555",
                      }}
                    />
                    {displayedForegroundValue}
                  </span>
                </div>
              )}
              {displayedBackgroundValue && (
                <div className="tokenize-meta-item">
                  <span className="tokenize-meta-label">Background</span>
                  <span className="tokenize-meta-value">
                    <span
                      style={{
                        display: "inline-block",
                        width: 12,
                        height: 12,
                        background: displayedBackground,
                        borderRadius: 2,
                        marginRight: 6,
                        verticalAlign: "middle",
                        border: "1px solid #555",
                      }}
                    />
                    {displayedBackgroundValue}
                  </span>
                </div>
              )}
              <div className="tokenize-meta-item">
                <span className="tokenize-meta-label">Lines</span>
                <span className="tokenize-meta-value">
                  {result.tokens.length}
                </span>
              </div>
            </div>

            <div
              className="tokenize-output"
              style={{ background: displayedBackground }}
            >
              {result.tokens.map((line, lineIndex) => (
                <div key={lineIndex} className="tokenize-line">
                  <span className="tokenize-line-number">
                    {lineIndex + 1}
                  </span>
                  <button
                    type="button"
                    className="tokenize-line-json-button"
                    onClick={() => setSelectedLineIndex(lineIndex)}
                    aria-label={`Show JSON for line ${lineIndex + 1}`}
                  >
                    {"{}"}
                  </button>
                  {line.map((token, tokenIndex) => (
                    <span
                      key={tokenIndex}
                      style={{
                        color: ensureContrastAgainstDarkTheme(
                          previewUsesDarkTheme
                            ? token.color ?? displayedForeground
                            : token.color ?? result.fg,
                          displayedBackground
                        ),
                        ...tokenFontStyle(token.fontStyle),
                      }}
                    >
                      {token.content}
                    </span>
                  ))}
                </div>
              ))}
            </div>

            <dialog
              ref={dialogRef}
              className="tokenize-json-dialog"
              onClick={(event) => {
                if (event.target === dialogRef.current) {
                  setSelectedLineIndex(null);
                }
              }}
            >
              <div className="tokenize-json-modal">
                <div className="tokenize-json-modal__header">
                  <h2>Line {selectedLineIndex !== null ? selectedLineIndex + 1 : ""} JSON</h2>
                  <button
                    type="button"
                    className="tokenize-json-modal__close"
                    onClick={() => setSelectedLineIndex(null)}
                    aria-label="Close JSON preview"
                  >
                    ✕
                  </button>
                </div>
                <pre className="tokenize-json-modal__content">
                  {selectedLineJson}
                </pre>
              </div>
            </dialog>
          </>
        )}
      </div>
    </div>
  );
}
