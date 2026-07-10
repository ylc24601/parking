# Member LIFF setup（LIFF app 建立 + 真機冒煙）

> Phase 7 會員頁 `/member` 的 LIFF 接線 runbook。本機開發**不需要**這些——`MEMBER_AUTH_MODE=mock`
> 即可完整開發/測試。真機冒煙為 **Phase 7 結案（交付）前必跑**（見 handoff §6.23），
> 依交付模式在**開發者自己的 OA / provider** 上執行即可，不需教會協調。
> 相關：[binding-ops.md](binding-ops.md)、[oa-dry-run-tunnel-runbook.md](oa-dry-run-tunnel-runbook.md)、[delivery-model-and-roadmap.md](delivery-model-and-roadmap.md)。

## 1. 名詞與 env 對照（易混淆）

| env | 來源 | 用途 |
|---|---|---|
| `MEMBER_AUTH_MODE` | 自訂 | `mock`（本機；production fail-fast）或 `liff` |
| `LINE_LOGIN_CHANNEL_ID` | **LINE Login channel** 的 Channel ID | server 驗 ID token 時的 `client_id`（server-only） |
| `NEXT_PUBLIC_LIFF_ID` | LIFF app ID（`1234567890-abcdefgh`） | client `liff.init` 用（會進 bundle，非機密） |
| `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` | **Messaging API channel**（既有） | webhook 驗簽 / 推播——**與 LIFF 無關，不要混用** |

LIFF app 掛在 **LINE Login channel** 上，與 OA 的 Messaging API channel 是**同一 provider 下的兩個 channel**。
只要同 provider（且 LINE Login channel 已 link 該 OA），兩者拿到的 `userId` 一致——LIFF 綁定的
`line_id` 可直接供 dispatcher 推播。

## 2. 建立步驟（LINE Developers Console，一次性）

1. 進入既有 provider（與測試 OA 同一個；**不要**開新 provider，userId 會不一致）。
2. **Create channel → LINE Login**；記下 Channel ID → `LINE_LOGIN_CHANNEL_ID`。
3. 該 channel 內 **LIFF → Add**：
   - Size：`Full`；Endpoint URL：`https://<domain>/member`（本機真機測試填 tunnel URL，見 §3）
   - Scope：勾 `openid`（ID token 必要）+ `profile`
   - 「Linked OA」選開發者測試 OA（讓加好友動線順）
4. 記下 LIFF ID → `NEXT_PUBLIC_LIFF_ID`。
5. `.env.local` / Vercel env 設定上表三個變數，`MEMBER_AUTH_MODE=liff`。

## 3. 真機冒煙（Phase 7 結案前必跑）

前置：本機 `db:start && db:reset`、`npm run dev`、HTTPS tunnel 指向 :3000
（步驟同 [oa-dry-run-tunnel-runbook.md](oa-dry-run-tunnel-runbook.md)；LIFF endpoint 需 HTTPS）。
Endpoint URL 更新成 tunnel URL 後：

1. 手機開 LIFF URL（`https://liff.line.me/<LIFF_ID>`），用**未綁定**的 LINE 帳號進入。
2. 驗證項目（綁定申請流，Slice 2）：
   - [ ] 未綁定帳號 → 顯示「姓名＋手機」申請表（非占位畫面）
   - [ ] 送出已匯入會友的手機 → 成功畫面；`binding:pending` 出現遮罩列
   - [ ] `binding:approve` 預覽（masked phone + claimedName + matched 會友）→ `--apply` 寫入
   - [ ] 手機重開 LIFF → 自動登入見狀態卡（或在成功畫面重送時走 already-bound 自動登入）
   - [ ] 亂格式手機 → client 端即時提示、不送出
3. 驗證項目（登入/狀態，Slice 1）：
   - [ ] 已綁定會友 → 狀態卡正確（週日期/狀態/車牌/期限，台北時間）
   - [ ] 關閉 LIFF 重開 → session 仍在（cookie 30 天）
   - [ ] 登出 → 回 gate；重進 → LIFF 自動重驗後恢復
   - [ ] server log 無 ID token / userId / 手機 / 姓名洩漏
4. 完成後把結果記回 handoff §6.23/§6.24（比照 5B pilot 紀錄格式）。

## 4. 安全姿勢（沿用全案標準)

- ID token 只在 server 驗（LINE verify endpoint）；client 不送、也拿不到任何 `userId`。
- `member_sessions` 只存 token 的 sha256；cookie `HttpOnly + SameSite=Lax + Secure(prod)`。
- production 拒 `MEMBER_AUTH_MODE=mock`（`mock_in_production`，同 dispatcher transport guard）。
