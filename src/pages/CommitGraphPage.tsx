import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { JOBS_API_URL } from "../config/api";
import {
  parseRepositoryLocation,
  requestRepositoryCommitGraph,
  requestRepositoryCommits,
} from "../utils/repositorySelection";
import type {
  CommitGraphEdge,
  CommitGraphItem,
  CommitGraphNode,
  RepositoryCommit,
} from "../utils/repositorySelection";
import { buildTreeComparisonLink } from "../utils/storage";
import "./CommitGraphPage.css";

const DEFAULT_GRAPH_LIMIT = 1000;
const MAX_GRAPH_LIMIT = 1000;
const ROW_HEIGHT = 84;
const LANE_WIDTH = 36;
const GRAPH_GUTTER_PADDING = 18;
const INDEXING_TRIGGER_URL = JOBS_API_URL;

interface JobRequest {
  repo: string;
  commit: string;
}

interface PositionedGraphEdge {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

interface CommitGraphLayout {
  laneByCommit: Map<string, number>;
  colorKeyByCommit: Map<string, string>;
  edges: PositionedGraphEdge[];
  laneCount: number;
}

function formatCommitDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleString();
}

function buildGitHubCommitUrl(repo: string, commit: string): string {
  const [owner = "", name = ""] = repo.split("/");
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commit/${encodeURIComponent(commit)}`;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getBranchColor(branchName: string): string {
  const hue = hashString(branchName) % 360;
  return `hsl(${hue} 70% 62%)`;
}

function getNodeCenterX(lane: number): number {
  return GRAPH_GUTTER_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function getNodeCenterY(row: number): number {
  return row * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function findAvailableLane(activeLanes: Array<string | null>): number {
  const availableIndex = activeLanes.findIndex((lane) => lane === null);
  return availableIndex === -1 ? activeLanes.length : availableIndex;
}

function buildCommitGraphLayout(
  commits: RepositoryCommit[],
  graphItems: CommitGraphItem[]
): CommitGraphLayout {
  const rowByCommit = new Map<string, number>();
  commits.forEach((commit, index) => {
    rowByCommit.set(commit.commit, index);
  });

  const nodeItems = new Map<string, CommitGraphNode>();
  const edgeItems: CommitGraphEdge[] = [];
  graphItems.forEach((item) => {
    if (item.type === "node") {
      nodeItems.set(item.id, item);
      return;
    }

    edgeItems.push(item);
  });

  const activeLanes: Array<string | null> = [];
  const laneByCommit = new Map<string, number>();

  commits.forEach((commit) => {
    let lane = activeLanes.indexOf(commit.commit);
    if (lane === -1) {
      lane = findAvailableLane(activeLanes);
    }

    laneByCommit.set(commit.commit, lane);
    activeLanes[lane] = null;

    const visibleParents = commit.parents.filter((parent) => rowByCommit.has(parent));
    if (visibleParents.length === 0) {
      return;
    }

    activeLanes[lane] = visibleParents[0];

    visibleParents.slice(1).forEach((parent) => {
      if (activeLanes.includes(parent)) {
        return;
      }

      const nextLane = findAvailableLane(activeLanes);
      activeLanes[nextLane] = parent;
    });
  });

  const colorKeyByCommit = new Map<string, string>();
  nodeItems.forEach((node) => {
    if (node.colorKey) {
      colorKeyByCommit.set(node.id, node.colorKey);
    }
  });

  const edges = edgeItems.flatMap((edge) => {
    const sourceRow = rowByCommit.get(edge.source);
    const targetRow = rowByCommit.get(edge.target);
    const sourceLane = laneByCommit.get(edge.source);
    const targetLane = laneByCommit.get(edge.target);

    if (
      sourceRow === undefined ||
      targetRow === undefined ||
      sourceLane === undefined ||
      targetLane === undefined
    ) {
      return [];
    }

    return [
      {
        id: edge.id,
        sourceX: getNodeCenterX(sourceLane),
        sourceY: getNodeCenterY(sourceRow),
        targetX: getNodeCenterX(targetLane),
        targetY: getNodeCenterY(targetRow),
      },
    ];
  });

  const laneCount = Math.max(
    1,
    ...Array.from(laneByCommit.values(), (lane) => lane + 1)
  );

  return {
    laneByCommit,
    colorKeyByCommit,
    edges,
    laneCount,
  };
}

function buildEdgePath(edge: PositionedGraphEdge): string {
  const startX = edge.targetX;
  const startY = edge.targetY;
  const endX = edge.sourceX;
  const endY = edge.sourceY;

  if (startX === endX) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }

  const middleY = startY + (endY - startY) / 2;
  return [
    `M ${startX} ${startY}`,
    `L ${startX} ${middleY}`,
    `L ${endX} ${middleY}`,
    `L ${endX} ${endY}`,
  ].join(" ");
}

function buildGraphViewLink(repo: string, limit: string): string {
  const params = new URLSearchParams();
  if (repo.trim()) {
    params.set("repo", repo.trim());
  }
  if (limit.trim()) {
    params.set("limit", limit.trim());
  }
  const query = params.toString();
  return query ? `/commits/graph?${query}` : "/commits/graph";
}

export default function CommitGraphPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryRepo = searchParams.get("repo") ?? "";
  const queryLimit = searchParams.get("limit") ?? String(DEFAULT_GRAPH_LIMIT);

  const [repoInput, setRepoInput] = useState(queryRepo);
  const [limitInput, setLimitInput] = useState(queryLimit);
  const [commits, setCommits] = useState<RepositoryCommit[]>([]);
  const [graphItems, setGraphItems] = useState<CommitGraphItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedRepo, setLoadedRepo] = useState("");
  const [loadedLimit, setLoadedLimit] = useState(DEFAULT_GRAPH_LIMIT);
  const [leftCommit, setLeftCommit] = useState<string | null>(null);
  const [rightCommit, setRightCommit] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const autoLoadedKeyRef = useRef("");
  const currentSearchRef = useRef(searchParams.toString());
  const startedIndexingKeysRef = useRef<Set<string>>(new Set());

  const resolveRepoInput = useCallback((input: string): string => {
    const trimmed = input.trim();
    if (!trimmed) {
      return "";
    }

    const parsed = parseRepositoryLocation(trimmed);
    if (parsed) {
      return parsed.repo;
    }

    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(trimmed)) {
      return trimmed;
    }

    return trimmed;
  }, []);

  const resolveLimitInput = useCallback((input: string): number | null => {
    const trimmed = input.trim();
    const parsed = Number.parseInt(trimmed, 10);

    if (!trimmed || !Number.isInteger(parsed) || parsed <= 0) {
      return null;
    }

    return Math.min(parsed, MAX_GRAPH_LIMIT);
  }, []);

  const loadGraphForRepo = useCallback(
    async (repo: string, limit: number) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError("");
      setCommits([]);
      setGraphItems([]);
      setLeftCommit(null);
      setRightCommit(null);
      setLoadedRepo("");
      setLoadedLimit(limit);

      try {
        const [nextCommits, nextGraphItems] = await Promise.all([
          requestRepositoryCommits(repo, limit, controller.signal),
          requestRepositoryCommitGraph(repo, limit, controller.signal),
        ]);

        if (controller.signal.aborted) {
          return;
        }

        setCommits(nextCommits);
        setGraphItems(nextGraphItems);
        setLoadedRepo(repo);
        setLoadedLimit(limit);

        const params = new URLSearchParams(currentSearchRef.current);
        params.set("repo", repo);
        params.set("limit", String(limit));
        setSearchParams(params, { replace: true });
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }

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

  const handleLoadGraph = useCallback(async () => {
    const repo = resolveRepoInput(repoInput);
    if (!repo) {
      setError("Please enter a repository in owner/repo format.");
      return;
    }

    const limit = resolveLimitInput(limitInput);
    if (!limit) {
      setError(`Please enter a commit limit between 1 and ${MAX_GRAPH_LIMIT}.`);
      return;
    }

    autoLoadedKeyRef.current = `${repo}:${limit}`;
    await loadGraphForRepo(repo, limit);
  }, [limitInput, loadGraphForRepo, repoInput, resolveLimitInput, resolveRepoInput]);

  useEffect(() => {
    const repo = resolveRepoInput(queryRepo);
    const limit = resolveLimitInput(queryLimit);
    const nextKey = repo && limit ? `${repo}:${limit}` : "";

    if (!repo || !limit || autoLoadedKeyRef.current === nextKey) {
      return;
    }

    autoLoadedKeyRef.current = nextKey;
    setRepoInput(repo);
    setLimitInput(String(limit));
    void loadGraphForRepo(repo, limit);
  }, [loadGraphForRepo, queryLimit, queryRepo, resolveLimitInput, resolveRepoInput]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const repo = loadedRepo.trim();
    if (!repo) {
      return;
    }

    [leftCommit, rightCommit]
      .filter((commit): commit is string => Boolean(commit?.trim()))
      .forEach((commit) => {
        const indexingKey = `${repo}\n${commit}`;
        if (startedIndexingKeysRef.current.has(indexingKey)) {
          return;
        }

        startedIndexingKeysRef.current.add(indexingKey);

        const request: JobRequest = { repo, commit };
        void fetch(INDEXING_TRIGGER_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
        })
          .then((response) => {
            if (!response.ok) {
              throw new Error("Unable to start indexing job");
            }
          })
          .catch((indexingError: unknown) => {
            startedIndexingKeysRef.current.delete(indexingKey);
            console.error("[CommitGraphPage] failed to start indexing job", {
              repo,
              commit,
              error:
                indexingError instanceof Error
                  ? indexingError.message
                  : "Unknown error",
            });
          });
      });
  }, [leftCommit, loadedRepo, rightCommit]);

  const compareLink = useMemo(() => {
    if (!leftCommit || !rightCommit || !loadedRepo) {
      return null;
    }

    const query = buildTreeComparisonLink(
      {
        repo: loadedRepo,
        inputRefName: "",
        resolvedCommit: leftCommit,
        root: "/",
      },
      {
        repo: loadedRepo,
        inputRefName: "",
        resolvedCommit: rightCommit,
        root: "/",
      }
    );

    return query ? `/tree?${query}` : null;
  }, [leftCommit, loadedRepo, rightCommit]);

  const graphLayout = useMemo(
    () => buildCommitGraphLayout(commits, graphItems),
    [commits, graphItems]
  );

  const graphWidth =
    GRAPH_GUTTER_PADDING * 2 + graphLayout.laneCount * LANE_WIDTH;
  const graphHeight = Math.max(commits.length * ROW_HEIGHT, ROW_HEIGHT);
  const graphViewLink = useMemo(
    () => buildGraphViewLink(resolveRepoInput(repoInput) || loadedRepo, limitInput),
    [limitInput, loadedRepo, repoInput, resolveRepoInput]
  );

  const handleSelectCommit = useCallback(
    (commit: string) => {
      if (leftCommit === commit) {
        setLeftCommit(null);
        return;
      }

      if (rightCommit === commit) {
        setRightCommit(null);
        return;
      }

      if (!leftCommit) {
        setLeftCommit(commit);
      } else if (!rightCommit) {
        setRightCommit(commit);
      } else {
        setLeftCommit(rightCommit);
        setRightCommit(commit);
      }
    },
    [leftCommit, rightCommit]
  );

  const branchLegend = useMemo(() => {
    const uniqueBranches = Array.from(graphLayout.colorKeyByCommit.values());
    return [...new Set(uniqueBranches)].sort((left, right) =>
      left.localeCompare(right)
    );
  }, [graphLayout.colorKeyByCommit]);

  return (
    <div className="commit-graph-page">
      <div className="page-header">
        <h1>🕸️ Commit DAG</h1>
        <p className="page-subtitle">
          Explore repository history as a grid-based DAG and select two commits
          to compare.
        </p>
        <Link to={`/commits${loadedRepo ? `?repo=${encodeURIComponent(loadedRepo)}` : ""}`} className="commit-graph__back-link">
          ← Back to commit list
        </Link>
      </div>

      <div className="commit-graph__input-section">
        <div className="commit-graph__field">
          <label htmlFor="commit-graph-repo-input">Repository</label>
          <input
            id="commit-graph-repo-input"
            type="text"
            value={repoInput}
            onChange={(event) => setRepoInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void handleLoadGraph();
              }
            }}
            placeholder="owner/repo or paste full GitHub URL"
            spellCheck={false}
          />
        </div>
        <div className="commit-graph__field commit-graph__field--limit">
          <label htmlFor="commit-graph-limit-input">Commit limit</label>
          <input
            id="commit-graph-limit-input"
            type="number"
            min="1"
            max={MAX_GRAPH_LIMIT}
            step="1"
            value={limitInput}
            onChange={(event) => setLimitInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void handleLoadGraph();
              }
            }}
          />
        </div>
        <div className="commit-graph__actions">
          <button
            type="button"
            onClick={() => void handleLoadGraph()}
            disabled={isLoading || !repoInput.trim()}
          >
            {isLoading ? "Loading…" : "Load DAG"}
          </button>
          <Link to={graphViewLink} className="commit-graph__self-link">
            Share link
          </Link>
        </div>
      </div>

      {error && <div className="commit-graph__error">{error}</div>}

      {leftCommit || rightCommit ? (
        <div className="commit-graph__selection">
          <div className="commit-graph__selection-summary">
            <div className="commit-graph__selection-side">
              <span className="commit-graph__selection-label">Left</span>
              <code className="commit-graph__selection-commit">
                {leftCommit ? leftCommit.slice(0, 12) : "—"}
              </code>
            </div>
            <div className="commit-graph__selection-side">
              <span className="commit-graph__selection-label">Right</span>
              <code className="commit-graph__selection-commit">
                {rightCommit ? rightCommit.slice(0, 12) : "—"}
              </code>
            </div>
          </div>
          <div className="commit-graph__selection-actions">
            {compareLink && (
              <Link to={compareLink} className="commit-graph__compare-btn">
                Compare selected commits
              </Link>
            )}
            <button
              type="button"
              className="commit-graph__clear-btn"
              onClick={() => {
                setLeftCommit(null);
                setRightCommit(null);
              }}
            >
              Clear selection
            </button>
          </div>
        </div>
      ) : null}

      {branchLegend.length > 0 && (
        <div className="commit-graph__legend">
          {branchLegend.map((branch) => (
            <span key={branch} className="commit-graph__legend-item">
              <span
                className="commit-graph__legend-dot"
                style={{ backgroundColor: getBranchColor(branch) }}
              />
              {branch}
            </span>
          ))}
        </div>
      )}

      {commits.length > 0 && (
        <div className="commit-graph__panel">
          <div className="commit-graph__panel-header">
            <span className="commit-graph__panel-title">
              DAG for{" "}
              <a
                href={`https://github.com/${loadedRepo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="commit-graph__repo-link"
              >
                {loadedRepo}
              </a>
            </span>
            <span className="commit-graph__panel-count">
              {commits.length} commit{commits.length !== 1 ? "s" : ""} · limit{" "}
              {loadedLimit}
            </span>
          </div>

          <div className="commit-graph__viewport">
            <div
              className="commit-graph__canvas"
              style={
                {
                  "--graph-width": `${graphWidth}px`,
                  "--graph-height": `${graphHeight}px`,
                  "--row-height": `${ROW_HEIGHT}px`,
                  "--lane-width": `${LANE_WIDTH}px`,
                } as React.CSSProperties
              }
            >
              <svg
                className="commit-graph__edges"
                width={graphWidth}
                height={graphHeight}
                viewBox={`0 0 ${graphWidth} ${graphHeight}`}
                aria-hidden="true"
              >
                {graphLayout.edges.map((edge) => (
                  <path
                    key={edge.id}
                    d={buildEdgePath(edge)}
                    className="commit-graph__edge-path"
                  />
                ))}
              </svg>

              <div className="commit-graph__rows">
                {commits.map((entry, index) => {
                  const lane = graphLayout.laneByCommit.get(entry.commit) ?? 0;
                  const colorKey = graphLayout.colorKeyByCommit.get(entry.commit);
                  const isLeft = leftCommit === entry.commit;
                  const isRight = rightCommit === entry.commit;
                  const isSelected = isLeft || isRight;

                  return (
                    <div
                      key={entry.commit}
                      className={
                        "commit-graph__row" +
                        (isSelected ? " commit-graph__row--selected" : "") +
                        (isLeft ? " commit-graph__row--left" : "") +
                        (isRight ? " commit-graph__row--right" : "")
                      }
                      onClick={() => handleSelectCommit(entry.commit)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleSelectCommit(entry.commit);
                        }
                      }}
                    >
                      <div className="commit-graph__gutter">
                        <div
                          className="commit-graph__node-lane"
                          style={{ left: getNodeCenterX(lane) }}
                        >
                          <button
                            type="button"
                            className={
                              "commit-graph__node" +
                              (isLeft ? " commit-graph__node--left" : "") +
                              (isRight ? " commit-graph__node--right" : "")
                            }
                            style={{
                              backgroundColor: colorKey
                                ? getBranchColor(colorKey)
                                : "#58a6ff",
                            }}
                            title={entry.commit}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleSelectCommit(entry.commit);
                            }}
                          >
                            {isLeft ? "L" : isRight ? "R" : ""}
                          </button>
                        </div>
                      </div>

                      <div className="commit-graph__details">
                        <div className="commit-graph__details-header">
                          <div className="commit-graph__title-group">
                            <span className="commit-graph__title">{entry.title}</span>
                            <div className="commit-graph__meta">
                              <a
                                href={buildGitHubCommitUrl(loadedRepo, entry.commit)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="commit-graph__sha"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {entry.commit.slice(0, 7)}
                              </a>
                              <span>{entry.author}</span>
                              <span>{formatCommitDate(entry.date)}</span>
                              <span>row {index + 1}</span>
                              <span>lane {lane + 1}</span>
                            </div>
                          </div>
                          <div className="commit-graph__select-btns">
                            <button
                              type="button"
                              className={
                                "commit-graph__select-btn commit-graph__select-btn--left" +
                                (isLeft
                                  ? " commit-graph__select-btn--active"
                                  : "")
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                setLeftCommit(isLeft ? null : entry.commit);
                              }}
                            >
                              L
                            </button>
                            <button
                              type="button"
                              className={
                                "commit-graph__select-btn commit-graph__select-btn--right" +
                                (isRight
                                  ? " commit-graph__select-btn--active"
                                  : "")
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                setRightCommit(isRight ? null : entry.commit);
                              }}
                            >
                              R
                            </button>
                          </div>
                        </div>

                        <div className="commit-graph__badges">
                          {entry.branch && (
                            <span className="commit-graph__branch-badge">
                              {entry.branch}
                            </span>
                          )}
                          {entry.tags.map((tag) => (
                            <span key={tag} className="commit-graph__tag-badge">
                              {tag}
                            </span>
                          ))}
                          {entry.pullRequest && (
                            <a
                              href={entry.pullRequest.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="commit-graph__pr-badge"
                              onClick={(event) => event.stopPropagation()}
                            >
                              #{entry.pullRequest.number}
                            </a>
                          )}
                        </div>

                        {entry.parents.length > 0 && (
                          <div className="commit-graph__parents">
                            <span className="commit-graph__parents-label">
                              Parent{entry.parents.length !== 1 ? "s" : ""}
                            </span>
                            <div className="commit-graph__parents-list">
                              {entry.parents.map((parent) => (
                                <a
                                  key={parent}
                                  href={buildGitHubCommitUrl(loadedRepo, parent)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="commit-graph__parent-link"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {parent.slice(0, 7)}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {!isLoading && commits.length === 0 && !error && loadedRepo === "" && (
        <div className="commit-graph__empty">
          <div className="commit-graph__empty-icon">🧭</div>
          <h2>Enter a repository</h2>
          <p>
            Load up to {MAX_GRAPH_LIMIT} commits to render a repository DAG on a
            scrollable grid.
          </p>
        </div>
      )}
    </div>
  );
}
