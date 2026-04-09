import { useEffect, useState } from "react";
import { JOBS_API_URL, COMMITS_API_URL, BRANCHES_API_URL, CREATE_TASK_API_URL, DELETE_REMOTE_BRANCH_API_URL, PULL_REQUEST_READY_API_URL, PULL_REQUEST_MERGE_API_URL, PULL_REQUEST_OPEN_API_URL, buildOrganizationRepositoriesUrl, buildAgentTasksUrl, buildAgentTaskUrl, buildAgentTaskArchiveUrl } from "../config/api";

const LIST_REFS_URL = `${JOBS_API_URL}/refs`;
const RESOLVE_COMMIT_URL = `${JOBS_API_URL}/resolve`;
const RESOLVE_PULL_REQUEST_URL = `${JOBS_API_URL}/pull-request/resolve`;
const API_DEBOUNCE_MS = 300;
const REPOSITORY_SLUG_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

interface ListRefsRequest {
  repo: string;
}

interface ResolveCommitRequest {
  repo: string;
  ref: string;
}

interface ResolvePullRequestRequest {
  pullRequestUrl: string;
}

interface ErrorResponse {
  error: string;
}

type GitRefType = "branch" | "tag";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export interface GitRefSummary {
  name: string;
  ref: string;
  type: GitRefType;
  commit: string;
  commitShort: string;
}

interface ListRefsResponse {
  repo: string;
  refs: GitRefSummary[];
}

export interface ResolveCommitResponse {
  repo: string;
  ref: string;
  commit: string;
  commitShort: string;
}

export interface ResolvePullRequestResponse {
  repo: string;
  repositoryUrl: string;
  sourceCommit: string;
  sourceCommitShort: string;
  targetCommit: string;
  targetCommitShort: string;
}

export interface RepositoryRefsState {
  refs: GitRefSummary[];
  isLoading: boolean;
  error: string;
}

export interface ResolvedCommitState {
  commit: string;
  commitShort: string;
  isLoading: boolean;
  error: string;
}

function sortGitRefs(a: GitRefSummary, b: GitRefSummary): number {
  if (a.type !== b.type) {
    return a.type.localeCompare(b.type);
  }

  return a.name.localeCompare(b.name);
}

function isGitRefType(value: unknown): value is GitRefType {
  return value === "branch" || value === "tag";
}

function normalizeGitRefSummary(value: unknown): GitRefSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const name =
    typeof candidate.name === "string" ? candidate.name.trim() : "";
  const ref = typeof candidate.ref === "string" ? candidate.ref.trim() : "";

  if (!name || !ref || !isGitRefType(candidate.type)) {
    return null;
  }

  return {
    name,
    ref,
    type: candidate.type,
    commit:
      typeof candidate.commit === "string" ? candidate.commit.trim() : "",
    commitShort:
      typeof candidate.commitShort === "string"
        ? candidate.commitShort.trim()
        : "",
  };
}

export async function requestResolvedCommit(
  repo: string,
  ref: string,
  signal?: AbortSignal
): Promise<ResolveCommitResponse> {
  const response = await fetch(RESOLVE_COMMIT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ repo, ref } satisfies ResolveCommitRequest),
    signal,
  });

  if (!response.ok) {
    let message = "Unable to resolve commit";

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  return (await response.json()) as ResolveCommitResponse;
}

export async function requestResolvedPullRequest(
  pullRequestUrl: string,
  signal?: AbortSignal
): Promise<ResolvePullRequestResponse> {
  const response = await fetch(RESOLVE_PULL_REQUEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pullRequestUrl,
    } satisfies ResolvePullRequestRequest),
    signal,
  });

  if (!response.ok) {
    let message = "Unable to resolve pull request";

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  return (await response.json()) as ResolvePullRequestResponse;
}

export async function requestRepositoryRefs(
  repo: string,
  signal?: AbortSignal
): Promise<GitRefSummary[]> {
  const response = await fetch(LIST_REFS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ repo } satisfies ListRefsRequest),
    signal,
  });

  if (!response.ok) {
    let message = "Unable to load refs";

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  const data = (await response.json()) as ListRefsResponse;
  return Array.isArray(data.refs)
    ? data.refs
        .map(normalizeGitRefSummary)
        .filter((value): value is GitRefSummary => value !== null)
        .sort(sortGitRefs)
    : [];
}

export function useRepositoryRefs(repo: string): RepositoryRefsState {
  const [refs, setRefs] = useState<GitRefSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const normalizedRepo = repo.trim();

    if (!normalizedRepo) {
      setRefs([]);
      setIsLoading(false);
      setError("");
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      const loadRefs = async () => {
        setRefs([]);
        setIsLoading(true);
        setError("");

        try {
          const nextRefs = await requestRepositoryRefs(
            normalizedRepo,
            controller.signal
          );
          setRefs(nextRefs);
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }

          setRefs([]);
          setError(
            error instanceof Error && error.message
              ? error.message
              : "Unable to load refs"
          );
        } finally {
          if (!controller.signal.aborted) {
            setIsLoading(false);
          }
        }
      };

      void loadRefs();
    }, API_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [repo]);

  return { refs, isLoading, error };
}

export function useResolvedCommit(
  repo: string,
  ref: string
): ResolvedCommitState {
  const [commit, setCommit] = useState("");
  const [commitShort, setCommitShort] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const normalizedRepo = repo.trim();
    const normalizedRef = ref.trim();

    if (!normalizedRepo || !normalizedRef) {
      setCommit("");
      setCommitShort("");
      setIsLoading(false);
      setError("");
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      const loadCommit = async () => {
        setCommit("");
        setCommitShort("");
        setIsLoading(true);
        setError("");

        try {
          const data = await requestResolvedCommit(
            normalizedRepo,
            normalizedRef,
            controller.signal
          );
          setCommit(data.commit.trim());
          setCommitShort(data.commitShort.trim());
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }

          setCommit("");
          setCommitShort("");
          setError(
            error instanceof Error && error.message
              ? error.message
              : "Unable to resolve commit"
          );
        } finally {
          if (!controller.signal.aborted) {
            setIsLoading(false);
          }
        }
      };

      void loadCommit();
    }, API_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [repo, ref]);

  return { commit, commitShort, isLoading, error };
}

export interface OrganizationRepository {
  name: string;
  repo: string;
  repositoryUrl: string;
  updatedAt?: string;
}

export interface ParsedRepositoryLocation {
  organization: string;
  repo: string;
  ref: string;
}

interface OrganizationRepositoriesResponse {
  organization: string;
  repositories: OrganizationRepository[];
}

function normalizeParsedRepository(
  organization: string,
  repository: string,
  ref = ""
): ParsedRepositoryLocation | null {
  const normalizedOrganization = organization.trim();
  const normalizedRepository = repository.trim().replace(/\.git$/i, "");

  if (!normalizedOrganization || !normalizedRepository) {
    return null;
  }

  return {
    organization: normalizedOrganization,
    repo: `${normalizedOrganization}/${normalizedRepository}`,
    ref: ref.trim(),
  };
}

function parseRepositoryUrl(url: URL): ParsedRepositoryLocation | null {
  const pathSegments = url.pathname.split("/").filter(Boolean);

  if (pathSegments.length < 2) {
    return null;
  }

  const [, , selectionType, selectionValue] = pathSegments;
  const refFromPath =
    selectionType === "tree" ||
    selectionType === "blob" ||
    selectionType === "commit"
      ? decodeURIComponent(selectionValue ?? "")
      : "";

  return normalizeParsedRepository(
    decodeURIComponent(pathSegments[0] ?? ""),
    decodeURIComponent(pathSegments[1] ?? ""),
    refFromPath || url.searchParams.get("ref") || ""
  );
}

export function parseRepositoryLocation(
  value: string
): ParsedRepositoryLocation | null {
  const input = value.trim();
  if (!input) {
    return null;
  }

  const sshMatch = input.match(/^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    return normalizeParsedRepository(sshMatch[1], sshMatch[2]);
  }

  const urlCandidate =
    /^https?:\/\//i.test(input) || input.startsWith("git://")
      ? input
      : input.startsWith("www.") ||
          /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(input)
        ? `https://${input}`
        : "";

  if (!urlCandidate) {
    return null;
  }

  try {
    return parseRepositoryUrl(new URL(urlCandidate));
  } catch {
    return null;
  }
}

export function resolveRepositoryInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  const parsed = parseRepositoryLocation(trimmed);
  if (parsed) {
    return parsed.repo;
  }

  if (REPOSITORY_SLUG_PATTERN.test(trimmed)) {
    return trimmed;
  }

  return trimmed;
}

export async function requestOrganizationRepositories(
  organization: string,
  signal?: AbortSignal
): Promise<OrganizationRepository[]> {
  const response = await fetch(
    buildOrganizationRepositoriesUrl(organization),
    { signal }
  );

  if (!response.ok) {
    let message = "Unable to list repositories";

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  const data = (await response.json()) as OrganizationRepositoriesResponse;
  return Array.isArray(data.repositories) ? data.repositories : [];
}

export interface CommitPullRequest {
  number: number;
  title: string;
  url: string;
}

export interface RepositoryCommit {
  commit: string;
  date: string;
  author: string;
  title: string;
  branch: string | null;
  parents: string[];
  pullRequest: CommitPullRequest | null;
  tags: string[];
}

interface ListCommitsRequest {
  repo: string;
  limit: number;
}

interface ListCommitsResponse {
  repo: string;
  commits: RepositoryCommit[];
}

export async function requestRepositoryCommits(
  repo: string,
  limit: number,
  signal?: AbortSignal
): Promise<RepositoryCommit[]> {
  const response = await fetch(COMMITS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ repo, limit } satisfies ListCommitsRequest),
    signal,
  });

  if (!response.ok) {
    let message = "Unable to list commits";

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  const data = (await response.json()) as ListCommitsResponse;
  return Array.isArray(data.commits) ? data.commits : [];
}

export interface BranchPullRequest {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  draft?: boolean;
  mergeable?: boolean;
  mergeStateStatus?: string;
  readyToMerge?: boolean;
}

export interface RepositoryBranch {
  name: string;
  ref: string;
  commit: string;
  commitShort: string;
  date: string;
  author: string;
  title: string;
  isDefault: boolean;
  pullRequestStatus: "open" | "closed" | "none";
  pullRequest: BranchPullRequest | null;
  tags: string[];
}

export const PULL_REQUEST_COMPLETION_MODES = [
  "None",
  "AutoReady",
  "AutoMerge",
] as const;

export type PullRequestCompletionMode =
  (typeof PULL_REQUEST_COMPLETION_MODES)[number];

interface ListBranchesRequest {
  repo: string;
}

interface ListBranchesResponse {
  repo: string;
  branches: RepositoryBranch[];
}

function normalizePullRequestState(value: unknown): "open" | "closed" {
  return typeof value === "string" && value.trim().toLowerCase() === "open"
    ? "open"
    : "closed";
}

function normalizePullRequest(value: unknown): BranchPullRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const number =
    asNumber(value.number) ??
    asNumber(value.pullNumber) ??
    asNumber(value.pull_number);
  const url =
    asString(value.url)?.trim() ??
    asString(value.htmlUrl)?.trim() ??
    asString(value.html_url)?.trim() ??
    asString(value.pullRequestUrl)?.trim() ??
    asString(value.pull_request_url)?.trim() ??
    "";

  if (!number || !url) {
    return null;
  }

  return {
    number,
    title: asString(value.title)?.trim() ?? "",
    url,
    state: normalizePullRequestState(value.state),
    draft:
      asBoolean(value.draft) ??
      asBoolean(value.isDraft) ??
      asBoolean(value.is_draft),
    mergeable: asBoolean(value.mergeable),
    mergeStateStatus:
      asString(value.mergeStateStatus)?.trim() ??
      asString(value.merge_state_status)?.trim() ??
      asString(value.mergeState)?.trim() ??
      asString(value.merge_state)?.trim(),
    readyToMerge:
      asBoolean(value.readyToMerge) ?? asBoolean(value.ready_to_merge),
  };
}

function normalizePullRequestStatus(value: unknown): "open" | "closed" | "none" {
  if (value === "open" || value === "closed" || value === "none") {
    return value;
  }
  return "none";
}

function normalizeRepositoryBranch(value: unknown): RepositoryBranch | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = asString(value.name)?.trim() ?? "";
  const ref = asString(value.ref)?.trim() ?? "";

  if (!name || !ref) {
    return null;
  }

  const pullRequest = normalizePullRequest(value.pullRequest ?? value.pull_request);
  const pullRequestStatus = normalizePullRequestStatus(
    value.pullRequestStatus ?? value.pull_request_status
  );

  return {
    name,
    ref,
    commit: asString(value.commit)?.trim() ?? "",
    commitShort:
      asString(value.commitShort)?.trim() ??
      asString(value.commit_short)?.trim() ??
      "",
    date: asString(value.date)?.trim() ?? "",
    author: asString(value.author)?.trim() ?? "",
    title: asString(value.title)?.trim() ?? "",
    isDefault:
      asBoolean(value.isDefault) ?? asBoolean(value.is_default) ?? false,
    pullRequestStatus:
      pullRequestStatus !== "none"
        ? pullRequestStatus
        : pullRequest?.state ?? "none",
    pullRequest,
    tags: Array.isArray(value.tags)
      ? value.tags
          .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
          .filter((tag) => tag.length > 0)
      : [],
  };
}

export async function requestRepositoryBranches(
  repo: string,
  signal?: AbortSignal
): Promise<RepositoryBranch[]> {
  const response = await fetch(BRANCHES_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ repo } satisfies ListBranchesRequest),
    signal,
  });

  if (!response.ok) {
    let message = "Unable to list branches";

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  const data = (await response.json()) as ListBranchesResponse;
  return Array.isArray(data.branches)
    ? data.branches
        .map(normalizeRepositoryBranch)
        .filter((branch): branch is RepositoryBranch => branch !== null)
    : [];
}

export interface CreateTaskRequest {
  repo: string;
  event_content: string;
  model?: string;
  problem_statement?: string;
  custom_agent?: string;
  create_pull_request?: boolean;
  pull_request_completion_mode?: PullRequestCompletionMode;
  base_ref?: string;
}

export async function requestCreateTask(
  request: CreateTaskRequest,
  bearerToken: string,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await fetch(CREATE_TASK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    let message = "Unable to create task";

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  return (await response.json()) as unknown;
}

export interface DeleteRemoteBranchResponse {
  repo: string;
  branch: string;
}

export async function requestDeleteRemoteBranch(
  repo: string,
  branch: string,
  bearerToken: string,
  signal?: AbortSignal
): Promise<DeleteRemoteBranchResponse> {
  const response = await fetch(DELETE_REMOTE_BRANCH_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({ repo, branch }),
    signal,
  });

  if (!response.ok) {
    let message = `Unable to delete branch "${branch}"`;

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  return (await response.json()) as DeleteRemoteBranchResponse;
}

export interface PullRequestReadyResponse {
  repo: string;
  pullNumber: number;
}

export async function requestPullRequestReady(
  repo: string,
  pullNumber: number,
  bearerToken: string,
  signal?: AbortSignal
): Promise<PullRequestReadyResponse> {
  const response = await fetch(PULL_REQUEST_READY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({ repo, pullNumber }),
    signal,
  });

  if (!response.ok) {
    let message = `Unable to mark PR #${String(pullNumber)} as ready`;

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  return (await response.json()) as PullRequestReadyResponse;
}

export interface PullRequestMergeResponse {
  repo: string;
  pullNumber: number;
  merged: boolean;
  message: string;
  sha: string;
}

export async function requestPullRequestMerge(
  repo: string,
  pullNumber: number,
  mergeMethod: "merge" | "squash" | "rebase",
  bearerToken: string,
  signal?: AbortSignal
): Promise<PullRequestMergeResponse> {
  const response = await fetch(PULL_REQUEST_MERGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({ repo, pullNumber, mergeMethod }),
    signal,
  });

  if (!response.ok) {
    let message = `Unable to merge PR #${String(pullNumber)}`;

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  return (await response.json()) as PullRequestMergeResponse;
}

export interface PullRequestOpenResponse {
  repo: string;
  pullNumber: number;
  title: string;
  url: string;
  draft: boolean;
}

export async function requestPullRequestOpen(
  repo: string,
  head: string,
  base: string,
  draft: boolean,
  bearerToken: string,
  signal?: AbortSignal
): Promise<PullRequestOpenResponse> {
  const response = await fetch(PULL_REQUEST_OPEN_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({ repo, head, base, draft }),
    signal,
  });

  if (!response.ok) {
    let message = `Unable to open pull request for "${head}"`;

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  return (await response.json()) as PullRequestOpenResponse;
}

export async function requestAgentTasks(
  owner: string,
  repo: string,
  bearerToken: string,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await fetch(buildAgentTasksUrl(owner, repo), {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    signal,
  });

  if (!response.ok) {
    let message = "Unable to fetch agent tasks";

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  return (await response.json()) as unknown;
}

export async function requestAgentTask(
  owner: string,
  repo: string,
  taskId: string,
  bearerToken: string,
  signal?: AbortSignal
): Promise<unknown> {
  const response = await fetch(buildAgentTaskUrl(owner, repo, taskId), {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    signal,
  });

  if (!response.ok) {
    let message = "Unable to fetch agent task";

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  return (await response.json()) as unknown;
}

export async function requestArchiveAgentTask(
  owner: string,
  repo: string,
  taskId: string,
  bearerToken: string,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(buildAgentTaskArchiveUrl(owner, repo, taskId), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    signal,
  });

  if (!response.ok) {
    let message = "Unable to archive agent task";

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }
}
