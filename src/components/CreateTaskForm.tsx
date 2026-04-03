import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseRepositoryLocation,
  requestRepositoryBranches,
  requestCreateTask,
} from "../utils/repositorySelection";
import type {
  RepositoryBranch,
  CreateTaskRequest,
} from "../utils/repositorySelection";
import "./CreateTaskForm.css";

const MODEL_OPTIONS = [
  { value: "gpt-4", label: "GPT-4" },
  { value: "claude-opus-4.6", label: "Claude Opus 4.6" },
];

export interface CreateTaskFormProps {
  initialRepo?: string;
}

export default function CreateTaskForm({ initialRepo = "" }: CreateTaskFormProps) {
  const [repoInput, setRepoInput] = useState(initialRepo);
  const [eventContent, setEventContent] = useState("");
  const [problemStatement, setProblemStatement] = useState("");
  const [model, setModel] = useState(MODEL_OPTIONS[0].value);
  const [bearerToken, setBearerToken] = useState("");
  const [createPullRequest, setCreatePullRequest] = useState(true);
  const [baseRef, setBaseRef] = useState("main");

  const [branches, setBranches] = useState<RepositoryBranch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState("");
  const [loadedBranchesRepo, setLoadedBranchesRepo] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitResult, setSubmitResult] = useState<unknown>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const resolveRepo = useCallback((input: string): string => {
    const trimmed = input.trim();
    if (!trimmed) return "";
    const parsed = parseRepositoryLocation(trimmed);
    if (parsed) return parsed.repo;
    if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(trimmed)) return trimmed;
    return trimmed;
  }, []);

  const loadBranches = useCallback(async (repo: string) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setBranchesLoading(true);
    setBranchesError("");
    setBranches([]);
    setLoadedBranchesRepo("");

    try {
      const result = await requestRepositoryBranches(repo, controller.signal);
      setBranches(result);
      setLoadedBranchesRepo(repo);

      const defaultBranch = result.find((b) => b.isDefault);
      if (defaultBranch) {
        setBaseRef(defaultBranch.name);
      } else if (result.some((b) => b.name === "main")) {
        setBaseRef("main");
      } else if (result.length > 0) {
        setBaseRef(result[0].name);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setBranchesError(
        err instanceof Error && err.message
          ? err.message
          : "Unable to load branches"
      );
    } finally {
      if (!controller.signal.aborted) {
        setBranchesLoading(false);
      }
    }
  }, []);

  const handleLoadBranches = useCallback(() => {
    const repo = resolveRepo(repoInput);
    if (!repo) {
      setBranchesError("Please enter a repository in owner/repo format.");
      return;
    }
    void loadBranches(repo);
  }, [loadBranches, repoInput, resolveRepo]);

  const handleSubmit = useCallback(async () => {
    const repo = resolveRepo(repoInput);
    if (!repo) {
      setSubmitError("Please enter a repository.");
      return;
    }
    if (!eventContent.trim()) {
      setSubmitError("Please enter a task description.");
      return;
    }
    if (!bearerToken.trim()) {
      setSubmitError("Please enter a bearer token.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");
    setSubmitResult(null);

    const request: CreateTaskRequest = {
      repo,
      event_content: eventContent.trim(),
      model,
      create_pull_request: createPullRequest,
      base_ref: baseRef || "main",
    };

    if (problemStatement.trim()) {
      request.problem_statement = problemStatement.trim();
    }

    try {
      const result = await requestCreateTask(request, bearerToken.trim());
      setSubmitResult(result);
    } catch (err) {
      setSubmitError(
        err instanceof Error && err.message
          ? err.message
          : "Unable to create task"
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    resolveRepo,
    repoInput,
    eventContent,
    bearerToken,
    model,
    createPullRequest,
    baseRef,
    problemStatement,
  ]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const canSubmit =
    !isSubmitting &&
    repoInput.trim() !== "" &&
    eventContent.trim() !== "" &&
    bearerToken.trim() !== "";

  return (
    <div className="create-task-form">
      <div className="create-task-form__field">
        <label htmlFor="create-task-repo">Repository</label>
        <div className="create-task-form__input-row">
          <input
            id="create-task-repo"
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLoadBranches();
            }}
            placeholder="owner/repo or paste full GitHub URL"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={handleLoadBranches}
            disabled={branchesLoading || !repoInput.trim()}
            className="create-task-form__secondary-btn"
          >
            {branchesLoading ? "Loading…" : "Load branches"}
          </button>
        </div>
        {branchesError && (
          <div className="create-task-form__field-error">{branchesError}</div>
        )}
      </div>

      <div className="create-task-form__field">
        <label htmlFor="create-task-branch">Target branch</label>
        {branches.length > 0 ? (
          <select
            id="create-task-branch"
            value={baseRef}
            onChange={(e) => setBaseRef(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b.ref} value={b.name}>
                {b.name}
                {b.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="create-task-branch"
            type="text"
            value={baseRef}
            onChange={(e) => setBaseRef(e.target.value)}
            placeholder="main"
            spellCheck={false}
          />
        )}
        {loadedBranchesRepo && (
          <div className="create-task-form__field-hint">
            {branches.length} branch{branches.length !== 1 ? "es" : ""} loaded
            from {loadedBranchesRepo}
          </div>
        )}
      </div>

      <div className="create-task-form__field">
        <label htmlFor="create-task-model">Model</label>
        <select
          id="create-task-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="create-task-form__field">
        <label htmlFor="create-task-event-content">Task description</label>
        <textarea
          id="create-task-event-content"
          value={eventContent}
          onChange={(e) => setEventContent(e.target.value)}
          placeholder="Describe what the agent should do…"
          rows={4}
          spellCheck={false}
        />
      </div>

      <div className="create-task-form__field">
        <label htmlFor="create-task-problem-statement">
          Problem statement <span className="create-task-form__optional">(optional)</span>
        </label>
        <textarea
          id="create-task-problem-statement"
          value={problemStatement}
          onChange={(e) => setProblemStatement(e.target.value)}
          placeholder="Additional prompting for the agent…"
          rows={3}
          spellCheck={false}
        />
      </div>

      <div className="create-task-form__field">
        <label htmlFor="create-task-token">Bearer token</label>
        <input
          id="create-task-token"
          type="password"
          value={bearerToken}
          onChange={(e) => setBearerToken(e.target.value)}
          placeholder="Authorization token"
          spellCheck={false}
        />
      </div>

      <div className="create-task-form__field create-task-form__checkbox-field">
        <label>
          <input
            type="checkbox"
            checked={createPullRequest}
            onChange={(e) => setCreatePullRequest(e.target.checked)}
          />
          Create pull request
        </label>
      </div>

      {submitError && (
        <div className="create-task-form__error">{submitError}</div>
      )}

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={!canSubmit}
        className="create-task-form__submit-btn"
      >
        {isSubmitting ? "Creating task…" : "Create task"}
      </button>

      {submitResult !== null && (
        <div className="create-task-form__result">
          <div className="create-task-form__result-header">Task created</div>
          <pre className="create-task-form__result-json">
            {JSON.stringify(submitResult, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
