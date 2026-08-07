#!/usr/bin/env python3
"""掃描「即將進 commit 的新增內容」有沒有個資或機密樣式。

只看 diff 的**新增行**，不看整個檔案 —— 否則每次碰到一個歷史上含測試門號的
檔案都會重新告警一次，噪音會把訊號淹掉。

範圍：優先 staged（`git diff --cached`）；沒有 staged 就看 working tree vs HEAD。
未追蹤檔不掃，它們還沒要進版控。

exit 0 = 乾淨；exit 1 = 有疑慮，需要人看過。
"""

import re
import subprocess
import sys

PATTERNS = [
    ("疑似手機號碼", re.compile(r"09\d{2}-?\d{3}-?\d{3}")),
    ("疑似身分證字號", re.compile(r"\b[A-Z][12]\d{8}\b")),
    ("疑似個人 Email", re.compile(r"[\w.%+-]+@(?:gmail|yahoo|hotmail|outlook|icloud)\.[a-z.]{2,}", re.I)),
]
DATA_SUFFIXES = (".csv", ".tsv", ".xls", ".xlsx")


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=False
    ).stdout


def main() -> int:
    scope = "staged"
    base = ["diff", "--cached"]
    if not git("diff", "--cached", "--name-only", "--diff-filter=ACM").strip():
        scope = "working tree vs HEAD"
        base = ["diff", "HEAD"]

    names = [n for n in git(*base, "--name-only", "--diff-filter=ACM").splitlines() if n]
    print(f"掃描範圍：{scope}（{len(names)} 個檔案的新增行）")
    if not names:
        print("沒有變更，略過。")
        return 0

    findings = []

    for n in names:
        if n.lower().endswith(DATA_SUFFIXES):
            findings.append((n, "資料檔", "確認已去識別化，或它本來就該入版控"))

    current = None
    for line in git(*base, "-U0", "--diff-filter=ACM").splitlines():
        if line.startswith("+++ b/"):
            current = line[6:]
            continue
        if not line.startswith("+") or line.startswith("+++"):
            continue
        added = line[1:]
        for label, pat in PATTERNS:
            m = pat.search(added)
            if m:
                snippet = added.strip()
                if len(snippet) > 90:
                    snippet = snippet[:90] + "…"
                findings.append((current or "?", label, f"{m.group(0)}  ←  {snippet}"))

    if not findings:
        print("新增行中未發現個資樣式。")
        return 0

    print(f"\n{len(findings)} 項需要人看過：")
    for path, label, detail in findings:
        print(f"  [{label}] {path}")
        print(f"      {detail}")
    print("\n若確認是測試用假資料，這次可以放行；若是真實個資，這個 repo 是公開的。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
