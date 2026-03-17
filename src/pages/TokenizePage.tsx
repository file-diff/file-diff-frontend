import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { buildTokenizeUrl } from "../config/api";
import { DEFAULT_SHIKI_THEME, SHIKI_THEMES } from "../constants/shikiThemes";
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
  const initialTheme = searchParams.get("theme") ?? DEFAULT_SHIKI_THEME;

  const [hash, setHash] = useState(initialHash);
  const [theme, setTheme] = useState(initialTheme);
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
  const autoLoadedRequestKeyRef = useRef<string | null>(null);

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

  const requestTokenize = useCallback(
    async (
      nextHash: string,
      nextTheme: string,
      options?: { syncSearchParams?: boolean }
    ) => {
      const trimmed = nextHash.trim();
      const trimmedTheme = nextTheme.trim();

      if (!trimmed) {
        setError("Enter a file hash to tokenize.");
        return;
      }

      setHash(trimmed);
      setTheme(trimmedTheme || DEFAULT_SHIKI_THEME);
      setError("");
      setLoading(true);
      setResult(null);
      setSelectedLineIndex(null);

      if (options?.syncSearchParams !== false) {
        setSearchParams(
          trimmedTheme ? { hash: trimmed, theme: trimmedTheme } : { hash: trimmed },
          { replace: true }
        );
      }

      try {
        const response = await fetch(buildTokenizeUrl(trimmed, trimmedTheme));

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
    },
    [setSearchParams]
  );

  const handleTokenize = useCallback(async () => {
    await requestTokenize(hash, theme);
  }, [hash, requestTokenize, theme]);

  useEffect(() => {
    const trimmedHash = initialHash.trim();
    const requestKey = `${trimmedHash}\n${initialTheme.trim()}`;

    if (!trimmedHash || autoLoadedRequestKeyRef.current === requestKey) {
      return;
    }

    autoLoadedRequestKeyRef.current = requestKey;
    void requestTokenize(trimmedHash, initialTheme, { syncSearchParams: false });
  }, [initialHash, initialTheme, requestTokenize]);

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
          <div className="tokenize-field tokenize-field--theme">
            <label htmlFor="tokenize-theme">Theme</label>
            <input
              id="tokenize-theme"
              type="text"
              list="tokenize-theme-options"
              placeholder={DEFAULT_SHIKI_THEME}
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            />
            <datalist id="tokenize-theme-options">
              {SHIKI_THEMES.map((themeName) => (
                <option key={themeName} value={themeName} />
              ))}
            </datalist>
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
                  <span className="tokenize-meta-value">{result.themeName}</span>
                </div>
              )}
              {result.fg && (
                <div className="tokenize-meta-item">
                  <span className="tokenize-meta-label">Foreground</span>
                  <span className="tokenize-meta-value">
                    <span
                      style={{
                        display: "inline-block",
                        width: 12,
                        height: 12,
                        background: result.fg,
                        borderRadius: 2,
                        marginRight: 6,
                        verticalAlign: "middle",
                        border: "1px solid #555",
                      }}
                    />
                    {result.fg}
                  </span>
                </div>
              )}
              {result.bg && (
                <div className="tokenize-meta-item">
                  <span className="tokenize-meta-label">Background</span>
                  <span className="tokenize-meta-value">
                    <span
                      style={{
                        display: "inline-block",
                        width: 12,
                        height: 12,
                        background: result.bg,
                        borderRadius: 2,
                        marginRight: 6,
                        verticalAlign: "middle",
                        border: "1px solid #555",
                      }}
                    />
                    {result.bg}
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
              style={{ background: result.bg, color: result.fg }}
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
                        color: token.color ?? result.fg,
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
