"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "./db.ts";
import {
  authenticate,
  getCurrentUser,
  setSessionCookie,
  clearSessionCookie,
} from "./auth.ts";
import { parseStakeToCents } from "./odds.ts";
import { winningsFor } from "./lines.ts";
import { autoSettleFinishedWeeks } from "./settle.ts";

/**
 * Every write to the database goes through this file.
 *
 * Two rules hold everywhere below:
 *   1. Re-check who the user is on the SERVER. Anything the browser sends can
 *      be faked, including hidden form fields.
 *   2. Re-check the current state before writing, so two people clicking at
 *      the same time cannot both win the race.
 */

export type ActionResult = { error?: string; ok?: string };

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

async function requireAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) {
    throw new Error("Only the commissioner can do that.");
  }
  return user;
}

/* -------------------------------------------------------------------------
 * Login / logout
 * ---------------------------------------------------------------------- */

export async function loginAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { error: "Enter your username and password." };
  }

  const user = await authenticate(username, password);
  if (!user) {
    // Deliberately vague: do not reveal whether the username exists.
    return { error: "Wrong username or password." };
  }

  await setSessionCookie(user.id);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

/* -------------------------------------------------------------------------
 * Parlay legs
 * ---------------------------------------------------------------------- */

/**
 * Add or replace your one leg in this week's parlay.
 *
 * The database has UNIQUE (parlay_id, user_id), so "one leg per person" is
 * enforced by Postgres itself, not just by the UI hiding a button.
 */
export async function submitLegAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const parlayId = Number(formData.get("parlayId"));
  const description = String(formData.get("description") ?? "").trim();
  const rawOdds = String(formData.get("odds") ?? "").trim();

  if (!Number.isInteger(parlayId)) return { error: "Bad parlay." };
  if (description.length < 3) {
    return { error: "Describe your leg, e.g. \"Chiefs -3.5 vs Broncos\"." };
  }
  if (description.length > 200) {
    return { error: "Keep the leg under 200 characters." };
  }

  const odds = Number(rawOdds.replace(/^\+/, ""));
  if (!Number.isInteger(odds) || (odds > -100 && odds < 100)) {
    return {
      error: "Odds must be American format, like -110 or +250.",
    };
  }

  // Never trust the client about whether the week is still open.
  const [parlay] = await sql`SELECT status FROM parlays WHERE id = ${parlayId}`;
  if (!parlay) return { error: "That week does not exist." };
  if (parlay.status !== "open") {
    return { error: "This week's parlay is locked. Legs can't change now." };
  }

  await sql`
    INSERT INTO parlay_legs (parlay_id, user_id, description, odds_american)
    VALUES (${parlayId}, ${user.id}, ${description}, ${odds})
    ON CONFLICT (parlay_id, user_id) DO UPDATE
      SET description = EXCLUDED.description,
          odds_american = EXCLUDED.odds_american,
          updated_at = NOW()
  `;

  revalidatePath("/parlay");
  revalidatePath("/");
  return { ok: "Your leg is in." };
}

export async function deleteLegAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const legId = Number(formData.get("legId"));

  // The user_id check in the WHERE clause is what stops someone deleting
  // another player's leg by editing the form.
  await sql`
    DELETE FROM parlay_legs
    WHERE id = ${legId}
      AND user_id = ${user.id}
      AND parlay_id IN (SELECT id FROM parlays WHERE status = 'open')
  `;
  revalidatePath("/parlay");
}

/* -------------------------------------------------------------------------
 * Commissioner: lock and grade the parlay
 * ---------------------------------------------------------------------- */

export async function setParlayStatusAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parlayId = Number(formData.get("parlayId"));
  const status = String(formData.get("status"));

  if (!["open", "locked", "won", "lost"].includes(status)) {
    throw new Error("Unknown parlay status.");
  }

  await sql`
    UPDATE parlays
    SET status = ${status},
        locked_at = CASE WHEN ${status} = 'locked' THEN NOW() ELSE locked_at END
    WHERE id = ${parlayId}
  `;
  revalidatePath("/parlay");
  revalidatePath("/admin");
}

export async function setStakeAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const parlayId = Number(formData.get("parlayId"));
  const raw = String(formData.get("stake") ?? "0");

  let cents: number;
  try {
    cents = parseStakeToCents(raw);
  } catch {
    return; // invalid input, leave the stake alone
  }

  await sql`
    UPDATE parlays SET stake_cents = ${cents} WHERE id = ${parlayId}
  `;
  revalidatePath("/parlay");
  revalidatePath("/admin");
}

export async function gradeLegAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const legId = Number(formData.get("legId"));
  const status = String(formData.get("status"));

  if (!["pending", "win", "loss", "push"].includes(status)) {
    throw new Error("Unknown leg result.");
  }

  await sql`
    UPDATE parlay_legs
    SET status = ${status},
        graded_by = ${admin.id},
        graded_at = ${status === "pending" ? null : new Date().toISOString()},
        updated_at = NOW()
    WHERE id = ${legId}
  `;
  revalidatePath("/parlay");
  revalidatePath("/admin");
}

/* -------------------------------------------------------------------------
 * Side bets
 * ---------------------------------------------------------------------- */

export async function postSideBetAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();

  const season = Number(formData.get("season"));
  const week = Number(formData.get("week"));
  const title = String(formData.get("title") ?? "").trim();
  const details = String(formData.get("details") ?? "").trim();
  const proposerSide = String(formData.get("proposerSide") ?? "").trim();
  const takerSide = String(formData.get("takerSide") ?? "").trim();
  const matchupId = String(formData.get("matchupId") ?? "").trim();

  if (!title) return { error: "Give the bet a title." };
  if (!proposerSide || !takerSide) {
    return { error: "Spell out both sides so there's no argument later." };
  }
  if (title.length > 140) return { error: "Title is too long." };

  let stakeCents: number;
  try {
    stakeCents = parseStakeToCents(String(formData.get("stake") ?? ""));
  } catch {
    return { error: "Enter the stake as a dollar amount, like 20 or 12.50." };
  }
  if (stakeCents <= 0) return { error: "Stake has to be more than zero." };

  // A bet somebody typed out is settled straight up: loser pays the stake.
  await sql`
    INSERT INTO side_bets
      (season, week, proposer_id, title, details, proposer_side, taker_side,
       stake_cents, taker_stake_cents, sleeper_matchup_id)
    VALUES
      (${season}, ${week}, ${user.id}, ${title}, ${details || null},
       ${proposerSide}, ${takerSide}, ${stakeCents}, ${stakeCents},
       ${matchupId || null})
  `;

  revalidatePath("/side-bets");
  revalidatePath("/");
  return { ok: "Bet posted. Now someone has to take it." };
}

/**
 * Take the other side of an open bet.
 *
 * The `status = 'open'` condition inside the UPDATE is the important part: if
 * two people click "take it" at the same moment, only the first UPDATE matches
 * a row. The second one changes nothing and gets told it was already taken.
 */
export async function takeSideBetAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const betId = Number(formData.get("betId"));

  await sql`
    UPDATE side_bets
    SET taker_id = ${user.id}, status = 'matched', taken_at = NOW()
    WHERE id = ${betId}
      AND status = 'open'
      AND proposer_id <> ${user.id}
  `;

  revalidatePath("/side-bets");
  revalidatePath("/");
}

/** Pull back a bet nobody has taken yet. Only the person who posted it can. */
export async function cancelSideBetAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const betId = Number(formData.get("betId"));

  await sql`
    DELETE FROM side_bets
    WHERE id = ${betId} AND proposer_id = ${user.id} AND status = 'open'
  `;
  revalidatePath("/side-bets");
}

export async function settleSideBetAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const betId = Number(formData.get("betId"));
  const winner = String(formData.get("winner"));

  if (!["proposer", "taker", "push"].includes(winner)) {
    throw new Error("Pick a winner.");
  }

  // A push moves no money, so it is recorded as void. Everything else lands in
  // 'unpaid': the result is known, but nobody has handed over any money yet.
  const status = winner === "push" ? "void" : "unpaid";

  await sql`
    UPDATE side_bets
    SET winner = ${winner}, status = ${status},
        settled_by = ${admin.id}, settled_at = NOW()
    WHERE id = ${betId} AND status = 'matched'
  `;

  revalidatePath("/side-bets");
  revalidatePath("/ledger");
  revalidatePath("/admin");
}

/**
 * Post one of the generated lines as a side bet.
 *
 * Same rules as a hand-written bet -- it just arrives pre-filled from the
 * projections instead of being typed out. The odds are carried on the title so
 * the price is part of the record, since side bets settle at even money
 * between two people.
 */
export async function postLineBetAction(formData: FormData): Promise<void> {
  const user = await requireUser();

  const season = Number(formData.get("season"));
  const week = Number(formData.get("week"));
  const title = String(formData.get("title") ?? "").trim();
  const proposerSide = String(formData.get("proposerSide") ?? "").trim();
  const takerSide = String(formData.get("takerSide") ?? "").trim();
  const matchupId = String(formData.get("matchupId") ?? "").trim();
  const rawStake = String(formData.get("stake") ?? "");
  const rawOdds = String(formData.get("odds") ?? "").trim();

  // Market details, so this bet can grade itself once the games are done.
  const marketKind = String(formData.get("marketKind") ?? "").trim();
  const proposerPick = String(formData.get("proposerPick") ?? "").trim();
  const lineValue = Number(formData.get("lineValue"));
  const homeRosterId = Number(formData.get("homeRosterId"));
  const awayRosterId = Number(formData.get("awayRosterId"));
  const subjectRosterId = Number(formData.get("subjectRosterId"));

  const gradeable =
    ["moneyline", "spread", "total", "team_total"].includes(marketKind) &&
    ["home", "away", "over", "under"].includes(proposerPick) &&
    Number.isFinite(lineValue) &&
    Number.isInteger(homeRosterId) &&
    Number.isInteger(awayRosterId);

  if (!title || !proposerSide || !takerSide) return;
  if (!Number.isInteger(season) || !Number.isInteger(week)) return;

  let stakeCents: number;
  try {
    stakeCents = parseStakeToCents(rawStake);
  } catch {
    return;
  }
  if (stakeCents <= 0) return;

  // Priced bets are not even money: whatever the proposer stands to win is
  // exactly what the taker is risking. Straight-up bets carry no odds, so both
  // sides put up the same amount.
  const odds = rawOdds === "" ? null : Number(rawOdds);
  const priced = odds !== null && Number.isInteger(odds) && (odds <= -100 || odds >= 100);
  const takerStakeCents = priced
    ? winningsFor(odds as number, stakeCents)
    : stakeCents;

  await sql`
    INSERT INTO side_bets
      (season, week, proposer_id, title, details, proposer_side, taker_side,
       stake_cents, taker_stake_cents, sleeper_matchup_id,
       market_kind, line_value, proposer_pick,
       home_roster_id, away_roster_id, subject_roster_id)
    VALUES
      (${season}, ${week}, ${user.id}, ${title},
       ${"Line generated from Sleeper projections."},
       ${proposerSide}, ${takerSide}, ${stakeCents}, ${takerStakeCents},
       ${matchupId || null},
       ${gradeable ? marketKind : null},
       ${gradeable ? lineValue : null},
       ${gradeable ? proposerPick : null},
       ${gradeable ? homeRosterId : null},
       ${gradeable ? awayRosterId : null},
       ${gradeable && Number.isInteger(subjectRosterId) ? subjectRosterId : null})
  `;

  revalidatePath("/side-bets");
  revalidatePath("/");
}

/* -------------------------------------------------------------------------
 * Payment
 * ---------------------------------------------------------------------- */

/**
 * Mark a bet paid.
 *
 * Only the person who is owed the money can confirm it arrived -- the loser
 * saying "I paid you" is not the same thing. The commissioner can also mark
 * it, for when somebody settles up in person and forgets.
 *
 * The `status = 'unpaid'` condition makes this idempotent: a second click
 * changes nothing.
 */
export async function markPaidAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const betId = Number(formData.get("betId"));
  if (!Number.isInteger(betId)) return;

  await sql`
    UPDATE side_bets
    SET status = 'paid', paid_at = NOW(), paid_by = ${user.id}
    WHERE id = ${betId}
      AND status = 'unpaid'
      AND (
        ${user.isAdmin}
        OR (winner = 'proposer' AND proposer_id = ${user.id})
        OR (winner = 'taker'    AND taker_id    = ${user.id})
      )
  `;

  revalidatePath("/side-bets");
  revalidatePath("/ledger");
  revalidatePath("/");
}

/** Undo a payment mark, for when somebody clicks it by mistake. */
export async function markUnpaidAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const betId = Number(formData.get("betId"));
  if (!Number.isInteger(betId)) return;

  await sql`
    UPDATE side_bets
    SET status = 'unpaid', paid_at = NULL, paid_by = NULL
    WHERE id = ${betId}
      AND status = 'paid'
      AND (
        ${user.isAdmin}
        OR (winner = 'proposer' AND proposer_id = ${user.id})
        OR (winner = 'taker'    AND taker_id    = ${user.id})
      )
  `;

  revalidatePath("/side-bets");
  revalidatePath("/ledger");
}

/** Commissioner: grade everything that can be graded, on demand. */
export async function autoSettleAction(): Promise<void> {
  await requireAdmin();
  await autoSettleFinishedWeeks(18);
  revalidatePath("/side-bets");
  revalidatePath("/ledger");
  revalidatePath("/admin");
}
