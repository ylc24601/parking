# 專案啟動：教會主日停車管理系統 MVP (Church Parking Management System)

## 1. 專案目標與 MVP 範疇
建立一套公平、透明、具備恩慈防護網的 LINE 自動化停車系統。
* **可用車位公式（公開可分配數）：**
  ```
  public_allocatable_capacity =
      total_capacity            -- 預設 23
    - blocked_spaces            -- 當週停用/異常車位
    - guest_reserved            -- 外賓保留位（Admin 每週手動設定）
    - active_full_time_staff_reserved
  ```
  其中 `active_full_time_staff_reserved = 全職同工名單人數 - 本週標記不停車(skipped)人數`。
  全職同工（P1）與外賓**皆不進入公開排序**，於分配前先從容量扣除。
  > 註：`Weekly_Events.admin_reserved` 僅代表「外賓保留位 `guest_reserved`」，**不含**全職同工保留位；全職同工保留位由當週 P1 名單動態計算，避免 Admin 手動維護兩個數字。
* **不指定車格：** MVP 僅管理「可用車位總數」，不指定實體車位號碼，實際停放由現場同工引導。

## 2. 核心資料庫 Schema (PostgreSQL)

> **隱私設計原則（資料最小化 / 權限隔離）：** 敏感欄位（P2 資格原因、依附人員、違規分數）**不放在 `users` 主表**，而拆到 `user_eligibility`、`user_penalties` 兩張低權限子表。Staff 端一律透過下方 `staff_checkin_view` 取得資料，該 view **僅暴露姓名、車牌、`is_priority` 布林（⭐ 優先車位）**，不暴露任何原因或分數欄位。
> （拆表本身不等於隱私保護——Postgres RLS 是 row-level；真正的隔離靠「子表/view 的 GRANT」與「Staff 只能 SELECT view」。）

### Users Table（僅保留低敏感身分欄位）
* `id`: UUID
* `line_id`: String (Unique)
* `phone_number`: String
* `display_name`: String
* `role`: String ('user', 'full_time_staff', 'staff', 'admin')
  * `full_time_staff`：全職同工，享 P1 保留名額，Admin 直接管理名單
  * `staff`：停車管理同工（無 P1 保留名額；主日現場以手機或平板操作）

> ⚠️ `p1_skip_this_week` **不再放在 users**（它是「當週狀態」，放主表會造成週次混亂——忘記改回就一直釋出名額）。改由每週一筆 P1 預約紀錄表達，見 [Weekly_Staff_Allocations](#weekly_staff_allocations-table-p1-全職同工每週狀態)。

### User_Eligibility Table（P2 關懷資格，敏感）
* `user_id`: UUID (PK, FK → Users)
* `p2_eligible`: Boolean (Admin 核准的 P2 關懷資格)
* `p2_reason`: Enum (NULL | 'mobility_long' | 'mobility_short' | 'pregnancy' | 'elderly_companion' | 'child_companion')
  * `mobility_long`（長期行動不便/身心障礙需求）：每週自動套用，無需宣告，長期有效
  * `mobility_short`（短期行動不便）：每週自動套用，無需宣告；搭配 `p2_review_date` 追蹤
  * `pregnancy`（孕婦）：自動套用，有效期至預產期後 3–6 個月（見 `p2_valid_until`）；之後系統提醒 Admin 關懷確認，若仍有幼兒同行需求由 Admin 轉為 `child_companion`
  * `elderly_companion`（年長者同行）：每週需在申請時宣告，否則以 P3 排序
  * `child_companion`（學齡前幼兒同行）：每週需在申請時宣告，否則以 P3 排序
* `p2_valid_until`: Date (NULL | 孕婦 P2 之有效截止日＝預產期後 3–6 個月)
* `p2_review_date`: Date (NULL | 短期行動不便之下次追蹤日；不設則預設核准日 +4 週)
* `dependent_name`: String (NULL | 幼兒或長者之姓名，供資格驗證用；選填)
* `dependent_birthdate`: Date (NULL | 幼兒或長者之生日；用於自動計算學齡到期／確認 75 歲門檻)
* `reviewed_by`: UUID (FK → Users，核准的 Admin)
* `reviewed_at`: Timestamp

### User_Penalties Table（違規與輪替，敏感）
* `user_id`: UUID (PK, FK → Users)
* `penalty_score`: Integer (預設 0，最高至 3。僅 P3 一般會友累加)
* `consecutive_no_show`: Integer (P2 連續未到次數，供 Admin 牧養關懷提醒用；P1 全職同工若有標記 skip 則不計入)
* `last_successful_attended_at`: Date (最後一次成功停到車的日期)

### Weekly_Events Table (主日活動設定)
* `id`: UUID
* `sunday_date`: Date
* `total_capacity`: Integer (預設 23)
* `blocked_spaces`: Integer (預設 0)
* `admin_reserved`: Integer (預設 0)
* `status`: Enum ('open', 'closed', 'finalized')

### Weekly_Staff_Allocations Table (P1 全職同工每週狀態)
> P1 全職同工每週也產生一筆紀錄（取代放在 users 的 `p1_skip_this_week`）。它**不參與公開排序**，但用來動態計算 `active_full_time_staff_reserved`。
* `id`: UUID
* `weekly_event_id`: UUID (FK → Weekly_Events)
* `user_id`: UUID (FK → Users，role = full_time_staff)
* `status`: Enum ('reserved' | 'skipped' | 'attended' | 'no_show')
  * `reserved`：本週占用 P1 保留名額（預設）
  * `skipped`：本週在外服事，週五前自行標記，名額釋出給公開候補
* `skip_reason`: String (NULL)
* `updated_at`: Timestamp
* （唯一鍵：`(weekly_event_id, user_id)`）

`active_full_time_staff_reserved = COUNT(status = 'reserved')`。

### Reservations Table (預約狀態機)
* `id`: UUID
* `weekly_event_id`: UUID
* `user_id`: UUID (NULL；walk-in 時為 NULL)
* `vehicle_id`: UUID (NULL；walk-in 時為 NULL)
* `walk_in_name`: String (NULL；walk-in 選填)
* `walk_in_license_plate`: String (NULL；walk-in **必填**，供後四碼搜尋與使用率統計)
* `requested_p2_this_week`: Boolean (會友宣告本週是否有長幼同行)
* `effective_priority`: Integer (系統判定：P1=1, 宣告同行的P2=2, 其餘=3)
* `status`: Enum (主狀態，見下方狀態機定義)
* `offer_status`: Enum (null | 'expired' | 'declined'，預設 null；null 代表尚無遞補經歷)
  > 遞補 offer 的**結果**。進行中的 offer 用主狀態 `temp_approved`（鎖位）表達，**不另設 'pending'**。offer 失敗時主狀態退回 `waiting`，並把結果記在此欄位（見狀態機說明 6）。
* `last_offer_at`: Timestamp (NULL，最近一次發出遞補 offer 的時間)
* `offer_expires_at`: Timestamp (NULL，遞補確認期限)
* `p2_on_the_way`: Boolean (預設 false；收到「正在路上」回覆後設 true)
* `release_deadline_at`: Timestamp (該預約的釋出截止時間：P3=10:30、P2=10:45；若 `p2_on_the_way` 則延長至 grace_deadline 10:55)
* **生命週期時間戳：**
  * `applied_at`: Timestamp
  * `approved_at`: Timestamp (NULL)
  * `attended_at`: Timestamp (NULL)
  * `released_at`: Timestamp (NULL)
  * `cancelled_at`: Timestamp (NULL)
  * `finalized_at`: Timestamp (NULL，結算時間)
* `staff_note`: String (NULL，現場備註，如「現場換車」)
* `admin_note`: String (NULL)

> **`waiting_rank` 不落地為可變欄位。** 候補順位是排序鍵（priority → penalty → last_attended → applied_at）的衍生值，存成可變欄位會在 penalty 變動後 stale。如需「維持原排位」的穩定性，於週五 18:00 凍結一個 `allocation_order: Integer` 快照（分配當下寫入、之後不再變動），遞補時依此快照取下一位；即時計算亦可。

## 3. 預約狀態機定義 (State Machine)

**主狀態 `status`：**
* `pending`: 排隊中。
* `approved`: 已核准，占用名額，保留至該預約的 `release_deadline_at`。
* `temp_approved`: 候補遞補中。**暫時占用名額鎖位**，等待 2 小時確認（即「offer 進行中」）。
* `waiting`: 候補中。
* `attended`: 在該預約 `release_deadline_at` 前到場（P3 ≤10:30、P2 ≤10:45/grace）。
* `released_late`: 逾時釋出。P3 於 10:30 未到時觸發；P2 於 10:45（或 `p2_on_the_way` 延長至 10:55 的 grace_deadline）仍未到時觸發。
* `attended_after_release`: 超過 `release_deadline_at` 後才到場並補點名（免除違規，但不保證車位）。
* `no_show`: 結算時仍未出現。
* `cancelled_by_user`: 早期取消（週五 18:00 前）。
* `cancelled_late`: 晚期取消（主日 10:30 前），立即觸發遞補，不計違規。
* `walk_in`: 現場散客。

**遞補 offer 結果 `offer_status`（子狀態，不是主狀態）：**
* `null`: 尚無遞補經歷（預設）。
* `expired`: 遞補逾 2 小時未確認 → 主狀態退回 `waiting`。
* `declined`: 候補主動放棄 → 主狀態退回 `waiting`。

> ⚠️ 設計修正：原本把 `offer_expired` / `offer_declined` 當主狀態，與「遞補失敗者維持在 `waiting` 原排位」矛盾（既是 offer_expired 就不是 waiting）。故改為：**主狀態維持 `waiting`，遞補結果記在 `offer_status`**，下次有人取消仍依凍結的 `allocation_order` 從原排位繼續遞補。

## 4. 核心排序與分配邏輯 (週五 18:00 執行)

> P1 全職同工與外賓名額**不進入此排序**，由 Admin 保留設定，從可分配車位數中事先扣除。

```sql
ORDER BY 
  effective_priority ASC,             -- P2=2 (行動不便/孕婦/宣告年長幼兒), 一般P3=3
  penalty_score ASC,                  -- 違規分數 (0 最佳，P2 預設為 0，不累加)
  last_successful_attended_at ASC NULLS FIRST, -- 輪替公平：越久沒停越優先
  applied_at ASC                      -- 同分則看申請時間
```

`effective_priority` 判定規則：
- `p2_eligible = true` 且 `p2_reason IN ('mobility_long', 'mobility_short', 'pregnancy')` → 自動為 2（無需每週宣告）
- `p2_eligible = true` 且 `p2_reason IN ('elderly_companion', 'child_companion')` 且 `requested_p2_this_week = true` → 2
- 其餘（含 P2 資格但未宣告當週同行）→ 3

## 5. 補充 Schema 定義

### Vehicles Table（車輛資料）
* `id`: UUID
* `user_id`: UUID (FK → Users, NOT NULL)
* `license_plate`: String (Unique，全局唯一，防止同車牌綁定多帳號)
* `nickname`: String (選填，如「家庭車」、「公司車」)
* `is_active`: Boolean (預設 true；停用而非刪除，保留歷史紀錄)
* `created_at`: Timestamp

### Audit_Logs Table（稽核軌跡）
* `id`: UUID
* `actor_id`: UUID (FK → Users，執行操作的 Admin/Staff)
* `action`: String (如 `'approve_p1'`, `'approve_p2'`, `'revoke_p2'`, `'update_p2_review_date'`, `'manual_penalty_reset'`, `'override_status'`, `'reserve_spaces'`, `'finalize_checkin'`)
* `target_type`: String (`'user'`, `'reservation'`, `'weekly_event'`)
* `target_id`: UUID
* `before_value`: JSONB (操作前的欄位快照)
* `after_value`: JSONB (操作後的欄位快照)
* `created_at`: Timestamp (依個資規範保存 2–3 年)

---

## 6. Walk-in 設計說明

Walk-in 由 Staff 手動新增，**不關聯任何已登錄帳號**。為了能穩定搜尋與統計，**不使用 `staff_note` 自由文字塞車牌**，而用結構化欄位：

| 欄位 | Walk-in 時的值 |
| :--- | :--- |
| `status` | `walk_in` |
| `user_id` | NULL |
| `vehicle_id` | NULL |
| `walk_in_license_plate` | **必填**（Staff 頁面可依後四碼搜尋） |
| `walk_in_name` | 選填 |

如此 Staff 清單能穩定顯示與搜尋，Walk-in 也能納入當週使用率統計。

---

## 7. 邊界條件補充

### P2 差異化釋出時間（10:45 / grace 10:55）
主日當天釋出時程，**一律以 `effective_priority` 判定，不用 `p2_eligible`**（否則本週未宣告同行的年長/幼兒家庭雖 `p2_eligible=true`，但本週應以 P3 處理，會被誤發 P2 提醒、誤延後釋出）：

1. **10:20 — P2 到場提醒**
   ```
   掃描 effective_priority = 2 且 status = 'approved' 且 attended_at IS NULL
   → 發送 LINE 到場提醒（保留至 10:45，可回覆「正在路上」設 p2_on_the_way = true）
   ```
2. **10:30 — P3 逾時釋出**
   ```
   掃描 effective_priority = 3 且 status = 'approved' 且 attended_at IS NULL
   → status = 'released_late', released_at = now
   ```
3. **10:45 — P2 逾時釋出（未宣告正在路上者）**
   ```
   掃描 effective_priority = 2 且 status = 'approved' 且 attended_at IS NULL
        且 p2_on_the_way = false
   → status = 'released_late', released_at = now
   ```
4. **10:55 — P2 grace_deadline（已宣告正在路上者）**
   ```
   掃描 effective_priority = 2 且 status = 'approved' 且 attended_at IS NULL
        且 p2_on_the_way = true
   → status = 'released_late', released_at = now
   ```

> **「正在路上」採有界寬限，不無限延長。** PRD §八已宣告「10:30 後現場最大、不保證依候補順位保留」；若 `p2_on_the_way` 可無限延長則與此矛盾，且無法寫確定性測試。故固定 `grace_deadline = 10:55`。每筆預約的 `release_deadline_at` 因此為：P3 = 10:30；P2 = 10:45；P2 且 `p2_on_the_way` = 10:55。`attended` 的判定一律以「到場時間 ≤ 該預約 `release_deadline_at`」為準——P2 於 10:35 到場屬 `attended`，不會被誤判為 `attended_after_release`。

`Reservations` 表相關欄位：`p2_on_the_way`（Boolean）、`release_deadline_at`（Timestamp），定義見 Reservations Table。

### 週六深夜取消的邊界處理
若取消發生於週六 23:xx，`temp_approved` 的 2 小時確認期可能跨越週日 00:00。  
**排程任務（週日 00:00 觸發）** 應掃描所有 `status = 'temp_approved'` 且 `offer_expires_at > NOW()` 的紀錄，自動升格為 `approved`，補發即時確認通知，不再等待候補者手動確認。  
因此 `offer_expires_at` 實際應設為 `MIN(applied_at + INTERVAL '2 hours', current_sunday 00:00:00)`。

### consecutive_no_show 重置時機（P1/P2）
* **自動歸零**：P1/P2 成功到場（`attended` 或 `attended_after_release`）時，觸發 `consecutive_no_show = 0`。
* **手動歸零**：Admin 可於後台手動重置，並自動寫入 Audit Log。

### Admin 牧養關懷提醒的三種觸發情形
系統依下列三種條件於 Admin 後台產生提醒卡片，性質皆為關心而非懲罰：

1. **連續未到（P2）：** `consecutive_no_show >= 4`，排程每次結算後掃描。
2. **短期行動不便追蹤到期：** `p2_reason = 'mobility_short'` 且 `p2_review_date <= TODAY()`，排程每日掃描。Admin 處理後可延長 `p2_review_date` 或取消 P2 資格。
3. **幼兒資格即將到期：** `p2_reason = 'child_companion'` 且 `p2_dependent_birthdate` 計算出孩子將於 30 天內達學齡，排程每日掃描。Admin 確認後可取消資格或延長（例如孩子提早入學）。

### 遞補失敗（offer expired / declined）後的狀態
遞補失敗的候補者 **主狀態維持 `waiting`**，僅將 `offer_status` 設為 `expired` 或 `declined`、記錄 `last_offer_at`，並依週五凍結的 `allocation_order` 維持原排位；不從名單中移除。下次有人取消時，從原排位繼續觸發遞補。

---

## 8. 系統基礎設施表（Phase 1+ 建立，非 Phase 0）

> 本系統高度依賴排程（週五18:00、週日00:00、10:20/10:30/10:45/10:55、12:30、14:00）與 LINE 通知，若不先設計冪等與通知基礎設施，會落到臨時實作。以下三表在 Phase 1 建立。

### Notification_Outbox Table（通知冪等）
* `id`: UUID
* `dedupe_key`: String (Unique，例：`{template}:{reservation_id}:{weekly_event_id}`，避免排程重跑重複發送)
* `template_key`: String
* `user_id`: UUID (NULL)
* `reservation_id`: UUID (NULL)
* `weekly_event_id`: UUID
* `payload_json`: JSONB
* `status`: Enum ('pending' | 'sent' | 'failed' | 'retrying')
* `retry_count`: Integer (預設 0)
* `next_retry_at`: Timestamp (NULL)
* `created_at`: Timestamp
* `sent_at`: Timestamp (NULL)

### Job_Runs Table（排程冪等與可觀測性）
* `id`: UUID
* `weekly_event_id`: UUID
* `job_type`: String (如 `'allocate_friday'`, `'release_1030'`, `'release_1045'`, `'release_1055'`, `'settle'`)
* `status`: Enum ('running' | 'success' | 'failed' | 'skipped')
* `started_at`: Timestamp
* `finished_at`: Timestamp (NULL)
* `error_message`: String (NULL)
* （唯一鍵：`(weekly_event_id, job_type)`，確保同一場活動同類排程只成功一次）

### Staff_Sessions Table（現場 PIN 登入）
* `id`: UUID
* `weekly_event_id`: UUID
* `pin_hash`: String
* `expires_at`: Timestamp
* `failed_attempts`: Integer (預設 0)
* `locked_at`: Timestamp (NULL)
* `created_by`: UUID (FK → Users)

---

## 9. Staff 專用視圖（隱私隔離的真正防線）

```sql
CREATE VIEW staff_checkin_view AS
SELECT r.id            AS reservation_id,
       u.display_name,
       v.license_plate,
       r.walk_in_name,
       r.walk_in_license_plate,
       (r.effective_priority <= 2) AS is_priority,   -- ⭐ 優先車位，不透露原因
       r.status,
       r.attended_at
FROM reservations r
LEFT JOIN users u    ON u.id = r.user_id
LEFT JOIN vehicles v ON v.id = r.vehicle_id
WHERE r.weekly_event_id = current_weekly_event();
```
Staff 角色**僅被 GRANT SELECT 此 view**，不得直接查 `user_eligibility` / `user_penalties` / `reservations.effective_priority` 的原因欄位。`is_priority` 只給布林，達成 PRD §三「Staff 不可見具體 P1/P2 原因與違規分數」。
---

## 10. Phase 0 測試案例（純函式，不接 Supabase、不做 UI）

> 規則加入 P1、P2 10:45、正在路上、P2 subtype 後，Phase 0 的 TDD 必須同步涵蓋下列案例。

### P1 全職同工
- `active` 全職同工會從 `public_allocatable_capacity` 扣除。
- 某 P1 本週標記 `skipped` 後，該名額釋出給公開候補（容量 +1）。
- P1 不進入公開排序（不出現在 effective_priority 1/2/3 的排序結果中）。

### P2 資格與 effective_priority
- `mobility_long` → effective_priority = 2（無需宣告）。
- `mobility_short` → effective_priority = 2（無需宣告）。
- `pregnancy` → effective_priority = 2（無需宣告）。
- `elderly_companion` 未宣告（`requested_p2_this_week=false`）→ effective_priority = 3。
- `child_companion` 未宣告 → effective_priority = 3。
- `p2_eligible=true` 但 `effective_priority=3` 者，**不**收到 10:20 P2 提醒。

### 釋出（Release）
- P3：10:30 未到 → `released_late`。
- P2（`p2_on_the_way=false`）：10:45 未到 → `released_late`；10:35 到場 → `attended`（非 `attended_after_release`）。
- P2（`p2_on_the_way=true`）：10:45 不釋出；10:55 仍未到 → `released_late`；10:50 到場 → `attended`。
- 冪等：同一釋出排程重跑，第二次釋出 0 筆、不重發廣播。

### 遞補 Offer
- `temp_approved` 逾 2 小時 → 主狀態回 `waiting`、`offer_status='expired'`。
- 候補放棄 → 主狀態回 `waiting`、`offer_status='declined'`。
- 上述失敗後，下次有人取消，仍依凍結的 `allocation_order` 從原排位開始遞補。
- 週六 23:xx 取消：`offer_expires_at = MIN(now+2h, 週日00:00)`；週日 00:00 排程把殘留 `temp_approved` 升格 `approved`。

### Walk-in
- `user_id` 為 NULL、`vehicle_id` 為 NULL 時仍可顯示在 Staff 清單（`staff_checkin_view`）。
- `walk_in_license_plate` 可被後四碼搜尋。
- Walk-in 納入當週使用率統計。

---

## 11. 裝置與介面設計需求

### Staff 端（同工）— 手機 / 平板優先
> **背景：** 停車場地下室現場無電腦，同工以個人手機或教會平板操作點名介面。

| 面向 | 規格 |
| :--- | :--- |
| **目標裝置** | 手機（≥390px）與平板（≥768px）；**不設計桌面版** |
| **觸控目標** | 按鈕高度 ≥ 48px，間距 ≥ 8px（避免誤觸） |
| **網路環境** | 地下室 Wi-Fi；需評估離線降級策略（至少可離線讀取本週清單） |
| **操作場景** | 單手持機、站立、光線不均；字體 ≥ 16px，對比度符合 WCAG AA |
| **主要功能** | 到場點名、遲到補點名、登記散客、結束點名 |
| **不得顯示** | P2 具體原因（行動不便 / 孕婦 / 幼兒 / 年長者）、違規分數 |

### Admin 端 — 桌面 / 平板均可
Admin 通常在教會辦公室操作，桌面與平板皆支援。

### 會友端（LINE LIFF）— 手機優先
LIFF 本質上即手機介面，依 LINE 內建瀏覽器規格開發。

---

## 12. 本機開發 / Supabase 操作注意事項（Phase 1–2 實作發現）

> 這兩點是 Phase 2 Slice 1 實作時踩到的本機 Supabase 行為，記錄以免重複踩雷。

1. **`service_role` 需要明確的 DML GRANT。** 本機 Supabase 的 default privileges 只給 API 角色 `Dxtm`（truncate/references/trigger/maintain），**不含** SELECT/INSERT/UPDATE/DELETE。`service_role` 雖然 bypass RLS，仍需 table 層 GRANT。故 migration `0004` 加上 `grant select, insert, update, delete on all tables in schema public to service_role;`，`0005` 對 `v_reservations_for_allocation` 另外 `grant select ... to service_role;`。新增資料表/視圖時要記得一併授權給 `service_role`。

2. **此版 Supabase 採用 `sb_publishable_` / `sb_secret_` 金鑰。** 舊的 `service_role` JWT 會被當成未授權（fallback 到 anon → permission denied）。本機 `.env.local` 的 `SUPABASE_SERVICE_ROLE_KEY` 應填 `npx supabase status` 輸出的 **`sb_secret_...`（SECRET_KEY）**，不是舊版 JWT。`SUPABASE_URL` 用 `http://127.0.0.1:54321`。

> 以下為 Phase 2 Slice 2 實作發現。

3. **`*.db.test.ts` 整合測試必須序列化執行。** 多個整合測試檔共用同一個本機 Supabase DB，且重用固定的測試週日（`2099-01-04`/`2099-01-11`）與 seed 成員；而「每位成員只能有一筆 active 預約」是**全域** unique index。vitest 預設平行跑各測試檔，兩檔的 `beforeAll` 會在 `weekly_events_sunday_date_key` 與該 index 上互撞。已在 `vitest.config.ts` 設 `fileParallelism: false`（純函式單元測試夠快，序列化成本可忽略）。在 `RUN_DB_TESTS=1` 同時跑兩個整合檔時才會浮現此衝突。

4. **取消已取消的預約須為冪等 no-op。** `cancelReservation` 對已是 `cancelled_by_user`/`cancelled_late` 的列直接回傳 `{ cancelled: false }`（不丟錯、不呼叫 RPC），符合「重跑 cancel/resolve 為 no-op」的設計；`temp_approved` 仍拒絕（請走 offer endpoints）。
