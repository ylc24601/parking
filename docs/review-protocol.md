# Review protocol — 獨立審查怎麼跑

程式：[make-review-pack.sh](../scripts/review/make-review-pack.sh)、[check-review-workspace.sh](../scripts/review/check-review-workspace.sh)、[deny-patterns.txt](../scripts/review/deny-patterns.txt)、[templates/](../scripts/review/templates/)。

這份是**唯一完整規則**。`AGENTS.md`、`CLAUDE.md` 只指過來，不重複內容——兩份會漂移的規則等於沒有規則，同樣的理由寫在 `REVIEW.md` 的產生器標頭裡（"Do not maintain a second template"）。

## 0. 為什麼需要這套

只讀實作者摘要的審查，審的是一段說法，不是一次變更。GitHub 帳號停權期間連 PR 與 CI 這層外部關卡都沒有，所以證據必須由機器產生、由第三方在本機讀。分工固定成：

| 角色 | 是誰 | 邊界 |
|---|---|---|
| implementer | Claude Code | 寫程式、產 packet、寫 RESPONSES |
| independent reviewer | Codex | 只讀，唯一可寫 `.review-notes/` |
| CI / merge | GitHub Actions | 帳號恢復後才回到流程 |

**兩者不共用 session，也不共用 worktree。** 同一個 session 先改再審，是自我背書；同一個工作區審查，會踩到下面第 2 節的機密邊界。

## 1. 完整性與機密性是兩件事

不能互相取代，這份文件所有規則都是這兩條的其中一條：

- **完整性（integrity）**：reviewer 讀的，是不是 packet 所描述的那個 commit 與那份證據？由 SHA、artifact checksum、乾淨工作樹、ancestry 檢查來守。
- **機密性（confidentiality）**：這個工作區能不能讓 reviewer 自由讀？由「專用的無 secret worktree」來守。

## 2. 工作區邊界（機密性）

**在專用的 review worktree 開 reviewer，不要在主工作樹開。**

理由不是整潔。主工作樹有 `parking-system/.env.local`（Supabase service role key、LINE token），review worktree 沒有——`.env*` 是 gitignored，`git worktree add` 不會帶過去。`deny-patterns.txt` 擋的是 packet 內容，讓 reviewer 直接讀主工作樹就整個繞過去了。

**誠實的措辭**：專用的無 secret worktree 是**把暴露面縮到最小的工作區邊界，不是 OS 級 sandbox**。它擋不住 `cat ../../<其他 worktree>/.env.local`、看不到已經 export 到 shell 的環境變數、也管不到 agent 在這個目錄之外的權限。所以以下同時成立，缺一不可：

- reviewer 用 read-only / suggest 權限，不給 Full Access
- 不在主工作樹開 reviewer
- 預設不執行需要 app env 的指令
- 不把 secret export 進 shell environment
- `check-review-workspace.sh` 會檢查工作區內沒有 `.env` / `.env.*`（`*.example` 除外）

## 3. Reviewer 可以做什麼

- 讀 `.review/` 的全部證據，**以及 repository 的實際原始碼**
- `git log` / `git diff` / `rg` / 靜態搜尋
- 針對性的單元測試、ShellCheck、任何無副作用的唯讀指令
- 執行 `scripts/review/check-review-workspace.sh`（只讀，不寫檔）

**不可以**修改任何 tracked 檔案。**唯一允許的寫入是 `.review-notes/`。**

這條要寫死，因為「完全不准寫檔」和「產出 findings artifact」直接衝突。`.review-notes/` 是 gitignored，所以寫 findings 不會讓第 4 節的乾淨工作樹檢查失敗。

## 4. 每次審查的固定動作

前置需求：reviewer 的機器要有 `git`、`bash` 與 **`node`**（`check-review-workspace.sh` 用它讀 manifest，不需要 `node_modules`）。

```bash
# 1. 在 review worktree
scripts/review/check-review-workspace.sh --phase pre     # 輸出整段留著

# 2. 讀證據，順序不要反過來
#    .review/manifest.json → STATUS.txt / COMMITS.txt / FILES.txt
#    → DIFF.patch → logs/ → 最後才是 REVIEW.md（那是敘述）
#    → repository 實際 source

# 3. 寫 findings
cp scripts/review/templates/FINDINGS.md .review-notes/FINDINGS-<head12>.md

# 4. 收尾
scripts/review/check-review-workspace.sh --phase post     # 輸出貼進 findings
```

**驗收條件：沒有 PRECHECK 區塊的 verdict 不採信。** 規則寫在驗收端（implementer 能據以行動的東西），不是執行端——有腳本不等於有人跑，這正是 `app-ci.yml` 存在的同一個理由。

`check-review-workspace.sh` 的判定：

| 結果 | 意思 |
|---|---|
| `VOID` | 這次審查不算數：HEAD 不符、工作樹不乾淨、artifact checksum 不符、ancestry 被改寫、工作區有 secret env 檔、pack 不是 complete |
| `WARN` | 可以審，但要把警告帶進 findings：`base_ref` 移動過、artifact 沒有 checksum（舊 pack）、pack 用了 `--allow-pattern-file-change`（部分掃描被放行）、**或無從得知有沒有用**（舊 pack 沒有記 invocation——這時報 `UNKNOWN`，不會報 PASS） |
| `OK` | 沒有明顯問題——不等於沒有問題，見第 2 節 |

## 5. base 一律從 manifest 讀

`base_ref`、`base_sha`、`merge_base_sha` 全部以 `.review/manifest.json` 為準，**不得假設 base 是 main**。這個 repo 的刀常常疊在尚未合併的上一刀上（stacked branch），把 main 當基準會讀出根本不存在的 finding。

`base_ref != main` 時，findings 必須標示 `Stacked review` 與 base SHA。這樣換下一支 stacked 分支時不需要改任何 prompt。

## 6. 預設不重跑 `npm run verify`

packet 的驗證是在 `git archive HEAD` 的乾淨匯出裡跑的（無 app env、`npm ci` 到 `npm run verify`，exit code 與 raw log 都在 `.review/logs/`）。那比 reviewer 在自己的髒工作樹重跑更有證據力。

只有在以下情況重跑，並在 findings 說明原因：log 不完整、SHA 對不上、懷疑測試沒有覆蓋到某個 finding、或需要針對性驗證。

## 7. Delta review（第二輪以後）

```text
reviewer 提 findings  → .review-notes/FINDINGS-<old12>.md
implementer 修 + 回覆  → .review-notes/RESPONSES-<old12>-to-<new12>.md
重產 packet           → make-review-pack.sh --base <base_ref>
新的 reviewer session → 讀上一輪 FINDINGS + 本輪 RESPONSES + 新 packet
```

- 檔名一律 **12 碼 SHA**，7 碼在這個 repo 的壽命裡不夠。
- 每一輪都開**全新 session**。
- reviewer 要逐項確認「真的修好了」，以實際 source 為準，不是讀 RESPONSES 的說法。
- finding ID（`F-001`…）跨輪穩定，RESPONSES 靠它對應。
- implementer 自己發現、reviewer 沒提的問題，寫成 `S-001…` 一起列出。藏起來會讓審查變成儀式。

## 8. `.review-notes/` 的生命週期

gitignored，**不會被 commit**——它是關於某個 commit 的對話，不是那個 commit 的一部分。刪掉 review worktree 之前要先把整個目錄帶走，否則下一輪的基準就沒了。

**不要放進 `.review/`**：發布 packet 會整個換掉那個目錄（見 `make-review-pack.sh` 的 publish 段），放進去的 findings 會在下次重產時消失。

## 9. 已知限制

- **`--allow-pattern-file-change` 會放行部分秘密掃描。** manifest 的 `invocation` 有記，`check-review-workspace.sh` 會給 WARN，`REVIEW.md` 表格也會顯示。用了就要在 findings 講明白。
- **`npm run verify` 不涵蓋 `scripts/review/` 的 shell 測試與 ShellCheck。** 那兩項只在 `app-ci.yml` 的 `review-pack` job 跑，而該 job 在 GitHub 帳號恢復前一次都沒執行過。packet 不含它們的結果，要另外本機跑並寫進 findings。
- **checksum 防的是誤改，不是偽造。** 能改 artifact 的人也能改 manifest。要防後者需要簽章（signing），那是另一個威脅模型，目前刻意不做。
- **checksum 只存在於 `status: complete` 的 pack。** 失敗的 pack 不寫——對半寫完的 artifact 算雜湊，會把截斷的內容包裝成「已驗證」。所以欄位缺少不代表解析出錯。失敗的 pack 本來也不是證據（checker 一律 VOID）。
- **`schema_version: 1` 的舊 pack 同時缺兩樣東西**：artifact checksum，以及 `--allow-pattern-file-change` 有沒有被用過的紀錄。checker 對後者報 `UNKNOWN` 而不是 PASS——對無從得知的事情給肯定答案，正是這套流程要抓的錯誤型態。要完整證據就重產一次 pack。
- **`check-review-workspace.sh` 需要 `node`**（只用來讀 manifest，不需要 `node_modules`）。這是 **reviewer 端的前置需求**，不是「反正產 pack 的機器有」——protocol 本來就要求審查在另一個工作區、可能是另一台機器上進行，那台機器上有什麼不能靠推論。找不到 `node` 就 VOID：不退回文字解析，也不加 `jq`／`python` 的備援路徑，因為多條路徑就要有多份同樣嚴格的 schema 驗證，而那必然會分岔。
- **checker 驗的是 manifest 的形狀，不是它的真偽。** 拒絕（VOID）的條件：非 JSON；`schema_version` 不是 `1` 或 `2`（**缺值也拒絕**——沒有任何一版 generator 寫過沒有版號的 manifest，所以「缺值」不等於「舊」）；`artifacts` 不是非空字串陣列、或有重複；任一雜湊不是 64 位 hex；`allow_pattern_file_change` 存在但不是 boolean；**checker 會讀進來的那些值**（`status`、四個 `repo.*`、artifact 名稱、checksum key）含控制字元。
- **版號必須約束形狀，不能只是個落在範圍內的數字。** `schema 1` 不得帶 `artifact_sha256` 或 `invocation`（帶了就 VOID）——否則把一份 schema 2 改標成 1、其餘照舊，反而比真正的舊 pack 更不會被警告，因為舊 pack 該缺的證據它都有。`schema 2` 且 `complete` 時，`artifact_sha256` 的 key 集合必須**恰等於** `artifacts`（多一個或少一個都 VOID）。
- **checker 不驗它不讀的欄位**：`created_at`、`invocation.argv`、`tree`、`toolchain`、`verify` 的內容不做型別或字元檢查。這些是給人讀的證據，不參與判定。上一條的控制字元規則只涵蓋會進入 checker 內部傳遞的值，不是整份 manifest。
- **generator 的 schema 升到 3 時，checker 也要一起改。** 版號白名單是刻意的耦合：checker 不知道新版承諾了什麼，就不該給它通過。
- **秘密掃描認得的是已知形狀，不是 PII。** 沒有任何 regex 認得出一個真實會友的名字。真正的控制是建構式的：packet 只包含腳本自己產生的內容。
