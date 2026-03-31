import type { OrganizationRepository } from "./repositorySelection";

const ORGANIZATIONS_STORAGE_KEY = "organization-browser-organizations";
const ORG_REPOS_STORAGE_PREFIX = "org-repos-";

function normalizeOrganization(org: string): string {
  return org.trim();
}

function organizationKey(org: string): string {
  return normalizeOrganization(org).toLowerCase();
}

function dedupeOrganizations(orgs: string[]): string[] {
  const seen = new Set<string>();
  const normalized = orgs
    .map(normalizeOrganization)
    .filter(Boolean)
    .filter((org) => {
      const key = organizationKey(org);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return normalized;
}

export function loadSavedOrganizations(): string[] {
  try {
    const raw = localStorage.getItem(ORGANIZATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? dedupeOrganizations(
          parsed.filter((value): value is string => typeof value === "string")
        )
      : [];
  } catch {
    return [];
  }
}

export function saveOrganizations(orgs: string[]): string[] {
  const normalized = dedupeOrganizations(orgs);

  try {
    localStorage.setItem(ORGANIZATIONS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }

  return normalized;
}

export function addOrganization(orgs: string[], org: string): string[] {
  return saveOrganizations([...orgs, org]);
}

export function removeOrganization(orgs: string[], org: string): string[] {
  return saveOrganizations(
    orgs.filter((candidate) => organizationKey(candidate) !== organizationKey(org))
  );
}

export function loadCachedRepositories(org: string): OrganizationRepository[] {
  try {
    const raw = localStorage.getItem(ORG_REPOS_STORAGE_PREFIX + organizationKey(org));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OrganizationRepository[]) : [];
  } catch {
    return [];
  }
}

export function loadCombinedCachedRepositories(
  organizations: string[]
): OrganizationRepository[] {
  return organizations.flatMap((org) => loadCachedRepositories(org));
}

export function saveCachedRepositories(
  org: string,
  repos: OrganizationRepository[]
): void {
  try {
    localStorage.setItem(
      ORG_REPOS_STORAGE_PREFIX + organizationKey(org),
      JSON.stringify(repos)
    );
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

export function clearCachedRepositories(org: string): void {
  try {
    localStorage.removeItem(ORG_REPOS_STORAGE_PREFIX + organizationKey(org));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

export function getRepositoryOrganization(repo: string): string {
  return repo.split("/")[0] ?? repo;
}
