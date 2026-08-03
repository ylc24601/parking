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

# edit_manifest <repo> <js statements over `m`>
# Rewrites through JSON.parse/stringify, so the result is pretty-printed with the artifacts array
# spread over several lines. That is deliberate: it is also valid JSON, and every case below now
# runs against a manifest whose formatting differs from the generator's.
edit_manifest() {
  node -e '
    const fs = require("fs"), p = process.argv[1];
    const m = JSON.parse(fs.readFileSync(p, "utf8"));
    (new Function("m", process.argv[2]))(m);
    fs.writeFileSync(p, JSON.stringify(m, null, 2));
  ' "$1/.review/manifest.json" "$2"
}

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
edit_manifest "$R" 'm.status = "failed";'
assert_void "a pack that is not complete" "$R" "pack status is complete"

# An orphan commit is a base that cannot be an ancestor of HEAD — the shape a history rewrite
# under a published pack would leave behind. Written into the manifest directly: the manifest is
# not self-checksummed, and pretending otherwise is what §9 of the protocol says out loud.
R="$(newpacked)"
ORPHAN="$( cd "$R" && git commit-tree "$(git rev-parse 'HEAD^{tree}')" -m orphan </dev/null )"
edit_manifest "$R" "m.repo.base_sha = '$ORPHAN';"
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

# A real schema-1 manifest, not a schema-2 one with the number changed: it has neither the
# checksums nor the invocation record. Both absences have to surface, and neither may be read as
# reassurance. An earlier version of this test only edited the version number, which is why the
# waiver line went on claiming PASS for a pack that could not possibly know.
R="$(newpacked)"
edit_manifest "$R" 'm.schema_version = 1; delete m.artifact_sha256; delete m.invocation;'
OUT="$(run_check "$R")"; RC=$?
if [[ $RC -eq 0 ]] && grep -E 'artifact checksums verified +WARN' <<<"$OUT" >/dev/null; then
  ok "a pack predating checksums warns instead of voiding"; else bad "a pack predating checksums warns (rc=$RC)"; fi
if grep -E 'secret scan fully applied +WARN +UNKNOWN' <<<"$OUT" >/dev/null; then
  ok "an unrecorded waiver reports UNKNOWN, never PASS"; else bad "an unrecorded waiver reports UNKNOWN, never PASS"; fi
if grep -q 'RESULT: WARN' <<<"$OUT"; then
  ok "a schema-1 pack lands on WARN overall"; else bad "a schema-1 pack lands on WARN overall"; fi

R="$(newpacked)"
edit_manifest "$R" 'm.invocation.allow_pattern_file_change = true;'
OUT="$(run_check "$R")"; RC=$?
if [[ $RC -eq 0 ]] && grep -E 'secret scan fully applied +WARN' <<<"$OUT" >/dev/null; then
  ok "a waived pattern-file scan is surfaced as a warning"; else bad "a waived pattern-file scan is surfaced (rc=$RC)"; fi

echo "check-review-workspace.sh — stacked base is stated, not assumed"
R="$(newpacked)"
edit_manifest "$R" 'm.repo.base_ref = "chore/parent-slice";'
OUT="$(run_check "$R")"
if grep -q 'stacked review.*chore/parent-slice.*NOT main' <<<"$OUT"; then
  ok "a non-main base is called out"; else bad "a non-main base is called out"; fi

echo "check-review-workspace.sh — the manifest is read as JSON, not as text"
# The parser used to be grep and awk, which coupled the check to the generator's line breaks and
# truncated any value at the first JSON escape. These are the shapes that silently misread.
R="$(newpacked)"
edit_manifest "$R" 'm.artifacts = m.artifacts.slice();'   # re-emitted multi-line by JSON.stringify
OUT="$(run_check "$R")"; RC=$?
if [[ $RC -eq 0 ]] && grep -E 'artifact checksums verified +PASS +7/7' <<<"$OUT" >/dev/null; then
  ok "a multi-line artifacts array is still read"; else bad "a multi-line artifacts array is still read (rc=$RC)"; fi

R="$(newpacked)"
edit_manifest "$R" 'm.repo.base_ref = String.fromCharCode(102,111,111,34,98,97,114);'
OUT="$(run_check "$R")"
if grep -q 'stacked review.*foo"bar' <<<"$OUT"; then
  ok "a base_ref containing a quote survives the round trip"; else bad "a base_ref containing a quote survives the round trip"; fi

R="$(newpacked)"
printf 'not json at all\n' > "$R/.review/manifest.json"
assert_void "an unparseable manifest" "$R" "manifest schema is valid"

echo "check-review-workspace.sh — a broken manifest voids, it does not degrade to WARN"
# The WARN for a missing checksum exists for packs built before checksums did. A complete
# schema-2 pack that has LOST them is a corrupted integrity record, and letting it take the same
# path would turn the strongest check in the script into an advisory note.
R="$(newpacked)"
edit_manifest "$R" 'm.artifact_sha256 = {};'
assert_void "a complete schema-2 pack with no checksums" "$R" "manifest schema is valid"

R="$(newpacked)"
edit_manifest "$R" 'm.artifact_sha256[m.artifacts[0]] = null;'
assert_void "a null checksum" "$R" "manifest schema is valid"

R="$(newpacked)"
edit_manifest "$R" 'm.artifact_sha256[m.artifacts[0]] = 0;'
assert_void "a numeric checksum" "$R" "manifest schema is valid"

R="$(newpacked)"
edit_manifest "$R" 'm.artifact_sha256[m.artifacts[0]] = "deadbeef";'
assert_void "a checksum that is not 64 hex digits" "$R" "manifest schema is valid"

R="$(newpacked)"
edit_manifest "$R" 'm.artifacts.push({ path: "sneaky" });'
assert_void "a non-string artifact entry" "$R" "manifest schema is valid"

# A tab in a value would split a TSV row and shift every field after it. The emitter refuses
# rather than assuming the generator never writes one.
R="$(newpacked)"
edit_manifest "$R" 'm.repo.base_ref = "main" + String.fromCharCode(9) + "extra";'
assert_void "a control character in a value the checker forwards" "$R" "manifest schema is valid"

R="$(newpacked)"
edit_manifest "$R" 'm.invocation.allow_pattern_file_change = null;'
assert_void "a non-boolean waiver flag" "$R" "manifest schema is valid"

R="$(newpacked)"
edit_manifest "$R" 'm.artifacts = "DIFF.patch";'
assert_void "artifacts that is not an array" "$R" "manifest schema is valid"

echo "check-review-workspace.sh — an unrecognised manifest version is not a permissive default"
# Absent used to mean 0, i.e. "older than checksums", i.e. the most forgiving grade available.
# No generator has ever written a manifest without schema_version, so absent does not mean old.
R="$(newpacked)"
edit_manifest "$R" 'delete m.schema_version;'
assert_void "a manifest with no schema_version" "$R" "manifest schema is valid"

R="$(newpacked)"
edit_manifest "$R" 'm.schema_version = 3;'
assert_void "a manifest newer than this checker" "$R" "manifest schema is valid"

echo "check-review-workspace.sh — every checksum entry is validated, not just the listed ones"
R="$(newpacked)"
edit_manifest "$R" 'm.artifact_sha256["not-an-artifact"] = null;'
assert_void "a checksum entry for a file the pack does not list" "$R" "manifest schema is valid"

R="$(newpacked)"
edit_manifest "$R" 'm.artifact_sha256[m.artifacts[0] + String.fromCharCode(9)] = "0".repeat(64);'
assert_void "a checksum key holding a control character" "$R" "manifest schema is valid"

echo "check-review-workspace.sh — regressions the previous round left untested"
R="$(newpacked)"
edit_manifest "$R" 'm.artifacts = []; m.artifact_sha256 = {};'
assert_void "a pack listing no artifacts at all" "$R" "artifact checksums verified"

R="$(newpacked)"
edit_manifest "$R" 'm.status = "partial";'
assert_void "schema 2 with a status other than complete" "$R" "pack status is complete"

echo "check-review-workspace.sh — argument handling"
R="$(newpacked)"
OUT="$(run_check "$R" --phase sideways)"; RC=$?
if [[ $RC -eq 2 ]]; then ok "an unknown phase exits 2"; else bad "an unknown phase exits 2 (got $RC)"; fi
OUT="$(run_check "$R" --nope)"; RC=$?
if [[ $RC -eq 2 ]]; then ok "an unknown argument exits 2"; else bad "an unknown argument exits 2 (got $RC)"; fi

echo
echo "PASS $PASS   FAIL $FAIL"
[[ $FAIL -eq 0 ]]
