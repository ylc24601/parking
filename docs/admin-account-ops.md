# Admin account operator runbook（admin 帳號管理）

> 整體系統邏輯與 Admin 後台其他頁面總覽見 [admin-operations-guide.md](admin-operations-guide.md)。
>
> 管理 `admin_accounts`（Admin UI 操作者帳號，與 `users.role='admin'` 無關，見 handoff §6.27）的生命週期：
> 建立走 CLI、日常管理（停用/重啟/重設密碼/強制登出）走 **Admin UI**（Phase 8 Slice 3，handoff §6.30）。
>
> **Wave 2C-1（#19）起帳號分兩級**：**系統管理員（superadmin）** 可用全部後台；**幹事（clerk）** 不能開「帳號管理／營運狀態／稽核記錄」三頁，其餘日常營運照舊。

---

## 建立帳號（CLI-only）

⚠️ **這支指令只會建立「系統管理員」**——完整權限。它是最後的救援路徑（所有 UI 帳號都登不進去時的唯一入口），所以不提供 `--role` 選項。因此必須在環境變數明示確認，否則直接中止：

```bash
cd parking-system
echo 'a-strong-password' | CONFIRM_CREATE_SUPERADMIN=1 npm run admin:create -- --username alice --stdin
# 或不帶 --stdin：系統隨機產生密碼，只印一次
CONFIRM_CREATE_SUPERADMIN=1 npm run admin:create -- --username alice --display-name 王姐妹
```

- 目前**沒有**開帳號的 UI（刻意留在 CLI，避免 Admin UI 本身能自我繁殖高權限帳號）。
- 隨機密碼**只印這一次**；請立即存入教會密碼管理器。

**營運規範（誰能跑、跑完要做什麼）**

- 執行需要 **service-role 金鑰**，等同資料庫最高權限 ⇒ 只有保管該金鑰的人（交付後即教會指定的技術負責人）可以跑。
- 這條路徑**不寫稽核記錄**：持有 service-role 金鑰的人本來就能繞過整個稽核機制（migration `0030` 已明說它「提高偽造成本、不防遺漏」）。經由後台建立的帳號才會留下紀錄。
- 建立後請**立刻**：① 用一次性密碼登入一次確認可用；② 在 `/admin/accounts` 重設密碼或請本人自行更換；③ 在教會的權責清單記下「誰、何時、為什麼」——這是這條路徑唯一的紀錄。

## 日常管理（Admin UI `/admin/accounts`）

同工登入 → 帳號管理 → 對**其他** admin 帳號可執行：

| 操作 | 效果 |
|---|---|
| 停用 | `disabled_at` 寫入 + **該帳號所有裝置立即登出** |
| 重啟 | 清除 `disabled_at` + **同樣強制所有裝置登出**（重啟後必須重新輸入密碼——防止停用期間漏刪的舊 session 復活） |
| 重設密碼 | 產生一組新隨機密碼（**只顯示這一次**，請立即複製轉交）+ 清除鎖定計數 + **撤銷所有裝置** |
| 撤銷所有 session | 單純強制登出，不改密碼/停用狀態 |

- **只有系統管理員能用這一頁**：幹事開啟會看到「權限不足」，直接打 API 也會被擋（403）。擋的地方有三層——側欄不顯示（只是 UX）、頁面與 API 檢查、以及 RPC 在交易內自己重讀角色再擋一次（角色從不由呼叫端聲稱）。
- **自己的帳號沒有這些按鈕**：任何人都不能停用/重設/撤銷自己（route/service/RPC 三層擋）；要結束自己的 session 用「登出」。
- **系統永遠保留至少一位啟用中的系統管理員**。2C-1 之後這是**結構性**的，不再靠事後判斷：能執行這些操作的人自己必須是「啟用中的系統管理員」，而且不能對自己下手 ⇒ 操作完成後他本人一定還在。兩位系統管理員同時互停時，advisory lock 會把兩次呼叫排成先後，後到的那位發現自己已被停用而被拒（`acting_admin_disabled`），系統仍留一位。
- 一次性密碼只在畫面顯示這一次；DB 仍存雜湊，忘記密碼請再按一次「重設密碼」即可，不是不可逆操作。

## 真的卡住時（fallback）

若系統中**所有** admin 帳號都被停用（例如手動改 DB 造成的異常狀態，非經由 Admin UI 正常操作），Admin UI 本身無法救援（沒人能登入）。此時：

```bash
# 直接查/改 DB（需要 service-role 存取）
psql "$SUPABASE_DB_URL" -c "update admin_accounts set disabled_at = null, role = 'superadmin' where username = 'alice';"
# 或開一個新帳號
CONFIRM_CREATE_SUPERADMIN=1 npm run admin:create -- --username rescue --stdin
```

⚠️ 手動改 DB 時記得**一併確認 `role`**：只把 `disabled_at` 清掉，救回來的可能是一個幹事帳號——能登入，但打不開帳號管理，等於沒救到。

正常操作流程下不會走到這一步——上面「至少保留一位啟用中的系統管理員」的結構性保證就是為了防止這個情境。

## 對照

- 帳號認證模型（scrypt 密碼、session、鎖定週期、反枚舉姿態）：handoff §6.27。
- 帳號管理 UI/RPC 細節、rev 1→rev 2 的安全修正：handoff §6.30。
