import { describe, expect, it } from "vitest";
import { activeSummary, dailySummary, sourcesSummary, weeklySummary } from "./settingsSummary";

describe("settings summaries", () => {
  it("word the podcast rows as the build and the saved overlay both show them", () => {
    expect(dailySummary({ hour: 9, cadenceDays: 2 })).toBe("Every other day at 9");
    // The zone is named only when it is not Stockholm's.
    expect(dailySummary({ hour: 9, cadenceDays: 2, timezone: "Europe/Stockholm" })).toBe(
      "Every other day at 9",
    );
    expect(weeklySummary({ day: 1, hour: 19, timezone: "Asia/Kolkata" })).toBe(
      "Mondays at 19 (India)",
    );
    expect(dailySummary({ hour: 7, cadenceDays: 5 })).toBe("Every 5 days at 7");
  });

  // 2026-11-08: the Weekly switch was off and its row still read "Sundays at 8", so nothing on the list
  // told the owner no weekly would air.
  it("do not word a switched-off podcast as when it airs", () => {
    const weekly = { day: 0, hour: 8 };
    expect(weeklySummary({ ...weekly, enabled: false })).not.toBe(weeklySummary(weekly));
    expect(weeklySummary({ ...weekly, enabled: false })).toBe(
      weeklySummary({ ...weekly, hour: 9, enabled: false }),
    );
    const daily = { hour: 7, cadenceDays: 2 };
    expect(dailySummary({ ...daily, enabled: false })).not.toBe(dailySummary(daily));
    expect(dailySummary({ ...daily, enabled: false })).toBe(
      dailySummary({ ...daily, hour: 8, enabled: false }),
    );
  });

  it("say how many of a topic's sources are active", () => {
    expect(activeSummary(3, 3)).toBe("3 sources active");
    expect(activeSummary(3, 2)).toBe("2 of 3 sources active");
    expect(activeSummary(1, 1)).toBe("1 source active");
  });

  it("count every source, on or off", () => {
    expect(sourcesSummary({ total: 11 })).toBe("11 sources");
    expect(sourcesSummary({ total: 0 })).toBe("No sources yet");
    expect(sourcesSummary({ total: 2, never: true })).toBe("Never in a podcast");
  });
});
