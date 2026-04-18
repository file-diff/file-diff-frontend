import { useSearchParams } from "react-router-dom";
import CreateTaskForm from "../components/CreateTaskForm";
import "./CreateTaskPage.css";

interface CreateTaskPageProps {
  showRepositorySelector?: boolean;
}

function getInitialProblemStatement(searchParams: URLSearchParams): string {
  const directProblemStatement =
    searchParams.get("problemStatement") ?? searchParams.get("problem_statement");
  if (directProblemStatement && directProblemStatement.trim()) {
    return directProblemStatement;
  }

  const title = searchParams.get("title")?.trim() ?? "";
  const body = searchParams.get("body")?.trim() ?? "";

  return [title, body].filter(Boolean).join("\n\n");
}

export default function CreateTaskPage({
  showRepositorySelector = true,
}: CreateTaskPageProps) {
  const [searchParams] = useSearchParams();
  const queryRepo = searchParams.get("repo") ?? "";
  const queryProblemStatement = getInitialProblemStatement(searchParams);

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
        initialProblemStatement={queryProblemStatement}
        showRepositorySelector={showRepositorySelector}
      />
    </div>
  );
}
