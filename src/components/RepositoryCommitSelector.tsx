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
  job: RepositoryCommitSelectorJob | null;
  label: string;
  repoInputId: string;
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
  job,
  label,
  repoInputId
}: RepositoryCommitSelectorProps) {
  return (
    <>
      <label htmlFor={repoInputId}>{label}</label>

      {renderJobStatus(job)}
    </>
  );
}
