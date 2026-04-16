import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import RepositorySelector from "../components/RepositorySelector";
import { resolveRepositoryInput } from "../utils/repositorySelection";
import {
  readRecentRepositories,
  addRecentRepository,
  removeRecentRepository,
} from "../utils/recentRepositoriesStorage";
import RepositoryBrowserPage from "./RepositoryBrowserPage";
import BranchesPage from "./BranchesPage";
import AgentTaskInfoPage from "./AgentTaskInfoPage";
import CreateTaskPage from "./CreateTaskPage";
import "./RepositoryViewPage.css";

export default function RepositoryViewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const repo = searchParams.get("repo") ?? "";
  const [repoInput, setRepoInput] = useState(repo);
  const repoKey = useMemo(() => repo.trim() || "no-repo", [repo]);
  const [recentRepos, setRecentRepos] = useState<string[]>(
    readRecentRepositories
  );

  useEffect(() => {
    setRepoInput(repo);
  }, [repo]);

  useEffect(() => {
    const resolved = repo.trim();
    if (resolved) {
      setRecentRepos(addRecentRepository(resolved));
    }
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
    (selected: string) => {
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
    (toRemove: string) => {
      setRecentRepos(removeRecentRepository(toRemove));
    },
    []
  );

  return (
    <div className="repository-view-page">
      <div className="page-header">
        <h1>🗂️ Repository View</h1>
        <p className="page-subtitle">
          Review commits, branches, agent tasks, and create a task for one
          repository in a single view.
        </p>
      </div>

      <RepositorySelector
        inputId="repository-view-input"
        value={repoInput}
        onChange={setRepoInput}
        onSubmit={handleLoadRepository}
        buttonLabel="Load repository"
        disabled={!repoInput.trim()}
        className="repository-view-page__selector"
        footer={
          recentRepos.length > 0 ? (
            <div className="repository-view-page__recent">
              <span className="repository-view-page__recent-label">
                Recent:
              </span>
              {recentRepos.map((r) => (
                <span
                  key={r}
                  className={
                    "repository-view-page__recent-chip" +
                    (r === repo
                      ? " repository-view-page__recent-chip--active"
                      : "")
                  }
                >
                  <button
                    type="button"
                    className="repository-view-page__recent-name"
                    onClick={() => handleSelectRecent(r)}
                    title={`Switch to ${r}`}
                  >
                    {r}
                  </button>
                  <button
                    type="button"
                    className="repository-view-page__recent-remove"
                    onClick={() => handleRemoveRecent(r)}
                    title={`Remove ${r} from recent list`}
                    aria-label={`Remove ${r}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null
        }
      />

      <div className="repository-view-page__columns">
        <div className="repository-view-page__column repository-view-page__column--side">
          <RepositoryBrowserPage
            key={`commits-${repoKey}`}
            showRepositorySelector={false}
          />
        </div>
        <div className="repository-view-page__column repository-view-page__column--center">
          <CreateTaskPage
            key={`create-task-${repoKey}`}
            showRepositorySelector={false}
          />
        </div>
        <div className="repository-view-page__column repository-view-page__column--side">
          <BranchesPage
            key={`branches-${repoKey}`}
            showRepositorySelector={false}
          />
          <AgentTaskInfoPage
            key={`tasks-${repoKey}`}
            showRepositorySelector={false}
          />
        </div>
      </div>
    </div>
  );
}
