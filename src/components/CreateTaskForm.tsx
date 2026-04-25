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
  loadRepoCreateTaskDraft,
  saveCreateTaskDraft,
  saveRepoCreateTaskDraft,
} from "../utils/createTaskStorage";
import { saveRepoProblemStatement } from "../utils/repoProblemStatementStorage";
import type {
  RepositoryBranch,
  CreateTaskRequest,
  PullRequestCompletionMode,
} from "../utils/repositorySelection";
import RepositorySelector from "./RepositorySelector";
import CreateTaskConfirmPopup from "./CreateTaskConfirmPopup";
import "./CreateTaskForm.css";

const MODEL_OPTIONS = [
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { value: "claude-opus-4.7", label: "Claude Opus 4.7" },
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
  initialProblemStatement?: string;
  showRepositorySelector?: boolean;
}

const DEFAULT_CREATE_PULL_REQUEST = true;
const DEFAULT_PULL_REQUEST_COMPLETION_MODE: PullRequestCompletionMode = "None";
const DEFAULT_BRANCH_NAME = "main";
const MIN_TASK_DELAY_MINUTES = 1;
const TASK_DELAY_REQUIRED_ERROR = "Please enter how many minutes to delay the task.";
const TASK_DELAY_NUMBER_ERROR = "Task delay must be a valid number of minutes.";
const TASK_DELAY_INTEGER_ERROR = "Task delay must be a whole number of minutes.";
const TASK_DELAY_MINIMUM_ERROR = "Task delay must be at least 1 whole minute.";
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
}: {
  repo: string;
  baseRef: string;
  problemStatement: string;
}): string {
  const normalizedRepo = normalizeWhitespace(repo);
  const normalizedBaseRef = normalizeWhitespace(baseRef);
  const normalizedProblemStatement = normalizeDescriptionBlock(problemStatement);
  const sections = [
    `Repository: ${normalizedRepo}`,
    `Base branch: ${normalizedBaseRef}`,
  ];

  if (normalizedProblemStatement) {
    sections.push(`Problem statement:\n${normalizedProblemStatement}`);
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
  initialProblemStatement,
  showRepositorySelector = true,
}: CreateTaskFormProps) {
  const [savedDraft] = useState(() => loadCreateTaskDraft());
  const initialRepoInput = showRepositorySelector
    ? initialRepo || savedDraft?.repoInput || ""
    : initialRepo;
  const [initialRepoDraft] = useState(() =>
    loadRepoCreateTaskDraft(resolveRepositoryInput(initialRepoInput))
  );
  const effectiveInitialProblemStatement =
    initialProblemStatement !== undefined
      ? initialProblemStatement
      : initialRepoDraft?.problemStatement ?? savedDraft?.problemStatement ?? "";
  const [repoInput, setRepoInput] = useState(initialRepoInput);
  const [problemStatement, setProblemStatement] = useState(
    effectiveInitialProblemStatement
  );
  const [model, setModel] = useState(
    initialRepoDraft?.model ?? savedDraft?.model ?? MODEL_OPTIONS[0].value
  );
  const [bearerToken, setBearerToken] = useState(loadBearerToken);
  const [createPullRequest, setCreatePullRequest] = useState(
    initialRepoDraft?.createPullRequest ??
      savedDraft?.createPullRequest ??
      DEFAULT_CREATE_PULL_REQUEST
  );
  const [pullRequestCompletionMode, setPullRequestCompletionMode] =
    useState<PullRequestCompletionMode>(
      (initialRepoDraft?.createPullRequest ?? savedDraft?.createPullRequest) ===
      false
        ? DEFAULT_PULL_REQUEST_COMPLETION_MODE
        : initialRepoDraft?.pullRequestCompletionMode ??
            savedDraft?.pullRequestCompletionMode ??
            DEFAULT_PULL_REQUEST_COMPLETION_MODE
    );
  const [baseRef, setBaseRef] = useState(
    initialRepoDraft?.baseRef ?? savedDraft?.baseRef ?? DEFAULT_BRANCH_NAME
  );
  const [taskDelayEnabled, setTaskDelayEnabled] = useState(
    initialRepoDraft?.taskDelayEnabled ?? savedDraft?.taskDelayEnabled ?? false
  );
  const [taskDelayMinutes, setTaskDelayMinutes] = useState(
    initialRepoDraft?.taskDelayMinutes ?? savedDraft?.taskDelayMinutes ?? ""
  );

  const [branches, setBranches] = useState<RepositoryBranch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState("");
  const [loadedBranchesRepo, setLoadedBranchesRepo] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitResult, setSubmitResult] = useState<unknown>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  const handleTaskDelayChange = useCallback((checked: boolean) => {
    setTaskDelayEnabled(checked);
    if (!checked) {
      setTaskDelayMinutes("");
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

    const trimmedProblemStatement = problemStatement.trim();
    const effectivePullRequestCompletionMode = createPullRequest
      ? pullRequestCompletionMode
      : DEFAULT_PULL_REQUEST_COMPLETION_MODE;
    const trimmedTaskDelayMinutes = taskDelayMinutes.trim();

    let taskDelayMs: number | undefined;
    if (taskDelayEnabled) {
      if (!trimmedTaskDelayMinutes) {
        setSubmitError(TASK_DELAY_REQUIRED_ERROR);
        return;
      }

      const parsedTaskDelayMinutes = Number(trimmedTaskDelayMinutes);
      if (!Number.isFinite(parsedTaskDelayMinutes)) {
        setSubmitError(TASK_DELAY_NUMBER_ERROR);
        return;
      }

      if (parsedTaskDelayMinutes < MIN_TASK_DELAY_MINUTES) {
        setSubmitError(TASK_DELAY_MINIMUM_ERROR);
        return;
      }

      if (!Number.isInteger(parsedTaskDelayMinutes)) {
        setSubmitError(TASK_DELAY_INTEGER_ERROR);
        return;
      }

      taskDelayMs = parsedTaskDelayMinutes * 60 * 1000;
    }

    setIsSubmitting(true);
    setSubmitError("");
    setSubmitResult(null);

    const request: CreateTaskRequest = {
      repo,
      event_content: buildTaskDescription({
        repo,
        baseRef: baseRef || "main",
        problemStatement: trimmedProblemStatement,
      }),
      model,
      create_pull_request: createPullRequest,
      pull_request_completion_mode: effectivePullRequestCompletionMode,
      base_ref: baseRef || "main",
    };

    if (typeof taskDelayMs === "number") {
      request.task_delay_ms = taskDelayMs;
    }

    if (trimmedProblemStatement) {
      request.problem_statement = trimmedProblemStatement;
    }

    try {
      const result = await requestCreateTask(request, bearerToken.trim());
      setSubmitResult(result);
      setConfirmOpen(false);
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
    bearerToken,
    model,
    createPullRequest,
    pullRequestCompletionMode,
    baseRef,
    problemStatement,
    taskDelayEnabled,
    taskDelayMinutes,
  ]);

  useEffect(() => {
    saveCreateTaskDraft({
      repoInput,
      problemStatement,
      model,
      createPullRequest,
      pullRequestCompletionMode,
      baseRef,
      taskDelayEnabled,
      taskDelayMinutes,
    });
  }, [
    repoInput,
    problemStatement,
    model,
    createPullRequest,
    pullRequestCompletionMode,
    baseRef,
    taskDelayEnabled,
    taskDelayMinutes,
  ]);

  useEffect(() => {
    const repo = resolveRepositoryInput(repoInput);
    if (repo) {
      saveRepoProblemStatement(repo, problemStatement);
      saveRepoCreateTaskDraft(repo, {
        problemStatement,
        model,
        createPullRequest,
        pullRequestCompletionMode,
        baseRef,
        taskDelayEnabled,
        taskDelayMinutes,
      });
    }
  }, [
    repoInput,
    problemStatement,
    model,
    createPullRequest,
    pullRequestCompletionMode,
    baseRef,
    taskDelayEnabled,
    taskDelayMinutes,
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
  const isAutoMerge =
    createPullRequest && pullRequestCompletionMode === "AutoMerge";
  const variantLabel = useMemo(() => {
    if (taskDelayEnabled && isAutoMerge) return "delayed auto-merge";
    if (taskDelayEnabled) return "delayed";
    if (isAutoMerge) return "auto-merge";
    return "";
  }, [taskDelayEnabled, isAutoMerge]);
  const buttonLabel = useMemo(() => {
    if (isSubmitting) return "Creating task…";
    if (variantLabel) {
      return `Create ${variantLabel} task`;
    }
    return "Create task";
  }, [isSubmitting, variantLabel]);

  const handleAttemptSubmit = useCallback(() => {
    if (!canSubmit) return;
    setSubmitError("");
    setConfirmOpen(true);
  }, [canSubmit]);

  const handleCancelConfirm = useCallback(() => {
    if (isSubmitting) return;
    setConfirmOpen(false);
  }, [isSubmitting]);

  const isTaskDelayInvalid =
    taskDelayEnabled &&
    [
      TASK_DELAY_REQUIRED_ERROR,
      TASK_DELAY_NUMBER_ERROR,
      TASK_DELAY_INTEGER_ERROR,
      TASK_DELAY_MINIMUM_ERROR,
    ].includes(submitError);
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
        <label htmlFor="create-task-problem-statement">
          Problem statement <span className="create-task-form__optional">(optional)</span>
        </label>
        <textarea
          id="create-task-problem-statement"
          value={problemStatement}
          onChange={(e) => setProblemStatement(e.target.value)}
          placeholder="Additional prompting for the agent…"
          rows={12}
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

      <div className="create-task-form__field create-task-form__checkbox-field">
        <label>
          <input
            type="checkbox"
            checked={taskDelayEnabled}
            onChange={(e) => handleTaskDelayChange(e.target.checked)}
          />
          Delay task start
        </label>
      </div>

      <div className="create-task-form__field">
        <label htmlFor="create-task-delay-minutes">Delay in minutes</label>
        <input
          id="create-task-delay-minutes"
          type="number"
          min={MIN_TASK_DELAY_MINUTES}
          step={1}
          value={taskDelayMinutes}
          onChange={(e) => setTaskDelayMinutes(e.target.value)}
          placeholder="10"
          disabled={!taskDelayEnabled}
          inputMode="numeric"
          aria-required={taskDelayEnabled}
          aria-describedby="create-task-delay-minutes-hint"
          aria-invalid={isTaskDelayInvalid}
        />
        <div
          id="create-task-delay-minutes-hint"
          className="create-task-form__field-hint"
        >
          {taskDelayEnabled
            ? "The remote GitHub task will start after this delay."
            : 'Enable "Delay task start" to schedule the task for later.'}
        </div>
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
        onClick={handleAttemptSubmit}
        disabled={!canSubmit}
        className={`create-task-form__submit-btn${variantLabel ? " create-task-form__submit-btn--needs-confirm" : ""}`}
      >
        <span className="create-task-form__submit-btn-label">
          {buttonLabel}
        </span>
        {resolvedRepo && (
          <span className="create-task-form__submit-btn-repo">
            {resolvedRepo}
            {baseRef ? (
              <span className="create-task-form__submit-btn-branch">
                {" "}@ {baseRef}
              </span>
            ) : null}
          </span>
        )}
      </button>

      <CreateTaskConfirmPopup
        open={confirmOpen}
        variantLabel={variantLabel || "task"}
        repo={resolvedRepo}
        branch={baseRef}
        problemStatement={problemStatement}
        isSubmitting={isSubmitting}
        onConfirm={() => void handleSubmit()}
        onCancel={handleCancelConfirm}
      />

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
