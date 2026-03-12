import type {
  RepositoryRefsState,
  ResolvedCommitState,
} from "../utils/repositorySelection";

const DEFAULT_JOB_STATUS = "waiting";

export interface RepositoryCommitSelectorJob {
  id: string;
  repo?: string;
  ref?: string;
  status?: string;
  progress?: number;
  total_files?: number;
  processed_files?: number;
  error?: string;
  filesLoaded: number;
  inputRefName: string;
  resolvedCommit: string;
}

interface RepositoryCommitSelectorProps {
  commitInputId: string;
  currentCommit: string;
  isStarting: boolean;
  job: RepositoryCommitSelectorJob | null;
  label: string;
  refInputId: string;
  refOptionsId: string;
  refValue: string;
  refsState: RepositoryRefsState;
  repoInputId: string;
  repoPlaceholder: string;
  repoValue: string;
  resolvedCommitState: ResolvedCommitState;
  onRefChange: (value: string) => void;
  onRepoChange: (value: string) => void;
  onStartIndexing: () => void;
}

function formatCommitSummary(commit: string): string {
  return `Commit ${commit.slice(0, 7)}.`;
}

function getSelectionHint(
  currentCommit: string,
  refsState: RepositoryRefsState,
  resolvedCommitState: ResolvedCommitState
): string {
  if (resolvedCommitState.isLoading) {
    return "Resolving full commit SHA…";
  }

  if (resolvedCommitState.error) {
    return resolvedCommitState.error;
  }

  if (currentCommit) {
    return formatCommitSummary(currentCommit);
  }

  if (refsState.isLoading) {
    return "Loading available refs…";
  }

  if (refsState.error) {
    return "Unable to load available refs for this repository.";
  }

  if (refsState.refs.length > 0) {
    return `Select from ${refsState.refs.length} branches and tags or enter any ref manually.`;
  }

  return "Enter any branch, tag, or commit. Matching refs will appear here when available.";
}

function renderJobStatus(job: RepositoryCommitSelectorJob | null) {
  if (!job) {
    return null;
  }

  return (
    <div className="indexing-job-status">
      <div className="indexing-job-status__row">
        <span className="indexing-job-status__label">Job</span>
        <code>{job.id}</code>
      </div>
      <div className="indexing-job-status__row">
        <span className="indexing-job-status__label">Repository</span>
        <span>{job.repo}</span>
      </div>
      <div className="indexing-job-status__row">
        <span className="indexing-job-status__label">Ref</span>
        <span>{job.inputRefName || job.ref || "—"}</span>
      </div>
      <div className="indexing-job-status__row">
        <span className="indexing-job-status__label">Commit</span>
        {job.resolvedCommit ? <code>{job.resolvedCommit}</code> : <span>—</span>}
      </div>
      <div className="indexing-job-status__row">
        <span className="indexing-job-status__label">Status</span>
        <span>{job.status ?? DEFAULT_JOB_STATUS}</span>
      </div>
      <div className="indexing-job-status__row">
        <span className="indexing-job-status__label">Progress</span>
        <span>{job.progress ?? 0}%</span>
      </div>
      <div className="indexing-job-status__row">
        <span className="indexing-job-status__label">Processed files</span>
        <span>
          {job.processed_files ?? 0}
          {job.total_files ? ` / ${job.total_files}` : ""}
        </span>
      </div>
      <div className="indexing-job-status__row">
        <span className="indexing-job-status__label">Files returned</span>
        <span>{job.filesLoaded}</span>
      </div>
      {job.error ? (
        <div className="indexing-job-status__row" role="alert">
          <span className="indexing-job-status__label">Error</span>
          <span>{job.error}</span>
        </div>
      ) : null}
    </div>
  );
}

export default function RepositoryCommitSelector({
  commitInputId,
  currentCommit,
  isStarting,
  job,
  label,
  refInputId,
  refOptionsId,
  refValue,
  refsState,
  repoInputId,
  repoPlaceholder,
  repoValue,
  resolvedCommitState,
  onRefChange,
  onRepoChange,
  onStartIndexing,
}: RepositoryCommitSelectorProps) {
  const hint = getSelectionHint(
    currentCommit,
    refsState,
    resolvedCommitState
  );

  return (
    <>
      <label htmlFor={repoInputId}>{label}</label>
      <div className="indexing-controls">
        <input
          id={repoInputId}
          type="text"
          value={repoValue}
          onChange={(event) => onRepoChange(event.target.value)}
          placeholder={repoPlaceholder}
          spellCheck={false}
        />
        <input
          id={refInputId}
          type="text"
          value={refValue}
          list={refOptionsId}
          onChange={(event) => onRefChange(event.target.value)}
          placeholder="main"
          spellCheck={false}
        />
        <input
          id={commitInputId}
          type="text"
          value={currentCommit}
          placeholder="Resolved commit SHA"
          readOnly
          spellCheck={false}
        />
        <datalist id={refOptionsId}>
          {refsState.refs.map((refOption) => (
            <option
              key={refOption.ref}
              value={refOption.name}
              label={`${refOption.name} (${refOption.type}${refOption.commitShort ? ` · ${refOption.commitShort}` : ""})`}
            />
          ))}
        </datalist>
        <button type="button" onClick={onStartIndexing} disabled={isStarting}>
          {isStarting ? "Starting..." : "Start indexing"}
        </button>
      </div>
      <div className="indexing-controls__hint" aria-live="polite">
        {hint}
      </div>
      {renderJobStatus(job)}
    </>
  );
}
