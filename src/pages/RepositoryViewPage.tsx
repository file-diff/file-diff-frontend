import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import RepositorySelector from "../components/RepositorySelector";
import { resolveRepositoryInput } from "../utils/repositorySelection";
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

  useEffect(() => {
    setRepoInput(repo);
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
