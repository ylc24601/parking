# 教會主日停車管理系統 — 開發交接文件（Current Handoff）

> 最後更新：2026-07-18 ｜ **Phase 9 已收官；production demo walkthrough 完成並清回 baseline；尚未匯入正式教會會員資料**。Post-Phase-9 功能軌（[feature-triage.md](feature-triage.md)）：Wave -1/0/0.1/1 ✅、**Wave 2A #15 稽核全完成（2A-1／2A-2／2A-3 retention）、Wave 2B-1 #14A ✅、Wave 2B-2a＋2B-2b #10 ✅ ⇒ 容量／P2 資格不需 SQL／CSV，稽核有邊界可清理**。**「強烈建議交付前」清單已清空 ⇒ 開發面可進正式交付收尾**（剩交付後 ops，走查照 **[go-live-checklist.md](go-live-checklist.md)**＝單一權威清單）；驗證見 §8。 ｜ 範圍：Phase 0–2 全部、Phase 3（Staff 現場頁 + v2 全切片）、Phase 4（notification dispatcher A–F）、Phase 5/5B（LINE webhook + binding 擷取/審核/CLI）、Phase 6（會友資料匯入）、Phase 7（會員 LIFF：登入/綁定/申請/取消/遞補確認/正在路上）、Phase 8（Admin UI Slice 1–8）、Phase 9（production deploy + prod demo-complete 收官）全數完成——詳見 §6.13–§6.36。
>
> **現況：開發全部完成（含全部「強烈建議交付前」項）、prod 已站起並跑完完整 demo（見 §6.36）。剩交付後 ops（非開發軌）**：升 Supabase Pro、換教會正式 OA/channel token、匯入真會友 CSV、通知文案 sign-off、**audit purge cron 上 prod（2A-3 新增，文案翻面的硬前置）**、通知 LIFF deep-link（#26）。**交付日照 [go-live-checklist.md](go-live-checklist.md)**（單一權威走查清單，整合 runbook §8/§13＋go-live-readiness §1/§5）。功能 backlog 見 [feature-triage.md](feature-triage.md) 與 [pre-delivery-polish-backlog.md](pre-delivery-polish-backlog.md)。
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
| Phase 3 v2 Stability Slice B | Staff 紙本備援清單（硬離線 fallback）｜當時路徑 `/staff/print`，**Wave 1a 已搬至 `/admin/print`**（#23） | ✅ 完成 |
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
| **Phase 5 / 5B** | **LINE webhook + binding**：webhook 驗簽 capture-only（`0018` `pending_binding`）+ binding 審核 RPC（`0019`）+ CLI（issue/approve/reject） | ✅ 完成（§6.19–6.21） |
| **Phase 6** | **會友資料匯入**（P2 申請表 CSV，CLI 資料基礎；`line_id` 不動） | ✅ 完成（§6.22） |
| **Phase 7** | **會員 LIFF**：登入 + 唯讀本週狀態 + 綁定申請 + 預約申請/自助取消 + 遞補確認/放棄 + 正在路上（真機冒煙 PASS 2026-07-11） | ✅ 完成（§6.23–6.26、§6.28） |
| **Phase 8** | **Admin UI**（Slice 1–8）：登入/骨架/綁定審核、會友查詢/明細/發碼、admin 帳號管理、P2 資格審查、CSV 匯入上傳、營運狀態、PII retention job、牧養 alert 處理 + 現場 PIN 管理 UI | ✅ 完成（§6.27、§6.29–6.35；migrations 0025–0028） |
| **Phase 9** | **Production deploy + prod demo-complete（收官）**：`ensure-weekly-event` + eventId 自解析、雲端 bootstrap、LINE/LIFF 接線 + 11 cron、三端 UI polish；prod 上跑完整 demo（business-chain PASS），A1 清理回 baseline | ✅ 收官（§6.36，2026-07-15） |

**主日完整生命週期（分配 → 取消/遞補 → 釋出/出席 → 結算）已全部落地，並補上 Staff 現場頁
（點名/補點名/walk-in 登記/誤點復原/離線只讀/紙本備援清單/結束當週點名/真 PIN session/結束整週 finalize/auto-finalize fallback）。
Phase 3（Staff 現場頁 + v2 全部切片）至此結案。** 其後 Phase 4–9 亦全數落地（通知 dispatcher、LINE
webhook/binding、會友匯入、會員 LIFF、Admin UI、production deploy），**Phase 9 已收官**；剩交付後 ops（非開發），見
header 與 §6.36。歷史 v2 規劃見 [v2-backlog.md](v2-backlog.md)、後續功能 backlog 見 [feature-triage.md](feature-triage.md)。

**測試與驗證狀態**：分「最新完整里程碑快照（Phase 9 收官）」與「Current HEAD 最近驗證」兩層，詳見 §8（避免混時間語意）。

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

> ⚠️ **本節為當時（Phase 3 v2）的歷史紀錄，路徑已變更**：列印頁於 **Wave 1a（#23）搬到 `/admin/print`**（改 `getAdminSession` gate、event 改用台北日曆當週主日、資料解析抽成 `printSheetService`），`/staff/print` 已刪除、Staff footer 入口移除。以下敘述中的 `/staff/print` 僅代表當時路徑。

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
- **Phase 8 後續 slices**：**② 會友管理＋發碼（§6.29）③ admin 帳號管理（§6.30）④ P2 資格審查唯讀檢視（§6.31）⑤ CSV 匯入上傳（§6.32）⑥ 營運狀態（§6.33）⑦ PII retention job（必收項，§6.34）⑧ 牧養處理＋現場 PIN 管理 UI（§6.35 完成）**——Phase 8 slice map 全數完成；後續 follow-up：資格審查**寫入型覆核**（§6.31 follow-up）→ ✅ **已於 Wave 2B-2a／2B-2b 完成（§8）**；匯入稽核欄（誰匯入，§6.32 follow-up）→ 仍未做。

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
- **Follow-up（記錄，本刀不做）**：寫入型覆核（grant/revoke/標記已覆核）需 migration 補 `user_eligibility.reviewed_by_admin_id`（現 `reviewed_by→users`，admin 在 `admin_accounts`；比照 0025 `decided_by_admin_id`）。→ ✅ **已於 Wave 2B-2a／2B-2b 完成（§8，PR #41/#42，migrations `0032`/`0033`）**，但**解法與這裡的預測不同**：不新增 `reviewed_by_admin_id`，而是把既有 `reviewed_by` 的 FK 直接改指 `admin_accounts`——該欄自 `0001` 至今**零 writer**（正因為它指向會友表、根本存不進覆核者），故沒有資料要遷移，加一個平行欄反而製造兩個「覆核者」。

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

## 6.33 Phase 8 Slice 6 — Admin UI：營運狀態（通知佇列健康度 + 失敗重送，本次完成）

Admin UI 第六刀（plan mode ＋ 外部審查一輪，**rev 1 3 必改 + 4 建議全數採納**）。範圍＝把只走內部 job-secret route/CLI 的通知 outbox 健康度（`getOutboxHealth`）與死信重送（`requeueFailed`）包成 **admin-session** 的 `/admin/ops` 頁。**無 schema 變更、無 PII**（DTO 皆 operation-safe：counts／template 名／sanitized error code／timestamps），db:verify 維持 **31**。既有內部 job-secret route 不動（cron/ops 續用）。

- **rev 1 被審查抓到的問題（全改）**：
  1. **單一 snapshot**：原規劃 page 同時 `getOutboxHealth()`＋`getOutboxAlert()`，但後者內部又讀一次 health → banner 與統計可能來自不同時點。抽純函式 `buildOutboxAlertFromHealth(health, thresholds, now)`（不碰 DB），page 只讀**一次** health、以**同一 health＋同一 now** 算 alert；`getOutboxAlert` 也改呼叫它（DRY、內部 alert route 不變）。
  2. **預覽綁定條件**：requeue 預覽成功後存 `preview={max, errorCode, wouldRequeue}`；**任一表單欄位變更即 `setPreview(null)`、禁 apply**；「確認重送」只用 `preview` 的條件組 body（非當前 form state）——杜絕「預覽 http_500×1、改成全部×500 後按確認實際重送 500」。文案標「預覽為估算、實際可能較少」。
  3. **`max` route 嚴格 1–500**（`Number.isInteger && 1..500`，否則 400；不靠 service 靜默 clamp，API 契約與 UI 範圍一致）。
- 另採納：**`dryRun` 非 boolean → 400**（`"false"` 不得靜默當 dry-run 回 200）但仍 fail-safe（非 `false` 一律 dry-run）；**`errorCode` regex `^[a-z0-9][a-z0-9_.:-]{0,99}$/i`＋長度**（擋不可見字元/換行/超長）；**成功文案不說「已送出」**（＝failed→pending「移回待送佇列，等下次 dispatcher 送出」）、requeue 後 alert 不保證立即綠；**相對時間用 server `snapshotAt`**（非 `Date.now()`，避免 hydration 漂移）；body 偷帶 `adminId`/`now`/`status` 一律忽略（身分只來自 session）。
- 健康度讀取**不另開 GET route**：server component 直讀，client 以 `useRouter().refresh()` 重新整理（減少面）。requeue manual-only、bounded、只 failed→pending（RPC 原子）；UI 送出鎖鈕防雙擊。
- **新檔**：`app/api/admin/ops/requeue/route.ts`、`app/admin/ops/{page,OpsDashboard}.tsx`。**改**：`server/services/outboxAlertService.ts`（抽 `buildOutboxAlertFromHealth`、`getOutboxAlert` 轉呼叫）、`AdminHome.tsx`（營運狀態卡轉 live）。三 service（health/alert/requeue）與 RPC 邏輯零改。

### 驗證（本回合實跑）
- 靜態：`tsc`／`eslint`／`next build` ✅（新 `/admin/ops`（**ƒ dynamic**）＋ 1 條 `/api/admin/ops/requeue`）。
- 測試：`npm test` **796 / 148 skipped**（新增 17：`buildOutboxAlertFromHealth` 同 snapshot／同 now 驅動 stale+backlog、`getOutboxAlert` 只讀一次 health；requeue route 401/415/413/403、**`max` 0/-1/1.5/501→400、500→ok、未帶→用預設**、**`dryRun:"false"`→400**、`errorCode` 非字串/超長/非法→400/trim 空→null、dryRun fail-safe、**偷帶 adminId/now/status 不進 service**、throw→500）；`RUN_DB_TESTS=1` **944**；`db:verify` **31/31 不變**。
- **實機 E2E**（dev + curl，psql 造 outbox 列）：登入 → `/admin/ops` 空佇列正常 → 插一筆 `failed`（`last_error='e2e_test_error'`）→ 頁面 alert 紅、失敗分類含該 code → 死信重送**預覽** wouldRequeue=1（psql 仍 failed）→ **確認重送** requeued=1 → psql 驗 status=`pending`（failed→pending，不硬性斷言 alert 轉綠）→ hardening（401/415/403/`max`0·501→400/`dryRun:"false"`→400/`errorCode` 非法→400）→ 無 session 307 redirect、首頁卡轉 live。E2E 造列＋admin 清除；**dev server 用具體 PID 停止**。

---

## 6.34 Phase 8 Slice 7 — PII retention job（決行 90 天清 pending_binding 三欄，本次完成）

Phase 8 **必收項**第七刀（plan mode ＋ 外部審查一輪，**rev 1 2 必修 + 4 補強全數採納**）。範圍＝實作 [binding-ops.md](binding-ops.md)「PII 保留」政策：`pending_binding` 決行（approve/reject）**90 天後**清 `claimed_phone`/`claimed_name`/`submitted_code`，**保留** `claim_source`、時間戳、`status`、`approved_user_id`、`rejected_reason`、`decided_by_admin_id`。**排程型 job**（cron-eligible，比照 dispatch——PII 不應因沒人跑 CLI 而滯留）＋ dry-run CLI。**Migration 0027**（db:verify 31→**32**）。無 Admin UI（internal job-secret 邊界）。

- **Migration 0027**：(1) `pending_binding_claim_shape_ck` 加第三合法形狀——**redacted 只允許已決行列**（DB 層保證 pending 永不可被 redact、三欄必須一起清、無半套）；(2) RPC `redact_decided_binding_pii(p_now, p_retention_days, p_max, p_dry_run)`——**全參數顯式防 null**（三值邏輯下 `null < 30` 不會 raise）、`p_retention_days` **硬下限 30**、`p_max` 1–500、dry-run 與 apply **共用同一述詞**（count 不 drift）、dry-run 用 **`p_max+1` 探測**回 `has_more`（不掃全集）、apply 最舊決行先＋`FOR UPDATE SKIP LOCKED`；(3) retention 掃描**部分索引**（`coalesce(approved_at,rejected_at)` where decided＋三欄尚有值——redact 後自動縮）。
- **rev 1 被審查抓到的 2 必修（全改）**：
  1. **GET 預設 apply、POST/CLI 預設 dry-run**：原規劃兩入口都預設 apply——人工 `curl -d '{}'` 漏帶 `dryRun:true` 就直接不可逆刪除。改為 GET（排程入口）無參數→apply、`dryRun=1|true`→preview、`0|false`→apply、**其他值→400**；POST（人工入口）`effectiveDryRun = dryRun !== false`＋非 boolean→400——與 CLI「預設 dry-run、`--apply` 才清」一致；曖昧值**絕不靜默 apply**（與 Slice 6 鏡像：那邊防「誤把 apply 當 dry-run」，這邊防「誤把 dry-run 當 apply」）。
  2. **CLI 移除 `--now`**：任意未來 now 等同把 retention window 縮到 0（與已擋掉的 `retentionDays:1` 同效果）。route 偷帶 `now`/`retentionDays` 完全忽略（不讀取）；窗口只由 env `BINDING_PII_RETENTION_DAYS` 控（**下限 30、非法 fallback 90**——fail-safe 方向＝寧可留久）；測試在 service 層注入 now、實機 E2E 用 psql backdate 種列。
- 另採納：**正好 90 天邊界測試**（述詞 `<=`＝滿 90 天即清；cutoff+1s 不清）、RPC null 防衛矩陣、dry-run 回 **`hasMore`**（`wouldRedact`＝本批 capped 數、backlog 超過一批看得見）、部分索引。
- **新檔**：`supabase/migrations/0027_binding_pii_retention.sql`、`server/services/bindingPiiRetentionService.ts`、`app/api/internal/jobs/redact-binding-pii/route.ts`、`scripts/run-redact-binding-pii.ts`（npm `job:redact-binding-pii`）。**改**：repo＋`redactDecidedBindingPii`、mockRepo、verify_schema #32、`.env.example`（`BINDING_PII_RETENTION_DAYS`）、`vercel.pro.example.json`（每日 03:30 cron 條目）、binding-ops.md（政策→已實作）。

### 驗證（本回合實跑）
- 靜態：`tsc`／`eslint`／`next build` ✅（新 `ƒ /api/internal/jobs/redact-binding-pii`）。
- 測試：`npm test` **813 passed / 154 skipped**（新增 17：env 下限/預設、service dryRun 預設 true、max clamp、hasMore 透傳、DTO 無 PII key；route 401/兩種 secret、**GET 無參數→apply、POST `{}`→dry-run**、`dryRun=yes`→400、`dryRun:'true'|'false'` 字串→400、max 矩陣、**偷帶 now/retentionDays 不進 service**、throw→500）；`RUN_DB_TESTS=1` **967 passed**（新增 6：dry-run 零 mutation＋apply 恰清舊決行列＋稽核欄保留、**90 天精確邊界（正好 90d 清、+1s 不清）**、p_max=1 最舊先＋has_more 探測、constraint 矩陣（pending keyword/LIFF 全清拒、decided 半套拒、decided 全清過）、RPC null/短窗全 raise）；`db:verify` **32/32**（#32 新增）。
- **實機 E2E**（dev + curl + psql backdate 種列）：GET `?dryRun=1` → wouldRedact 正確、psql 確認未動 → **POST `{}` 驗證是 dry-run 而非 apply** → CLI `--apply` → psql 驗三欄 NULL＋稽核欄保留、fresh/pending 不動 → 重跑 0 → hardening（無 secret 401、`dryRun=yes`→400、POST `dryRun` 字串→400、max 0/501→400）→ 種列清除。

---

## 6.35 Phase 8 Slice 8 — 牧養 alert 處理 + 現場 PIN 管理 UI（本次完成）

Phase 8 最後一刀（plan mode ＋ 外部審查一輪，**rev 1 3 必修 + 5 建議全數採納**）：AdminHome 僅剩的兩張 PLANNED 卡轉 live。**Migration 0028**（db:verify 32→**33**）。

**A. 牧養關懷（`/admin/pastoral`）**——0008 預留的「未來 Admin resolution flow」實作：
- **Migration 0028(a)**：`pastoral_care_alerts` 加 `resolved_by_admin_id`→admin_accounts（比照 0025 `decided_by_admin_id`；舊 `resolved_by`→users 永 null）＋`counter_reset boolean`（本次結案是否同時歸零——alert 列本身＝政策要求的稽核軌跡，不建 greenfield audit_logs）＋note 長度 ck（1–200）＋**resolution shape ck**（open 列不得帶任何 resolution 資料、resolved 必有 resolved_at——防半套稽核列）。
- **RPC `resolve_pastoral_alert`**：FOR UPDATE＋status guard（併發雙 resolve 恰一方成功、另一方 typed `already_resolved`）；可選 `p_reset_counter` **同 transaction** 歸零 `user_penalties.consecutive_no_show`（無列 no-op；**penalty_score 永不動、不寫 outbox**——關懷非懲罰）；全參數顯式防 null。
- **清單**：open（最舊優先，上限 100）＋近期已處理（上限 20、無無界載入）；**同時顯示開立時快照（trigger_count）與目前計數**——後者走獨立 `getPenaltyCountersForUsers` 查詢（**LEFT JOIN 語意：無 penalty 列顯示「無計數資料」，alert 不得消失**，rev 1 必修 #3）；resolved 處理者 username LEFT JOIN（帳號消失→「—」）。DTO 僅姓名/次數/日期/備註。
- **UI**：處理 dialog 顯示 target 姓名＋政策提示（關心非懲罰、先聯繫再結案）＋歸零 checkbox（預設不勾，說明「歸零→再連 4 次才提醒；不歸零→下次未到立即再開」）；**note 敏感處理**：不 log/不進 URL/純文字 JSX/無匯出。route 回應誠實對映：resolved→200、already_resolved→**409**、not_found→**404**（絕不 ok:true 配未執行）；resetCounter 非 boolean→400、缺省 false（漏參數絕不歸零）；adminId 只來自 session。
- resolve 後部分唯一索引釋放——同人可再開新 alert（測試釘住）。

**B. 現場 PIN 管理（`/admin/staff-pin`）**——取代 CLI `staff:set-pin` 成正式路徑（CLI 降為緊急備援）：
- **當週/下週兩卡，一律台北日曆**（rev 1 必修 #1）：新純函式 `lib/staffPinSchedule.ts` `getStaffPinManagedSundays(now)`（currentSunday=最小週日≥taipeiToday、週日當天全天算當週）——**不用 `getActiveEvent()` 定義當週**（其 latest-non-finalized 語意會把未 finalize 的上週誤標當週；它只留給 Staff 登入流程）。page 與 route 共用同一 helper。
- **PIN expiry 新契約**（rev 1 必修 #2，blocker）：`staffPinExpiry = max(now+12h, 該主日結束台北=次日 00:00+08)`——提前數天發的下週 PIN 保證可用到該主日（舊 `now+STAFF_SESSION_TTL_HOURS(12h)` 契約對提前發行必失效）；expiry 全 server 算、route/CLI 零 expiry 參數；UI 以台北時間顯示。
- **PIN server 隨機產生（`crypto.randomInt` 補零 6 碼）、只顯示一次**（Slice 3 一次性密碼衛生：任何後續動作即清）；`staff_sessions.created_by_admin_id`（0028(b)）記發行者。**替換=原子解鎖**（既有 upsert 行為，測試釘住）；**解鎖與替換語意分離**——解鎖保留原 PIN 只清鎖定、不回明文（無法復原）。
- **{eventId, sunday} 雙重核對**（rev 1 建議 #4）：event 存在、event.sunday==送入 sunday、sunday ∈ 管理視窗（**過去 event 天然不可發**）；已有 PIN 時二次確認（顯示現有 expiry＋「舊 PIN 立即失效」警語）。

### 驗證（本回合實跑）
- 靜態：`tsc`／`eslint`／`next build`（新 `/admin/pastoral`、`/admin/staff-pin` ƒ dynamic＋3 條 admin route）。
- 測試：unit 新增 **34**（日期矩陣含週日當天/跨月/跨年/**台北≠UTC**、expiry 三情境；pastoral list LEFT-JOIN null/hasMore 分開/note code points 200-201/DTO 無 PII；resolve route 200/409/404 對映、偷帶 adminId 忽略；staff-pin PIN 恆 6 碼含前導零、雙重核對矩陣、不呼叫 getActiveEvent、unlock 不回 pin）；DB 整合新增 **13**（pastoral 9：不歸零/歸零/無 penalty 列仍列出/併發雙 resolve 恰一方/resolve×settlement 併發無 lost update/shape+note ck/RPC null 矩陣/resolve 後可再開；staff-pin +4：提前發 PIN 於該主日可登入＋expiry 契約＋created_by_admin_id、替換即失效＋解鎖保留原 PIN、併發雙發恰一組可登入、過去週日拒發）；`db:verify` **33/33**（#33 新增）。
- **實機 E2E**：見驗證段（牧養 resolve 全流程 psql 驗證＋PIN 發行→真 staff login→鎖定→解鎖→替換）。

---

## 6.36 Phase 9 — Production deploy ＋ demo-complete on prod（本次完成，Phase 9 收官）

Phase 9 ＝交付前把 prod 站起來，並在**真 prod stack、開發者自己的 OA** 上跑完整 demo（兼 deploy rehearsal）。4 刀，每刀 plan mode ＋外部審查。**Prod 座標**：`https://parking-omega-one.vercel.app`（Vercel Hobby）＋ Supabase `ybhszryuvoutkzkixsbk`（Tokyo）。教會端（真 OA/真 token/真會友/文案 sign-off）＝交付後 ops，整理入 [prod-deploy-runbook.md](prod-deploy-runbook.md) §8/§13。

**切片**：Slice 1（#27）schedulability（`ensure-weekly-event` job＋五 route eventId 自解析）；Slice 2（#28）deploy prep＋雲端 bootstrap（catalog-only `verify_schema_prod.sql` 26 斷言、runbook）；Slice 3（#29）LINE/LIFF 接線＋**11 個 cron-job.org 排程**（runbook §6）；Slice 3.5（#30–34）三端深→淺綠 UI polish；Slice 4 prep（#35）合成 cohort fixture＋runbook §12/§13（ops/docs-only）。

**Slice 4 走查（本回合實跑，2026-07-15，runbook §12.1–12.3 逐步引導）**：6 位合成 P2 cohort（`DEMO` marker、保留 09 號段、`DEMO0x` 車牌，過正式 validator）＋開發者自己的 LINE 綁定身分為 live member，在**遠期專用 demo event**（`2026-12-27`，`blocked_spaces=21`→effective capacity 2）跑完整業務鏈。結果 **Production business-chain PASS；UI coverage 有明確例外**（Member apply／offer-confirm 兩個按鈕未在 prod 操作、由 automated tests 覆蓋，見下表與發現 1）：

| 驗證面 | 結果 |
|---|---|
| Admin import | Prod PASS |
| Allocation／substitution／release／settle／pastoral | Prod PASS |
| Real LINE delivery | Prod PASS |
| Member LIFF auto-login／status rendering | Prod PASS |
| Member apply/cancel button | Prod 未操作；automated tests covered |
| Member offer-confirm button | Prod 未操作；internal formal route used；automated tests covered |
| Staff UI | Prod PASS |

business-chain（ops 正式路徑驅動）逐步結果：
- Admin 匯入（6 insert＋dev update、無 conflict）→ `apply_reservation` RPC 建 7 筆（顯式 `p_now` 定序）→ `friday-allocation`（`allocation_order` 符預期：甲/乙 approved、**dev waiting rank1**、丙丁戊己 waiting）→ 取消甲 → 遞補 offer 落 dev → dev 確認→approved → **reminder（先於 release）** → `release`（`released:2`，dev＋乙→`released_late`）→ Staff PIN 登入 → **補點名 dev**（`released_late→attended_after_release`）／walk-in／**請移車**（dev）→ 結束當週點名（settle＋finalize，乙→`no_show`）→ pastoral 三段（seed `consecutive_no_show=3`＝合法歷史準備 → settle 賺第 4 → alert `trigger_count=4` → `/admin/pastoral` resolve）。
- **dev-targeted 6 則通知全部真機實收**（`reservation_waiting`/`offer_2hr_confirm`/`reservation_approved`/`p2_arrival_reminder`/`reservation_released`/`move_car_request`，皆 `sent=t`＋LINE 收到）。synthetic（null `line_id`）**13 筆 `no_line_id` failed ＝預期**（同真實「已匯入未綁定」會員；`last_error` 為 sanitized code、零 PII）；走查窗暫停 `outbox-alert` cron 避免自我告警轟炸。
- **PII leak check：PASS with one documented observability limitation**（不宣稱 Vercel runtime logs 已完成全量零命中掃描）：
  - **Layer A1 — `notification_outbox.last_error`：PASS**，僅 `no_line_id`，零 raw PII。
  - **Layer A2 — Vercel production runtime logs：NOT FULLY SEARCHABLE**（Hobby observability 視窗限制，未宣稱完成全量 log scan）。
  - **Compensating evidence**：走查期間觀察到的 production responses，加上 test-suite leak-scan 斷言（log/error payload sanitization 覆蓋）——為補償控制，非取代 production log scan。
  - **Layer B — role boundaries：PASS**（Member 自己卡／Staff 點名表／Admin 各 surface 觀察無禁見欄位外洩）。
  - **Definition of done 記法**：`last_error scan PASS` ／ `runtime-log full-text scan unavailable` ／ `compensating controls PASS`（誠實記錄觀測限制，非走查失敗）。
- **A1 清理已執行**（runbook §11 A1 可打勾）：合成 cohort ＋開發者測試身分以 FK-safe **stop-gate** 一次清除——drain 確認→逐表 preview→單一 transaction 15 表 FK 序刪除（DELETE 數與 preview 完全吻合）→歸零查詢（marker/phone/plate/`line_id`）**全 0**、`any bound users(line_id) left=0`→demo event 刪除→**07-19 pristine**（`open/23/0/0`、0 reservations，＝Step 0 baseline）→`outbox-alert` 回 healthy(200)→11 cron 全恢復。

**關鍵發現／偏離（走查實測，未來教會 walkthrough 需知）**：
1. **Member／Staff UI 只能觸及 nearest-upcoming event**（member apply 純 server 解析 `getMemberEvent`；staff login 走 `getActiveEvent`＝latest non-finalized）→ 遠期 demo event 的建 reservation／取消／offer-accept 一律走 **ops 正式路徑**（`apply_reservation` RPC、`/api/internal/reservations/{cancel,offer}`），非 UI 按鈕。故 **member-apply UI 與 offer-accept UI 只驗到 auto-login＋狀態卡呈現**（Option A：07-19 未 allocate/finalize、維持 pristine）；UI 按鈕本身由本機測試套件覆蓋。
2. **`getActiveEvent`＝latest non-finalized**：遠期 demo event（12-27 晚於 07-19）恰成為 staff-active event，故 demo PIN 可登入、roster 顯示 demo cohort（此次成立；若 demo event 早於真 upcoming 則不成立——教會實跑時須留意）。
3. **07-19 帶 Slice 3 遺留的 no-op `friday_allocation` job_run** → member 端顯示「本週登記已截止」（正常、非 bug）。
4. **通知有 ~2 分鐘 dispatch 延遲**（batch dispatch，每 2 分一輪）；可接受，若要更即時可縮短 cron 間隔（tuning backlog）。

**安全事故（已處理）**：走查中使用者一度把 3 個 prod secret（Supabase service-role key、DB 密碼、`JOB_TRIGGER_SECRET`）貼進對話 → **立即全部輪替**（Supabase API key roll＋DB password reset＋`JOB_TRIGGER_SECRET` 重生並更新 11 個 cron header＋Vercel Production env）。教訓同 Slice 3 §6.6：secret 只進 Supabase/Vercel/cron-job.org UI 與本機 shell，**絕不貼進對話**。

**UX backlog（走查使用者回饋）**：LINE 通知純文字、**無 deep-link 回 LIFF member 頁**（UX 不佳）→ 建議通知模板附 LIFF URL，讓一觸開狀態卡（交付前 polish，非本刀範圍）。

**驗證（本回合實跑）**：走查逐項 prod 打勾（見上）；repo 面 Slice 4 prep（PR #35）新增合成 CSV fixture＋sibling README＋`.gitignore` `/.local/`＋runbook §8/§12/§13，`tsc`／`eslint`／`vitest`（904 passed）全綠，無 app code／schema／migration 改動。**Phase 9 到此收官**；交付前 checklist 見 runbook §13。

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

## 8. 測試與驗證狀態

分兩層記錄，避免混時間語意：**里程碑快照**＝歷史證據（日後每刀不覆寫）；**Current HEAD**＝最近一刀實測。

### 最新完整里程碑快照：Phase 9 收官（2026-07-15）

| 項目 | 結果 |
|------|------|
| migrations | `0001–0028` |
| `npm run db:verify` | ✅ **33/33** schema 斷言 PASS |
| `npm test`（不接 DB） | ✅ **904 passed**（§6.36 記載） |
| production demo walkthrough | ✅ PASS（限制見 §6.36） |

> 出處：§6.36（Phase 9 收官）；`db:verify 33` / migration `0028` 由 Phase 8 最後一刀（§6.35）帶入。

### Current HEAD 最近驗證：Wave 2A-3（#15 稽核記錄 retention purge，PR #43 / squash `5db33bc`）

| 指令 | 結果 |
|------|------|
| `npx tsc --noEmit` / `npx eslint .` | ✅ exit 0 |
| `npm test`（不接 DB） | ✅ **1277 passed** |
| `RUN_DB_TESTS=1 npm test` | ✅ **1560 passed**（129 檔，**同一 DB 連跑兩次不 reset 皆過**） |
| `npm run db:verify` | ✅ **44**（42→44：#38 purge fn 鎖定＋owner-equality；#38b 逃生口行為——fn 刪得掉、直接 service_role 即使 grant＋GUC 仍擋） |
| `verify_schema_prod.sql`（catalog-only） | ✅ **32**（31→32） |
| `npm run build` | ✅ `ƒ /api/internal/jobs/purge-audit-logs` |
| 手動實跑（dev + curl，`http://[::1]:3000`） | 未帶 secret→**401**；dry-run 回 `retentionMonths:24`＋`deletedBefore`≈24 個月前；**smuggled `now=2100`＋`retentionMonths=1` 被整條路徑忽略**（DB 時鐘＋24 月下限）；seed 一列 25 個月前的列→HTTP apply→`deletedCount:1`＋恰一列 marker（`keys=deleted_before,deleted_count,retention_months`）；zero-delete apply→**不寫 marker** |
| DB schema | **migration `0034`**（`0001–0034`） |

> **這一刀是 #15 的最後一塊**：稽核記錄從「append-only、無刪除路徑」變成「有 24 個月邊界、可證明、可稽核的保留政策」，並讓 `/admin/audit` 那句對幹事的文案從「將於後續啟用」翻成平述。#15 三刀（2A-1/2A-2/2A-3）全完成 ⇒ **「強烈建議交付前」清單清空**。
> - **審查必改 1 是真的安全洞，我照抄前例照出來的**：我把 binding-PII 的 `p_now` 參數抄進 purge RPC，但兩者不對等——早刪 PII **朝隱私**（良性）、早刪 append-only audit 是**不可逆的證據銷毀**。RPC 授權給 service_role、可直接呼叫 ⇒ `p_now='2100'` 就洗掉全表，route 忽略外部 `now` 保護不了 DB。故 `purge_audit_logs` **不收 `p_now`、自己讀 `now()`、24 月下限在 SQL 內釘死**。移除 `p_now` 後**必改 3 隨之成立**：service 再也無法自算 cutoff（`new Date()` 與 DB 時鐘不同步），cutoff 必須由 RPC 回傳——審查抓到的是一個真實內部矛盾。（[[dev-lessons-retrospective]] 30/31）
> - **逃生口＝雙鎖，且一把是正確性不只是安全**：改 `private.audit_logs_block_mutation` 只對 `DELETE` 開一道縫，需同時滿足 (1) 交易域 GUC `audit.allow_purge='on'`（只有 purge fn 用 `set_config(...,true)` 開）＋ (2) `current_user` ＝ `audit_logs` owner。**PG 17.6 實證**：SECURITY DEFINER fn 內 `current_user=postgres`（owner，過鎖2）、直接 service_role delete 時 `current_user=service_role`（≠owner，鎖2 擋）——連「trigger 在 definer 的 DELETE 中被觸發時 current_user＝owner」都先跑 probe 證明才寫 migration。鎖2 讓即使未來重演 `0004` blanket grant 也刪不掉；`UPDATE`/`TRUNCATE` 恆擋。**owner-equality 是正確性依賴**：若 fn owner ≠ table owner，連合法 purge 都永遠過不了鎖2、機制靜默失效 ⇒ verifier 釘死（審查要求）。（[[dev-lessons-retrospective]] 32/33）
> - **DELETE 後主動 `set_config(...,'off',...)` 關回**，不只依賴交易結束——同一交易內 purge 之後任何 DELETE 都會再被擋（專門測試釘住）。
> - **只在真的刪了才寫 marker**：頭 ~24 個月每月都刪 0 列，若每次記「purged 0」會**灌爆 log 且那些列 retention-exempt＝永久累積**（`0030:369` 的 no-op 原則）。`audit.substrate_enabled`／`audit.retention_purge` retention-exempt。marker metadata 只有 `deleted_before`/`deleted_count`/`retention_months`（無 ID、無被刪列資料）。（[[dev-lessons-retrospective]] 35）
> - **service 有界迴圈排 backlog**：cron 每月只跑一次，單批 500 若遇大 backlog 要半年才追上 ⇒ service 迴圈呼叫（各批獨立交易、鎖只短暫持有）到 `has_more=false` 或達上限（≤20 批／≤10k），達上限仍有殘留就回 `hasMore:true`＋warning，不默默等下個月。
> - **DB test 全程 raw-pg `BEGIN…ROLLBACK`**（硬要求）：purge 謂詞是全域 `created_at < cutoff`，若 commit＋未來時間會**真的刪掉共用 DB 上其他 suite 的 append-only 列**（比 [[dev-lessons-retrospective]] 23 更糟——真刪、append-only 無法 teardown 補回）。連「證明 TRUNCATE 被擋」都包在 rollback 交易裡，萬一沒擋住還能救整個共用 DB。（[[dev-lessons-retrospective]] 34）
> - **UI 文案翻面的部署硬前置**（審查必改 6）：`AUDIT_BOUNDARY_NOTE` 改成「紀錄保留 24 個月，逾期後由定期維運作業清除」是在宣稱一個**正在運作的作業**；程式碼可 merge，但這句到真正有幹事在看的 prod 之前，必須先確認 prod purge cron 已設好（`vercel.pro.example.json` 有範例、但範例不等於已設定）⇒ [prod-deploy-runbook.md](prod-deploy-runbook.md) §13 加了一條 go-live 硬前置。現況 prod 為 demo、尚無真會友，merge 本身不構成對真使用者的提前宣稱。

### 前一刀：Wave 2B-2b（#10 P2 覆核寫入路徑，PR #42 / squash `c536b01`）

| 指令 | 結果 |
|------|------|
| `npx tsc --noEmit` / `npx eslint .` | ✅ exit 0 |
| `npm test`（不接 DB） | ✅ **1253 passed** |
| `RUN_DB_TESTS=1 npm test` | ✅ **1525 passed**（126 檔，**同一個 DB 連跑兩次不 reset 皆過**） |
| `npm run db:verify` | ✅ **42**（40→42：#37 兩支 RPC 的 grant/`search_path`/pair CHECK/衍生到期 CHECK/SQL 內 Taipei 日期；#37b no-row 建列＋核准即治理＋撤銷列不可覆核） |
| `verify_schema_prod.sql`（catalog-only） | ✅ **31**（30→31） |
| `npm run build` | ✅ `ƒ /api/admin/eligibility`、`ƒ /admin/members/[id]` |
| 手動實跑（dev + curl，`http://[::1]:3000`） | 未登入 POST→**403**；核准**一位沒有 eligibility 列的一般會友**→`{"ok":true,"noop":false,"reviewVersion":1}`、列為 `approved / v1 / governed=true`；stale version→**409**；`expiry_not_settable`→**422**；標記已覆核兩次→**兩列 audit**；**再用真的預覽路徑匯入一份點名該會友的 CSV → `governedRetained`，資格未動** |
| DB schema | **migration `0033`**（`0001–0033`） |

> **這一刀解除 #10 的交付阻擋**：幹事終於能不靠 CSV 核准／撤銷 P2，而 CSV 也不再能推翻他們的決定。2B-2c（佇列列內操作）是便利化，**不阻擋交付**。
> - **外部審查的必改 1 才是這一刀的本體**。rev.1 的 RPC 對「沒有 eligibility 列」的人回 `not_found` ⇒ 只能**編輯**已經被 CSV 設成 P2 的人 ⇒ 幹事仍需 CSV、**阻擋原封不動**，而測試會全綠。而**我在 2B-2a 自己的交接文件裡寫過這個事實**（「7 位會友根本沒有 eligibility 列」）然後照樣設計過去；我自己的 precedence matrix 也早就承認 `no row → insert`。**一般會友的表示法就是「`users` 有列、`user_eligibility` 沒列」**，這不是缺漏。
> - **鎖 `users` 不鎖 eligibility 列**：eligibility 列不存在時它存在，這正是它能序列化「兩個幹事同時首次核准同一人」的原因。沒有它 ⇒ 兩邊都讀到 no-row ⇒ 一邊撞 `user_eligibility_pkey` unique violation ⇒ **raise ⇒ 連記錄這次拒絕的 audit 列一起 rollback**（`0030` 的規則）。兩個交錯 transaction 釘住：B **block** 在 A 的鎖上，然後拿到型別化 `conflict` + `actual_version: 1`，**不是 500**。實查：repo 今天沒有任何地方 `users FOR UPDATE`，故無既有鎖序可反向。**不需要 sentinel**——`expected_version = 0` 同時涵蓋「沒有列」與「匯入建的列仍在 v0」，RPC 在鎖內重讀、由真相決定。
> - **治理邊界收斂成單一欄 `reviewed_at is not null`**（使用者提的三條件 OR 的收斂）＝「**有人做過決定**」。不用 `review_version > 0`＝「**RPC 寫過**」：那是 **proxy**，第一支修資料的 migration bump 版本時就會分歧，把沒人碰過的列凍住。`review_version` 純粹是樂觀鎖。pair CHECK 擋 `reviewed_at`/`reviewed_by` 漂移。**⇒ 核准必須在同一個 transaction 寫 `reviewed_by/at`**，否則核准不算治理、下一份 CSV 就會覆蓋它，precedence 整個失效。
> - **匯入 precedence**：`no row + CSV P2 → insert approved`／`unreviewed → approved`／`approved 但未經人工覆核 → 照舊 refresh`／**`approved 且已人工覆核 → retained_governed`、整列不動**／`revoked → retained_revoked`（2B-2a）／`CSV 未列 → 完全不碰`。測試釘的是 **byte-for-byte** 而非「還是 approved」——**把日期 reset 掉的 refresh 一樣是推翻了決定**。**依親一起凍結**：它們正是 `p2_child_birthdate` 推導的依據，凍來源卻寫依親＝重新製造 #10 要消滅的雙重真相；`users`／`vehicles` 照常更新（名字不是治理）。**回報而非默默略過**——**默默略過與默默覆寫是同一個失敗的兩面**。後果在 UI 明講（沒人從按鈕字面推得出來）：**每一次「標記已覆核」都永久讓該會友退出 CSV 批次更新**。
> - **「不可覛改」從 UI 承諾升級成 DB 保證**：2B-2a 只能明寫殘留（「公式不進 SQL 就沒有 CHECK 擋得住」）。這一刀關掉它——規則是 `IMMUTABLE`-safe ⇒ CHECK 可以呼叫 `child_companion_valid_until(p2_child_birthdate)`。**用 raw `pg` client（不是 app）證明 psql 自己也改不動幼兒到期日**。RPC **呼叫該函式**而非再抄第三份；parity test 改成驅動**活的**函式，不再是 0032 凍結的字串。
> - **Taipei 今天在 SQL 內算，且永不由呼叫端傳入**：**DB session 是 UTC** ⇒ `current_date` 是 UTC 日期 ⇒ 台北 00:00–08:00 之間它是**昨天**，兩個 past-date guard 會**每天有 8 小時**拒絕合法的當日覆核日期，而任何下午寫的測試都看不到。`(now() at time zone 'Asia/Taipei')::date` 從絕對時刻換算，**不管 session 設定都對**——這正是 `current_date` 不對的原因。`verify_schema` 同時釘住 `Asia/Taipei` 的存在與 `current_date` 的**不存在**（先 strip `--` 註解：該斷言第一版正是被我自己解釋這個陷阱的註解絆倒）。
> - **⚠️ 實跑抓到一個我的單元測試已經把它奉為正確的 bug**：service 對 `child_companion` 會**默默把 `validUntil` 抹成 null** ⇒ `expiry_not_settable` 這個 guard **透過 route 永遠到不了** ⇒ 送了到期日的呼叫端拿到 **silent 200、值被丟掉**——**正是那個 guard 存在要防的「默默忽略」行為**。而我寫的單元測試斷言這個 bug 是對的（「never sends an expiry for child_companion」）。只有驅動真的 route 才抓得到。教訓寫進測試名：**「當下游有 guard 專門負責告訴呼叫端他錯了，service 就不可以替他『修正』輸入。」**
> - **其他值得記的決定**：① `mark_p2_reviewed` 拒絕的是 **`<> 'approved'`（allowlist）**不是 `= 'revoked'` ⇒ #11 的 `pending`/`rejected` 會 fail closed；否則它會立刻把 revoke 剛清掉的 `p2_review_date` 填回去，一個動作就破壞該 invariant。② **`window_inverted` 是 422 不是 409**：409 等於叫幹事重新整理再試，而那會永遠一樣失敗；**只有真正的版本競賽才是 409**。③ **核准必須給 `p_next_review_date`**，否則新列 `p2_review_date = NULL`、佇列永遠不再問 ⇒ 系統記著「幹事已覆核」卻從未排下一次。④ **真 no-op 不記錄覆核**（`reviewed_at` 保持 null ⇒ 匯入仍可 refresh），這是刻意的，也正是 UI banner 存在的理由：幹事對一列沒改動的 CSV 資料按「儲存」，不可以以為自己覆核過了 ⇒ 兩個分開的動作，且「標記已覆核」**只在 approved 列出現**（鏡射 RPC 的 guard，故不存在只會 422 的按鈕）。
> - **三個既有測試要改，都不是隨手改**：① `audit-log.db.test.ts` 把「前 100 列裡最舊的」當成時間軸的盡頭——但 `audit_logs` 是 append-only ⇒ **沒有任何 suite 能清掉自己的痕跡** ⇒ 這一刀把表推過 100 列後它就在**從中間分頁**；改用比任何列都舊的 cursor：同樣的性質，不再假設歷史有多長。② `p2-review-model` 的 `reviewed_by` FK 測試現在要一併設 `reviewed_at`，否則新的 pair CHECK 先擋下、測試就在證明別的事。③ 它的 marker query 是 `like 'p2_eligibility%'`，會連這一刀的寫入動作一起撈到 ⇒ 改成精確名稱。
> - **未做（follow-up）**：**2B-2c** 佇列列內操作（會把整張表變成 client component，`BindingReview.tsx` 的先例；`not_yet_effective` 屆時可能該自成一區而非併進 `upcoming`） · **已撤銷者的重新評估刻意不做成佇列**——教會若要重看撤銷案，那需要自己的 workflow，不是 P2 到期佇列裡的一條 lane · `lib/p2Reason.ts` 抽出了兩頁複製的 label map；**CSV 的 alias 詞彙（`短期不便`）與 UI 的顯示 label（`行動不便（短期）`）是不同的東西，刻意不合併**。

### 前一刀：Wave 2B-2a（#10 P2 資格模型，PR #41 / squash `155c7f7`）

| 指令 | 結果 |
|------|------|
| `npx tsc --noEmit` / `npx eslint .` | ✅ exit 0 |
| `npm test`（不接 DB） | ✅ **1221 passed** |
| `RUN_DB_TESTS=1 npm test` | ✅ **1463 passed**（124 檔全過，**同一個 DB 連跑兩次不 reset 皆過**——見下方 flake） |
| `npm run db:verify` | ✅ **40**（37→40：#36 結構／#36b 衍生欄行為／#36c audit sanitizer 擋生日） |
| `verify_schema_prod.sql`（catalog-only） | ✅ **30**（28→30） |
| `npm run build` | ✅ `ƒ /admin/eligibility` 仍 dynamic |
| DB schema | **migration `0032`**（`0001–0032`） |

> **#10 拆兩刀（與使用者共同決定）：2B-2a ＝模型、無 UI 無寫入 RPC；2B-2b ＝ RPC＋UI。** 對照 2A 的拆法。**幹事目前仍不能自行核准/撤銷資格**，交付目標要等 2B-2b。
> - **as-of date 是這一刀的全部重點**。兩個 reader 問的是**不同問題**，各自的日期**都對**，不該統一：`priority.ts` 問「這位會友對 **D 這個主日**是不是 P2」→ 用 event 的 `sunday_date`；review queue／明細 badge 問「這筆**現在**要不要人看」→ 用今日。**壞掉的不是日期而是 predicate 重複兩份、且沒有任何地方講明用哪一天**。故收斂成 `isWithinEligibilityWindow(w, asOf)`：`asOf` **必填**、模組**不 export 任何 clock**，看 call site 就知道在問哪個問題。
> - **所以 `p2_eligible` 不含任何日期**（generated from `review_status = 'approved'` **而已**）。若它代表「現在有效」，就會把**寫入者**當時用的 as-of 烘進去、兩個 reader 一起繼承：週三核准、`valid_from` = 週六 ⇒ 寫入時算出 `p2_eligible=false` ⇒ 會友週三為**週日**申請時被判 **P3**，但那個週日他其實有資格。**不會拋錯，只是安靜地掉一級**。危險方向專在**起始**端：`priority.ts:30` 本來就自帶 `valid_until` 檢查（結束端有安全網），**起始端沒有** ⇒ 本刀補上、且比對 `sundayDate`。**附帶好處**：欄位不含日期 ⇒ **SQL 裡沒有日期運算** ⇒ 不像 2B-1 產生雙公式。
> - **與 triage 規格四處刻意分歧**（詳見 `0032` 標頭，triage #10 列已同步）：① 不加 `effective_until`——`p2_valid_until` 已是截止日且是 `priority.ts` 讀的權威，再加一個正是該列要消滅的雙重真相；只加 `p2_valid_from`（**不改名**，40+ 呼叫點、只換到對稱、且改名本身是 deploy 風險）。② `reviewed_by` FK `users(id)`＝**會友表**，但覆核者是 `admin_accounts.id` ⇒ **這欄從來存不進自己的覆核者**（實查：`0001` 定義至今**零 writer**，故「最近覆核」永遠是 `—`）；#10 給它第一個 writer，故改指 `admin_accounts`。**這裡能用 FK 而 `audit_logs.actor_id` 刻意不用**，因為 admin 帳號是 soft-disable 永不 hard-delete（`0026`，`0030` 的 actor 解析正是靠這點）。③ enum **三態**（見下）。④ **不加 `updated_at`**（否決外部審查給的兩個方案）：樂觀鎖是 `review_version`（`0022:118-120` 明說 counter「不會像呼叫端傳來的 timestamp 那樣碰撞」），顯示權威是 `reviewed_at`——該欄**沒有消費者**；triage 也寫了 `effective_until`，同樣以「重複既有權威」為由否決。
> - **`unreviewed/approved/revoked` 三態（外部審查要求，接受但更正理由）**：`revoked` 必須代表**有人撤銷過**，把舊 `p2_eligible=false` 回填成 `revoked` 是憑空捏造。**審查描述的「大量會友被鎖死」情境不成立**（實查：`p2_eligible=false` **0 筆**、**7 位會友根本沒有 eligibility 列**——`import_member` P2 路徑一律寫 `true`、一般路徑**不寫列**，故 false 列無任何 writer 能產生）。但**修正仍必要**，理由是審查沒講到的三點：① 該數字會寫進 **append-only audit marker**＝永久捏造（2B-1 同款錯）；② `revoked` 是 2B-2b 新增列的**錯誤預設**；③ **migration 不可對「自己相信不存在」的資料做錯誤標記**——我自己的 plan 引用了 `0031` 的 pre-flight idiom 卻沒套用在這裡。
> - **幼兒陪同到期改學年度制（使用者拍板：入學年 +6、既有一併重算、不可覛改）**：舊規則 `youngest + 5 年`**到日**，根本不是 cutoff 規則、會在學期中途到期。新規則 = 入學前的 **8/31**；**9/1 含當日屬前一屆、9/2 起屬下一屆**（`2019-09-01 → 2025-08-31`、`2019-09-02 → 2026-08-31`，差整整一年，是 cohort 規則的本質不是 bug）。**只會延長不會縮短**，migration 內若縮短就 `raise`，marker 記 `rows_shortened` 讓宣稱可查而非可信。`p2_child_birthdate` 存來源——**不能用 `dependent_birthdate`**，那是 CSV 的 `dependents[0]`（`0029:74`）不必然是最小的。**公式刻意兩份**（TS 權威，因為 **dry-run 匯入預覽必須先顯示推導日期**，SQL 服務不了預覽；SQL 那份是凍結在 migration 的一次性重算），parity test 是唯一緩解。
> - **匯入可以建立資格，但不能推翻覆核**：`0029:9` 只承諾匯入不會 **REVOKE**，沒人擋它默默 **RE-GRANT**——`on conflict do update set p2_eligible = true` 會把幹事撤銷過的人翻回可用、洗掉覆核痕跡、且**自己不寫任何 audit**。現在回報 `retained_revoked`、整列不動，preview 有對應警告。
> - **⚠️ audit sanitizer 擋不住生日（外部審查抓到，實測確認，比看起來嚴重）**：`0030` 的 denylist 是 **exact key match**（它自己的註解就寫了「`job_name` 或 `review_note_present` 不受影響」），帶了 `birthdate` 卻**看不到 `p2_child_birthdate`**。實測 `append_audit_log('{"p2_child_birthdate_from":"2020-09-01"}')` **回傳 row id ＝未成年生日成功寫入**，而 `audit_logs` 的 UPDATE/DELETE/TRUNCATE 已 revoke ＋ trigger 擋 ⇒ **任何人（含 owner）都刪不掉**。**2A-2 的讀取端 registry 救不了這個**：它擋的是「不被**顯示**」，擋不了「被**儲存**」——顯示可挽回，儲存不可。規則設計成**擋值不擋詞彙**（生日型 key **只能放 boolean**），因為單純關鍵字禁令會連 `child_birthdate_present` 一起擋掉、反而逼未來的 RPC 改用更模糊、洩露更多的 key。**2B-2b 的 audit 契約已釘在 `0032` 標頭**。已知殘留（明寫非疏漏）：**推導出的到期日本身會洩露孩子的學年屆別**（生年＋9/1 哪一側）——無法避免，因為被稽核的正是到期日變更。
> - **順手修掉 2B-1 我自己種下的 flake**：兩個 capacity suite 佔用了 `move-car`／`outbox-health` 已擁有的主日（`2099-08-02`／`2099-09-06`），而註解還寫著「owns its own Sundays so it can never collide」——**寫了但沒查**。它們的 event 被稽核過 ⇒ teardown 只能 finalize 不能刪 ⇒ 殘留列會殺掉下一個 INSERT 同一天的 suite，**依檔案順序時而爆時而不爆**（故 2B-1 驗證與我今天第一次跑都是綠的）。改用真正無人使用的 `2099-08-23`／`2099-08-30`，並以**同一個 DB 連跑兩次**驗證。
> - **⚠️ vitest 摘要會騙人**：suite 在 `beforeAll` 掛掉時，它的測試會顯示成 **skipped**，摘要行寫「1445 passed | 7 skipped」看起來像綠的——**要看 `Test Files X failed` 那行**。我差點就據此回報通過。
> - **`date → JS Date → toISOString()` 會位移一天**（node-postgres 把 `date` 轉成本地午夜，`toISOString()` 再扣掉台北 +8 ⇒ `2025-08-31` 變 `2025-08-30`）——parity test 因此對**正確的 SQL** 報錯。與 2A-2 的 cursor 微秒 bug 同源：**DB 日期不該經過 `Date` round-trip**，一律 SQL 內 `::text`。

### 前一刀：Wave 2B-1（#14A 車位容量設定，PR #40 / squash `8de24a0`）

| 指令 | 結果 |
|------|------|
| `npx tsc --noEmit` / `npx eslint .` | ✅ exit 0 |
| `npm test`（不接 DB） | ✅ **1165 passed** |
| `RUN_DB_TESTS=1 npm test` | ✅ **1399 passed**（含新增 37：weekly-capacity 16／capacity-race 3／service 18） |
| `npm run db:verify` | ✅ **37**（35→37：`capacity_version`＋兩個 CHECK＋`set_weekly_capacity` 簽名/grant/`search_path`） |
| `verify_schema_prod.sql`（catalog-only） | ✅ **28**（27→28） |
| `npm run build` | ✅ 路由清單顯示 **`ƒ /admin/capacity`** |
| 手動實跑（dev + curl，用 `http://[::1]:3000`） | 保留·停用 `0→4` 真的落地；**原值重送＝no-op，不寫任何列、不 bump version**；stale version→**409**；砍到低於 2 個 promised→**422** 且該列未動；`/admin/audit` 顯示 **「修改車位容量 · 可分配：23 → 19」**（非「未知動作」） |
| DB schema | **migration `0031`**（`0001–0031`） |

> **Wave 2B-1 ＝ 第一支從零寫的 audited governance RPC**（`set_admin_disabled` 是回頭改的），也是 `docs/prod-deploy-runbook.md` 最後一處「叫維運手打 `UPDATE weekly_events`」的終點。
> - **公式現在刻意存在兩份**。[`0004:5-7`](../parking-system/supabase/migrations/0004_weekly_capacity_view.sql#L5-L7) 明文決定「view 只供 inputs、**不含公式**；算術留在純 `computeCapacity`（**公式單一來源**）」，`deadlines.test.ts:49-51` 還把它釘死。但**跑在 app 的 guard 可被繞過且無法 atomic**，故 RPC 必須用 SQL 重算。兩個決定在各自領域都對 ⇒ 讀取/預覽路徑仍走 `computeCapacity`（`fridayAllocationService:48` 未動），RPC 只為 guard 重算，**唯一的緩解是一份 fixture 表同時驅動兩邊的 parity 測試**（[[dev-lessons-retrospective]] 15：不可默默覆寫既有決定）。
> - **`temp_approved` 算佔位**。[`0006:26-36`](../parking-system/supabase/migrations/0006_cancellation.sql#L26-L36) 在取消的同一句就把 `waiting` 升為 `temp_approved`，而 `apply_offer_resolution` 之後把它翻成 `approved` **完全不檢查容量** ⇒ 只算 `approved` 會讓管理員在週六 offer 窗開著時砍容量、confirm 當下超賣。DB 測試釘住並攤開差距：`promised=2` 而 `approved` 只有 `1`。
> - **`COUNT()` 鎖不住還不存在的列**，所以 guard 的強度＝「**每個**會抬高 promised 的路徑都拿同一把 event row lock」這個主張的強度。故**寫入者清單寫進 migration 而非某人腦裡**：唯一淨增的是 `apply_friday_allocation`，它被 `job_runs 'running'` 擋住，而 event-row lock 正是讓那個 `job_runs` 讀數可信的東西（[`0023:14-21`](../parking-system/supabase/migrations/0023_apply_reservation_rpc.sql#L14-L21)：READ COMMITTED 看不見併發中未 commit 的 `'running'` 列）。**三個交錯 transaction 測試**兩面釘住，含最刁的一個：**未 commit** 的 claim 仍會擋下容量變更，而不是對它隱形。這是**協定不是 DB invariant**——未來任何淨增 promised 的路徑必須先拿鎖，否則 guard 會無聲失效。
> - **`admin_reserved` 摺入 `blocked_spaces`＋`check (admin_reserved = 0)`**（與使用者共同決定）：它本來活在公式裡卻不在 UI 上 ⇒ 只編 `blocked_spaces` 的表單會給出**跟分配器悄悄不一致**的預覽。摺疊**保算術**（每一列、含過去，effective 完全相同；prod-like 資料實證 `23−1−2 → 23−3−0` 皆 20），只失去外賓-vs-停用的歸因，而 triage 早已決定不呈現它。一列 aggregate `system` audit 記錄，`rows_affected` 由 **`GET DIAGNOSTICS` 取自摺疊本身**。
> - **可編輯狀態是 ALLOWLIST 不是 `<> 'finalized'`**：未來的 `closed`/`archived` 不該因為沒人記得排除就默默可編。未知狀態 fail closed。**哪些拒絕要寫 audit 也釘在 migration**：input/stale（`not_found`、`sunday_mismatch`）不寫；治理拒絕寫 `denied`；lost update 寫 `conflict`。
> - **否決審查「把 `reserved_staff` 放進 CHECK」**：它**不是欄位**，是 `weekly_staff_allocations` 上的 count（`0004:13-19`），CHECK 不能 subquery。row-local 那半用 CHECK、跨表那半在 RPC 內。**殘留缺口（直接 INSERT staff allocation 可讓 effective 變負）明寫在 migration 而非藏起來**；目前無任何 app code 寫該表。審查要求的各欄非負 CHECK **早就存在**（`0002:10-12`）——引用，不重複。
> - **兩個 fixture 陷阱值得記住**：① `audit_logs.weekly_event_id` FK `weekly_events` 且 audit 列 append-only ⇒ **被稽核過的 event 永遠刪不掉**（與 `0030` 假設一致，但現在會自我強制）；fixture 改為 reuse＋teardown finalize。② 殘留的 **open** 2099 測試 event 會**默默成為 `getActiveEvent` 的答案**（「最新未 finalized」）並打壞三個不相關 suite。
> - **runbook 的直接 SQL fallback 是「撤除」不是「改寫」**：§12.1 Step 0 現在明說容量是 Admin UI 操作、**不要**直接 `UPDATE weekly_events`。**未採用審查建議的替代文字**（「改用當週/次週 demo event」）——runbook:521-522 要求 demo event **永遠不是真的下個主日**，那樣寫是為了遷就 UI 範圍而彎曲安全規則。改為**記錄真實狀態＝該步驟 blocked**：`/admin/capacity` 刻意只給當週/次週，§12 需要遠期 event，兩條規則接不上 ⇒ **今天沒有任何 audited 路徑可設遠期容量**。
> - **未做（follow-up）**：小型 ops CLI 走同一支 RPC（`set_weekly_capacity` **本身不限主日、只有 UI 限**）——卡在 CLI 無 admin session 而 audit 形狀要求 `actor_id` **＋** `actor_session_id`，與 `scripts/run-binding-approve.ts` 傳 null adminId 是同一個缺口，是設計決策不是一支腳本 · 退休 `admin_reserved`（現已可證明為 0，觸及 `0004`／公式簽名／三個測試檔，自成一刀） · 跨表 invariant（`… − reserved_staff >= 0`）需兩張表都上 trigger，歸屬給「讓 `weekly_staff_allocations` 有 app 寫入者」的那一刀。

### 前一刀：Wave 2A-2（#15 稽核唯讀頁，PR #39 / squash `d2e6890`）

| 指令 | 結果 |
|------|------|
| `npx tsc --noEmit` / `npx eslint .` | ✅ exit 0 |
| `npm test`（不接 DB） | ✅ **1165 passed**（89 檔／193 skipped） |
| `RUN_DB_TESTS=1 npm test` | ✅ **1358 passed**（120 檔全過） |
| `npm run db:verify` | ✅ **35**（**不變**＝本刀 app-only、無 migration，這正是 scope gate） |
| `npm run build` | ✅ 路由清單顯示 **`ƒ /admin/audit`**（＝`force-dynamic` 真的生效） |
| 手動實跑（dev + curl） | 未登入 `/admin/audit`→**307 `/admin`**；乾淨 DB→bootstrap 列顯示「系統／稽核記錄啟用／未回填（紀錄自此開始）」；真實停用一位管理員→該列 actor 顯示 **王姐妹**、對象 **陳弟兄**、已完成／已變更、`操作編號：尾碼 d13d9a`（完整 UUID 在 `title`）；`?cursor=garbage`→**200 最新頁非 500**；古老 cursor→空狀態；HTML 無 `scrypt$`／`password_hash`／`metadata_redacted`；`/admin/bindings` 在 formatter 抽出後仍正常 |
| DB schema | **本刀無 migration**（仍 `0001–0030`） |

> **Wave 2A-2（稽核唯讀頁）＝ #15 的讀取端；至此 #15 只剩 2A-3 retention。**
> - **keyset cursor 而非 offset**（外部審查要求，且複審後我同意——原本主張「與 `/admin/members` 一致」是錯的）：`audit_logs` **append-only 且最新在前**，新列一律插在**頂端** ⇒ offset 分頁「跨頁重複」是**系統性結果不是 race**。名冊按 `display_name` 排、插入位置隨機且罕見，那份容忍**不能移轉**到「時間軸型證據」。附帶好處：keyset **反而更小**——不用 offset 數學、不用 count query、不用 `PGRST103` handler、也**不必動 Wave 1c 的 `parsePage`**。
> - **動工前先對真 PostgREST 驗三件事**（整個 cursor 靠它們）：① `created_at` 回**微秒**（`…40.355854+00:00`），`new Date(ts).toISOString()` 會截成 `…40.355Z`，用它 `created_at.eq` **比對到 0 列** ⇒ cursor 若經 `Date` round-trip 會**默默漏列**（且只有在時間戳相同時才發作，任何沒有 tie 的測試都看起來正常）。故 cursor 存**原字串**、repo **不得 `parseDate`** 這欄、驗證**刻意不用 `Date.parse`**（它「會動」正是問題：會教下一個人以為能轉）。② **supabase-js 會正確 url-encode `or()`**，raw curl 不會（`+` 變空格→PostgREST `22007`）。③ **兩個 arm 都驗過**：同 `created_at`＋較大 id 命中、較小 id 不命中。
> - **metadata 改為 action-owned allowlist**（外部審查要求，同意）：寫入端已是 allowlist＋PII key denylist，但 **denylist 無法知道它沒被告知的事**——未來 RPC 寫 `eligibility_comment: '因罹患…'` 會**原封通過** 0030 的 denylist，generic viewer 就會印出來。兩層獨立 ⇒ 任一有缺口都不致外洩。**時機**：#10 的 metadata 就是資格資料，pattern 必須**先於 #10** 存在。三態固定：known+valid→該 action 自己的 details（＋未認領 key 的**數量**）；known+型別錯→「格式無法辨識」**無數量**；unknown action→**顯示 raw code**（藏列＝讀成「沒發生」）但**完全不顯示 metadata**、亦無數量（數量會被讀成「因權限被隱藏」）。數量**永不含 key 名**。
> - **DTO 根本沒有 metadata 欄位** ⇒ 頁面**不可能**碰到 `metadata_redacted`（型別層保證，非慣例）；另有測試證明 renderer 不會把它洗進 `details`。
> - **現場同工 session 永不解析成人**：測試刻意讓某 admin 的 UUID 與 session id **完全相同**，仍不得顯示姓名、且**根本不查**。**會友 actor/entity 只顯示 type＋ID 尾碼**：#10 要遮罩姓名必須**明確擴充 registry**，而不是從 generic resolver 繼承 PII 曝光（故**刻意不做** `resolveEntityName(type, id)`）。**已刪除的 actor 是正常列不是錯誤**（`actor_id` 無 FK 就是為了讓 log 活得比它指涉的列久）。
> - **文案不得聲稱尚未實作的控制**：2A-3 未上線＝**目前無限累積**，寫死「紀錄保留 24 個月」會是**假的隱私聲稱**。故加「自動清理將於後續維運功能啟用」，並用**測試釘住這句**——**2A-3 上線時該測試會 fail**，強迫刻意更新文案（[[dev-lessons-retrospective]] 15）。
> - `fmtTaipeiDateTime` 抽到 `lib/taipeiDate.ts`（第二個 surface 需要**同一格式**＝當初抽 `MemberTable` 的同一條件）；repo 其餘 4 個 Intl formatter 選項不同、**不動**。
> - **實跑環境雷**（非本 repo 問題但會再咬人）：VS Code Live Preview 佔用 **IPv4 `127.0.0.1:3000`** 提供靜態檔，Next dev 綁 **IPv6 `*:3000`** ⇒ `curl localhost:3000` 會打到 VS Code 得到 404。實跑請用 **`http://[::1]:3000`**。
> - **未做**：filters（依 actor/entity/action）——0030 另兩個 index 已為此存在，但目前列數少，filter UI 是家具；等 #10/#14A 讓 log 有量再說。

### 前一刀：Wave 2A-1（#15 Audit substrate，PR #38 / squash `8513912`）

| 指令 | 結果 |
|------|------|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx eslint .` | ✅ exit 0 |
| `npm test`（不接 DB） | ✅ **1114 passed**（87 檔／188 skipped） |
| `RUN_DB_TESTS=1 npm test`（接本機 Supabase） | ✅ **1302 passed**（118 檔全過） |
| `npm run db:verify` | ✅ **35** 斷言 PASS（33→35：新增 audit substrate 權限/形狀 ＋ trigger 行為） |
| `verify_schema_prod.sql`（catalog-only） | ✅ **27** 斷言 PASS（26→27） |
| `npm run build` | ✅ |
| 手動實跑（dev server＋真 admin session） | 走 `/api/admin/accounts/disable` 真實停用一個帳號 → audit row 的 `actor_id` ＝真 admin、`actor_session_id` ＝**真的 `admin_sessions` 列**、無 PII；重複停用寫出 `state_changed:false` |
| DB schema | **migration `0030`**（`0001–0030`） |

> **Wave 2A-1（#15 Audit substrate）＝ #10／#14A 的地基，兩者自此正式 unblocked。**
> - **實作與 triage 原規格有四處刻意分歧**（詳見 [`0030` 標頭](../parking-system/supabase/migrations/0030_audit_substrate.sql) 與 `docs/feature-triage.md` #15 列）：
>   1. **「app role 只 INSERT/SELECT」做不到**——app 跑 `service_role`、RLS 對它無效，且 `0004:66` 早已 blanket grant DML。實查 `rolsuper=f, rolbypassrls=t` ⇒ **grant 對它仍有效**（bypassrls ≠ superuser），故 revoke 是真控制。改為 **revoke DML（含 `TRUNCATE`）＋ trigger 雙層**：`TRUNCATE` 不受 row-level trigger 管故靠 revoke；trigger 則擋「未來某個 migration 重演 `0004` 的 blanket grant」（本 repo 已幹過一次＝已證實的風險，非假想）。
>   2. **單一 RPC 升級為 `private.append_audit_log`，EXECUTE 不授權給任何人**（含 `service_role`）。只有 owner-controlled **`SECURITY DEFINER`** 業務 RPC 能呼叫 ⇒ **app 根本無法寫 audit row**，保證來自 privilege 而非 PostgREST schema 曝光設定。這是本 repo **首批 SECURITY DEFINER**，故 `verify_schema` 永久釘住其兩個風險：`search_path` 已釘、`PUBLIC`/`anon` 無 EXECUTE。
>   3. **治理拒絕一律 typed return、不可 raise**——raise 會把「記錄這次拒絕」的那一列一起 rollback。`set_admin_disabled` 本來就是 typed return（`0026:61`）故 exemplar **零行為變更**；**#10（version conflict⇒`conflict`）、#14A（容量低於 approved⇒`denied`）必須照這個寫**。
>   4. metadata **flat depth-1＋PII key denylist**，且**由 RPC 內部組裝**、route 不得傳入。
> - **不宣稱的事（重要）**：owner 仍有 DDL ⇒ **不是 immutability**，只是「對 application principal append-only」；且**完全不防 omission**——app 仍可選擇不呼叫。只提高**偽造**成本，不提高**遺漏**成本。
> - **atomic**：audit 寫在業務 txn 內 ⇒ audit 失敗＝業務 rollback。測試以「讓 audit insert 在 RPC **已經** update 帳號、delete sessions **之後**才失敗」證明兩者一起回滾（此測試在非原子設計下會 fail）。
> - **exemplar 選 `set_admin_disabled`**（已是 atomic RPC、已帶 actor、在 #15 名單上、metadata 無 PII、同時能證 `success` 與 `denied`）。**外部審查建議的 `resolve_pastoral_alert` 已否決**：`0028:8-9` 明載「resolved_at/resolved_by_admin_id 加起來，alert row 本身就是 audit trail」——接上去等於默默推翻既有決策。
> - **重複停用照寫 audit（`state_changed:false`），否決「no-op 不寫」建議**：[`0026:69`](../parking-system/supabase/migrations/0026_admin_account_management.sql#L69) 的 `delete from admin_sessions` **無條件執行**（在 `if v_disabled_at is null` 分支之外），所以重複停用**會撤 session**＝真實安全動作，抑制該列＝隱藏它。「inert no-op 不寫」的通則仍適用於 #14A 容量重送。
> - **actor 模型**：polymorphic、**無 FK**（`0028:5-7` 已記載同一個坑兩次：admin 在 `admin_accounts` 不在 `users`；audit 是第三次、且是唯一無法用平行欄位繞過的）。測試釘住「actor 與 entity 都被刪除後 audit 仍在」。**不存 username**（可變）。
> - **⚠️ `0030` 不是 additive**：舊 4-arg overload 被 drop，DB 與 app **兩個部署順序都會短暫不相容**（PostgREST `PGRST202`，開發中已實際遇到）。影響範圍**僅 admin 帳號啟用/停用**，其餘 route、cron、會員/現場流程不受影響。**rollback 不能只回退 app**（舊 app 打不到新簽名）：forward-fix，或先還原 4-arg wrapper（但那會重新開出本 migration 要消滅的未稽核寫入路徑）。
> - **未做**：2A-2 read-only viewer；2A-3 retention（**政策已決：線上 24 個月、每月清、bootstrap/purge 記錄 retention-exempt**，見 `feature-triage.md`；注意 trigger 會擋掉所有 DELETE，purge 需刻意逃生口）。
> - **既有限制（substrate 修不了、viewer 不得掩飾）**：staff 寫入**無自然人身分**——`StaffSession` ＝ `{sessionId, eventId}`，`sessionId` 是**全場共用**的 per-event 列；`settle`（大量 no-show＋罰則）是破壞力最大的現場寫入，卻只能歸因到「知道本週 PIN 的某人」。

> 前一刀 **Wave 1d（#27 通知內容 enrich）**（全套 1285／116 檔）：
> - **⚠️ triage 的「粗體期限」不可行、未採用**：`lineTransport.ts:86` 送 `{ type: 'text' }`，**LINE 純文字沒有粗體／markdown**（全 repo 無 Flex）。真粗體＝改 Flex Message＝`renderTemplate` 從回傳 string 變訊息物件、transport 契約與 9 個 renderer 全改，屬通知層改版、不屬 Wave 1。**改以換行＋`⏰` 期限獨立成行**強調。
> - **順手修掉一個現存 bug**：`p2_arrival_reminder` 原本把 **ISO 日期直接印給會友**（「提醒您 2026-07-19 的…」）。日期一律走 `memberSundayLabel` → 「7月19日 主日」。
> - **開頭改成「【教會停車】＋換行＋您好，…」**：`【教會停車】` 是**寄件者標籤**（台灣簡訊慣例「【中華電信】您的帳單…」），不是稱謂。分段後「【教會停車】您好」自成一行 ⇒ 中文讀起來變成「跟教會停車問好」。標籤獨立一行後，`您好，` 回到它所屬的句子、對象是會友；手機不管在哪換行都不會再湊出那一行。同時拿掉開頭的 🙏（少了它當分隔，`您好` 改接逗號；`reservation_released`／`reservation_cancelled` 的主旨原以「您」開頭，會變成「您好，您…」疊字 → 拿掉該「您」，收件者本來就是本人）。測試釘住 `【教會停車】\n您好，` 開頭且不得出現 `【教會停車】您好`。
> - **enrich 在 producer、不在 dispatcher**：維持 `renderTemplate` 只讀 row 上已持久化的 payload（純函式）＝訊息是 enqueue 當下的**快照**（會友事後換車，已排隊的通知仍顯示當初申請的車牌）。共用 helper `server/services/notification/context.ts`。
> - **「裝飾不得阻擋核心」**：`runFridayAllocation` 是**先 claim job 才讀 pending**，plain cancel／release 原本**根本不讀 event** —— 只為了訊息而新增的讀取（車牌**與**日期）一律 **fail-soft**（失敗 ⇒ 少一行／回退「本週」），核心照跑。但**核心用途的 event 讀取仍 throw**（approved cancellation 要算遞補期限），不誤吞。
> - **車牌只給「講的就是那台車」的 5 個模板**；`broadcast_release`（別人釋出的位子）、`reservation_cancelled`（自己剛按的取消）不給，且 helper **主動剝除** `license_plate` —— minimization 同時成立在 **persistence 層**（`payload_json` 長期留存、retention 未實作）與 render 層。
> - **`reservation_released` 不給車牌**：Phase 4 Slice D（`e83451e`）已把該 payload 定為 **aggregate-safe（無 per-member 欄位）**——釋出掃描是唯一一次 fan-out 給大量會友的批次路徑，保持 payload 無個資是對「批次配錯對象」的縱深防禦。原計畫要給車牌，被該測試擋下 → 尊重舊規則。`sunday_date` 是 event 層級、非 per-member，故通過且該測試的禁止清單原封不動。
> - `memberSundayLabel` 做**真實日曆驗證**（`2026-02-31` 這類會被 regex 放行）；`p2_arrival_reminder` 的 10:45／10:55 改由 **`RELEASE_TIMES` 導出**，不再寫死（Wave 1b 的同一課）。
> - 車牌走 `vehicles(license_plate)` embed（**複合 FK**，由 friday-allocation DB 測試在真 PostgREST 上證明）、`.in()` **分批 100**（數百個 UUID 會把 URL 撐爆成 414）。**dedupe_key 全數不動 ⇒ 本刀不重送任何既有通知。**
> - **`move_car_request` 暫不套用 Wave 1d 的 sender-label 格式**（維持原本單行、無日期、無分段），因其為**已核准的獨立 OA 即時通知文案**（`docs/oa-onboarding-and-move-car-copy.md §二 A`）：它是現場即時請求、不是排程通知。代價是 OA 語氣有一則與其他 8 則不一致 —— **後續若要統一，需連同該 sign-off 文件一起審查**。renderer 旁已留「不要順手正規化」的例外註解。

> 前一刀 **Wave 1c（#12／#5A）**（全套 1179／114 檔）：
> - **#12 資料最小化橫幅**（`app/admin/DataMinimizationNotice.tsx`）掛在 `/admin/eligibility` 與 `/admin/members/[id]`，**在事由/眷屬出現之前**。系統本就只存「事由分類＋效期」、從不索取診斷證明，但這份克制原本只寫在程式註解裡。文案刻意寫「**請勿詢問或登錄診斷細節**」——初稿的「如需確認請當面了解」反而會招來當面問診，已棄用。
> - **#5A 名冊瀏覽**：`/admin/members` 預設 SSR 第一頁（搜尋仍在上方）。`repo.listMembers` **在 DB 排序** `(display_name, id)` 再 `range` —— 全序才可 offset 分頁（`searchMembers` 是抓完在 JS 排序，無法分頁）。因此頁面現在會 SSR 遮罩 PII ⇒ **加上 `force-dynamic`/`revalidate=0`**（比照另兩個含 PII 的頁）。搜尋維持 POST（query 不進 URL）；名冊只有 `?page=N`，**URL 零 PII**。
> - **`?page=` 是公開輸入**：`parsePage` 只收 plain positive **safe** integer（擋 `1.5`／`1e3`／`Infinity`／超大數／`?page=1&page=2` 的 `string[]`），service 再自我防禦、`offset` 亦驗 safe（不安全時 page/offset **成對**退回第 1 頁，不謊報頁碼）。
> - **⚠️ 實作中發現的真 bug**：PostgREST 對超出範圍的 offset 回 **416/`PGRST103`**（`count` 為 null）——`?page=999` 原本會 **500**，讓「redirect 到最後一頁」永遠跑不到。`listMembers` 現在把 `PGRST103` 視為**空頁**、另查 count 後回 `{rows: [], total}`，頁面才得以 redirect。
> - 兩份清單（搜尋結果／名冊）欄位相同 → 抽共用 `MemberTable`；其 DTO `MemberSearchItem` 放 **client-safe 的 `lib/memberAdminTypes.ts`**（`lib/supabase/server.ts` 只有註解防護、無 `server-only` 套件，client 元件不該有理由 import 到 service 模組）。
> - 不匯出、不 bulk、不預載敏感事由（P2 事由只在明細頁讀）；role 分級仍待 #19。

> 更前幾刀：Wave 1d 全套 1285；Wave 1c 全套 1179；Wave 1b 全套 1137；Wave 1a 全套 1135、`/staff/print`→404；Wave 0.1 全套 1131；Wave 0（#20/#21/#22＋migration `0029`）全套 1118／`db:verify` PASS；Wave -1 非 DB 906。

> **Wave 1b（#29／#30）**：
> - **#29 候補序號**：新 `repo.getWaitingRank(eventId, allocationOrder)`＝同 event、仍 `waiting`、`allocation_order` 較小者 count **+1**（1-based）。**只數 `waiting`**——持 offer（`temp_approved`）者當下不佔候補位，但 `failOffer` 會讓他帶**原 `allocation_order`** 退回 waiting、**插回前面**，故序號可能**變大**；UI 明示「順序可能因取消、資格與分配狀態而變動」，這不是號碼牌。`allocation_order` 為 server-only，只有衍生的 `waitingRank` 進 DTO；rank 不明時回退既有文案，不編造序號。count 查詢 error 或 `count === null` 一律 **throw**（絕不默默顯示假的「第 1 位」）。
> - **#30 取消 reassurance**：**triage 原訂「10:30 前取消不計違規」經讀碼推翻**——(a) 違規只來自 `released_late → no_show`，取消**從不**計違規；(b) 過了截止根本**不能**取消（`cancellationService` 對其他狀態 throw）；(c) 截止**每人不同**（P3 10:30／P2 10:45／P2 正在路上 10:55），寫死 10:30 對 P2 是錯的。故改**無條件**：「主動取消不會被記為未到場；已核准但未取消且未到場，才會列入未到場紀錄。」
> - **申請區塊只寫「預計分配」、不寫「截止」**：該區塊由 `hasFridayAllocationRun` 而非時鐘把關，cron 延遲時頁面仍開放，若宣稱「18:00 截止」會與正下方的表單自相矛盾。
> - 測試：`getWaitingRank` DB 整合（`approved`/`temp_approved`/null order/他週皆不計；前方取消→序號下降）。該 describe **自有 Sundays `2099-09-13`/`2099-09-20`**——`weekly_events.sunday_date` 為 **unique**，各整合檔必須claim 未被使用的日期。

> 前幾刀：Wave 1a 全套 1135、`/staff/print`→404；Wave 0.1 非 DB 956／全套 1131；Wave 0（#20/#21/#22＋migration `0029`）全套 1118／`db:verify` PASS；Wave -1 非 DB 906。

> **Wave 1a（#23／#24）**：紙本點名備援清單由 `/staff/print` **搬到 `/admin/print`**——列印是主日前的辦公室準備動作，不該綁在全同工共用的現場 PIN。event 改用**台北日曆當週主日**（`upcomingSundayISO`），**非 `getActiveEvent`**（latest-non-finalized 會印出上週）；資料解析抽成可測的 `printSheetService`（測試釘住：日曆主日／未呼叫 `getActiveEvent`／只讀 Staff-safe view）。`/staff/print` 已刪除、**不做 redirect**（跨 auth domain 混亂）；sidebar 加入口並對整個 shell 上 `print:hidden`。
> Staff footer 只留「＋登記現場車輛」；不可逆的「結束當週點名」移入 header ⋯ 選單（**真 `<button disabled>`**——disabled 時不可開確認 sheet；先關選單再開 sheet；Escape／點外只關閉、不觸發），既有二次確認 sheet 未動。
> 註：`/staff/print` 在 §6.8／§6.10／§6.11 的敘述為**當時路徑**的歷史紀錄。

> 前幾刀：Wave 0.1 非 DB 956／全套 1131；Wave 0（#20/#21/#22＋migration `0029`）非 DB 943／全套 1118／`db:verify` PASS；Wave -1 非 DB 906、無 DB 變更。

> Wave 0.1＝`p2_application` 群組一致性：同手機多列不再由 `rows[0]` 靜默決定資格。規則——`reason_type` 須一致；`remarks` **只需導出的 `isPregnancy()` 旗標一致**（逐字可不同）；`application_date` 正規化後忽略空白、非空白須一致；眷屬以 `(kind,name)` 合併、空白由唯一有效值補足。**非空白但無法解析的日期在 `validateRow` 即擋下**（成為 row error → 由 Wave 0 的 row-completeness taint 整組），故「填錯日期」不會被誤讀成「沒提供日期→待覆核」。
> 報表一般化：`priorityConflicts` → **`groupConflicts {phone, field, subject?, values}`**（涵蓋兩 profile，`values` 一律 canonical、不含原始備註）；每人一次只報第一項，順序 `reason_type → pregnancy → application_date → dependent_birthdate`。

> 前兩刀：Wave 0（#20/#21/#22＋migration `0029`）非 DB 943 / 全套 1118 / `db:verify` PASS；Wave -1（文件與通知 correctness）非 DB 906、無 DB 變更。

> Wave 0＝中文表頭對照＋兩格式自動辨識（`ambiguous_profile` fail-closed）＋一般名冊匯入（P1/P3 免資格）＋手機容錯。
> **migration `0029`**：`import_member` 的 eligibility 改為 `p_reason IS NOT NULL` 才寫；P1/P3 只建 user+vehicles、**永不撤銷既有 P2**（回 `retained_p2` 供報表警示）。
> 手動實跑：`docs/import-templates/` 兩份中文範本 CLI dry-run 皆正確（roster 4 位、孕婦→待覆核、長者同行→永久；P2 表 4 位、3 眷屬）；合成檔驗證科學記號拒絕、9 碼補 0、同檔車牌衝突整位擋下。

> 前一刀（Wave -1，文件與通知 correctness）之驗證：`npm test`（不接 DB）906 passed / 172 skipped、tsc/eslint/build 全綠、無 DB 變更。

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
> **Phase 4–9 皆已完成、Phase 9 已收官**（詳見 §6.13–§6.36）；本節下表為仍未做的 deferred 項目。剩交付後 ops（非開發軌）見 header 與 [prod-deploy-runbook.md](prod-deploy-runbook.md) §8/§13。
> 定案：⭐ 保留、**不在畫面加個資**，聯絡需求改走教會 LINE OA 代發。

| 項目 | 預定時機 | 備註 |
|------|----------|------|
| ~~真 Staff PIN session（`staff_sessions` 雜湊 / 失敗鎖定 / 過期 / 綁 event）~~ | ✅ **完成（v2，§6.10）** | scrypt PIN + 5 次鎖 15 分 + 12h TTL + cookie session id + event 綁定（取代 getActiveEvent stub） |
| ~~Staff PIN 管理 UI~~ | ✅ **完成（§6.35）** | `/admin/staff-pin`：隨機 PIN 顯示一次、expiry 撐到主日結束、解鎖/替換分離；CLI `staff:set-pin` 降為緊急備援（legacy now+ttl 契約）。真 per-device session（單裝置撤銷）/ PIN 輪替仍後續 |
| **PIN 自動派送**：自動發同工 LINE 群（triage #3）/ 個別私訊值班人（#4） | **deferred**（交付後，需獨立安全 design review） | cron retry 反覆旋轉 PIN＝最大風險（明碼不落地→push 失敗無法重送同碼）；**人工重發已可運作**（`/admin/staff-pin` 重發＝新碼、舊碼立即失效、手動轉交）；理由詳見 [pre-delivery-polish-backlog.md](pre-delivery-polish-backlog.md) |
| ~~Staff walk-in 現場登記~~ | ✅ **完成（v2 P1，§6.6）** | — |
| ~~Staff 結束當週點名（settle）route + UI~~ | ✅ **完成（v2，§6.9）** | `/api/staff/settle` 回嚴格 Staff-safe DTO `{ ok, settled, releasedNow }`（不暴露 penalty/牧養）；UI 二次確認 sheet |
| ~~`weekly_events` 事件 finalize（結束整週）~~ | ✅ **完成（v2，§6.11）** | settle 後標 `finalized`、擋 Staff 寫入（app-layer guard）；DTO 加 `finalized` 旗標 |
| `weekly_events` finalize 的 **DB 層強制**（trigger）/ `finalized_at` 稽核欄 / 解除 finalize（重開週） | 後續 | §6.11 為 app-layer guard（防誤點，非防繞過）；DB 層 trigger 防 service_role 直寫為 defense-in-depth |
| ~~Auto-finalize fallback（忘記結束時自動 settle + finalize）~~ | ✅ **完成（v2，§6.12）** | 內部 job（job-secret）+ CLI；掃過寬限期仍 `open` 的過去週，per-event 隔離、冪等；**營運兜底、非同工主流程** |
| Auto-finalize 的真實排程器綁定（cron / Vercel Cron）/ `dryRun` 預覽 / `closed` 狀態語意 | 後續 | §6.12 提供 route + CLI，實際排程掛載與只掃不寫預覽延後；本刀只掃 `'open'` |
| Staff 截止時間/倒數、`p2_on_the_way` 顯示 | 後續 | Slice 1 刻意不顯示（沿用 view 9 欄、最貼近隱私投影） |
| ~~Staff 誤點復原 + 離線只讀快取~~ | ✅ **完成（v2 P2，§6.7）** | undo 視窗（送出前可取消）+ localStorage 只讀快取 |
| ~~Staff 紙本備援清單（列印）~~ | ✅ **完成（v2 Stability Slice B，§6.8）** | 可列印當週清單紙本（同 Staff-safe 欄位）；補足「只讀快取」涵蓋不到的硬離線。**Wave 1a（#23）已由 `/staff/print` 搬至 `/admin/print`**（admin gate、台北日曆當週主日） |
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
| ~~**牧養關懷 alert 處理（resolution）UI**~~ | ✅ **完成（§6.35）** | `/admin/pastoral`＋`resolve_pastoral_alert` RPC（0028）：結案＋可選歸零、alert 列即稽核軌跡（resolved_by_admin_id/counter_reset） |
| 其餘兩種 §7 牧養觸發（短期行動不便到期 / 幼兒資格到期）每日排程 | 後續 | 目前僅實作「連續未到」觸發 |
| **P1 全職同工 `weekly_staff_allocations` no-show 處理** | 後續 | 與 reservation 結算分離；Slice 4 只結算 reservation（P2/P3） |
| Realtime | 後續 | — |
| ~~釋出時對「被釋出成員本人」的個別通知~~ | ✅ **完成（Phase 4 Slice D，§6.16）** | `reservation_released` 一則資訊性通知（一次性 `released_owner:<id>` dedupe）；`0015` 4-arg `apply_release` + 3-arg wrapper；**結算 pre-sweep 靜默**（`notifyReleasedOwners:false`）；候補廣播不變 |
| 中途容量變更的重新驗證 | 後續 | 遞補假設「一筆 approved 取消＝釋出一個位、遞補一個」 |

---

## 10. 本機開發備忘（重點，詳見 development_plan §12）

- 啟動/重置/驗證：`npm run db:start` / `db:reset`（套用 `0001–0032` + seed）/ `db:verify` / `db:stop`。
- 工作 script：`job:friday` / `job:expire-offers` / `job:release` / `job:settle` / `job:auto-finalize` / **`job:dispatch`**（notification dispatcher；皆 `tsx scripts/run-*.ts`）。`job:dispatch` 吃選填 `--limit` / `--now`，需 `NOTIFICATION_TRANSPORT=mock|line`。
- `.env.local`：`SUPABASE_SERVICE_ROLE_KEY` 用 `npx supabase status` 的 **`sb_secret_...`**（非舊版 JWT）；`SUPABASE_URL=http://127.0.0.1:54321`；`JOB_TRIGGER_SECRET`（route 的 `x-job-secret`）；**`NOTIFICATION_TRANSPORT`（`mock`|`line`）** + **`LINE_CHANNEL_ACCESS_TOKEN`（`line` 模式必填，否則 dispatcher fail-fast）**；**`MEMBER_AUTH_MODE`（`mock`|`liff`；本機用 `mock`，`liff` 另需 `LINE_LOGIN_CHANNEL_ID` + `NEXT_PUBLIC_LIFF_ID`，見 [member-liff-setup.md](member-liff-setup.md)）**。這些密鑰**僅後端使用，絕不可暴露到瀏覽器**（`NEXT_PUBLIC_LIFF_ID` 例外，非機密）；`lib/supabase/server.ts` 不得被 client 端 import。
- 本機 Supabase default privileges 只給 API 角色 `Dxtm`，故 migration 對 `service_role` 明確 `grant select/insert/update/delete`；新增表/視圖記得一併授權。
  - **⚠️ `audit_logs` 是明確例外，不要順手照辦**：它**只給 `service_role` SELECT**，DML（含 `TRUNCATE`）一律 revoke（`0030`）。**絕對不要**用 `grant ... on all tables in schema public to service_role` 這種 blanket 寫法——`0004:66` 就是這樣寫的，再來一次會**默默把 audit 的 append-only 打回去**。（`0030` 的 trigger 正是為此而存在的第二層，但別依賴它替你收尾。）同理 `private` schema 不授 `USAGE` 給 `service_role`：app 不能碰 audit writer 是刻意的。
- 整合測試需先 `db:reset` 且設 `RUN_DB_TESTS=1` 才會執行；否則 gate 跳過。
- 目前本機 Supabase stack 已停止（`npm run db:stop`）；下次開發前先 `db:start && db:reset`。
