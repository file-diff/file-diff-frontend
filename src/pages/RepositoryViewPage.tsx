import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import RepositoryBrowserPage from "./RepositoryBrowserPage";
import BranchesPage from "./BranchesPage";
import AgentTaskInfoPage from "./AgentTaskInfoPage";
import CreateTaskPage from "./CreateTaskPage";
import "./RepositoryViewPage.css";

export default function RepositoryViewPage() {
  const [searchParams] = useSearchParams();
  const repo = searchParams.get("repo") ?? "";
  const repoKey = useMemo(() => repo.trim() || "empty", [repo]);

  return (
    <div className="repository-view-page">
      <div className="page-header">
        <h1>🗂️ Repository View</h1>
        <p className="page-subtitle">
          Review commits, branches, agent tasks, and create a task for one
          repository in a single view.
        </p>
      </div>

      <div className="repository-view-page__columns">
        <div className="repository-view-page__column">
          <RepositoryBrowserPage key={`commits-${repoKey}`} />
        </div>
        <div className="repository-view-page__column">
          <BranchesPage key={`branches-${repoKey}`} />
        </div>
        <div className="repository-view-page__column">
          <AgentTaskInfoPage key={`tasks-${repoKey}`} />
        </div>
        <div className="repository-view-page__column repository-view-page__column--full">
          <CreateTaskPage key={`create-task-${repoKey}`} />
        </div>
      </div>
    </div>
  );
}
