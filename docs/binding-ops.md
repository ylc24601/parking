# Binding operator runbook（LINE 綁定審核）

> 用途：把「已知會友」的 LINE 帳號綁定到 `users.line_id`，讓移車/通知送得到本人。
> Phase 5B CLI（issue / approve / reject）。schema/RPC 見 handoff §6.20；擷取端見 §6.19。
> 規劃背景 [go-live-readiness.md](go-live-readiness.md)。
>
> 🔒 **隱私規則（全程）**：輸出/日誌**不得**出現完整 `line_user_id` 或完整 code；唯一例外是
> `binding:issue` **一次性**印出 code（操作者需轉交會友）。`binding:approve` 一律先 dry-run，
> 加 `--apply` 才寫入。

---

## 綁定流程（端到端）

1. **發碼**：操作者為某位**已知會友**產生一次性 code（預設隨機），把 code 透過可信管道（小組長/櫃檯/幹事）交給本人。
2. **會友送出**：會友在教會 OA 傳 `綁定 <code>`（大小寫皆可）→ 5A webhook 擷取成一筆 `pending_binding`。
3. **預覽**：操作者用該 pending 的 id 跑 `binding:approve`（dry-run），確認**遮罩後**的資訊與**對應到的會友姓名**無誤。
4. **核准**：加 `--apply` 寫入 `users.line_id`、consume code、標 pending `approved`。
5. **例外**：不該綁的申請用 `binding:reject` 標記。

> 身分＝雙因子：持有 code 證明「是這位會友」；OA 擷取證明「是這個 LINE 帳號」。核准仍為**人工把關**。

---

## 1. 發碼 `binding:issue`

```bash
npm run binding:issue -- --user-id <會友 uuid> --ttl-days 14
# 可選：--code ABCD-2345（自訂，通常不需要）、--created-by <text>、--note "小組長轉交"
```
- 預設**隨機產生** `XXXX-XXXX`（不含易混淆的 `0/O/1/I/L`）。
- **code 只印這一次**，畫面會顯示：會友姓名、code、到期時間。請立即轉交會友、勿留存於他處。
- ⚠️ `--code` 走命令列可能殘留 shell history/process list；一般請用隨機預設。

## 2. 核准 `binding:approve`（預設 dry-run）

```bash
# 先預覽（不寫入）
npm run binding:approve -- --pending-id <pending uuid>
# 確認無誤後才寫入
npm run binding:approve -- --pending-id <pending uuid> --apply
```
預覽會顯示（皆遮罩/對應）：
- `pendingStatus`
- `lineUserIdMasked`（如 `Udeadb…beef`）
- `submittedCodeMasked`（如 `ABCD-****`）
- `matchedUserId` / `matchedDisplayName`（用 code 對應到的會友，供你確認**綁對人**）
- `wouldApprove` + `reason`（預測結果）

`--apply` 成功回 `{"approved":1,"reason":"approved"}`。

## 3. 退回 `binding:reject`

```bash
npm run binding:reject -- --pending-id <pending uuid> --reason duplicate
```
- `--reason` 為操作者分類（如 `duplicate`、`unrecognized`）。
- ⚠️ **不要**把 `line_user_id` 或 code 放進 `--reason`（會原樣存為稽核）。

---

## Typed reasons（approve）

| reason | 意義 / 處置 |
|---|---|
| `approved` | 可核准 / 已核准 |
| `pending_not_found` | pending id 不存在 → 檢查 id |
| `pending_not_pending` | 已 approved/rejected → 無需重做 |
| `code_not_found` | 送出的 code 沒對應已發碼 → 會友打錯，或未發碼 → 重新發碼 |
| `code_expired` | code 過期 → 重新發碼 |
| `code_consumed` | code 已被用過 → 重新發碼 |
| `member_already_bound` | 該會友已綁定 → 如需換綁另議（本刀不支援 rebind） |
| `line_id_taken` | 此 LINE 帳號已綁到**別的**會友 → 查是否重複/錯綁 |

---

## 對照

- 綁定成功後，該會友的 `owner_notifiable` 轉為可通知，dispatcher 才送得到（仍需真 OA token + `NOTIFICATION_TRANSPORT=line`；另需一次教會正式 OA capture dry-run，見 [oa-dry-run-tunnel-runbook.md](oa-dry-run-tunnel-runbook.md)）。
- 擷取端（`綁定 <code>` → pending）：handoff §6.19。審核 RPC：§6.20。
