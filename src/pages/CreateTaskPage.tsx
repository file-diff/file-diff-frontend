import { useSearchParams } from "react-router-dom";
import CreateTaskForm from "../components/CreateTaskForm";
import "./CreateTaskPage.css";

interface CreateTaskPageProps {
  showRepositorySelector?: boolean;
}

export default function CreateTaskPage({
  showRepositorySelector = true,
}: CreateTaskPageProps) {
  const [searchParams] = useSearchParams();
  const queryRepo = searchParams.get("repo") ?? "";

  return (
    <div className="create-task-page">
      <div className="page-header">
        <h1>🤖 Create Agent Task</h1>
        <p className="page-subtitle">
          Create a new GitHub Copilot coding agent task for a repository.
        </p>
      </div>

      <CreateTaskForm
        initialRepo={queryRepo}
        showRepositorySelector={showRepositorySelector}
      />
    </div>
  );
}
