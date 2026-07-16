# 交付前 Polish Backlog（living checklist）

> 目的：把 [feature-triage.md](feature-triage.md) 的**交付分級**攤成一張可勾的清單，追蹤「哪些在交付前必須完成 / 強烈建議 / 可留交付後」。
> **本檔只記狀態 + Gate（交付門檻）+ Source**，不重述設計內容——完整規格與實作語意決策一律以 [feature-triage.md](feature-triage.md) 為準，避免兩份文件分歧。
> 對應：[current_handoff.md](current_handoff.md)、[prod-deploy-runbook.md](prod-deploy-runbook.md)。
> 起始：2026-07-16（Wave -1）。

---

## 圖例

- `[ ]` 未做　`[~]` 進行中　`[x]` 完成
- **Gate**＝這條「算完成」的判準　**Source**＝ triage 條號

---

## Wave -1（本刀：文件與通知 correctness）

- [x] 文件同步 — `current_handoff.md` 除鏽（header/§0 TL;DR/§8/§9/§10）
  - Gate：開頭不再宣稱「Phase 4 進行中」；§8 分「Phase 9 收官快照」與「Current HEAD」兩層
  - Source：triage Wave -1
- [x] **#25 通知死指令修正**
  - Gate：`offer_2hr_confirm`／`p2_arrival_reminder` 不含「回覆」、改導向會員頁；guard test 鎖定
  - Source：feature-triage.md #25
- [x] **#1 換人換碼＋手動轉發文案**
  - Gate：`/admin/staff-pin` 有獨立「換人值班＝重發＝手動轉交」段落
  - Source：feature-triage.md #1
- [x] 明列 PIN 自動派送 deferred（見本檔尾）
  - Source：triage Wave -1、#3/#4

---

## 交付前必修（delivery blockers）

- [x] #20 匯入中文 header＋reason 對照 — **Wave 0 完成**
  - Gate：中文→canonical 集中單一 `REASON_ALIASES`；未知值 preview 錯誤要人工選、不 silently map
  - Source：feature-triage.md #20
- [x] #21 簡易全體會友匯入 — **Wave 0 完成**
  - Gate：重用既有 `memberImportService`（preview/conflict/apply）、兩模式共存有測試
  - Source：feature-triage.md #21
- [x] #22 匯入手機容錯 — **Wave 0 完成**
  - Gate：9 碼補前置 `0`、**科學記號拒絕並提示**、測試涵蓋全部
  - Source：feature-triage.md #22
- [x] **Wave 0.1｜P2 application group consistency（correctness follow-up）** — **完成**
  - 定案規則：`reason_type` 須全列一致；`remarks` **只需導出的 `isPregnancy()` 旗標一致**（逐字可不同——remarks 只經 `isPregnancy()` 生效、且只在 reason 3）；`application_date` 正規化後**忽略空白、非空白須一致**；眷屬以 `(kind,name)` 合併、空白由唯一有效值補足、不同有效值 ⇒ 衝突。**任何非空白但無法解析的日期在 `validateRow` 即擋下**（→ row-completeness taint 整組），故填錯不會被誤讀成缺值。
  - 報表：`priorityConflicts` → `groupConflicts {phone, field, subject?, values}`（兩 profile 共用；`values` 一律 canonical，不含原始備註）；每人一次只報第一項，順序 `reason_type → pregnancy → application_date → dependent_birthdate`。
  - Source：Wave 0 code-review finding
- [x] #23 點名備援清單搬 admin — **Wave 1a 完成**
  - Gate：`/admin/print`（`getAdminSession` gate、event 用**台北日曆當週主日** `upcomingSundayISO`，非 `getActiveEvent`）；`/staff/print` **已刪除**（不做 redirect）；資料解析抽成可測的 `printSheetService`，測試釘住「日曆主日／未呼叫 `getActiveEvent`／只讀 Staff-safe view」。
  - 註：「staff PIN 不再能取列印資料」是**結構性保證**（該能力只存在於那一頁，頁面已刪；`next build` route 清單確認），非用測試證明不存在——本 repo 無 page 測試框架。
  - Source：feature-triage.md #23
- [x] #24 staff footer 精簡 — **Wave 1a 完成**
  - Gate：footer 只留「＋登記現場車輛」；結束當週點名移入 header ⋯ 選單（**真 `<button disabled>`**，disabled 時不可開確認 sheet；先關選單再開 sheet；Escape／點外只關閉不觸發），既有二次確認 sheet 未動。
  - Source：feature-triage.md #24
- [x] #27 通知內容 enrich — **Wave 1d 完成**
  - ⚠️ **triage 的「粗體期限」經讀碼推翻、未採用**：`lineTransport` 送 `{type:'text'}`，**LINE 純文字沒有粗體／markdown**。真粗體＝改 Flex Message＝`renderTemplate` 契約與 9 個 renderer 全改（通知層改版，另開刀）。**改以換行＋`⏰` 期限獨立成行**達成強調。
  - Gate（實際交付）：8 個會員模板走「抬頭／日期＋主旨／車牌／⏰ 期限／行動」分段（`joinSections` 只串非空段，無空白區塊）；日期一律 `memberSundayLabel`（**含真實日曆驗證**，非僅 regex）；`p2_arrival_reminder` 的 10:45／10:55 改由 **`RELEASE_TIMES` 導出**、不再寫死；順手修掉「**ISO 日期直接印給會友**」的現存 bug。
  - producer 補 payload 走共用 `notification/context.ts`（renderer 維持純函式＝enqueue 當下快照）。**車牌只給 5 個「講的就是那台車」的模板**，其餘 helper **主動剝除** `license_plate`（minimization 也成立在 persistence 層）。
  - **`reservation_released` 不給車牌**：Phase 4 Slice D `e83451e` 已定該 payload 為 **aggregate-safe（無 per-member 欄位）**——釋出掃描是唯一 fan-out 給大量會友的批次路徑。原計畫要給、被既有測試擋下 → 尊重舊規則（`sunday_date` 屬 event 層級故通過，禁止清單原封不動）。
  - **裝飾不得阻擋核心**：只為訊息新增的讀取（車牌與日期）一律 fail-soft（週五分配是**先 claim job 才讀**，plain cancel／release 原本不讀 event）；**核心用途的 event 讀取仍 throw**。dedupe_key 全數不動 ⇒ 不重送既有通知。
  - Source：feature-triage.md #27
- [x] #30 取消 reassurance — **Wave 1b 完成**
  - ⚠️ **triage 原訂文案「10:30 前取消不計違規」經讀碼推翻、未採用**：(a) 違規只來自 `released_late → no_show`，取消**從不**計違規；(b) 過了截止根本**不能**取消（`cancellationService` 對其他狀態 throw）；(c) 截止**每人不同**（P3 10:30／P2 10:45／P2 正在路上 10:55）——寫死 10:30 對 P2 是錯的。
  - Gate（實際交付）：**無條件、不綁時間**且避開「違規」一詞 →「主動取消不會被記為未到場；已核准但未取消且未到場，才會列入未到場紀錄。」對 P1/P2/P3 皆正確，且不隨 `RELEASE_TIMES` 腐化。
  - 順帶：申請區塊寫「車位預計於週五 18:00 分配」——**刻意不寫「截止」**（該區塊由 `hasFridayAllocationRun` 而非時鐘把關；cron 延遲時仍開放，宣稱截止會與表單自相矛盾）。
  - Source：feature-triage.md #30
- [x] #29 member 顯示候補序號 — **Wave 1b 完成**（Wave 1 項目，非交付 blocker，一併做掉）
  - Gate：`repo.getWaitingRank` ＝同 event、仍 `waiting`、`allocation_order` 較小者 count+1；**只數 `waiting`**（持 offer 者退回時會帶原序插回前面 → 序號可能變大），UI 明示「順序可能因取消、資格與分配狀態而變動」；rank 不明回退舊文案；count error/null ⇒ throw，不顯示假的「第 1 位」。
  - Source：feature-triage.md #29

---

## 強烈建議交付前（因目前仍需 CSV/SQL，不符「幹事自行操作」）

> 三者**只需 #15 Audit、不需 #19 角色**，可先於角色交付。

- [x] #5A 名冊瀏覽（最小欄位、server 分頁）— **Wave 1c 完成**
  - Gate：`/admin/members` 預設 SSR 第一頁；`repo.listMembers` **在 DB 排序 `(display_name, id)` 再 range**（全序才能 offset 分頁）；欄位僅姓名/遮罩電話/車牌摘要/角色/綁定；**不匯出、不 bulk、不預載敏感事由**（P2 事由只在明細頁）；頁面加 `force-dynamic`/`revalidate=0`（現在 SSR 遮罩 PII）；搜尋維持 POST、名冊 URL 只有 `?page=N`。
  - `?page=` 只收 plain positive **safe** integer（擋 `1.5`/`1e3`/`Infinity`/超大數/`string[]`）；超界 **redirect 到 canonical 最後一頁**。
  - **實作發現的真 bug**：PostgREST 對超界 offset 回 416/`PGRST103` ⇒ `?page=999` 原會 500、redirect 永遠跑不到；已改為視為空頁並另查 count。
  - role 分級仍待 #19；**現階段全名冊對所有 admin 可見**（已明確接受）。
  - Source：feature-triage.md #5A
- [ ] #15 稽核 substrate（Audit Log 地基）
  - Gate：既有 `audit_logs` 補 insert path；actor 模型（`actor_type`+`actor_id`+`actor_role_snapshot`）；DB append-only
  - Source：feature-triage.md #15（Wave 2A）
- [ ] #10 P2 寫入型覆核（依賴 #15）
  - Gate：`review_status` 權威、`p2_eligible` 衍生、樂觀鎖；v1 只 `approved/revoked`
  - Source：feature-triage.md #10（Wave 2B）
- [ ] #14A 車位容量設定（依賴 #15）
  - Gate：`total_capacity`/`blocked_spaces`（顯示「保留·停用」）；`effective_capacity >= approved_count` 由 **DB RPC 在 txn 內**檢查
  - Source：feature-triage.md #14A（Wave 2B）
- [x] #12 資料最小化橫幅 — **Wave 1c 完成**
  - Gate：`DataMinimizationNotice` 掛在 `/admin/eligibility` 與 `/admin/members/[id]`，**在事由/眷屬出現之前**；明示不索取/不儲存/不顯示診斷證明、病歷。
  - 文案採「**請勿詢問或登錄診斷細節**」——初稿「如需確認請當面了解」會招來當面問診，已棄用。
  - Source：feature-triage.md #12

---

## 可交付後迭代（依賴分組，較易讀）

- **通知便利性**：#7 → #6 → #26 → #3 → #4
  - #26 LIFF deep-link 按鈕＝#25 的正解（讓通知一觸開會員頁動作）
- **管理與治理**：#8、#9、#14B、#17、#18、**#19（角色地基，Wave 2C）**、#5B
- **會員與分析**：#11、#16、#28

### a11y／UI polish（Wave 1a code-review 發現，皆非 correctness）

- [ ] **header popover/menu 的鍵盤語意一致性**
  - 現況：`app/staff/StaffCheckIn.tsx` 的 ⋯ 選單用 `role="menu"`/`role="menuitem"`，宣告了方向鍵導覽語意但未實作（單一 action 下無害，Tab 即可達）。
  - Gate：在 a11y slice 統一決定——要嘛補完整 menu keyboard behavior，要嘛降級成一般 popover 不宣告 menu role。與既有「modal focus-trap」同一主題，宜一併處理。
  - Source：Wave 1a code-review finding
- [ ] **選單 click-through 行為**
  - 現況：點外面關閉選單時，該次點擊會穿透觸發下層按鈕（如點名列）。目前由既有 5 秒 undo 視窗兜底；settle 在確認 sheet 後、無法被此路徑觸發。
  - Gate：決定是否吞掉關閉當次的點擊（dismiss-only），或維持穿透。
  - Source：Wave 1a code-review finding
- [ ] **`docs/ui-mockups/screen-state-map.md` 首頁描述過期**
  - 現況：仍寫「首頁導覽（8 卡）／8 個 `Link` 到子頁」，但 `AdminHome.tsx` 自 Slice 3.5 起已改為純歡迎頁（導覽移到 sidebar）。**既有過期、與 Wave 1a 無關**（該刀只更新列印那列）。
  - Gate：更正為 sidebar 導覽現況。
  - Source：Wave 1a code-review finding（既有 doc drift）

---

## DEFERRED — PIN 自動派送（#3 群發 / #4 個別私訊）

**明確延後，交付前不做。** 理由：

- **cron retry 反覆旋轉 PIN ＝最大風險**：明碼不落地（scrypt 單向），push 失敗**無法重送同一組碼**，只能撤舊碼產新碼——若讓 cron 自動 retry，會反覆旋轉 PIN、把已發給同工的碼作廢。
- 需獨立安全 design review（service 邊界、groupId allowlist/不 auto-trust webhook、每次旋轉寫 audit）。#4 另需同工完成 OA 綁定＋輪值表 model。
- **人工重發 PIN 已能運作**（`/admin/staff-pin` 重發＝新碼、舊碼立即失效，手動轉交當週同工）——交付風險反而遠低於仍碰 SQL 的 #10/#14A。

詳見 [feature-triage.md](feature-triage.md) #3/#4 與「建議動工順序」（#3 排 Wave 4 最後、語意最敏感）。
