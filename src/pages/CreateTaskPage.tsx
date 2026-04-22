import { useSearchParams } from "react-router-dom";
import CreateTaskForm from "../components/CreateTaskForm";
import "./CreateTaskPage.css";

interface CreateTaskPageProps {
  showRepositorySelector?: boolean;
  initialProblemStatement?: string;
}

function getInitialProblemStatement(
  searchParams: URLSearchParams
): string | undefined {
  const directProblemStatement =
    searchParams.get("problemStatement") ?? searchParams.get("problem_statement");
  if (directProblemStatement && directProblemStatement.trim()) {
    return directProblemStatement.trim();
  }

  const title = searchParams.get("title")?.trim() ?? "";
  const body = searchParams.get("body")?.trim() ?? "";

  const combined = [title, body].filter(Boolean).join("\n\n");
  return combined || undefined;
}

export default function CreateTaskPage({
  showRepositorySelector = true,
  initialProblemStatement,
}: CreateTaskPageProps) {
  const [searchParams] = useSearchParams();
  const queryRepo = searchParams.get("repo") ?? "";
  const queryProblemStatement = getInitialProblemStatement(searchParams);
  const effectiveInitialProblemStatement =
    queryProblemStatement !== undefined
      ? queryProblemStatement
      : initialProblemStatement;
  const formKey = [
    showRepositorySelector ? "show-repo" : "fixed-repo",
    queryRepo,
    effectiveInitialProblemStatement ?? "",
  ].join("::");

  return (
    <div className="create-task-page">
      <div className="page-header">
        <h1>🤖 Create Agent Task</h1>
        <p className="page-subtitle">
          Create a new GitHub Copilot coding agent task for a repository.
        </p>
      </div>

      <CreateTaskForm
        key={formKey}
        initialRepo={queryRepo}
        initialProblemStatement={effectiveInitialProblemStatement}
        showRepositorySelector={showRepositorySelector}
      />
    </div>
  );
}
