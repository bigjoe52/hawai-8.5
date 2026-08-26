# 🌺 Hawaii Fantasy League

A private site for a ten-person fantasy football league:

- **One league-wide 10-leg parlay every week.** Everybody contributes exactly
  one NFL leg. All ten have to hit. When one busts, the site says whose it was.
- **Head-to-head side bets on the fantasy matchups.** Post a price, somebody
  takes the other side, the commissioner settles it.
- **A ledger** that nets everything down to one number per pair of players.

Money is tracked, never moved. The site is the agreed-upon record; you settle
up over Venmo like always.

---

## Getting it online

You need two free accounts: [Vercel](https://vercel.com) (hosting) and a
Postgres database. Vercel can create the database for you, so really it's one.

### 1. Push this repo to GitHub

Already done if you're reading this on GitHub.

### 2. Import it into Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and pick this repository.
2. Leave the framework preset (Next.js), root directory, and build settings
   exactly as detected — they're already right.
3. Expand **Environment Variables**. Vercel pre-fills three names it found in
   `.env.example`, with the placeholder values:
   - **`DATABASE_URL` — delete it, or leave it blank.** This matters. If you
     save the placeholder, adding a Postgres store later will not overwrite
     it, and the site will keep trying to reach a database host called
     `host`. Leave it unset and step 3 fills it in for you.
   - `SESSION_SECRET` — paste a real random value (command below).
   - `SLEEPER_LEAGUE_ID` — your league ID, or blank for now.
4. Click **Deploy**.

The deploy will **succeed** — every page is server-rendered on demand, so
nothing touches the database at build time. But visiting the site will throw a
runtime error until you add the database in the next step. That's expected.

### 3. Add a database

1. In your new Vercel project: **Storage → Create Database → Postgres**.
2. **Pick Neon** if you're offered a choice of providers. Any Postgres works —
   see below — but Neon is the path of least resistance on Vercel.
3. Accept the defaults and connect it to the project.

The integration sets the connection string for you. You do not need to copy
or rename anything.

**Any Postgres host works.** The app looks for the connection string under
`DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, and a few other common
names, so it doesn't matter which provider you choose or what they call it.
See `src/lib/db-url.ts`.

**Pooled connections are preferred.** If a provider offers both, the pooled
string (its host usually contains `-pooler`) is the one to use — serverless
functions can otherwise exhaust the database's connection limit. The app picks
the pooled variable automatically when both are present, and logs a warning if
it has to fall back to a direct connection.

**Placeholders count as unset.** If you paste the `.env.example` sample value
(`postgresql://user:password@host/dbname`) anywhere, the app ignores it and
tells you the variable is missing — rather than failing with a confusing DNS
error for a host named `host`.

### 4. Add the other two environment variables

**Settings → Environment Variables**:

| Name | Value |
| --- | --- |
| `SESSION_SECRET` | A long random string — generate one with the command below |
| `SLEEPER_LEAGUE_ID` | Your league's ID (see below) |

Generate the secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Finding your Sleeper league ID:** open your league on sleeper.com and look at
the URL — `https://sleeper.com/leagues/`**`123456789012345678`**`/team`. That
number is the ID.

### 5. Create the tables and the accounts

On your own machine:

```bash
git clone <this repo> && cd hawai-8.5
npm install

# Pull the environment variables down from Vercel
npx vercel link
npx vercel env pull .env.local

npm run db:setup    # creates the tables
npm run db:seed     # creates the accounts and prints their passwords
```

`db:seed` prints ten usernames and passwords **once**. Copy them somewhere
before you close the terminal, then hand them out.

**Before you run it**, open `scripts/seed-users.mjs` and edit the `LEAGUE` list
to your actual guys. Set `admin: true` on yourself — the commissioner is the
one who can lock weeks, grade legs, and settle side bets.

### 6. Redeploy

Back in Vercel, hit **Redeploy** so the app picks up `DATABASE_URL`. Done —
your league is live.

---

## Running the site week to week

**Everyone:**
1. Sign in, go to **Parlay**, add one leg with its odds (`-110`, `+250`).
2. Go to **Side Bets** to post a bet or take somebody else's.

**The commissioner:**
1. Before kickoff: **Commissioner → Mark locked**. Legs freeze.
2. Set the buy-in per person so the site can show the payout.
3. After the games: grade each leg win/loss/push, and settle the matched
   side bets.
4. The ledger updates itself.

---

## Handy commands

```bash
npm run dev        # local dev server at http://localhost:3000
npm run build      # production build
npm test           # unit tests for the betting and ledger math
npm run db:setup   # create tables (safe to re-run)
npm run db:seed    # add any new members from the LEAGUE list
node scripts/seed-users.mjs --reset joe   # reset one person's password
```

### Adding an 11th member later

Add them to the `LEAGUE` list in `scripts/seed-users.mjs`, then run
`npm run db:seed`. Existing accounts are skipped, so nobody's password changes.

---

## How it's put together

```
src/
  app/                 pages (Next.js App Router)
    page.tsx           dashboard
    login/             sign-in
    parlay/            the weekly 10-leg ticket
    side-bets/         post and take head-to-head bets
    ledger/            standings and who-owes-who
    admin/             commissioner tools
  lib/
    odds.ts            American odds, parlay payout math   <- unit tested
    ledger.ts          netting out who owes who            <- unit tested
    crypto.ts          password hashing, session tokens    <- unit tested
    sleeper.ts         read-only Sleeper API client        <- unit tested
    auth.ts            login, session cookies
    db.ts              Postgres connection + query helper
    db-url.ts          finds the connection string, any provider  <- unit tested
    queries.ts         database reads
    actions.ts         database writes (all of them)
    week.ts            what NFL week is it
db/schema.sql          the tables
scripts/               setup and seeding
tests/                 unit tests
```

### A few deliberate decisions

**Money is stored as integer cents, never floats.** `0.1 + 0.2 !== 0.3` in
binary floating point, and that error compounds over a season. Every dollar
figure is an integer until the moment it's displayed.

**The rules are enforced in the database, not just the UI.** `UNIQUE (parlay_id,
user_id)` is what actually makes "one leg per person" true. Check constraints
stop a settled bet without a winner, a zero-dollar stake, or someone taking
their own bet. A hidden button is not a rule.

**Every write re-checks permissions on the server.** Hiding the Commissioner
link from non-admins is a convenience; `src/app/admin/page.tsx` and every
admin action check again. Deleting a leg checks `user_id = you`.

**Taking a bet is race-safe.** Two people clicking "take the other side" at the
same instant both run `UPDATE ... WHERE status = 'open'`. Only one matches a
row. The other changes nothing instead of overwriting the first.

**Sleeper is read-only and fails soft.** Sleeper's public API needs no key, but
it can only be read from — bets live in our database. If Sleeper is slow or
down, those sections show a notice and the rest of the site works normally.

---

## Why this isn't on GitHub Pages

GitHub Pages serves static files only — no server, no database. That breaks
the two things this site is built on:

- **Login.** A password check written in browser JavaScript is visible to
  anyone who opens view-source. That isn't weak security, it's none.
- **Shared data.** Ten people writing legs and bets that the other nine can
  see needs somewhere central to write to.

Since real money is tracked here, the concern isn't hackers — it's that
nobody can quietly edit a leg after kickoff or nudge the ledger. Vercel's free
tier gives you a real server and a real database, and deploys from the same
`git push`.

## Cost

Free. Vercel's Hobby tier and a starter Postgres database both cover ten
people comfortably. There is nothing to pay and no card required.
