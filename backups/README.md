# Backups

The scheduled job in `.github/workflows/backup.yml` drops a dated JSON dump of
the whole league in here every Tuesday and Friday. Each file is the complete
contents of all four tables — a few kilobytes — so any one of them is a full
restore, not an increment.

Because they land in git, `git log backups/` is the history: you can see what
changed between any two, and pull back any dump ever taken.

To put one back:

```bash
npm run db:restore -- backups/2026-09-08.json            # dry run, changes nothing
npm run db:restore -- backups/2026-09-08.json --confirm  # actually do it
```

**These files contain password hashes and the full ledger.** They are only
safe here because the repository is private, and the workflow refuses to run
if it ever stops being private.

These sit alongside Neon's own instant restore rather than replacing it. Neon
rewinds a branch to any moment in its history window — 6 hours on the Free
plan — which is the faster fix for something you notice the same day. These
dumps are what you reach for when the mistake is older than that window, or
when the problem is with the Neon project itself. See the Backups section of
the main README.
