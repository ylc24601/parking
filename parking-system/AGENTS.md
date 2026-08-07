<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- Everything above is generated between the markers; add project rules below them only. -->

# Repository conventions

Repo 版圖、正規驗證指令與資料邊界看根目錄的 [`AGENTS.md`](../AGENTS.md)。
獨立審查的完整流程看 [`docs/review-protocol.md`](../docs/review-protocol.md)。
工作約定（語言、git staging、文件誠實、plan mode 自檢）看 [`docs/working-agreements.md`](../docs/working-agreements.md)。

## 結構

沒有 `src/`。程式碼直接放在：

| 目錄 | 內容 |
|---|---|
| `app/` | App Router 路由與頁面 |
| `lib/` | 共用型別、純函式、client 端也能用的邏輯 |
| `server/` | 只能在 server 端執行的服務、HTTP 輔助、通知 transport |
| `scripts/` | `npm run job:*` / `binding:*` / `members:import` 等 CLI 入口 |
| `supabase/migrations/` | 編號 SQL migration（目前到 `0038`），只增不改 |
| `tests/{unit,integration,fixtures}/` | Vitest 測試 |

### server / client 邊界

凡是讀 env secret、或走 service-role 路徑的模組，都要 `import 'server-only'`，把越界從
「靠註解提醒」變成 build-time error（起於 commit `a199580`）。目前 `lib/` 與 `server/`
底下共 16 個模組掛了這行。新增會碰到 `SUPABASE_SERVICE_ROLE_KEY`、`JOB_TRIGGER_SECRET`、
`CRON_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN` 的模組時比照辦理。route handler 本身是 server
進入點，不需要。

## 測試

`npm run verify` 涵蓋的 149 個測試檔中，**41 個 `*.db.test.ts` 預設跳過**——它們由
`RUN_DB_TESTS=1` 閘門控制，需要本機 Supabase：

```bash
npm run db:start && npm run db:reset
RUN_DB_TESTS=1 npm test
npm run db:verify              # 對 local 跑 schema 斷言
```

新增或修改 migration 後 `npm run db:verify` 必須通過。`db:verify:remote` 是對 prod 跑的
（需要 `SUPABASE_DB_URL`），只在部署流程中使用。

### 測試本身也要審

過去多次的問題是**測試斷言自己有 bug**——selector 有歧義、mock UUID 格式無效、大小寫錯。
測試綠燈不等於測試正確。新寫的斷言要能說出它在防哪一個具體的 regression；
說不出來的斷言通常沒有價值。
