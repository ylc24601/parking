#!/usr/bin/env bash
#
# Tests for check-review-workspace.sh. Same shape as test-review-pack.sh: throwaway git repos
# under mktemp and a fake `npm` on PATH, so nothing here touches the real repo or the network.
#
# What this covers: that every VOID actually voids, that the things which are NOT grounds to
# void (a rebased base branch, an old pack) come out as WARN with exit 0, and that the script
# leaves the workspace exactly as it found it.
#
# Why that last one is a test and not a comment: the script is meant to be run by a reviewer
# operating under read-only permissions. If it ever created so much as a temp file, it would
# both violate that and trip its own clean-tree check on the next run.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="$HERE/check-review-workspace.sh"
PACK_SCRIPT="$HERE/make-review-pack.sh"
PATTERNS="$HERE/deny-patterns.txt"
PASS=0; FAIL=0

ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }

TMP="$(mktemp -d)"; FAKEBIN="$(mktemp -d)"
trap 'rm -rf "$TMP" "$FAKEBIN"' EXIT

cat >"$FAKEBIN/npm" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  --version) echo "0.0.0-fake"; exit 0 ;;
  *) echo "fake npm ${1:-}"; exit 0 ;;
esac
EOF
chmod +x "$FAKEBIN/npm"
export PATH="$FAKEBIN:$PATH"

# A repo with a published .review/ pack, ready to be checked.
newpacked() {
  local d
  d="$(mktemp -d "$TMP/repo.XXXXXX")"
  mkdir -p "$d/parking-system" "$d/.github" "$d/scripts/review"
  (
    cd "$d" || exit 1
    git init -q -b main .
    git config user.email "test@example.invalid"
    git config user.name "Test"
    printf '{"name":"x","scripts":{"verify":"true"}}\n' > parking-system/package.json
    printf '## slice\n\n- **A — old app + new DB** SAFE / UNSAFE\n' > .github/PULL_REQUEST_TEMPLATE.md
    printf '.review/\n.review-notes/\n' > .gitignore
    cp "$PATTERNS" scripts/review/deny-patterns.txt
    git add -A && git commit -qm "base"
    git checkout -qb work
    printf 'export const a = 1\n' > parking-system/a.ts
    git add -A && git commit -qm "add a"
    bash "$PACK_SCRIPT" --base main
  ) >/dev/null 2>&1
  echo "$d"
}

# run_check <repo> [args...] -> prints output, returns exit code
run_check() { local d="$1"; shift; ( cd "$d" && bash "$CHECK" "$@" ) 2>&1; }

# assert_void <desc> <repo> <line-fragment>
assert_void() {
  local desc="$1" d="$2" frag="$3"
  local out rc
  out="$(run_check "$d")"; rc=$?
  if [[ $rc -ne 1 ]]; then bad "$desc (expected exit 1, got $rc)"; return; fi
  if ! grep -q 'RESULT: VOID' <<<"$out"; then bad "$desc (no VOID result)"; return; fi
  if ! grep -q "$frag" <<<"$out" || ! grep -E "$frag.*VOID" <<<"$out" >/dev/null; then
    bad "$desc (VOID was not attributed to '$frag')"; return
  fi
  ok "$desc"
}

echo "check-review-workspace.sh — a clean workspace with a fresh pack"
R="$(newpacked)"
OUT="$(run_check "$R")"; RC=$?
if [[ $RC -eq 0 ]]; then ok "exits 0"; else bad "exits 0 (got $RC: $(tail -3 <<<"$OUT" | tr '\n' ' '))"; fi
if grep -q 'RESULT: OK' <<<"$OUT"; then ok "reports OK"; else bad "reports OK ($(tail -1 <<<"$OUT"))"; fi
if grep -q 'artifact checksums verified .*PASS.*7/7' <<<"$OUT" \
   || grep -qE 'artifact checksums verified +PASS +7/7' <<<"$OUT"; then
  ok "verifies every artifact checksum"; else bad "verifies every artifact checksum"; fi
if grep -q 'packet_manifest_sha256' <<<"$OUT"; then
  ok "prints the manifest sha256 for the findings header"; else bad "prints the manifest sha256"; fi
if grep -q 'phase: pre' <<<"$OUT"; then ok "labels the phase"; else bad "labels the phase"; fi
OUT2="$(run_check "$R" --phase post)"
if grep -q 'phase: post' <<<"$OUT2"; then ok "--phase post is labelled too"; else bad "--phase post is labelled"; fi

echo "check-review-workspace.sh — the check itself changes nothing"
BEFORE="$(cd "$R" && git status --porcelain --untracked-files=all)"
AFTER="$(run_check "$R" >/dev/null 2>&1; cd "$R" && git status --porcelain --untracked-files=all)"
if [[ "$BEFORE" == "$AFTER" ]]; then ok "leaves the working tree untouched"; else bad "leaves the working tree untouched"; fi

echo "check-review-workspace.sh — integrity failures void the review"
R="$(newpacked)"
( cd "$R" && git commit -q --allow-empty -m "moved on" ) >/dev/null 2>&1
assert_void "HEAD moved away from the packed commit" "$R" "HEAD == manifest head_sha"

R="$(newpacked)"
printf 'left behind\n' > "$R/parking-system/stray.ts"
assert_void "an untracked file in the workspace" "$R" "tree clean"

R="$(newpacked)"
printf 'x' >> "$R/.review/DIFF.patch"
assert_void "a tampered artifact" "$R" "artifact checksums verified"

R="$(newpacked)"
sed 's/"status": "complete"/"status": "failed"/' "$R/.review/manifest.json" > "$R/.review/m.tmp" \
  && mv "$R/.review/m.tmp" "$R/.review/manifest.json"
assert_void "a pack that is not complete" "$R" "pack status is complete"

# An orphan commit is a base that cannot be an ancestor of HEAD — the shape a history rewrite
# under a published pack would leave behind. Written into the manifest directly: the manifest is
# not self-checksummed, and pretending otherwise is what §9 of the protocol says out loud.
R="$(newpacked)"
ORPHAN="$( cd "$R" && git commit-tree "$(git rev-parse 'HEAD^{tree}')" -m orphan </dev/null )"
sed "s/\"base_sha\": \"[0-9a-f]*\"/\"base_sha\": \"$ORPHAN\"/" "$R/.review/manifest.json" > "$R/.review/m.tmp" \
  && mv "$R/.review/m.tmp" "$R/.review/manifest.json"
assert_void "a base that is no longer an ancestor" "$R" "still an ancestor"

R="$(newpacked)"
# Split so no line of THIS file matches deny-patterns.txt — written out literally, the pack
# script correctly refuses to pack its own test suite. Same dodge as test-review-pack.sh.
SRK="SUPABASE_SERVICE_ROLE""_KEY"
printf '%s=nope\n' "$SRK" > "$R/parking-system/.env.local"
OUT="$(run_check "$R")"
if grep -E 'no secret env file in workspace +VOID' <<<"$OUT" >/dev/null; then
  ok "a secret env file in the workspace"; else bad "a secret env file in the workspace"; fi

R="$(newpacked)"
rm -rf "$R/.review"
OUT="$(run_check "$R")"; RC=$?
if [[ $RC -eq 1 ]] && grep -q 'manifest is readable' <<<"$OUT"; then
  ok "no pack at all"; else bad "no pack at all (rc=$RC)"; fi

echo "check-review-workspace.sh — things that are not grounds to void"
# A stacked slice gets rebased while it waits for review. That moves base_ref without saying
# anything about the head under review, so it warns and the review still counts.
R="$(newpacked)"
( cd "$R" && git checkout -q main && git commit -q --allow-empty -m "base moved" && git checkout -q work ) >/dev/null 2>&1
OUT="$(run_check "$R")"; RC=$?
if [[ $RC -eq 0 ]]; then ok "a moved base_ref still exits 0"; else bad "a moved base_ref still exits 0 (got $RC)"; fi
if grep -q 'RESULT: WARN' <<<"$OUT"; then ok "a moved base_ref warns"; else bad "a moved base_ref warns"; fi
if grep -E 'base_ref unmoved since the pack +WARN' <<<"$OUT" >/dev/null; then
  ok "the warning names base_ref"; else bad "the warning names base_ref"; fi

R="$(newpacked)"
sed 's/"schema_version": 2/"schema_version": 1/' "$R/.review/manifest.json" > "$R/.review/m.tmp" \
  && mv "$R/.review/m.tmp" "$R/.review/manifest.json"
OUT="$(run_check "$R")"; RC=$?
if [[ $RC -eq 0 ]] && grep -E 'artifact checksums verified +WARN' <<<"$OUT" >/dev/null; then
  ok "a pack predating checksums warns instead of voiding"; else bad "a pack predating checksums warns (rc=$RC)"; fi

R="$(newpacked)"
sed 's/"allow_pattern_file_change": false/"allow_pattern_file_change": true/' "$R/.review/manifest.json" > "$R/.review/m.tmp" \
  && mv "$R/.review/m.tmp" "$R/.review/manifest.json"
OUT="$(run_check "$R")"; RC=$?
if [[ $RC -eq 0 ]] && grep -E 'secret scan fully applied +WARN' <<<"$OUT" >/dev/null; then
  ok "a waived pattern-file scan is surfaced as a warning"; else bad "a waived pattern-file scan is surfaced (rc=$RC)"; fi

echo "check-review-workspace.sh — stacked base is stated, not assumed"
R="$(newpacked)"
sed 's/"base_ref": "main"/"base_ref": "chore\/parent-slice"/' "$R/.review/manifest.json" > "$R/.review/m.tmp" \
  && mv "$R/.review/m.tmp" "$R/.review/manifest.json"
OUT="$(run_check "$R")"
if grep -q 'stacked review.*chore/parent-slice.*NOT main' <<<"$OUT"; then
  ok "a non-main base is called out"; else bad "a non-main base is called out"; fi

echo "check-review-workspace.sh — argument handling"
R="$(newpacked)"
OUT="$(run_check "$R" --phase sideways)"; RC=$?
if [[ $RC -eq 2 ]]; then ok "an unknown phase exits 2"; else bad "an unknown phase exits 2 (got $RC)"; fi
OUT="$(run_check "$R" --nope)"; RC=$?
if [[ $RC -eq 2 ]]; then ok "an unknown argument exits 2"; else bad "an unknown argument exits 2 (got $RC)"; fi

echo
echo "PASS $PASS   FAIL $FAIL"
[[ $FAIL -eq 0 ]]
