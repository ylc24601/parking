# Binding operator runbook（LINE 綁定審核）

> 用途：把「已知會友」的 LINE 帳號綁定到 `users.line_id`，讓移車/通知送得到本人。
> 兩條進件路徑：**LIFF 申請**（Phase 7 Slice 2，會友自助）與 **`綁定 <code>` 發碼**（Phase 5B，fallback／同工協助）。
> schema/RPC 見 handoff §6.20 / §6.24；擷取端見 §6.19；規劃背景 [go-live-readiness.md](go-live-readiness.md)。
>
> 🔒 **隱私規則（全程）**：輸出/日誌**不得**出現完整 `line_user_id`、完整 code 或完整手機號碼；唯一例外是
> `binding:issue` **一次性**印出 code（操作者需轉交會友）。`binding:approve` 一律先 dry-run，
> 加 `--apply` 才寫入。

## 審核入口（Phase 8 起）

- **主要：Admin UI `/admin/bindings`**（handoff §6.27）——per-admin 帳號登入（`admin:create` 開帳號），
  待審列表（遮罩）→ 預覽 → 核准/退回；核准者記入 `pending_binding.decided_by_admin_id` 供稽核。
  預覽→核准帶版本防偷換（申請被重送會回「請重新預覽」）。
- **Fallback：下方 CLI**（`binding:pending/approve/reject`）照舊可用；CLI 決行的 `decided_by_admin_id`
  為 null（「CLI／未具名」）。發碼 `binding:issue` 目前仍 CLI-only（發碼 UI 排在會友管理 slice）。

---

## 路徑 A（主要）：LIFF 自助申請

1. **會友申請**：會友開啟 LIFF 會友專區 → 未綁定畫面填「姓名＋手機」送出。系統以已驗證的 LINE 身分建立
   `pending_binding`（`claim_source='liff'`）。重送＝原地更新（不會灌表）。
   **申請端永遠不透露手機是否對得到會友**（防列舉）；比對只在你核准時發生。
2. **發現申請**：`npm run binding:pending`（見下）——LIFF 申請是會友主動進來的，**不跑這支你不會知道有申請**。
3. **預覽 → 核准**：同「核准」節；LIFF 申請的預覽會多顯示 `claimedName`（會友自填姓名，完整）與
   `claimedPhoneMasked`（如 `0912***678`），以及**依手機對到的會友** `matchedDisplayName`——姓名不一致**不會自動擋**，
   由你人工判斷（會友自填名與教會登記名可能略異）。

## 路徑 B（fallback）：發碼 `binding:issue`

1. **發碼**：操作者為某位**已知會友**產生一次性 code（預設隨機），透過可信管道（小組長/櫃檯/幹事）交給本人。
2. **會友送出**：會友在教會 OA 傳 `綁定 <code>`（大小寫皆可）→ 5A webhook 擷取成 `pending_binding`（`claim_source='keyword'`）。
3. 之後同「預覽 → 核准」。

> 身分＝雙因子：LIFF 申請由 **server 驗證的 LINE ID token** 證明「是這個 LINE 帳號」＋手機比對證明「是這位會友」；
> 發碼流由持有 code 證明會友。核准一律**人工把關**。

---

## 0. 待審清單 `binding:pending`

```bash
npm run binding:pending                # 最舊的 20 筆（FIFO）
npm run binding:pending -- --limit 50  # 1..100
```
- 顯示：短 ID、來源（liff/keyword）、首次送出、最後更新、重送次數、遮罩後的 claim
  （liff → `姓名 / 0912***678`；keyword → `ABCD-****`）。
- 完整 pending id 列在表尾，供 `binding:approve` 使用。時間為 UTC。

## 1. 發碼

**主要：Admin UI**（Phase 8 Slice 2，handoff §6.29）——`/admin/members` 查詢會友 → 開明細 → 對**未綁**會友按「產生綁定碼」（可設有效天數 1–90、可選備註）。全碼**只顯示這一次**（畫面提示「離開此畫面後 Admin UI 不會再次顯示」；DB 仍存明文、非技術上不可取），請立即複製轉交；已綁會友發碼鈕停用（回 `already_bound`）。`created_by` 記為 `admin:<登入者>`。
> **發碼的 bound 檢查是 UX precheck、非原子保證**：發碼成功只代表 code 已建立，不保證日後必可核准——最終守門是核准端 RPC 的 `member_already_bound`。

**Fallback：CLI `binding:issue`**（需先知道 user uuid）：
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
- `pendingStatus`、`claimSource`（liff / keyword）
- `lineUserIdMasked`（如 `Udeadb…beef`）
- keyword：`submittedCodeMasked`（如 `ABCD-****`）；liff：`claimedName`（完整）＋ `claimedPhoneMasked`
- `matchedUserId` / `matchedDisplayName`（對應到的會友，供你確認**綁對人**）
- `claimVersion`（樂觀並發版本，`--apply` 自動帶入）
- `wouldApprove` + `reason`（預測結果）

`--apply` 成功回 `{"approved":1,"reason":"approved"}`。
**防偷換保護**：`--apply` 會核准「這次執行預覽到的那個版本」；若會友在你預覽後又重送（改了手機或 code），
apply 回 `pending_changed` 並 exit 2 → **重新執行預覽確認新內容**，不會核准到你沒看過的資料。

## 3. 退回 `binding:reject`

```bash
npm run binding:reject -- --pending-id <pending uuid> --reason duplicate
```
- `--reason` 為操作者分類（如 `duplicate`、`unrecognized`）。
- ⚠️ **不要**把 `line_user_id`、code 或手機放進 `--reason`（會原樣存為稽核）。
- 退回後該 LINE 帳號可重新申請（會建新的一筆 pending）。

---

## Typed reasons（approve）

| reason | 適用 | 意義 / 處置 |
|---|---|---|
| `approved` | 皆 | 可核准 / 已核准 |
| `pending_not_found` | 皆 | pending id 不存在 → 檢查 id |
| `pending_not_pending` | 皆 | 已 approved/rejected → 無需重做 |
| `pending_changed` | 皆 | 預覽後申請被重送 → 重新預覽確認新內容（防偷換） |
| `code_not_found` | keyword | 送出的 code 沒對應已發碼 → 會友打錯，或未發碼 → 重新發碼 |
| `code_expired` | keyword | code 過期 → 重新發碼 |
| `code_consumed` | keyword | code 已被用過 → 重新發碼 |
| `phone_not_found` | liff | 申請手機對不到任何會友 → 確認會友資料已匯入/手機正確；必要時 reject 並聯繫本人 |
| `member_already_bound` | 皆 | **對到的會友**已綁定其他 LINE → 如需換綁另議（不支援 rebind） |
| `line_id_taken` | 皆 | 此 LINE 帳號已綁到**別的**會友 → 查是否重複/錯綁 |

> 另有 route 端 `line_account_already_bound`（會友端申請時自己的 LINE 已綁定 → UI 直接引導重新登入），
> 與上表 approval 端的 `member_already_bound` 語意不同：前者是「申請者自己已綁」，後者是「被對到的會友已綁」。

---

## PII 保留（Phase 8 Slice 7 — **已實作**）

- `claimed_phone` / `claimed_name` / `submitted_code` 存於 `pending_binding`（僅此處）；**不進** log、error、
  會員端回應；CLI 全程遮罩。
- **Retention（migration 0027）**：決行（approve/reject）**90 天後**由 retention job 清除三欄，
  **保留** `claim_source`、時間戳、`status`、`approved_user_id`、`rejected_reason`、`decided_by_admin_id`。
  窗口由 `BINDING_PII_RETENTION_DAYS` 控（預設 90；**下限 30**——低於下限/非法值一律 fallback 90，
  且 RPC 內再硬性擋一次，任何 caller 都不能縮短窗口；route/CLI **不收任何時間覆寫參數**）。
  DB constraint（`pending_binding_claim_shape_ck`）保證：redacted 形狀**只允許已決行列**、且三欄必須一起清（無半套）。

### 執行方式

**排程（正式路徑）**——每日一次即可：

```bash
# Vercel Cron（vercel.pro.example.json 已含每日 03:30 條目）發 GET；外部排程器：
curl -fsS "https://<host>/api/internal/jobs/redact-binding-pii" \
  -H "x-job-secret: $JOB_TRIGGER_SECRET"
```

- **GET＝排程入口，預設 apply**；`?dryRun=1` 預覽、`?max=N`（1–500，預設 200）。
- **POST＝人工/工具入口，預設 dry-run**——漏帶參數絕不觸發不可逆刪除；只有顯式
  `{"dryRun": false}` 才 apply，`dryRun` 非 boolean 一律 400（曖昧值絕不靜默 apply）。

**CLI（預覽/首次手動）**：

```bash
npm run job:redact-binding-pii                # dry run → { wouldRedact, hasMore }
npm run job:redact-binding-pii -- --apply     # 實際清除（預設 max 200、上限 500）
```

`hasMore`＝本批之外仍有符合列（歷史 backlog 多時每日一批需數天消化）。輸出恆為 counts/timestamps
（operation-safe），永不含三欄值或 `line_user_id`。重跑 idempotent（已清列不再匹配）。

### 範圍外（backlog）

- **從未被審的老 pending 列**不在本政策（無決行時間可算）——若 pilot 出現大量無人審的殘留申請再議。
- **`binding_codes`**（`code`/`consumed_line_user_id` 等）不在本政策，如需另立 retention。
- 若 pilot 出現大量重送（`binding:pending` 的 RETRIES 異常），再評估 per-LINE-identity cooldown / 平台 rate limit。

## 對照

- 綁定成功後，該會友的 `owner_notifiable` 轉為可通知，dispatcher 才送得到（仍需真 OA token + `NOTIFICATION_TRANSPORT=line`；另需一次教會正式 OA capture dry-run，見 [oa-dry-run-tunnel-runbook.md](oa-dry-run-tunnel-runbook.md)）。
- 擷取端：keyword `綁定 <code>` → handoff §6.19；LIFF 申請 → §6.24。審核 RPC：§6.20（0022 改版）。
- 會友端 LIFF 建置與真機冒煙：[member-liff-setup.md](member-liff-setup.md)。
