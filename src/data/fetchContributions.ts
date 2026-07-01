import type { ContributionDay, ContributionGrid, ContributionLevel } from "../types.js";

const GITHUB_GRAPHQL_ENDPOINT = "https://api.github.com/graphql";

const CONTRIBUTION_CALENDAR_QUERY = /* GraphQL */ `
  query ContributionCalendar($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
              weekday
            }
          }
        }
      }
    }
  }
`;

interface GraphQlContributionDay {
  readonly date: string;
  readonly contributionCount: number;
  readonly weekday: number;
}

interface GraphQlContributionWeek {
  readonly contributionDays: readonly GraphQlContributionDay[];
}

interface GraphQlResponse {
  readonly data?: {
    readonly user: {
      readonly contributionsCollection: {
        readonly contributionCalendar: {
          readonly totalContributions: number;
          readonly weeks: readonly GraphQlContributionWeek[];
        };
      };
    } | null;
  };
  readonly errors?: ReadonlyArray<{ readonly message: string }>;
}

/** Minimal shape of the global `fetch` this module depends on, so tests can inject a fake. */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  json(): Promise<unknown>;
}>;

export interface FetchContributionsOptions {
  readonly username: string;
  readonly githubToken: string;
  /** Injectable for tests; defaults to the global `fetch` (Node >= 18). */
  readonly fetchImpl?: FetchLike;
  readonly endpoint?: string;
}

/**
 * GitHub renders contribution-graph intensity relative to the user's own
 * activity (roughly a quartile split of non-zero days), not fixed absolute
 * thresholds. The GraphQL API does not expose the level directly, so we
 * derive it the same way: level 0 for empty days, and an even quartile split
 * of the max day count for levels 1-4.
 */
function levelForCount(count: number, maxCount: number): ContributionLevel {
  if (count <= 0) {
    return 0;
  }
  if (maxCount <= 0) {
    return 1;
  }
  const quartile = Math.ceil((count / maxCount) * 4);
  return Math.min(4, Math.max(1, quartile)) as ContributionLevel;
}

export async function fetchContributions(
  options: FetchContributionsOptions,
): Promise<ContributionGrid> {
  const { username, githubToken, endpoint = GITHUB_GRAPHQL_ENDPOINT } = options;
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);

  if (!fetchImpl) {
    throw new Error(
      "No fetch implementation available. Run on Node >= 18 or pass `fetchImpl` explicitly.",
    );
  }
  if (!githubToken) {
    throw new Error("A GitHub token is required to query the contribution calendar.");
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      "Content-Type": "application/json",
      "User-Agent": "WolverineCommit.Snake",
    },
    body: JSON.stringify({
      query: CONTRIBUTION_CALENDAR_QUERY,
      variables: { login: username },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `GitHub GraphQL request failed: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as GraphQlResponse;

  if (payload.errors && payload.errors.length > 0) {
    throw new Error(
      `GitHub GraphQL API returned errors: ${payload.errors.map((e) => e.message).join("; ")}`,
    );
  }

  const calendar = payload.data?.user?.contributionsCollection.contributionCalendar;
  if (!calendar) {
    throw new Error(`No contribution data found for user "${username}".`);
  }

  return buildContributionGrid(calendar.weeks);
}

export function buildContributionGrid(
  weeks: readonly GraphQlContributionWeek[],
): ContributionGrid {
  const maxCount = weeks.reduce((max, week) => {
    const weekMax = week.contributionDays.reduce(
      (m, day) => Math.max(m, day.contributionCount),
      0,
    );
    return Math.max(max, weekMax);
  }, 0);

  const builtWeeks: ContributionDay[][] = weeks.map((week, weekIndex) =>
    week.contributionDays.map((day): ContributionDay => ({
      date: day.date,
      count: day.contributionCount,
      level: levelForCount(day.contributionCount, maxCount),
      weekIndex,
      dayIndex: day.weekday,
    })),
  );

  return {
    weeks: builtWeeks,
    weekCount: builtWeeks.length,
    dayCount: 7,
  };
}
