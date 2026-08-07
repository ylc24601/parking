#!/usr/bin/env bash
#
# Build a review pack: the evidence bundle an independent reviewer reads INSTEAD of
# re-deriving everything from GitHub.
#
#   scripts/review/make-review-pack.sh [--base <ref>] [--allow-pattern-file-change]
#
# The point is not convenience, it is trust. A reviewer who only reads the implementer's
# summary is reviewing a claim, not a change. So this script separates the two:
#
#   EVIDENCE  — machine-produced, the implementer cannot curate it:
#               DIFF.patch, FILES.txt, COMMITS.txt, STATUS.txt, logs/*.log, manifest.json
#   NARRATIVE — written by a human/agent afterwards, in REVIEW.md, which is seeded from
#               .github/PULL_REQUEST_TEMPLATE.md (the single source for the A/B/R gate).
#
# Read the evidence first, then the narrative. Never the other way round.
#
# Four properties this script exists to guarantee:
#
#   1. WHAT WAS VERIFIED IS WHAT IS PACKED. Every artifact is derived from one snapshot
#      (MERGE_BASE_SHA..HEAD_SHA), resolved once at the start and then used as a literal.
#      The tracked working tree must equal HEAD before, and HEAD must be unmoved after —
#      this repo is shared by concurrent sessions, so that is not a theoretical race.
#   2. A FAILED RUN NEVER LOOKS FINISHED. The pack is built in a temp dir and only replaces
#      .review/ after everything passed. On any failure the evidence is renamed to
#      .review-FAILED-* instead, and an existing .review/ is left untouched.
#      This is NOT an atomic rename, and it cannot be: rename(2) refuses to replace a
#      non-empty directory, so swapping a directory is necessarily more than one step. What
#      the publish step does guarantee is that a COMPLETE pack is on disk at every instant —
#      the previous pack is moved aside rather than deleted, and is dropped only once the new
#      one is in place. An interrupt leaves .review/ or .review.prev.*, never neither.
#   3. REAL EXIT CODES. `npm run verify` is redirected to a log, never piped into tee —
#      a pipeline can report tee's 0 while the command failed. Its status is captured
#      explicitly and recorded in the manifest.
#   4. NOTHING LEAKS. See the scan section below.
#
# Verification runs against a `git archive HEAD` export in a scratch directory, not against
# your working tree: same clean-tree guarantee the CI runner gives, and it does not blow
# away your node_modules with `npm ci`.
#
# ON THE SECRET SCAN, HONESTLY: the real control is constructive — the pack contains only
# files this script generates. There is no `cp -r`, no `find`, so nothing can be swept in
# by accident, and git plumbing only ever sees tracked content (never node_modules, never
# a nested worktree). The regex scan in scripts/review/deny-patterns.txt is a second net
# for KNOWN SHAPES on top of that. It cannot recognise a real member's name. Do not read a
# passing scan as proof the pack is clean of PII.
#
# Failure messages never echo a matched line — they name the pattern and the count. Same
# rule the backup scripts follow for connection strings.

set -euo pipefail

PROG="$(basename "$0")"
BASE_REF="main"
ALLOW_PATTERN_FILE_CHANGE=0

usage() {
  cat <<EOF
usage: $PROG [--base <ref>] [--allow-pattern-file-change]

  --base <ref>                  what to diff against (default: main). Use the parent slice's
                                branch when this branch is stacked on an unmerged slice —
                                otherwise that slice's commits land in your diff.
  --allow-pattern-file-change   permit scripts/review/deny-patterns.txt to appear in the
                                diff. Editing it necessarily trips the scanner against
                                itself; this flag says you meant to.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      BASE_REF="${2:-}"
      [[ -n "$BASE_REF" ]] || { echo "$PROG: --base needs a ref" >&2; exit 2; }
      shift 2 ;;
    --allow-pattern-file-change) ALLOW_PATTERN_FILE_CHANGE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "$PROG: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# ── failure handling ────────────────────────────────────────────────────────────
# STAGE is what the manifest records when something blows up; FAIL_MSG is why.
STAGE="startup"
FAIL_MSG=""
PACK=""          # temp pack dir; emptied once published so the trap leaves it alone
EXPORT_DIR=""    # scratch export used for verification
OUT=".review"

fail() { FAIL_MSG="$*"; echo "$PROG: FAILED [$STAGE] — $*" >&2; exit 1; }

on_exit() {
  local rc=$?
  if [[ $rc -ne 0 && -n "$PACK" && -d "$PACK" ]]; then
    write_manifest failed 2>/dev/null || true
    local short stamp dest
    short="$(printf '%s' "${HEAD_SHA:-unknown}" | cut -c1-7)"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    dest=".review-FAILED-$short-$stamp"
    rm -rf "$dest"
    if mv "$PACK" "$dest" 2>/dev/null; then
      echo "$PROG: evidence kept in $dest/ — this is NOT a review pack, do not send it as one" >&2
      PACK=""
    fi
  fi
  [[ -n "$PACK" && -d "$PACK" ]] && rm -rf "$PACK"
  [[ -n "$EXPORT_DIR" && -d "$EXPORT_DIR" ]] && rm -rf "$EXPORT_DIR"
  # Preserve the real status. A cleanup trap that returns its own exit code is exactly how
  # this repo previously shipped a script that reported success after a fatal error
  # (see .github/workflows/backup-ci.yml).
  exit $rc
}
trap on_exit EXIT

# Newlines are the ones that matter here, not an edge case: the secret-scan failure reason is
# built as a MULTI-LINE list (one line per matching pattern) and is embedded verbatim in the
# FAILED manifest's `failed_reason`. A line-oriented `sed` never sees those newlines, so the
# manifest for the most safety-relevant failure path was the one that came out unparseable.
# Done with parameter expansion rather than a pipeline so the substitution is not itself
# line-oriented.
#
# Escaping is total, not "the characters we expect". An earlier version stopped at the five
# with short forms and justified it by claiming nothing else could reach the function — untrue:
# NODE_V, NPM_V and `uname -sr` are external command output, and BASE_REF is whatever came in
# on --base. JSON requires every character below U+0020 to be escaped, so the ones without a
# short form go out as \u00XX. (U+0000 is unreachable: a bash string cannot hold a NUL.)
json_escape() {
  local s="${1:-}"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\b'/\\b}"
  s="${s//$'\f'/\\f}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\n'/\\n}"
  # The glob keeps the per-character loop off the normal path: it runs only for a string that
  # still holds a control character after the five short forms above.
  if [[ "$s" == *[[:cntrl:]]* ]]; then
    local out="" i c
    for (( i = 0; i < ${#s}; i++ )); do
      c="${s:i:1}"
      if [[ "$c" == [[:cntrl:]] ]]; then printf -v c '\\u%04x' "'$c"; fi
      out+="$c"
    done
    s="$out"
  fi
  printf '%s' "$s"
}

write_manifest() {
  local status="${1:-failed}" extra=""
  if [[ "$status" != "complete" ]]; then
    # Leading newline lives in the value, so a complete manifest has no blank line here.
    extra="
  \"failed_stage\": \"$(json_escape "$STAGE")\",
  \"failed_reason\": \"$(json_escape "$FAIL_MSG")\","
  fi
  cat > "$PACK/manifest.json" <<EOF
{
  "schema_version": 1,
  "status": "$status",$extra
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "repo": {
    "branch": "$(json_escape "${BRANCH:-}")",
    "base_ref": "$(json_escape "$BASE_REF")",
    "base_sha": "${BASE_SHA:-}",
    "head_sha": "${HEAD_SHA:-}",
    "merge_base_sha": "${MERGE_BASE_SHA:-}"
  },
  "tree": { "tracked_clean": ${TRACKED_CLEAN:-false} },
  "toolchain": {
    "node": "$(json_escape "${NODE_V:-}")",
    "npm": "$(json_escape "${NPM_V:-}")",
    "uname": "$(json_escape "$(uname -sr)")"
  },
  "verify": {
    "method": "git archive HEAD -> npm ci -> npm run verify (clean export, no app env)",
    "install_cmd": "npm ci",
    "install_exit": ${INSTALL_EXIT:-null},
    "install_log": "logs/npm-ci.log",
    "verify_cmd": "npm run verify",
    "verify_exit": ${VERIFY_EXIT:-null},
    "verify_log": "logs/verify.log"
  },
  "artifacts": ["DIFF.patch", "FILES.txt", "COMMITS.txt", "STATUS.txt", "REVIEW.md", "logs/npm-ci.log", "logs/verify.log"]
}
EOF
}

# ── preflight ───────────────────────────────────────────────────────────────────
STAGE="preflight"
git rev-parse --git-dir >/dev/null 2>&1 || fail "not inside a git repository"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

APP_DIR="parking-system"
TEMPLATE=".github/PULL_REQUEST_TEMPLATE.md"
PATTERN_FILE="scripts/review/deny-patterns.txt"

[[ -f "$APP_DIR/package.json" ]] || fail "$APP_DIR/package.json not found"
grep -q '"verify"' "$APP_DIR/package.json" \
  || fail "$APP_DIR has no \`verify\` script — the canonical verification command must exist first"
[[ -f "$TEMPLATE" ]]     || fail "$TEMPLATE not found — REVIEW.md is seeded from it, there is no second copy"
[[ -f "$PATTERN_FILE" ]] || fail "$PATTERN_FILE not found"

# Tracked tree must equal HEAD. Untracked and ignored files are deliberately NOT grounds to
# refuse: .review/, node_modules, and a stray scratch file say nothing about whether the
# code under test matches the code being packed.
if ! git diff --quiet || ! git diff --cached --quiet; then
  TRACKED_CLEAN=false
  fail "tracked working tree differs from HEAD — the tree that gets verified would not be the tree that gets packed. Commit or revert first."
fi
TRACKED_CLEAN=true

# ── snapshot ────────────────────────────────────────────────────────────────────
STAGE="snapshot"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
HEAD_SHA="$(git rev-parse HEAD)"
git rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null \
  || fail "base ref '$BASE_REF' does not resolve to a commit"
BASE_SHA="$(git rev-parse "$BASE_REF^{commit}")"
MERGE_BASE_SHA="$(git merge-base "$BASE_SHA" "$HEAD_SHA")"
[[ "$MERGE_BASE_SHA" != "$HEAD_SHA" ]] \
  || fail "no commits between $BASE_REF and HEAD — nothing to review"

NODE_V="$(node --version 2>/dev/null || echo unknown)"
NPM_V="$(npm --version 2>/dev/null || echo unknown)"

# Counted before the temp pack dir exists, or the pack counts itself. (In this repo .review*
# is gitignored so it would not show; in a repo without that rule it would — and a number that
# depends on the reader's .gitignore is not evidence.)
UNTRACKED_COUNT="$(git ls-files --others --exclude-standard | wc -l | tr -d ' ')"

PACK="$(mktemp -d "$REPO_ROOT/.review.tmp.XXXXXX")"
mkdir -p "$PACK/logs"

# ── artifacts (all bound to the one snapshot, never to a re-resolved ref) ────────
STAGE="artifacts"
git diff --binary "$MERGE_BASE_SHA" "$HEAD_SHA"      > "$PACK/DIFF.patch"
git diff --name-status "$MERGE_BASE_SHA" "$HEAD_SHA" > "$PACK/FILES.txt"
git log --oneline "$MERGE_BASE_SHA..$HEAD_SHA"       > "$PACK/COMMITS.txt"
{
  echo "branch          $BRANCH"
  echo "base_ref        $BASE_REF"
  echo "base_sha        $BASE_SHA"
  echo "head_sha        $HEAD_SHA"
  echo "merge_base_sha  $MERGE_BASE_SHA"
  echo
  # Deliberately a count, not a listing. The tracked tree is verified equal to HEAD above, so
  # `git status --short` here would contain nothing BUT untracked filenames — and a filename
  # is user content, not something this script generated. That made it the one place where
  # unvetted input entered the pack, and the deny-pattern scan does not cover it (it reads the
  # added lines of DIFF.patch). A stray `王小明名單.csv` in the working directory is exactly
  # the shape of thing this pack must never carry, and no regex would have caught it.
  echo "untracked files: $UNTRACKED_COUNT (names omitted on purpose — see the comment in $PROG)"
} > "$PACK/STATUS.txt"

# ── scan ────────────────────────────────────────────────────────────────────────
# Cheap, so it runs before the slow verification: a pack that must be rejected should be
# rejected in seconds, not after a full build.
STAGE="scan"

CHANGED_PATHS="$(cut -f2- "$PACK/FILES.txt" | tr '\t' '\n' | sed '/^$/d' | sort -u)"

if printf '%s\n' "$CHANGED_PATHS" | grep -qx "$PATTERN_FILE"; then
  [[ $ALLOW_PATTERN_FILE_CHANGE -eq 1 ]] \
    || fail "$PATTERN_FILE is in this diff, which necessarily matches its own patterns. Re-run with --allow-pattern-file-change if you meant to edit it."
fi

while IFS= read -r p; do
  [[ -n "$p" ]] || continue
  case "$p" in
    .env.example|*/.env.example) ;;
    .env|.env.*|*/.env|*/.env.*)   fail "diff touches an env file: $p" ;;
    *.age|*.pgc|*.dump|*.sql.gz)   fail "diff touches a database dump or encrypted artifact: $p" ;;
    age-identity*|*/age-identity*) fail "diff touches an age identity (private key): $p" ;;
    docs/import-templates/*)
      case "$p" in
        *README.md|*範本.csv) ;;
        *) fail "diff touches an untracked-by-policy import file (these hold real member data): $p" ;;
      esac ;;
  esac
done <<EOF
$CHANGED_PATHS
EOF

# Scan ADDED lines only. `+++ b/path` headers are not content.
if [[ $ALLOW_PATTERN_FILE_CHANGE -eq 1 ]]; then
  git diff "$MERGE_BASE_SHA" "$HEAD_SHA" -- . ":(exclude)$PATTERN_FILE" > "$PACK/logs/.scan-diff"
else
  cp "$PACK/DIFF.patch" "$PACK/logs/.scan-diff"
fi
grep '^+' "$PACK/logs/.scan-diff" | grep -v '^+++' > "$PACK/logs/.scan-added" || true

DENY_HITS=""
while IFS= read -r pat; do
  case "$pat" in ''|'#'*) continue ;; esac
  n="$(grep -c -E -- "$pat" "$PACK/logs/.scan-added" || true)"
  [[ "${n:-0}" -eq 0 ]] || DENY_HITS="$DENY_HITS
  $n added line(s) match: $pat"
done < "$PATTERN_FILE"
rm -f "$PACK/logs/.scan-diff" "$PACK/logs/.scan-added"

# Deliberately reports the pattern and the count, never the matched line.
[[ -z "$DENY_HITS" ]] || fail "secret/PII scan rejected this diff:$DENY_HITS"

# ── verification (clean export, exactly what CI runs) ───────────────────────────
STAGE="verify"
EXPORT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/review-pack-verify.XXXXXX")"
git archive "$HEAD_SHA" "$APP_DIR" | tar -x -C "$EXPORT_DIR"

# No app env is provided, and that is the point: if verification only passes with secrets
# present, something reads them at import time and that is a finding, not a config gap.
set +e
( cd "$EXPORT_DIR/$APP_DIR" && npm ci ) > "$PACK/logs/npm-ci.log" 2>&1
INSTALL_EXIT=$?
set -e
[[ $INSTALL_EXIT -eq 0 ]] || fail "npm ci failed (exit $INSTALL_EXIT) — see logs/npm-ci.log"

# Redirected, not piped: `cmd | tee log` can report tee's success while cmd failed.
set +e
( cd "$EXPORT_DIR/$APP_DIR" && npm run verify ) > "$PACK/logs/verify.log" 2>&1
VERIFY_EXIT=$?
set -e
[[ $VERIFY_EXIT -eq 0 ]] || fail "npm run verify failed (exit $VERIFY_EXIT) — see logs/verify.log"

# ── REVIEW.md (narrative, seeded from the one canonical template) ───────────────
STAGE="review-md"
{
  echo "<!-- Evidence header generated by scripts/review/make-review-pack.sh."
  echo "     Everything below the rule is a verbatim copy of $TEMPLATE"
  echo "     with links rewritten for this directory. Do not maintain a second template. -->"
  echo
  echo "# Review pack — \`$BRANCH\`"
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| base_ref | \`$BASE_REF\` |"
  echo "| base_sha | \`$BASE_SHA\` |"
  echo "| head_sha | \`$HEAD_SHA\` |"
  echo "| merge_base_sha | \`$MERGE_BASE_SHA\` |"
  echo "| tracked tree == HEAD | yes |"
  echo "| npm ci | exit $INSTALL_EXIT |"
  echo "| npm run verify | exit $VERIFY_EXIT |"
  echo "| toolchain | node $NODE_V, npm $NPM_V, $(uname -sr) |"
  echo
  echo "Evidence: \`DIFF.patch\`, \`FILES.txt\`, \`COMMITS.txt\`, \`STATUS.txt\`, \`logs/\`, \`manifest.json\`."
  echo "Read those before the prose below."
  echo
  echo "---"
  echo
  sed 's#](\.\./#](#g' "$TEMPLATE"
} > "$PACK/REVIEW.md"

# ── publish ─────────────────────────────────────────────────────────────────────
STAGE="publish"
NOW_HEAD="$(git rev-parse HEAD)"
[[ "$NOW_HEAD" == "$HEAD_SHA" ]] \
  || fail "HEAD moved during the run ($HEAD_SHA -> $NOW_HEAD) — the pack would not describe what was verified"
if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "tracked working tree changed during the run — the pack would not describe what was verified"
fi

write_manifest complete

# The old pack is moved aside, NOT deleted first. `rm -rf "$OUT" && mv "$PACK" "$OUT"` reads
# as one step but is two, and an interrupt between them leaves no pack at all — the previous
# evidence destroyed to make room for evidence that never arrived.
PREV=""
if [[ -e "$OUT" ]]; then
  PREV="$OUT.prev.$$"
  rm -rf "$PREV"
  mv "$OUT" "$PREV" \
    || fail "could not move the existing $OUT/ aside — nothing published, the previous pack is untouched"
fi

# The rollback below only runs when the filesystem misbehaves, which is to say: never, during
# development. An untested guard is a comment — the reason this script's failure paths are
# tested at all — so there is one seam for the suite to pull. Set by test-review-pack.sh only.
# Matched against an exact sentinel, not tested for non-emptiness: an inherited
# REVIEW_PACK_SIMULATE_PUBLISH_FAILURE=0 meaning "off" would otherwise fail every run.
if [[ "${REVIEW_PACK_SIMULATE_PUBLISH_FAILURE:-}" == "simulate-publish-failure" ]] || ! mv "$PACK" "$OUT"; then
  if [[ -n "$PREV" ]] && mv "$PREV" "$OUT" 2>/dev/null; then PREV=""; fi
  fail "could not publish the pack to $OUT/${PREV:+ — WARNING: the previous pack is still in $PREV, move it back by hand}"
fi
PACK=""

# Only now is the old pack redundant. A .review.prev.* left by an earlier crash is deliberately
# NOT swept up here: it may be the only complete pack on disk, and deleting it would be exactly
# the failure this sequence exists to prevent. Remove it by hand once you have looked at it.
if [[ -n "$PREV" ]]; then rm -rf "$PREV"; fi

echo "$PROG: wrote $OUT/ — $BASE_REF..$BRANCH @ $(printf '%s' "$HEAD_SHA" | cut -c1-7)"
echo "  $(wc -l < "$OUT/COMMITS.txt" | tr -d ' ') commit(s), $(grep -c '' "$OUT/FILES.txt" | tr -d ' ') file(s) changed, verify exit $VERIFY_EXIT"
