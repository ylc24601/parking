# Staff 現場頁 — v2 Backlog（同工會議定案後）

> 來源：2026-06-29 同工會議回饋（`docs/staff-demo/feedback.md`）。
> 對應：[current_handoff.md](current_handoff.md) §6.5（Slice 1 已完成）、§9 Deferred。
> 狀態：規劃中，待 OA 加入率 / 文案 / 優先序拍板後啟動。

---

## 0. 一頁摘要

- **第一版（Slice 1）已上線**：清單 / 車牌後四碼搜尋 / 一鍵點名 / 補點名（含實機 DB E2E）。
- **v2 P1 walk-in 現場登記：✅ 已完成（2026-06-30）**，見 handoff §6.6。
- **v2 P2 穩定度（誤點復原 + 離線只讀）：✅ 已完成（2026-06-30）**，見 handoff §6.7。
- **v2 Stability Slice B 紙本備援清單（`/staff/print`）：✅ 已完成（2026-06-30）**，見 handoff §6.8。
- **v2 結束當週點名（settle route + UI）：✅ 已完成（2026-06-30）**，見 handoff §6.9。
- **v2 真 PIN session（per-event PIN + 鎖定/過期 + event 綁定）：✅ 已完成（2026-06-30）**，見 handoff §6.10。
- **v2 weekly_events finalize（結束整週 + 擋寫入）：✅ 已完成（2026-06-30）**，見 handoff §6.11。
- **v2 Auto-finalize fallback（內部 job：忘記結束時自動 settle + finalize）：✅ 已完成（2026-07-01）**，見 handoff §6.12。**營運兜底、非同工主流程**。
- 會議回饋大多是**可直接做的微調**；唯一較大的是「移車聯絡」，要走教會 LINE OA、且卡在「會友未全加入 OA」。
- **Phase 3 已結案（2026-07-01）**：~~① walk-in~~ → ~~② 穩定度~~ → ~~③ 紙本備援清單~~ → ~~④ 結束當週點名~~ → ~~⑤ 真 PIN session~~ → ~~⑥ weekly_events finalize~~ → ~~⑥.5 auto-finalize fallback~~ 全數完成。
- **Phase 4 進行中（Notification & LINE Integration）**：**✅ Slice A — LINE notification dispatcher（2026-07-02）**（handoff §6.13）+ **✅ Slice B — Staff「請車主移車」move-car request（2026-07-03）**（handoff §6.14）+ **✅ Slice C — dispatcher ops hardening（2026-07-04）**（handoff §6.15：dispatch GET + Vercel-Cron/x-job-secret 雙軌 auth + `dryRun` 無異動預覽 + `outbox_health` 健康度可視 + production `mock` guard；runbook [dispatcher-ops.md](dispatcher-ops.md)）。**下一步（go-live 前置，ops 軌）：真實 OA channel token + 移車文案定稿 + per-member `line_id` 綁定流程；正式排程掛載（Vercel Pro cron 或外部排程）。**

---

## 1. 會議定案（已鎖，不再討論）

| 項目 | 決定 |
|------|------|
| ⭐ 優先顯示 | **保留現狀**，不改 |
| 在畫面加電話 / 個人聯絡方式 | **不加**（隱私邊界不變）；聯絡需求改走教會 LINE OA 代發 |
| 文案（點名/補點名/已釋出） | 同工 OK，不動 |
| 按鈕大小 | 同工 OK，不動 |
| 延後 walk-in / 結束當週點名 | 同工可接受 |

---

## 2. Backlog（依優先序）

### ✅ P1 — walk-in 現場登記（已完成 2026-06-30）
- 入口：搜尋無結果「＋ 登記為現場車輛」（帶入車牌）＋ footer 按鈕；bottom-sheet 表單。
- 後端：`0009_walkin_plate_unique.sql`、`lib/plate.ts`、`createWalkInReservation`、`walkInService.registerWalkIn`、`POST /api/staff/walkins`。
- **兩層去重**：Staff-safe precheck（涵蓋 member 車牌）+ DB unique index race backstop；回 Staff-safe DTO（不回 raw 列）。
- 驗證：`npm test` 218、`RUN_DB_TESTS=1` 236、`db:verify` 13/13、實機 HTTP E2E 通過。詳見 handoff §6.6。

### 🟢 P1.5 — 快速微調（可夾帶在 P1 一起出）
- **排序**：未點到置頂、已點名往下排（自由回饋）。規模 S。
- **亮色 / 暗色主題切換**：亮色參考 repo 內 `mockup/index.html`；給同工選。規模 S–M。
- **依賴**：無。

### ✅ P2 — 穩定度（已完成 2026-06-30，見 handoff §6.7）
- **誤點復原**＝**送出前 5 秒 undo 視窗**（`pendingRef`/`timerRef`，視窗內復原不送 API、不動違規；探索確認後端反轉會失真故不做）。
- **離線只讀快取**＝`lib/staffCache.ts`（localStorage、cache metadata `schemaVersion/cachedAt/event/rows`、stale-week guard、只寫 confirmed、登出清除）+ 離線偵測橫幅 + 寫入守則（點名/補點名/walk-in）。
- 驗證：`npm test` 229（不接 DB）/ 247（接 DB）、`tsc`/`eslint`/`build` 綠、瀏覽器手動 pass（undo / 離線 / 登出清快取）。

### ✅ Stability Slice B — 紙本備援清單（已完成 2026-06-30，見 handoff §6.8）
- **為什麼**：v2 P2 的「離線只讀」只涵蓋「開著頁面時斷線」；**冷啟動離線 / 完全沒網路**仍需備援（需 SW 才能做到離線冷啟，較重，列 P2.5）。先做最務實的 fallback：**可列印當週清單紙本**。
- **做法**：新增 `/staff/print`（server component，同 `staffAuthed()` gate + 同 `staff_checkin_view` Staff-safe 來源）；淺色可列印表格（⭐/姓名/車牌/狀態/☐到場/現場備註），表頭含主日/列印時間/總台數/⭐優先台數/備援說明；備註欄附「勿記錄個資」提醒；手動列印鈕（不自動列印）。共用呈現 helper 抽到 `lib/staffRow.ts`（含可測 `sortRowsForPrint`）。
- 驗證：`npm test` 241 / `RUN_DB_TESTS=1` 259 / `db:verify` 13/13（無 schema 變更）；未登入路由回 PIN 登入（不外洩清單）。
- **後續（P2.5）**：service worker / 冷啟動離線（PWA）才能真正離線冷啟，較重，延後。

### 🔵 Phase 4 — Notification & LINE Integration（原 P3「移車通知」；需先建 dispatcher，且卡 OA 加入率）
- **為什麼**：真正場景是**移車** —— 教會有些車位需請特定車主移車，同工要能通知到該車車主；地下室只有 WiFi，`tel:` 撥不通、個人 LINE 要加好友且露個資 → 只能走教會 OA 代發。
- **範圍**：
  - ✅ **Slice A — LINE notification dispatcher（已完成 2026-07-02，見 handoff §6.13）**：outbox → LINE 實際送出。**原子 claim/lease（`FOR UPDATE SKIP LOCKED` + `processing` 狀態 + `locked_at/locked_by`）防並發重送**；**顯式 `NOTIFICATION_TRANSPORT=mock|line`（缺 token fail-fast、不靜默假送）**；型別化失敗分類（retryable/terminal/config-abort）+ backoff 重試 + `X-Line-Retry-Key` 冪等；`last_error` 只存 sanitized 碼。`job:dispatch` CLI + 內部 route（counts-only）。驗證：`npm test` 324 / `RUN_DB_TESTS=1` 357 / `db:verify` 17/17 + 實機 E2E（含並發恰一次 push、config-fail 不異動）。
  - ✅ **Slice B — Staff「請車主移車」（已完成 2026-07-03，見 handoff §6.14）**：新「**移車請求**」模板（`move_car_request`，版本 A 暫定文案）+ `POST /api/staff/move-car`（伺服器端車主解析、Staff-safe DTO）+ Staff 列「請移車」動作。**OA 加入狀態 gating** 已做：`staff_checkin_view` 加 `owner_notifiable` 布林，未綁定/walk-in → 按鈕 disabled 標「此車主未綁定 LINE，無法通知」。enqueue → §6.13 dispatcher 送出。驗證：`npm test` 341 / `RUN_DB_TESTS=1` 378 / `db:verify` 18/18 + cookie/PIN 實機 E2E。
  - **go-live 前置（ops）**：真實 OA channel token、移車文案定稿、per-member `line_id` 綁定流程；緊急/其他版本（B/C/D）文案。
- **依賴（卡點）**：
  1. **OA 加入率**：停車會友未全部加入 → 需推動加入（報名要求 / 主日公告 / QR）。**ops 待辦**。
  2. **移車推播文案**：教會語氣，需有人擬。
  3. 需知道每位會友的 OA 綁定 / 加入狀態。
- **規模**：L（含 dispatcher + 模板 + UI + OA 串接）。

### ✅ 結束當週點名（settle route + UI）（已完成 2026-06-30，見 handoff §6.9）
- `POST /api/staff/settle`：cookie 守護、server 端綁 active event，**薄包裝**既有 `settlementService.settle()`（不重新設計 Phase 2 結算/違規/牧養）。
- **嚴格 Staff-safe DTO `{ ok, settled, releasedNow }`**；不外洩 `penaltiesApplied` / `alertsCreated` / penalty / 牧養（route 單元測試斷言此二欄不存在）。
- UI：footer 按鈕 → 二次確認 sheet（顯示目前 `released_late` 台數 + 不可復原 + 「實際台數可能不同」）；settle 前先 `commitPending()` flush 未送出點名（失敗則中止），結算後 `reload` 自動移出 `no_show` 列；錯誤分流（401 refresh / server error 不翻 offline / 網路 throw 才 offline / settle 成功但 reload 失敗保留成功 toast）。
- 驗證：`npm test` **246**（本回合實跑）；`RUN_DB_TESTS=1` **264（推論未變，本回合未重跑——前次 259 + 5 筆純 route 單元測試、無 DB/schema 變更）**；`db:verify` **13/13**（前次值，無 schema 變更）；未登入路由回 401。
- **手動驗證已完成（2026-06-30，於 finalize 刀）**：登入後 settle click-through（seed `released_late` → `{ settled:1, finalized:true }`）。
- ~~不 finalize `weekly_events`~~ → 已於 §6.11 補上（settle 後 finalize + 擋寫入）。

### ✅ 真 PIN session（已完成 2026-06-30，見 handoff §6.10）
- scrypt per-event PIN（`staff_sessions`）+ 連續錯 5 次鎖 15 分（原子 RPC `apply_staff_pin_failure`）+ 12h TTL；cookie 帶 session id。
- **event 綁定**：Staff 資料面改用 session.eventId（取代 getActiveEvent stub）；`checkin` 跨 event 預約 → 409。
- 隱私：login 無 event/無列/過期/錯 PIN 一律 401，唯鎖定 423；`locked_at` 只擋新登入、不撤銷已登入 cookie。
- CLI `npm run staff:set-pin`（⚠️ `--pin` 可能殘留 shell history）。驗證：`npm test` 268 / `RUN_DB_TESTS=1` 290 / `db:verify` 15/15 + 實機 E2E。
- **仍 deferred**：Admin PIN 管理 UI、真 per-device session（單裝置撤銷）、PIN 輪替。

### ✅ weekly_events finalize（已完成 2026-06-30，見 handoff §6.11）
- settle 成功後 `finalizeWeeklyEvent`（status → `finalized`，status-guarded 冪等）；**薄包裝**既有 settle，不重新設計 Phase 2。
- finalized event **擋所有 Staff 寫入**（`checkin`/`walkins`/`settle` → 409 `event_finalized`，共用 `server/http/staffEventGuard.ts`）；**讀取仍可**（checkin-list / print 200）。
- settle 與 finalize **非單一 transaction**：settle 成功、finalize 失敗 → `finalized:false` 可重試；DTO 仍 Staff-safe `{ ok, settled, releasedNow, finalized }`。
- UI：finalized 橫幅 + 停用三鈕；任何寫入 409 → 即時轉唯讀。驗證：`npm test` 272 / `RUN_DB_TESTS=1` 297 / `db:verify` 15/15（無 schema 變更）+ 實機 E2E。
- **仍 deferred**：DB 層 finalize 強制（trigger）、`finalized_at` 稽核欄、解除 finalize（重開週）。

### ✅ Auto-finalize fallback（內部 job）（已完成 2026-07-01，見 handoff §6.12）
- **為什麼**：finalize (§6.11) 全靠同工「記得按」；忘記則該週一直 `open`（getActiveEvent 誤判進行中、released_late 不結算）。本刀補**營運兜底**。
- job-secret 守護的內部路由 `POST /api/internal/jobs/auto-finalize` + CLI `npm run job:auto-finalize`；掃「過寬限期仍 `open` 的過去週」，逐筆呼叫既有 `settle()` 再 `finalizeWeeklyEvent()`，**per-event 隔離、冪等、可重試**。
- 寬限期 `AUTO_FINALIZE_GRACE_DAYS`（預設 2、嚴格驗證）；cutoff 以 **Asia/Taipei 營運日** − grace 計算。回應 operation-safe（`{ ok, scanned, finalized, failed, results }`，不含 penalty/牧養/個資）。
- **定位**：營運 fallback，**非同工主流程**（手動結束仍正常）。驗證：`npm test` 291 / `RUN_DB_TESTS=1` 318 / `db:verify` 15/15（無 schema 變更）+ 實機 E2E（401/400/sweep/冪等/CLI）。
- **仍 deferred**：真實排程器綁定（cron/Vercel Cron）、`dryRun` 預覽、`closed` 狀態語意。

### ⚪ 之後（沿用既有 Deferred）
- 成員 / Admin UI（P2-first）。詳見 handoff §9。

---

## 3. 待你 / 教會補的（啟動 Phase 4 前的前提）

1. **OA 加入率方案** → 已備草案：[oa-onboarding-and-move-car-copy.md](oa-onboarding-and-move-car-copy.md) §一（gating / QR / 回推 / 目標 / fallback）。教會端可即刻啟動（ops 軌）。
2. **移車推播文案** → 已備草案：同檔 §二（A 標準 / B 緊急 / C 散會後 / D 調度 + 加入邀請文案）。待教會語氣微調定稿。
3. **v2 優先序：已確認（2026-06-30）** ① walk-in → ② 穩定度 → ③ 紙本備援清單（①②③ 皆 done）→ ④ LINE 移車（dev 軌，下一個），OA 加入率（ops 軌）並行先推。詳見同檔 §三。
4. 確認「移車請求」列為**新通知模板**。

---

## 4. 不在 v2 範圍 / 維持不變
- ⭐、文案、按鈕大小、隱私邊界（不加個資）皆不動。
- 後端 Phase 0–2 邏輯不動。
