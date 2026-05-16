import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCreateTaskJobUrl } from "../config/api";
import {
  PULL_REQUEST_COMPLETION_MODE_VALUES,
  REASONING_EFFORT_VALUES,
  REASONING_SUMMARY_VALUES,
  resolveRepositoryInput,
  requestRepositoryBranches,
  requestCreateTask,
  requestAgentTasks,
} from "../utils/repositorySelection";
import {
  buildCreateTaskRequestBase,
  buildCreateTaskRequestFields,
  CLAUDE_MODEL_VALUES,
  CODEX_MODEL_VALUES,
  DEFAULT_CODEX_REASONING_EFFORT,
  DEFAULT_CODEX_REASONING_SUMMARY,
  normalizeModelSelection,
  OPENCODE_MODEL_VALUES,
} from "../utils/createTaskSubmission";
import { getDefaultSystemPrompt } from "../utils/defaultSystemPrompts";
import { loadBearerToken, saveBearerToken } from "../utils/bearerTokenStorage";
import { requestPromptTitle } from "../utils/promptTitle";
import {
  loadCreateTaskDraft,
  loadRepoCreateTaskDraft,
  saveCreateTaskDraft,
  saveRepoCreateTaskDraft,
} from "../utils/createTaskStorage";
import {
  extractTaskSummaries,
  splitOwnerRepo,
  type TaskSummary,
} from "../utils/agentTasks";
import { saveRepoProblemStatement } from "../utils/repoProblemStatementStorage";
import {
  loadCachedBranches,
  loadCachedBranchesFetchedAt,
  saveCachedBranches,
} from "../utils/branchesPageStorage";
import type {
  CreateTaskRequest,
  CreateTaskResponse,
  CreateTaskRunner,
  PullRequestCompletionMode,
  ReasoningEffort,
  ReasoningSummary,
  RepositoryBranch,
} from "../utils/repositorySelection";
import RepositorySelector from "./RepositorySelector";
import CreateTaskConfirmPopup from "./CreateTaskConfirmPopup";
import BranchAutocomplete from "./BranchAutocomplete";
import "./CreateTaskForm.css";

const DEFAULT_BRANCH_NAME = "main";
const DEFAULT_PULL_REQUEST_COMPLETION_MODE: PullRequestCompletionMode = "None";
const DEFAULT_TASK: CreateTaskRunner = "codex";
const BRANCH_TITLE_PREFIX = "fd-agent/";
const BASE_REF_REQUIRED_ERROR = "Please enter a target branch.";
const BASE_REF_UNVERIFIED_ERROR =
  "Download branches to verify the target branch exists.";
const BASE_REF_NOT_FOUND_ERROR = "Target branch does not exist.";
const BRANCH_TITLE_REQUIRED_ERROR = "Please fill in a branch title.";
const AGENT_ID_INTEGER_ERROR = "Agent ID must be a whole number.";
const PROBLEM_STATEMENT_REQUIRED_ERROR = "Please enter a problem statement.";
const TASK_DELAY_REQUIRED_ERROR = "Please enter how many minutes to delay the task.";
const TASK_DELAY_NUMBER_ERROR = "Task delay must be a valid number of minutes.";
const TASK_DELAY_INTEGER_ERROR = "Task delay must be a whole number of minutes.";
const TASK_DELAY_MINIMUM_ERROR = "Task delay must be at least 1 whole minute.";
const MIN_TASK_DELAY_MINUTES = 1;
const EXISTING_SESSION_REQUIRED_ERROR =
  "Select an existing agent session to continue.";

type SessionMode = "new" | "continue";

function normalizeTaskSelection(value: CreateTaskRunner | undefined): CreateTaskRunner {
  if (value === "claude" || value === "opencode") {
    return value;
  }

  return DEFAULT_TASK;
}

function isContinuableTask(task: TaskSummary): boolean {
  if (!task.pullRequestNumber && !task.pullRequestUrl) {
    return false;
  }

  const status = task.status.toLowerCase();
  return status !== "cancelled" && status !== "canceled" && status !== "deleted";
}

function formatTaskSessionLabel(task: TaskSummary): string {
  const prLabel = task.pullRequestNumber
    ? `PR #${String(task.pullRequestNumber)}`
    : "PR";
  const branchLabel = task.branch ? ` · ${task.branch}` : "";
  const statusLabel = task.status ? ` · ${task.status}` : "";

  return `${prLabel}${branchLabel}${statusLabel} · ${task.id}`;
}

function prefixGeneratedBranchTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) {
    return "";
  }

  const withoutPrefix = trimmed.startsWith(BRANCH_TITLE_PREFIX)
    ? trimmed.slice(BRANCH_TITLE_PREFIX.length)
    : trimmed;

  return `${BRANCH_TITLE_PREFIX}${withoutPrefix}`;
}

function getCreatedTaskInfo(
  result: CreateTaskResponse | null
): { jobId: string; statusUrl: string } | null {
  const jobId = result?.id?.trim();
  if (!jobId) {
    return null;
  }

  return {
    jobId,
    statusUrl: buildCreateTaskJobUrl(jobId),
  };
}

function getDefaultSystemPromptLabel(task: CreateTaskRunner): string {
  if (task === "opencode") {
    return "(using default OpenCode prompt, change if needed)";
  }

  return "(using default Codex prompt, change if needed)";
}

export interface CreateTaskFormProps {
  initialRepo?: string;
  initialProblemStatement?: string;
  showRepositorySelector?: boolean;
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
  const initialResolvedRepo = initialRepoInput.trim()
    ? resolveRepositoryInput(initialRepoInput)
    : "";
  const [initialRepoDraft] = useState(() =>
    initialResolvedRepo ? loadRepoCreateTaskDraft(initialResolvedRepo) : null
  );
  const effectiveInitialProblemStatement =
    initialProblemStatement !== undefined
      ? initialProblemStatement
      : initialRepoDraft?.problemStatement ?? savedDraft?.problemStatement ?? "";
  const initialTask = normalizeTaskSelection(
    initialRepoDraft?.task ?? savedDraft?.task
  );
  const initialStoredSystemPrompt =
    initialRepoDraft?.systemPrompt ?? savedDraft?.systemPrompt;
  const initialDefaultSystemPrompt = getDefaultSystemPrompt(initialTask);

  const [repoInput, setRepoInput] = useState(initialRepoInput);
  const [problemStatement, setProblemStatement] = useState(
    effectiveInitialProblemStatement
  );
  const [systemPrompt, setSystemPrompt] = useState(
    initialStoredSystemPrompt ?? initialDefaultSystemPrompt
  );
  const [systemPromptWasEdited, setSystemPromptWasEdited] = useState(
    initialStoredSystemPrompt !== undefined &&
      initialStoredSystemPrompt !== initialDefaultSystemPrompt
  );
  const [task, setTask] = useState<CreateTaskRunner>(initialTask);
  const [model, setModel] = useState(
    normalizeModelSelection(
      initialTask,
      initialRepoDraft?.model ?? savedDraft?.model
    )
  );
  const [agentId, setAgentId] = useState(
    initialRepoDraft?.agentId ?? savedDraft?.agentId ?? ""
  );
  const [customAgent, setCustomAgent] = useState(
    initialRepoDraft?.customAgent ?? savedDraft?.customAgent ?? ""
  );
  const [bearerToken, setBearerToken] = useState(loadBearerToken);
  const [baseRef, setBaseRef] = useState(
    initialRepoDraft?.baseRef ?? savedDraft?.baseRef ?? DEFAULT_BRANCH_NAME
  );
  const [pullRequestCompletionMode, setPullRequestCompletionMode] =
    useState<PullRequestCompletionMode>(
      initialRepoDraft?.pullRequestCompletionMode ??
        savedDraft?.pullRequestCompletionMode ??
        DEFAULT_PULL_REQUEST_COMPLETION_MODE
    );
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | "">(
    initialRepoDraft?.reasoningEffort ??
      savedDraft?.reasoningEffort ??
      (initialTask === "codex" ? DEFAULT_CODEX_REASONING_EFFORT : "")
  );
  const [reasoningSummary, setReasoningSummary] = useState<
    ReasoningSummary | ""
  >(
    initialRepoDraft?.reasoningSummary ??
      savedDraft?.reasoningSummary ??
      (initialTask === "codex" ? DEFAULT_CODEX_REASONING_SUMMARY : "")
  );
  const [taskDelayEnabled, setTaskDelayEnabled] = useState(
    initialRepoDraft?.taskDelayEnabled ?? savedDraft?.taskDelayEnabled ?? false
  );
  const [taskDelayMinutes, setTaskDelayMinutes] = useState(
    initialRepoDraft?.taskDelayMinutes ?? savedDraft?.taskDelayMinutes ?? ""
  );
  const [branchTitle, setBranchTitle] = useState(
    initialRepoDraft?.branchTitle ?? savedDraft?.branchTitle ?? ""
  );
  const [branchTitleGeneratedFrom, setBranchTitleGeneratedFrom] = useState("");
  const [isGeneratingBranchTitle, setIsGeneratingBranchTitle] = useState(false);
  const [branchTitleGenerationError, setBranchTitleGenerationError] = useState("");
  const [sessionMode, setSessionMode] = useState<SessionMode>("new");
  const [existingTasks, setExistingTasks] = useState<TaskSummary[]>([]);
  const [selectedExistingTaskId, setSelectedExistingTaskId] = useState("");
  const [existingTasksLoading, setExistingTasksLoading] = useState(false);
  const [existingTasksError, setExistingTasksError] = useState("");
  const [loadedExistingTasksRepo, setLoadedExistingTasksRepo] = useState("");

  const [branches, setBranches] = useState<RepositoryBranch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState("");
  const [loadedBranchesRepo, setLoadedBranchesRepo] = useState("");
  const [branchesFetchedAt, setBranchesFetchedAt] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitResult, setSubmitResult] = useState<CreateTaskResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const agentTasksAbortControllerRef = useRef<AbortController | null>(null);
  const promptTitleAbortControllerRef = useRef<AbortController | null>(null);

  const loadBranches = useCallback(async (repo: string) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setBranchesLoading(true);
    setBranchesError("");

    try {
      const result = await requestRepositoryBranches(repo, controller.signal);
      setBranches(result);
      setLoadedBranchesRepo(repo);
      saveCachedBranches(repo, result);
      setBranchesFetchedAt(loadCachedBranchesFetchedAt(repo));

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

  const loadExistingTasks = useCallback(async () => {
    const repo = resolveRepositoryInput(repoInput);
    if (!repo) {
      setExistingTasksError("Please enter a repository in owner/repo format.");
      return;
    }

    const ownerRepo = splitOwnerRepo(repo);
    if (!ownerRepo) {
      setExistingTasksError("Please enter a repository in owner/repo format.");
      return;
    }

    const token = bearerToken.trim();
    if (!token) {
      setExistingTasksError("Please enter a bearer token.");
      return;
    }

    agentTasksAbortControllerRef.current?.abort();
    const controller = new AbortController();
    agentTasksAbortControllerRef.current = controller;

    setExistingTasksLoading(true);
    setExistingTasksError("");

    try {
      const result = await requestAgentTasks(
        ownerRepo.owner,
        ownerRepo.name,
        token,
        controller.signal
      );
      if (controller.signal.aborted) {
        return;
      }

      const nextTasks = extractTaskSummaries(result).filter(isContinuableTask);
      setExistingTasks(nextTasks);
      setLoadedExistingTasksRepo(repo);
      setSelectedExistingTaskId((currentTaskId) =>
        nextTasks.some((agentTask) => agentTask.id === currentTaskId)
          ? currentTaskId
          : nextTasks[0]?.id ?? ""
      );
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }

      setExistingTasksError(
        err instanceof Error && err.message
          ? err.message
          : "Unable to load existing agent sessions"
      );
    } finally {
      if (!controller.signal.aborted) {
        setExistingTasksLoading(false);
      }
    }
  }, [bearerToken, repoInput]);

  const handleBearerTokenChange = useCallback((value: string) => {
    setBearerToken(value);
    saveBearerToken(value);
  }, []);

  const handleTaskChange = useCallback((value: CreateTaskRunner) => {
    const previousDefaultSystemPrompt = getDefaultSystemPrompt(task);
    const nextDefaultSystemPrompt = getDefaultSystemPrompt(value);

    setTask(value);
    setModel((currentModel) => normalizeModelSelection(value, currentModel));
    setSystemPrompt((currentSystemPrompt) =>
      !systemPromptWasEdited &&
      currentSystemPrompt === previousDefaultSystemPrompt
        ? nextDefaultSystemPrompt
        : currentSystemPrompt
    );
    if (value === "codex") {
      setReasoningEffort((currentReasoningEffort) =>
        currentReasoningEffort || DEFAULT_CODEX_REASONING_EFFORT
      );
      setReasoningSummary((currentReasoningSummary) =>
        currentReasoningSummary || DEFAULT_CODEX_REASONING_SUMMARY
      );
    }
  }, [systemPromptWasEdited, task]);

  const handleResetSystemPrompt = useCallback(() => {
    setSystemPrompt(getDefaultSystemPrompt(task));
    setSystemPromptWasEdited(false);
  }, [task]);

  const handleTaskDelayChange = useCallback((checked: boolean) => {
    setTaskDelayEnabled(checked);
    if (!checked) {
      setTaskDelayMinutes("");
    }
  }, []);

  const handleGenerateBranchTitle = useCallback(async () => {
    const trimmedProblemStatement = problemStatement.trim();
    if (!trimmedProblemStatement) {
      setBranchTitleGenerationError(PROBLEM_STATEMENT_REQUIRED_ERROR);
      return;
    }

    promptTitleAbortControllerRef.current?.abort();
    const controller = new AbortController();
    promptTitleAbortControllerRef.current = controller;

    setIsGeneratingBranchTitle(true);
    setBranchTitleGenerationError("");

    try {
      const result = await requestPromptTitle(
        trimmedProblemStatement,
        controller.signal
      );
      if (controller.signal.aborted) {
        return;
      }

      setBranchTitle(prefixGeneratedBranchTitle(result.title));
      setBranchTitleGeneratedFrom(trimmedProblemStatement);
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }

      setBranchTitleGenerationError(
        err instanceof Error && err.message
          ? err.message
          : "Unable to generate branch title"
      );
    } finally {
      if (!controller.signal.aborted) {
        setIsGeneratingBranchTitle(false);
      }
    }
  }, [problemStatement]);

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

    const validatedProblemStatement = problemStatement.trim();
    if (!validatedProblemStatement) {
      setSubmitError(PROBLEM_STATEMENT_REQUIRED_ERROR);
      return;
    }

    const validatedExistingTaskId = selectedExistingTaskId.trim();
    const isContinuingExistingSession = sessionMode === "continue";
    if (isContinuingExistingSession && !validatedExistingTaskId) {
      setSubmitError(EXISTING_SESSION_REQUIRED_ERROR);
      return;
    }

    const validatedBaseRef = baseRef.trim();
    if (!isContinuingExistingSession && !validatedBaseRef) {
      setSubmitError(BASE_REF_REQUIRED_ERROR);
      return;
    }

    const validatedBranchTitle = branchTitle.trim();
    if (!isContinuingExistingSession && !validatedBranchTitle) {
      setSubmitError(BRANCH_TITLE_REQUIRED_ERROR);
      return;
    }

    const validatedAgentId = agentId.trim();
    let parsedAgentId: number | undefined;
    if (validatedAgentId) {
      parsedAgentId = Number(validatedAgentId);
      if (!Number.isInteger(parsedAgentId)) {
        setSubmitError(AGENT_ID_INTEGER_ERROR);
        return;
      }
    }

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

    const request: CreateTaskRequest = buildCreateTaskRequestBase({
      repo,
      baseRef: validatedBaseRef,
      branchTitle: validatedBranchTitle,
      previousSessionId: isContinuingExistingSession
        ? validatedExistingTaskId
        : undefined,
      problemStatement: validatedProblemStatement,
      task,
      pullRequestCompletionMode,
    });

    Object.assign(
      request,
      buildCreateTaskRequestFields({
        agentId: parsedAgentId,
        customAgent,
        model,
        reasoningEffort,
        reasoningSummary,
        systemPrompt,
        task,
        taskDelayMs,
      })
    );

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
    problemStatement,
    systemPrompt,
    baseRef,
    task,
    model,
    customAgent,
    agentId,
    taskDelayEnabled,
    taskDelayMinutes,
    pullRequestCompletionMode,
    branchTitle,
    selectedExistingTaskId,
    sessionMode,
    reasoningEffort,
    reasoningSummary,
  ]);

  useEffect(() => {
    saveCreateTaskDraft({
      repoInput,
      problemStatement,
      systemPrompt,
      task,
      model,
      agentId,
      customAgent,
      branchTitle,
      baseRef,
      pullRequestCompletionMode,
      reasoningEffort,
      reasoningSummary,
      taskDelayEnabled,
      taskDelayMinutes,
    });
  }, [
    repoInput,
    problemStatement,
    systemPrompt,
    task,
    model,
    agentId,
    customAgent,
    branchTitle,
    baseRef,
    pullRequestCompletionMode,
    reasoningEffort,
    reasoningSummary,
    taskDelayEnabled,
    taskDelayMinutes,
  ]);

  useEffect(() => {
    const repo = resolveRepositoryInput(repoInput);
    if (repo) {
      saveRepoProblemStatement(repo, problemStatement);
      saveRepoCreateTaskDraft(repo, {
        problemStatement,
        systemPrompt,
        task,
        model,
        agentId,
        customAgent,
        branchTitle,
        baseRef,
        pullRequestCompletionMode,
        reasoningEffort,
        reasoningSummary,
        taskDelayEnabled,
        taskDelayMinutes,
      });
    }
  }, [
    repoInput,
    problemStatement,
    systemPrompt,
    task,
    model,
    agentId,
    customAgent,
    branchTitle,
    baseRef,
    pullRequestCompletionMode,
    reasoningEffort,
    reasoningSummary,
    taskDelayEnabled,
    taskDelayMinutes,
  ]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      agentTasksAbortControllerRef.current?.abort();
      promptTitleAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!showRepositorySelector) {
      setRepoInput(initialRepo);
    }
  }, [initialRepo, showRepositorySelector]);

  useEffect(() => {
    const repo = resolveRepositoryInput(repoInput);
    if (!repo) {
      setExistingTasks([]);
      setSelectedExistingTaskId("");
      setLoadedExistingTasksRepo("");
      setExistingTasksError("");
      return;
    }

    if (loadedExistingTasksRepo && repo !== loadedExistingTasksRepo) {
      setExistingTasks([]);
      setSelectedExistingTaskId("");
      setLoadedExistingTasksRepo("");
      setExistingTasksError("");
    }
  }, [repoInput, loadedExistingTasksRepo]);

  useEffect(() => {
    const repo = resolveRepositoryInput(repoInput);
    if (!repo) {
      setBranches([]);
      setLoadedBranchesRepo("");
      setBranchesFetchedAt("");
      return;
    }
    if (repo === loadedBranchesRepo) {
      return;
    }
    const cached = loadCachedBranches(repo);
    if (cached.length > 0) {
      setBranches(cached);
      setLoadedBranchesRepo(repo);
      setBranchesFetchedAt(loadCachedBranchesFetchedAt(repo));
      setBranchesError("");
    } else {
      setBranches([]);
      setLoadedBranchesRepo("");
      setBranchesFetchedAt("");
    }
  }, [repoInput, loadedBranchesRepo]);

  const resolvedRepo = useMemo(() => resolveRepositoryInput(repoInput), [repoInput]);
  const validatedBaseRef = baseRef.trim();
  const validatedBranchTitle = branchTitle.trim();
  const isContinuingExistingSession = sessionMode === "continue";
  const selectedExistingTask = useMemo(
    () => existingTasks.find((agentTask) => agentTask.id === selectedExistingTaskId),
    [existingTasks, selectedExistingTaskId]
  );
  const isBranchListCurrent =
    resolvedRepo !== "" && loadedBranchesRepo === resolvedRepo;
  const targetBranchExists =
    isBranchListCurrent &&
    branches.some((branch) => branch.name === validatedBaseRef);
  const branchTitleValidationError =
    !isContinuingExistingSession && validatedBranchTitle === ""
      ? BRANCH_TITLE_REQUIRED_ERROR
      : "";
  const targetBranchValidationError = useMemo(() => {
    if (isContinuingExistingSession) {
      return "";
    }

    if (validatedBaseRef === "") {
      return BASE_REF_REQUIRED_ERROR;
    }

    if (!resolvedRepo) {
      return "";
    }

    if (!isBranchListCurrent) {
      return BASE_REF_UNVERIFIED_ERROR;
    }

    if (!targetBranchExists) {
      return BASE_REF_NOT_FOUND_ERROR;
    }

    return "";
  }, [
    isBranchListCurrent,
    isContinuingExistingSession,
    resolvedRepo,
    targetBranchExists,
    validatedBaseRef,
  ]);
  const existingSessionValidationError =
    isContinuingExistingSession && !selectedExistingTaskId
      ? EXISTING_SESSION_REQUIRED_ERROR
      : "";
  const branchTitleFieldError = isContinuingExistingSession
    ? ""
    : branchTitleGenerationError || branchTitleValidationError;
  const canSubmit =
    !isSubmitting &&
    (!branchesLoading || isContinuingExistingSession) &&
    !existingTasksLoading &&
    resolvedRepo !== "" &&
    problemStatement.trim() !== "" &&
    branchTitleValidationError === "" &&
    targetBranchValidationError === "" &&
    existingSessionValidationError === "" &&
    bearerToken.trim() !== "";
  const variantLabel = useMemo(() => {
    const labels: string[] = [task];
    if (taskDelayEnabled) {
      labels.push("delayed");
    }
    return labels.join(" ");
  }, [task, taskDelayEnabled]);
  const buttonLabel = useMemo(() => {
    if (isSubmitting) return "Creating task...";
    if (isContinuingExistingSession) return `Continue ${variantLabel} session`;
    return `Create ${variantLabel} task`;
  }, [isContinuingExistingSession, isSubmitting, variantLabel]);

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
  const createdTaskInfo = useMemo(
    () => getCreatedTaskInfo(submitResult),
    [submitResult]
  );
  const isGeneratedBranchTitleStale = useMemo(() => {
    if (!branchTitleGeneratedFrom) {
      return false;
    }

    return branchTitleGeneratedFrom !== problemStatement.trim();
  }, [branchTitleGeneratedFrom, problemStatement]);
  const defaultSystemPrompt = useMemo(() => getDefaultSystemPrompt(task), [task]);
  const isUsingDefaultSystemPrompt = systemPrompt === defaultSystemPrompt;
  const systemPromptStatusLabel = isUsingDefaultSystemPrompt
    ? getDefaultSystemPromptLabel(task)
    : "(warning, using custom prompt)";

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
            loadingButtonLabel="Loading..."
            isLoading={branchesLoading}
            disabled={branchesLoading || !repoInput.trim()}
            className="create-task-form__repository-selector"
          />
        </div>
      )}

      <div className="create-task-form__field">
        <label>Agent session</label>
        <div className="create-task-form__radio-group">
          <label>
            <input
              type="radio"
              name="create-task-session-mode"
              value="new"
              checked={sessionMode === "new"}
              onChange={() => setSessionMode("new")}
            />
            Start a new session
          </label>
          <label>
            <input
              type="radio"
              name="create-task-session-mode"
              value="continue"
              checked={sessionMode === "continue"}
              onChange={() => setSessionMode("continue")}
            />
            Continue existing session
          </label>
        </div>

        {isContinuingExistingSession && (
          <div className="create-task-form__existing-session">
            <div className="create-task-form__input-row">
              <select
                id="create-task-existing-session"
                value={selectedExistingTaskId}
                onChange={(e) => setSelectedExistingTaskId(e.target.value)}
                disabled={existingTasksLoading || existingTasks.length === 0}
                aria-invalid={existingSessionValidationError !== ""}
              >
                <option value="">
                  {existingTasksLoading
                    ? "Loading existing sessions..."
                    : "Select an existing session"}
                </option>
                {existingTasks.map((agentTask) => (
                  <option key={agentTask.id} value={agentTask.id}>
                    {formatTaskSessionLabel(agentTask)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="create-task-form__secondary-btn"
                onClick={() => void loadExistingTasks()}
                disabled={existingTasksLoading || !repoInput.trim() || !bearerToken.trim()}
              >
                {existingTasksLoading ? "Loading..." : "Load sessions"}
              </button>
            </div>
            {existingTasksError && (
              <div className="create-task-form__field-error">
                {existingTasksError}
              </div>
            )}
            {!existingTasksError && existingSessionValidationError && (
              <div className="create-task-form__field-error">
                {existingSessionValidationError}
              </div>
            )}
            {!existingTasksError && loadedExistingTasksRepo && (
              <div className="create-task-form__field-hint">
                {existingTasks.length} existing session
                {existingTasks.length !== 1 ? "s" : ""} with pull requests for{" "}
                {loadedExistingTasksRepo}.
              </div>
            )}
            {selectedExistingTask && (
              <div className="create-task-form__warning">
                Continuing {selectedExistingTask.pullRequestNumber
                  ? `PR #${String(selectedExistingTask.pullRequestNumber)}`
                  : "the selected pull request"}
                . Branch title and target branch are ignored because the
                existing pull request branch and target branch will be reused.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="create-task-form__field">
        <label htmlFor="create-task-runner">Task runner</label>
        <select
          id="create-task-runner"
          value={task}
          onChange={(e) => handleTaskChange(e.target.value as CreateTaskRunner)}
        >
          <option value="codex">codex</option>
          <option value="claude">claude</option>
          <option value="opencode">opencode</option>
        </select>
      </div>

      <div className="create-task-form__field">
        <label htmlFor="create-task-model">Model</label>
        {task === "claude" ? (
          <select
            id="create-task-model"
            value={normalizeModelSelection(task, model)}
            onChange={(e) => setModel(e.target.value)}
          >
            {CLAUDE_MODEL_VALUES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        ) : task === "opencode" ? (
          <select
            id="create-task-model"
            value={normalizeModelSelection(task, model)}
            onChange={(e) => setModel(e.target.value)}
          >
            {OPENCODE_MODEL_VALUES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        ) : (
          <select
            id="create-task-model"
            value={normalizeModelSelection(task, model)}
            onChange={(e) => setModel(e.target.value)}
          >
            {CODEX_MODEL_VALUES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="create-task-form__field">
        <label htmlFor="create-task-agent-id">
          Agent ID <span className="create-task-form__optional">(optional)</span>
        </label>
        <input
          id="create-task-agent-id"
          type="number"
          min={1}
          step={1}
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          placeholder="Defaults to coding agent"
          inputMode="numeric"
        />
      </div>

      <div className="create-task-form__field">
        <label htmlFor="create-task-custom-agent">
          Custom agent override{" "}
          <span className="create-task-form__optional">(optional)</span>
        </label>
        <input
          id="create-task-custom-agent"
          type="text"
          value={customAgent}
          onChange={(e) => setCustomAgent(e.target.value)}
          placeholder="Overrides the selected task runner"
          spellCheck={false}
        />
      </div>

      {task !== "claude" && (
        <div className="create-task-form__field">
          <div className="create-task-form__label-row">
            <label htmlFor="create-task-system-prompt">
              System prompt{" "}
              <span
                className={
                  isUsingDefaultSystemPrompt
                    ? "create-task-form__system-prompt-status"
                    : "create-task-form__system-prompt-status create-task-form__system-prompt-status--custom"
                }
              >
                {systemPromptStatusLabel}
              </span>
            </label>
            <button
              type="button"
              className="create-task-form__secondary-btn create-task-form__compact-btn"
              onClick={handleResetSystemPrompt}
            >
              Reset to default
            </button>
          </div>
          <textarea
            id="create-task-system-prompt"
            value={systemPrompt}
            onChange={(e) => {
              setSystemPrompt(e.target.value);
              setSystemPromptWasEdited(true);
            }}
            placeholder="Optional system prompt sent to the agent..."
            rows={4}
            spellCheck={false}
          />
        </div>
      )}

      <div className="create-task-form__field">
        <label htmlFor="create-task-problem-statement">Problem statement</label>
        <textarea
          id="create-task-problem-statement"
          value={problemStatement}
          onChange={(e) => setProblemStatement(e.target.value)}
          placeholder="Additional prompting for the agent..."
          rows={12}
          spellCheck={false}
          aria-required={true}
        />
      </div>

      <div className="create-task-form__field">
        <label htmlFor="create-task-generated-branch-title">
          Branch title
        </label>
        <div className="create-task-form__input-row">
          <input
            id="create-task-generated-branch-title"
            type="text"
            value={branchTitle}
            onChange={(e) => {
              setBranchTitle(e.target.value);
              setBranchTitleGeneratedFrom("");
              setBranchTitleGenerationError("");
            }}
            placeholder="fd-agent/my-branch-title"
            spellCheck={false}
            disabled={isContinuingExistingSession}
            aria-required={!isContinuingExistingSession}
          />
          <button
            type="button"
            className="create-task-form__secondary-btn"
            onClick={() => void handleGenerateBranchTitle()}
            disabled={
              isContinuingExistingSession ||
              isGeneratingBranchTitle ||
              !problemStatement.trim()
            }
          >
            {isGeneratingBranchTitle ? "Generating..." : "Generate title"}
          </button>
        </div>
        {branchTitleFieldError ? (
          <div className="create-task-form__field-error">
            {branchTitleFieldError}
          </div>
        ) : (
          <div className="create-task-form__field-hint">
            {isContinuingExistingSession
              ? "Ignored while continuing an existing session."
              : branchTitle
              ? branchTitleGeneratedFrom && isGeneratedBranchTitleStale
                ? "Generated from an older problem statement. Generate again to refresh it."
                : branchTitleGeneratedFrom
                ? "Generated from the current problem statement and will be included in task creation."
                : "This branch title will be included in task creation."
              : 'Required. Enter a lowercase hyphenated branch title prefixed with "fd-agent/", or generate one from the current problem statement.'}
          </div>
        )}
      </div>

      <div className="create-task-form__field">
        <label htmlFor="create-task-token">Bearer token</label>
        <input
          id="create-task-token"
          type="password"
          value={bearerToken}
          onChange={(e) => handleBearerTokenChange(e.target.value)}
          placeholder="Admin authorization token"
          spellCheck={false}
        />
      </div>

      <div className="create-task-form__field">
        <label htmlFor="create-task-branch">Target branch</label>
        <div className="create-task-form__input-row">
          <BranchAutocomplete
            inputId="create-task-branch"
            value={baseRef}
            onChange={setBaseRef}
            branches={branches}
            placeholder="main"
            disabled={isContinuingExistingSession}
          />
          <button
            type="button"
            className="create-task-form__secondary-btn"
            onClick={handleLoadBranches}
            disabled={
              isContinuingExistingSession || branchesLoading || !repoInput.trim()
            }
            title={
              loadedBranchesRepo
                ? `Refresh branches for ${loadedBranchesRepo}`
                : "Download branches from server"
            }
          >
            {branchesLoading ? "Downloading..." : "Download branches"}
          </button>
        </div>
        {!isContinuingExistingSession && branchesError && (
          <div className="create-task-form__field-error">{branchesError}</div>
        )}
        {!isContinuingExistingSession && !branchesError && loadedBranchesRepo && (
          <div className="create-task-form__field-hint">
            {branches.length} branch{branches.length !== 1 ? "es" : ""} cached
            for {loadedBranchesRepo}
            {branchesFetchedAt
              ? ` · updated ${new Date(branchesFetchedAt).toLocaleString()}`
              : ""}
          </div>
        )}
        {(isContinuingExistingSession || (!branchesError && !loadedBranchesRepo)) && (
          <div className="create-task-form__field-hint">
            {isContinuingExistingSession
              ? "Ignored while continuing an existing session."
              : "Type a branch name, or click Download branches to load suggestions from the server."}
          </div>
        )}
        {!branchesError && targetBranchValidationError && (
          <div className="create-task-form__field-error">
            {targetBranchValidationError}
          </div>
        )}
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
        >
          {PULL_REQUEST_COMPLETION_MODE_VALUES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <div className="create-task-form__field-hint">
          Draft pull requests are always created for agent tasks.
        </div>
      </div>

      {task === "codex" && (
        <>
          <div className="create-task-form__field">
            <label htmlFor="create-task-reasoning-effort">
              Reasoning effort{" "}
              <span className="create-task-form__optional">(Codex only)</span>
            </label>
            <select
              id="create-task-reasoning-effort"
              value={reasoningEffort}
              onChange={(e) =>
                setReasoningEffort(e.target.value as ReasoningEffort | "")
              }
            >
              <option value="">Default</option>
              {REASONING_EFFORT_VALUES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className="create-task-form__field">
            <label htmlFor="create-task-reasoning-summary">
              Reasoning summary{" "}
              <span className="create-task-form__optional">(Codex only)</span>
            </label>
            <select
              id="create-task-reasoning-summary"
              value={reasoningSummary}
              onChange={(e) =>
                setReasoningSummary(e.target.value as ReasoningSummary | "")
              }
            >
              <option value="">Default</option>
              {REASONING_SUMMARY_VALUES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

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
            ? "Remote task creation waits until the delay expires."
            : 'Enable "Delay task start" to schedule the task for later.'}
        </div>
      </div>

      {submitError && (
        <div className="create-task-form__error">{submitError}</div>
      )}

      <button
        type="button"
        onClick={handleAttemptSubmit}
        disabled={!canSubmit}
        className={`create-task-form__submit-btn${
          taskDelayEnabled ? " create-task-form__submit-btn--needs-confirm" : ""
        }`}
      >
        <span className="create-task-form__submit-btn-label">
          {buttonLabel}
        </span>
        {resolvedRepo && (
          <span className="create-task-form__submit-btn-repo">
            {resolvedRepo}
            {isContinuingExistingSession && selectedExistingTask ? (
              <span className="create-task-form__submit-btn-branch">
                {" "}@ {selectedExistingTask.branch || selectedExistingTask.id}
              </span>
            ) : baseRef ? (
              <span className="create-task-form__submit-btn-branch">
                {" "}@ {baseRef}
              </span>
            ) : null}
          </span>
        )}
      </button>

      <CreateTaskConfirmPopup
        open={confirmOpen}
        variantLabel={variantLabel}
        repo={resolvedRepo}
        branch={baseRef}
        existingSessionLabel={
          selectedExistingTask ? formatTaskSessionLabel(selectedExistingTask) : ""
        }
        isContinuingExistingSession={isContinuingExistingSession}
        pullRequestCompletionModeLabel={pullRequestCompletionMode}
        problemStatement={problemStatement}
        isSubmitting={isSubmitting}
        onConfirm={() => void handleSubmit()}
        onCancel={handleCancelConfirm}
      />

      {submitResult !== null && (
        <div className="create-task-form__result">
          <div className="create-task-form__result-header">Task queued</div>
          {createdTaskInfo && (
            <div className="create-task-form__result-link-row">
              <a
                className="create-task-form__result-link"
                href={createdTaskInfo.statusUrl}
                target="_blank"
                rel="noreferrer"
              >
                View task status
              </a>
              <span className="create-task-form__result-link-hint">
                Job ID: <code>{createdTaskInfo.jobId}</code>
              </span>
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
