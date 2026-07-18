#!/usr/bin/env bash
#
# Encrypted database backup for the church parking system (interim, while on the
# Supabase Free tier — see docs/backup-restore-runbook.md and docs/go-live-checklist.md §1.1).
#
# What it does, in one pipe so plaintext PII never lands on disk:
#   pg_dump (public + private, schema + data)  ->  age encrypt (church's public key)  ->  destination
#
# The dump carries the whole app world: every table's rows AND the security structure
# (audit_logs is append-only, service_role's DML is revoked, the purge escape hatch) —
# verified restorable. The artifact is encrypted for a recipient whose PRIVATE key the
# church holds offline, so whoever stores the file (a cloud bucket, a NAS, a drive) only
# ever sees ciphertext.
#
# Destination is deliberately agnostic — set ONE of:
#   * S3-compatible (Cloudflare R2 / Backblaze B2 / S3): S3_BUCKET (+ S3_ENDPOINT for R2/B2)
#   * a local path (a NAS mount, an attached encrypted drive): LOCAL_DEST=/path/to/dir
#
# Required env:
#   SUPABASE_DB_URL   postgres connection string. From CI use the SESSION-MODE POOLER
#                     (port 5432, host aws-*.pooler.supabase.com) — GitHub runners are
#                     IPv4-only and Supabase's direct connection is IPv6-only.
#   AGE_RECIPIENT     the church's age PUBLIC key (age1...). Not secret.
#
# Exit non-zero on any failure of dump / encrypt / write. Pruning failures are NON-fatal
# (a stale extra copy must never fail a fresh backup).

set -euo pipefail

fail() { echo "backup: $*" >&2; exit 1; }

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT (age public key) is required}"

command -v pg_dump >/dev/null || fail "pg_dump not found"
command -v age     >/dev/null || fail "age not found"

# One destination, not zero, not two.
if [[ -n "${S3_BUCKET:-}" && -n "${LOCAL_DEST:-}" ]]; then
  fail "set only ONE of S3_BUCKET or LOCAL_DEST, not both"
elif [[ -z "${S3_BUCKET:-}" && -z "${LOCAL_DEST:-}" ]]; then
  fail "set a destination: S3_BUCKET (+ S3_ENDPOINT) or LOCAL_DEST"
fi

RETENTION_DAYS="${RETENTION_DAYS:-90}"
PREFIX="${S3_PREFIX:-parking-db}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="parking-${STAMP}.pgc.age"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
OUT="$WORK/$NAME"

echo "backup: dumping public+private (schema+data) and encrypting for $AGE_RECIPIENT ..."
# pipefail makes a pg_dump failure fail the whole pipeline, so a broken dump is never
# encrypted-and-shipped as if it were good. --no-owner keeps restore portable across
# projects (owner is always 'postgres' on Supabase, but this avoids owner-mismatch noise).
pg_dump --format=custom --no-owner --schema=public --schema=private "$SUPABASE_DB_URL" \
  | age -r "$AGE_RECIPIENT" -o "$OUT"

# Sanity: non-empty and actually age-encrypted (never ship plaintext by mistake).
[[ -s "$OUT" ]] || fail "produced an empty artifact"
head -c 21 "$OUT" | grep -q 'age-encryption.org' || fail "artifact is not age-encrypted — refusing to ship"
SIZE="$(wc -c < "$OUT" | tr -d ' ')"
echo "backup: encrypted artifact $NAME (${SIZE} bytes)"

if [[ -n "${S3_BUCKET:-}" ]]; then
  command -v aws >/dev/null || fail "aws CLI not found"
  ENDPOINT_ARG=(); [[ -n "${S3_ENDPOINT:-}" ]] && ENDPOINT_ARG=(--endpoint-url "$S3_ENDPOINT")
  DEST="s3://${S3_BUCKET}/${PREFIX}/${NAME}"
  echo "backup: uploading to ${DEST} ..."
  aws s3 cp "$OUT" "$DEST" "${ENDPOINT_ARG[@]}" --only-show-errors \
    || fail "upload failed"
  echo "backup: uploaded. Retention on S3 is a bucket LIFECYCLE RULE (see runbook), not this script."
else
  mkdir -p "$LOCAL_DEST" || fail "cannot create LOCAL_DEST $LOCAL_DEST"
  cp "$OUT" "$LOCAL_DEST/$NAME" || fail "copy to LOCAL_DEST failed"
  echo "backup: wrote $LOCAL_DEST/$NAME"
  # Local destinations have no lifecycle rule, so prune here — non-fatal.
  if find "$LOCAL_DEST" -maxdepth 1 -name 'parking-*.pgc.age' -type f -mtime "+${RETENTION_DAYS}" -print -delete 2>/dev/null; then
    :
  else
    echo "backup: WARN prune of >${RETENTION_DAYS}d old local copies failed (backup itself is fine)" >&2
  fi
fi

echo "backup: OK ${NAME}"
