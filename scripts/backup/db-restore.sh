#!/usr/bin/env bash
#
# Restore (or restore-DRILL) an encrypted backup produced by db-backup.sh.
# See docs/backup-restore-runbook.md for the full procedure and the disaster-recovery model.
#
#   scripts/backup/db-restore.sh <artifact.pgc.age> <TARGET_DB_URL>
#
# <artifact>       a local path to a *.pgc.age file (download it from your bucket / NAS first).
# <TARGET_DB_URL>  the database to restore INTO. There is no default and no prod guessing —
#                  you must type it, so a restore can never overwrite the wrong database by
#                  omission. For the monthly drill, point it at a throwaway scratch DB.
#
# Requires the church's age IDENTITY (private key) at $AGE_IDENTITY (default ./age-identity.txt).
# That file is the one secret that turns ciphertext back into PII — keep it offline; never commit it.
#
# NOTE ON EXIT CODE: pg_restore returns non-zero against a Supabase target because of a few
# BENIGN Supabase-managed lines ("schema public already exists", "permission denied ... for
# role supabase_admin"). Success is judged by the row counts this script prints at the end,
# NOT by pg_restore's exit code. The runbook explains why.

set -euo pipefail

fail() { echo "restore: $*" >&2; exit 1; }

ART="${1:-}"
TARGET="${2:-}"
[[ -n "$ART" && -n "$TARGET" ]] || fail "usage: db-restore.sh <artifact.pgc.age> <TARGET_DB_URL>"
[[ -f "$ART" ]] || fail "artifact not found: $ART"
AGE_IDENTITY="${AGE_IDENTITY:-./age-identity.txt}"
[[ -f "$AGE_IDENTITY" ]] || fail "age identity (private key) not found at $AGE_IDENTITY — set AGE_IDENTITY"

command -v age        >/dev/null || fail "age not found"
command -v pg_restore >/dev/null || fail "pg_restore not found"

echo "restore: decrypting $ART and restoring into the target ..."
echo "restore: target = ${TARGET%%\?*}   (secrets in the URL are not echoed)"

# Decrypt straight into pg_restore so plaintext PII never touches disk. --clean --if-exists
# lets the drill be re-run against the same scratch DB. --disable-triggers avoids FK-ordering
# trouble on a data load; it is a no-op on an empty target and safe here.
if age -d -i "$AGE_IDENTITY" "$ART" \
   | pg_restore --no-owner --clean --if-exists --disable-triggers -d "$TARGET"; then
  echo "restore: pg_restore reported success"
else
  echo "restore: pg_restore exited non-zero — EXPECTED on Supabase (benign supabase_admin / 'public exists' lines)."
  echo "restore: judge success by the row counts below, not the exit code."
fi

echo "restore: row counts in the restored target ---"
psql "$TARGET" -tA -c "
  select format('  %-20s %s', t, n) from (
    select 'users' t, count(*) n from public.users union all
    select 'vehicles', count(*) from public.vehicles union all
    select 'user_eligibility', count(*) from public.user_eligibility union all
    select 'reservations', count(*) from public.reservations union all
    select 'weekly_events', count(*) from public.weekly_events union all
    select 'audit_logs', count(*) from public.audit_logs
  ) s order by t;" \
  || fail "could not read row counts from target — restore likely did NOT succeed"

echo "restore: done. Compare the counts above against what you expect from the backup's date."
