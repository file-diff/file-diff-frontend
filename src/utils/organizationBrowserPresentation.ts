import type { OrganizationRepository } from "./repositorySelection";

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

const RELATIVE_TIME_DIVISIONS = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
] as const;

function parseDateValue(isoDate: string | undefined): Date | null {
  if (!isoDate) return null;

  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRelativeDateTime(isoDate: string | undefined): string {
  const date = parseDateValue(isoDate);
  if (!date) return isoDate ?? "";

  let delta = (date.getTime() - Date.now()) / 1000;
  if (Math.abs(delta) < 30) {
    return "just now";
  }

  for (const division of RELATIVE_TIME_DIVISIONS) {
    if (Math.abs(delta) < division.amount) {
      return relativeTimeFormatter.format(
        Math.round(delta),
        division.unit as Intl.RelativeTimeFormatUnit
      );
    }

    delta /= division.amount;
  }

  return date.toLocaleString();
}

export function formatAbsoluteDateTime(isoDate: string | undefined): string {
  const date = parseDateValue(isoDate);
  return date ? date.toLocaleString() : isoDate ?? "";
}

export function sortByUpdatedAtDesc(
  a: Pick<OrganizationRepository, "updatedAt">,
  b: Pick<OrganizationRepository, "updatedAt">
): number {
  const dateA = parseDateValue(a.updatedAt)?.getTime() ?? 0;
  const dateB = parseDateValue(b.updatedAt)?.getTime() ?? 0;
  return dateB - dateA;
}

export function getOrganizationToggleId(
  prefix: string,
  savedOrganization: string
): string {
  const encodedOrganization = Array.from(savedOrganization, (character) =>
    character.codePointAt(0)?.toString(16)
  )
    .filter((codePoint): codePoint is string => codePoint !== undefined)
    .join("-");

  return `${prefix}-${encodedOrganization}`;
}
