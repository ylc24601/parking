# Phase 5A Production-OA Dry-Run — 後台操作交接（給 LINE 後台操作者）

> 用途：給實際操作 LINE Developers console + OA Manager 的人（教會管理者或工程端）。
> 搭配非技術版請求信 [oa-dry-run-request.md](oa-dry-run-request.md)；整體規劃 [go-live-readiness.md](go-live-readiness.md)。
> **本階段 capture-only：不發送任何訊息、不寫 `users.line_id`。** 目的只驗證 webhook 收訊 + 綁定申請擷取。

---

## 0. 前提

- Webhook 端點須為公開 HTTPS：正式部署，或用 tunnel（ngrok / cloudflared）指到本機。
- 測試者＝少數同工，用自己已加入教會 OA 的 LINE 帳號。

## 1. 部署端 env（工程端設定）

```
LINE_CHANNEL_SECRET=<church OA channel secret>   # 必填 — 缺少則每筆請求驗簽失敗（401），什麼都不寫
NOTIFICATION_TRANSPORT=mock                        # 正式預約通知維持關閉
LINE_SEND_ENABLED=false                            # 送出鎖
# LINE_CHANNEL_ACCESS_TOKEN=  ← 本階段留空（5A 不發送）
```

## 2. LINE Developers console（developers.line.biz → 教會 OA 的 Messaging API channel）

| 項目 | 動作 |
|---|---|
| **Channel secret** | *Basic settings* 取得 → 交給工程端當 `LINE_CHANNEL_SECRET` |
| **Webhook URL** | *Messaging API* 分頁 → 填 `https://<host>/api/line/webhook` |
| **Use webhook** | 切 **ON** |
| **Verify** | 按下 → 預期成功（200） |
| **Channel access token** | 本階段**不需要**、不提供（無發送） |

## 3. LINE OA Manager（manager.line.biz → 教會 OA → Settings → Response）

- **Auto-reply messages = OFF**
- **Greeting messages = OFF**
- 原因：這是 LINE 內建自動回覆／歡迎訊息，與本系統無關；我們的 webhook 本來就零回覆，關掉可避免測試者收到混淆訊息。
- 皆為**測試期間**設定，事後可恢復（若教會依賴歡迎訊息，改低流量時段測試亦可）。

## 4. 測試訊息（測試者傳給教會 OA）

| 傳送 | 預期 |
|---|---|
| `綁定 TEST01` | 無回覆；產生 1 筆待綁定，`submitted_code=TEST01` |
| `bind test-02` | 無回覆；同帳號重送會**原地更新**，正規化為 `TEST-02`、`superseded_count` +1 |
| `你好`（非綁定文字） | 無回覆；**不產生任何列** |

## 5. 驗證 pending_binding（限工程／管理者查詢 — `line_user_id` 屬敏感資料）

```sql
select
  left(line_user_id, 6) || '…' || right(line_user_id, 4) as line_user_id_masked,
  submitted_code,
  status,
  superseded_count,
  last_event_type,
  last_submitted_at
from pending_binding
order by last_submitted_at desc
limit 20;
```

確認：
- 綁定訊息有產生列、code 已轉大寫正規化。
- 同帳號重送 → **仍是一列**（`superseded_count` 遞增），不灌爆表。
- 非綁定文字沒產生列。
- App log 內**看不到** `userId` 或 code（隱私）。

## 6. Rollback（本階段皆為輕量，未對外送、未寫入會友資料）

1. **首選**：console → **Use webhook = OFF**（LINE 停止投遞事件）。
2. **硬停**：unset／輪替 `LINE_CHANNEL_SECRET` → 每筆請求 401，什麼都不寫。
3. **清測試列**：`delete from pending_binding where submitted_code in ('TEST01','TEST-02');`（或依測試者 `line_user_id`）。
4. 可選：恢復 OA 的 auto-reply／greeting。

## 7. 全程必須維持關閉

- ❌ 任何真實送出 — `NOTIFICATION_TRANSPORT=mock`、`LINE_SEND_ENABLED=false`、token 留空。
- ❌ OA auto-reply／greeting。
- ❌ 任何 `users.line_id` 寫入 / Phase 5B（尚未部署）。
- ❌ 單次測試推播（deferred）。

---

**成功判準：** Verify 通過 · `綁定/bind` 產生正確 `pending_binding` 列 · 重送原地更新 · 非綁定不寫入 · 測試者收不到任何回覆 · log 無敏感資料。

確認後，再規劃 **Phase 5B（人工審核 → 寫入 `users.line_id`，遵守 `users_line_id_key` partial unique）**。
