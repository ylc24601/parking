# 教會主日停車管理系統 — 開發交接文件（Current Handoff）

> 最後更新：2026-07-04 ｜ **Phase 3 已結案；Phase 4 進行中（Slice A + B + C + D 完成）** ｜ 範圍：Phase 0、Phase 1、Phase 2 Slice 1–4、Phase 3 Slice 1 + v2 全部切片（walk-in / 穩定度 / 紙本備援 / 結束當週點名 / 真 PIN session / weekly_events finalize / auto-finalize fallback）+ **Phase 4 Slice A — LINE notification dispatcher** + **Phase 4 Slice B — Staff「請車主移車」** + **Phase 4 Slice C — dispatcher ops hardening（排程綁定 + dryRun 預覽 + outbox 健康度可視 + production transport guard）** + **Phase 4 Slice D — 釋出時通知被釋出成員本人（`reservation_released`）** 全數完成
>
> **本階段：Phase 4 — Notification & LINE Integration**。**Slice A（dispatcher）+ B（移車請求）+ C（ops hardening）+ D（釋出通知本人）已完成**（見 §6.13 / §6.14 / §6.15 / §6.16）。**下一步（go-live 前置，ops 軌）：真實 OA channel token + 移車/釋出文案定稿 + per-member `line_id` 綁定流程；正式排程掛載（Vercel Pro cron 或外部排程，見 [dispatcher-ops.md](dispatcher-ops.md)）。** 見 [v2-backlog.md](v2-backlog.md) §2 與 §9 Deferred。
> 對應規劃文件：[development_plan.md](development_plan.md)、[Church_Parking_Management_System_PRD.md](Church_Parking_Management_System_PRD.md)
> 程式碼根目錄：`parking-system/`（`@/*` alias 指向該目錄）

---

## 0. 一頁摘要（TL;DR）

| 階段 | 內容 | 狀態 |
|------|------|------|
| Phase 0 | 純函式核心邏輯（排序、分配、釋出、點名、狀態機、容量、違規） | ✅ 完成 |
| Phase 1 | Supabase/PostgreSQL schema、RLS/GRANT、views、schema 驗證 SQL | ✅ 完成 |
| Phase 2 Slice 1 | 週五 18:00 分配持久層 + 原子 RPC | ✅ 完成 |
| Phase 2 Slice 2 | 取消 + 遞補 + offer 生命週期（confirm/decline/expire/auto-approve） | ✅ 完成 |
| Phase 2 Slice 3 | 主日釋出 + P2 正在路上 grace + 10:20 提醒 + 出席點名 | ✅ 完成 |
| Phase 2 Slice 4 | 結算 / no-show + 違規累加 + 牧養關懷 alert | ✅ 完成 |
| Phase 3 Slice 1 | Staff 現場頁（行動版）：點名清單 + 車牌後四碼搜尋 + 一鍵點名 / 補點名 | ✅ 完成 |
| Phase 3 v2 P1 | Staff walk-in 現場登記（搜尋無果入口 + 兩層去重 + Staff-safe） | ✅ 完成 |
| Phase 3 v2 P2 | Staff 現場頁穩定度（誤點復原 undo 視窗 + 離線只讀快取） | ✅ 完成 |
| Phase 3 v2 Stability Slice B | Staff 紙本備援清單（可列印 `/staff/print`，硬離線 fallback） | ✅ 完成 |
| Phase 3 v2 結束當週點名 | Staff settle route + UI（Staff-safe DTO，包裝既有 Slice 4 結算服務） | ✅ 完成 |
| Phase 3 v2 真 PIN session | per-event PIN（scrypt）+ 鎖定/過期 + cookie session + **event 綁定**（取代 getActiveEvent stub） | ✅ 完成 |
| Phase 3 v2 weekly_events finalize | settle 後標 `finalized`，finalized event 擋所有 Staff 寫入（check-in/walk-in/settle）、讀取仍可 | ✅ 完成 |
| Phase 3 v2 Auto-finalize fallback | 內部 job（job-secret）掃過寬限期仍 `open` 的過去週，逐筆 settle + finalize；**營運兜底、非同工主流程** | ✅ 完成 |
| **Phase 4 Slice A** | **LINE notification dispatcher**：outbox → LINE 實際送出（原子 claim/lease 防並發重送 + 顯式 `NOTIFICATION_TRANSPORT` 模式 + 型別化失敗分類 + backoff 重試）| ✅ 完成 |
| **Phase 4 Slice B** | **Staff「請車主移車」**：`staff_checkin_view` 加 Staff-safe `owner_notifiable` 布林 + 伺服器端車主解析（不洩 `line_id`/`user_id`）+ enqueue `move_car_request` → dispatcher 送出；Staff 列上「請移車」動作 | ✅ 完成 |
| **Phase 4 Slice C** | **Dispatcher ops hardening**：dispatch route 加 GET（Vercel Cron / 外部排程）+ `cronOrJobSecretValid`（x-job-secret 或 `Bearer $CRON_SECRET`）+ `dryRun` 無異動預覽 + `outbox_health` RPC/route/CLI 健康度可視（operation-safe）+ production 拒 `mock`（`mock_in_production`）| ✅ 完成 |
| **Phase 4 Slice D** | **釋出時通知被釋出成員本人**：主日釋出 sweep 將 `approved`→`released_late` 時，除對候補者廣播外，另發一則 `reservation_released` 給被釋出的車主（一次性 `released_owner:<id>` dedupe；資訊性、無罰責、`已於 {time} 釋出` 非期限）；migration `0015` 4-arg `apply_release`（+ 3-arg 相容 wrapper），owner notice 僅由本 sweep `released` CTE 產生並三重再驗證（reservation_id/user_id/template）；**結算 pre-sweep 靜默**（`notifyReleasedOwners:false`）| ✅ 完成 |

**主日完整生命週期（分配 → 取消/遞補 → 釋出/出席 → 結算）已全部落地，並補上 Staff 現場頁
（點名/補點名/walk-in 登記/誤點復原/離線只讀/紙本備援清單/結束當週點名/真 PIN session/結束整週 finalize/auto-finalize fallback）。
Phase 3（Staff 現場頁 + v2 全部切片）至此結案。** 下一階段為 **Phase 4 — Notification & LINE Integration**
（LINE notification dispatcher + 移車通知、Member/Admin UI），見 [v2-backlog.md](v2-backlog.md) 與 §9 Deferred。

**目前測試狀態（Phase 4 Slice D 本回合實跑）：** `tsc --noEmit` ✅、`eslint` ✅、`next build` ✅、
`npm test`（不接 DB）**370 passed / 40 skipped**（+ `releaseExpired` owner-notice / `runRelease` dedupe + 結算靜默 / `reservation_released` 模板 render）、
`RUN_DB_TESTS=1 npm test`（接本機 Supabase）**414 passed**（新增 `release-owner-notice.db.test.ts`：scoping / 一次性 dedupe / payload leak-scan）、`npm run db:verify` **20/20 PASS**（新增斷言 20：`apply_release` 4-arg + 3-arg wrapper + service_role execute）。
Slice D 已完成**實機 E2E**（mock transport）：釋出 sweep → outbox 同時有 `released_owner:<id>`（`reservation_released`，payload 僅 `released_at`）與 `broadcast_release`；render 出資訊性文案「您本週保留的車位已於 10:46 釋出…請前往地下室現場洽詢停車同工」；
mock dispatch 兩則皆 **sent**；**重跑釋出 → 0 重複** owner notice（dedupe）；結算 pre-sweep 對被釋出者 **靜默**（`notifyReleasedOwners:false`）。
排程/預覽/健康度 runbook 見 [dispatcher-ops.md](dispatcher-ops.md)。
**本機 Supabase stack 本回合啟動並實跑，驗證後可停止。**

**架構分層（Slice 1–4 一致）：** thin route（`/api/internal/*`，job-secret 驗證）→ service（商業邏輯，呼叫 Phase 0 純函式）
→ repository（supabase-js）→ 原子 plpgsql RPC 或 status-guarded 單句寫入。商業邏輯留在 TypeScript，SQL 只負責原子套用。

---

## 1. Phase 0 — 純函式核心（`lib/allocation/`）

不接 Supabase、不碰 UI；單一事實來源的商業規則，全部以 Vitest 純函式測試覆蓋。

| 檔案 | 職責 |
|------|------|
| `rules.ts` | 所有魔術數字的單一來源：`OFFER_CONFIRM_WINDOW_HOURS=2`、`MAX_PENALTY=3`、`PASTORAL_CARE_THRESHOLD=4`、`DEFAULT_TOTAL_CAPACITY=23`、`TAIPEI_UTC_OFFSET_HOURS=8`、`RELEASE_TIMES`（10:30/10:45/10:55） |
| `priority.ts` | `effective_priority` 判定（P1/P2/P3） |
| `sort.ts` | 候補排序（priority → penalty → last_attended NULLS FIRST → applied_at） |
| `allocate.ts` | 容量計算 + 週五分配（approved/waiting + allocation_order 快照） |
| `substitute.ts` | `triggerSubstitution`、`failOffer`（保留 allocation_order）、`autoApproveTempApproved` |
| `release.ts` | `buildReleaseDeadlines`、`computeReleaseDeadline`、`releaseExpired`、`buildSundayMidnight` |
| `settle.ts` | `markAttendance` / `applyAttended` / `applyAttendedAfterRelease`（Slice 3 接 DB）、`settleNoShow`（Slice 4 接 DB） |
| `transitions.ts` | 預約狀態機合法轉移表 |

**關鍵設計：**
- 時間一律以 Asia/Taipei（UTC+8，無 DST）建構；deadline 為「每筆預約自帶」的 `release_deadline_at`。
- offer 結果（expired/declined）是子狀態 `offer_status`，主狀態退回 `waiting` 並保留 `allocation_order`，不另設主狀態。
- `release_deadline_at` 型別為 `Date | null`（DB 內 pending/waiting 為 null），純函式皆做 null guard。

---

## 2. Phase 1 — 資料庫 Schema（`supabase/migrations/0001–0004`）

模型：**service-role + 應用層授權**。RLS 為縱深防禦（對 anon/authenticated 一律 deny-all）；Next.js server 用 service key（bypass RLS）。

| Migration | 內容 |
|-----------|------|
| `0001_enums_core.sql` | enums、`users`、`user_eligibility`、`user_penalties`、`vehicles`（normalized plate 唯一） |
| `0002_events_reservations.sql` | `weekly_events`、`weekly_staff_allocations`、`reservations`（含多個 CHECK/部分唯一索引） |
| `0003_infra.sql` | `notification_outbox`（`dedupe_key` 唯一）、`job_runs`、`staff_sessions`、`audit_logs` |
| `0004_views_rls.sql` | `v_weekly_capacity_inputs`、`staff_checkin_view`（隱私投影）、RLS 啟用 + GRANT 策略 |

**關鍵 CHECK / 索引（與商業規則對齊的「縫」）：**
- `status='approved'` ⇒ `release_deadline_at IS NOT NULL`（approved 必有 deadline）。
- 每位成員每場 event 只能有一筆 active 預約 → 部分唯一索引 `(weekly_event_id, user_id) where status not in ('cancelled_*')`（**per-event**，非全域）。
- 車輛須屬於預約人（composite FK `(vehicle_id, user_id)`）。
- 成員列必有 user/vehicle，walk-in 必有車牌（member-shape CHECK）。
- normalized plate 唯一（`ABC-1234`/`abc1234` 視為同一）。
- `(weekly_event_id, allocation_order) where status='waiting'`（遞補挑選縫）。
- `(weekly_event_id, release_deadline_at) where status='approved'`（釋出掃描縫）。

**驗證：** `supabase/tests/verify_schema.sql`（`npm run db:verify`），加入 Slice 4 的牧養 alert 斷言後共 **12 條，12/12 PASS**。

---

## 3. Phase 2 Slice 1 — 週五 18:00 分配持久層

- **RPC** `apply_friday_allocation`（`0005`）：原子地 claim job（`job_runs` 一週一次短路）+ 更新 pending → approved/waiting + 寫 outbox（只對實際更新的列）。
- **View** `v_reservations_for_allocation`：補上 supabase-js 無法表達的 `reservations ↔ user_penalties` join。
- **Service** `fridayAllocationService.runFridayAllocation`：讀容量/pending → 呼叫 Phase 0 `allocate()` → 原子套用；回傳 `plannedApproved/plannedWaiting/updated/outboxEnqueued`。
- **Route** `app/api/jobs/friday-allocation/route.ts`；**Script** `scripts/run-friday-allocation.ts`（`npm run job:friday -- --sunday <YYYY-MM-DD>`）。
- 失敗以 `markJobFailed`（upsert）記錄並 rethrow。

---

## 4. Phase 2 Slice 2 — 取消 + 遞補 + offer 生命週期

- **RPC**（`0006`）：`apply_cancellation`（取消 + 第一筆 offer，原子）、`apply_offer`（race retry 用的純 offer）、`apply_offer_resolution`（confirm/decline/expire + 下一筆 offer，原子）。
- **Services：**
  - `cancellationService.cancelReservation`：approved → `cancelled_late` 並觸發遞補；pending/waiting → `cancelled_by_user`；temp_approved 拒絕（走 offer endpoints）；**已取消的列重跑為冪等 no-op**。
  - `offerService.resolveOffer`（confirm/decline）、`offerExpiryService.expireOffers`（2 小時逾時掃描）、`autoApproveService.autoApproveTemp`（週日 00:00 升格掃描）。
- **Routes**：`/api/internal/reservations/cancel`、`/reservations/offer`、`/jobs/expire-offers`、`/jobs/auto-approve-temp`。
- **競態處理：** read-then-apply + `WHERE status='waiting'` guard + 服務端 `offerNextSpot` 重試（帶 exclusion set，含剛 decline/expire 的列）。
- **dedupe 策略：** offer 用 `offer:{rid}:{last_offer_at_iso}`（不可用上限到午夜的 `offer_expires_at`，會碰撞）。

---

## 5. Phase 2 Slice 3 — 主日釋出 + 出席點名

- **RPC**（`0007`）：
  - `apply_release(p_event_id, p_now, p_broadcast)`：approved 且 `release_deadline_at <= now` → `released_late`；只在「實際釋出 ≥1 筆」時，對 **RPC 執行當下仍 `waiting`** 的人廣播（CTE join 活資料再驗證）。
  - `apply_attendance(p_event_id, p_reservation_id, p_target_status, p_now, p_penalty)`：approved/released_late → attended/attended_after_release，並原子套用違規回復；**SQL 內驗證 `p_target_status` 合法**，非法即 raise。
- **Services：**
  - `releaseService.runRelease`：以每筆自帶 `release_deadline_at` 的單一 deadline-driven 掃描，一次涵蓋 10:30/10:45/10:55 三層；冪等。
  - `attendanceService.checkIn`：以凍結的 `effective_priority`（1→P1、2→P2）判定「privileged（違規分數凍結）」，違規計數來自 `user_penalties`；on-time→attended、逾時→attended_after_release。
  - `onTheWayService.markOnTheWay`：P2 回「正在路上」延後至 10:55，但**僅在 deadline 尚未過（`now <= release_deadline_at`）**才成立；過了即 no-op，不可回溯延長。
  - `p2ReminderService.sendArrivalReminders`：10:20 提醒，**排除已在路上（`p2_on_the_way=true`）**者；dedupe 每場每筆一次。
- **Routes**：`/api/internal/jobs/release`、`/jobs/p2-arrival-reminder`、`/reservations/attendance`、`/reservations/on-the-way`；**Script** `scripts/run-release.ts`（`npm run job:release`）。
- **Types**：`NotificationTemplate` 新增 `'p2_arrival_reminder'`。

---

## 6. Phase 2 Slice 4 — 結算 / No-show + 違規 + 牧養關懷 alert（本次完成）

Staff 按「結束當週點名」，把仍為 `released_late` 的預約結算為 `no_show`，套用違規規則，並對達門檻的 P1/P2 開立牧養關懷 alert。

- **Migration `0008_settlement_pastoral_care.sql`：**
  - 新 enums `pastoral_care_reason('consecutive_no_show')`、`pastoral_care_alert_status('open','resolved')`。
  - **獨立 sensitive 表 `pastoral_care_alerts`**（`user_id, weekly_event_id, reason, trigger_count, status,
    created_at, resolved_at, resolved_by, note`）。**牧養 flag 不塞進 `user_penalties`**；`user_penalties` 維持只放
    `penalty_score / consecutive_no_show / last_successful_attended_at`。
  - **RLS deny-all、不暴露給 Staff**（無 Staff-scoped view/grant）；明確 `grant ... to service_role`（新表不被 0004 的
    point-in-time grant 涵蓋）。
  - **每位 user 至多一筆 open alert**（不分 reason/週）：部分唯一索引 `(user_id) where status='open'`，撐
    `ON CONFLICT DO NOTHING`。
  - **RPC `apply_settlement(p_event_id, p_now, p_penalties, p_alerts)`**：status-guarded（`status='released_late'`）批次轉
    `no_show`，penalty upsert 與 alert insert 皆 `join` 實際轉換的列；**不寫 `notification_outbox`**（牧養通知留待後續）。
- **Service `settlementService.settle({ eventId, now })`：**
  1. **先跑一次 release sweep**（`runRelease`）——補抓排程遺漏／延遲時仍為 `approved` 但已過 deadline 的列。
  2. 重讀 `released_late` → 以 `effective_priority` + `user_penalties` 組 `AllocationUser` → 呼叫 Phase 0 `settleNoShow`。
  3. penalty payload（全部）與 alert payload（僅 `pastoral_care_flag` 者）交給 `apply_settlement`。**不組 outbox。**
  - 回傳 `{ releasedNow, settled, penaltiesApplied, alertsCreated }`。
- **Repository**：`getReleasedLateForSettlement`、`getPenaltyCountersForUsers`（batch）、`applySettlement`。
- **Route** `/api/internal/jobs/settle`；**Script** `scripts/run-settle.ts`（`npm run job:settle`）。

### 違規與牧養關懷規則（釐清，源自 `settleNoShow`）
- `settleNoShow` 對**所有** no-show user 都會 `consecutive_no_show + 1`。
- **P3 也會被加 `consecutive_no_show`**，但 P3 目前的停車違規是看 `penalty_score`；其 `consecutive_no_show` 計數未被任何邏輯讀取（不在排序、不觸發牧養），實務上無害。
- **牧養關懷 alert 僅限 privileged（依 `effective_priority` 判定的 P1/P2）**，條件為 `consecutive_no_show >= PASTORAL_CARE_THRESHOLD(4)`。
- **P1/P2 的 `penalty_score` 凍結**，由 `consecutive_no_show` 驅動牧養 alert。
- **P3 的 `penalty_score` 累加**，上限 `MAX_PENALTY(3)`。
- `last_successful_attended_at` 不因 no-show 而更動（penalty upsert 只動兩個計數欄）。

---

## 6.5 Phase 3 Slice 1 — Staff 現場頁（行動版，本次完成）

第一個對外人類介面：現場同工用手機/平板在地下室看當週清單、一鍵點名、遲到補點名。
**薄薄一層 UI + route 疊在既有後端上**，直接複用 `attendanceService.checkIn`，不改 schema、不改 Slice 1–4 行為。
對應規劃：PRD §三/§八、development_plan §9/§11。

**範圍（Slice 1 只做）：** 點名清單頁 + 車牌後四碼搜尋 + 一鍵「點名」+「補點名」。

- **無新 migration。** `staff_checkin_view`（隱私投影，9 欄）已被 `0004` 的 `grant ... on all tables in schema public to service_role` 涵蓋（view 早於該 grant 建立），service_role 可直接 SELECT。
- **Type（`lib/types.ts`）：** `StaffCheckInRow` —— view 的隱私投影列型別（name / plate / walk-in name+plate / `is_priority` 布林 / status / attended_at）。
- **Repository（`server/repositories/parkingRepository.ts`）：**
  - `getActiveEvent()`：Staff 頁綁定的 event（最新 non-finalized 週日；Slice 1 stub，代替未來 PIN session 的 `weekly_event_id`）。
  - `getStaffCheckInList(eventId)`：讀 `staff_checkin_view`，以 `STAFF_CHECKIN_STATUSES`（`approved` / `released_late` / `attended` / `attended_after_release` / `walk_in`）過濾出「現場需處理」的列。**只查 view，絕不查原表。**
- **Auth（`server/http/staffAuth.ts`，dev stub）：** cookie-based session。`validatePin()`（接受 `STAFF_DEV_PIN` 或 dev 下任意 6 位數）→ `setStaffSession()` 寫 httpOnly cookie；`staffAuthed()` 驗 cookie。**SEAM：** 真 PIN session（`staff_sessions` 雜湊 / 鎖定 / 過期）落地時只換此檔內部，外部不動。
- **Routes（`app/api/staff/*`）：**
  - `POST /login`（驗 PIN stub → set cookie）、`POST /logout`（清 cookie）。
  - `GET /checkin-list`（cookie 守護 → `getActiveEvent` + `getStaffCheckInList`，回 `{ ok, event, rows }`）。
  - `POST /checkin`（cookie 守護 → `checkIn({ reservationId })`；`approved`→`attended`/`attended_after_release`，`released_late`→`attended_after_release`；冪等）。**回 Staff-safe DTO `{ ok, attended, status }`，不含 `penaltyUpdated`。**
- **Frontend（`app/staff/*`，行動優先 ≥390px，Tailwind，按鈕 ≥48px）：**
  - `page.tsx`（server component）：驗 cookie → 未登入渲染 `<StaffLogin>`，已登入則 server 端取清單以 props 交給 `<StaffCheckIn>`（敏感資料不過 client）。
  - `StaffLogin.tsx`：6 位數 PIN pad（mockup，POST `/login`）。
  - `StaffCheckIn.tsx`：容量摘要、狀態篩選 chip、車牌後四碼前端即時搜尋、一鍵點名/補點名（樂觀更新 + 失敗回滾 + toast）、空狀態。（walk-in 按鈕已於 v2 P1 接成真功能，見 §6.6；結束當週點名按鈕仍 disabled「Coming soon」。）

### 隱私邊界（硬性，已實機驗證）
- Routes **只讀 `staff_checkin_view`**；UI 只顯示 **姓名 / 車牌 / ⭐ `is_priority` / 狀態 / 已到時間**。
- **不暴露：** P2 原因、`penalty_score`、`consecutive_no_show`、`phone_number`、`line_id`、`release_deadline_at`、`p2_on_the_way`、`pastoral_care_alerts`。
- `POST /checkin` 回 **Staff-safe DTO `{ ok, attended, status }`**（丟棄 `penaltyUpdated`）。

### 驗證
- 靜態：`tsc --noEmit` ✅、`eslint` ✅、`next build` ✅（`/staff` 為 dynamic，4 條 `/api/staff/*` 皆編譯）。
- 測試：`npm test`（不接 DB）**208 passed / 14 skipped**（新增 `validatePin` 與 checkin route Staff-safe DTO 共 6 筆）；`RUN_DB_TESTS=1 npm test` **222 passed**；`db:verify` **12/12**。
- **實機 DB E2E（本機 Supabase）通過：** 未登入 →401；無效 PIN →401；6 位 PIN →set cookie；`getActiveEvent` 解析 seed event；清單由 view 載入 6 列；rendered HTML 與 API JSON 皆**無敏感字串**（phone / `mobility_long` / line_id / release_deadline / p2_on_the_way / penalty / pastoral）；點名 `approved`→`attended`（attended_at 寫入）；補點名 `released_late`→`attended_after_release`；重點冪等（`attended:false`、狀態與時間不變）。

### 行為備忘（非 bug，下一 slice 注意）
- **原始 seed 的 Staff 清單只會看到 walk-in**：5 筆 member reservation seed 為 `pending`，分配前不進現場清單。實機 demo 需先跑分配，或預備 demo 用的 `approved`/`released_late` 列／專屬 demo seed。
- **on-time `attended` 取決於 deadline 在未來**：實機「現在」晚於 seed 週日（2026-06-21）時，未調整的 approved 會被點成 `attended_after_release`；production 不受影響（deadline 就在當週日）。E2E 時把 deadline 設為 `now()+1d` 取得真正 on-time。
- **`getActiveEvent()` 為 Slice 1 stub**（取最新 non-finalized event）；未來 PIN session 應**明確綁定 event**。

---

## 6.6 Phase 3 v2 P1 — Staff walk-in 現場登記（本次完成）

把「沒預約直接進場」的散客車由同工現場登記進當週清單，**即視為已到、計入現場、可被搜尋**。
入口照同工會議定案放在「搜尋找不到 → 直接登記」（feedback Q1）。複用 Slice 1 的 staff route / cookie auth /
`staff_checkin_view` 架構，不碰 Phase 0–2 與隱私邊界。對應 [v2-backlog.md](v2-backlog.md) §2 P1。

- **Migration `0009_walkin_plate_unique.sql`：** 部分唯一索引（race backstop）
  `unique (weekly_event_id, upper(regexp_replace(walk_in_license_plate,'[^A-Za-z0-9]','','g'))) where status='walk_in'`，
  正規化表達式對齊 `vehicles.license_plate_normalized`（`0001`）。**只擋 walk-in vs walk-in 的並發 race**；跨「正式預約車牌」的去重在 service 層（見下）。
- **`lib/plate.ts` `normalizePlate()`：** 大寫 + 去非英數，client / server / DB 三處一致的單一來源。
- **Repository（`parkingRepository.ts`）：**
  - `createWalkInReservation(eventId, plate, name, nowIso)`：insert `status='walk_in'`、`user_id/vehicle_id=null`、`effective_priority=3`、`applied_at=attended_at=now`；`.select()` 只取需要欄位、**不用 `*`**，映成 `StaffCheckInRow` 白名單；`23505` → `{ duplicate:true }`。**raw 列不離開 repo。**
  - `getStaffCheckInList` 加排序 `attended_at desc nulls-first, reservation_id`（未點到置頂、reload 穩定；順帶部分滿足 P1.5）。
- **Service `walkInService.registerWalkIn`：** 空車牌 → throw（route 轉 400）；**兩層去重**：① app precheck 讀 `getStaffCheckInList` 比對 normalized plate（**涵蓋已在清單的 member 車牌**）→ 命中即 duplicate；② DB unique index 為並發最後防線。回 `{ created, row | duplicate }`。
- **Route `POST /api/staff/walkins`：** cookie 守護 → 解析 `getActiveEvent` → `registerWalkIn`；duplicate → 409，created → 200 `{ ok, row }`。**Staff-safe DTO 白名單，禁止回傳 raw reservation 列。**
- **Frontend（`StaffCheckIn.tsx`）：** 兩個入口 ——（①）搜尋無結果處「＋ 登記為現場車輛」（帶入已打車牌）、（②）footer「＋ 登記現場車輛」（解除 disabled）。bottom-sheet 表單（車牌必填、姓名選填），非樂觀送出 → 成功插入清單頂部 + toast；409 →「此車牌已在清單」。`normalizePlate` 改 import `lib/plate`。

### 驗證
- 靜態：`tsc` ✅、`eslint` ✅、`next build` ✅（`/api/staff/walkins` 已註冊）。
- 測試：`npm test` **218 passed / 18 skipped**（新增 `walkInService` 6 + `walkinsRoute` 4）；`RUN_DB_TESTS=1 npm test` **236 passed**（新增 `tests/integration/walk-in.db.test.ts` 4 筆：真 insert→view、normalized 去重、**member 車牌 precheck**、Staff-safe 欄位）；`db:verify` **13/13**（新增 assertion 13：normalized walk-in 車牌去重）。
- **實機 HTTP E2E：** 401 未登入 → 400 缺車牌 → 200 建立（回應僅白名單、無 `user_id`/`effective_priority`）→ DB 列 `walk_in`/P3/`user_id` null/`attended_at` 有值 → 409 normalized 重複 → 409 與 seed walk-in 重複 → 計數不重複新增。

---

## 6.7 Phase 3 v2 P2 — Staff 現場頁穩定度（本次完成）

回應同工會議 Q7「點錯人 / 網路斷線」。**全前端**，不動後端 / RPC / schema / 隱私邊界（`db:verify` 仍 13/13）。
方向（探索定案）：**伺服器端「取消點名」會失真**（`markAttendance` 對 P3 `penalty_score -1` 且 clamp 0、覆寫 `last_successful_attended_at`，`apply_attendance` 只存最終值），故改「送出前 undo」；專案無 PWA/SW，故用 localStorage 只讀快取。

- **誤點復原（undo 視窗）— `app/staff/StaffCheckIn.tsx`：**
  - 點名/補點名改「樂觀更新 + 延遲 5 秒送出」；**`pendingRef` / `timerRef`** 持狀態（`setTimeout` 不讀 stale state）。
  - 視窗內按「復原」→ **完全不送 API、不動違規分數**，直接還原該列。
  - **flush 時機**：按下一筆動作前、`logout()` 前（`await commitPending()`，best effort；瀏覽器關閉/硬重整無法保證）。timer 於 undo / commit 成功 / commit 失敗 / unmount 皆清除。
  - undo bar 文案「已點名 {名} · 尚未送出　[復原]」。
- **離線只讀快取 — `lib/staffCache.ts`（新）：**
  - localStorage 只讀快取；**cache metadata：`schemaVersion` / `cachedAt` / `event` / `rows`**。
  - **只寫 server-confirmed 資料**（初載 / reload 成功 / commit 成功 / walk-in 成功）；pending/樂觀**不寫**。
  - **stale-week guard `isCacheCurrent`**：`schemaVersion` 相符 + `cachedAt` 夠新（~12h）+ `event.sunday_date` 等於當週主日；否則不拿舊清單冒充今天，顯示「尚未下載本週清單，請恢復網路後重新整理」。
  - **登出 `clearStaffCache()`**（共用裝置不殘留）。
- **離線偵測 + 守則：** offline 由 `offline`/`online` 事件**與** fetch 失敗共同驅動；`online` 只觸發重試，**僅 reload 成功才清除**「離線」橫幅。**離線寫入守則**（toast「目前離線，請恢復網路後再操作」）套用於 **點名 / 補點名 / walk-in 送出**（結束當週點名仍 disabled）。reload 失敗**優先保留現有 rows**，畫面為空才退快取。

### 驗證
- 靜態：`tsc` ✅、`eslint` ✅、`next build` ✅。
- 測試：`npm test`（不接 DB）**229 passed / 18 skipped**（新增 `tests/unit/lib/staffCache.test.ts` 11 筆：round-trip + metadata、schemaVersion/壞 JSON/localStorage 拋錯回 null、`isCacheCurrent` 當週/過舊/非當週、`currentSundayISO`）；`RUN_DB_TESTS=1` **247 passed**。
- **瀏覽器手動 pass：** undo（視窗內復原→不送 API、逾時→送出、按第二筆→第一筆先送）、離線（Chrome DevTools Network→Offline：橫幅、寫入被擋、reload 成功才清橫幅）、登出清快取。

---

## 6.8 Phase 3 v2 Stability Slice B — Staff 紙本備援清單（本次完成）

補 v2 P2 涵蓋不到的**硬離線**：只讀快取只救「頁面開著時斷線」，**冷啟動 / 完全沒網路**（地下室）需 service worker（較重，列 P2.5）。
本刀先做最務實 fallback：**主日前印一張紙本**，網路全斷時人工勾點、回線後系統補登。**純前端、唯讀**，不動後端 / RPC / schema / 隱私邊界（`db:verify` 仍 13/13）。

- **共用呈現 helper — `lib/staffRow.ts`（新）：** 把原寫死在 `StaffCheckIn.tsx` 的 `rowName` / `rowPlate` / `isWalkIn` / `sundayLabel` / 狀態文字抽出集中，避免列印頁與現場頁文案漂移。
  - 新增 `statusLabel(status)`（集中狀態用語）、`sortRowsForPrint(rows)`（純函式：⭐ 優先在前，其餘依 `normalizePlate` 車牌序；缺車牌/姓名不拋錯）、`DONE_STATUSES`。
  - **`StaffRow` 型別在此擁有**（client 序列化形：`attended_at: string`、無 `weekly_event_id`，與 `lib/types.ts` 的 server `StaffCheckInRow` 不同）；`StaffCheckIn.tsx` 改 import 並 re-export 維持既有路徑，`lib/staffCache.ts` 改 import `@/lib/staffRow`。**不以 `'use client'` 元件當 type barrel。**
- **列印頁 — `app/staff/print/page.tsx`（新，server component）+ `PrintButton.tsx`（client）：**
  - 鏡射 `app/staff/page.tsx`：同 `staffAuthed()` gate（**未登入回 `<StaffLogin />`，DB 不被查、清單不外洩**）+ **同一 Staff-safe 來源 `getStaffCheckInList` / `staff_checkin_view`**（不碰 `reservations` / `user_eligibility` / `user_penalties`）。
  - 淺色黑字可列印表格：`⭐` / 姓名 / 車牌 / 目前狀態 / `☐ 到場`（手勾）/ `現場備註`（空白，含「請勿記錄電話、病況、行動不便原因等個資」提醒）。
  - 表頭 metadata：主日、列印時間、總台數、⭐ 優先台數、備援說明句「紙本僅供網路異常備援，恢復網路後請於系統補登。」
  - `PrintButton` 為唯一互動島（`window.print()`，`print:hidden`，**不在載入時自動列印**）+ 返回連結。
  - **入口**：`StaffCheckIn.tsx` footer 加「🖨 列印備援清單」連到 `/staff/print`（新分頁；列印是主日前在有網路時的準備動作，故無離線守則）。

### 驗證
- 靜態：`tsc` ✅、`eslint` ✅、`next build` ✅（`/staff/print` 註冊為 ƒ dynamic route）。
- 測試：`npm test`（不接 DB）**241 passed / 18 skipped**（新增 `tests/unit/lib/staffRow.test.ts` 12 筆：`statusLabel` 映射、`rowName`/`rowPlate`/`isWalkIn`（member/walk-in/兩者皆缺）、`sundayLabel`、`sortRowsForPrint` 優先在前/正規化車牌序/walk-in/缺欄不拋錯/不變動入力）；`RUN_DB_TESTS=1` **259 passed**（本刀無新增 DB 測試）。
- **路由驗證：** 未登入 `GET /staff/print` 回 PIN 登入頁（無清單資料、無敏感欄位）。
- **待瀏覽器手動 pass（登入後）：** 列印頁版面、表頭 metadata、⭐ 優先在前、`Cmd+P` 預覽（互動元素不入列印輸出）、隱私稽核（DOM/列印輸出無 `phone_number`/`line_id`/`p2_reason`/`penalty_score`/`consecutive_no_show`/`release_deadline_at`/`p2_on_the_way`/`pastoral_care_alerts`）。

---

## 6.9 Phase 3 v2 — Staff 結束當週點名（settle route + UI，本次完成）

把 Slice 4 既有的結算服務接出對外 Staff 入口：主日尾聲同工按「結束當週點名」，將仍 `released_late`
（已釋出、最終未到場）的預約一次結算為 `no_show`。**純 Staff-safe route + UI wrapper，不重新設計
Phase 2**（結算/違規/牧養邏輯全在既有 `settlementService.settle()` + RPC `apply_settlement`，見 §6）。
不動 schema / RPC / service（`db:verify` 仍 13/13）。對應 [v2-backlog.md](v2-backlog.md) §2「之後」。

- **Route `POST /api/staff/settle`（新）：** 鏡射 walkins route —— cookie 守護 → server 端 `getActiveEvent`
  （**不信任 client eventId**）→ `settle({ eventId }, repo)`（傳入同一 repo）。
  **嚴格 Staff-safe DTO：只回 `{ ok, settled, releasedNow }`**；`penaltiesApplied` / `alertsCreated`
  揭露違規/牧養活動，**永不外洩**（單元測試以 mock 回傳含此二欄的 summary、斷言路由濾掉）。無 request body。
- **UI（`StaffCheckIn.tsx`）：** footer disabled 按鈕接成真功能 ——
  - **二次確認 sheet**（沿用 walk-in 版型）：顯示目前可見的 `released_late` 台數「目前有 X 台已釋出未到將被結算」
    + 提醒「實際結算台數可能不同（先做最終釋出掃描）」+「此動作**無法復原**」。**不提 penalty / 牧養**。
  - **`submitSettle`**：離線守則 → **先 `await commitPending()` flush undo 視窗未送出的點名**（flush 失敗則
    `尚有點名未送出，請重試` 並**中止結算**）→ POST → 成功 toast「已結束本週點名（本次結算 X 台未到）」→
    `reload({ silent:true })` 重載清單（settled→`no_show` 自動移出列表）。
  - **錯誤分流**：401 → refresh session；非 ok 的 HTTP/server 錯誤 → toast「結算失敗」**不翻 offline**；
    真正網路 throw → offline。**settle 成功但 reload 失敗** → 保留成功 toast + 加註「清單重新整理失敗，請稍後重新整理」。
  - **`settleBusy` 期間**鎖住其他寫入（點名 / 補點名 / walk-in / 開 walk-in sheet）。
- **未做 / 釐清：** `settle()` **不**改 `weekly_events.status`（不 finalize 事件本身）——事件 finalize 留待後續切片（見 §9）。

### 驗證
- 靜態：`tsc` ✅、`eslint` ✅、`next build` ✅（`/api/staff/settle` 註冊為 ƒ dynamic route）。
- 測試（本回合實跑）：`npm test`（不接 DB）**246 passed / 18 skipped**（新增 `tests/unit/server/settleRoute.test.ts` 5 筆：
  401 未登入、400 無 active event、**嚴格 Staff-safe DTO（斷言無 `penaltiesApplied`/`alertsCreated`）**、
  server 端綁定 event、service throw → 500）。
- 測試（**未重跑、推論未變**）：`RUN_DB_TESTS=1` 前次 259 → 本刀 5 筆皆純 route 單元測試（接/不接 DB 都跑）、
  無 DB/schema 變更，推論 **264**；`db:verify` **13/13**（前次值，無 schema 變更）。結算 DB 行為已由
  `tests/integration/settlement.db.test.ts` 覆蓋，故未另起 stack 重跑。
- **路由驗證（本回合實跑）：** 未登入 `POST /api/staff/settle` 回 401（`{ ok:false, error:'unauthorized' }`）。
- **⚠️ 待瀏覽器手動 pass（唯一未完成驗證項，登入後、需先 seed 一筆 `released_late` 列）：**
  確認 sheet 顯示台數 → 確認 → toast 顯示結算台數 → `released_late` 列移出清單；冪等（再按 `settled:0`、清單不變）；
  離線守則擋送出；**隱私稽核** `/api/staff/settle` 回應只有 `ok`/`settled`/`releasedNow`（無 penalty/牧養/敏感欄位）。

---

## 6.10 Phase 3 v2 — Staff 真 PIN session（取代 dev stub，本次完成）

把 Slice 1 的 dev-stub cookie auth（任意 6 碼、cookie 常數 `'ok'`）換成**真的 per-event PIN session**，
並順手把 session 綁的 event **取代 `getActiveEvent()` stub**。後端 schema（`staff_sessions`，`0003`）早已就緒。

- **模型**：**per-event 共用 PIN 憑證 + per-device cookie marker**（非 per-device session 管理；單裝置撤銷留待後續）。
  一個 weekly_event 一把 PIN（`staff_sessions` 每 event 唯一）。
- **雜湊**：`server/http/pinHash.ts` —— scrypt（Node 內建、16-byte 隨機 salt、`scrypt$salt$hash`、`timingSafeEqual` 比對）。明文 PIN 不落地、不入 log。
- **政策常數（`lib/allocation/rules.ts`）**：`STAFF_PIN_MAX_ATTEMPTS=5`、`STAFF_PIN_LOCK_MINUTES=15`、`STAFF_SESSION_TTL_HOURS=12`。
- **Migration `0010_staff_pin_session.sql`**：`staff_sessions (weekly_event_id)` 唯一索引；原子失敗計數 RPC
  `apply_staff_pin_failure(p_id, p_threshold)`（單句 `failed_attempts+1` + 到門檻設 `locked_at`，避免讀-改-寫 race）+ `service_role` execute grant。
- **服務 `server/services/staffSessionService.ts`**：
  - `loginStaff(pin)`：`getActiveEvent` → `getStaffSessionByEvent` → 過期/無列→invalid、鎖定中→locked、
    正確→重置失敗數 + 回 `{ sessionId, eventId }`、錯誤→`apply_staff_pin_failure`（到門檻轉 locked）。
  - `setStaffPin({ sunday, pin, ttlHours? })`：CLI 用，hash + upsert。
- **`server/http/staffAuth.ts`（SEAM 內部改寫）**：cookie 改帶 **session row id**；
  `getStaffSession()` 讀 cookie → `getStaffSessionById` → **只驗 row 存在 + `expires_at`**（**刻意不檢查 `locked_at`**——
  鎖定只擋新登入、不撤銷已登入 cookie）→ 回 `{ sessionId, eventId }`；`staffAuthed()` = `getStaffSession() !== null`。
- **隱私（login 不洩漏「今日是否已設 PIN」）**：無 event / 無列 / 過期 / 錯 PIN **一律 401 `invalid_pin`**，唯獨**鎖定回 423 `locked`**。
- **event 綁定**：`/staff` page、`/staff/print`、`checkin-list`、`walkins`、`settle` 改用 `getStaffSession().eventId`
  （移除 `?event=` 覆寫、不信任 client id）。**`checkin` route 安全綁定**：傳 `session.eventId` 進 `checkIn`，
  `r.weekly_event_id !== eventId` → throw `wrong_event` → route **409**（event A 的 session 不能點 event B 的預約）。
- **UI**：`StaffLogin.tsx` 對 423 顯示「嘗試過多，請 15 分鐘後再試」。
- **CLI `scripts/set-staff-pin.ts`**（`npm run staff:set-pin -- --sunday <date> --pin <6碼> [--ttl-hours] [--created-by]`）。
  ⚠️ `--pin` 為 MVP 權宜，PIN 可能殘留 shell history / process list；正式版應由 Admin UI 取代。`created_by` nullable、選填。
- **相容性**：舊 dev-stub cookie（值 `'ok'`）部署後讀為非存在 session → 需重新登入一次。
- **未做（明確）**：**不** finalize `weekly_events.status`（事件本身鎖定另開 slice，見 §9）。

### 驗證（本回合實跑）
- 靜態：`tsc` ✅、`eslint` ✅、`next build` ✅（`/api/staff/*` 皆註冊）。
- 測試：`npm test`（不接 DB）**268 passed / 18 skipped**（新增 pinHash / staffSessionService / loginRoute / getStaffSession /
  跨 event checkin 拒絕等；既有 walkins/settle/checkin/attendance 測試改綁 session）；`RUN_DB_TESTS=1` **290 passed**
  （新增 `tests/integration/staff-pin.db.test.ts`：provision、登入成功綁 event、錯 5 次原子鎖定、過期→invalid）；`db:verify` **15/15**。
- **實機 E2E（dev + 本機 Supabase）**：CLI 設 PIN → 錯 PIN 401 → 正確 PIN 200 set httpOnly cookie（`Max-Age=43200`、`SameSite=lax`）
  → `checkin-list` 綁 `2026-06-21`、回應 sensitive scan = 0（無 `pin_hash`/penalty/...）→ 未登入 401 → 連錯 5 次第 5 次 423、
  鎖定中正確 PIN 仍 423、**既有 cookie session 鎖定期間仍 200**（驗證鎖定不撤銷已登入）。

---

## 6.11 Phase 3 v2 — weekly_events finalize（結束整週，本次完成）

「結束當週點名」(§6.9) 原本只把 reservation 結算為 `no_show`、**不關閉 event**（`weekly_events.status` 停在 `open`）。
本刀讓 settle 成功後**把 session 綁的 event 標 `finalized`**，且 finalized event **擋掉所有 Staff 寫入**，讓「結束當週」成為真正終態。
薄包裝、**不重新設計 Phase 2 settlement**；`weekly_event_status` enum 已含 `finalized`（`0001`）→ **無 migration、無 schema 變更**（`db:verify` 仍 15/15）。

- **Repository**：`finalizeWeeklyEvent(eventId)` —— status-guarded 單句 `update weekly_events set status='finalized' where id=? and status<>'finalized'`（冪等）。
- **守則 `server/http/staffEventGuard.ts`（新）**：`requireWritableEvent(repo, eventId)` —— `getWeeklyEvent` 若 `finalized` 回 **409 `event_finalized`**，否則 null。
  套用於三個寫入路由（`checkin`/`walkins`/`settle`）；**讀取路由（`checkin-list`/`/staff/print`）不套用**。
- **settle route**：先 `requireWritableEvent`（已 finalized → 409，不重複 settle）→ `settle()` → **`finalizeWeeklyEvent`（獨立 try）**。
  **settle 與 finalize 非同一 transaction**：settle 成功但 finalize 失敗時回 `{ ok:true, ..., finalized:false }`，因 `settle()` 冪等故**可重按重試**。
  DTO 嚴格 Staff-safe：`{ ok, settled, releasedNow, finalized }`，**不含** `penaltiesApplied`/`alertsCreated`/penalty/牧養/敏感欄位。
- **UI（`StaffCheckIn.tsx`）**：`finalized = event?.status==='finalized'` → 橫幅「本週點名已結束，僅供檢視」+ 停用 check-in/walk-in/結束本週三鈕；
  settle 成功（`finalized:true`）即 `setEvent(status:'finalized')` 即時轉唯讀；`finalized:false` → toast「結束本週失敗，請重新整理後再試」（可重試）；
  **任何寫入收到 409 `event_finalized` → `applyFinalized409` 即時轉唯讀**（check-in rollback 該列、walk-in 關表單）；submitSettle 仍先 `commitPending()` flush。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint`/`next build` ✅。測試：`npm test`（不接 DB）**272 / 25 skipped**（settle/checkin/walkins route 測試新增 finalized 409 + finalize-after/finalize-fail 分流）；
  `RUN_DB_TESTS=1` **297 passed**（新增 `tests/integration/event-finalize.db.test.ts`：settle 不 finalize / `finalizeWeeklyEvent` 關週 + 冪等 + finalized 仍可讀）；`db:verify` **15/15**。
- **實機 E2E**：seed `released_late` → settle 回 `{ settled:1, releasedNow:0, finalized:true }`（sensitive scan 0）→ DB `status=finalized`
  → `checkin`/`walkins`/`settle` 皆 **409 `event_finalized`**、`checkin-list` + `/staff/print` 仍 **200**。

---

## 6.12 Phase 3 v2 — Auto-finalize fallback（內部 job，本次完成）

若同工忘記按「結束當週點名」，該週 `weekly_events.status` 會一直停在 `open`：`getActiveEvent()`（`.neq('status','finalized')`）
把舊週誤當進行中，且該週 released_late 一直沒結算為 no_show（違規/牧養不觸發）。本刀補上**營運層 fallback**：
job-secret 守護的內部 job，掃出「過寬限期仍 `open` 的過去週」，逐筆呼叫既有 `settle()` 再 `finalizeWeeklyEvent()`。
**定位為兜底、非同工主流程**（手動結束仍是正常路徑）。薄包裝、**不重新設計 Phase 2**；**無 migration、無 schema 變更**（`db:verify` 仍 15/15）。

- **Repository**：`getStaleOpenEvents(cutoff)` —— `status='open' AND sunday_date < cutoff ORDER BY sunday_date ASC`（cutoff 為排他日界）。
- **Service `server/services/autoFinalizeService.ts`（新）**：
  - `resolveGraceDays(input?)` —— **嚴格驗證**（不用 `Number(x)||default`）：顯式傳入須整數 ≥ 1 否則 throw；否則讀 env `AUTO_FINALIZE_GRACE_DAYS`（僅整數 ≥ 1 採用），再退回預設 **2**。
  - `taipeiBusinessCutoff(now, graceDays)` —— cutoff = **Asia/Taipei 營運日** − graceDays 的 `YYYY-MM-DD`（純函式；用台北日曆日而非 UTC 午夜，避免 cron 在台灣清晨跑時晚一天）。
  - `autoFinalizeStaleEvents({ now?, graceDays? }, repo?)` —— 逐筆 **settle 先、finalize 後**，**per-event try/catch 隔離**（一筆失敗不中止其餘；`settle` 冪等 + status-guarded finalize → 整批可安全重跑）。回 `{ scanned, finalized, failed, results[] }`。
- **Route `app/api/internal/jobs/auto-finalize/route.ts`（新，薄包裝）**：`jobSecretValid('x-job-secret')` → 選填 body `{ graceDays }`（非整數/<1 → **400**）→ service → `{ ok:true, ...summary }`；掃描本身 throw → 500，**per-event 失敗不 500**（在 `results[].error` + `failed`，cron 不因單筆 hard-fail）。
- **回應面 operation-safe**：`results[]` = `{ eventId, sunday_date, releasedNow, settled, finalized, error? }`；**絕不含** `penaltiesApplied`/`alertsCreated`/牧養/會友/車輛/`phone_number`/`line_id`/`p2_reason`（需 penalty 細節走既有 `jobs/settle`）。
- **CLI**：`npm run job:auto-finalize`（`scripts/run-auto-finalize.ts`，mirror `run-settle.ts`；選填 `--grace-days` / 測試用 `--now`；`--grace-days` 非法 → exit 1）。`.env.example` 加 `AUTO_FINALIZE_GRACE_DAYS=2`。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint`/`next build` ✅。測試：`npm test`（不接 DB）**291 / 27 skipped**；`RUN_DB_TESTS=1` **318 passed**（新增 `tests/integration/auto-finalize-fallback.db.test.ts`：`2099-05-17`/`2099-05-24` 各用不同會友/車輛、控制組 `2099-06-07` 不被掃、冪等重跑）；`db:verify` **15/15**。
- **實機 E2E**：無/錯 secret → **401**；`graceDays:0` → **400**；帶 secret → `{ ok:true, scanned:1, finalized:1, failed:0, results:[{ releasedNow:1, settled:1, finalized:true }] }`（sensitive scan 0）→ DB `status=finalized`；再打 → `scanned:0`（冪等）；CLI 亦印同結構、`--grace-days 1.5` → exit 1。

---

## 6.13 Phase 4 Slice A — LINE notification dispatcher（本次完成）

`notification_outbox`（`0003`）長期只被寫入（分配核准/候補、offer 確認/自動核准、釋出廣播、P2 到場提醒），**從未實際送出** ——
列永遠停在 `pending`。本刀補上 Phase 4 的**送出基礎**：把 due 的 outbox 列送到 LINE。所有後續 Phase 4 功能（主打的**移車請求**）都依賴這條送出路徑。
**移車動作本身 ops-blocked**（OA 加入率 / 文案定稿 / per-user `line_id` 綁定）故不在本刀；本刀只做 dispatcher。對應 [v2-backlog.md](v2-backlog.md) §2 Phase 4。
沿用既有節奏：**thin route（`/api/internal/*`，job-secret）→ service → repository → 原子 plpgsql RPC（多步 claim）／單句 status-guarded 寫入（終態轉移）**。
（註：Slice 4 settlement **刻意不寫 outbox**；牧養/會友通知另行 deferred。）

### 為什麼要原子 claim（而非 read→send→guard）
read → 外部 LINE push → status-guarded update 的流程**在並發 dispatcher 下會重送**：兩個 worker 都把列讀為 `pending`、都在任一 update 落地前呼叫 LINE。
修法：**原子 claim/lease** —— 送出**前**先把列翻成 `processing` 並蓋上 lock，使互斥決策**先於**外部呼叫。`FOR UPDATE SKIP LOCKED` 讓第二個並發 claim 跳過 in-flight 列、
（commit 後）看到 `processing` 而不再 claim。LINE 的 `X-Line-Retry-Key`（由 `dedupe_key` 決定性推導）為 lease 過期罕見重送的第二道防線（at-least-once；lease ≫ 傳輸逾時）。

- **Migration `0011_notification_status_processing.sql`**：`alter type notification_status add value 'processing'`（新增 enum 值不可與使用同一交易，故獨立一檔）。
- **Migration `0012_notification_dispatch_lease.sql`**：`notification_outbox` 加 `locked_at` / `locked_by` / `last_error`（**僅存 sanitized 分類碼**，絕不存 raw LINE body / 文案 / `line_id`）；
  加 stale-lease 掃描 index `(locked_at) where status='processing'`；**RPC `claim_notification_outbox(p_worker, p_now, p_limit, p_lease_seconds)`** ——
  `WITH due(... FOR UPDATE SKIP LOCKED LIMIT n)` 原子把 due（pending/retrying 過 `next_retry_at`，**或** `processing` 但 lease 過期＝owner 疑似死亡）翻成 `processing`＋蓋 lock，
  `returning` **join `users.line_id`**（省一趟 round-trip）。`revoke ... from public` + `grant execute ... to service_role`（`0004` 的 blanket grant 為 point-in-time）。
- **政策常數（`lib/allocation/rules.ts`）**：`NOTIFICATION_MAX_RETRIES=5`、`NOTIFICATION_RETRY_BACKOFF_MINUTES=[1,5,15,60,240]`（第 N 次退避取 index `min(N,len-1)`）、
  `NOTIFICATION_DISPATCH_BATCH=100`、`NOTIFICATION_LEASE_SECONDS=120`（遠大於單次 push 逾時）。
- **Transport `server/services/notification/lineTransport.ts`（新）**：
  - **顯式模式 `NOTIFICATION_TRANSPORT`（`'mock'|'line'`）、無靜默 fallback**。`getLineTransport()`：`mock`→ no-op 成功（dev/CI）；`line`→ 真 LINE Messaging API，
    **缺 token 即 throw `TransportConfigError`（fail-fast）**；unset/未知值也 throw。**杜絕 production 靜默假送**。
  - **型別化失敗分類**：network / 429 / 5xx → `TransportRetryableError`（→ `retrying`）；400 / 403 → `TransportTerminalError`（→ `failed`、不重試）；
    401 / 缺 config → `TransportConfigError`（→ **中止批次、不動任何已 claim 列**）。送 `X-Line-Retry-Key`＝`deriveRetryKey(dedupe_key)`（SHA-256→v4 UUID 形，決定性，避免超過 provider 長度限制）。
- **Templates `server/services/notification/templates.ts`（新）**：`renderTemplate(key, payload)` 只讀列上已存的 `payload_json`（不回查會友/違規/牧養表）；
  涵蓋目前實際入列的 6 個 key，教會語氣；未知 key → throw（→ 該列 `failed:render_error`，不炸整批）。
- **Service `server/services/notificationDispatchService.ts`（新）** `dispatchNotifications({now?,limit?,worker?}, repo?, transport?)`：
  1. **先解析 transport**（config error → 中止、**不 claim/不異動**）→ 2. `claimOutbox` 取 leased 批 → 3. **逐列 try/catch 隔離**（仿 autoFinalizeService）：
  無 `line_id`→`failed:no_line_id`（計 `skippedNoLineId`）；render/terminal→`failed`；retryable→ 達 MAX 則 `failed` 否則 `retrying`（backoff、`retry_count+1`）；
  success→`sent`。**唯 `TransportConfigError` 由 loop 拋出中止批次，且被中斷的已 claim 列保持 `processing`（不標 failed、不標 sent）**，lease 過期後重 claim 補送。
  所有終態寫入帶 `worker` 且 guard `status='processing' AND locked_by=worker`（防 lease 過期後被前 owner 誤終結）。回 counts-only `{ scanned, sent, retried, failed, skippedNoLineId }`。
- **Route `app/api/internal/jobs/dispatch-notifications/route.ts`（新，薄包裝）**：job-secret → 選填 body `{ limit }`（非整數/<1→400）→ service → `{ ok:true, ...summary }`；
  config/批次 throw→500，逐列失敗在 counts（非 500）。**operation-safe：counts only，絕不含 `line_id`/文案/penalty/牧養**。
- **CLI**：`npm run job:dispatch`（`scripts/run-dispatch-notifications.ts`，選填 `--limit`/`--now`）。`.env.example` 加 `NOTIFICATION_TRANSPORT=mock` + `LINE_CHANNEL_ACCESS_TOKEN=`（`line` 需 token 否則 fail-fast）。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint`/`next build` ✅。測試：`npm test`（不接 DB）**324 / 27 skipped**（新增 templates 7 / lineTransport 15 / dispatch service 11 / dispatch route 6）；
  `RUN_DB_TESTS=1` **357 passed**（新增 `tests/integration/notification-dispatch.db.test.ts` 6：deliverable→sent / no-line_id→failed(sanitized) / retryable→retrying+未來 `next_retry_at`→重跑補送 /
  **並發兩 dispatcher 一 due 列＝恰一次 push** / stale-lease 重 claim / **config-after-claim 保持 processing 再由 lease 重送**）；`db:verify` **17/17**（新增 16 lease 欄+processing、17 claim RPC grant）。
- **實機 E2E（dev + 本機 Supabase）**：CLI（mock）`{scanned:1,sent:1}`＋DB 列 `sent`；`NOTIFICATION_TRANSPORT=line` 無 token → CLI exit 1 / HTTP **500**、列仍 `pending` 無 lock；
  HTTP 無 secret **401** / `limit:0` **400** / 正常 **200 counts-only**（無 `line_id`/文案）。
- **仍 deferred（下一 slice）**：移車請求模板 + `POST /api/staff/move-car` + Staff 列動作 + OA 加入狀態 gating（ops-blocked）；真實排程綁定（Vercel Cron）+ `dryRun` 預覽 + `failed` dead-letter view；per-user LINE 綁定流程 / LIFF / webhook。

---

## 6.14 Phase 4 Slice B — Staff「請車主移車」(move-car request)（本次完成）

Phase 4 的**主打功能**：現場同工在地下室按一下，就能請**某台車的車主**來移車 —— 透過教會 LINE OA 代發，**不暴露任何人的電話/個人 LINE**。
車主收到推播；同工看不到聯絡資訊。疊在 §6.13 dispatcher 之上：route **只 enqueue**，dispatcher 負責送出。
以 Slice A 的 **mock transport** 完整 E2E；**go-live 前置（真實 OA token / 文案定稿 / per-member `line_id` 綁定）為 ops 軌，不擋開發**（本刀用 [oa-onboarding-and-move-car-copy.md](oa-onboarding-and-move-car-copy.md) §二 版本 A 草稿為暫定文案）。

### 隱私縫（核心）
`staff_checkin_view`（`0004`）**刻意不曝 `user_id`/`line_id`**（只有 name/plate/`is_priority`/status/attended_at）。因此：
- **UI** 要能逐列知道車主是否可通知，**又不能看到 `line_id`** → view 加 Staff-safe 布林 **`owner_notifiable`**（同 `is_priority` 手法：只曝「可否推播」的布林，不曝事實本身）。
- **Server** 自行從底表解析車主（`user_id`→ enqueue 目標；車牌 → 訊息）；這些**都不回傳給 client**。route 回應只有旗標，**絕不含 `line_id`/`user_id`/車牌/文案**。
- walk-in 無 `user_id` → 天生不可通知；會友須有 `line_id` 才可通知。

- **Migration `0013_staff_view_owner_notifiable.sql`**：`create or replace view staff_checkin_view … , (u.line_id is not null) as owner_notifiable`（新欄附在最後，replace 合法且保留 grant）。
  `verify_schema.sql` 加斷言 18：view **有** `owner_notifiable`、**無** `line_id`/`phone_number`。**無 outbox schema 變更**；`move_car_request` 只是新 `template_key` 字串（非 enum）。
- **Types**：`StaffCheckInRow`/client `StaffRow` 加 `owner_notifiable: boolean`；`NotificationTemplate` 加 `'move_car_request'`。`staffCache` `SCHEMA_VERSION` 1→2（列形變 → 舊快取視為過期）。
- **Template `move_car_request`**（`templates.ts`）：版本 A 暫定文案，只讀 `payload.license_plate`。
- **Repository `getMoveCarTarget(reservationId)`**：**一次查詢** join `reservations→users→vehicles`（**LEFT JOIN + `coalesce(v.license_plate, r.walk_in_license_plate)`**，故 walk-in 仍解析為 `not_notifiable` 而非 `not_found`），投影 `(u.line_id is not null) as notifiable`。**raw `line_id` 不離開 repo**。回傳 `{ weekly_event_id, user_id, status, license_plate, notifiable }`。walk-in insert 的 Staff-safe 映射 `owner_notifiable=false`。
- **Service `moveCarService.requestMoveCar`**：`getMoveCarTarget` → wrong_event guard → **actionable-status gate（僅 `STAFF_CHECKIN_STATUSES`；`pending`/`waiting`/`cancelled_*`/`no_show` → `not_notifiable`、不 enqueue）** → 無 `user_id`（walk-in）/ 不 notifiable → `not_notifiable` → 否則 `enqueueOutbox` 一列 `move_car_request`。
  **dedupe_key = `move_car:{rid}:{分鐘 ISO}`**：同一分鐘連點合併為一列，**兩次都回 `{ queued:true }`（dedupe 收合＝冪等成功，非失敗）**；隔分鐘再送則新列。
- **Route `POST /api/staff/move-car`**（薄包裝，鏡射 checkin route）：`getStaffSession` → `requireWritableEvent`（finalized → 409）→ body `{ reservationId }`（缺 → 400）→ `requestMoveCar`。
  `queued` → 200 `{ ok:true, queued:true }`；`not_notifiable` → **422**；`wrong_event` → 409；`not_found` → 404；else 500。**Staff-safe DTO：只有旗標。**
- **UI（`StaffCheckIn.tsx`）**：每列加精簡「請移車」次動作（≥44px），`!owner_notifiable`（walk-in/未綁定）或 finalized 時 **disabled** 並標「此車主未綁定 LINE，無法通知」；點擊 → 二次確認 sheet（「透過教會 LINE 通知 {車牌} 的車主移車？」）+ **離線守則** + **送出前 `commitPending()` flush 未送出的點名（失敗則中止）**。
  文案（enqueue-only，不暗示即時送達）：`queued`→「已建立移車通知，系統將透過 LINE 發送」；422→「此車主未綁定 LINE，無法通知」；409 finalized → `applyFinalized409` 轉唯讀。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint`/`next build` ✅（`/api/staff/move-car` ƒ dynamic）。測試：`npm test` **341 / 33 skipped**（templates +2 / moveCarService 7 / moveCarRoute 9 + 修 owner_notifiable fixtures）；
  `RUN_DB_TESTS=1` **378 passed**（新增 `move-car.db.test.ts` 4：`owner_notifiable` 投影 / 會友 enqueue→dispatch sent / walk-in not_notifiable / 無 line_id 會友 not_notifiable，皆用自建 user 避免 reservation 衝突）；`db:verify` **18/18**。
- **實機 cookie/PIN HTTP E2E**：未登入 **401** → PIN 登入 **200** → walk-in **422** → 會友 **200 `{queued:true}`**（回應無 `line_id`/`user_id`/車牌）→ DB `move_car_request` 列正確 → 同分鐘再送 **200、仍 1 列**（冪等）→ `job:dispatch`（mock）**sent** → finalized event **409 `event_finalized`**。
- **仍 deferred（go-live 前置，ops 軌）**：真實 OA channel token + 移車文案定稿 + per-member `line_id` 綁定流程；緊急/其他版本（B/C/D）；限定「車已在場」狀態（暫交同工判斷）。（dispatcher 排程綁定已於 §6.15 提供，正式掛載仍待部署。）

---

## 6.15 Phase 4 Slice C — Dispatcher ops hardening（本次完成）

讓 §6.13 dispatcher **可正式營運、供移車近即時送達**：排程綁定、無異動預覽、outbox 健康度可視、production transport guard。
**純後端/ops**：不動 Staff UI、不做 LINE webhook / LIFF / Admin UI / 新移車版本。所有新回應 **operation-safe**（計數 / 通知型別名 / sanitized 錯誤碼 / 時間戳；絕不含 `line_id`/`user_id`/電話/車牌/訊息本文/違規/牧養）。
排程/預覽/健康度操作見 [dispatcher-ops.md](dispatcher-ops.md)。

- **排程綁定（雙軌）**：`app/api/internal/jobs/dispatch-notifications/route.ts` 加 **GET** handler（Vercel Cron 與多數外部排程用 GET）、與既有 POST 共用 `handle()`；兩者以
  **`cronOrJobSecretValid`（`server/http/jobAuth.ts`）** 驗證 —— 接受 `x-job-secret==JOB_TRIGGER_SECRET` **或** `Authorization: Bearer==CRON_SECRET`（Vercel Cron 自動帶）。
  **fail-closed**：secret 未設/空字串一律不符；`Authorization` 僅認 `Bearer <token>` scheme。**不 commit `*/2` 的 `vercel.json`**（Hobby 部署會失敗）→ 改附 `vercel.pro.example.json` + runbook；route 兩種 auth 皆支援，之後啟用只是設定。
- **`dryRun` 無異動預覽**：`previewDispatch()`（`notificationDispatchService.ts`，**獨立函式，不解析 transport、不 claim、不寫**）讀 `outbox_health` 回 `{ dryRun, due, dueByTemplate, staleProcessing, batchLimit }`。`dispatchNotifications` **完全未動**（Slice A 測試全綠）。CLI `--dry-run`、route `?dryRun=1` / `{dryRun:true}`。
- **健康度可視**：**Migration `0014_outbox_health_rpc.sql`** —— read-only `outbox_health(p_now, p_lease_seconds) returns jsonb`，**僅顯式聚合表達式**（`count`/`min`/`jsonb_object_agg` over grouped counts，絕不 select 原始列欄位）：
  `due` / `due_by_template` / `pending` / `retrying` / `processing` / `stale_processing` / `failed` / `failed_by_error`（sanitized code→count）/ `sent_last_24h` / `oldest_*`/`next_retry_at`。grant execute → service_role。`verify_schema` 斷言 19。
  經 `getOutboxHealth`（`outboxHealthService.ts` / repo `getOutboxHealth`）暴露於 **`GET /api/internal/jobs/outbox-status`** 與 **CLI `npm run job:outbox-status`**。
- **Production transport guard**：`lineTransport.getLineTransport()` 於 production runtime（`VERCEL_ENV==='production'`，否則 `NODE_ENV`）**拒 `mock`** → `TransportConfigError('mock_in_production')`，避免正式部署靜默丟訊息（`line` 缺 token 仍 throw）。僅作用於真送出路徑，preview/health 不受影響。
- **並發安全（釐清）**：重疊呼叫安全來自 **我們的 `processing` lease + `locked_by` guard（Slice A 原子 `FOR UPDATE SKIP LOCKED` claim）**，**非** Vercel 保證不重疊 —— runbook 明載，並保留 Slice A「兩 dispatcher 一列恰一次 push」測試。
- **CLI/env/config**：`scripts/run-outbox-status.ts` + `npm run job:outbox-status`；`run-dispatch-notifications.ts` 加 `--dry-run`；`.env.example` 加 `CRON_SECRET`；新 `vercel.pro.example.json`。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint`/`next build` ✅（dispatch route GET+POST、`outbox-status` ƒ dynamic）。測試：`npm test` **365 / 37 skipped**；`RUN_DB_TESTS=1` **405**（新增 `outbox-health.db.test.ts` 3：健康度聚合正確 / 輸出 leak-scan / previewDispatch 零異動）；`db:verify` **19/19**。
- **實機 E2E**：`?dryRun=1`（x-job-secret）→ 預覽、列仍 `pending`；`Bearer $CRON_SECRET` → 200；無/錯 secret → 401；真跑 GET → `sent`；`/outbox-status` → 健康度（sensitive scan 0）；`VERCEL_ENV=production`+`mock` → **500 `mock_in_production`**、列未異動、dryRun 仍 200。
- **仍 deferred**：正式排程掛載（Vercel Pro cron 或外部排程實際綁定 + 監控告警）；`closed` 狀態語意；健康度告警門檻自動化。

---

## 6.16 Phase 4 Slice D — 釋出時通知被釋出成員本人（本次完成）

補上 §6.13 dispatcher 之上的一個通知缺口：主日釋出 sweep（`runRelease` → `apply_release`）把逾時未報到的 `approved` 轉 `released_late` 時，原本只對**候補者**廣播 `broadcast_release`，**失去車位的車主本人卻沒有任何訊息**。本刀補一則資訊性通知給該車主。**純後端/producer**：不動 Staff/Admin UI、不做 webhook/LIFF、不動 dispatcher/排程。

- **新模板 `reservation_released`**（`lib/types.ts` union + `templates.ts` RENDERER）：只讀 payload 的 `released_at`（釋出當下時間，**非**原報到期限），以 `taipeiTime()` 格式化為 `已於 {time} 釋出`；**不承諾現場一定有位**、**無罰責/責備字眼**。暫定文案（教會定稿前）：「您本週保留的車位已於 {time} 釋出。若仍需停車，請前往地下室現場洽詢停車同工，將依現場狀況協助，謝謝您。」
- **Producer**：純函式 `releaseExpired`（`lib/allocation/release.ts`）對每筆本 sweep 釋出的列額外產一則 owner-notice entry（與既有 broadcast 併於 `outbox`，以 `template_key` 區分）；`runRelease`（`releaseService.ts`）將其對映為 **一次性 dedupe key `released_owner:${reservation_id}`**（無時間桶 → 每筆預約至多一則、重跑 `ON CONFLICT DO NOTHING` 冪等），並回 `ownerNoticesEnqueued`。
- **原子入列**：migration **`0015_release_owner_notice.sql`** 加 **4-arg `apply_release(uuid,timestamptz,jsonb,jsonb)`**，第 4 參數 `p_owner_notices`；保留舊 **3-arg 簽章為相容 wrapper**（以空陣列委派，**非破壞性 RPC 變更**）。owner notice **僅由本 sweep 的 `released` CTE**（回 `id,user_id`）產生，join 再驗證 `reservation_id=released.id` **且** `user_id=released.user_id` **且** `template_key='reservation_released'`，並以 released 列自身的 id/user 為權威收件人 → **TS 錯不會把通知寄錯人**。gated on `released>0`、`ON CONFLICT DO NOTHING`。`verify_schema` 斷言 **20**。
- **結算 pre-sweep 靜默（範圍界定）**：§6.14 結算（Slice 4）會先補跑一次 release sweep，其釋出的列隨即被結算為 `no_show`——該牧養路徑刻意不發任何通知（見決策 8）。故 `runRelease` 加 `notifyReleasedOwners`（預設 `true`），結算 `settle()` 以 `notifyReleasedOwners:false` 呼叫 → **被結算者不會收到釋出通知**；正常近即時 sweep 仍會發。
- **Repository**：`applyRelease(eventId, nowIso, broadcast, ownerNotices)` 呼叫 4-arg RPC，回傳型別加 `owner_notices_enqueued`。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint`/`next build` ✅。測試：`npm test` **370 / 40 skipped**；`RUN_DB_TESTS=1` **414**（新增 `release-owner-notice.db.test.ts`：一次性 dedupe、只對本 sweep 釋出者、payload 只含 `released_at` 的 leak-scan）；`db:verify` **20/20**。
- **實機 E2E**（本機 Supabase、mock transport）：釋出 → outbox 同時有 `released_owner:<id>` 與 `broadcast_release`；render 出資訊性文案（`已於 10:46 釋出`）；mock dispatch 兩則皆 `sent`；重跑釋出 **0 重複**；結算 pre-sweep 對被釋出者靜默。
- **仍 deferred**：`reservation_released`/`move_car_request` 文案教會定稿；per-member `line_id` 綁定；取消確認通知（member 自行取消，另刀）；`no_show`/牧養通知（刻意延後）。

---

## 7. 關鍵設計決策（跨切片）

1. **商業邏輯留 TypeScript，SQL 只做原子套用。** supabase-js 無法跨呼叫開 transaction，故多表原子操作一律走 plpgsql RPC；單句 status-guarded 寫入（如 `setOnTheWay`、`markJobFailed`、reminder outbox upsert）則直接用 supabase-js。
2. **三層冪等：** status-guarded UPDATE（`WHERE status=...`）+ outbox `ON CONFLICT (dedupe_key) DO NOTHING` + 服務端重試。重跑掃描套用 0 列、發 0 則通知、不重複累加違規、不重複開 alert。
3. **掃描型 cron 不寫 `job_runs`。** `job_runs` 的「一週一次成功短路」只給週五批次；release/expire/auto-approve/reminder/settle 為可重複掃描，不用它。
4. **釋出/違規/牧養一律以 `effective_priority` 判定，不用 `p2_eligible`。** DB 無 `p1_eligible` 欄位（P1 由 `weekly_staff_allocations` 表達）；當週未宣告同行的 P2 資格者本週以 P3 處理，符合 development_plan §7。
5. **「正在路上」採有界 grace（10:55），且不可回溯延長**已過的 deadline。
6. **廣播/提醒以「活資料」再驗證**，而非 service 讀取當下的快照：release 廣播 join `status='waiting'`、reminder 排除 `p2_on_the_way=true`，關閉 read-apply 競態縫。
7. **結算前先補跑一次 release sweep**（Slice 4）：避免排程遺漏／延遲導致仍 `approved` 但已逾時的列漏結算。
8. **牧養 flag 用獨立 sensitive 表 `pastoral_care_alerts`、每人至多一筆 open**；Slice 4 只建立 alert 列、**不發任何通知**（成員與 Admin 皆不通知）。
9. **路由暫以 job-secret 守護的 `/api/internal/*`。** 成員/Staff 認證與 LINE webhook 尚未實作，對外的成員 API 待後續切片。
10. **整合測試需序列化（`fileParallelism: false`）。** 多個 `*.db.test.ts` 共用同一本機 DB、重用固定週日與 seed 成員，不可平行；每個整合檔用獨立週日（Slice 3 `2099-02-01`、Slice 4 `2099-03-01`/`2099-03-08`）。

---

## 8. 測試結果

| 指令 | 結果 |
|------|------|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx eslint .` | ✅ exit 0 |
| `npm test`（不接 DB） | ✅ **370 passed / 40 skipped**（本回合實跑；`*.db.test.ts` 被 gate 跳過） |
| `npm run db:reset` | ✅ 套用 `0001–0015` + seed |
| `npm run db:verify` | ✅ **20/20** schema 斷言 PASS |
| `RUN_DB_TESTS=1 npm test`（接本機 Supabase） | ✅ **414 passed** |

> 上表全為 **Phase 4 Slice D（釋出時通知被釋出成員本人）本回合實測**（含 `db:reset 0001–0015`、`db:verify` 20/20、`RUN_DB_TESTS=1` 414）。下方 Slice 4 專屬涵蓋為當時紀錄。

**測試檔：** 純函式 `tests/unit/allocation/*`（含 `scenario.test.ts` 全週情境）；服務 `tests/unit/server/*`（mock repo）；
整合 `tests/integration/{friday-allocation,cancellation-substitution,release-attendance,settlement,walk-in,staff-pin,event-finalize,auto-finalize-fallback,notification-dispatch,move-car,outbox-health,release-owner-notice}.db.test.ts`（gated by `RUN_DB_TESTS=1`，各用獨立週日）。

**Slice 4 整合測試涵蓋：** 結算前 release sweep 補抓 approved-逾時列、`released_late → no_show`、P3 `penalty_score+1`、
P2 `consecutive_no_show→4` 開 alert、**結算不寫 outbox**、冪等重跑（settled 0、不重複加分/開 alert）、**跨 event 的 open-alert
去重**（同一 user 已有 open alert 時再次 no-show → 不新增）。

**手動實機路由驗證（Slice 4）通過：** `/jobs/settle` 無 secret → 401；帶 secret →
`releasedNow:1, settled:3, penaltiesApplied:3, alertsCreated:1`；M1(P2) consecutive 3→4 且分數凍結、M3(P3) 1→2、
M5(P3，被 sweep 補抓) 0→1；`pastoral_care_alerts` 一筆 open（`trigger_count=4`）；event outbox 0；重跑冪等
（settled:0、alertsCreated:0、分數與 alert 不變）。

---

## 9. 已知 Deferred Items（尚未實作）

> v2 優先序與會議定案見 [v2-backlog.md](v2-backlog.md)（2026-06-29 同工會議）：
> **walk-in（§6.6）、穩定度（§6.7）、紙本備援清單（§6.8）、結束當週點名（§6.9）、真 PIN session（§6.10）、weekly_events finalize（§6.11）、Auto-finalize fallback（§6.12）皆已完成 → Phase 3 結案。**
> **下一階段：Phase 4 — Notification & LINE Integration** —— LINE notification dispatcher（outbox 已寫入、尚無實際送出）+「移車通知」新模板 + OA 串接（卡點＝會友 OA 加入率）/ Member·Admin UI。
> 定案：⭐ 保留、**不在畫面加個資**，聯絡需求改走教會 LINE OA 代發。

| 項目 | 預定時機 | 備註 |
|------|----------|------|
| ~~真 Staff PIN session（`staff_sessions` 雜湊 / 失敗鎖定 / 過期 / 綁 event）~~ | ✅ **完成（v2，§6.10）** | scrypt PIN + 5 次鎖 15 分 + 12h TTL + cookie session id + event 綁定（取代 getActiveEvent stub） |
| Staff PIN 管理 UI / 真 per-device session（單裝置撤銷）/ PIN 輪替 | 後續 | §6.10 為 per-event 共用憑證 + per-device cookie marker；PIN 目前由 CLI `staff:set-pin` 供給（`--pin` 可能殘留 shell history） |
| ~~Staff walk-in 現場登記~~ | ✅ **完成（v2 P1，§6.6）** | — |
| ~~Staff 結束當週點名（settle）route + UI~~ | ✅ **完成（v2，§6.9）** | `/api/staff/settle` 回嚴格 Staff-safe DTO `{ ok, settled, releasedNow }`（不暴露 penalty/牧養）；UI 二次確認 sheet |
| ~~`weekly_events` 事件 finalize（結束整週）~~ | ✅ **完成（v2，§6.11）** | settle 後標 `finalized`、擋 Staff 寫入（app-layer guard）；DTO 加 `finalized` 旗標 |
| `weekly_events` finalize 的 **DB 層強制**（trigger）/ `finalized_at` 稽核欄 / 解除 finalize（重開週） | 後續 | §6.11 為 app-layer guard（防誤點，非防繞過）；DB 層 trigger 防 service_role 直寫為 defense-in-depth |
| ~~Auto-finalize fallback（忘記結束時自動 settle + finalize）~~ | ✅ **完成（v2，§6.12）** | 內部 job（job-secret）+ CLI；掃過寬限期仍 `open` 的過去週，per-event 隔離、冪等；**營運兜底、非同工主流程** |
| Auto-finalize 的真實排程器綁定（cron / Vercel Cron）/ `dryRun` 預覽 / `closed` 狀態語意 | 後續 | §6.12 提供 route + CLI，實際排程掛載與只掃不寫預覽延後；本刀只掃 `'open'` |
| Staff 截止時間/倒數、`p2_on_the_way` 顯示 | 後續 | Slice 1 刻意不顯示（沿用 view 9 欄、最貼近隱私投影） |
| ~~Staff 誤點復原 + 離線只讀快取~~ | ✅ **完成（v2 P2，§6.7）** | undo 視窗（送出前可取消）+ localStorage 只讀快取 |
| ~~Staff 紙本備援清單（列印）~~ | ✅ **完成（v2 Stability Slice B，§6.8）** | `/staff/print` 可列印當週清單紙本（同 Staff-safe 欄位）；補足「只讀快取」涵蓋不到的硬離線 |
| Staff service worker / 冷啟動離線（PWA） | 後續（P2.5） | 真正離線冷啟需 SW；紙本備援（§6.8）為現階段務實 fallback |
| 成員 / Admin 對外 API + UI（P2-first rollout） | 後續切片 | 第一版優先 P2 流程；P1 UI / P3 申請 / P3 penalty admin 以 feature flag / deferred 預留 |
| ~~LINE notification dispatcher（outbox → LINE 實際送出）~~ | ✅ **完成（Phase 4 Slice A，§6.13）** | 原子 claim/lease 防並發重送 + 顯式 `NOTIFICATION_TRANSPORT` 模式（缺 token fail-fast、不靜默假送）+ 型別化失敗分類 + backoff 重試；`job:dispatch` CLI / 內部 route |
| ~~移車請求模板 + `POST /api/staff/move-car` + Staff 列動作 + OA 加入狀態 gating~~ | ✅ **完成（Phase 4 Slice B，§6.14）** | `owner_notifiable` Staff-safe 投影 + 伺服器端車主解析（不洩 `line_id`/`user_id`）；enqueue → dispatcher 送出；列上「請移車」disabled/labeled |
| **通知 go-live 前置**：真實 OA channel token + 移車/釋出文案定稿 + per-member `line_id` 綁定流程 | **ops 軌** | §6.14/§6.16 已用 mock transport 全綠；上線需真實憑證與綁定；`move_car_request`/`reservation_released` 文案與緊急/其他版本（B/C/D）另備 |
| ~~dispatcher 排程綁定 + `dryRun` 預覽 + outbox 健康度可視 + production transport guard~~ | ✅ **完成（Phase 4 Slice C，§6.15）** | GET+cron/job auth、`?dryRun=1`/`--dry-run`、`outbox_health` RPC + `/outbox-status` + `job:outbox-status`、`mock_in_production` guard；runbook [dispatcher-ops.md](dispatcher-ops.md) |
| dispatcher **正式排程掛載**（Vercel Pro cron 或外部排程實際綁定）+ 監控告警 / `failed` dead-letter 處理 / per-user LINE 綁定流程 / LIFF / LINE webhook（含「正在路上」回覆入口） | 後續 | §6.15 提供 route + CLI + runbook；實際部署掛載仍待 go-live；移車目前靠 `job:dispatch` 手動排空 |
| **牧養關懷 alert 處理（resolution）UI** | Admin 切片 | `pastoral_care_alerts` 已可開立；`resolved_at/resolved_by/note` 欄位已就緒但暫不寫入 |
| 其餘兩種 §7 牧養觸發（短期行動不便到期 / 幼兒資格到期）每日排程 | 後續 | 目前僅實作「連續未到」觸發 |
| **P1 全職同工 `weekly_staff_allocations` no-show 處理** | 後續 | 與 reservation 結算分離；Slice 4 只結算 reservation（P2/P3） |
| Realtime | 後續 | — |
| ~~釋出時對「被釋出成員本人」的個別通知~~ | ✅ **完成（Phase 4 Slice D，§6.16）** | `reservation_released` 一則資訊性通知（一次性 `released_owner:<id>` dedupe）；`0015` 4-arg `apply_release` + 3-arg wrapper；**結算 pre-sweep 靜默**（`notifyReleasedOwners:false`）；候補廣播不變 |
| 中途容量變更的重新驗證 | 後續 | 遞補假設「一筆 approved 取消＝釋出一個位、遞補一個」 |

---

## 10. 本機開發備忘（重點，詳見 development_plan §12）

- 啟動/重置/驗證：`npm run db:start` / `db:reset`（套用 `0001–0014` + seed）/ `db:verify` / `db:stop`。
- 工作 script：`job:friday` / `job:expire-offers` / `job:release` / `job:settle` / `job:auto-finalize` / **`job:dispatch`**（notification dispatcher；皆 `tsx scripts/run-*.ts`）。`job:dispatch` 吃選填 `--limit` / `--now`，需 `NOTIFICATION_TRANSPORT=mock|line`。
- `.env.local`：`SUPABASE_SERVICE_ROLE_KEY` 用 `npx supabase status` 的 **`sb_secret_...`**（非舊版 JWT）；`SUPABASE_URL=http://127.0.0.1:54321`；`JOB_TRIGGER_SECRET`（route 的 `x-job-secret`）；**`NOTIFICATION_TRANSPORT`（`mock`|`line`）** + **`LINE_CHANNEL_ACCESS_TOKEN`（`line` 模式必填，否則 dispatcher fail-fast）**。這些密鑰**僅後端使用，絕不可暴露到瀏覽器**；`lib/supabase/server.ts` 不得被 client 端 import。
- 本機 Supabase default privileges 只給 API 角色 `Dxtm`，故 migration 對 `service_role` 明確 `grant select/insert/update/delete`；新增表/視圖記得一併授權。
- 整合測試需先 `db:reset` 且設 `RUN_DB_TESTS=1` 才會執行；否則 gate 跳過。
- 目前本機 Supabase stack 已停止（`npm run db:stop`）；下次開發前先 `db:start && db:reset`。
