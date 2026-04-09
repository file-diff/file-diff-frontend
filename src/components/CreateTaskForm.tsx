import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PULL_REQUEST_COMPLETION_MODE_VALUES,
  resolveRepositoryInput,
  requestRepositoryBranches,
  requestCreateTask,
} from "../utils/repositorySelection";
import { loadBearerToken, saveBearerToken } from "../utils/bearerTokenStorage";
import {
  loadCreateTaskDraft,
  saveCreateTaskDraft,
} from "../utils/createTaskStorage";
import type {
  RepositoryBranch,
  CreateTaskRequest,
  PullRequestCompletionMode,
} from "../utils/repositorySelection";
import RepositorySelector from "./RepositorySelector";
import "./CreateTaskForm.css";

const MODEL_OPTIONS = [
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { value: "claude-opus-4.6", label: "Claude Opus 4.6" },
];
const GITHUB_ACTIONS_RUN_URL_PATTERN =
  /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/[0-9]+/;
const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const TASK_ID_KEYS = new Set([
  "taskid",
  "runid",
  "workflowrunid",
  "jobid",
  "idtask",
  "idrun",
  "idworkflow",
  "idjob",
]);

export interface CreateTaskFormProps {
  initialRepo?: string;
  showRepositorySelector?: boolean;
}

const DEFAULT_CREATE_PULL_REQUEST = true;
const DEFAULT_PULL_REQUEST_COMPLETION_MODE: PullRequestCompletionMode = "None";
const DEFAULT_BRANCH_NAME = "main";
const PULL_REQUEST_COMPLETION_MODE_LABELS: Record<
  PullRequestCompletionMode,
  string
> = {
  None: "None",
  AutoReady: "Auto ready",
  AutoMerge: "Auto merge",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeDescriptionBlock(value: string): string {
  return value.trim().replace(/\r\n?/g, "\n");
}

function buildTaskDescription({
  repo,
  baseRef,
  problemStatement,
  optionalDescription,
}: {
  repo: string;
  baseRef: string;
  problemStatement: string;
  optionalDescription: string;
}): string {
  const normalizedRepo = normalizeWhitespace(repo);
  const normalizedBaseRef = normalizeWhitespace(baseRef);
  const normalizedProblemStatement = normalizeDescriptionBlock(problemStatement);
  const normalizedOptionalDescription = normalizeDescriptionBlock(optionalDescription);
  const sections = [
    `Repository: ${normalizedRepo}`,
    `Base branch: ${normalizedBaseRef}`,
  ];

  if (normalizedProblemStatement) {
    sections.push(`Problem statement:\n${normalizedProblemStatement}`);
  }

  if (normalizedOptionalDescription) {
    sections.push(`Additional context:\n${normalizedOptionalDescription}`);
  }

  return sections.join("\n\n");
}

function isTaskIdKey(key: string): boolean {
  const normalizedKey = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  const compactKey = normalizedKey.replace(/[^a-z0-9]+/g, "");
  return TASK_ID_KEYS.has(compactKey);
}

function getIdentifier(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return null;
}

function findGitHubActionsRunUrl(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(GITHUB_ACTIONS_RUN_URL_PATTERN);
    return match ? match[0] : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nestedMatch = findGitHubActionsRunUrl(item);
      if (nestedMatch) return nestedMatch;
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const nestedValue of Object.values(value)) {
    const nestedMatch = findGitHubActionsRunUrl(nestedValue);
    if (nestedMatch) return nestedMatch;
  }

  return null;
}

function findTaskId(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nestedTaskId = findTaskId(item);
      if (nestedTaskId) return nestedTaskId;
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const priorityKeys = [
    "task_id",
    "taskId",
    "run_id",
    "runId",
    "workflow_run_id",
    "workflowRunId",
    "job_id",
    "jobId",
  ];

  for (const key of priorityKeys) {
    const candidateId = getIdentifier(value[key]);
    if (candidateId) {
      return candidateId;
    }
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedId = getIdentifier(nestedValue);
    if (isTaskIdKey(key) && nestedId) {
      return nestedId;
    }
    const nestedTaskId = findTaskId(nestedValue);
    if (nestedTaskId) return nestedTaskId;
  }

  return null;
}

function getGitHubTaskInfo(
  repo: string,
  result: unknown
): { url: string | null; taskId: string | null } {
  const directUrl = findGitHubActionsRunUrl(result);
  if (directUrl) {
    const taskIdMatch = directUrl.match(/\/actions\/runs\/([0-9]+)/);
    return {
      url: directUrl,
      taskId: taskIdMatch ? taskIdMatch[1] : findTaskId(result),
    };
  }

  const taskId = findTaskId(result);
  if (!taskId || !REPO_PATTERN.test(repo)) {
    return { url: null, taskId };
  }

  return {
    url: `https://github.com/${repo}/actions/runs/${encodeURIComponent(taskId)}`,
    taskId,
  };
}

export default function CreateTaskForm({
  initialRepo = "",
  showRepositorySelector = true,
}: CreateTaskFormProps) {
  const [savedDraft] = useState(() => loadCreateTaskDraft());
  const initialRepoInput = showRepositorySelector
    ? initialRepo || savedDraft?.repoInput || ""
    : initialRepo;
  const [repoInput, setRepoInput] = useState(initialRepoInput);
  const [eventContent, setEventContent] = useState(savedDraft?.eventContent || "");
  const [problemStatement, setProblemStatement] = useState(
    savedDraft?.problemStatement || ""
  );
  const [model, setModel] = useState(savedDraft?.model || MODEL_OPTIONS[0].value);
  const [bearerToken, setBearerToken] = useState(loadBearerToken);
  const [createPullRequest, setCreatePullRequest] = useState(
    savedDraft?.createPullRequest ?? DEFAULT_CREATE_PULL_REQUEST
  );
  const [pullRequestCompletionMode, setPullRequestCompletionMode] =
    useState<PullRequestCompletionMode>(
      savedDraft?.createPullRequest === false
        ? DEFAULT_PULL_REQUEST_COMPLETION_MODE
        : savedDraft?.pullRequestCompletionMode ??
            DEFAULT_PULL_REQUEST_COMPLETION_MODE
    );
  const [baseRef, setBaseRef] = useState(savedDraft?.baseRef || DEFAULT_BRANCH_NAME);

  const [branches, setBranches] = useState<RepositoryBranch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState("");
  const [loadedBranchesRepo, setLoadedBranchesRepo] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitResult, setSubmitResult] = useState<unknown>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

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

      setBaseRef((currentBaseRef) => {
        if (currentBaseRef && result.some((b) => b.name === currentBaseRef)) {
          return currentBaseRef;
        }

        const defaultBranch = result.find((b) => b.isDefault);
        if (defaultBranch) {
          return defaultBranch.name;
        }
        if (result.some((b) => b.name === DEFAULT_BRANCH_NAME)) {
          return DEFAULT_BRANCH_NAME;
        }
        return result[0]?.name || "";
      });
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
    const repo = resolveRepositoryInput(repoInput);
    if (!repo) {
      setBranchesError("Please enter a repository in owner/repo format.");
      return;
    }
    void loadBranches(repo);
  }, [loadBranches, repoInput]);

  const handleBearerTokenChange = useCallback((value: string) => {
    setBearerToken(value);
    saveBearerToken(value);
  }, []);

  const handleCreatePullRequestChange = useCallback((checked: boolean) => {
    setCreatePullRequest(checked);
    if (!checked) {
      setPullRequestCompletionMode(DEFAULT_PULL_REQUEST_COMPLETION_MODE);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    const repo = resolveRepositoryInput(repoInput);
    if (!repo) {
      setSubmitError("Please enter a repository.");
      return;
    }
    if (!bearerToken.trim()) {
      setSubmitError("Please enter a bearer token.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");
    setSubmitResult(null);

    const trimmedProblemStatement = problemStatement.trim();
    const trimmedOptionalDescription = eventContent.trim();
    const effectivePullRequestCompletionMode = createPullRequest
      ? pullRequestCompletionMode
      : DEFAULT_PULL_REQUEST_COMPLETION_MODE;
    const request: CreateTaskRequest = {
      repo,
      event_content: buildTaskDescription({
        repo,
        baseRef: baseRef || "main",
        problemStatement: trimmedProblemStatement,
        optionalDescription: trimmedOptionalDescription,
      }),
      model,
      create_pull_request: createPullRequest,
      pull_request_completion_mode: effectivePullRequestCompletionMode,
      base_ref: baseRef || "main",
    };

    if (trimmedProblemStatement) {
      request.problem_statement = trimmedProblemStatement;
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
    repoInput,
    eventContent,
    bearerToken,
    model,
    createPullRequest,
    pullRequestCompletionMode,
    baseRef,
    problemStatement,
  ]);

  useEffect(() => {
    saveCreateTaskDraft({
      repoInput,
      eventContent,
      problemStatement,
      model,
      createPullRequest,
      pullRequestCompletionMode,
      baseRef,
    });
  }, [
    repoInput,
    eventContent,
    problemStatement,
    model,
    createPullRequest,
    pullRequestCompletionMode,
    baseRef,
  ]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!showRepositorySelector) {
      setRepoInput(initialRepo);
    }
  }, [initialRepo, showRepositorySelector]);

  const canSubmit =
    !isSubmitting &&
    repoInput.trim() !== "" &&
    bearerToken.trim() !== "";
  const resolvedRepo = useMemo(() => resolveRepositoryInput(repoInput), [repoInput]);
  const githubTaskInfo = useMemo(
    () =>
      submitResult !== null
        ? getGitHubTaskInfo(resolvedRepo, submitResult)
        : { url: null, taskId: null },
    [resolvedRepo, submitResult]
  );

  return (
    <div className="create-task-form">
      {showRepositorySelector && (
        <div className="create-task-form__field">
          <RepositorySelector
            inputId="create-task-repo"
            value={repoInput}
            onChange={setRepoInput}
            onSubmit={handleLoadBranches}
            buttonLabel="Load branches"
            loadingButtonLabel="Loading…"
            isLoading={branchesLoading}
            disabled={branchesLoading || !repoInput.trim()}
            className="create-task-form__repository-selector"
          />
          {branchesError && (
            <div className="create-task-form__field-error">{branchesError}</div>
          )}
        </div>
      )}

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
        <label htmlFor="create-task-event-content">
          Optional description <span className="create-task-form__optional">(optional)</span>
        </label>
        <textarea
          id="create-task-event-content"
          value={eventContent}
          onChange={(e) => setEventContent(e.target.value)}
          placeholder="Extra context to include in the generated task description…"
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
          onChange={(e) => handleBearerTokenChange(e.target.value)}
          placeholder="Authorization token"
          spellCheck={false}
        />
      </div>

      <div className="create-task-form__field create-task-form__checkbox-field">
        <label>
          <input
            type="checkbox"
            checked={createPullRequest}
            onChange={(e) => handleCreatePullRequestChange(e.target.checked)}
          />
          Create pull request
        </label>
      </div>

      <div className="create-task-form__field">
        <label htmlFor="create-task-pr-completion-mode">
          Pull request completion mode
        </label>
        <select
          id="create-task-pr-completion-mode"
          value={pullRequestCompletionMode}
          onChange={(e) =>
            setPullRequestCompletionMode(
              e.target.value as PullRequestCompletionMode
            )
          }
          disabled={!createPullRequest}
        >
          {PULL_REQUEST_COMPLETION_MODE_VALUES.map((mode) => (
            <option key={mode} value={mode}>
              {PULL_REQUEST_COMPLETION_MODE_LABELS[mode]}
            </option>
          ))}
        </select>
        <div className="create-task-form__field-hint">
          {createPullRequest
            ? "Choose what happens after a successful run."
            : 'Enable "Create pull request" to use AutoReady or AutoMerge.'}
        </div>
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
          {githubTaskInfo.url && (
            <div className="create-task-form__result-link-row">
              <a
                className="create-task-form__result-link"
                href={githubTaskInfo.url}
                target="_blank"
                rel="noreferrer"
              >
                Open task in GitHub
              </a>
              {githubTaskInfo.taskId && (
                <span className="create-task-form__result-link-hint">
                  Task ID: <code>{githubTaskInfo.taskId}</code>
                </span>
              )}
            </div>
          )}
          <pre className="create-task-form__result-json">
            {JSON.stringify(submitResult, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
