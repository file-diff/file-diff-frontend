import type { OrganizationRepository } from "./repositorySelection";

const ORGANIZATIONS_STORAGE_KEY = "organization-browser-organizations";
const ORGANIZATION_COLORS_STORAGE_KEY = "organization-browser-org-colors";
const ORG_REPOS_STORAGE_PREFIX = "org-repos-";

interface CachedRepositoriesPayload {
  repositories: OrganizationRepository[];
  fetchedAt?: string;
}

export interface OrganizationColorDefinition {
  backgroundColor: string;
  borderColor: string;
  color: string;
}

type OrganizationColorAssignments = Record<string, number>;

const ORGANIZATION_COLOR_PALETTE: OrganizationColorDefinition[] = [
  {
    backgroundColor: "rgba(255, 123, 114, 0.16)",
    borderColor: "rgba(255, 123, 114, 0.45)",
    color: "#ffb3ad",
  },
  {
    backgroundColor: "rgba(241, 194, 50, 0.16)",
    borderColor: "rgba(241, 194, 50, 0.45)",
    color: "#f2cc60",
  },
  {
    backgroundColor: "rgba(63, 185, 80, 0.16)",
    borderColor: "rgba(63, 185, 80, 0.45)",
    color: "#7ee787",
  },
  {
    backgroundColor: "rgba(88, 166, 255, 0.16)",
    borderColor: "rgba(88, 166, 255, 0.45)",
    color: "#79c0ff",
  },
  {
    backgroundColor: "rgba(188, 140, 255, 0.16)",
    borderColor: "rgba(188, 140, 255, 0.45)",
    color: "#d2a8ff",
  },
];

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

function loadOrganizationColorAssignments(): OrganizationColorAssignments {
  try {
    const raw = localStorage.getItem(ORGANIZATION_COLORS_STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) =>
          Boolean(key) &&
          typeof value === "number" &&
          Number.isInteger(value) &&
          value >= 0 &&
          value < ORGANIZATION_COLOR_PALETTE.length
      )
    );
  } catch {
    return {};
  }
}

function saveOrganizationColorAssignments(
  assignments: OrganizationColorAssignments
): void {
  try {
    localStorage.setItem(
      ORGANIZATION_COLORS_STORAGE_KEY,
      JSON.stringify(assignments)
    );
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

function parseCachedRepositoriesPayload(
  raw: string | null
): CachedRepositoriesPayload | null {
  if (!raw) return null;

  const parsed: unknown = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return {
      repositories: parsed as OrganizationRepository[],
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  return {
    repositories: Array.isArray(candidate.repositories)
      ? (candidate.repositories as OrganizationRepository[])
      : [],
    fetchedAt:
      typeof candidate.fetchedAt === "string" ? candidate.fetchedAt : undefined,
  };
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

export function loadOrganizationColors(
  organizations: string[]
): Record<string, OrganizationColorDefinition> {
  const normalizedOrganizations = dedupeOrganizations(organizations);
  const assignments = loadOrganizationColorAssignments();
  const usedColorIndexes = new Set<number>();
  let changed = false;

  normalizedOrganizations.forEach((org) => {
    const colorIndex = assignments[organizationKey(org)];
    if (typeof colorIndex === "number") {
      usedColorIndexes.add(colorIndex);
    }
  });

  normalizedOrganizations.forEach((org) => {
    const key = organizationKey(org);
    const existingColorIndex = assignments[key];

    if (typeof existingColorIndex === "number") {
      return;
    }

    const availableColorIndexes = Array.from(
      ORGANIZATION_COLOR_PALETTE.keys()
    ).filter((index) => !usedColorIndexes.has(index));
    const candidateColorIndexes =
      availableColorIndexes.length > 0
        ? availableColorIndexes
        : ORGANIZATION_COLOR_PALETTE.map((_, index) => index);
    const randomColorIndex =
      candidateColorIndexes[
        Math.floor(Math.random() * candidateColorIndexes.length)
      ];

    assignments[key] = randomColorIndex;
    usedColorIndexes.add(randomColorIndex);
    changed = true;
  });

  if (changed) {
    saveOrganizationColorAssignments(assignments);
  }

  return Object.fromEntries(
    normalizedOrganizations.map((org) => {
      const colorIndex = assignments[organizationKey(org)];
      return [organizationKey(org), ORGANIZATION_COLOR_PALETTE[colorIndex]];
    })
  );
}

export function getOrganizationColor(
  org: string,
  colors: Record<string, OrganizationColorDefinition>
): OrganizationColorDefinition | undefined {
  return colors[organizationKey(org)];
}

export function loadCachedRepositories(org: string): OrganizationRepository[] {
  try {
    const payload = parseCachedRepositoriesPayload(
      localStorage.getItem(ORG_REPOS_STORAGE_PREFIX + organizationKey(org))
    );
    return payload?.repositories ?? [];
  } catch {
    return [];
  }
}

export function loadCombinedCachedRepositories(
  organizations: string[]
): OrganizationRepository[] {
  return organizations.flatMap((org) => loadCachedRepositories(org));
}

export function loadLatestCachedRepositoriesFetchedAt(
  organizations: string[]
): string {
  let latestTimestamp = 0;
  let latestFetchedAt = "";

  for (const org of organizations) {
    try {
      const payload = parseCachedRepositoriesPayload(
        localStorage.getItem(ORG_REPOS_STORAGE_PREFIX + organizationKey(org))
      );
      if (!payload?.fetchedAt) {
        continue;
      }

      const timestamp = new Date(payload.fetchedAt).getTime();
      if (Number.isNaN(timestamp) || timestamp <= latestTimestamp) {
        continue;
      }

      latestTimestamp = timestamp;
      latestFetchedAt = payload.fetchedAt;
    } catch {
      // Ignore malformed cached values and continue.
    }
  }

  return latestFetchedAt;
}

export function saveCachedRepositories(
  org: string,
  repos: OrganizationRepository[]
): void {
  try {
    localStorage.setItem(
      ORG_REPOS_STORAGE_PREFIX + organizationKey(org),
      JSON.stringify({
        repositories: repos,
        fetchedAt: new Date().toISOString(),
      } satisfies CachedRepositoriesPayload)
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
