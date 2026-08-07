# Repository guide

短索引，不是規則書。每一條都指向唯一的權威檔案——這裡寫細節就會和那些檔案漂移。

## 版圖

| 路徑 | 是什麼 |
|---|---|
| `parking-system/` | Next.js 應用程式（Vercel 的 Root Directory 就是這裡）。另有 `parking-system/AGENTS.md`。 |
| `scripts/` | 維運腳本：`review/`（審查用具）、`backup/`（DB 備份／還原）。 |
| `docs/` | 權威文件。現況看 `current_handoff.md`，backlog 看 `feature-triage.md`。 |
| 根目錄 `package.json` | 與應用程式無關的 Notion 同步工具，不要在這裡跑應用程式的指令。 |

## 指令

```bash
cd parking-system && npm run verify    # 唯一正規的驗證入口（tsc / lint / test / build）
```

CI 呼叫的是同一個 script，review pack 也是。不要另外複製一份命令清單。

## Code review

要對一支完成的分支做獨立審查：

1. 讀 [`docs/review-protocol.md`](docs/review-protocol.md)——完整規則在那裡。
2. 在**專用的 review worktree** 跑 `scripts/review/check-review-workspace.sh --phase pre`。
3. 讀 `.review/` 的證據，再交叉檢查 repository 的實際原始碼。
4. 不要修改任何 tracked 檔案；唯一可以寫的是 `.review-notes/`。
5. blocker 優先，附檔案與行號。

base **不一定是 main**——一律從 `.review/manifest.json` 讀。

## 資料邊界

這是公開 repo，處理的是真實教會會友資料。任何名冊、電話、匯出的 CSV、`.env*`、DB dump 都不進版控；`.gitignore` 與 `scripts/review/deny-patterns.txt` 是最後一道防線，不是第一道。
