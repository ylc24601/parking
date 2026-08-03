#!/usr/bin/env bash
#
# Tests for make-review-pack.sh. Every case builds a throwaway git repo under mktemp and
# uses a fake `npm` on PATH, so nothing here touches the real repo, the network, or a real
# install. Same shape as scripts/backup/test-backup-scripts.sh.
#
# What this covers: that every refusal actually refuses — and, just as important, that a
# refused run leaves NO .review/ behind. A pack that looks finished after a failed
# verification is worse than no pack, because a reviewer would read it as evidence.
#
# What this does NOT cover: whether the regex net in deny-patterns.txt catches a real
# secret in the wild, or any real PII. It proves the guard fires on known shapes. The
# actual control is constructive (the pack only ever contains generated artifacts) and no
# test can prove the absence of a member's name from a diff.
#
# Every planted "secret" below is obviously fake by construction.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/make-review-pack.sh"
PATTERNS="$HERE/deny-patterns.txt"
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }

TMP="$(mktemp -d)"; FAKEBIN="$(mktemp -d)"
trap 'rm -rf "$TMP" "$FAKEBIN"' EXIT

# ── fake npm ────────────────────────────────────────────────────────────────────
cat >"$FAKEBIN/npm" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  # The suffix seam exists so the suite can feed a control character in through a real external
  # command's output — the path that made "nothing else can reach json_escape" untrue.
  --version) echo "0.0.0-fake${FAKE_NPM_VERSION_SUFFIX:-}"; exit 0 ;;
  ci)
    echo "fake npm ci"
    exit "${FAKE_NPM_CI_EXIT:-0}" ;;
  run)
    echo "fake npm run ${2:-}"
    # Simulates a concurrent session committing into the repo mid-verification.
    [[ -n "${FAKE_MOVE_HEAD:-}" ]] && git -C "$FAKE_MOVE_HEAD" commit -q --allow-empty -m "another session"
    exit "${FAKE_VERIFY_EXIT:-0}" ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$FAKEBIN/npm"
export PATH="$FAKEBIN:$PATH"

# ── fixture ─────────────────────────────────────────────────────────────────────
# A minimal repo with the three things make-review-pack.sh requires: an app package.json
# carrying a `verify` script, the PR template, and the deny-pattern file.
# NOTE: this runs in a command substitution, so it must not depend on any variable it
# assigns — a counter would be incremented in the subshell and lost, handing every case the
# same directory and letting one test's .review/ satisfy the next test's assertion.
newrepo() {
  local d
  d="$(mktemp -d "$TMP/repo.XXXXXX")"
  mkdir -p "$d/parking-system" "$d/.github" "$d/scripts/review"
  (
    cd "$d" || exit 1
    git init -q -b main .
    git config user.email "test@example.invalid"
    git config user.name "Test"
    printf '{"name":"x","scripts":{"verify":"true"}}\n' > parking-system/package.json
    cat > .github/PULL_REQUEST_TEMPLATE.md <<'TPL'
## 這一刀做了什麼

## Database compatibility

> 出處：[prod-deploy-runbook.md](../docs/prod-deploy-runbook.md) §1.5。

- **A — old app + new DB 安全嗎？** SAFE / UNSAFE
- **B — new app + old DB 安全嗎？** SAFE / UNSAFE
- **R — 上一個 production deployment + 新 DB 安全嗎？** SAFE / PARTIAL / UNSAFE
TPL
    cp "$PATTERNS" scripts/review/deny-patterns.txt
    git add -A && git commit -qm "base"
    git checkout -qb work
  ) >/dev/null 2>&1
  echo "$d"
}

# commit_file <repo> <path> <content>
commit_file() {
  local d="$1" p="$2" c="$3"
  mkdir -p "$d/$(dirname "$p")"
  printf '%s\n' "$c" > "$d/$p"
  ( cd "$d" && git add -A && git commit -qm "add $p" ) >/dev/null 2>&1
}

# run_pack <repo> [args...] -> prints combined output, returns the script's exit code
run_pack() {
  local d="$1"; shift
  ( cd "$d" && bash "$SCRIPT" --base main "$@" ) 2>&1
}

has_review()  { [[ -d "$1/.review" ]]; }
has_failed()  { compgen -G "$1/.review-FAILED-*" >/dev/null 2>&1; }

# The failed manifest is the one most likely to be malformed: it embeds a free-text reason.
valid_json() { python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$1" 2>/dev/null; }

# assert_fail <desc> <repo> <phrase> [args...]
assert_fail() {
  local desc="$1" d="$2" phrase="$3"; shift 3
  local out rc
  out="$(run_pack "$d" "$@")"; rc=$?
  if [[ $rc -eq 0 ]]; then bad "$desc (expected non-zero, got 0)"; return; fi
  if [[ -n "$phrase" ]] && ! grep -qF -- "$phrase" <<<"$out"; then
    bad "$desc (exited $rc but message lacked '$phrase': $(head -2 <<<"$out" | tr '\n' ' '))"; return
  fi
  if has_review "$d"; then bad "$desc (refused but still published .review/)"; return; fi
  ok "$desc"
}

echo "make-review-pack.sh — happy path"
R="$(newrepo)"
commit_file "$R" "parking-system/lib/thing.ts" "export const thing = 1"
OUT="$(run_pack "$R")"; RC=$?
if [[ $RC -eq 0 ]]; then ok "exits 0"; else bad "exits 0 (got $RC: $(tail -2 <<<"$OUT" | tr '\n' ' '))"; fi
if has_review "$R"; then ok "publishes .review/"; else bad "publishes .review/"; fi
if ! has_failed "$R"; then ok "leaves no .review-FAILED-*"; else bad "leaves no .review-FAILED-*"; fi
if grep -q '"status": "complete"' "$R/.review/manifest.json" 2>/dev/null; then
  ok "manifest status complete"; else bad "manifest status complete"; fi
if valid_json "$R/.review/manifest.json"; then ok "manifest is valid JSON"; else bad "manifest is valid JSON"; fi
if grep -q '"verify_exit": 0' "$R/.review/manifest.json" 2>/dev/null; then
  ok "manifest records verify_exit 0"; else bad "manifest records verify_exit 0"; fi
if [[ -s "$R/.review/DIFF.patch" && -s "$R/.review/COMMITS.txt" && -s "$R/.review/logs/verify.log" ]]; then
  ok "evidence files are non-empty"; else bad "evidence files are non-empty"; fi
# The three SHAs must agree with git, not merely be present.
if [[ "$(grep -o '"head_sha": "[0-9a-f]*"' "$R/.review/manifest.json" | cut -d'"' -f4)" \
      == "$(cd "$R" && git rev-parse HEAD)" ]]; then
  ok "manifest head_sha matches HEAD"; else bad "manifest head_sha matches HEAD"; fi
if [[ "$(grep -o '"merge_base_sha": "[0-9a-f]*"' "$R/.review/manifest.json" | cut -d'"' -f4)" \
      == "$(cd "$R" && git merge-base main HEAD)" ]]; then
  ok "manifest merge_base_sha matches git merge-base"; else bad "manifest merge_base_sha matches git merge-base"; fi
# Temp dirs must not survive a successful run.
if ! compgen -G "$R/.review.tmp.*" >/dev/null 2>&1; then ok "no leftover .review.tmp.*"; else bad "no leftover .review.tmp.*"; fi

echo "make-review-pack.sh — REVIEW.md comes from the one canonical template"
if grep -q 'A — old app + new DB' "$R/.review/REVIEW.md" 2>/dev/null; then
  ok "carries the A/B/R section verbatim"; else bad "carries the A/B/R section verbatim"; fi
if grep -q 'R — 上一個 production deployment' "$R/.review/REVIEW.md" 2>/dev/null; then
  ok "carries the R row"; else bad "carries the R row"; fi
if ! grep -q '](\.\./' "$R/.review/REVIEW.md" 2>/dev/null; then
  ok "rewrites ../ links so none dangle"; else bad "rewrites ../ links so none dangle"; fi
if grep -q 'head_sha' "$R/.review/REVIEW.md" 2>/dev/null; then
  ok "prefixes an evidence header"; else bad "prefixes an evidence header"; fi

echo "make-review-pack.sh — STATUS.txt carries no untracked filename"
# A filename is user content. With the tracked tree forced equal to HEAD, a `git status`
# listing here would be nothing BUT untracked names, and the deny-pattern scan does not reach
# STATUS.txt — so a stray working file named after a member would have ridden into the pack.
R="$(newrepo)"
commit_file "$R" "parking-system/lib/m.ts" "export const m = 1"
printf 'x\n' > "$R/should-not-appear-in-status.csv"
run_pack "$R" >/dev/null 2>&1
if ! grep -q 'should-not-appear-in-status' "$R/.review/STATUS.txt" 2>/dev/null; then
  ok "an untracked filename does not reach STATUS.txt"; else bad "an untracked filename does not reach STATUS.txt"; fi
if grep -q 'untracked files: 1' "$R/.review/STATUS.txt" 2>/dev/null; then
  ok "STATUS.txt reports the untracked count instead"; else bad "STATUS.txt reports the untracked count instead"; fi

echo "make-review-pack.sh — the tree that is verified must be the tree that is packed"
R="$(newrepo)"
commit_file "$R" "parking-system/lib/a.ts" "export const a = 1"
printf 'dirty\n' >> "$R/parking-system/lib/a.ts"
assert_fail "dirty tracked tree is refused" "$R" "tracked working tree differs from HEAD"

R="$(newrepo)"
commit_file "$R" "parking-system/lib/b.ts" "export const b = 1"
printf 'untracked\n' > "$R/scratch-note.txt"
OUT="$(run_pack "$R")"; RC=$?
if [[ $RC -eq 0 ]]; then ok "an untracked file alone does not refuse"; else bad "an untracked file alone does not refuse (got $RC)"; fi

R="$(newrepo)"
commit_file "$R" "parking-system/lib/c.ts" "export const c = 1"
OUT="$(cd "$R" && FAKE_MOVE_HEAD="$R" bash "$SCRIPT" --base main 2>&1)"; RC=$?
if [[ $RC -ne 0 ]] && grep -qF -- "HEAD moved during the run" <<<"$OUT" && ! has_review "$R"; then
  ok "HEAD moving mid-run is caught, nothing published"
else
  bad "HEAD moving mid-run is caught (rc=$RC)"
fi

echo "make-review-pack.sh — verification failure never yields a finished-looking pack"
R="$(newrepo)"
commit_file "$R" "parking-system/lib/d.ts" "export const d = 1"
OUT="$(cd "$R" && FAKE_VERIFY_EXIT=3 bash "$SCRIPT" --base main 2>&1)"; RC=$?
if [[ $RC -ne 0 ]]; then ok "verify exit 3 fails the run"; else bad "verify exit 3 fails the run"; fi
if ! has_review "$R"; then ok "verify failure publishes no .review/"; else bad "verify failure publishes no .review/"; fi
if has_failed "$R"; then ok "verify failure keeps .review-FAILED-* evidence"; else bad "verify failure keeps .review-FAILED-* evidence"; fi
FDIR="$(compgen -G "$R/.review-FAILED-*" | head -1)"
if grep -q '"verify_exit": 3' "$FDIR/manifest.json" 2>/dev/null; then
  ok "FAILED manifest records the real exit code"; else bad "FAILED manifest records the real exit code"; fi
if grep -q '"status": "failed"' "$FDIR/manifest.json" 2>/dev/null \
   && ! grep -q '"status": "complete"' "$FDIR/manifest.json" 2>/dev/null; then
  ok "FAILED manifest never claims complete"; else bad "FAILED manifest never claims complete"; fi
if valid_json "$FDIR/manifest.json"; then
  ok "FAILED manifest is valid JSON (it embeds a free-text reason)"; else bad "FAILED manifest is valid JSON"; fi
if grep -q '"failed_stage": "verify"' "$FDIR/manifest.json" 2>/dev/null; then
  ok "FAILED manifest names the stage"; else bad "FAILED manifest names the stage"; fi
if [[ -s "$FDIR/logs/verify.log" ]]; then ok "FAILED pack still carries the verify log"; else bad "FAILED pack still carries the verify log"; fi

R="$(newrepo)"
commit_file "$R" "parking-system/lib/e.ts" "export const e = 1"
OUT="$(cd "$R" && FAKE_NPM_CI_EXIT=7 bash "$SCRIPT" --base main 2>&1)"; RC=$?
if [[ $RC -ne 0 ]] && grep -qF -- "npm ci failed" <<<"$OUT" && ! has_review "$R"; then
  ok "npm ci failure fails the run before verify"
else
  bad "npm ci failure fails the run (rc=$RC)"
fi

echo "make-review-pack.sh — an existing good pack survives a later failed run"
R="$(newrepo)"
commit_file "$R" "parking-system/lib/f.ts" "export const f = 1"
run_pack "$R" >/dev/null 2>&1
cp "$R/.review/manifest.json" "$TMP/before.json"
commit_file "$R" "parking-system/lib/g.ts" "export const g = 1"
( cd "$R" && FAKE_VERIFY_EXIT=1 bash "$SCRIPT" --base main ) >/dev/null 2>&1
if cmp -s "$TMP/before.json" "$R/.review/manifest.json"; then
  ok ".review/ is left untouched by a failed run"; else bad ".review/ is left untouched by a failed run"; fi

echo "make-review-pack.sh — publishing never destroys the pack it is replacing"
# Publishing a directory cannot be one atomic step, so the question is what survives an
# interrupt between the steps. `rm -rf .review && mv` answers "nothing": the old evidence is
# destroyed to make room for evidence that never arrives. The seam below is the only way to
# exercise the rollback without a misbehaving filesystem.
R="$(newrepo)"
commit_file "$R" "parking-system/lib/n.ts" "export const n = 1"
run_pack "$R" >/dev/null 2>&1
cp "$R/.review/manifest.json" "$TMP/keep.json"
commit_file "$R" "parking-system/lib/o.ts" "export const o = 1"
OUT="$(cd "$R" && REVIEW_PACK_SIMULATE_PUBLISH_FAILURE=simulate-publish-failure bash "$SCRIPT" --base main 2>&1)"; RC=$?
if [[ $RC -ne 0 ]]; then ok "a failed publish fails the run"; else bad "a failed publish fails the run (got 0)"; fi
if cmp -s "$TMP/keep.json" "$R/.review/manifest.json"; then
  ok "the previous pack is restored, not lost"; else bad "the previous pack is restored, not lost"; fi
if ! compgen -G "$R/.review.prev.*" >/dev/null 2>&1; then
  ok "rollback leaves no .review.prev.*"; else bad "rollback leaves no .review.prev.*"; fi
if has_failed "$R"; then ok "the failed attempt is still kept as .review-FAILED-*"; else bad "the failed attempt is still kept as .review-FAILED-*"; fi

R="$(newrepo)"
commit_file "$R" "parking-system/lib/p.ts" "export const p = 1"
run_pack "$R" >/dev/null 2>&1
commit_file "$R" "parking-system/lib/q.ts" "export const q = 1"
run_pack "$R" >/dev/null 2>&1
if grep -q 'lib/q.ts' "$R/.review/FILES.txt" 2>/dev/null; then
  ok "a successful re-publish replaces the old pack"; else bad "a successful re-publish replaces the old pack"; fi
if ! compgen -G "$R/.review.prev.*" >/dev/null 2>&1; then
  ok "a successful re-publish leaves no .review.prev.*"; else bad "a successful re-publish leaves no .review.prev.*"; fi

echo "make-review-pack.sh — secret / PII scan"

# The planted values are assembled at runtime, so no line of THIS file matches
# deny-patterns.txt. Found by dogfooding: with the values written out literally, the pack
# script correctly refused to pack its own test suite. Splitting them keeps the fixtures
# honest (the assembled string is exactly what a real leak looks like) without making the
# scanner's own source unpackable. Every value is transparently fake.
J="eyJ"; FAKE_JWT="${J}fakefakefakefakefakefake.fake.fake"
FAKE_ECHO_PROBE="${J}seCretVALUEmustNOTbeECHOED123"
FAKE_DSN="postgres""ql://user:hunter2@db.example.invalid:5432/x"
FAKE_PHONE="09""12-345-678"
SRK="SUPABASE_SERVICE_ROLE""_KEY"

R="$(newrepo)"
commit_file "$R" "parking-system/lib/h.ts" "const k = '$FAKE_JWT'"
assert_fail "planted JWT-shaped key is refused" "$R" "scan rejected this diff"

R="$(newrepo)"
commit_file "$R" ".env.local" "$SRK=not-a-real-key"
assert_fail "a committed .env.local is refused" "$R" "env file"

R="$(newrepo)"
commit_file "$R" "parking-system/.env.example" "$SRK="
OUT="$(run_pack "$R")"; RC=$?
if [[ $RC -eq 0 ]]; then ok ".env.example with an empty value is allowed"; else bad ".env.example with an empty value is allowed (got $RC: $(tail -2 <<<"$OUT" | tr '\n' ' '))"; fi

R="$(newrepo)"
commit_file "$R" "docs/notes.md" "connect via $FAKE_DSN"
assert_fail "connection string with inline password is refused" "$R" "scan rejected this diff"

R="$(newrepo)"
commit_file "$R" "docs/roster.md" "聯絡電話 $FAKE_PHONE"
assert_fail "a Taiwan mobile number is refused" "$R" "scan rejected this diff"

R="$(newrepo)"
commit_file "$R" "backup/db.age" "not really encrypted"
assert_fail "an .age artifact is refused" "$R" "database dump or encrypted artifact"

echo "make-review-pack.sh — the scan does not print what it found"
R="$(newrepo)"
commit_file "$R" "parking-system/lib/i.ts" "const k = '$FAKE_ECHO_PROBE'"
OUT="$(run_pack "$R")"
if ! grep -qF -- "$FAKE_ECHO_PROBE" <<<"$OUT"; then
  ok "the matched line is never echoed"; else bad "the matched line is never echoed"; fi

# The scan reason is the only multi-line failure reason the script produces (one line per
# matching pattern, plus a leading newline), so it is the one that broke a line-oriented
# escaper. The pack for the most safety-relevant failure was the one with an unparseable
# manifest — and the earlier JSON check only ever ran on a single-line verify failure.
FDIR="$(compgen -G "$R/.review-FAILED-*" | head -1)"
if [[ -n "$FDIR" ]] && valid_json "$FDIR/manifest.json"; then
  ok "a multi-line scan reason still yields valid JSON"; else bad "a multi-line scan reason still yields valid JSON"; fi
if grep -q '"failed_stage": "scan"' "$FDIR/manifest.json" 2>/dev/null; then
  ok "FAILED manifest names the scan stage"; else bad "FAILED manifest names the scan stage"; fi
if ! grep -qF -- "$FAKE_ECHO_PROBE" "$FDIR/manifest.json" 2>/dev/null; then
  ok "the matched value never reaches the manifest either"; else bad "the matched value never reaches the manifest either"; fi

echo "make-review-pack.sh — control characters from external commands cannot break the manifest"
# `node --version`, `npm --version` and `uname -sr` are command OUTPUT, not text this script
# composed, and --base is whatever the caller typed. A wrapper that emits an escape sequence
# would put a raw C0 byte in the manifest; JSON requires everything below U+0020 to be escaped
# whether or not it has a short form. The seam feeds VT, ESC, BS and FF in through npm.
R="$(newrepo)"
commit_file "$R" "parking-system/lib/r.ts" "export const r = 1"
OUT="$(cd "$R" && FAKE_NPM_VERSION_SUFFIX=$'\x0b\x1b\x08\x0c' bash "$SCRIPT" --base main 2>&1)"; RC=$?
if [[ $RC -eq 0 ]]; then ok "a control character in npm --version does not fail the run"
  else bad "a control character in npm --version does not fail the run (got $RC)"; fi
if valid_json "$R/.review/manifest.json"; then
  ok "the manifest is still valid JSON"; else bad "the manifest is still valid JSON"; fi
if grep -qF -- '\u000b' "$R/.review/manifest.json" 2>/dev/null \
   && grep -qF -- '\u001b' "$R/.review/manifest.json" 2>/dev/null; then
  ok "control characters with no short form become \\u00XX"; else bad "control characters with no short form become \\u00XX"; fi
if grep -qF -- '\b\f' "$R/.review/manifest.json" 2>/dev/null; then
  ok "backspace and form feed keep their short forms"; else bad "backspace and form feed keep their short forms"; fi
if ! LC_ALL=C grep -q '[[:cntrl:]]' <(tr -d '\n' < "$R/.review/manifest.json") 2>/dev/null; then
  ok "no raw control byte survives into the manifest"; else bad "no raw control byte survives into the manifest"; fi

echo "make-review-pack.sh — editing the pattern file trips its own scanner"
R="$(newrepo)"
printf '\n# added by test\nTOTALLY_FAKE_TOKEN=[a-z]+\n' >> "$R/scripts/review/deny-patterns.txt"
( cd "$R" && git add -A && git commit -qm "edit patterns" ) >/dev/null 2>&1
assert_fail "pattern-file change needs the explicit flag" "$R" "--allow-pattern-file-change"
OUT="$(run_pack "$R" --allow-pattern-file-change)"; RC=$?
if [[ $RC -eq 0 ]]; then ok "the flag lets a deliberate pattern edit through"; else bad "the flag lets a deliberate pattern edit through (got $RC: $(tail -2 <<<"$OUT" | tr '\n' ' '))"; fi

echo "make-review-pack.sh — argument and precondition handling"
R="$(newrepo)"
commit_file "$R" "parking-system/lib/j.ts" "export const j = 1"
OUT="$(cd "$R" && bash "$SCRIPT" --nope 2>&1)"; RC=$?
if [[ $RC -eq 2 ]]; then ok "unknown argument exits 2"; else bad "unknown argument exits 2 (got $RC)"; fi
OUT="$(cd "$R" && bash "$SCRIPT" --base no-such-ref 2>&1)"; RC=$?
if [[ $RC -ne 0 ]] && grep -qF -- "does not resolve" <<<"$OUT"; then
  ok "an unresolvable --base is refused"; else bad "an unresolvable --base is refused (rc=$RC)"; fi

R="$(newrepo)"
assert_fail "no commits between base and HEAD is refused" "$R" "nothing to review"

R="$(newrepo)"
commit_file "$R" "parking-system/lib/k.ts" "export const k = 1"
rm "$R/.github/PULL_REQUEST_TEMPLATE.md"
( cd "$R" && git add -A && git commit -qm "drop template" ) >/dev/null 2>&1
assert_fail "a missing PR template is refused (no second copy exists)" "$R" "PULL_REQUEST_TEMPLATE.md not found"

echo
echo "PASS $PASS   FAIL $FAIL"
[[ $FAIL -eq 0 ]]
