# 教會主日停車管理系統 — 開發交接文件（Current Handoff）

> 最後更新：2026-07-04 ｜ **Phase 3 已結案；Phase 4 進行中（Slice A + B + C + D + E + F 完成）** ｜ 範圍：Phase 0、Phase 1、Phase 2 Slice 1–4、Phase 3 Slice 1 + v2 全部切片（walk-in / 穩定度 / 紙本備援 / 結束當週點名 / 真 PIN session / weekly_events finalize / auto-finalize fallback）+ **Phase 4 Slice A — LINE notification dispatcher** + **Phase 4 Slice B — Staff「請車主移車」** + **Phase 4 Slice C — dispatcher ops hardening（排程綁定 + dryRun 預覽 + outbox 健康度可視 + production transport guard）** + **Phase 4 Slice D — 釋出時通知被釋出成員本人（`reservation_released`）** + **Phase 4 Slice E — 取消確認通知（`reservation_cancelled`）** + **Phase 4 Slice F — dispatcher autonomy（健康度告警 + dead-letter requeue + 外部排程 runbook）** 全數完成
>
> **本階段：Phase 4 — Notification & LINE Integration**。**Slice A（dispatcher）+ B（移車請求）+ C（ops hardening）+ D（釋出通知本人）+ E（取消確認）+ F（告警/requeue）已完成**（見 §6.13 / §6.14 / §6.15 / §6.16 / §6.17 / §6.18）。**下一步（go-live 前置，ops 軌）：真實 OA channel token + 移車/釋出/取消文案定稿 + per-member `line_id` 綁定流程；正式排程由外部排程器掛載（cron-job.org / crontab，見 [dispatcher-ops.md](dispatcher-ops.md)；不 commit live scheduler artifact）。** 見 [v2-backlog.md](v2-backlog.md) §2 與 §9 Deferred。
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
| **Phase 4 Slice E** | **取消確認通知**：會友取消預約時，除既有「遞補 offer 給下一位候補」外，另發一則 `reservation_cancelled` 給**取消者本人**（一次性 `cancel_notice:<id>` dedupe；`cancelled_late`/`cancelled_by_user` 兩種措辭、無罰責、指回報名系統）；migration `0016` 8-arg `apply_cancellation`（+ 7-arg 相容 wrapper），confirmation 僅由本次 `cancelled` CTE 產生、三重再驗證，且 `cancel_status` **由 RPC 轉態後狀態權威決定**（非 TS payload）；**限會友自行取消**，未來 admin/staff 取消需另立模板 | ✅ 完成 |
| **Phase 4 Slice F** | **Dispatcher autonomy**：健康度**告警**（`GET /outbox-alert` + `job:outbox-alert`，健康=200／不健康=503 讓外部 monitor 無整合即可告警；門檻 env，pilot 預設 `0/0/15`；backlog 訊號用新的 `outbox_health.oldest_due_at` 只看 due 列）+ **dead-letter requeue**（`POST /requeue-failed` + `job:requeue-failed`，**dryRun 預設**、僅 `failed→pending`、預設 max 50/硬上限 500、可選 sanitized `errorCode`、**手動限定不排程**）；migration `0017`（`outbox_health` 加 `oldest_due_at` + `requeue_failed_outbox` RPC）；排程走**外部排程器（cron-job.org / crontab）文件化，不 commit live artifact** | ✅ 完成 |

**主日完整生命週期（分配 → 取消/遞補 → 釋出/出席 → 結算）已全部落地，並補上 Staff 現場頁
（點名/補點名/walk-in 登記/誤點復原/離線只讀/紙本備援清單/結束當週點名/真 PIN session/結束整週 finalize/auto-finalize fallback）。
Phase 3（Staff 現場頁 + v2 全部切片）至此結案。** 下一階段為 **Phase 4 — Notification & LINE Integration**
（LINE notification dispatcher + 移車通知、Member/Admin UI），見 [v2-backlog.md](v2-backlog.md) 與 §9 Deferred。

**目前測試狀態（Phase 4 Slice F 本回合實跑）：** `tsc --noEmit` ✅、`eslint` ✅、`next build` ✅（新 `/api/internal/jobs/outbox-alert`、`/api/internal/jobs/requeue-failed` ƒ dynamic）、
`npm test`（不接 DB）**399 passed / 47 skipped**（+ `evaluateOutboxAlert`/thresholds、alert route 200/503、`requeueFailed` dryRun/bounds/filter、requeue route dryRun 預設/400）、
`RUN_DB_TESTS=1 npm test`（接本機 Supabase）**451 passed**（新增 `outbox-requeue.db.test.ts`：`oldest_due_at` 只看 due、requeue 只 `failed→pending` 且不動其他四狀態、errorCode/max、重跑 0、leak-scan）、`npm run db:verify` **22/22 PASS**（新增斷言 22：`requeue_failed_outbox` + service_role execute）。
Slice F 已完成**實機 E2E**（route handler + mock transport）：無 secret → **401**；2 筆 failed → `GET /outbox-alert` **503** `breaches:['failed_over_max']`；`requeue-failed` dryRun `wouldRequeue:2`（不異動）→ apply（`errorCode:http_500`）`requeued:2`；`dispatch` **sent 2**；再查 `/outbox-alert` → **200 healthy**。
排程/告警/requeue/rollback runbook 見 [dispatcher-ops.md](dispatcher-ops.md)。**排程為外部排程器文件化，不 commit live artifact；requeue 手動限定不排程。**
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
- **仍 deferred**：`reservation_released`/`move_car_request` 文案教會定稿；per-member `line_id` 綁定；`no_show`/牧養通知（刻意延後）。（取消確認通知已於 §6.17 Slice E 完成。）

---

## 6.17 Phase 4 Slice E — 取消確認通知（本次完成）

補上取消流程的通知缺口：會友取消預約時，`apply_cancellation`（migration 0006）**已通知遞補的下一位候補**（`offer_2hr_confirm`/`reservation_approved`），但**取消者本人卻收不到任何確認**。本刀補一則確認給取消者。**純後端/producer**：不動 member/Staff/Admin UI、不做 webhook/LIFF、不動 dispatcher/排程，既有遞補 offer 通知不變。

- **新模板 `reservation_cancelled`**（`lib/types.ts` union + `templates.ts` RENDERER）：只讀 `cancel_status` 分兩種措辭 —— `cancelled_late`（放掉已核准車位）「…已核准的停車預約已為您取消，車位將釋出給候補…」／`cancelled_by_user`（原 pending/waiting）「…停車申請／候補已為您取消…」；**任何非 `cancelled_late` 值（含缺漏）皆走中性 `cancelled_by_user` 措辭**（不誤導、不 throw）。**限會友自行取消**（renderer 註解明載）；未來 admin/staff 取消為不同 actor，需另立模板、勿沿用此措辭。無罰責、無個資、指回報名系統。
- **Producer**：`cancelReservation`（`cancellationService.ts`）在算出 `cancelStatus` 後建一則 confirmation `OutboxRow`（`user_id: r.user_id`、`reservation_id: r.id`、`template_key: 'reservation_cancelled'`、**payload `{}`——`cancel_status` 由 RPC 權威決定**），dedupe key **一次性 `cancel_notice:${reservationId}`**（一筆預約只取消一次 → 至多一則、重跑 `ON CONFLICT DO NOTHING`）；三條 `applyCancellation` 路徑（純取消／approved 無候補／approved 有遞補）皆帶入。已取消的冪等 no-op 路徑**不呼叫 RPC** → 不重發。offer-race retry（`apply_offer`）不需改：confirmation 已由首次 `applyCancellation` 的 `cancelled` CTE 入列。`CancelSummary` 加 `confirmationEnqueued`。
- **原子入列**：migration **`0016_cancel_confirm_notice.sql`** 加 **8-arg `apply_cancellation`**，第 8 參數 `p_cancel_notice`；保留舊 **7-arg 為相容 wrapper**（空陣列委派，非破壞性）。`cancelled` CTE 改 `returning id, user_id, status`；新 `ins_cancel` CTE **僅 join 本次 `cancelled` CTE**（非所有已取消列），三重再驗證 `id=reservation_id` **且** `user_id=user_id` **且** `template_key='reservation_cancelled'`，收件人與 **`payload_json = jsonb_build_object('cancel_status', cancelled.status)` 皆取自轉態後的列**（TS 錯無法寄錯人／渲染錯措辭；`cancelled.status` 天生只會是兩個白名單值）。既有 `sub`/`ins`（遞補）CTE 不變。`verify_schema` 斷言 **21**。
- **Repository**：`applyCancellation` args 加 `cancelNotice: OutboxRow[]` → `p_cancel_notice`；`CancellationResult` 加 `cancel_notice_enqueued`。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint`/`next build` ✅。測試：`npm test` **372 / 43 skipped**；`RUN_DB_TESTS=1` **419**（新增 `cancel-confirm-notice.db.test.ts`：canceller confirmation 只由本次 cancel 產生、兩種 `cancel_status`、一次性 dedupe、payload 只含 `cancel_status` 的 leak-scan）；`db:verify` **21/21**。
- **實機 E2E**（本機 Supabase、mock transport）：取消 approved → outbox 同時有 `offer_2hr_confirm`（候補）與 `cancel_notice:<id>`（`reservation_cancelled`，payload `cancel_status: cancelled_late` 由 RPC 決定）；render 出取消確認文案；mock dispatch 兩則皆 `sent`；重跑取消 **0 重複**。
- **仍 deferred**：`reservation_cancelled`/`reservation_released`/`move_car_request` 文案教會定稿；admin/staff 取消的另立措辭；per-member `line_id` 綁定；`no_show`/牧養通知（刻意延後）。

---

## 6.18 Phase 4 Slice F — Dispatcher autonomy：健康度告警 + dead-letter requeue（本次完成）

讓通知管線能**無人值守營運**：Slice A–E 管線可用，但（1）無 live 排程（只手動 `job:dispatch`），（2）`outbox_health`（§6.15）只暴露數據、無人**據以告警**，（3）`failed` 列為終態、無回收手段。本刀補齊告警 + 回收 + runbook，**不新增外部相依、不 commit live 排程 artifact**。**純後端/ops**，所有新回應 operation-safe（counts / 狀態名 / sanitized 碼 / 門檻名 / 時間戳）。

- **`outbox_health` 加 `oldest_due_at`**（migration `0017`）：現有 `oldest_pending_at` 無法區分「到期未送」與「刻意排未來」→ 誤報。新 `oldest_due_at = min(created_at) over is_due` 只看 due 列（`is_due` 已要求 `next_retry_at <= now`），backlog 告警據此，未來排程列不會誤觸。
- **健康度告警（scheduler-surfaced）**：純函式 `evaluateOutboxAlert(health, thresholds)`（`outboxAlertService.ts`）→ operation-safe reason codes（`failed_over_max` / `stale_processing_over_max` / `due_backlog_stale`）。route **`GET /api/internal/jobs/outbox-alert`** 把結果**編進 HTTP 狀態：健康 200 / 不健康 503**，讓任何 monitor/cron（`curl -f`、uptime 檢查）**零整合**即可告警；CLI `job:outbox-alert` 不健康時 exit 非 0。門檻 env（`OUTBOX_ALERT_FAILED_MAX`/`STALE_MAX`/`PENDING_STALE_MINUTES`），**pilot 敏感預設 `0/0/15`**（任一 failed 或 stale 即告警；due backlog >15 分＝排程未在排空），可調高。
- **Dead-letter requeue（手動限定）**：migration `0017` RPC `requeue_failed_outbox(p_now,p_max,p_error_code)`——**只 `failed→pending`**（WHERE 守；絕不動 sent/processing/pending/retrying），reset `retry_count/next_retry_at/locked_*/last_error`，`FOR UPDATE SKIP LOCKED`，**無 DELETE/無破壞性清理**。service `requeueFailed`（`requeueFailedService.ts`）**dryRun 預設 true**（dryRun 用 `failed_by_error` 算 `wouldRequeue`、零讀寫；只有顯式 `dryRun:false` 才動）、**max 預設 50 / 硬上限 500 / 正整數驗證**、空白 `errorCode`→null（只比對 sanitized 碼）。route **`POST /api/internal/jobs/requeue-failed`**（POST-only、dryRun 預設）、CLI `job:requeue-failed`（`--apply`/`--max`/`--error`，預設 dry run）。**必須手動、不排程**（dispatch/outbox-alert 可排程）。
- **排程機制（決策）**：**外部排程器 only、文件化**（cron-job.org / crontab，見 runbook；`https://<host>` placeholder、無真 URL/secret）——**不 commit `vercel.json`/GitHub workflow**。App 為 scheduler-ready，實際掛載由使用者設 secret + 部署後啟用。
- **Rollback**：停送＝停用外部 cron；疑似壞送迴圈＝切 `NOTIFICATION_TRANSPORT=mock`（注意 prod `mock_in_production` guard，需搭配暫停排程或非 prod 環境）；修好後用 `requeue-failed`（先 dry run 再 `--apply`）。
- **OA 環境**：本刀**不接教會正式 OA**；測試用 `mock`，手動驗證用自備 test OA（env 於 repo 外）。正式 OA 為 **final pilot/production** 步驟，前置：真 token、文案定稿、`line_id` 就緒、rollback 就緒。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint`/`next build` ✅（`outbox-alert`/`requeue-failed` ƒ dynamic）。測試：`npm test` **399 / 47 skipped**；`RUN_DB_TESTS=1` **451**（新增 `outbox-requeue.db.test.ts`）；`db:verify` **22/22**。
- **實機 E2E**（route handler + mock）：無 secret→401；2 failed → `/outbox-alert` **503** `['failed_over_max']`；`requeue-failed` dryRun `wouldRequeue:2`（不異動）→ apply（`errorCode:http_500`）`requeued:2`；`dispatch` **sent 2**；再查 → **200 healthy**。
- **仍 deferred**：live 排程 artifact（vercel.json/GH workflow）；push-channel 告警（Slack/email/LINE-admin）；`requeue-failed` 排程化；接教會正式 OA；`line_id` 綁定 / webhook / LIFF；文案定稿。

---

## 6.19 Phase 5 Slice A — LINE webhook + pending binding capture（本次完成）

真正的 go-live 送達卡點是**沒有東西寫 `users.line_id`**——dispatcher 對每列標 `no_line_id`、即使有真 token 也送不到人。而 LINE `userId` **只能**由 webhook/LIFF 事件取得（OA 後台看不到 userId）。本刀跨過先前每刀刻意守住的 no-webhook 邊界，用**最薄**方式補上「擷取」端：會友加了 OA 後傳 `綁定 <code>` / `bind <code>`，webhook 記一筆 **pending 綁定申領**。**本刀不寫 `users.line_id`**（由下一刀 5B 審核 pending → 寫入，遵守 `users_line_id_key`）。規劃見 [go-live-readiness.md](go-live-readiness.md)。

- **capture-only、零回覆**：webhook 只**驗簽 → 擷取 → 回 200**，**不 reply、不 push、不 broadcast**。推播是 `userId` 點對點，故本刀可安全指向教會正式 OA 做 dry-run 而不會外溢全體會友（見 go-live-readiness §2）。單次測試推播為**另一個手動 gated 腳本**，不與 webhook 耦合。
- **簽章驗證用 raw body**：`POST /api/line/webhook`（Node runtime、`nodejs`）先 `request.text()` 讀原始 bytes 再驗 `x-line-signature`（HMAC-SHA256 base64，`LINE_CHANNEL_SECRET`，`server/http/lineSignature.ts`，timing-safe、fail-closed）。**簽章無效 → 401 且不寫 DB**。驗簽後即使 payload 畸形/不支援也**回 200 不 throw**（LINE 對非 2xx 會重送）。
- **最小解析（tightened）**：只認 `綁定 <code>` / `bind <code>` / `BIND <code>`；code 正規化（trim + uppercase）後須符 `^[A-Z0-9-]{4,16}$`。不符 → 回 200 但**不建列**（counts-only `ignored`）。**follow 事件只計數不建申領**。**不儲存任意聊天文字**（`pendingBindingService.ts` 純函式 `parseBindCode` 可單測）。
- **一 LINE 帳號一筆 active pending**（migration `0018`）：partial unique `pending_binding_active_uq (line_user_id) where status='pending'`；同一 userId 重送 → RPC `capture_pending_binding` 以 `ON CONFLICT ... where status='pending'` **原地 upsert**（新 code 勝、`superseded_count++`、更新 `last_submitted_at`/`last_event_type`），`xmax<>0` 區分 insert/update 供計數——**不灌爆表**。RPC 回傳 counts-only（`captured`/`superseded`），**永不回/記 userId 或 code**。表 RLS deny-all + service_role 顯式 grant（0004 blanket grant 為當時一次性，本表在其後建立）。
- **隱私**：`line_user_id`/`submitted_code` 存在本表（這正是目的），但**不得**流入 log / error / `notification_outbox.last_error`。
- **送出鎖 posture**：新增 `LINE_CHANNEL_SECRET`（驗 inbound webhook，與授權 outbound 的 `LINE_CHANNEL_ACCESS_TOKEN` 不同）＋ `LINE_SEND_ENABLED=false`（本刀無讀者，文件化 go-live 安全鎖 + 未來單次測試推播閘門）。正式預約通知仍由 `NOTIFICATION_TRANSPORT` 掌控、**維持關閉**。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint`/`next build` ✅（`/api/line/webhook` ƒ dynamic、Node runtime）。測試：`npm test` **414 / 57 skipped**（新增 `pendingBindingService.test.ts` + `lineSignature.test.ts`）；`RUN_DB_TESTS=1` **471**（新增 `pending-binding.db.test.ts`，走真 route handler → 本機 Supabase）；`db:verify` **23/23**（新增 assertion #23）。
- **實機 E2E**（route handler + 本機 DB）：正確簽章 `bind abc-123` → 200 `captured:1`、pending 列 `ABC-123`/`superseded_count:0`；同 userId 重送 `綁定 xyz789` → `superseded:1`、仍一列 `XYZ789`/`superseded_count:1`；壞簽章 → **401 不建列**；`請問怎麼停車？` → 200 `ignored:1` 不建列；`users.line_id` 全程未寫。
- **仍 deferred**：**5B**（admin/script 審核 pending → 寫 `users.line_id`，遵守 partial unique）；LIFF；webhook 自動回覆/「正在路上」入口；單次測試推播腳本；接教會正式 OA + 真 token + 文案定稿。

---

## 6.20 Phase 5B Slice 1 — binding 審核 RPC（schema + approve/reject，本次完成）

5A 只擷取 `pending_binding{line_user_id, submitted_code}`，但**沒有東西說明某個 code 屬於哪位會友**。本刀補上身分對應 + 審核端：新增 `binding_codes`（一次性 code 於線下發給**已知會友** → `user_id`）與原子的 approve/reject RPC，把 pending 申領升級成 `users.line_id`。**DB/RPC only — 無 CLI、無 UI、無送出**（CLI 為 Slice 2）。身分＝雙因子：持有 code 證明會友（`binding_codes.user_id`）、5A webhook 擷取證明 LINE 帳號（`pending_binding.line_user_id`）。**審核為人工把關**（在 Slice 2 CLI 層以 `--apply`）；本刀 RPC 提供顯式 dry-run 讓 CLI 預覽 typed 結果而不寫入。

- **migration `0019`**：`binding_codes`（`code` unique + `^[A-Z0-9-]{4,16}$` check、`user_id`→users、`expires_at`、`consumed_at`/`consumed_pending_binding_id`/`consumed_line_user_id` 稽核、`created_by`/`note` optional）；`pending_binding` 加稽核欄 `approved_at`/`approved_user_id`/`rejected_at`/`rejected_reason`。RLS deny-all + 顯式 service_role grant（本表在 0004 blanket grant 之後建立）。
- **`approve_pending_binding(p_pending_id, p_now, p_dry_run)`**：**BY pending id**，內部讀 pending 列取 `line_user_id`/`submitted_code`（**raw 值不經 API 表面**）。固定優先序 typed reason（不 throw 500）：`pending_not_found → pending_not_pending → code_not_found → code_expired → code_consumed → member_already_bound → line_id_taken → approved`。`dry_run=true` 全跑守則回 `would_approve` **不寫**；`dry_run=false` 寫 `users.line_id`（守 `line_id is null`）+ consume code + 標 pending approved。並發同 `line_user_id` 綁到他人 → `users_line_id_key` unique violation **接住轉 `line_id_taken`**，非 500。`code_user_mismatch` 於現行「一 code 一會友」設計**不可達，故省略**。
- **`reject_pending_binding(p_pending_id, p_reason, p_now)`**：標 `rejected` + `rejected_at`/`rejected_reason`；typed `{rejected, reason}`。
- **repo wrappers** `approvePendingBinding`/`rejectPendingBinding`（DB 測試用）。回傳 counts + typed reason only，**不含** `line_user_id`/code。
- **仍守**：無 CLI/UI/LIFF/webhook 回覆/送出；`NOTIFICATION_TRANSPORT` 不動；不接教會正式 OA。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint` ✅。測試：`npm test` **414 / 68 skipped**；`RUN_DB_TESTS=1` **482**（新增 `binding-approval.db.test.ts` 11 例）；`db:verify` **24/24**（新增 assertion #24）。
- **實機 E2E**（RPC + 本機 DB）：happy apply 寫 `line_id`＋consume code＋pending approved；dry-run 不寫；`code_expired`/`code_consumed`/`code_not_found`/`pending_not_found`/`pending_not_pending`/`member_already_bound`/`line_id_taken`/reject 全數 typed；結果無 `line_user_id`/code 外洩。
- **下一刀（Slice 2）**：CLI `binding:issue`（預設隨機 code、印一次）/`binding:approve`（dry-run→`--apply`、masked 預覽）/`binding:reject` + CLI 測試 + operator 文件。

---

## 6.21 Phase 5B Slice 2 — binding CLI（issue/approve/reject，本次完成）

把 Slice 1 的 RPC 包成 operator CLI，讓同工「發碼 → 人工核准」。**無新 schema**（騎在 `0019`）、無 UI/LIFF/webhook 回覆/送出。

- **`lib/binding.ts`（純函式，單測）**：`generateBindingCode()` 隨機 `XXXX-XXXX`（**不含易混淆 `0/O/1/I/L`**，符 `^[A-Z0-9-]{4,16}$`）；`normalizeBindingCode`（trim+upper）；`maskLineUserId`（`left6…right4`，短值退化為 `first2****`，**永不回完整值**）；`maskCode`（`ABCD-****`）。
- **`bindingAdminService.ts`**：`issueBindingCode`（產碼或驗自訂碼、`expires_at=now+ttl`、唯一碰撞重試、回**完整 code** 供 CLI 印一次 + 會友姓名）；`previewApproveBinding`（**server 端遮罩**後回 masked 欄位＋以 RPC dry-run 取得 predicted reason，**不寫**）；`applyApproveBinding`（RPC `dry_run=false`）；`rejectBinding`（trim + 非空）。raw `line_user_id`/code **不離開 service**（唯一例外＝issue 的一次性 code 回傳）。
- **repo**：`insertBindingCode`（唯一碰撞回 `inserted:false` 供重試，其餘 throw）、`getBindingApprovalPreview`（pending + code→user + display_name 的 raw 讀，供 service 遮罩）、`getUserDisplayName`。
- **CLI**（`scripts/run-binding-*.ts` + `package.json`）：`binding:issue`（**code 只印一次** + shell-history 警語）／`binding:approve`（**預設 dry-run**，`--apply` 才寫，輸出遮罩）／`binding:reject`（`--reason` 稽核，警告勿放 id/code）。
- **operator 文件** [binding-ops.md](binding-ops.md)（端到端流程、typed reason 表、隱私規則、一次性印碼與 shell-history 警語）；go-live-readiness 交叉連結。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint` ✅。測試：`npm test` **432 / 71 skipped**（新增 `lib/binding.test.ts` + `bindingAdminService.test.ts`，含**無 raw `line_user_id`/完整 code 外洩**斷言）；`RUN_DB_TESTS=1` **503**（新增 `binding-cli.db.test.ts`：issue→preview 遮罩不寫→apply 寫入/consume/approved→idempotent→reject→自訂碼碰撞）；`db:verify` **24/24**（無 schema 變更）。
- **仍 deferred**：Admin/Member UI、LIFF、webhook 綁定成功回覆、rebind/unbind、bulk approve、**教會正式 OA capture dry-run**、真 OA token + `NOTIFICATION_TRANSPORT=line`。
- **5B 已在測試 OA 端到端 piloted PASS（2026-07-05）**：issue→`綁定`擷取→masked 預覽→`--apply` 寫 `line_id`→idempotent 擋重綁。

---

## 6.22 Phase 6 Slice 1 — 會友資料匯入（P2 申請表 CSV，本次完成）

**交付模式改變（教會決定 2026-07-06，見 [delivery-model-and-roadmap.md](delivery-model-and-roadmap.md)）**：全部開發完成再一次交付、先用開發者 OA demo、交付後才 bulk-import 會友資料並漸進綁定。member+admin UI 入 scope、church staff 操作、LIFF-first、Vercel+Supabase Cloud。本刀補 roadmap 第一項：**會友資料匯入的 CLI 資料基礎**（Admin UI 之後包裝）。**只匯入紀錄、`line_id` 不動。**

- **migration `0020`**：`dependent_kind` enum + `eligibility_dependents`（一 user 多 dependent，`(user,kind,name,coalesce(birthdate))` 去重）；`users_phone_key`（phone 為會友識別鍵，partial unique where not null）；`import_member(..., p_dry_run)` RPC——依 phone atomic upsert 會友 + 車輛 + `user_eligibility` summary + dependents，typed 非 throw（`imported`/`updated`/`phone_name_conflict`；車牌屬他人 → `plate_conflicts` 略過）。`user_eligibility` 維持 summary，dependents 表存證據。
- **`lib/memberImport.ts`（純函式，單測）**：`normalizePhone`、`parseFormDate`（`YYYY-MM-DD`/`YYYY/MM/DD`）、`computeEligibility`（reason→p2_reason；長期/長者=永久、短期/懷孕=申請日+6mo、孩童=最晚生日+5y、缺日期=review_required）、`collectDependents`、`validateRow`。
- **`memberImportService.ts`**：`csv-parse` 讀檔 → 逐列驗證（錯誤列報表排除）→ **依 phone 分組**（多列同手機=一人多車）→ 名字不一致=`phoneNameConflict` → 每人一次 `import_member` → 彙總報表（counts + `phoneNameConflicts`/`plateConflicts`/`reviewRequired`/`validationErrors`）。
- **CLI `members:import`**（`--file`，**預設 dry-run**、`--apply` 才寫、有衝突 exit 2）+ operator 文件 [member-import-ops.md](member-import-ops.md)。**PII：真檔放 `members-data/`（`.gitignore`）不 commit；合成 fixture 在 `tests/fixtures/`。**
- 依賴：新增 `csv-parse`。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint` ✅。測試：`npm test` **448 / 74 skipped**（新增 `lib/memberImport.test.ts`）；`RUN_DB_TESTS=1` **522**（新增 `member-import.db.test.ts`：合成 CSV 9 情境——mobility_long/short、elderly、多孩 child、pregnancy 拆分、多車同人、同手機同名冪等、同手機不同名衝突、車牌撞他人；dry-run 不寫、apply 寫入、idempotent）；`db:verify` **25/25**（新增 assertion #25）。fixture 手機避開 seed 佔用的 `0900…/0911…`（用 `0955…`）。
- **仍 deferred**：Admin UI 包裝匯入、P3/一般會友 CSV 路徑、Member UI（LIFF）、Big5 編碼處理。

---

## 6.23 Phase 7 Slice 1 — 會員 LIFF 登入 + 唯讀本週狀態頁（本次完成）

Phase 7（會員預約 UI，LIFF-first）第一刀：**第一個會友對外前端**。`/member` 頁——LIFF 取得 ID token → server 驗證 → 依 `users.line_id` 找會友 → 建 session → 顯示**本週自己那筆預約**的唯讀狀態卡。未綁定 → typed `not_bound` 占位畫面（**不自動綁**；Slice 2 換成申請表）。申請/取消/offer 確認為 Slice 3/4。規劃 + v2 審查採納紀錄見 plan（Phase 7 切片地圖）。

- **認證模式顯式化（比照 `NOTIFICATION_TRANSPORT`）**：`MEMBER_AUTH_MODE=liff|mock`——`mock` 收 `mockLineUserId`（本機開發/測試），production 用 mock → fail-fast `mock_in_production`；`liff` 缺 `LINE_LOGIN_CHANNEL_ID` → fail-fast。**env 命名區分**：`LINE_LOGIN_CHANNEL_ID`（LINE Login channel，verify API 的 `client_id`）/ `NEXT_PUBLIC_LIFF_ID`（LIFF app id，client `liff.init`）≠ 既有 Messaging API channel 的 `LINE_CHANNEL_SECRET`/`LINE_CHANNEL_ACCESS_TOKEN`。
- **ID token 驗證（`memberAuthService.verifyLiffIdToken`，fetch 可注入）**：POST LINE verify endpoint（LINE 端驗簽章/exp/aud）→ 200 且 `iss==='https://access.line.me'` 且 `sub` 非空 → ok；4xx/壞 body → `invalid_token`（401）；網路錯/5xx/**8s 逾時（`AbortSignal.timeout`，公開登入入口不可懸掛）** → `verify_unreachable`（503，UI 可重試）。**token 與 `sub` 不落 log、不回 client**（單測含外洩斷言）。
- **Session：hashed opaque token（migration `0021` `member_sessions`，含 `expires_at > created_at` check constraint 防「一建立就過期」的寫入）**：cookie 帶 raw 256-bit token（`base64url`），DB 只存 `token_hash=sha256`（`server/http/sessionToken.ts`）——DB 外洩不等於 session 可用（staffAuth 同型升級列 backlog）。RLS deny-all + service_role 顯式 grant。cookie：`httpOnly`、`SameSite=Lax`（LIFF 內 login fetch 為同源）、`secure`（prod）、`path=/`、TTL 30 天（`MEMBER_SESSION_TTL_DAYS`）。**多裝置並存**：login 帶有效 cookie → 冪等不增列（route 短路）；login 順手刪同會員過期列（lazy cleanup）；logout 只刪自己列。
- **「本週 event」resolver（台北時區）**：`taipeiToday`（`lib/taipeiDate.ts` 純函式）+ `getMemberEvent`＝`sunday_date >= 台北今天`的**最小**一筆——**不用** `getActiveEvent`（那是「最新非 finalized」的 Staff-PIN 語意，未來週先建好會指錯）。主日當天整天仍解析到當天 event；週一起指向下週。
- **Member-safe DTO**：page（server component）把 repo 列映射成 `MemberWeekStatus`（sundayDate + status/plate/deadline/offerExpires/p2OnTheWay）才交給 client——**不傳 DB row**、無 penalty、無他人資料；`getMemberWeekReservation` 只查自己 `(event,user)`，live 列優先於 cancelled 手足列。login/logout 回應 `Cache-Control: no-store`。
- **UI**：`app/member/page.tsx`（server gate，同 staff page 模式）+ `MemberLiffGate`（liff.init→getIDToken→POST login；**錯誤狀態分開**：`not_bound`/401 過期/503 可重試/一般錯誤；mock 模式渲染 dev 登入表單）+ `MemberStatus`（狀態中文標籤、車牌、台北時間期限、登出）。手機優先（48px 觸控目標）。config 錯誤（mode/channel/LIFF id 缺）→ 頁面渲染 operator 可診斷的占位畫面，不 crash。
- 依賴：新增 `@line/liff`。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint`/`next build` ✅（`/member`、`/api/member/login`、`/api/member/logout` ƒ dynamic）。測試：`npm test` **479 / 81 skipped**（新增 `memberAuthService.test.ts` 14 例（含 verify 逾時→`verify_unreachable`）、`memberLoginRoute.test.ts` 8 例（冪等短路/typed 狀態碼/config 500）、`taipeiDate.test.ts` 4 例）；`RUN_DB_TESTS=1` **560**（新增 `member-auth.db.test.ts` 7 例：DB 只存 sha256、30d 過期、not_bound 零列、lazy cleanup 只刪過期、logout 只刪自己列、resolver 選最近未來主日、只回自己的列 + live 優先）；`db:verify` **26/26**（新增 assertion #26，含 expiry check constraint）。
- **PR review 修正（merge 前採納）**：LINE verify 加 8s timeout + 單測；`member_sessions` 加 `expires_at > created_at` constraint + verify 斷言；`getMemberWeekReservation` comparator 改 `localeCompare`（相等值契約）。`expires_at` 全域 index 依審查建議**暫不加**——等未來有全域 session cleanup job 再加。
- **實機 E2E**（dev server + mock 模式 + 本機 Supabase）：login 200 + `no-store` + `HttpOnly; SameSite=lax; Max-Age=2592000` cookie；`/member` 渲染「7月12日 主日／已核准車位／ABC-1234／10:45 前抵達」；帶 cookie 重登入冪等不增列；未綁定 id → `{ok:false,reason:'not_bound'}`；logout 刪自己列 + 清 cookie → 回登入 gate。
- **仍 deferred**：Slice 2 LIFF 綁定申請（phone claim + server 重驗 ID token）、Slice 3 申請/取消、Slice 4 offer 確認/正在路上、**真機 LIFF 冒煙（Phase 7 結案前必跑**，需 LIFF app + tunnel，步驟見 [member-liff-setup.md](member-liff-setup.md)）、staffAuth hashed-token 升級。

---

## 6.24 Phase 7 Slice 2 — LIFF 綁定申請（phone claim，本次完成）

未綁定會友的自助綁定入口：`/member` 未綁定畫面 → **姓名＋手機申請表** → server 以已驗證 LINE 身分（**重送 ID token 重驗，絕不信任 client userId**）建立 `pending_binding`（`claim_source='liff'`）→ 管理員 `binding:pending` 發現 → `binding:approve` 依**手機比對**（`users_phone_key`）人工核准寫 `line_id`。**維持 no auto-bind**；`綁定 <code>` 關鍵字流保留為 fallback。計畫經外部審查一輪（3 必改全採納；approval 端保留 `member_already_bound` 名稱）；**PR 審查再修 2 項**：TOCTOU 版本欄位由 `last_submitted_at` 改為 **`superseded_count`**（caller 傳入 `p_now`，timestamp 可能碰撞；count 為每次 upsert 必增的單調 revision，timestamp 降為顯示/排序/稽核用）＋ route body 上限改以 **UTF-8 bytes** 計（`Buffer.byteLength`；`raw.length` 是 UTF-16 units，中文 payload 會低估 3 倍）。

- **無會員身分 oracle**：claim 端點對「手機是否命中會員」回應完全相同（`{ok:true}` counts-only）；比對只在核准時發生，外人無法用公開端點列舉會員。防濫用＝已驗證 LINE 身分 + 一帳號一 active claim（0018 partial unique 原地 upsert，灌不爆表）+ 端點硬化（`application/json` 限定 415、body ≤4KB 413、name raw≤200/trim 後 1–50 **code points**、phone raw≤30、idToken≤4096）；v1 不做 rate limit（backlog：pilot 見大量重送再加 cooldown）。
- **migration `0022`**：`pending_binding` 加 `claim_source('keyword'|'liff')`/`claimed_phone`/`claimed_name`（各有格式/長度 check）＋**嚴格 XOR shape constraint**（keyword 只有 code、liff 只有 phone+name；來源切換由兩支 capture RPC 整組覆蓋，DB 兜底）；`submitted_code` 放寬 nullable、`superseded_count`→bigint；**`users_phone_format_ck`**（`null or ^09[0-9]{8}$`）——把 import 正規化、claim 正規化、`users_phone_key`、核准 lookup 四方綁死在同一 canonical 手機表示（先前只靠 TS invariant）。新 RPC `capture_liff_binding_claim`（同 5A upsert 語意、counts-only）。
- **preview/apply TOCTOU 修補（keyword 流同享）**：`approve_pending_binding` 改 4 參數——`p_expected_superseded_count bigint`（apply 必填=管理員預覽到的 revision；dry-run 傳 null；0 為合法值）+ `for update` 列鎖；會友在預覽後重送（換手機/換 code）→ typed **`pending_changed`**、不寫入——**即使兩次 capture 的 `p_now` 相同也擋得住**（timestamp 版本會碰撞，count 不會）。守則優先序：`pending_not_found → pending_not_pending → pending_changed → [code×3 | phone_not_found] → member_already_bound → line_id_taken → approved`。CLI `--apply` 單次執行內「重讀 preview→顯示→帶版本 apply」，競態窗口壓到毫秒級；`pending_changed` → exit 2 提示重新預覽。
- **server**：`memberAuthService` 抽出 **`resolveVerifiedLineIdentity`**（mode 解析＋mock/liff 分流＋verify，只回 verified lineUserId——login 與 claim 共用，Slice 3/4 敏感操作可重用）；新 `memberBindingService.submitBindingClaim`（輸入硬化 → 身分驗證 → 已綁帳號 typed **`line_account_already_bound`** 不建列 → capture；PII 不落 log/error，單測含外洩斷言）。`bindingAdminService`：preview 加 `claimSource`/`claimVersion`/`claimedPhoneMasked`（新 `maskPhone` `0912***678`）/`claimedName`（完整供人工比對；**姓名不符不自動擋**）；新 `listPendingBindings`（FIFO by `last_submitted_at`、limit 夾 1–100、全遮罩、list 階段不查 matched 會員）。
- **route `POST /api/member/binding-claim`**（無需 session，申請者本來就未綁定）：`invalid_request`→400、`invalid_token`→401、`verify_unreachable`→503、`line_account_already_bound`→200 typed（≠ approval 端 `member_already_bound`）；全 `no-store`；不記錄 body/PII。
- **UI**：`BindingClaimForm`（姓名＋手機、client 即時格式提示、double-click 防重送）；**每次 submit 當下 `liff.getIDToken()` 重取**（不存 state，防久填過期）；成功畫面（重送=更新申請）；**`line_account_already_bound` → 自動重登入**（填表期間管理員剛好核准的情境）。
- **CLI**：新 `binding:pending`（規格見 [binding-ops.md](binding-ops.md)）；`binding:approve` 版本化。operator 文件全面改版（雙路徑、typed reason 表、PII retention backlog→Phase 8 必要項）。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint`/`next build` ✅（新 `/api/member/binding-claim` ƒ dynamic）。測試：`npm test` **510 / 92 skipped**（新增 memberBindingService 14、claim route 10（含 **CJK bytes-vs-chars 413**）、maskPhone 2、bindingAdminService liff preview/list/版本 6）；`RUN_DB_TESTS=1` **602**（新增 `member-binding.db.test.ts` 11 例：route→RPC 全鏈 shape、upsert、keyword↔liff 切換整組覆蓋、XOR/空白名/壞手機/users 非 canonical 直插全被 constraint 擋、liff 核准 happy（不動 binding_codes）、`phone_not_found`/`member_already_bound`/`line_id_taken`、**TOCTOU 兩向（liff 換手機、keyword 換碼）→ `pending_changed` 且不寫，且刻意用同一 `p_now` 證明 timestamp 碰撞下 revision 仍擋得住**、rejected 後可重新申請、already-bound 不建列、canonical phone 格式化輸入穩定命中、list FIFO 遮罩；`binding-approval.db.test.ts` approve helper 隨 4 參數簽名更新；`member-auth.db.test.ts` fixture 手機改純數字——被新 `users_phone_format_ck` 抓到，constraint 即刻見效）；`db:verify` **27/27**（#24 簽名更新 + 新 #27）。
- **實機 E2E**（dev server + mock 模式）：未綁定 id 申請 → `binding:pending` 遮罩列 → `binding:approve` 預覽/`--apply` → 同 id 重登入見狀態卡；`pending_changed` 路徑實測（預覽後重送 → apply exit 2）。
- **仍 deferred**：Slice 3 申請/取消、Slice 4 offer 確認/正在路上、真機 LIFF 冒煙（checklist 已含綁定申請流）、PII retention 清理 job（Phase 8 必要 acceptance item）、rebind/unbind。

---

## 6.25 Phase 7 Slice 3 — 會員預約申請 + 自助取消（本次完成）

會員端第一個「寫」動作。至今 reservation 只由 seed / walk-in / 分配流程產生；本刀補上 `/member` 的**登記本週停車**（車輛選擇＋長幼同行宣告）與**取消登記**（二段確認）。**會員不送任何 event id / reservation id**——「本週」由 server 以台北時區解析、「自己那筆」由 session 使用者解析，**無 IDOR 面**。

- **development_plan §4 規則首次程式化（`lib/allocation/priority.ts`）**：`computeApplyPriority`——自動 P2（`mobility_long`/`mobility_short`/`pregnancy`）免宣告；同行 P2（`elderly_companion`/`child_companion`）需當週 `requested_p2_this_week`；**`p2_valid_until` 早於該週主日 → 退 P3**（效期規則）；P1 不走公開申請（role `full_time_staff` → typed `staff_use_p1`，車位由 `weekly_staff_allocations` 管理）。`canDeclareCompanion` 供 UI 決定是否顯示宣告 checkbox。優先序**於申請當下凍結**到列上（沿用既有分配語意）。
- **migration `0023` `apply_reservation` RPC**（商業邏輯在 TS、RPC 只管交易性守則，typed 不 throw）：`event_not_open → applications_closed → vehicle_not_owned → already_applied → applied`。**申請窗口**＝週五分配 job 認領該週前（`job_runs('friday_allocation')` in `running`/`success` 即關閉——分配讀完 pending 快照後才插入的列會永遠卡 pending；failed run 會重跑故不關窗）。晚到者走主日 walk-in（候補尾端加入列 v2 backlog）。一人一筆活躍預約由既有 partial unique 當權威守則（unique_violation → typed `already_applied`）；**取消後可重新登記**（index 排除 cancelled 列）。
- **關窗/認領鎖協議（PR review 修補）**：單靠 job_runs 檢查擋不住**並發**認領（READ COMMITTED 看不見未 commit 的 `running` 列，且分配的 pending 快照在 TS 層、RPC 之前讀——鎖在 `apply_friday_allocation` 裡也來不及）。修法：新 RPC **`claim_friday_allocation`**——鎖 `weekly_events` 列 → 標 `running` → **commit 後**分配才讀快照；`apply_reservation` 開頭鎖**同一列**。兩邊序列化後：apply 先 commit → 列必在快照內；claim 先 commit → 之後的 apply 必見 `running` → `applications_closed`。`runFridayAllocation` 改 claim-first，認領後全段包 try/catch（拋錯 → `markJobFailed`，避免孤兒 `running` 永久關窗）。並發整合測試（`pg` 雙連線、真交錯）：兩向都驗「持鎖方 block 對方 → commit 後對方走到正確結果」；不變量＝不存在「認領後才插入的 pending 孤兒列」。
- **`memberReservationService`**：apply——resolver 取本週 → role 檢查 → server 端讀 `user_eligibility` 算優先序（**敏感資料不出 server**，DTO 只帶衍生的 companion hint）→ RPC。cancel——找自己的 live 列：`pending`/`waiting` → `cancelled_by_user`、`approved` → `cancelled_late`（走**既有** `cancellationService` 全鏈：釋出＋遞補 offer＋取消確認通知，全部前刀已就緒）；`temp_approved` → typed `offer_in_progress`（offer 歸 Slice 4）；已取消/無列 → `nothing_to_cancel`；已到場/已釋出 → `cannot_cancel`。
- **routes**：`POST /api/member/reservation/apply`（body 只有 `vehicleId`+`requestedP2`）/`POST /api/member/reservation/cancel`（**無 body**）。member session 守門、業務狀態 200 typed、`no-store`。
- **UI（`MemberStatus`）**：狀態卡下方依情境渲染——登記表單（車輛下拉、同行 checkbox 僅在 companion 資格有效時出現）／已截止卡（「請至現場洽同工」）／全職同工提示／無車輛提示（請同工登記車牌）；取消為**兩段式確認**（approved 加「車位將釋出」警語）；已取消卡＋重新登記表單並列。
- repo 增量：`getMemberVehicles`/`getMemberEligibility`/`getUserRole`/`hasFridayAllocationRun`/`applyReservation`；`MemberWeekReservationRow` 加 `id`（server-only，DTO 不帶）。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint`/`next build` ✅（新 `/api/member/reservation/apply`、`/cancel` ƒ dynamic）。測試：`npm test` **540 / 103 skipped**（新增 `applyPriority.test.ts` 12（§4 全表＋效期邊界）、`memberReservationService.test.ts` 12、routes 4、allocation claim-first 順序/短路 2）；`RUN_DB_TESTS=1` **643**（新增 `member-reservation.db.test.ts` 9 例：P3/自動 P2/宣告±/過期效期各自的凍結優先序、duplicate/他人車輛/staff 擋、**分配 running+success 關窗、failed 重開**、closed event、取消→重取消 no-op→重新登記、approved 取消走真 RPC 轉 `cancelled_late`、temp_approved 擋；**`member-apply-race.db.test.ts` 2 例（`pg` 雙連線真並發）**：apply 持鎖 → claim 阻擋 → commit 後快照含該列＋後續 apply 關窗；claim 持鎖 → apply 阻擋 → commit 後 apply 得 `applications_closed` 且零新列）；`db:verify` **28/28**（assertion #28 含 claim RPC）。依賴：devDependency 新增 `pg`（並發測試用原生連線）。
- **實機 E2E**（dev server + mock 模式）：見驗證紀錄。
- **仍 deferred**：Slice 4 offer 確認/放棄＋正在路上（狀態卡按鈕）、候補尾端加入（v2）、真機 LIFF 冒煙（Phase 7 結案前）。

---

## 6.26 Phase 7 Slice 4 — 遞補確認/放棄 + 正在路上（本次完成，Phase 7 開發面收尾）

Phase 7 最後一刀：主日前後的即時互動。狀態卡依情境長出按鈕——`temp_approved` → **確認保留車位／放棄**（放棄二段確認：車位轉給下一位候補）；approved P2 主日 10:45 前 → **「我正在路上（保留至 10:55）」**。皆包**既有服務**（`offerService.resolveOffer`／`onTheWayService.markOnTheWay`——遞補鏈、approval 通知、10:55 grace、status-guarded 權威守則全部前刀已就緒），模式同 Slice 3 cancel：server 解析自己那筆、**無 body id、無 IDOR 面**、typed 結果。**無 schema 變更**。

- **`memberReservationService` 增量**：`resolveOfferForWeek`——status ≠ `temp_approved` → `no_active_offer`；**會員端補 `offer_expires_at` 預檢**（內部 offer 路由不看效期屬 ops 語意；會員逾 2 小時窗按下 → typed `offer_expired` 不寫，回 waiting 由 expiry sweep 負責）；`resolved=false`（與 sweep/auto-approve 競態）→ `no_active_offer`。`reportOnTheWay`——非 approved 先擋，其餘（P2/未到場/未逾期）交給 `markOnTheWay` 的 TS 預檢＋DB status-guarded UPDATE 權威判定；`updated=false` → `not_eligible`（含 10:46 補按不回溯延長）。
- **routes**：`POST /api/member/reservation/offer`（body 僅 `{action:'confirm'|'decline'}`，非法 action 400）／`POST /api/member/reservation/on-the-way`（無 body）。session 守門、typed 200、`no-store`。
- **DTO affordance 旗標（server 端算）**：`canRespondOffer`（live temp_approved 且未逾期）／`canReportOnTheWay`（approved＋P2＋未到場＋未回報＋deadline 未過）——`MemberWeekReservationRow` 補 `effective_priority`/`attended_at`（**server-only，不進 DTO**）。UI：確認一鍵（取得車位）、放棄二段（不可逆）、正在路上一鍵；`temp_approved` 文案改「請於 {時間} 前回覆」。
- 對照：`substitute_offer`／`reservation_approved` 通知模板既有；會員按「確認」後 `reservation_approved` 照常入 outbox 由 dispatcher 送出。

### 驗證（本回合實跑）
- 靜態：`tsc`/`eslint`/`next build` ✅（新 `/api/member/reservation/offer`、`/on-the-way` ƒ dynamic）。測試：`npm test` **550 / 103 skipped**（新增 service 8：confirm/decline happy、expired 預檢不觸服務、無 offer、raced、on-the-way 資格表；routes 3：401×4、action 驗證、typed passthrough）；`RUN_DB_TESTS=1` **659**（新增 `member-offer.db.test.ts` 6 例：confirm → approved＋P3 deadline 02:30Z＋`reservation_approved` outbox（dedupe `confirmed:<id>`）、decline → waiting＋`offer_status=declined`＋**下一位候補實際被 re-offer**、expired typed 不寫、pending → `no_active_offer`、on-the-way → `p2_on_the_way`＋deadline 延至 02:55Z＋重按冪等、P3/逾期不回溯全擋）；`db:verify` **28/28**（無 schema 變更）。
- **實機 E2E**（dev server + mock 模式）：見驗證紀錄。
- **Phase 7 開發面到此完整**：綁定申請 → 登記 → 分配結果 → 遞補回覆 → 正在路上 → 取消，全流程會員自助。**結案前唯一未竟：真機 LIFF 冒煙**（[member-liff-setup.md](member-liff-setup.md)）。其餘 deferred：候補尾端加入（v2）、PII retention job（Phase 8）、rebind/unbind。

### PR #17 審查修正：offer 效期判定移入原子寫入（migration `0024`，推翻上文「無 schema 變更」）

審查指出：`resolveOfferForWeek` 的 `offer_expires_at` 檢查只是 TS 預檢，`apply_offer_resolution` 的 confirm/decline 路徑**沒有效期條件**（0006 只在 `outcome='expired'` 驗 `<= p_now`）——跨過期限瞬間的請求仍可能把過期 offer 確認成 approved。修正：

- **`0024_offer_expiry_guard.sql`**：`apply_offer_resolution` 加第 8 參數 `p_expiry_guard boolean default false`。`true` 時 `resolved` CTE 的 WHERE 追加 `offer_expires_at is null or offer_expires_at > p_now`——**效期檢查與狀態寫入同一條件式 UPDATE（同 statement、同 row lock）**；`nxt`/`ins` CTE 以 `resolved` 為前提，故被擋下時也不遞補、不入 outbox。回傳補 `expired_blocked`（僅分類用：resolved=0 時區分「已過期」vs「已非 temp_approved」；分類讀在守衛寫之後，最壞只影響 typed reason 標籤、不影響狀態）。**必須 opt-in 的原因**：凌晨 auto-approve 合法地以 `outcome='confirmed'` 處理已過午夜上限的列，無條件加檢查會弄壞它——expiry sweep（`outcome='expired'`）與 auto-approve 均不帶 guard，語意不變。
- **邊界統一 `now >= offer_expires_at` → expired**（原 service 用 `>`，與 UI 按鈕的 `offer_expires_at > now` 在恰好等於時矛盾）；TS 預檢保留為 fast path（省 waiting list 讀取），權威判定在 RPC。
- **`offerService.resolveOffer`** 增 `enforceExpiry?: boolean`（member 路徑傳 `true`）、summary 增 `expiredBlocked`；member service 據此映射 `offer_expired` vs `no_active_offer`。internal route／sweeps 不帶 → 行為不變。
- **測試**：unit +5（邊界 `==` → expired 不觸服務、`expiredBlocked` → `offer_expired`、`expiryGuard` 傳遞、blocked decline 不遞補不 retry、ops 預設 false）；integration +4（邊界不寫、**繞過 TS 預檢直打 `resolveOffer(enforceExpiry)`**：過期 confirm 被原子寫入拒絕（狀態不動、無 outbox）、過期 decline 不觸發下一位、無 guard 過期照樣 confirm＝auto-approve 語意保留）；`db:verify` **29/29**（#29：8 參數簽名 + 舊 7 參數已除）。總計 **555 unit / 668 db-mode**。

---

## 6.27 Phase 8 Slice 1 — Admin UI：登入 + 骨架 + 綁定審核（本次完成，Phase 8 起點）

Admin UI 第一刀（規劃走 plan mode ＋ 外部審查一輪，rev 2 全數採納）。範圍＝admin 認證、`/admin` 骨架（導覽卡：綁定審核 live，其餘「規劃中」灰卡）、綁定審核頁（包既有 `bindingAdminService` 的列表／遮罩預覽／核准／退回）。

- **認證模型（migration `0025`）**：獨立 **`admin_accounts`**（per-admin username + scrypt 密碼，重用 `pinHash.ts`；constraints：username 小寫+格式、`password_hash like 'scrypt$%'` 防明文、display_name 1–80）＋ **`admin_sessions`**（鏡射 0021——cookie 帶原始 opaque token、DB 只存 sha256、12h TTL、multi-device、登入 lazy 清過期列）。**刻意不用 `users.role='admin'`**（會友帳號與後台操作帳號生命週期/稽核責任不同）。帳號供給走 `admin:create` CLI（隨機密碼**只印一次**或 `--stdin`；**無 `--password` flag**，避免 shell history）。
- **鎖定週期語意（新 RPC `apply_admin_login_failure(p_id, p_now, p_threshold, p_lock_minutes)`）**：與 staff 版不同，鎖定週期在**原子 UPDATE 內**判定——鎖定中＝no-op（不累加、不延長，防止重複請求永久續鎖）；**鎖定逾期＝新一輪從 1 計**；達門檻（5 次）設 `locked_at`（鎖 15 分）。
- **反枚舉姿態**：查無帳號／停用／鎖定中三路徑都對 DUMMY scrypt hash 跑一次 verify（timing 一致），且對外**一律 401 `invalid`（不回 423）**——423 會洩漏帳號存在性並讓 lockout 變成可探測的 DoS；typed `locked` 留在 service 供測試/稽核。UI 文案「帳號或密碼錯誤，或帳號暫時無法登入」。
- **Session 撤銷**：`getAdminSession()` 遇過期列或帳號已停用（每請求檢查 `disabled_at`）→ **實際刪除該 token_hash 列**再回 null（停用即殺全裝置 session；各裝置殘列在其下次請求被物理刪除）；malformed cookie（非 43 字 base64url）不查 DB。`createAdminSession` 失敗必 throw → route 500，cookie 只在 DB 列建立成功後設定。
- **Request hardening（`adminRequestGuard.ts`，Admin POST 共通）**：非 JSON → 415、body > 4KB（UTF-8 bytes）→ 413、壞 JSON → 400、**Origin 有帶且不符 → 403**（未帶放行：non-browser client 無 ambient cookie 非 CSRF 面）、不 log body、500 一律 generic `{error:'internal'}`。`pendingId` 驗 UUID；`claimVersion` 驗 `Number.isSafeInteger && >= 0`（DB bigint，JSON number 超 safe range 會失真）；reject 原因 **200 code points 三層上限**（route/service `[...str].length` ＋ DB `char_length` check）。
- **稽核欄 `pending_binding.decided_by_admin_id`**：approve/reject RPC 改簽名加 **defaulted `p_admin_id`**（4→5 arg / 3→4 arg，先 drop 舊簽名防 PostgREST overload ambiguity）——**adminId 只取自 session，body 偷帶一律忽略**；CLI 決行記 null（`binding:approve/reject` 零改動相容）。只有非 dry-run 的最終 commit 寫入（dry-run／`pending_changed` 等被擋路徑不寫）。
- **順手修掉 reject race（0025）**：0019 版 `reject_pending_binding` 的 status 讀取不加鎖、UPDATE 無 status guard——併發 approve+reject 可能把剛 approved 的列覆寫回 rejected（`users.line_id` 已寫但稽核顯示 rejected）。新版 `select … for update` 與 approve 同鎖序列化；integration 以併發測試釘住「恰一方決行、輸方 `pending_not_pending`」。
- **審核 UI**（桌機友善 `max-w-5xl`，深色 slate 同風格）：列表用 `listPendingBindingsPage`（**查 limit+1 判 `hasMore`**，滿 100 筆顯示「僅顯示最早 100 筆」提示而非默默截斷）；React key 與 API 一律**完整 UUID**（短 ID 僅顯示、點擊複製全 ID）；審核 modal 開啟即 preview（遮罩欄位＋`claimedName`/`matchedDisplayName` 全文供人工比對＋預測 reason 對映 binding-ops.md 文案），「確認核准」帶 `claimVersion` handshake（移植自 `run-binding-approve.ts`），409 `pending_changed` → 重新預覽；退回 modal 快選 chips＋「勿填個資」警語。**preview client DTO 白名單不含 `matchedUserId`**（人工審核用不到 UUID，減少內部識別碼暴露面）。
- **新檔**：`server/http/adminAuth.ts`／`adminRequestGuard.ts`、`server/services/adminAuthService.ts`、`app/api/admin/{login,logout,bindings/{preview,approve,reject}}/route.ts`、`app/admin/{page,AdminLogin,AdminHome,LogoutButton}.tsx`、`app/admin/bindings/{page,BindingReview}.tsx`、`scripts/run-admin-create.ts`。常數 `ADMIN_LOGIN_MAX_ATTEMPTS=5`/`ADMIN_LOGIN_LOCK_MINUTES=15`/`ADMIN_SESSION_TTL_HOURS=12`。

### 驗證（本回合實跑）
- 靜態：`tsc`／`eslint`／`next build` ✅（新 `/admin`、`/admin/bindings` ＋ 5 條 `/api/admin/*` ƒ dynamic）。
- 測試：`npm test` **632 / 121 skipped**（新增 92：adminAuthService 輸入邊界不觸 DB／三路徑 dummy verify／鎖定週期含逾期重計；adminAuth cookie 屬性全驗／過期與停用實際刪列／malformed 不查 DB；login route 統一 401／短路；logout DB 失敗仍清 cookie；bindings routes 415/413/400/403 矩陣、UUID/safe-integer 邊界、body 偷帶 adminId 被忽略、preview keys 白名單、reason→status 全對映表、未知 reason → 500 generic；bindingAdminService adminId 透傳、200 code-point 上限、page limit+1/hasMore）；`RUN_DB_TESTS=1` **753**（新增 `admin-auth.db.test.ts` 8 例：constraints 實測、duplicate username、session cascade、FK 拒未知 admin、login 全生命週期（**5 併發失敗恰一次上鎖**、鎖定中 no-op、逾期重計 1、成功歸零）、approve/reject 帶與不帶 adminId、dry-run/`pending_changed` 不寫稽核欄、**併發 approve+reject 恰一方勝**）；`db:verify` **30/30**（#30：兩表結構+constraints+RLS+grants、failure RPC、5-arg/4-arg 簽名＋舊簽名已除；#24/#27 簽名斷言同步更新）。
- **實機 E2E**（dev server + curl）：`admin:create` 印一次性密碼 → 錯密碼 401 → 登入 200 設 cookie → 415/413/403/400/401 hardening 全中 → psql 造 LIFF claim → `/admin/bindings` 頁面渲染遮罩列 → preview 正確回 `member_already_bound`（seed 已綁）→ 清 line_id 後 preview `approved` → **預覽後重送 claim → 舊 claimVersion 核准 → 409 `pending_changed`** → 重新 preview 取新版本 → 核准 200 → psql 驗 `users.line_id`＋`status='approved'`＋`decided_by_admin_id` → 退回一筆驗 `rejected_reason`＋decider → CLI `binding:approve` dry-run 照常（5-arg default）→ 錯 5 次上鎖（全程 401 統一文案）→ psql 調鎖定逾期 → 錯一次重計 1 → 對密碼登入成功歸零 → 登出（per-device：另一裝置 session 留存）→ `/admin` 回登入頁。E2E 資料已清、seed 還原。
- **Phase 8 後續 slices**：**② 會友管理＋發碼（§6.29）③ admin 帳號管理（§6.30）④ P2 資格審查唯讀檢視（§6.31）⑤ CSV 匯入上傳（本刀 §6.32 完成）** → ⑥ 營運可視化 ⑦ **PII retention job（必收項**，決行 90 天清 `claimed_phone`/`claimed_name`/`submitted_code`，見 binding-ops.md**）** ⑧ 牧養處理＋Staff PIN 管理 UI；資格審查**寫入型覆核**（需 `reviewed_by_admin_id` migration，§6.31 follow-up）；匯入稽核欄（誰匯入，§6.32 follow-up）。

---

## 6.28 Phase 7 真機 LIFF 冒煙 — PASS（結案，2026-07-11）

開發者自己的 LINE Login channel（`2010671228` / LIFF `2010671228-LPPgqp5a`）＋ cloudflared tunnel ＋ iOS 實機。**會員自助全鏈在真機打通**：

- **LIFF 登入鏈**：`liff.init` → LINE 授權同意 → ID token → server 端 verify（`POST /api/member/login 200`）→ `not_bound`。
- **綁定申請（Slice 2）**：未綁定 → 申請表 → 送出會友一手機（`0911000001`）→ `POST /api/member/binding-claim 200`；`binding:pending` 遮罩列 `會友一 / 0911***001`；`binding:approve` 預覽（source=liff、matched=會友一、`wouldApprove`）→ `--apply` 寫 `users.line_id`、pending 轉 `approved`。
- **自動登入＋狀態卡（Slice 1）**：核准後重開 LIFF → 自動登入 → 狀態卡。
- **申請登記（Slice 3）**：手機按申請 → `reservations` 寫入 `pending`、`effective_priority=2`（`mobility_long` 自動 P2，無需當週宣告，符 §4）、車輛 ABC-1234。

**踩到並已寫回 [member-liff-setup.md](member-liff-setup.md) 的坑**：channel 須 **Developing→Published**（否則非 channel 角色帳號登入得「無法正常執行！」）；LIFF URL **必須從 LINE app 內開**（外部瀏覽器落入網頁登入 fallback、直開 tunnel 網址卡在「連線中」）；Linked OA 在 channel Basic settings 非 LIFF 表單；**冒煙進行中不可再 `db:reset`**（會蒸發 claim/場次——與並行的 Phase 8 測試共用同一本機 DB，需錯開）；`next.config.ts` 補 `allowedDevOrigins:['*.trycloudflare.com']` 消 tunnel 下 HMR 跨網域雜訊。

**發現一個 UX 缺口（backlog，非阻擋交付）**：ID token 過期時 gate 顯示死路訊息「請關閉此頁後重新開啟」，未自動重新登入。本回合曾試做「過期→自動 `liff.login()` 跳轉」，但在**卡住的真機＋HMR 不更新**環境下盲改導致跳轉迴圈徵狀，已**還原為 merge 前可用版本**。正確做法留待離線 follow-up：mock 模式驅動 401/過期路徑寫單元測試、用 **URL query 參數**（比 sessionStorage 更能撐過跳轉）做 one-shot loop guard、真機只驗一次。列入 Phase 8 之後 backlog。

---

## 6.29 Phase 8 Slice 2 — Admin UI：會友查詢 + 唯讀明細 + 發碼 UI（本次完成）

Admin UI 第二刀（plan mode ＋ 外部審查一輪，rev 2 全數採納）。範圍＝支援綁定 onboarding 的前置動作：找到會友、核對身分、對未綁會友發放一次性綁定碼（把既有 `binding:issue` CLI 首度帶進 UI）。**無 schema 變更**，db:verify 維持 30/30。使用者決策：**明細頁完整個資、搜尋列表遮罩電話**。

- **搜尋整表防護（三層，審查定案）**：service 先去除 LIKE wildcard（`replace(/[%_]/g,'')`——`.ilike()` 只防 filter-syntax 注入、不會讓 `%`/`_` 失去萬用字元語意）→ 三分支各自清理＋門檻（**name 需含 `\p{L}`/`\p{N}` 至少 1 字**、phone ≥3 位數、plate ≥2 英數），清理後空的分支不查 → 三分支全空**不打 DB**。repo 各分支 **candidate cap 250**、合併 distinct → 一次抓 active 車牌 → **穩定排序 `display_name ASC, id ASC`** → service 才 `slice(limit+1)` 判 `hasMore`（合併後才截、數字才準）。純符號／emoji／`%`／`_` 均回空、非整表。
- **搜尋對象＝全部 `users`**（含 user/full_time_staff/staff）＋role 徽章；**enum 無 `role='member'`**、admin 帳號在獨立 `admin_accounts` 表故不會被帶出。phone canonical（`users_phone_format_ck`）故 digit-contains 可命中；**只搜/顯示 active 車牌**（inactive 歷史車牌不命中、不入摘要）。
- **PII 分層**：search 走 **POST**（含個資查詢不落 URL/access log）、query 不 log、列表 `maskPhone`；**明細頁完整個資**（全電話/車牌/資格/眷屬）僅 session-gated、`export const dynamic='force-dynamic'`＋`revalidate=0`（build 顯示 ƒ）、`[id]` **先驗 UUID 再打 DB**；**client DTO 只給 `bound` 布林、丟棄 `line_id` 原值**、不含 penalties 等未規劃敏感欄位。
- **發碼**（包既有 `issueBindingCode`）：**bound check ＝ UX precheck、非原子**——已綁回 `already_bound`、查無回 `member_not_found`；註解/測試明載 precheck 後仍可能 concurrent bind、**最終守門是核准 RPC 的 `member_already_bound`**、不描述為 DB invariant。`ttlDays` `Number.isSafeInteger` 1–90；`note` `null|string`、trim 空→null、≤200 code points、否則 400、不 log、UI 標「勿填敏感個資」。**`createdBy` 一律 `admin:<session.username>`、body 偷帶忽略**（E2E 實證 `created_by=admin:s2test2` 非 `attacker`）。全碼 **response no-store／不 log／refresh 不自動重取**；UI 文案「請立即複製並轉交；離開此畫面後，Admin UI 不會再次顯示完整綁定碼」（不暗示技術上不可再取——DB 仍存明文）。
- **新檔**：`server/services/memberAdminService.ts`、`app/api/admin/members/{search,binding-code}/route.ts`、`app/admin/members/{page,MemberSearch}.tsx`＋`[id]/{page,IssueBindingCode}.tsx`。**改**：`parkingRepository.ts`（+`searchMembers`/`getMemberAdminDetail`）、`mockRepo.ts`、`AdminHome.tsx`（「會友管理」卡改 live、資格審查另留規劃中卡）。

### 驗證（本回合實跑）
- 靜態：`tsc`／`eslint`／`next build` ✅（新 `/admin/members`、`/admin/members/[id]`（**ƒ dynamic**）＋ 2 條 `/api/admin/members/*`）。
- 測試：`npm test` **672 / 132 skipped**（新增 40：service 搜尋清理矩陣（`%`/`_`/`%%%`/純符號/emoji 不觸 DB、中文只走 name、phone<3/plate<2 略過分支）＋遮罩＋hasMore、明細 DTO 含 `bound` 不含 `line_id`、發碼 bound-guard/ttl；routes 401/415/413/400/403、ttl 1/90/0/91/小數邊界、note 200/201/emoji、createdBy 恆 session／忽略 body、code/query 不 log、service throw→500）；`RUN_DB_TESTS=1` **804**（新增 `member-admin.db.test.ts` 11 例：name/phone/plate 各命中、inactive 不命中、name+phone+plate 同筆去重、hasMore、明細完整含眷屬/eligibility null、發碼寫 binding_codes＋created_by、bound-guard、member_not_found）；`db:verify` **30/30 不變**。
- **實機 E2E**（dev + curl）：登入 → 依姓名/電話/車牌各搜（列表遮罩、`%`/`!!!` 回空非整表）→ 明細頁全電話 `0911000001` 現形、`line_id` 不在 HTML、malformed id → 200 查無（不打 DB）→ 未綁會友發碼（全碼＋psql 驗 `created_by=admin:<user>` 非 body 偷帶值）→ 已綁 seed 會友一 → `already_bound` → hardening 415/413/403/UUID400/ttl91-400/note201-400 全中。E2E 資料清除、seed 未動。

---

## 6.30 Phase 8 Slice 3 — Admin UI：admin 帳號管理（本次完成）

Admin UI 第三刀（plan mode ＋ 外部審查一輪，**rev 1 因安全問題被打回、rev 2 全數採納**）。範圍＝offboarding 安全項：清單／停用·重啟／重設密碼／全裝置撤銷。**新增 migration `0026`**（db:verify 30→**31**）。使用者拍板：只做帳號管理（資格審查另立後續 slice）；改密＝**僅他人重設**（隨機碼一次性顯示、自動撤銷）；新增帳號維持 CLI-only。

- **rev 1 被打回的核心問題**：原規劃「無 schema 變更」為了省一個 migration，接受了「重啟不撤銷 session」（舊 opaque-token cookie 可能復活）、「重設密碼＝多次分開呼叫」（部分失敗會留下 hash 已改但 session 未撤銷的憑證/session 不同步態）、「last-active 守門＝read-then-write」（雙向互停可能競態歸零）。外部審查判定：**offboarding 安全功能不該為了省 schema 變更而接受這些**，必須改原子 RPC。
- **`set_admin_disabled(target, acting, disabled, now)`（migration 0026，原子）**：self-target 先擋 → `pg_advisory_xact_lock` 序列化同類操作 → row lock → **停用時原子確認「異動後仍 ≥1 位 enabled admin」**（`last_active_admin`，杜絕雙向互停歸零）→ 寫 `disabled_at` → **停用與重啟都撤銷該帳號所有 session**（重啟也撤銷是關鍵修正——防止先前停用漏刪的殘留 session 列在重啟後復活）。**冪等**：已停用再停用／已啟用再啟用皆回 ok 且仍清 session，已停用時跳過 last-active 判定。
- **`reset_admin_password(target, acting, password_hash)`（migration 0026，原子）**：self-target 先擋 → 單一 transaction 內 hash 更新 + `failed_attempts=0` + `locked_at=null` + 撤銷全部 session，all-or-nothing。**RPC 只收已雜湊值、永不接收或回傳明文**；明文只存在 service 記憶體，成功後才回一次。**不動 `disabled_at`**（停用帳號重設後仍停用，需另外重啟）。
- **peer 模型 + 三層 self-target 擋**（route／service／RPC，最後一層防未來其他 caller 繞過）：`admin_accounts` 無角色階層，所有異動只能對「別人」；操作者自己那列 UI 不顯示按鈕、只標「目前登入」。
- **UI（`/admin/accounts`）**：破壞性動作（停用/重啟/撤銷/重設）皆inline 二次確認**顯示 target username**（防誤點錯行）；重設密碼成功後全碼**只顯示一次**（no-store／不 log／不入 URL·localStorage·sessionStorage；切到其他帳號動作或關閉視窗即從 component state 清除）；依 `disabled` 分流文案（停用帳號重設後提示「需先重啟才能登入」）。
- **`app/api/admin/accounts/{disable,reset-password,revoke-sessions}`**：`actingAdminId` 一律取 session、body 偷帶（`actingAdminId`/`username`/`passwordHash`）全忽略；typed reason → status 對映：`not_found`→404、`cannot_target_self`→403、`last_active_admin`→409（disable-only）。獨立「撤銷所有 session」（`deleteAdminSessionsByAdminId`）維持單表單句 repo delete——本身已原子，不需 RPC。
- **新檔**：`supabase/migrations/0026_admin_account_management.sql`、`server/services/adminAccountService.ts`、上述 3 條 route、`app/admin/accounts/{page,AdminAccounts}.tsx`。**改**：`parkingRepository.ts`（+`AdminAccountListRow`／`getAdminAccountById`／`listAdminAccounts`／`setAdminDisabled`／`resetAdminPassword`／`deleteAdminSessionsByAdminId`）、`mockRepo.ts`、`AdminHome.tsx`（「帳號管理」卡改 live）、`verify_schema.sql`（+1 PASS 段）。

### 驗證（本回合實跑）
- 靜態：`tsc`／`eslint`／`next build` ✅（新 `/admin/accounts`（**ƒ dynamic**）＋ 3 條 `/api/admin/accounts/*`）。
- 測試：`npm test` **712 / 143 skipped**（新增 40：service self-target 三動作皆不觸 repo、typed reason 透傳、status 推導（active/disabled/locked 含鎖定逾期）、重設回傳明文但傳給 repo 的僅 hash 且每次不同；routes 401/415/413/400/403/404/409 矩陣、actingAdminId 恆 session／body 偷帶全忽略、密碼不進 log、service throw→500）；`RUN_DB_TESTS=1` **855**（新增 `admin-accounts.db.test.ts` 11 例：**重啟清除手動注入的殘留 session（session 復活防護）**、停用/重啟冪等（仍清 session、跳過 last-active）、**唯一 active admin 不可被停用**、**兩位 active admin 併發互停恰一方勝**、重設原子後態（hash 改＋lock 清＋session 空）、停用帳號重設後仍停用、RPC 層直呼也擋 self-target、`deleteAdminSessionsByAdminId` 只刪目標帳號、清單依 username 排序）；`db:verify` **31/31**（新增 #31：兩支 RPC 簽名＋service_role execute grant）。
- **實機 E2E**（dev + curl，臨時 admin e2eslice3a/b）：A 停用 B → psql 驗 `disabled_at`＋B 舊 cookie 307（session 已刪列）→ **手動注入殘留 session 模擬漏刪** → A 重啟 B → psql 驗殘留列也被清空、B 舊 cookie 仍死（需重新登入）→ B 用舊密碼登入成功 → A 重設 B 密碼（一次性明文）→ psql 驗新 session 已撤銷、B 用舊密碼登入失敗、新密碼登入成功 → A 撤銷 B 新 session → B cookie 死 → A 對自己執行三動作皆 403 `cannot_target_self` → 停用 B 後 A 為唯一 active → `not_found`（隨機 UUID）404 → hardening 415/413/403(origin)/400(非UUID)/400(非boolean)/401(無session) 全中 → `/admin/accounts` 頁面渲染自己列「目前登入」無按鈕、他人列狀態徽章正確 → `/admin` 首頁「帳號管理」卡已轉 live。E2E 帳號＋session 已清除。

---

## 6.31 Phase 8 Slice 4 — Admin UI：P2 資格審查（到期/待覆核唯讀檢視，本次完成）

Admin UI 第四刀（plan mode ＋ 外部審查一輪，**rev 1 5 必改 + 明細 badge 全數採納**）。範圍＝把「誰的 P2 資格已過期／待覆核／即將到期」變成同工看得到的清單——臨時性資格到期後會靜默掉回 P3（[priority.ts](../parking-system/lib/allocation/priority.ts) `p2_valid_until < sundayDate`），匯入缺日期者被標 review_required，過去**無介面看得到**。使用者拍板：**純唯讀檢視**（無 schema 變更，db:verify 維持 31；grant/revoke/標記已覆核等寫入另立後續 slice）；surface **已過期 + 待覆核 + 60 天內到期/需覆核**。

- **rev 1 被審查抓到的關鍵 bug**：`dueDate` 原用「review_date 優先、null 才用 valid_until」——但真正該處理的是**兩日期較早者**（`valid_until=7/15、review_date=8/30` 者其實 7/15 就失效，卻會排到後面）。改用 `earliestDate(valid_until, review_date)`。狀態仍維持明確優先序（expired > review_due > active/permanent）。
- **repo 不可「先任意 limit 再由 service 排序」**：PostgREST 無 ORDER BY 時前 N 筆無業務意義，命中超過 cap 會漏掉最急案件。改成**雙分支各自有序查詢**（`p2_review_date <= cutoff` 依 review_date ASC、`p2_valid_until <= cutoff` 依 valid_until ASC，各 `limit branchCap`）→ 合併 distinct by user_id → service 全域 `dueDate ASC` 排序後才 `slice(DISPLAY_CAP)`。`BRANCH_CANDIDATE_CAP = 500*2+1`。
- **不把 import「review_date==valid_until」當 DB invariant**：那只是 import 慣例、無 constraint 保證；讀取端容忍 legacy/人工不一致，一律取較早日期。
- **60 天 cutoff 用 `addDaysToIsoDate` calendar helper**（`Date.UTC(y,m-1,d+days)`，跨月/年/閏年正確、當日含），非散落的 epoch 加減。
- **明細頁補 server-derived 狀態 badge**（有效／已過期（日期）／待覆核／永久）：解決「清單說已過期、明細卻看似仍有 P2」的語意衝突——過期資格在 DB 仍 `p2_eligible=true`，只是 apply 時掉 P3。純讀、不寫。
- **PII 分層**：清單有姓名＋P2 事由（健康相鄰敏感），僅 session-gated＋`force-dynamic`/`revalidate=0`＋不 log；**清單不帶電話/眷屬姓名**（識別靠姓名＋連明細）。`.or`/branch filter 恆有 cutoff 上界、無使用者輸入注入面、**永久列（兩 null）由 lte 語意天生排除**。第三段名稱「60 天內到期或需覆核」（含 valid_until=null 但 review_date 將到者，不一定「即將失效」）。`hasMore` 時 header 標「目前顯示（最急迫前 500 筆）」不誤導為總數。
- **無 API route**（純唯讀 server component 直呼 service，比照明細頁）。**新檔**：`lib/eligibilityStatus.ts`（`earliestDate`/`addDaysToIsoDate`/`deriveEligibilityStatus` 純函式）、`server/services/eligibilityReviewService.ts`、`app/admin/eligibility/page.tsx`。**改**：`parkingRepository.ts`（+`EligibilityReviewRow`／`listEligibilityReview`；embed 用 `users!user_id!inner` 消 user_eligibility 兩條 FK 至 users 的歧義）、`mockRepo.ts`、`AdminHome.tsx`（資格審查卡轉 live）、`app/admin/members/[id]/page.tsx`（+狀態 badge）。

### 驗證（本回合實跑）
- 靜態：`tsc`／`eslint`／`next build` ✅（新 `/admin/eligibility`（**ƒ dynamic**）；無新 API route）。
- 測試：`npm test` **737 / 146 skipped**（新增 25：`eligibilityStatus` 純函式（earliestDate、addDaysToIsoDate 跨月/年/閏年/當日含、deriveEligibilityStatus 5 狀態 + `valid_until==today` 不算過期）；service dueDate=min、expired 優先於 review_due、排序打亂仍穩定（dueDate→name→id）、cutoff=today+60、permanent 防禦性 skip、hasMore 截 500 且 counts 為顯示數）；`RUN_DB_TESTS=1` **883**（新增 `eligibility-review.db.test.ts` 3 例：surface 四類/排除永久·遠期·非 eligible、插入順序反向仍按 dueDate、不一致列取較早日期、同列兩分支命中只回一筆、`users!user_id` join 帶回 display_name）；`db:verify` **31/31 不變**。
- **實機 E2E**（dev + curl，psql 直插各類臨時列）：登入 → `/admin/eligibility` → 四列依 dueDate 排序（已過期 7/01→待覆核 7/05→不一致 7/25→即將 8/01；**不一致列 dueDate=min 生效**）→ 永久/遠期/非 eligible **不出現** → **HTML 不含電話 `0912888001` 與眷屬姓名 `E2E4SECRETCHILD`** → header 計數（已過期 1·待覆核 1·60 天內 2）→ 明細頁過期會友 badge 顯「已過期（2026-07-01）」、即將到期者顯「有效」→ 無 session → 307 redirect `/admin`。E2E 臨時列＋admin 已清除。
- **Follow-up（記錄，本刀不做）**：寫入型覆核（grant/revoke/標記已覆核）需 migration 補 `user_eligibility.reviewed_by_admin_id`（現 `reviewed_by→users`，admin 在 `admin_accounts`；比照 0025 `decided_by_admin_id`）。

---

## 6.32 Phase 8 Slice 5 — Admin UI：會友名單 CSV 匯入上傳（本次完成）

Admin UI 第五刀（plan mode ＋ 外部審查一輪，**rev 1 4 必改 + 4 建議全數採納**）。範圍＝把只能走 CLI 的 `members:import` 包成 Admin UI 上傳。核心 `importMembersFromCsv` 原用 `readFileSync(filePath)`——**抽出 text 變體** `importMembersFromCsvText({ csvText })` 讓 CLI 與 route 共用同一 parse/validate/write pipeline。**無 schema 變更**（包既有 `import_member` RPC），db:verify 維持 **31**。CLI／既有 filePath 整合測試零改（wrapper 保留）。

- **rev 1 被審查抓到的安全缺口（全改）**：
  1. **真正的 body 上限**（`server/http/csvUpload.ts`）：不可「先 `request.text()` 再量大小」（無 content-length／chunked 會先把超大 body 全載入）。改 **bounded stream reader**——`request.body.getReader()` 逐 chunk 累積、**一超過 2 MiB 立即 `reader.cancel()` → 413**（不信任 content-length）；再 **`TextDecoder('utf-8',{fatal:true})`** 嚴格解碼，非法 byte → 400 `invalid_encoding`（不讓 `�` 靜默替換）。
  2. **preview↔apply 綁定**（`server/http/importConfirmToken.ts`）：preview 回 **HMAC 簽章 token**（綁 `sha256(csv bytes)` + adminId + 30 分 expiry；簽章 key 由 `SUPABASE_SERVICE_ROLE_KEY` domain-separated 派生、**無新 env、不存 PII**）。apply 重算 digest 驗 token → digest 不符 409 `preview_mismatch`、過期 409 `preview_expired`、缺/壞/他人 403。防跳過預覽直接 apply、防換檔、防過期。
  3. **partial_apply**：每位 member 的 RPC 原子、**整份 CSV 非單一 transaction**；apply 中途某位 throw → `CsvImportExecutionError{processedMembers, report}` → route 回 **409 `partial_apply`**（含已處理數與安全報告、**不外流 raw DB error**），UI 明示「可能已部分寫入、請保留檔重新預覽再匯入（idempotent、不重複建車）」。
  4. **結構/量體上限**（`lib/memberImport.ts` `parseCsv`）：**必要表頭齊全**（缺 → `missing_headers`，而非一大份逐列錯誤）、**不得重複表頭**（`duplicate_headers`）、`MAX_ROWS=5000`（`too_many_rows`）、`MAX_CELL_CODEPOINTS=500`（超長 cell → 該列 validationError）、報告每類 `MAX_REPORT_ITEMS=500` 截斷 + `totals`。壞引號 → `invalid_csv`（**不回 parser 原訊息**，防 PII 片段外洩）。
- **兩條 route**（語意分明）：`…/import/preview`（dry-run + token）、`…/import/apply`（驗 token → 寫）。content-type **精確** exact-match `text/csv`（split `;` 前 MIME，非 `includes`）。**csvText/report/token 一律不 log**。
- **UI（`/admin/import`）**：`<input type=file>` → 上傳並預覽 → 報告（counts + 四清單，`reviewRequired` 連 `/admin/eligibility`；截斷提示）→ **blocking/warning 分級**：有 validationErrors/phoneNameConflicts/plateConflicts 時「確認寫入」需勾選「問題列將略過、其餘仍寫入，我已了解」；`partial_apply` 保留檔。**原始 CSV bytes 存 `useRef`、只 report+token 進 state**（降 devtools 全文暴露）、完成即清、不落 storage/URL/analytics、無「複製完整報告」鈕。
- **新檔**：`server/http/{csvUpload,importConfirmToken}.ts`、`app/api/admin/members/import/{preview,apply}/route.ts`、`app/admin/import/{page,MemberImport}.tsx`。**改**：`lib/memberImport.ts`（+`parseCsv`/`CsvImportError`/limits/`longestCell`）、`memberImportService.ts`（text 變體 + `CsvImportExecutionError` + 報告截斷；`importMembersFromCsv` 轉 wrapper）、`AdminHome.tsx`（名單匯入卡轉 live）。

### 驗證（本回合實跑）
- 靜態：`tsc`／`eslint`／`next build` ✅（新 `/admin/import`（**ƒ dynamic**）＋ 2 route）。
- 測試：`npm test` **779 / 148 skipped**（新增 42：`parseCsv` 表頭/列數/引號/CRLF/BOM/quoted-comma-newline、`longestCell`；`importConfirmToken` round-trip + digest/admin/expiry/竄改；`csvUpload` content-type 精確、**bounded stream（有/無 content-length、lying length、正好/超 1 byte、cancel）**、非法 UTF-8、空、Origin；routes preview/apply 401/415/403/400/409 矩陣、token 綁定、**partial_apply 前 2 位已呼叫且不外流 raw error**、不 log）；`RUN_DB_TESTS=1` **927**（member-import 加：text 變體與 filePath 版同結果、**partial_apply 前 2 位確實寫入**）；`db:verify` **31/31 不變**。
- **實機 E2E**（dev + curl，`members-sample.csv`）：登入 → 預覽（7 members、6 imported、1 phoneNameConflict、token 198 chars、**psql 確認未寫**）→ 確認寫入（imported 6、psql 驗 users/eligibility）→ **改一 byte 重用舊 token → 409 preview_mismatch**、無 token → 403 → 同檔重送 idempotent（imported 0/updated 6）→ >2 MiB → 413、非法 UTF-8 → 400、缺表頭 → 400、非 text/csv → 415、無 session → 401、foreign Origin → 403 → `/admin/import` 頁渲染、無 session 307 redirect、首頁卡轉 live。E2E 測試會友＋admin 清除；**dev server 用具體 PID 停止**。
- **Follow-up（本刀不做）**：`import_member` 不記「誰在何時匯入」；要記需 migration 加稽核欄。

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
| `npm test`（不接 DB） | ✅ **399 passed / 47 skipped**（本回合實跑；`*.db.test.ts` 被 gate 跳過） |
| `npm run db:reset` | ✅ 套用 `0001–0017` + seed |
| `npm run db:verify` | ✅ **22/22** schema 斷言 PASS |
| `RUN_DB_TESTS=1 npm test`（接本機 Supabase） | ✅ **451 passed** |

> 上表全為 **Phase 4 Slice F（dispatcher autonomy）本回合實測**（含 `db:reset 0001–0017`、`db:verify` 22/22、`RUN_DB_TESTS=1` 451）。下方 Slice 4 專屬涵蓋為當時紀錄。

**測試檔：** 純函式 `tests/unit/allocation/*`（含 `scenario.test.ts` 全週情境）；服務 `tests/unit/server/*`（mock repo）；
整合 `tests/integration/{friday-allocation,cancellation-substitution,release-attendance,settlement,walk-in,staff-pin,event-finalize,auto-finalize-fallback,notification-dispatch,move-car,outbox-health,release-owner-notice,cancel-confirm-notice,outbox-requeue}.db.test.ts`（gated by `RUN_DB_TESTS=1`，各用獨立週日）。

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
| **通知 go-live 前置**：真實 OA channel token + 移車/釋出/取消文案定稿 + per-member `line_id` 綁定流程 | **ops 軌** | §6.14/§6.16/§6.17 已用 mock transport 全綠；上線需真實憑證與綁定；`move_car_request`/`reservation_released`/`reservation_cancelled` 文案與緊急/其他版本（B/C/D）、admin/staff 取消措辭另備 |
| ~~dispatcher 排程綁定 + `dryRun` 預覽 + outbox 健康度可視 + production transport guard~~ | ✅ **完成（Phase 4 Slice C，§6.15）** | GET+cron/job auth、`?dryRun=1`/`--dry-run`、`outbox_health` RPC + `/outbox-status` + `job:outbox-status`、`mock_in_production` guard；runbook [dispatcher-ops.md](dispatcher-ops.md) |
| ~~dispatcher 健康度**監控告警** + `failed` **dead-letter 處理** + 外部排程 runbook~~ | ✅ **完成（Phase 4 Slice F，§6.18）** | `GET /outbox-alert`（200/503）+ `job:outbox-alert`；`requeue-failed`（手動、dryRun 預設、`failed→pending`）；`outbox_health.oldest_due_at`；外部排程器文件化（不 commit live artifact） |
| dispatcher **正式排程實際掛載**（外部排程器設 secret + 部署後啟用）/ push-channel 告警（Slack/email/LINE-admin）/ LIFF / webhook 自動回覆（含「正在路上」回覆入口） | go-live / 後續 | §6.18 App 為 scheduler-ready；實際掛載需部署 + secret；移車/通知目前靠 `job:dispatch` 手動或外部 cron 排空 |
| ~~LINE webhook + pending binding 擷取（`綁定 <code>` → pending 申領，不寫 `users.line_id`）~~ | ✅ **完成（Phase 5A，§6.19）** | 驗簽（raw body HMAC）+ capture-only 零回覆 + `0018` `pending_binding` 一帳號一 active pending（upsert）+ counts-only；可安全對正式 OA dry-run。**規劃 [go-live-readiness.md](go-live-readiness.md)** |
| ~~**Phase 5B Slice 1** — binding 審核 RPC（`binding_codes` + approve/reject，schema/RPC only）~~ | ✅ **完成（§6.20）** | `0019` `binding_codes` + `pending_binding` 稽核欄 + `approve_pending_binding`（by pending id、dry-run、typed reason）/`reject_pending_binding`；DB/RPC only、無 CLI/送出 |
| ~~**Phase 5B Slice 2** — binding CLI（`binding:issue`/`approve`/`reject`）+ masked 預覽 + operator 文件~~ | ✅ **完成（§6.21）** | `lib/binding.ts` 產碼/遮罩 + `bindingAdminService` + 3 支 CLI + [binding-ops.md](binding-ops.md)；approve 預設 dry-run、`--apply` 才寫；issue 隨機碼只印一次；無 schema 變更 |
| Phase 5B 之後：綁定會友即可真送達（需搭真 OA token + `NOTIFICATION_TRANSPORT=line`）；仍需一次**教會正式 OA** capture dry-run | go-live | 見 [go-live-readiness.md](go-live-readiness.md)、[oa-dry-run-tunnel-runbook.md](oa-dry-run-tunnel-runbook.md) |
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
- `.env.local`：`SUPABASE_SERVICE_ROLE_KEY` 用 `npx supabase status` 的 **`sb_secret_...`**（非舊版 JWT）；`SUPABASE_URL=http://127.0.0.1:54321`；`JOB_TRIGGER_SECRET`（route 的 `x-job-secret`）；**`NOTIFICATION_TRANSPORT`（`mock`|`line`）** + **`LINE_CHANNEL_ACCESS_TOKEN`（`line` 模式必填，否則 dispatcher fail-fast）**；**`MEMBER_AUTH_MODE`（`mock`|`liff`；本機用 `mock`，`liff` 另需 `LINE_LOGIN_CHANNEL_ID` + `NEXT_PUBLIC_LIFF_ID`，見 [member-liff-setup.md](member-liff-setup.md)）**。這些密鑰**僅後端使用，絕不可暴露到瀏覽器**（`NEXT_PUBLIC_LIFF_ID` 例外，非機密）；`lib/supabase/server.ts` 不得被 client 端 import。
- 本機 Supabase default privileges 只給 API 角色 `Dxtm`，故 migration 對 `service_role` 明確 `grant select/insert/update/delete`；新增表/視圖記得一併授權。
- 整合測試需先 `db:reset` 且設 `RUN_DB_TESTS=1` 才會執行；否則 gate 跳過。
- 目前本機 Supabase stack 已停止（`npm run db:stop`）；下次開發前先 `db:start && db:reset`。
