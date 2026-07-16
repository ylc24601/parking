# Binding-CLI pilot runbook（測試 OA，端到端，無送出）

> 🗄️ **已歸檔（ARCHIVED）**：此 pilot 已於 **2026-07-05** 在開發者自有測試 OA 端到端跑完（Phase 5B），
> 5B 綁定審核之後已包進 Admin UI（`/admin/bindings`，見 handoff §6.27/§6.29）。保留此文件僅作歷史紀錄，
> **不需再執行**。教會**正式** OA 的 capture dry-run 為另一件事、仍屬交付後 ops（見 [../oa-dry-run-tunnel-runbook.md](../oa-dry-run-tunnel-runbook.md)）。

> 目的：在**開發者自有的測試 OA**上，把 5A 擷取 + 5B binding CLI **端到端跑一次**
> （`issue → 會友送碼 → capture → 預覽 → 核准 → 寫 users.line_id → reject`），
> 驗證 operator 工作流與 CLI，**完全不需要教會協調、不對外送任何訊息**。
>
> ⚠️ **本 runbook 使用測試 OA、非教會正式 OA。** 擷取到的 `line_user_id` 屬**測試 OA、可丟棄**
> （per-Provider，在教會正式 OA 無效）；本流程寫入的 `users.line_id` 為**測試資料**，收尾要清掉。
> 全程 `NOTIFICATION_TRANSPORT=mock`、`LINE_SEND_ENABLED=false`、**不設 access token**、**不送出**。
>
> 搭配 [oa-dry-run-tunnel-runbook.md](../oa-dry-run-tunnel-runbook.md)（擷取端）、[binding-ops.md](../binding-ops.md)（CLI 參考）、[go-live-readiness.md](../go-live-readiness.md)。
> 這步**不取代**教會正式 OA capture dry-run（仍為 go-live 前置）。

---

## 1. `.env.local`（`parking-system/`）
```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<local service_role key（npx supabase status）>
LINE_CHANNEL_SECRET=<測試 OA 的 channel secret>
NOTIFICATION_TRANSPORT=mock
LINE_SEND_ENABLED=false
# LINE_CHANNEL_ACCESS_TOKEN=   ← 保持未設定
```
> 改完 `.env.local` 一定要重啟 `next dev`。

## 2. 起本機 DB（含 0019）
```bash
cd parking-system
npm run db:start
npm run db:reset          # 套用 0001–0019 + seed
npm run db:verify         # 24/24
```

## 3. 建一位測試會友（要有 user 才能綁）
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
"insert into users (display_name) values ('Pilot 測試') returning id;"
```
記下回傳的 `id`（下一步 `--user-id`）。

## 4. 起 App + tunnel + 設測試 OA webhook
```bash
npm run dev                                   # 記實際 port
cloudflared tunnel --url http://localhost:3000   # 或 ngrok http 3000
```
- 測試 OA（LINE Developers）→ Messaging API → Webhook URL = `https://<tunnel>/api/line/webhook` → **Use webhook ON** → **Verify（200）**。
- 測試 OA Manager → Auto-reply / Greeting **OFF**。

## 5. 發碼
```bash
npm run binding:issue -- --user-id <上一步的 user id> --ttl-days 14
```
記下印出的 code（**只印這一次**）。

## 6. 送碼（用你自己、已加測試 OA 的 LINE）
在測試 OA 傳：`綁定 <code>`（預期無回覆）。

## 7. 取得 pending id（uuid，非敏感；`line_user_id` 以遮罩顯示）
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
"select id, submitted_code, status, \
        left(line_user_id,6)||'…'||right(line_user_id,4) as line_user_id_masked, last_submitted_at \
 from pending_binding order by last_submitted_at desc limit 5;"
```

## 8. 預覽（dry-run，不寫）
```bash
npm run binding:approve -- --pending-id <pending id>
```
確認：`submittedCodeMasked`、`lineUserIdMasked`、`matchedDisplayName='Pilot 測試'`、`wouldApprove=true`、`reason='approved'`。**輸出不得出現完整 code / line_user_id。**

## 9. 核准（寫入）
```bash
npm run binding:approve -- --pending-id <pending id> --apply
```
預期 `{"approved":1,"reason":"approved"}`。驗證：
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
"select left(line_id,6)||'…'||right(line_id,4) as line_id_masked from users where display_name='Pilot 測試'; \
 select status, approved_at is not null as approved from pending_binding where submitted_code = upper('<code>'); \
 select consumed_at is not null as consumed from binding_codes where code = upper('<code>');"
```
應：`line_id` 已寫、pending `approved`、code `consumed`。

## 10.（可選）試 typed reasons
- 再跑 step 9 同一 pending → `pending_not_pending`（idempotent）。
- 另發一碼但不送、直接對不存在 pending id approve → `pending_not_found`。
- 對另一筆 pending 跑 `binding:reject -- --pending-id <id> --reason duplicate` → `rejected:1`。

## 11. 收尾（先關 webhook 再關 tunnel）
1. 測試 OA → **Use webhook OFF** + **Webhook URL 清空**。
2.（可選）恢復 auto-reply / greeting。
3. 清測試資料（**含丟棄的測試 line_id**）：
   ```bash
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
   "delete from binding_codes where user_id in (select id from users where display_name='Pilot 測試'); \
    delete from pending_binding where line_user_id in (select line_id from users where display_name='Pilot 測試'); \
    delete from users where display_name='Pilot 測試';"
   ```
4. 停服務：tunnel `Ctrl-C` → `next dev` `Ctrl-C` → `npm run db:stop`。

---

## 完成確認清單
- [ ] `binding:issue` 產碼並只印一次
- [ ] 送 `綁定 <code>` 後有 pending、無回覆
- [ ] `binding:approve`（無 `--apply`）預覽遮罩、不寫入
- [ ] `binding:approve --apply` 寫入 `users.line_id`、code consumed、pending approved
- [ ] 輸出/log 無完整 `line_user_id`、無完整 code（issue 一次性印碼除外）
- [ ] reject 與至少一個 typed reason 驗過
- [ ] 測試 webhook OFF + URL 清空
- [ ] tunnel / next dev / Supabase 皆停止
- [ ] 測試資料（含丟棄 line_id）已清除
- [ ] 未設 `LINE_CHANNEL_ACCESS_TOKEN`、全程未送出

---

**通過後：** operator 綁定工作流已驗證 → 下一步進行**教會正式 OA capture dry-run**（見 [oa-dry-run-tunnel-runbook.md](../oa-dry-run-tunnel-runbook.md)），那步才驗證教會 OA channel secret / webhook 設定 / 正式會友 userId 擷取。
