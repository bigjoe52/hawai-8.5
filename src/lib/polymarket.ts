/**
 * Read-only client for Polymarket's public Gamma API.
 *
 * No account, no key, no request signing -- it is open JSON. Prices come back
 * as probabilities between 0 and 1, which convert cleanly to the American odds
 * the rest of the app already speaks.
 *
 * Every function fails soft. If Polymarket is unreachable or changes shape,
 * the parlay page falls back to typing legs in by hand.
 */

import { probabilityToAmerican } from "./lines.ts";

const BASE = process.env.POLYMARKET_API_BASE ?? "https://gamma-api.polymarket.com";
const TIMEOUT_MS = 8000;

export type MarketOutcome = {
  label: string;
  /** Implied probability, 0-1. */
  probability: number;
  /** The same thing as American odds, for display. */
  odds: number;
};

export type PolyMarket = {
  id: string;
  question: string;
  slug: string;
  endDate: string | null;
  outcomes: MarketOutcome[];
  /** Rough activity measure, used to put the interesting games first. */
  volume: number;
};

export type PolyResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function get<T>(path: string): Promise<PolyResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      // Odds move, but not so fast that a league site needs them by the second.
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return { ok: false, error: `Polymarket returned HTTP ${res.status}` };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Could not reach Polymarket (${reason}). You can still type legs in by hand.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gamma sends `outcomes` and `outcomePrices` as JSON-encoded STRINGS rather
 * than arrays -- `"[\"Yes\", \"No\"]"` -- which is the single most likely thing
 * to break a naive integration. Accept either form.
 */
export function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Turn one Gamma market row into something the parlay page can show. */
export function parseMarket(row: unknown): PolyMarket | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;

  const question = typeof r.question === "string" ? r.question : null;
  if (!question) return null;

  const labels = parseJsonArray(r.outcomes);
  const prices = parseJsonArray(r.outcomePrices);
  if (labels.length === 0 || labels.length !== prices.length) return null;

  const outcomes: MarketOutcome[] = [];
  for (let i = 0; i < labels.length; i++) {
    const probability = Number(prices[i]);
    // A market at 0 or 1 has already resolved; there is nothing to bet.
    if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
      continue;
    }
    outcomes.push({
      label: labels[i],
      probability,
      odds: probabilityToAmerican(probability),
    });
  }
  if (outcomes.length < 2) return null;

  return {
    id: String(r.id ?? r.conditionId ?? question),
    question,
    slug: typeof r.slug === "string" ? r.slug : "",
    endDate: typeof r.endDate === "string" ? r.endDate : null,
    outcomes,
    volume: Number(r.volume) || 0,
  };
}

/** Markets can arrive as a bare array, or nested inside events. */
export function parseMarkets(payload: unknown): PolyMarket[] {
  const rows: unknown[] = [];

  const collect = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const nested = (item as { markets?: unknown }).markets;
      if (Array.isArray(nested)) rows.push(...nested);
      else rows.push(item);
    }
  };

  if (Array.isArray(payload)) collect(payload);
  else if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    collect(obj.data ?? obj.markets ?? obj.events);
  }

  const out: PolyMarket[] = [];
  for (const row of rows) {
    const market = parseMarket(row);
    if (market) out.push(market);
  }

  // Busiest markets first -- those are the games people care about.
  return out.sort((a, b) => b.volume - a.volume);
}

/**
 * Live NFL markets.
 *
 * The tag slug is configurable because Polymarket reorganises its taxonomy
 * from time to time; if `nfl` stops matching, it can be changed without a
 * code edit.
 */
export async function getNflMarkets(limit = 60): Promise<PolyResult<PolyMarket[]>> {
  const tag = process.env.POLYMARKET_TAG ?? "nfl";
  const query = [
    `tag_slug=${encodeURIComponent(tag)}`,
    "closed=false",
    "active=true",
    `limit=${limit}`,
    "order=volume",
    "ascending=false",
  ].join("&");

  const res = await get<unknown>(`/events?${query}`);
  if (!res.ok) return res;

  const markets = parseMarkets(res.data);
  if (markets.length === 0) {
    return {
      ok: false,
      error:
        "Polymarket returned no open NFL markets. Out of season, or the tag has changed — see POLYMARKET_TAG.",
    };
  }
  return { ok: true, data: markets };
}
