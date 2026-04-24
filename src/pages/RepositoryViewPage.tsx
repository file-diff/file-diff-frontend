import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import RepositorySelector from "../components/RepositorySelector";
import RepositoryViewSettingsPopup from "../components/RepositoryViewSettingsPopup";
import { resolveRepositoryInput } from "../utils/repositorySelection";
import {
  readRecentRepositories,
  addRecentRepository,
  removeRecentRepository,
} from "../utils/recentRepositoriesStorage";
import {
  getRepositoryColor,
  getRepositoryColorMap,
} from "../utils/repositoryColors";
import { loadRepoProblemStatement } from "../utils/repoProblemStatementStorage";
import {
  loadRefreshIntervalMs,
  saveRefreshIntervalMs,
  type RefreshIntervalMs,
} from "../utils/repositoryViewStorage";
import {
  loadBearerToken,
  saveBearerToken,
} from "../utils/bearerTokenStorage";
import RepositoryBrowserPage from "./RepositoryBrowserPage";
import BranchesPage from "./BranchesPage";
import TagsPage from "./TagsPage";
import ActionsPage from "./ActionsPage";
import AgentTaskInfoPage from "./AgentTaskInfoPage";
import CreateTaskPage from "./CreateTaskPage";
import "./RepositoryViewPage.css";

const DEFAULT_ACCENT_COLOR = "#58a6ff";

function sortRepositoriesAlphabetically(repos: readonly string[]): string[] {
  return [...repos].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

function buildRepoHref(
  searchParams: URLSearchParams,
  repo: string
): string {
  const nextParams = new URLSearchParams(searchParams);
  nextParams.delete("leftCommit");
  nextParams.delete("rightCommit");
  nextParams.delete("lc");
  nextParams.delete("rc");
  nextParams.delete("taskId");
  nextParams.set("repo", repo);
  return `?${nextParams.toString()}`;
}

export default function RepositoryViewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const repo = searchParams.get("repo") ?? "";
  const [repoInput, setRepoInput] = useState(repo);
  const repoKey = useMemo(() => repo.trim() || "no-repo", [repo]);
  const [recentRepos, setRecentRepos] = useState<string[]>(
    readRecentRepositories
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState<RefreshIntervalMs>(
    loadRefreshIntervalMs
  );
  const [bearerToken, setBearerToken] = useState(loadBearerToken);

  const handleRefreshIntervalChange = useCallback((value: RefreshIntervalMs) => {
    setRefreshIntervalMs(value);
    saveRefreshIntervalMs(value);
  }, []);

  const handleBearerTokenChange = useCallback((value: string) => {
    setBearerToken(value);
    saveBearerToken(value);
  }, []);

  useEffect(() => {
    setRepoInput(repo);
  }, [repo]);

  useEffect(() => {
    const resolved = repo.trim();
    if (resolved) {
      setRecentRepos(addRecentRepository(resolved));
    }
  }, [repo]);

  const sortedRecentRepos = useMemo(
    () => sortRepositoriesAlphabetically(recentRepos),
    [recentRepos]
  );

  const reposByOrg = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const r of sortedRecentRepos) {
      const slashIndex = r.indexOf("/");
      const org = slashIndex === -1 ? "" : r.slice(0, slashIndex);
      const existing = groups.get(org);
      if (existing) {
        existing.push(r);
      } else {
        groups.set(org, [r]);
      }
    }
    return Array.from(groups.entries()).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [sortedRecentRepos]);

  const colorMap = useMemo(
    () => getRepositoryColorMap(sortedRecentRepos),
    [sortedRecentRepos]
  );

  const accentColor = useMemo(() => {
    const trimmed = repo.trim();
    if (!trimmed) {
      return DEFAULT_ACCENT_COLOR;
    }
    return colorMap[trimmed.toLowerCase()] ?? getRepositoryColor(trimmed);
  }, [repo, colorMap]);

  const initialProblemStatement = useMemo(() => {
    const trimmed = repo.trim();
    if (!trimmed) {
      return undefined;
    }
    return loadRepoProblemStatement(trimmed);
  }, [repo]);

  const handleLoadRepository = useCallback(() => {
    const resolvedRepo = resolveRepositoryInput(repoInput);
    const nextParams = new URLSearchParams(searchParams);

    nextParams.delete("leftCommit");
    nextParams.delete("rightCommit");
    nextParams.delete("lc");
    nextParams.delete("rc");
    nextParams.delete("taskId");

    if (resolvedRepo) {
      nextParams.set("repo", resolvedRepo);
    } else {
      nextParams.delete("repo");
    }

    setSearchParams(nextParams, { replace: true });
  }, [repoInput, searchParams, setSearchParams]);

  const handleSelectRecent = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>, selected: string) => {
      // Allow the browser to handle middle-click and modifier-click natively
      // (open in new tab / window) by not preventing default in those cases.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      event.preventDefault();
      const nextParams = new URLSearchParams(searchParams);

      nextParams.delete("leftCommit");
      nextParams.delete("rightCommit");
      nextParams.delete("lc");
      nextParams.delete("rc");
      nextParams.delete("taskId");

      nextParams.set("repo", selected);
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const handleRemoveRecent = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, toRemove: string) => {
      event.preventDefault();
      event.stopPropagation();
      setRecentRepos(removeRecentRepository(toRemove));
    },
    []
  );

  const accentStyle = useMemo(
    () => ({ ["--repo-accent" as string]: accentColor } as CSSProperties),
    [accentColor]
  );

  return (
    <div className="repository-view-page" style={accentStyle}>
      {sortedRecentRepos.length > 0 ? (
        <div
          className="repository-view-page__recent-grid"
          aria-label="Recent repositories"
        >
          {reposByOrg.map(([org, repos]) => (
            <div
              key={org || "__no_org__"}
              className="repository-view-page__recent-org"
            >
              {repos.map((r) => {
                const color =
                  colorMap[r.toLowerCase()] ?? DEFAULT_ACCENT_COLOR;
                const isActive = r === repo;
                return (
                  <a
                    key={r}
                    href={buildRepoHref(searchParams, r)}
                    onClick={(e) => handleSelectRecent(e, r)}
                    onAuxClick={(e) => {
                      // Middle-click: let the browser open the link in a new tab.
                      if (e.button === 1) {
                        e.stopPropagation();
                      }
                    }}
                    className={
                      "repository-view-page__recent-tile" +
                      (isActive
                        ? " repository-view-page__recent-tile--active"
                        : "")
                    }
                    style={
                      {
                        ["--repo-tile-color" as string]: color,
                      } as CSSProperties
                    }
                    title={`Switch to ${r} (Ctrl/⌘+click or middle-click to open in a new tab)`}
                  >
                    <span className="repository-view-page__recent-tile-name">
                      {r}
                    </span>
                    <button
                      type="button"
                      className="repository-view-page__recent-remove"
                      onClick={(e) => handleRemoveRecent(e, r)}
                      title={`Remove ${r} from recent list`}
                      aria-label={`Remove ${r}`}
                    >
                      ×
                    </button>
                  </a>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}

      <div className="repository-view-page__selector-row">
        <RepositorySelector
          inputId="repository-view-input"
          value={repoInput}
          onChange={setRepoInput}
          onSubmit={handleLoadRepository}
          buttonLabel="Load repository"
          disabled={!repoInput.trim()}
          className="repository-view-page__selector"
          actions={
            <>
              <button
                type="button"
                className="repository-view-page__refresh-btn"
                onClick={() => setRefreshNonce((n) => n + 1)}
                title="Refresh all panels now"
              >
                🔄 Refresh Now
              </button>
              <button
                type="button"
                className="repository-view-page__settings-btn"
                onClick={() => setSettingsOpen(true)}
                title="Settings"
              >
                ⚙️ Settings
              </button>
            </>
          }
        />
      </div>

      <div className="repository-view-page__columns">
        <div className="repository-view-page__column repository-view-page__column--side">
          <RepositoryBrowserPage
            key={`commits-${repoKey}-${String(refreshNonce)}`}
            showRepositorySelector={false}
            refreshIntervalMs={refreshIntervalMs}
          />
        </div>
        <div className="repository-view-page__column repository-view-page__column--center">
          <CreateTaskPage
            key={`create-task-${repoKey}-${String(refreshNonce)}`}
            showRepositorySelector={false}
            initialProblemStatement={initialProblemStatement}
          />
        </div>
        <div className="repository-view-page__column repository-view-page__column--side">
          <AgentTaskInfoPage
            key={`tasks-${repoKey}-${String(refreshNonce)}`}
            showRepositorySelector={false}
            refreshIntervalMs={refreshIntervalMs}
            bearerToken={bearerToken}
          />
          <BranchesPage
            key={`branches-${repoKey}-${String(refreshNonce)}`}
            showRepositorySelector={false}
            refreshIntervalMs={refreshIntervalMs}
            bearerToken={bearerToken}
          />
          <TagsPage
            key={`tags-${repoKey}-${String(refreshNonce)}`}
            showRepositorySelector={false}
            refreshIntervalMs={refreshIntervalMs}
            bearerToken={bearerToken}
          />
          <ActionsPage
            key={`actions-${repoKey}-${String(refreshNonce)}`}
            showRepositorySelector={false}
            refreshIntervalMs={refreshIntervalMs}
            bearerToken={bearerToken}
          />
        </div>
      </div>

      <RepositoryViewSettingsPopup
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        refreshIntervalMs={refreshIntervalMs}
        onRefreshIntervalChange={handleRefreshIntervalChange}
        bearerToken={bearerToken}
        onBearerTokenChange={handleBearerTokenChange}
      />
    </div>
  );
}
