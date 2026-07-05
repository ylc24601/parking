# Dry-run runbook：本機 Supabase + 本機 Next.js + tunnel + 教會正式 OA

> ⚠️ **警告：本 runbook 使用「教會正式 OA」，但只用於本機 dry-run 擷取（capture-only）。請勿啟用 LINE 送出。**
> 全程不對外發送任何訊息、不寫 `users.line_id`；只驗證 webhook 收訊 + `pending_binding` 擷取。
> 搭配 [oa-dry-run-request.md](oa-dry-run-request.md)（給教會管理者）、[oa-dry-run-operator-setup.md](oa-dry-run-operator-setup.md)（後台設定）、[go-live-readiness.md](go-live-readiness.md)（整體規劃）。

需求前提：不建立 Vercel project、不接雲端 Supabase、`LINE_CHANNEL_SECRET` 放 `.env.local`、`NOTIFICATION_TRANSPORT=mock`、`LINE_SEND_ENABLED=false`、**不設定 `LINE_CHANNEL_ACCESS_TOKEN`**、只驗證 `pending_binding` capture。

---

## ✅ 執行結果（2026-07-05，PASS — 使用「開發者/測試 OA」，非教會正式 OA）

> ⚠️ 本次 PASS 是用**開發者自有的測試 OA（developer/test OA）**跑的，**不是教會正式 OA**。
> **教會正式 OA 的 dry-run 仍待進行（pending）。** 本結果**不代表**教會正式 OA 已驗證。

**這次「有」確認（用測試 OA）：**
- tunnel 連通 + LINE console **Verify → 200** + webhook 收訊。
- **簽章驗證**（`x-line-signature` HMAC / `LINE_CHANNEL_SECRET`）正確。
- **`pending_binding` 擷取**：`綁定 TEST01` → 同帳號 `bind test-02` 重送 → **僅一列**（`submitted_code=TEST-02`、`superseded_count=1`、`status=pending`、`last_event_type=message`）⇒ **原地 supersede 確認**（未灌爆表）。
- `你好`（非綁定）**未建列**；測試者**未收到任何回覆**；log **無** userId / code。
- 全程**未送出任何 LINE 訊息**、**未寫 `users.line_id`**；`LINE_CHANNEL_ACCESS_TOKEN` 未設定。

**這次「未」確認（仍待教會正式 OA dry-run）：**
- ❌ 教會正式 OA 的 **channel secret**。
- ❌ 教會正式 OA 的 **webhook 後台設定**。
- ❌ **正式會友的 userId 擷取**（正式環境）。

> 🔒 本次測試擷取到的任何 `line_user_id` 屬**測試 OA、可丟棄**，**不得**當作教會正式綁定資料使用（userId 依 Provider 綁定，測試 OA 的值在正式 OA 無效）。

**結論：程式路徑（tunnel + webhook + 驗簽 + 擷取 + supersede）在測試 OA 上運作正常 → 可據以規劃 Phase 5B（人工審核 → 寫 `users.line_id`，遵守 `users_line_id_key`）。但 go-live 送達前，仍需完成一次「教會正式 OA」的 capture dry-run。** 收尾見第 7 步（webhook 關閉 + URL 清空後才停 tunnel）。

---

## 前置：拿到 channel secret
LINE Developers → 教會 OA 的 **Messaging API channel** → **Basic settings** → 複製 **Channel secret**（等下貼進 `.env.local`）。
> 這是 channel **secret**（驗證收訊用），不是 access token；access token 這次**不要**設。

## 1. 設定 `.env.local`（在 `parking-system/`）
確認以下幾行存在（`SUPABASE_*` 你之前跑測試應該已有；沒有的話下一步會補）：

```
# 本機 Supabase（值來自 `npx supabase status`）
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<local service_role key>

# 本次 dry-run 新增／確認
LINE_CHANNEL_SECRET=<貼上教會 OA 的 channel secret>
NOTIFICATION_TRANSPORT=mock
LINE_SEND_ENABLED=false
# LINE_CHANNEL_ACCESS_TOKEN=   ← 本次 dry-run 必須「保持未設定 / 留空」，切勿填入
```

> ⚠️ `LINE_CHANNEL_ACCESS_TOKEN` **未設定**是本 dry-run 的安全前提之一：沒有 token，系統即使被要求送出也無法送。請確認它不存在於 `.env.local`（或維持註解／空值）。
> ⚠️ `.env.local` 是在 boot 時載入，改完一定要**重啟** `next dev` 才生效。

## 2. 起本機 Supabase 並套用 migration（含 0018）
```bash
cd parking-system
npm run db:start
npm run db:reset          # 套用 0001–0018 + seed（會清掉舊資料，dry-run 用乾淨狀態剛好）
npm run db:verify         # 應印出 23/23 all assertions passed
```
如果 `.env.local` 缺 Supabase 值：
```bash
npx supabase status       # 複製 API URL 與 service_role key 填回 .env.local
```

## 3. 起本機 Next.js
```bash
npm run dev               # 預設 http://localhost:3000
```
記下它實際印出的 port（若 3000 被占用會變 3001，tunnel 要對齊）。

## 4. 開 tunnel（擇一，cloudflared 免註冊）
另開一個終端機：
```bash
cloudflared tunnel --url http://localhost:3000
# 或： ngrok http 3000
```
會印出公開網址，例如 `https://xxxx.trycloudflare.com`。
你的 Webhook URL＝該網址 + `/api/line/webhook`：
```
https://xxxx.trycloudflare.com/api/line/webhook
```

## 5. 設定 LINE 後台
- **LINE Developers → Messaging API**：Webhook URL 貼上第 4 步的網址 → **Use webhook = ON** → 按 **Verify**（應成功／200）。
- **LINE OA Manager（manager.line.biz）→ Settings → Response**：**Auto-reply = OFF、Greeting = OFF**（測試期間）。

## 6. 測試 + 驗證擷取
測試者（已加入教會 OA 的自己 LINE）依序傳：

| 傳送 | 預期 |
|---|---|
| `綁定 TEST01` | 無回覆 |
| `bind test-02` | 無回覆（同帳號重送會原地更新；正規化為 `TEST-02`） |
| `你好` | 無回覆、不建列 |

查 `pending_binding`（另開終端機）。**`line_user_id` 屬敏感資料，查詢以遮罩顯示、不印全值：**
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
"select left(line_user_id, 6) || '…' || right(line_user_id, 4) as line_user_id_masked, \
        submitted_code, status, superseded_count, last_event_type, last_submitted_at \
 from pending_binding order by last_submitted_at desc limit 20;"
```
**通過標準：**
- `綁定 TEST01` → 有一列、`submitted_code=TEST01`。
- 同帳號重送 → **仍是一列**、`superseded_count` 遞增、code 更新成新值。
- `你好` → 沒有新列。
- 測試者**收不到任何回覆**。
- `next dev` 的 log 裡**看不到** userId 或 code。

## 7. 收尾（重要 — tunnel 關掉前先做）
順序：**先關 LINE webhook，再關 tunnel**，避免 tunnel 失效後 LINE 一直重試。

1. **LINE Developers → Messaging API**：**Use webhook = OFF**，並把 **Webhook URL 清空**（雙保險）。
2.（可選）OA Manager 的 auto-reply / greeting 恢復原設定。
3. 清測試資料（對齊第 6 步範例：`TEST01` 與 `bind test-02` → `TEST-02`）：
   ```bash
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
   "delete from pending_binding where submitted_code in ('TEST01','TEST-02');"
   ```
4. 停服務：tunnel 那個終端機 `Ctrl-C` → `next dev` `Ctrl-C` → `npm run db:stop`。

---

## 全程維持關閉（再確認一次）
- ❌ 真實送出：`NOTIFICATION_TRANSPORT=mock`、`LINE_SEND_ENABLED=false`、access token 不設。
- ❌ OA auto-reply / greeting。
- ❌ 任何 `users.line_id` 寫入（Phase 5B 未部署）。

## 收尾完成確認清單
- [x ] LINE webhook OFF（Use webhook = OFF）
- [ x] Webhook URL 已清空
- [ x] tunnel 已停止
- [ x] Next dev 已停止
- [ x] Supabase 已停止（`npm run db:stop`）
- [ x] 未加入 `LINE_CHANNEL_ACCESS_TOKEN`
- [ x] 無任何 `users.line_id` 寫入

---

## 常見卡點
- **Verify 失敗** → 多半是 `.env.local` 改了沒重啟 `next dev`，或 channel secret 貼錯／貼到別的 OA。
- **收到訊息但沒建列** → 檢查 tunnel 網址的 port 跟 `next dev` 實際 port 是否一致；以及訊息格式要是 `綁定 <碼>` / `bind <碼>` 且碼符合 `^[A-Z0-9-]{4,16}$`。
