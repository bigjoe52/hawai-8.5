import { resolveDatabaseUrl } from "./db-url.ts";

/**
 * Check that the app is configured before it tries to use anything.
 *
 * Without this, a missing variable surfaces as a bare 500 page in production,
 * with the actual reason buried in the hosting platform's logs. Since this is
 * exactly what goes wrong on a first deploy, the site says so on the page
 * instead.
 */

export type ConfigProblem = {
  variable: string;
  problem: string;
  fix: string;
};

export function configProblems(): ConfigProblem[] {
  const problems: ConfigProblem[] = [];

  if (!resolveDatabaseUrl()) {
    problems.push({
      variable: "DATABASE_URL",
      problem: "No database connection string is set.",
      fix:
        "Add a Postgres database under Storage in your hosting dashboard, " +
        "then redeploy so the new variable is picked up.",
    });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    problems.push({
      variable: "SESSION_SECRET",
      problem: "No session secret is set, so nobody can log in.",
      fix:
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" " +
        "then add it as an environment variable and redeploy.",
    });
  } else if (secret.length < 16) {
    problems.push({
      variable: "SESSION_SECRET",
      problem: `The session secret is only ${secret.length} characters long.`,
      fix: "It needs at least 16. Generate a longer one and redeploy.",
    });
  }

  return problems;
}

/** SLEEPER_LEAGUE_ID is genuinely optional -- the site works without it. */
export function sleeperConfigured(): boolean {
  return Boolean(process.env.SLEEPER_LEAGUE_ID?.trim());
}
