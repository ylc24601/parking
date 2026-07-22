# Admin account operator runbook（admin 帳號管理）

> 整體系統邏輯與 Admin 後台其他頁面總覽見 [admin-operations-guide.md](admin-operations-guide.md)。
>
> 管理 `admin_accounts`（Admin UI 操作者帳號，與 `users.role='admin'` 無關，見 handoff §6.27）的生命週期：
> 建立走 CLI、日常管理（停用/重啟/重設密碼/強制登出）走 **Admin UI**（Phase 8 Slice 3，handoff §6.30）。

---

## 建立帳號（CLI-only）

```bash
cd parking-system
echo 'a-strong-password' | npm run admin:create -- --username alice --stdin
# 或不帶 --stdin：系統隨機產生密碼，只印一次
npm run admin:create -- --username alice --display-name 王姐妹
```

- 目前**沒有**開帳號的 UI（刻意留在 CLI，避免 Admin UI 本身能自我繁殖高權限帳號）。
- 隨機密碼**只印這一次**；請立即存入教會密碼管理器。

## 日常管理（Admin UI `/admin/accounts`）

同工登入 → 帳號管理 → 對**其他** admin 帳號可執行：

| 操作 | 效果 |
|---|---|
| 停用 | `disabled_at` 寫入 + **該帳號所有裝置立即登出** |
| 重啟 | 清除 `disabled_at` + **同樣強制所有裝置登出**（重啟後必須重新輸入密碼——防止停用期間漏刪的舊 session 復活） |
| 重設密碼 | 產生一組新隨機密碼（**只顯示這一次**，請立即複製轉交）+ 清除鎖定計數 + **撤銷所有裝置** |
| 撤銷所有 session | 單純強制登出，不改密碼/停用狀態 |

- **自己的帳號沒有這些按鈕**：peer 模型下沒有角色階層，任何人都不能停用/重設/撤銷自己（route/service/RPC 三層擋）；要結束自己的 session 用「登出」。
- **系統永遠保留至少一位啟用中的 admin**：停用最後一位 active admin 會被拒絕（`last_active_admin`）。這是 migration `0026` 的 `set_admin_disabled` RPC 在同一交易內原子判定的——兩位 admin 同時互停也不會把系統歸零（by design，非事後補救）。
- 一次性密碼只在畫面顯示這一次；DB 仍存雜湊，忘記密碼請再按一次「重設密碼」即可，不是不可逆操作。

## 真的卡住時（fallback）

若系統中**所有** admin 帳號都被停用（例如手動改 DB 造成的異常狀態，非經由 Admin UI 正常操作），Admin UI 本身無法救援（沒人能登入）。此時：

```bash
# 直接查/改 DB（需要 service-role 存取）
psql "$SUPABASE_DB_URL" -c "update admin_accounts set disabled_at = null where username = 'alice';"
# 或開一個新帳號
npm run admin:create -- --username rescue --stdin
```

正常操作流程下不會走到這一步——`set_admin_disabled` 的 last-active 守門就是為了防止這個情境發生。

## 對照

- 帳號認證模型（scrypt 密碼、session、鎖定週期、反枚舉姿態）：handoff §6.27。
- 帳號管理 UI/RPC 細節、rev 1→rev 2 的安全修正：handoff §6.30。
