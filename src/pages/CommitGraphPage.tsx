import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  parseRepositoryLocation,
  requestCommitGraph,
} from "../utils/repositorySelection";
import type { RepositoryCommit } from "../utils/repositorySelection";
import "./CommitGraphPage.css";

const DEFAULT_GRAPH_LIMIT = 200;
const MAX_GRAPH_LIMIT = 1000;
const LANE_WIDTH = 16;
const ROW_HEIGHT = 32;
const NODE_RADIUS = 4;
const GRAPH_PADDING_LEFT = 8;

interface LaneState {
  /** Which column (0-based) each commit sits in. */
  column: Map<string, number>;
  /** Maximum column index used. */
  maxColumn: number;
}

/**
 * Assign each commit to a lane (column) in the DAG grid.
 *
 * The algorithm walks commits top-to-bottom (newest first, as returned by the
 * API).  Active lanes track which ongoing parent SHAs are expected.  When a
 * commit appears it takes over the lane reserved for it (or opens a new one if
 * it was not previously seen as a parent).  Parent SHAs that haven't been seen
 * yet are assigned to lanes for future commits.
 */
function assignLanes(commits: RepositoryCommit[]): LaneState {
  const column = new Map<string, number>();
  /** Each element is the SHA the lane is "waiting for", or null if the lane is free. */
  const activeLanes: (string | null)[] = [];

  function findLaneForSha(sha: string): number {
    for (let i = 0; i < activeLanes.length; i++) {
      if (activeLanes[i] === sha) return i;
    }
    return -1;
  }

  function nextFreeLane(): number {
    for (let i = 0; i < activeLanes.length; i++) {
      if (activeLanes[i] === null) return i;
    }
    activeLanes.push(null);
    return activeLanes.length - 1;
  }

  for (const commit of commits) {
    let lane = findLaneForSha(commit.commit);
    if (lane === -1) {
      lane = nextFreeLane();
    }
    activeLanes[lane] = null; // commit consumed
    column.set(commit.commit, lane);

    // Reserve lanes for parents
    for (let pi = 0; pi < commit.parents.length; pi++) {
      const parentSha = commit.parents[pi];
      // If this parent is already waiting in some lane, leave it there.
      if (findLaneForSha(parentSha) !== -1) continue;
      // If this parent was already assigned a column (duplicate), skip.
      if (column.has(parentSha)) continue;

      if (pi === 0) {
        // First parent (continuation of the same branch): reuse the current lane.
        activeLanes[lane] = parentSha;
      } else {
        // Additional parents: open a new lane.
        const newLane = nextFreeLane();
        activeLanes[newLane] = parentSha;
      }
    }
  }

  let maxColumn = 0;
  for (const col of column.values()) {
    if (col > maxColumn) maxColumn = col;
  }

  return { column, maxColumn };
}

const LANE_COLORS = [
  "#58a6ff", // blue
  "#7ee787", // green
  "#e3b341", // yellow
  "#a371f7", // purple
  "#f78166", // orange
  "#ff7b72", // red
  "#79c0ff", // light blue
  "#d2a8ff", // lavender
  "#ffa657", // light orange
  "#56d364", // bright green
];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

interface GraphColumnProps {
  commits: RepositoryCommit[];
  laneState: LaneState;
}

function GraphColumn({ commits, laneState }: GraphColumnProps) {
  const { column, maxColumn } = laneState;
  const svgWidth = GRAPH_PADDING_LEFT + (maxColumn + 1) * LANE_WIDTH + LANE_WIDTH;
  const svgHeight = commits.length * ROW_HEIGHT;

  const commitRow = new Map<string, number>();
  commits.forEach((c, i) => commitRow.set(c.commit, i));

  // Build edge segments
  const edges: { fromRow: number; fromCol: number; toRow: number; toCol: number }[] = [];
  for (const commit of commits) {
    const row = commitRow.get(commit.commit);
    const col = column.get(commit.commit);
    if (row === undefined || col === undefined) continue;

    for (const parentSha of commit.parents) {
      const parentRow = commitRow.get(parentSha);
      const parentCol = column.get(parentSha);
      if (parentRow === undefined || parentCol === undefined) continue;
      edges.push({ fromRow: row, fromCol: col, toRow: parentRow, toCol: parentCol });
    }
  }

  function cx(col: number): number {
    return GRAPH_PADDING_LEFT + col * LANE_WIDTH + LANE_WIDTH / 2;
  }
  function cy(row: number): number {
    return row * ROW_HEIGHT + ROW_HEIGHT / 2;
  }

  return (
    <svg
      className="commit-graph__svg"
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
    >
      {edges.map((edge, i) => {
        const x1 = cx(edge.fromCol);
        const y1 = cy(edge.fromRow);
        const x2 = cx(edge.toCol);
        const y2 = cy(edge.toRow);
        const color = laneColor(edge.fromCol);

        if (x1 === x2) {
          // Straight vertical line
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeWidth={2}
              strokeOpacity={0.6}
            />
          );
        }

        // Curved path for merges / branches
        const midY = (y1 + y2) / 2;
        const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
        return (
          <path
            key={i}
            d={d}
            stroke={color}
            strokeWidth={2}
            strokeOpacity={0.6}
            fill="none"
          />
        );
      })}

      {commits.map((commit, row) => {
        const col = column.get(commit.commit);
        if (col === undefined) return null;
        const color = laneColor(col);
        return (
          <circle
            key={commit.commit}
            cx={cx(col)}
            cy={cy(row)}
            r={NODE_RADIUS}
            fill={color}
            stroke="#0d1117"
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}

function formatGraphDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return isoDate;
  return date.toLocaleString();
}

function buildGitHubCommitUrl(repo: string, commit: string): string {
  const parts = repo.split("/");
  return `https://github.com/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/commit/${encodeURIComponent(commit)}`;
}

export default function CommitGraphPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryRepo = searchParams.get("repo") ?? "";

  const [repoInput, setRepoInput] = useState(queryRepo);
  const [commits, setCommits] = useState<RepositoryCommit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedRepo, setLoadedRepo] = useState("");

  const abortControllerRef = useRef<AbortController | null>(null);
  const autoLoadedRepoRef = useRef("");
  const currentSearchRef = useRef(searchParams.toString());

  const resolveRepoInput = useCallback((input: string): string => {
    const trimmed = input.trim();
    if (!trimmed) return "";

    const parsed = parseRepositoryLocation(trimmed);
    if (parsed) return parsed.repo;

    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(trimmed)) {
      return trimmed;
    }

    return trimmed;
  }, []);

  const loadGraph = useCallback(
    async (repo: string) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError("");
      setCommits([]);
      setLoadedRepo("");

      try {
        const result = await requestCommitGraph(
          repo,
          DEFAULT_GRAPH_LIMIT,
          controller.signal
        );
        setCommits(result);
        setLoadedRepo(repo);

        const params = new URLSearchParams(currentSearchRef.current);
        params.set("repo", repo);
        setSearchParams(params, { replace: true });
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Unable to load commit graph"
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [setSearchParams]
  );

  useEffect(() => {
    currentSearchRef.current = searchParams.toString();
  }, [searchParams]);

  const handleLoad = useCallback(async () => {
    const repo = resolveRepoInput(repoInput);
    if (!repo) {
      setError("Please enter a repository in owner/repo format.");
      return;
    }
    autoLoadedRepoRef.current = repo;
    await loadGraph(repo);
  }, [loadGraph, repoInput, resolveRepoInput]);

  // Auto-load from URL query params
  useEffect(() => {
    const repo = resolveRepoInput(queryRepo);
    if (!repo || autoLoadedRepoRef.current === repo) return;
    autoLoadedRepoRef.current = repo;
    setRepoInput(repo);
    void loadGraph(repo);
  }, [loadGraph, queryRepo, resolveRepoInput]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleLoadMore = useCallback(async () => {
    const repo = resolveRepoInput(repoInput);
    if (!repo) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const nextLimit = Math.min(
      commits.length + DEFAULT_GRAPH_LIMIT,
      MAX_GRAPH_LIMIT
    );

    setIsLoading(true);
    setError("");

    try {
      const result = await requestCommitGraph(repo, nextLimit, controller.signal);
      setCommits(result);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Unable to load commit graph"
      );
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [repoInput, resolveRepoInput, commits.length]);

  const laneState = useMemo(() => assignLanes(commits), [commits]);

  const graphColumnWidth = useMemo(
    () =>
      GRAPH_PADDING_LEFT +
      (laneState.maxColumn + 1) * LANE_WIDTH +
      LANE_WIDTH,
    [laneState.maxColumn]
  );

  return (
    <div className="commit-graph-page">
      <div className="page-header">
        <h1>🌳 Commit Graph</h1>
        <p className="page-subtitle">
          DAG visualisation of repository commit history.
        </p>
      </div>

      <div className="commit-graph__input-section">
        <label htmlFor="commit-graph-input">Repository</label>
        <div className="commit-graph__input-row">
          <input
            id="commit-graph-input"
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleLoad();
            }}
            placeholder="owner/repo or paste full GitHub URL"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => void handleLoad()}
            disabled={isLoading || !repoInput.trim()}
          >
            {isLoading && commits.length === 0 ? "Loading…" : "Load graph"}
          </button>
        </div>
      </div>

      {error && <div className="commit-graph__error">{error}</div>}

      {commits.length > 0 && (
        <div className="commit-graph__container">
          <div className="commit-graph__header">
            <span className="commit-graph__title">
              Commit graph for{" "}
              <a
                href={`https://github.com/${loadedRepo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="commit-graph__repo-link"
              >
                {loadedRepo}
              </a>
            </span>
            <span className="commit-graph__count">
              {commits.length} commit{commits.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="commit-graph__grid-wrapper">
            <div
              className="commit-graph__grid"
              style={
                {
                  "--graph-col-width": `${graphColumnWidth}px`,
                  "--row-height": `${ROW_HEIGHT}px`,
                } as React.CSSProperties
              }
            >
              {/* Left column: SVG DAG graph */}
              <div className="commit-graph__graph-col">
                <GraphColumn commits={commits} laneState={laneState} />
              </div>

              {/* Right column: commit metadata rows */}
              <div className="commit-graph__info-col">
                {commits.map((commit) => (
                  <div
                    key={commit.commit}
                    className="commit-graph__row"
                    style={{ height: ROW_HEIGHT }}
                  >
                    <span className="commit-graph__row-message" title={commit.title}>
                      {commit.title}
                    </span>

                    <span className="commit-graph__row-badges">
                      {commit.branch && (
                        <span className="commit-graph__branch-badge">
                          {commit.branch}
                        </span>
                      )}
                      {commit.tags.map((tag) => (
                        <span key={tag} className="commit-graph__tag-badge">
                          {tag}
                        </span>
                      ))}
                      {commit.pullRequest && (
                        <a
                          href={commit.pullRequest.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="commit-graph__pr-badge"
                          title={commit.pullRequest.title}
                        >
                          #{commit.pullRequest.number}
                        </a>
                      )}
                    </span>

                    <a
                      href={buildGitHubCommitUrl(loadedRepo, commit.commit)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="commit-graph__row-sha"
                    >
                      {commit.commit.slice(0, 7)}
                    </a>

                    <span className="commit-graph__row-author">
                      {commit.author}
                    </span>

                    <span className="commit-graph__row-date">
                      {formatGraphDate(commit.date)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {commits.length < MAX_GRAPH_LIMIT && (
            <div className="commit-graph__load-more">
              <button
                type="button"
                onClick={() => void handleLoadMore()}
                disabled={isLoading}
              >
                {isLoading ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}

      {!isLoading && commits.length === 0 && !error && (
        <div className="commit-graph__empty">
          <div className="commit-graph__empty-icon">🌳</div>
          <h2>No commit graph loaded</h2>
          <p>
            Enter a repository above (e.g.{" "}
            <code>file-diff/file-diff-frontend</code>) and click{" "}
            <strong>Load graph</strong> to visualise the commit DAG.
          </p>
        </div>
      )}
    </div>
  );
}
