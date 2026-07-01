import { describe, expect, it } from "vitest";
import { buildContributionGrid, fetchContributions, type FetchLike } from "./fetchContributions.js";

function fixtureWeeks() {
  return [
    {
      contributionDays: [
        { date: "2026-01-04", contributionCount: 0, weekday: 0 },
        { date: "2026-01-05", contributionCount: 1, weekday: 1 },
        { date: "2026-01-06", contributionCount: 4, weekday: 2 },
        { date: "2026-01-07", contributionCount: 8, weekday: 3 },
        { date: "2026-01-08", contributionCount: 12, weekday: 4 },
        { date: "2026-01-09", contributionCount: 16, weekday: 5 },
        { date: "2026-01-10", contributionCount: 0, weekday: 6 },
      ],
    },
  ];
}

function mockFetch(body: unknown, ok = true, status = 200): FetchLike {
  return async () => ({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
  });
}

describe("buildContributionGrid", () => {
  it("maps GraphQL weeks into a typed grid with weekIndex/dayIndex coordinates", () => {
    const grid = buildContributionGrid(fixtureWeeks());

    expect(grid.weekCount).toBe(1);
    expect(grid.dayCount).toBe(7);
    expect(grid.weeks[0]).toHaveLength(7);
    expect(grid.weeks[0]?.[0]?.dayIndex).toBe(0);
    expect(grid.weeks[0]?.[0]?.weekIndex).toBe(0);
  });

  it("assigns level 0 to zero-contribution days regardless of the max", () => {
    const grid = buildContributionGrid(fixtureWeeks());
    expect(grid.weeks[0]?.[0]?.level).toBe(0);
    expect(grid.weeks[0]?.[6]?.level).toBe(0);
  });

  it("derives a quartile-based level (1-4) from the max count in the calendar", () => {
    const grid = buildContributionGrid(fixtureWeeks());
    // max count in the fixture is 16, so quartiles are at 4/8/12/16.
    expect(grid.weeks[0]?.[1]?.level).toBe(1); // count 1
    expect(grid.weeks[0]?.[2]?.level).toBe(1); // count 4 -> exactly quartile 1
    expect(grid.weeks[0]?.[3]?.level).toBe(2); // count 8
    expect(grid.weeks[0]?.[4]?.level).toBe(3); // count 12
    expect(grid.weeks[0]?.[5]?.level).toBe(4); // count 16 (max)
  });

  it("never produces a level above 4 or below 1 for non-zero counts", () => {
    // A single non-zero day is necessarily the max of the calendar, so it
    // should land in the top bucket (level 4), never above or below range.
    const grid = buildContributionGrid([
      {
        contributionDays: [{ date: "2026-01-04", contributionCount: 1, weekday: 0 }],
      },
    ]);
    const level = grid.weeks[0]?.[0]?.level;
    expect(level).toBe(4);
    expect(level).toBeGreaterThanOrEqual(1);
    expect(level).toBeLessThanOrEqual(4);
  });
});

describe("fetchContributions", () => {
  it("parses a successful GraphQL response into a ContributionGrid", async () => {
    const grid = await fetchContributions({
      username: "octocat",
      githubToken: "fake-token",
      fetchImpl: mockFetch({
        data: {
          user: {
            contributionsCollection: {
              contributionCalendar: {
                totalContributions: 41,
                weeks: fixtureWeeks(),
              },
            },
          },
        },
      }),
    });

    expect(grid.weekCount).toBe(1);
    expect(grid.weeks[0]?.[2]?.count).toBe(4);
  });

  it("throws when the HTTP response is not ok", async () => {
    await expect(
      fetchContributions({
        username: "octocat",
        githubToken: "fake-token",
        fetchImpl: mockFetch({}, false, 401),
      }),
    ).rejects.toThrow(/401/);
  });

  it("throws when the GraphQL response contains errors", async () => {
    await expect(
      fetchContributions({
        username: "octocat",
        githubToken: "fake-token",
        fetchImpl: mockFetch({ errors: [{ message: "Could not resolve to a User" }] }),
      }),
    ).rejects.toThrow(/Could not resolve to a User/);
  });

  it("throws when the user has no contribution data", async () => {
    await expect(
      fetchContributions({
        username: "octocat",
        githubToken: "fake-token",
        fetchImpl: mockFetch({ data: { user: null } }),
      }),
    ).rejects.toThrow(/No contribution data/);
  });

  it("throws when no GitHub token is provided", async () => {
    await expect(
      fetchContributions({
        username: "octocat",
        githubToken: "",
        fetchImpl: mockFetch({}),
      }),
    ).rejects.toThrow(/token/);
  });
});
