/**
 * Turning a pile of Polymarket markets into a week's NFL slate.
 *
 * Two jobs: throw away everything that isn't a single game this week, and
 * group what's left by matchup so each game shows its moneyline, spread and
 * total together.
 *
 * Pure functions. No I/O.
 */

import type { PolyMarket, MarketOutcome } from "./polymarket.ts";
import { weekOfKickoff } from "./week.ts";

export type BoardMarketKind = "moneyline" | "spread" | "total";

export type Game = {
  key: string;
  /**
   * The two sides, in the order the market listed them. When `separator` is
   * "@" the first really is the visitor; when it is "vs" the source did not
   * say, so the board prints "A vs B" rather than inventing a home team.
   */
  away: string;
  home: string;
  separator: "@" | "vs";
  kickoff: Date | null;
  moneyline: MarketOutcome[] | null;
  spread: MarketOutcome[] | null;
  total: MarketOutcome[] | null;
};

/**
 * Futures, awards, and season-long props. None of these are a game, so none of
 * them belong on a weekly board.
 */
const FUTURES = [
  "super bowl", "conference", "division", "playoff", "mvp", "rookie of the year",
  "coach of the year", "season", "win total", "make the playoffs", "draft",
  "any team", "any player", "most ", "leader", "champion", "to reach",
  "first team to", "how many", "which team", "who will win the",
];

/** A market whose subject is a single game between two named teams. */
export function isGameMarket(question: string): boolean {
  const q = question.toLowerCase();
  if (FUTURES.some((f) => q.includes(f))) return false;
  // A game market names both sides.
  return / vs\.? | @ | at /.test(q);
}

/** What kind of bet a market is, from how it's worded. */
export function classify(question: string): BoardMarketKind {
  const q = question.toLowerCase();
  if (/\btotal\b|over\/under|\bo\/u\b|combined (points|score)/.test(q)) {
    return "total";
  }
  if (/\bspread\b|\bcover\b|handicap|[+-]\d+(\.5)?\b/.test(q)) return "spread";
  return "moneyline";
}

/**
 * The two teams, in the order the market lists them.
 *
 * "Chiefs @ Broncos" and "Chiefs vs Broncos" both give [Chiefs, Broncos].
 * With "@" or "at" the first team is the visitor, which is how the board
 * labels them.
 */
export function extractTeams(
  question: string,
): { away: string; home: string; separator: "@" | "vs" } | null {
  // Drop any trailing clause: "Chiefs vs Broncos: who wins?" -> "Chiefs vs Broncos"
  const subject = question.split(/[:?]/)[0].trim();

  const at = subject.match(/^(.+?)\s+(?:@|at)\s+(.+)$/i);
  if (at) {
    return { away: clean(at[1]), home: clean(at[2]), separator: "@" };
  }

  const vs = subject.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (vs) {
    // "A vs B" says nothing about who is at home. Keep the order given and
    // print it back the same way rather than guessing.
    return { away: clean(vs[1]), home: clean(vs[2]), separator: "vs" };
  }

  return null;
}

/**
 * Words that describe the bet rather than the team, and which trail the team
 * name in a question like "Chiefs @ Broncos total points".
 */
const DESCRIPTORS = new Set([
  "the", "nfl", "game", "matchup", "moneyline", "ml", "spread", "spreads",
  "total", "totals", "points", "point", "score", "scoring", "odds", "line",
  "lines", "winner", "wins", "win", "cover", "handicap", "over", "under",
  "o/u", "week", "vs", "at",
]);

/**
 * Strip the market description off the end of a team name.
 *
 * Only trailing words are removed, one at a time, so a team whose own name
 * contains such a word is safe -- "Kansas City Chiefs" keeps every word,
 * because the stripping stops at the first word that isn't a descriptor.
 */
function clean(name: string): string {
  const words = name.trim().split(/\s+/);
  while (words.length > 1) {
    const last = words[words.length - 1].toLowerCase().replace(/[^a-z0-9/.+-]/g, "");
    // Numbers and prices are part of the market, not the team.
    const isNumeric = /^[+-]?\d+(\.\d+)?$/.test(last);
    // A slashed token like "over/under" is a descriptor when every part is.
    const slashed =
      last.includes("/") &&
      last.split("/").every((part) => part !== "" && DESCRIPTORS.has(part));

    if (DESCRIPTORS.has(last) || isNumeric || slashed || last === "") words.pop();
    else break;
  }
  return words.join(" ").replace(/\s{2,}/g, " ").trim();
}

/** Both team names, order-independent, so the three markets group together. */
function gameKey(away: string, home: string): string {
  return [away.toLowerCase(), home.toLowerCase()].sort().join("|");
}

/**
 * Build the board for one week.
 *
 * Markets are kept only if they describe a single game whose kickoff falls in
 * that week. A market with no end date can't be placed in a week, so it is
 * left out rather than guessed at.
 */
export function buildBoard(markets: PolyMarket[], week: number): Game[] {
  const games = new Map<string, Game>();

  for (const market of markets) {
    if (!isGameMarket(market.question)) continue;

    const teams = extractTeams(market.question);
    if (!teams) continue;

    const kickoff = market.endDate ? new Date(market.endDate) : null;
    if (!kickoff || Number.isNaN(kickoff.getTime())) continue;
    if (weekOfKickoff(kickoff) !== week) continue;

    const key = gameKey(teams.away, teams.home);
    let game = games.get(key);
    if (!game) {
      game = {
        key,
        away: teams.away,
        home: teams.home,
        separator: teams.separator,
        kickoff,
        moneyline: null,
        spread: null,
        total: null,
      };
      games.set(key, game);
    }

    // Earliest known kickoff wins -- some markets close later than the game.
    if (kickoff && (!game.kickoff || kickoff < game.kickoff)) game.kickoff = kickoff;

    // "@" states who is at home; "vs" does not. If any wording of this game
    // uses "@", prefer it and take its ordering.
    if (game.separator === "vs" && teams.separator === "@") {
      game.away = teams.away;
      game.home = teams.home;
      game.separator = "@";
    }

    const kind = classify(market.question);
    // First market of a kind wins; they arrive busiest-first, so that is the
    // most liquid one.
    if (game[kind] === null) game[kind] = market.outcomes;
  }

  return [...games.values()].sort((a, b) => {
    if (a.kickoff && b.kickoff) return a.kickoff.getTime() - b.kickoff.getTime();
    return a.away.localeCompare(b.away);
  });
}
