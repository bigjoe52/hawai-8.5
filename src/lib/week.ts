import { getNflState } from "./sleeper.ts";

export type WeekContext = { season: number; week: number; fromSleeper: boolean };

/**
 * Which NFL week are we in?
 *
 * Sleeper tells us directly. If Sleeper can't be reached we fall back to a
 * rough calculation from the calendar, so the site still works -- it just
 * might be a week off during the offseason, which the UI notes.
 */
export async function currentWeek(): Promise<WeekContext> {
  const state = await getNflState();
  if (state.ok && state.data.week > 0) {
    return {
      season: Number(state.data.season),
      week: state.data.week,
      fromSleeper: true,
    };
  }
  return { ...estimateWeek(new Date()), fromSleeper: false };
}

/**
 * Fallback estimate. The NFL season starts the first Thursday after Labor Day;
 * approximating that as September 5th is close enough to land on the right
 * week almost always, and the UI shows a week picker anyway.
 */
export function estimateWeek(now: Date): { season: number; week: number } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed

  // Jan/Feb belong to the previous season (playoffs).
  const season = month <= 1 ? year - 1 : year;
  const kickoff = Date.UTC(season, 8, 5); // Sept 5
  const elapsedDays = Math.floor((now.getTime() - kickoff) / 86_400_000);

  if (elapsedDays < 0) return { season, week: 1 };
  const week = Math.floor(elapsedDays / 7) + 1;
  return { season, week: Math.min(Math.max(week, 1), 18) };
}
