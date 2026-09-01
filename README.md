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

**A custom prefix is fine too.** If the integration offers a "custom prefix"
field, leaving it blank gives the standard names. If one does get set, the app
also matches prefixed variants like `STORAGE_DATABASE_URL`.

**Check the Development environment** when the integration asks which
environments to apply to. `vercel env pull` reads the Development environment,
so without it the connection string never reaches your machine and
`npm run db:setup` has nothing to connect to.

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
```

Now the app needs to know how to reach the database. **Copy the connection
string in by hand** — it is the shortest path and involves no extra tooling:

1. In Vercel: **your project → Settings → Environment Variables**
2. Find `DATABASE_URL`, reveal it, and copy the value
3. Create a file called `.env.local` in the project folder containing:

```
DATABASE_URL="paste-the-value-here"
```

Then:

```bash
npm run db:check    # confirms the connection works
npm run db:setup    # creates the tables
npm run db:seed     # creates the accounts and prints their passwords
```

`db:check` is worth running first — it reports exactly what is wrong
(unreachable host, bad password, missing tables) instead of failing obscurely
two commands later.

> `.env.local` is listed in `.gitignore`, so your credentials never get
> committed. Do not remove that line.

<details>
<summary>Optional: use the Vercel CLI instead of copying by hand</summary>

```bash
npx vercel login    # opens a browser to authorise this machine
npx vercel link     # connects this folder to the Vercel project
npx vercel env pull .env.local
```

This writes `.env.local` for you. It requires the **Development** environment
to be enabled on the database integration, otherwise the file comes back
without a connection string.

If the browser says *"Couldn't verify the code"*, the login code expired —
they are only valid for a few minutes. Press `Ctrl+C` in the terminal, run
`npx vercel login` again, and finish in the browser straight away.

</details>

`db:seed` prints ten usernames and passwords **once**. Copy them somewhere
before you close the terminal, then hand them out.

**Before you run it**, set up your roster:

```bash
cp league.roster.example.json league.roster.json
nano league.roster.json
```

Put your ten guys in it. Set `"admin": true` on yourself — the commissioner is
the one who can lock weeks, grade legs, and settle side bets.

`league.roster.json` is **gitignored on purpose**. Your names live outside the
tracked code, so a `git pull` can never collide with them. (An earlier version
kept the list inside `scripts/seed-users.mjs`, which meant any change to that
script fought with your edits.)

Because it is gitignored, it is *missing* in a fresh clone — so `db:seed`
refuses to run without it rather than quietly seeding the example names, which
would add ten strangers to your league and a second commissioner. If you
actually want the example names (a scratch database, a demo), ask for them:

```bash
npm run db:seed -- --placeholder
```

**You can also edit it afterwards.** Re-running `npm run db:seed` is safe and
does the sensible thing:

| You changed | What happens on re-run |
| --- | --- |
| A display name, or who is `admin` | Updated in place. Passwords untouched. |
| Added someone new | Account created, password printed. |
| Changed a username | Treated as a new person; the old account stays. |
| Removed someone | Reported, but kept. Add `--prune` to delete them. |

```bash
npm run db:seed -- --prune   # also delete accounts no longer in LEAGUE
```

`--prune` refuses to delete anyone who already has any history at all — parlay
legs, side bets on either side, weeks they placed the ticket, or anything they
graded, settled, or marked paid — since removing them would take that history
with them. It tells you who and why instead, and does the whole thing in one
transaction so a refusal leaves the database exactly as it was.

### 6. Redeploy

Back in Vercel, hit **Redeploy** so the app picks up `DATABASE_URL`. Done —
your league is live.

---

## Running the site week to week

**Everyone:**
1. Sign in, go to **Parlay**, add one leg with its odds (`-110`, `+250`).
2. Go to **Side Bets**. **The board** lists auto-generated lines for every
   fantasy matchup — moneyline, spread, game total, and each team's own total,
   priced from Sleeper's weekly projections. Click a side to put a $5 bet on
   the board. Or post your own from scratch below it.

**The commissioner:**
1. Before kickoff: **Commissioner → Mark locked**. Legs freeze.
2. After the games: grade each parlay leg win/loss/push. Side bets placed from
   the board settle themselves; only hand-written ones need you.
3. The ledger updates itself.

### Bets settle themselves
A bet placed from the board carries its market, its number, and which side was
taken, so once the week rolls over it grades from the final fantasy scores with
nobody pressing anything. It happens on page load, and the bet is marked
*settled automatically*.

A bet somebody typed out in their own words cannot be graded in code, so those
stay with the commissioner.

### Settling a side bet
**Either person in a bet can say who won** — they both watched the game, and
making a third person adjudicate was pure friction. The commissioner can still
settle anything, for when both of them have gone quiet. Bets placed from the
board don't need this at all: they grade themselves.

Settled it the wrong way? The commissioner gets a **Reopen** button on any bet
that has been settled but not yet paid. It puts the bet back to matched and
clears the winner, so it can be called again. Once someone has marked it paid,
it stays paid — that is a real-world event the site should not undo.

### Unpaid, then paid
A graded bet lands in **Unpaid** — the result is known, the money isn't moved.
Only the **winner** can mark it paid (or the commissioner, for when somebody
settles up in person). The loser saying "I paid you" is not the same thing.

Paid bets drop off the ledger's who-owes-who but stay in the standings: a win
is a win whether or not anybody has settled up.

### The parlay record
The ledger also carries a week-by-week parlay table — result, legs won, the
combined price, stake, what it returned, and whose leg busted it — plus the
season totals: record, staked, returned, net.

Below it sits **leg records**: everyone's season W-L on their own legs, their
hit rate, and their **solo busts** — weeks their leg was the only one that
lost, so the ticket was alive until they personally ended it. Ranked best
first; whoever is last gets labelled *worst in the league*, but only once they
have at least three decided legs, so nobody gets branded off one bad Sunday.

Nobody is expected to hit a ten-leg parlay. The running record is the point.

The parlay record is kept apart from who-owes-who deliberately. The weekly ticket is a group
bet against a sportsbook, not money moving between members, so mixing the two
would make both numbers meaningless.

### Tabs
Side bets are split into **Bets I can take** (open, posted by other people),
**My posted bets**, **Matched**, and **Finished**.

### The week
The site keeps its own schedule rather than asking Sleeper, so everyone always
sees the same week:

- Week 1 runs until **3am Eastern on Tuesday 15 September 2026**.
- Every **Tuesday at 3am Eastern** after that, the week ticks over.
- 3am Tuesday means Monday Night Football is long finished.
- It stops at week 18.

The parlay page still has a week selector for looking back at earlier weeks; it
just opens on the current one. To change the schedule, edit the constants at
the top of `src/lib/week.ts`.

### Bum of the week
Whoever scored **lowest** in week N places week N+1's ticket, and the site is
not subtle about it — a large, bright banner on the dashboard and the parlay
page:

> **🗑️ BUM OF THE WEEK**
> **Biz places the bet.**
> Score of 78.2 points last week. *(week 1, dead last)*

The bum gets a redder version reading **You place the bet.** Week 1 has nobody
to punish yet, so it is set with `LEAGUE_FIRST_PLACER` (a username). From then
on it works itself out from Sleeper's final scores.

This needs each member linked to their Sleeper account, under
**Commissioner → Sleeper accounts**. Do it once.

The link is stored as Sleeper's **`user_id`**, not a name. Sleeper exposes
three things per league member:

| Field | Changes? |
| --- | --- |
| `user_id` | **Never.** This is what we store. |
| `display_name` (the @handle) | Rarely, but it can |
| `metadata.team_name` | Constantly |

So renaming your team, or even your handle, doesn't break anything.

### The weekly NFL board
The parlay page shows **that week's NFL slate** — one row per game, with its
moneyline, spread and total side by side, in kickoff order. Prices come from
**Polymarket's public API** (no account, no key), converted from probabilities
to American odds. Click any line to use it as your leg; you can still edit it.

Only actual games appear. Futures, awards and season-long props — Super Bowl
winner, MVP, "will any team score 40+", season win totals — are filtered out,
and a game only shows in the week its kickoff falls in.

**Spreads generally won't appear.** Polymarket is a prediction market, not a
book: it lists binary outcomes, so a balanced −110 spread isn't a natural
product there. The spread column only renders if at least one game actually
has one, rather than showing a column of *not offered*.

The commissioner sees a line under the board accounting for every market
fetched — how many were priced for this week, how many belonged to other
weeks, how many were futures. If the board ever looks short, that says why.

Where Polymarket words a game as "A @ B" the board keeps the home side; where
it says "A vs B" the board prints it back the same way rather than guessing
who is at home. Markets that have already resolved are dropped.

If Polymarket is unreachable the board says so and you type legs in by hand,
same as before.

### The stake
Each week's parlay is a flat **$10 ticket** for the league — not a per-person
buy-in, and there is no pot. It resets every week; a new ticket opens
automatically. The commissioner can change a given week's stake under
**Commissioner**.

---

## Handy commands

```bash
npm run dev        # local dev server at http://localhost:3000
npm run build      # production build
npm test           # unit tests for the betting and ledger math
npm run db:check   # is the database reachable, and set up?
npm run db:setup   # create tables (safe to re-run)
npm run db:seed    # add any new members from league.roster.json
npm run db:backup  # dump the league to backups/
node scripts/seed-users.mjs --reset joe    # reset one person's password
npm run db:seed -- --prune                # drop accounts no longer in the roster
npm run db:restore -- backups/2026-09-08.json           # dry run
npm run db:restore -- backups/2026-09-08.json --confirm # put a backup back
```

### Adding an 11th member later

Add them to `league.roster.json`, then run `npm run db:seed`. Existing accounts
are skipped, so nobody's password changes.

---

## Backups

A scheduled GitHub Action dumps the whole league to `backups/` every **Tuesday
and Friday** and commits it. Tuesday's run lands a few hours after the week
rolls over at 3am Eastern, so the week just gone is captured with its results
in. You can also run it yourself from the Actions tab, or locally with
`npm run db:backup`.

Each dump is the complete contents of all four tables as JSON — a few
kilobytes — so any single file is a full restore, not an increment. Nothing is
written when nothing has changed, so `git log backups/` reads as a history of
weeks that actually happened rather than a list of identical snapshots.

To put one back:

```bash
npm run db:restore -- backups/2026-09-08.json            # says what it would do
npm run db:restore -- backups/2026-09-08.json --confirm  # actually does it
```

The restore replaces everything in the four tables, runs in one transaction —
a failure part-way leaves the database exactly as it was — and moves the id
sequences past the restored rows so the next insert doesn't collide.

### Two things to know

**The repo has to be private.** A dump contains everyone's password hashes and
the full ledger. The workflow asks GitHub whether the repository is private and
fails loudly rather than committing if it isn't. (Actions *artifacts* on a
public repo are downloadable by anyone too, so that route is no better.)

**This is a loose backup, not point-in-time recovery.** Twice a week means you
can lose up to half a week if something goes wrong right before a run. See the
next section for what covers the gap.

### How this fits with Neon's own restore

Neon keeps a rolling change history and can rewind a branch to any moment
inside it, down to the millisecond — no setup, already on. The catch is the
size of the window: **the Free plan keeps 6 hours**, paid plans default to a
day, and the Scale plan goes to 30. So the two cover different accidents:

| | Neon's instant restore | These backups |
| --- | --- | --- |
| Someone deletes a week's bets and you notice at lunch | ✅ rewind to this morning | ✅ but you lose since the last dump |
| You spot on Thursday that Tuesday's settlement was wrong | ❌ outside a 6-hour window | ✅ Tuesday's dump is right there |
| Neon account lapses, project deleted, billing problem | ❌ gone with the project | ✅ it's in git, on GitHub |
| Restore speed | seconds, whole branch | a minute, one command |

Neon's own docs say the same thing: their history is usually the faster fix,
and you keep your own dumps for off-platform redundancy and for anything older
than the window. Having both costs nothing, so have both.

**Worth doing in the Neon console:** check your history window under the
project's settings, and raise it if you're on a paid plan — it's the difference
between six hours and a month of instant rewind.

**Also worth setting:** Neon shows two connection strings, pooled and direct.
Add the direct one as a `DATABASE_URL_UNPOOLED` secret alongside `DATABASE_URL`
and the backup will use it. The dump reads all four tables from a single
snapshot, and a pooler in transaction mode can hand each statement to a
different backend — which is how you get a dump whose side bets reference a
user the same dump doesn't contain. It still works without this, over the
pooler; the direct string just makes the snapshot airtight.

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
    polymarket.ts      live odds from Polymarket            <- unit tested
    nfl-board.ts       the week's slate, futures removed     <- unit tested
    placer.ts          who has to place the parlay
    leg-standings.ts   ranking everyone's legs             <- unit tested
    lines.ts           generates the betting board          <- unit tested
    auth.ts            login, session cookies
    db.ts              Postgres connection + query helper
    db-url.ts          finds the connection string, any provider  <- unit tested
    queries.ts         database reads
    actions.ts         database writes (all of them)
    week.ts            the league's week schedule           <- unit tested
    grading.ts         decides who won, from final scores    <- unit tested
    settle.ts          grades finished weeks automatically
league.roster.json     your league (gitignored — copy the .example)
db/schema.sql          the tables
scripts/               setup, seeding, backup and restore
backups/               dated JSON dumps, committed twice a week
.github/workflows/     the scheduled backup
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

**The board is generated, not guessed.** Each team's projection is the sum of
its starters' projected points from Sleeper, scored with **your league's own
scoring settings** rather than Sleeper's precomputed `pts_ppr` column. This
matters: those precomputed numbers use Sleeper's generic scoring, so any
customisation — 6-point passing touchdowns, TE premium, yardage bonuses, a
different penalty for interceptions — makes them wrong for your league.
Sleeper's scoring settings and its stat projections share key names
(`pass_yd`, `rec`, `rush_td`…), so the projection is a straight dot product of
the two. If a player has no stat projection, the site falls back to Sleeper's
column *for your format only* — never a different one, since a standard league
reading `pts_ppr` would run high by roughly one point per reception — and the
board says when that happened. Win probability comes from treating both
scores as normal with a ~25 point spread, which is roughly how much a fantasy
score actually bounces around week to week; that probability becomes the
moneyline at **fair odds — no vig**, since nobody here is running a book.

**Only the moneyline carries a price.** Spreads and totals are set at the
projected number, which makes both sides a coin flip by construction, so they
are settled **straight up**: loser pays winner the stake, no odds shown.

**A priced bet is not even money, and the site says so plainly.** Backing a
-255 favourite with $5 means you collect $1.96 if it wins and pay $5 if it
loses; the other person is putting up that $1.96. Before anything is posted,
the confirmation box spells out both amounts — what they owe you and what you
owe them. Each side's risk is stored separately, so the ledger always moves
**what the loser risked**, not some shared stake. A lineup whose
players are mostly missing from the projections is left off the board rather
than shown as a suspiciously round number.

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
