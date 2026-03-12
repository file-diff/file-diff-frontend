import { useEffect, useState } from "react";
import { JOBS_API_URL, buildOrganizationRepositoriesUrl } from "../config/api";

const LIST_REFS_URL = `${JOBS_API_URL}/refs`;
const RESOLVE_COMMIT_URL = `${JOBS_API_URL}/resolve`;
const API_DEBOUNCE_MS = 300;

interface ListRefsRequest {
  repo: string;
}

interface ResolveCommitRequest {
  repo: string;
  ref: string;
}

interface ErrorResponse {
  error: string;
}

type GitRefType = "branch" | "tag";

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
          const response = await fetch(LIST_REFS_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ repo: normalizedRepo } satisfies ListRefsRequest),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error("Unable to load refs");
          }

          const data = (await response.json()) as ListRefsResponse;
          const nextRefs = Array.isArray(data.refs)
            ? data.refs
                .map(normalizeGitRefSummary)
                .filter((value): value is GitRefSummary => value !== null)
                .sort(sortGitRefs)
            : [];

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
}

interface OrganizationRepositoriesResponse {
  organization: string;
  repositories: OrganizationRepository[];
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
