/**
 * What week is it?
 *
 * The league runs on a fixed schedule rather than asking Sleeper, so the site
 * always agrees with itself:
 *
 *   - Week 1 runs until 3am Eastern on Tuesday 15 September 2026.
 *   - At that moment it becomes week 2.
 *   - Every Tuesday at 3am Eastern after that, the week ticks over.
 *
 * 3am Tuesday is chosen so Monday Night Football is long finished. Everything
 * below is computed in Eastern *calendar* terms, not by adding seven days to a
 * fixed instant, so the rollover stays at 3am local when daylight saving ends
 * in November instead of drifting to 2am.
 */

/**
 * Next season, change these two rather than editing the code:
 *
 *   LEAGUE_SEASON=2027
 *   LEAGUE_WEEK2_DATE=2027-09-14      (the Tuesday week 2 starts)
 */
export const SEASON = Number(process.env.LEAGUE_SEASON) || 2026;
export const TIMEZONE = "America/New_York";
export const LAST_WEEK = 18;

/** The Tuesday on which week 2 begins, as a plain Eastern calendar date. */
const WEEK_2_DATE = parseAnchor(process.env.LEAGUE_WEEK2_DATE) ?? {
  year: 2026,
  month: 9,
  day: 15,
};

function parseAnchor(
  value: string | undefined,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value?.trim() ?? "");
  if (!match) return null;
  const [, year, month, day] = match;
  return { year: Number(year), month: Number(month), day: Number(day) };
}

/** The hour (Eastern) at which the week ticks over. */
const ROLLOVER_HOUR = 3;

export type WeekContext = { season: number; week: number };

/** Eastern-time calendar fields for an instant. */
function easternParts(now: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
} {
  // en-CA formats as YYYY-MM-DD, which is easy to take apart.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
  };
}

/** Whole days between two calendar dates, ignoring time of day entirely. */
function daysBetween(
  from: { year: number; month: number; day: number },
  to: { year: number; month: number; day: number },
): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Which week the league is on at a given instant.
 *
 * Before 3am Eastern the day still counts as the previous one, so 1am Tuesday
 * is the tail end of the old week rather than the start of the new one.
 */
export function weekAt(now: Date): number {
  const et = easternParts(now);

  // Roll the calendar day back when we are in the small hours.
  let leagueDay = { year: et.year, month: et.month, day: et.day };
  if (et.hour < ROLLOVER_HOUR) {
    const previous = new Date(
      Date.UTC(leagueDay.year, leagueDay.month - 1, leagueDay.day) - 86_400_000,
    );
    leagueDay = {
      year: previous.getUTCFullYear(),
      month: previous.getUTCMonth() + 1,
      day: previous.getUTCDate(),
    };
  }

  const elapsed = daysBetween(WEEK_2_DATE, leagueDay);
  if (elapsed < 0) return 1; // still in week 1

  const week = 2 + Math.floor(elapsed / 7);
  return Math.min(week, LAST_WEEK);
}

/** Current season and week. */
export function currentWeek(now: Date = new Date()): WeekContext {
  return { season: SEASON, week: weekAt(now) };
}

/** Clamp a week number that came in from a URL or a form. */
export function normaliseWeek(value: unknown, fallback: number): number {
  const week = Number(value);
  if (!Number.isInteger(week) || week < 1 || week > LAST_WEEK) return fallback;
  return week;
}
