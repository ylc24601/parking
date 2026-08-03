#!/usr/bin/env bash
#
# Check that this workspace is a legitimate place to review the pack sitting in .review/, and
# that the pack has not moved under the reviewer's feet.
#
#   scripts/review/check-review-workspace.sh [--phase pre|post]
#
# Run it before the review and again after. Paste the output block into the findings file:
# docs/review-protocol.md makes a verdict without one inadmissible. That rule is the point.
# A check nobody runs is a comment, so the enforcement lives at the acceptance end — in what
# the implementer is allowed to act on — not in the reviewer's memory.
#
# Two different properties are at stake and they do not substitute for each other:
#
#   INTEGRITY    — is this the commit and the evidence the pack describes? HEAD, the artifact
#                  checksums, the clean tree and the ancestry check answer that.
#   CONFIDENTIALITY — is this a workspace where a reviewer can read freely? The env-file check
#                  answers only the narrow version of that question.
#
# WHAT THIS DOES NOT PROVE. A dedicated review worktree with no .env.local is a work-area
# boundary that keeps the blast radius small. It is NOT an OS sandbox. It cannot stop `cat
# ../../other-worktree/.env.local`, it does not see secrets already exported into the shell,
# and it says nothing about what the agent's own permissions allow outside this directory.
# Read a PASS here as "nothing obvious is wrong", never as "nothing can go wrong".
#
# This script only reads. It is meant to be run by a reviewer operating under read-only
# permissions, so it must never create, move or delete anything — including a temp file.

# Deliberately not `set -e`: every check runs, and the report lists all of them. Exiting at the
# first failure would hide the rest, and a partial report is the thing that gets misread as a
# clean one.
set -uo pipefail

PROG="$(basename "$0")"
PHASE="pre"

usage() {
  cat <<EOF
usage: $PROG [--phase pre|post]

  --phase pre   before reading the pack (default)
  --phase post  after the review, to show the snapshot did not move underneath it

exit: 0 = OK or WARN (review may proceed), 1 = VOID (review is not valid), 2 = usage error
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase)
      PHASE="${2:-}"
      case "$PHASE" in pre|post) ;; *) echo "$PROG: --phase must be pre or post" >&2; exit 2 ;; esac
      shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "$PROG: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

VOID=0
WARN=0

# name, verdict, detail — fixed-width so a pasted block stays readable in a findings file.
report() { printf '  %-34s %-4s %s\n' "$1" "$2" "${3:-}"; }
void()   { VOID=$((VOID+1)); report "$1" "VOID" "${2:-}"; }
warn()   { WARN=$((WARN+1)); report "$1" "WARN" "${2:-}"; }
pass()   { report "$1" "PASS" "${2:-}"; }
info()   { report "$1" "--"   "${2:-}"; }

echo "REVIEW WORKSPACE CHECK — phase: $PHASE — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  void "inside a git repository" "no"
  echo "RESULT: VOID"
  exit 1
fi
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || { echo "RESULT: VOID"; exit 1; }

MANIFEST=".review/manifest.json"

if [[ ! -r "$MANIFEST" ]]; then
  void "pack manifest is readable" "$MANIFEST missing — nothing to review against"
  echo "RESULT: VOID"
  exit 1
fi

# The manifest is JSON, so it is parsed as JSON. An earlier version read it with grep and awk to
# keep the script dependency-free; that bought nothing real — `node` is already required to build
# a pack — and it cost a class of silent misreads: the parse was coupled to the generator's line
# breaks, it mangled any artifact name containing a space, and it truncated a base_ref at the
# first JSON escape (a branch may legally be named `foo"bar`). A checker whose output decides
# whether a review counts must not have inputs it quietly gets wrong.
#
# One node call, emitting TSV. The framing is safe because the emitter REJECTS any value holding
# a control character rather than assuming none can appear — "the generator only writes tame
# strings" is an assumption about the very input this check exists to distrust.
if ! command -v node >/dev/null; then
  void "manifest is parseable" "node not found — this pack cannot be verified here"
  echo "RESULT: VOID"
  exit 1
fi

# The node program is single-quoted deliberately — bash must not expand anything inside it. The
# only $ it contains is the end anchor of the sha256 regex.
# shellcheck disable=SC2016
MANIFEST_TSV="$(node -e '
const fs = require("fs");
// Nothing is printed until every field has been validated, so a rejection is one line and the
// caller can never act on a half-emitted record.
const die = (why) => { console.log("invalid\t" + why); process.exit(4); };

let m;
try { m = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (e) { die("not valid JSON"); }
if (m === null || typeof m !== "object" || Array.isArray(m)) die("top level is not an object");

// Parsing is not validating. JSON.parse happily returns null, 0 or an object where a checksum
// belongs, and every one of those would have read downstream as "no checksum recorded" — which
// is the WARN path meant for genuinely old packs. A corrupted integrity record must not be able
// to present itself as a merely incomplete one.
const CTRL = /[\u0000-\u001f\u007f]/;                 // also guards the TSV framing below
const obj = (v, what) => {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) die(what + " is not an object");
  return v;
};
const text = (v, what) => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") die(what + " is not a string");
  if (CTRL.test(v)) die(what + " contains a control character");
  return v;
};

// An absent version used to default to 0, which read as "older than checksums" — the most
// permissive answer available. But no version of the generator has ever written a manifest
// without schema_version, so absent does not mean old, it means this did not come from here.
// An unknown FUTURE version is refused for the mirror-image reason: this checker does not know
// what rules that version promises. Raising the schema in the generator therefore requires
// touching this list too, which is the intended coupling.
const schemaRaw = m.schema_version;
if (!Number.isInteger(schemaRaw)) die("schema_version is missing or not an integer");
const schema = schemaRaw;
if (schema < 1 || schema > 2) die("schema_version " + schema + " is not one this checker understands (1 or 2)");
const status = text(m.status, "status");
const repo = obj(m.repo, "repo");

const inv = obj(m.invocation, "invocation");
let waiver = "unknown";
if ("allow_pattern_file_change" in inv) {
  if (typeof inv.allow_pattern_file_change !== "boolean") die("allow_pattern_file_change is not a boolean");
  waiver = String(inv.allow_pattern_file_change);
}

const artifacts = m.artifacts === undefined ? [] : m.artifacts;
if (!Array.isArray(artifacts)) die("artifacts is not an array");
artifacts.forEach((a, i) => {
  if (typeof a !== "string" || a === "") die("artifacts[" + i + "] is not a non-empty string");
  if (CTRL.test(a)) die("artifacts[" + i + "] contains a control character");
});

// Every entry is validated, not only the ones `artifacts` asks about. Walking the artifact list
// and looking each name up left the rest of the map unexamined, so a manifest could carry junk
// keys with null or object values and still be called valid — while the docs claimed every hash
// was checked. The key set must match `artifacts` exactly: an entry for a file the pack does not
// list describes evidence nobody will read, and there is no reason to allow it.
// `hasOwnProperty` rather than `in`, so an inherited name like "toString" is not mistaken for a
// recorded hash.
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const hashes = m.artifact_sha256 === undefined ? null : obj(m.artifact_sha256, "artifact_sha256");
const HEX = /^[0-9a-f]{64}$/;
if (hashes !== null) {
  const listed = new Set(artifacts);
  for (const k of Object.keys(hashes)) {
    if (k === "" || CTRL.test(k)) die("artifact_sha256 has a malformed key");
    if (!listed.has(k)) die("artifact_sha256 has an entry not listed in artifacts: " + k);
    const h = hashes[k];
    if (typeof h !== "string" || !HEX.test(h)) die("artifact_sha256[" + k + "] is not a sha256 hex string");
  }
}
const rows = artifacts.map((a) =>
  (hashes !== null && own(hashes, a)) ? [a, hashes[a]] : [a, ""]);

// A pack that is old enough to predate checksums may go without them; one that claims to carry
// them may not. Otherwise stripping artifact_sha256 from a complete pack would turn a VOID into
// a WARN and hand the reviewer a pack whose evidence cannot be tied to anything.
if (schema >= 2 && status === "complete") {
  for (const [a, h] of rows) if (h === "") die("schema " + schema + " complete pack has no checksum for " + a);
}

// Resolved before anything is printed. Validating inside the print calls below would emit the
// first few rows and only then reject, leaving the caller a truncated record with the rejection
// buried in the middle of it — which is what the comment at the top of this program promises
// does not happen.
const headSha = text(repo.head_sha, "repo.head_sha");
const baseSha = text(repo.base_sha, "repo.base_sha");
const baseRef = text(repo.base_ref, "repo.base_ref");
const mergeBaseSha = text(repo.merge_base_sha, "repo.merge_base_sha");

const p = (k, v) => console.log(k + "\t" + v);
p("status", status);
p("schema_version", String(schema));
p("head_sha", headSha);
p("base_sha", baseSha);
p("base_ref", baseRef);
p("merge_base_sha", mergeBaseSha);
// Absent is not the same as false. A pack built before the waiver was recorded cannot tell us
// either way, and saying "unknown" is the whole point of this line.
p("waiver", waiver);
for (const [a, h] of rows) console.log("artifact\t" + a + "\t" + h);
' "$MANIFEST" 2>/dev/null)"

if [[ -z "$MANIFEST_TSV" ]]; then
  void "manifest is parseable" "node could not read $MANIFEST"
  echo "RESULT: VOID"
  exit 1
fi
if [[ "$MANIFEST_TSV" == "invalid"$'\t'* ]]; then
  void "manifest schema is valid" "${MANIFEST_TSV#invalid$'\t'}"
  echo "RESULT: VOID"
  exit 1
fi

STATUS=""; SCHEMA=""; HEAD_SHA=""; BASE_SHA=""; BASE_REF=""; MERGE_BASE_SHA=""; WAIVED=""
while IFS=$'\t' read -r key val _rest; do
  case "$key" in
    status)         STATUS="$val" ;;
    schema_version) SCHEMA="$val" ;;
    head_sha)       HEAD_SHA="$val" ;;
    base_sha)       BASE_SHA="$val" ;;
    base_ref)       BASE_REF="$val" ;;
    merge_base_sha) MERGE_BASE_SHA="$val" ;;
    waiver)         WAIVED="$val" ;;
  esac
done <<< "$MANIFEST_TSV"

MANIFEST_SHA="$(if command -v sha256sum >/dev/null; then sha256sum "$MANIFEST"; else shasum -a 256 "$MANIFEST"; fi | awk '{print $1}')"

# ── integrity ───────────────────────────────────────────────────────────────────
if [[ "$STATUS" == "complete" ]]; then
  pass "pack status is complete"
else
  void "pack status is complete" "status=${STATUS:-unreadable} — a failed pack is not evidence"
fi

NOW_HEAD="$(git rev-parse HEAD 2>/dev/null)"
if [[ -n "$HEAD_SHA" && "$NOW_HEAD" == "$HEAD_SHA" ]]; then
  pass "HEAD == manifest head_sha" "${HEAD_SHA:0:12}"
else
  void "HEAD == manifest head_sha" "manifest ${HEAD_SHA:0:12} vs working ${NOW_HEAD:0:12}"
fi

# --untracked-files=all, stricter than the pack script's own precondition. Building a pack only
# requires the TRACKED tree to match HEAD; reviewing one requires that the reviewer has left
# nothing behind at all. .review-notes/ is gitignored, so writing findings does not trip this.
DIRT="$(git status --porcelain --untracked-files=all 2>/dev/null)"
if [[ -z "$DIRT" ]]; then
  pass "tree clean (incl. untracked)"
else
  void "tree clean (incl. untracked)" "$(printf '%s' "$DIRT" | grep -c '') entry/entries present"
fi

if [[ -z "$BASE_SHA" ]]; then
  void "base_sha still an ancestor" "base_sha missing from manifest"
elif git merge-base --is-ancestor "$BASE_SHA" HEAD 2>/dev/null; then
  pass "base_sha still an ancestor" "${BASE_SHA:0:12}"
else
  void "base_sha still an ancestor" "history was rewritten under this pack"
fi

# ── artifact checksums ──────────────────────────────────────────────────────────
# Reaching a missing hash here means a legacy pack: the emitter above already refuses a
# schema >= 2 complete pack that has lost its checksums, so that case voids and never arrives
# as a WARN the reviewer could read past.
bad_files=""
checked=0
unhashed=0
while IFS=$'\t' read -r key name want; do
  [[ "$key" == "artifact" ]] || continue
  checked=$((checked+1))
  if [[ -z "$want" ]]; then unhashed=$((unhashed+1)); continue; fi
  if [[ ! -r ".review/$name" ]]; then bad_files="$bad_files $name(missing)"; continue; fi
  got="$(if command -v sha256sum >/dev/null; then sha256sum ".review/$name"; else shasum -a 256 ".review/$name"; fi | awk '{print $1}')"
  [[ "$want" == "$got" ]] || bad_files="$bad_files $name"
done <<< "$MANIFEST_TSV"

if [[ $checked -eq 0 ]]; then
  void "artifact checksums verified" "no artifacts listed in the manifest"
elif [[ -n "$bad_files" ]]; then
  void "artifact checksums verified" "mismatch:$bad_files"
elif [[ $unhashed -gt 0 ]]; then
  warn "artifact checksums verified" "$unhashed of $checked carry no hash — legacy pack (schema ${SCHEMA:-?}); rebuild it to get evidence"
else
  pass "artifact checksums verified" "$checked/$checked"
fi

# ── confidentiality (narrow: see the header) ────────────────────────────────────
ENV_HITS="$(find . \( -name node_modules -o -name .git \) -prune -o \
  \( -name '.env' -o -name '.env.*' \) ! -name '*.example' -print 2>/dev/null)"
if [[ -z "$ENV_HITS" ]]; then
  pass "no secret env file in workspace"
else
  void "no secret env file in workspace" "$(printf '%s' "$ENV_HITS" | grep -c '') found — review in a dedicated worktree, not here"
fi

# ── advisory ────────────────────────────────────────────────────────────────────
# A moved base is normal for a stacked slice being rebased; it does not invalidate a review of
# THIS head, so it is a warning, not a verdict. Only a rewritten ancestry (above) voids.
if [[ -n "$BASE_REF" ]]; then
  NOW_BASE="$(git rev-parse --verify --quiet "$BASE_REF^{commit}" 2>/dev/null)"
  if [[ -z "$NOW_BASE" ]]; then
    warn "base_ref unmoved since the pack" "$BASE_REF no longer resolves here"
  elif [[ "$NOW_BASE" == "$BASE_SHA" ]]; then
    pass "base_ref unmoved since the pack" "$BASE_REF"
  else
    warn "base_ref unmoved since the pack" "$BASE_REF now ${NOW_BASE:0:12}, pack used ${BASE_SHA:0:12}"
  fi
fi

# "Absent" gets its own answer. A pack built before the waiver was recorded cannot show whether
# --allow-pattern-file-change was used, and reporting PASS there would be an affirmative claim
# about something unknowable — the exact failure mode this protocol exists to catch elsewhere.
case "$WAIVED" in
  true)  warn "secret scan fully applied" "built with --allow-pattern-file-change — part of the scan was waived" ;;
  false) pass "secret scan fully applied" ;;
  *)     warn "secret scan fully applied" "UNKNOWN — pack predates waiver recording (schema ${SCHEMA:-?}); the waiver cannot be ruled out" ;;
esac

if [[ -n "$BASE_REF" && "$BASE_REF" != "main" ]]; then
  info "stacked review" "base is $BASE_REF @ ${BASE_SHA:0:12} — NOT main"
else
  info "stacked review" "no — base is main"
fi

info "merge_base_sha" "${MERGE_BASE_SHA:0:12}"
info "packet_manifest_sha256" "$MANIFEST_SHA"

echo
if [[ $VOID -gt 0 ]]; then
  echo "RESULT: VOID ($VOID failed, $WARN warning(s)) — this review cannot be accepted"
  exit 1
elif [[ $WARN -gt 0 ]]; then
  echo "RESULT: WARN ($WARN) — review may proceed; carry the warning into the findings"
  exit 0
else
  echo "RESULT: OK"
  exit 0
fi
