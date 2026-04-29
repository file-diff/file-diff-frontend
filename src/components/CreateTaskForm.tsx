import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCreateTaskJobUrl } from "../config/api";
import {
  PULL_REQUEST_COMPLETION_MODE_VALUES,
  REASONING_EFFORT_VALUES,
  REASONING_SUMMARY_VALUES,
  VERBOSITY_VALUES,
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
  CreateTaskRequest,
  CreateTaskResponse,
  PullRequestCompletionMode,
  ReasoningEffort,
  ReasoningSummary,
  RepositoryBranch,
  Verbosity,
} from "../utils/repositorySelection";
import RepositorySelector from "./RepositorySelector";
import CreateTaskConfirmPopup from "./CreateTaskConfirmPopup";
import "./CreateTaskForm.css";

const CODEX_DEFAULT_MODEL = "gpt-5.2-codex";
const DEFAULT_BRANCH_NAME = "main";
const DEFAULT_PULL_REQUEST_COMPLETION_MODE: PullRequestCompletionMode = "None";
const CODEX_MODEL_VALUES = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
] as const;
const BASE_REF_REQUIRED_ERROR = "Please enter a target branch.";
const AGENT_ID_INTEGER_ERROR = "Agent ID must be a whole number.";
const PROBLEM_STATEMENT_REQUIRED_ERROR = "Please enter a problem statement.";
const TASK_DELAY_REQUIRED_ERROR = "Please enter how many minutes to delay the task.";
const TASK_DELAY_NUMBER_ERROR = "Task delay must be a valid number of minutes.";
const TASK_DELAY_INTEGER_ERROR = "Task delay must be a whole number of minutes.";
const TASK_DELAY_MINIMUM_ERROR = "Task delay must be at least 1 whole minute.";
const MIN_TASK_DELAY_MINUTES = 1;

function isCodexModel(value: string): boolean {
  return (CODEX_MODEL_VALUES as readonly string[]).includes(value);
}

function normalizeModelSelection(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return isCodexModel(trimmed) ? trimmed : "";
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

  const [repoInput, setRepoInput] = useState(initialRepoInput);
  const [problemStatement, setProblemStatement] = useState(
    effectiveInitialProblemStatement
  );
  const [model, setModel] = useState(
    normalizeModelSelection(initialRepoDraft?.model ?? savedDraft?.model)
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
    initialRepoDraft?.reasoningEffort ?? savedDraft?.reasoningEffort ?? ""
  );
  const [reasoningSummary, setReasoningSummary] = useState<
    ReasoningSummary | ""
  >(initialRepoDraft?.reasoningSummary ?? savedDraft?.reasoningSummary ?? "");
  const [verbosity, setVerbosity] = useState<Verbosity | "">(
    initialRepoDraft?.verbosity ?? savedDraft?.verbosity ?? ""
  );
  const [codexWebSearch, setCodexWebSearch] = useState(
    initialRepoDraft?.codexWebSearch ?? savedDraft?.codexWebSearch ?? false
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
  const [submitResult, setSubmitResult] = useState<CreateTaskResponse | null>(null);
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

    const validatedProblemStatement = problemStatement.trim();
    if (!validatedProblemStatement) {
      setSubmitError(PROBLEM_STATEMENT_REQUIRED_ERROR);
      return;
    }

    const validatedBaseRef = baseRef.trim();
    if (!validatedBaseRef) {
      setSubmitError(BASE_REF_REQUIRED_ERROR);
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

    const request: CreateTaskRequest = {
      repo,
      base_ref: validatedBaseRef,
      problem_statement: validatedProblemStatement,
      create_pull_request: true,
      pull_request_completion_mode: pullRequestCompletionMode,
    };

    if (parsedAgentId !== undefined) {
      request.agent_id = parsedAgentId;
    }
    if (model) {
      request.model = model;
    }
    if (customAgent.trim()) {
      request.custom_agent = customAgent.trim();
    }
    if (reasoningEffort) {
      request.reasoning_effort = reasoningEffort;
    }
    if (reasoningSummary) {
      request.reasoning_summary = reasoningSummary;
    }
    if (verbosity) {
      request.verbosity = verbosity;
    }
    if (codexWebSearch) {
      request.codex_web_search = true;
    }
    if (typeof taskDelayMs === "number") {
      request.task_delay_ms = taskDelayMs;
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
    problemStatement,
    baseRef,
    agentId,
    taskDelayEnabled,
    taskDelayMinutes,
    pullRequestCompletionMode,
    model,
    customAgent,
    reasoningEffort,
    reasoningSummary,
    verbosity,
    codexWebSearch,
  ]);

  useEffect(() => {
    saveCreateTaskDraft({
      repoInput,
      problemStatement,
      model,
      agentId,
      customAgent,
      baseRef,
      pullRequestCompletionMode,
      reasoningEffort,
      reasoningSummary,
      verbosity,
      codexWebSearch,
      taskDelayEnabled,
      taskDelayMinutes,
    });
  }, [
    repoInput,
    problemStatement,
    model,
    agentId,
    customAgent,
    baseRef,
    pullRequestCompletionMode,
    reasoningEffort,
    reasoningSummary,
    verbosity,
    codexWebSearch,
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
        agentId,
        customAgent,
        baseRef,
        pullRequestCompletionMode,
        reasoningEffort,
        reasoningSummary,
        verbosity,
        codexWebSearch,
        taskDelayEnabled,
        taskDelayMinutes,
      });
    }
  }, [
    repoInput,
    problemStatement,
    model,
    agentId,
    customAgent,
    baseRef,
    pullRequestCompletionMode,
    reasoningEffort,
    reasoningSummary,
    verbosity,
    codexWebSearch,
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
    problemStatement.trim() !== "" &&
    baseRef.trim() !== "" &&
    bearerToken.trim() !== "";
  const resolvedRepo = useMemo(() => resolveRepositoryInput(repoInput), [repoInput]);
  const variantLabel = useMemo(() => {
    return taskDelayEnabled ? "delayed" : "task";
  }, [taskDelayEnabled]);
  const buttonLabel = useMemo(() => {
    if (isSubmitting) return "Creating task...";
    return taskDelayEnabled ? "Create delayed task" : "Create task";
  }, [isSubmitting, taskDelayEnabled]);

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
          <option value="">{`Server default (${CODEX_DEFAULT_MODEL})`}</option>
          {CODEX_MODEL_VALUES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
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
          Custom agent <span className="create-task-form__optional">(optional)</span>
        </label>
        <input
          id="create-task-custom-agent"
          type="text"
          value={customAgent}
          onChange={(e) => setCustomAgent(e.target.value)}
          placeholder="Override the default agent identifier"
          spellCheck={false}
        />
      </div>

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

      <div className="create-task-form__field">
        <label htmlFor="create-task-reasoning-effort">
          Reasoning effort <span className="create-task-form__optional">(Codex only)</span>
        </label>
        <select
          id="create-task-reasoning-effort"
          value={reasoningEffort}
          onChange={(e) => setReasoningEffort(e.target.value as ReasoningEffort | "")}
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
          Reasoning summary <span className="create-task-form__optional">(Codex only)</span>
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

      <div className="create-task-form__field">
        <label htmlFor="create-task-verbosity">
          Verbosity <span className="create-task-form__optional">(Codex only)</span>
        </label>
        <select
          id="create-task-verbosity"
          value={verbosity}
          onChange={(e) => setVerbosity(e.target.value as Verbosity | "")}
        >
          <option value="">Default</option>
          {VERBOSITY_VALUES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <div className="create-task-form__field create-task-form__checkbox-field">
        <label>
          <input
            type="checkbox"
            checked={codexWebSearch}
            onChange={(e) => setCodexWebSearch(e.target.checked)}
          />
          Enable Codex web search
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
        variantLabel={variantLabel}
        repo={resolvedRepo}
        branch={baseRef}
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
