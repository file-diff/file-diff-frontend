import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  buildCommitFilesUrl,
  buildGrepUrl,
  buildTokenizeUrl,
} from "../config/api";
import { DEFAULT_SHIKI_THEME, SHIKI_THEMES } from "../constants/shikiThemes";
import "./GrepPage.css";

interface GrepMatch {
  path: string;
  lineNumber: number;
  line: string;
}

interface GrepResponse {
  jobId: string;
  commit: string;
  commitShort: string;
  status: string;
  query: string;
  matches: GrepMatch[];
}

interface FilesResponseEntry {
  t: string;
  path: string;
  s: number;
  hash: string;
}

interface FilesResponse {
  files: FilesResponseEntry[];
}

interface TokenStyle {
  content: string;
  offset: number;
  color?: string;
  fontStyle?: number;
}

interface TokenizeResponse {
  tokens: TokenStyle[][];
  fg?: string;
  bg?: string;
  themeName?: string;
}

const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;
const FONT_STYLE_UNDERLINE = 4;

function tokenFontStyle(flags?: number): React.CSSProperties | undefined {
  if (!flags) return undefined;
  const style: React.CSSProperties = {};
  if (flags & FONT_STYLE_ITALIC) style.fontStyle = "italic";
  if (flags & FONT_STYLE_BOLD) style.fontWeight = "bold";
  if (flags & FONT_STYLE_UNDERLINE) style.textDecoration = "underline";
  return Object.keys(style).length > 0 ? style : undefined;
}

interface MatchRange {
  start: number;
  end: number;
}

function findMatches(
  text: string,
  query: string,
  caseInsensitive: boolean
): MatchRange[] {
  if (!query) return [];
  const haystack = caseInsensitive ? text.toLowerCase() : text;
  const needle = caseInsensitive ? query.toLowerCase() : query;
  const ranges: MatchRange[] = [];
  let from = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    ranges.push({ start: idx, end: idx + needle.length });
    from = idx + Math.max(1, needle.length);
  }
  return ranges;
}

interface RenderSegment {
  content: string;
  color?: string;
  fontStyle?: number;
  highlighted: boolean;
}

function renderTokensWithHighlights(
  tokens: TokenStyle[] | null,
  fallbackText: string,
  highlights: MatchRange[]
): RenderSegment[] {
  // If no tokenizer data, render the line as one plain segment with highlights.
  if (!tokens || tokens.length === 0) {
    return splitByHighlights(fallbackText, highlights, undefined, undefined);
  }

  const lineStart = tokens[0].offset;
  const out: RenderSegment[] = [];
  for (const token of tokens) {
    const tokenStart = token.offset - lineStart;
    const tokenEnd = tokenStart + token.content.length;
    const overlapping = highlights
      .filter((h) => h.start < tokenEnd && h.end > tokenStart)
      .sort((a, b) => a.start - b.start);

    if (overlapping.length === 0) {
      out.push({
        content: token.content,
        color: token.color,
        fontStyle: token.fontStyle,
        highlighted: false,
      });
      continue;
    }

    let cursor = tokenStart;
    for (const hl of overlapping) {
      if (hl.start > cursor) {
        out.push({
          content: token.content.substring(
            cursor - tokenStart,
            hl.start - tokenStart
          ),
          color: token.color,
          fontStyle: token.fontStyle,
          highlighted: false,
        });
        cursor = hl.start;
      }
      const overlapStart = Math.max(cursor, hl.start);
      const overlapEnd = Math.min(tokenEnd, hl.end);
      if (overlapEnd > overlapStart) {
        out.push({
          content: token.content.substring(
            overlapStart - tokenStart,
            overlapEnd - tokenStart
          ),
          color: token.color,
          fontStyle: token.fontStyle,
          highlighted: true,
        });
        cursor = overlapEnd;
      }
    }
    if (cursor < tokenEnd) {
      out.push({
        content: token.content.substring(cursor - tokenStart, tokenEnd - tokenStart),
        color: token.color,
        fontStyle: token.fontStyle,
        highlighted: false,
      });
    }
  }
  return out;
}

function splitByHighlights(
  text: string,
  highlights: MatchRange[],
  color: string | undefined,
  fontStyle: number | undefined
): RenderSegment[] {
  if (highlights.length === 0) {
    return [{ content: text, color, fontStyle, highlighted: false }];
  }
  const out: RenderSegment[] = [];
  let cursor = 0;
  for (const hl of highlights) {
    if (hl.start > cursor) {
      out.push({
        content: text.slice(cursor, hl.start),
        color,
        fontStyle,
        highlighted: false,
      });
    }
    out.push({
      content: text.slice(hl.start, hl.end),
      color,
      fontStyle,
      highlighted: true,
    });
    cursor = hl.end;
  }
  if (cursor < text.length) {
    out.push({
      content: text.slice(cursor),
      color,
      fontStyle,
      highlighted: false,
    });
  }
  return out;
}

interface FileGroup {
  path: string;
  hash: string | null;
  matches: GrepMatch[];
}

interface Snippet {
  startLine: number; // 1-based
  endLine: number; // 1-based, inclusive
  matchLines: Set<number>;
}

function buildSnippets(matches: GrepMatch[], context: number): Snippet[] {
  const sorted = [...matches].sort((a, b) => a.lineNumber - b.lineNumber);
  const snippets: Snippet[] = [];
  for (const m of sorted) {
    const start = Math.max(1, m.lineNumber - context);
    const end = m.lineNumber + context;
    const last = snippets[snippets.length - 1];
    if (last && start <= last.endLine + 1) {
      last.endLine = Math.max(last.endLine, end);
      last.matchLines.add(m.lineNumber);
    } else {
      snippets.push({
        startLine: start,
        endLine: end,
        matchLines: new Set([m.lineNumber]),
      });
    }
  }
  return snippets;
}

export default function GrepPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [commit, setCommit] = useState(searchParams.get("commit") ?? "");
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [context, setContext] = useState<number>(
    Number.parseInt(searchParams.get("ctx") ?? "3", 10) || 3
  );
  const [maxFiles, setMaxFiles] = useState<number>(
    Number.parseInt(searchParams.get("maxFiles") ?? "20", 10) || 20
  );
  const [theme, setTheme] = useState(
    searchParams.get("theme") ?? DEFAULT_SHIKI_THEME
  );
  const [caseInsensitive, setCaseInsensitive] = useState(
    searchParams.get("ci") === "1"
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<GrepResponse | null>(null);
  const [pathToHash, setPathToHash] = useState<Record<string, string>>({});
  const [tokenizeByHash, setTokenizeByHash] = useState<
    Record<string, TokenizeResponse | { error: string } | "loading">
  >({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const lastAutoKey = useRef<string | null>(null);

  const runSearch = useCallback(
    async (
      nextCommit: string,
      nextQuery: string,
      options?: { syncSearchParams?: boolean }
    ) => {
      const trimmedCommit = nextCommit.trim();
      const trimmedQuery = nextQuery;
      if (!trimmedCommit) {
        setError("Enter a commit SHA.");
        return;
      }
      if (!trimmedQuery) {
        setError("Enter a search query.");
        return;
      }

      setError("");
      setLoading(true);
      setResponse(null);
      setTokenizeByHash({});
      setCollapsed({});

      if (options?.syncSearchParams !== false) {
        const next = new URLSearchParams();
        next.set("commit", trimmedCommit);
        next.set("q", trimmedQuery);
        next.set("ctx", String(context));
        next.set("maxFiles", String(maxFiles));
        if (theme && theme !== DEFAULT_SHIKI_THEME) next.set("theme", theme);
        if (caseInsensitive) next.set("ci", "1");
        setSearchParams(next, { replace: true });
      }

      try {
        const [grepResp, filesResp] = await Promise.all([
          fetch(buildGrepUrl(trimmedCommit, trimmedQuery)),
          fetch(buildCommitFilesUrl(trimmedCommit)),
        ]);

        if (!grepResp.ok) {
          const body = await grepResp.json().catch(() => null);
          const message =
            (body as { error?: string } | null)?.error ??
            `Grep failed (${grepResp.status})`;
          throw new Error(message);
        }

        const grepData = (await grepResp.json()) as GrepResponse;

        const map: Record<string, string> = {};
        if (filesResp.ok) {
          const filesData = (await filesResp.json()) as FilesResponse;
          for (const f of filesData.files) {
            map[f.path] = f.hash;
          }
        }

        setResponse(grepData);
        setPathToHash(map);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed.");
      } finally {
        setLoading(false);
      }
    },
    [caseInsensitive, context, maxFiles, setSearchParams, theme]
  );

  // Auto-run when URL contains commit & query on initial load.
  useEffect(() => {
    const c = searchParams.get("commit") ?? "";
    const q = searchParams.get("q") ?? "";
    const key = `${c}\n${q}\n${theme}`;
    if (!c || !q || lastAutoKey.current === key) return;
    lastAutoKey.current = key;
    void runSearch(c, q, { syncSearchParams: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo<FileGroup[]>(() => {
    if (!response) return [];
    const byPath = new Map<string, GrepMatch[]>();
    for (const m of response.matches) {
      const existing = byPath.get(m.path);
      if (existing) {
        existing.push(m);
      } else {
        byPath.set(m.path, [m]);
      }
    }
    const all: FileGroup[] = Array.from(byPath.entries()).map(
      ([path, matches]) => ({
        path,
        hash: pathToHash[path] ?? null,
        matches,
      })
    );
    all.sort((a, b) => b.matches.length - a.matches.length || a.path.localeCompare(b.path));
    return all.slice(0, maxFiles);
  }, [response, pathToHash, maxFiles]);

  // Fetch tokenize for visible groups (those with hash and not collapsed).
  useEffect(() => {
    if (!response) return;
    for (const g of groups) {
      if (!g.hash) continue;
      if (collapsed[g.path]) continue;
      const cacheKey = `${g.hash}|${theme}`;
      if (tokenizeByHash[cacheKey] !== undefined) continue;
      setTokenizeByHash((prev) => ({ ...prev, [cacheKey]: "loading" }));
      void (async () => {
        try {
          const r = await fetch(buildTokenizeUrl(g.hash!, theme));
          if (!r.ok) {
            const body = await r.json().catch(() => null);
            const msg =
              (body as { error?: string } | null)?.error ??
              `Tokenize failed (${r.status})`;
            setTokenizeByHash((prev) => ({
              ...prev,
              [cacheKey]: { error: msg },
            }));
            return;
          }
          const data = (await r.json()) as TokenizeResponse;
          setTokenizeByHash((prev) => ({ ...prev, [cacheKey]: data }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Tokenize error";
          setTokenizeByHash((prev) => ({ ...prev, [cacheKey]: { error: msg } }));
        }
      })();
    }
  }, [groups, response, theme, collapsed, tokenizeByHash]);

  const totalMatches = response?.matches.length ?? 0;
  const totalFiles = useMemo(() => {
    if (!response) return 0;
    return new Set(response.matches.map((m) => m.path)).size;
  }, [response]);

  return (
    <div className="grep-page">
      <div className="page-header">
        <h1>🔎 Grep Repository at Commit</h1>
        <p className="page-subtitle">
          Search file contents at a specific commit. Results are syntax
          highlighted with Shiki and matches are marked.
        </p>
      </div>

      <form
        className="grep-form"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(commit, query);
        }}
      >
        <div className="grep-form-row">
          <div className="grep-field grep-field--commit">
            <label htmlFor="grep-commit">Commit SHA</label>
            <input
              id="grep-commit"
              type="text"
              placeholder="full or short commit SHA"
              value={commit}
              onChange={(e) => setCommit(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="grep-field grep-field--query">
            <label htmlFor="grep-query">Query</label>
            <input
              id="grep-query"
              type="text"
              placeholder="text to search for…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        <div className="grep-form-row">
          <div className="grep-field grep-field--small">
            <label htmlFor="grep-context">Context lines</label>
            <input
              id="grep-context"
              type="number"
              min={0}
              max={50}
              value={context}
              onChange={(e) =>
                setContext(Math.max(0, Math.min(50, Number(e.target.value) || 0)))
              }
            />
          </div>
          <div className="grep-field grep-field--small">
            <label htmlFor="grep-max-files">Max files</label>
            <input
              id="grep-max-files"
              type="number"
              min={1}
              max={500}
              value={maxFiles}
              onChange={(e) =>
                setMaxFiles(
                  Math.max(1, Math.min(500, Number(e.target.value) || 1))
                )
              }
            />
          </div>
          <div className="grep-field grep-field--theme">
            <label htmlFor="grep-theme">Theme</label>
            <input
              id="grep-theme"
              type="text"
              list="grep-theme-options"
              placeholder={DEFAULT_SHIKI_THEME}
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            />
            <datalist id="grep-theme-options">
              {SHIKI_THEMES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <div className="grep-field grep-field--checkbox">
            <label>
              <input
                type="checkbox"
                checked={caseInsensitive}
                onChange={(e) => setCaseInsensitive(e.target.checked)}
              />{" "}
              Case-insensitive highlighting
            </label>
            <span className="grep-field-hint">
              Backend match is case-sensitive; this only affects in-line
              highlighting.
            </span>
          </div>
          <button type="submit" className="grep-submit" disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </form>

      {error && <div className="grep-error">{error}</div>}
      {loading && <div className="grep-loading">Running grep…</div>}

      {response && (
        <div className="grep-summary">
          <span>
            <strong>{totalMatches}</strong> match{totalMatches === 1 ? "" : "es"}{" "}
            in <strong>{totalFiles}</strong> file{totalFiles === 1 ? "" : "s"}
          </span>
          <span className="grep-summary-divider">•</span>
          <span>
            commit <code>{response.commitShort}</code>
          </span>
          <span className="grep-summary-divider">•</span>
          <span>
            query: <code>{response.query}</code>
          </span>
          {totalFiles > groups.length && (
            <span className="grep-summary-truncated">
              showing first {groups.length} files (raise “Max files” to see more)
            </span>
          )}
        </div>
      )}

      {response && groups.length === 0 && !loading && (
        <div className="grep-empty">No matches found.</div>
      )}

      <div className="grep-results">
        {groups.map((group) => {
          const cacheKey = group.hash ? `${group.hash}|${theme}` : null;
          const tok = cacheKey ? tokenizeByHash[cacheKey] : undefined;
          const isCollapsed = collapsed[group.path] ?? false;
          const snippets = buildSnippets(group.matches, context);

          return (
            <div key={group.path} className="grep-file-card">
              <div className="grep-file-header">
                <button
                  type="button"
                  className="grep-file-toggle"
                  onClick={() =>
                    setCollapsed((prev) => ({
                      ...prev,
                      [group.path]: !isCollapsed,
                    }))
                  }
                  aria-label={isCollapsed ? "Expand file" : "Collapse file"}
                >
                  {isCollapsed ? "▸" : "▾"}
                </button>
                <span className="grep-file-path">{group.path}</span>
                <span className="grep-file-count">
                  {group.matches.length} match
                  {group.matches.length === 1 ? "" : "es"}
                </span>
                {group.hash && (
                  <span className="grep-file-hash" title={group.hash}>
                    {group.hash.slice(0, 7)}
                  </span>
                )}
              </div>

              {!isCollapsed && (
                <FileSnippets
                  group={group}
                  snippets={snippets}
                  query={response?.query ?? query}
                  caseInsensitive={caseInsensitive}
                  tokenize={tok}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FileSnippets({
  group,
  snippets,
  query,
  caseInsensitive,
  tokenize,
}: {
  group: FileGroup;
  snippets: Snippet[];
  query: string;
  caseInsensitive: boolean;
  tokenize?: TokenizeResponse | { error: string } | "loading";
}) {
  if (!group.hash) {
    return (
      <div className="grep-file-warning">
        File hash not found in job metadata. Showing only matched lines (no
        context, no syntax coloring).
        <SimpleMatchList
          matches={group.matches}
          query={query}
          caseInsensitive={caseInsensitive}
        />
      </div>
    );
  }

  if (tokenize === "loading" || tokenize === undefined) {
    return <div className="grep-file-loading">Loading file…</div>;
  }

  if ("error" in tokenize) {
    return (
      <div className="grep-file-warning">
        Could not tokenize file: {tokenize.error}
        <SimpleMatchList
          matches={group.matches}
          query={query}
          caseInsensitive={caseInsensitive}
        />
      </div>
    );
  }

  const tokens = tokenize.tokens;
  const totalLines = tokens.length;

  return (
    <div
      className="grep-snippet-block"
      style={{ background: tokenize.bg, color: tokenize.fg }}
    >
      {snippets.map((snippet, sIdx) => {
        const start = Math.max(1, snippet.startLine);
        const end = Math.min(totalLines, snippet.endLine);
        const rows: React.ReactNode[] = [];
        for (let line = start; line <= end; line++) {
          const lineTokens = tokens[line - 1] ?? null;
          const lineText = lineTokens
            ? lineTokens.map((t) => t.content).join("")
            : "";
          const isMatch = snippet.matchLines.has(line);
          const highlights = isMatch
            ? findMatches(lineText, query, caseInsensitive)
            : [];
          const segments = renderTokensWithHighlights(
            lineTokens,
            lineText,
            highlights
          );

          rows.push(
            <div
              key={line}
              className={`grep-line${isMatch ? " grep-line--match" : ""}`}
            >
              <span className="grep-line-number">{line}</span>
              <span className="grep-line-content">
                {segments.length === 0 ? (
                  <span> </span>
                ) : (
                  segments.map((seg, i) => (
                    <span
                      key={i}
                      className={
                        seg.highlighted ? "grep-line-highlight" : undefined
                      }
                      style={{
                        color: seg.color ?? tokenize.fg,
                        ...tokenFontStyle(seg.fontStyle),
                      }}
                    >
                      {seg.content}
                    </span>
                  ))
                )}
              </span>
            </div>
          );
        }
        return (
          <div key={sIdx} className="grep-snippet">
            {sIdx > 0 && <div className="grep-snippet-sep">⋯</div>}
            {rows}
          </div>
        );
      })}
    </div>
  );
}

function SimpleMatchList({
  matches,
  query,
  caseInsensitive,
}: {
  matches: GrepMatch[];
  query: string;
  caseInsensitive: boolean;
}) {
  return (
    <div className="grep-snippet-block grep-snippet-block--plain">
      {matches.map((m, idx) => {
        const highlights = findMatches(m.line, query, caseInsensitive);
        const segments = splitByHighlights(
          m.line,
          highlights,
          undefined,
          undefined
        );
        return (
          <div key={idx} className="grep-line grep-line--match">
            <span className="grep-line-number">{m.lineNumber}</span>
            <span className="grep-line-content">
              {segments.map((seg, i) => (
                <span
                  key={i}
                  className={seg.highlighted ? "grep-line-highlight" : undefined}
                >
                  {seg.content}
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
