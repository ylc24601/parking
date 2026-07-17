# 功能想法 Triage（rev.3 — 兩輪外部審查後接近定稿）

> 目的：Phase 9 收官後的功能規劃；記錄可行性與**實作語意決策**。**已動工：Wave -1/0/0.1/1 ✅、2A-1／2A-2 ✅、2B-1 ✅、2B-2a／2B-2b ✅**（每列狀態欄為準；實作與規格分歧處**一律以實作為準**並記在該列與 migration 標頭）。
> rev.1（2026-07-16）：30 條判定＋動工順序。
> rev.2：一輪審查，修規格＋改 delivery-first 排序。
> rev.3：二輪審查，修實作語意（PIN 旋轉、commit-then-dispatch、雙真相、actor 模型、拒絕科學記號…）＋拆 Wave 2A/2B/2C。
> 對應：[current_handoff.md](current_handoff.md)（每刀 merge 後同步，最新到 Wave 2B-2b）、[prod-deploy-runbook.md](prod-deploy-runbook.md)。

---

## 判定圖例

| 判定 | 意義 |
|------|------|
| ✅ 加入 backlog | 可行、值得做 |
| 🕒 defer | 可做但現在不划算，或有前置依賴 |
| ❌ 不做 | 與隱私邊界／架構衝突，或成本不成比例 |

規模：S（<半天）／M（1–2 天）／L（需切多刀）。

---

## 想法一覽

| # | 想法 | surface | 規模 | 判定（Wave） | 備註（含兩輪審查修正） |
|---|------|---------|------|------|------|
| 1 | 換人「換碼」＋手動轉發文案 | admin/staff-pin | S | ✅（-1） | 重發＝新碼、舊 hash 立即失效。文案：「換人值班？重發即可，舊 PIN 立即失效。請將新 PIN 手動傳給本週值班同工。」 |
| 2 | 顯示回同一組 PIN | admin/staff-pin | — | ❌ | scrypt 單向、明碼不落地；換人本就該撤舊碼。 |
| 3 | PIN 自動發同工 LINE 群 | webhook/通知/cron | **M＋安全 design review** | ✅（4） | ⚠️ **cron retry 反覆旋轉 PIN＝最大風險**。明碼不落地→push 失敗**無法重送同碼**，只能撤舊碼產新碼。**service 邊界**：`issueAndSendToGroup(eventId)`（cron 唯一入口、一次性；內部 issue 回明碼→in-process 交 push，明碼不持久化）／`rotateAndSend(eventId)`（**admin 專用**，撤上一組再產新碼送）。**push 失敗＝不自動 retry、標記「派送失敗」**，管理者手動「重新發碼並再送」（＝旋轉）。每次旋轉寫 audit。groupId 走 **allowlist/啟用流程**，不 auto-trust webhook。需獨立 design review。 |
| 4 | PIN 個別私訊值班人 | 通知＋綁定＋輪值表 | L | ✅ defer（4） | 需同工完成 OA 綁定；全自動需輪值表 model。 |
| 5A | 名冊瀏覽（最小欄位、server 分頁） | admin/members | M | ✅（1） | server pagination；欄位僅姓名/遮罩電話/車牌摘要/狀態；**不匯出、不 bulk、不預載敏感事由**，點入才讀完整。可在 role 前上（現有 admin session gate）；明確接受「全名冊可見」姿態先於 role。 |
| 5B | 名冊匯出/批次/敏感欄位權限 | admin/members | M | ✅（3） | **依賴 #19**：誰可看完整電話/匯出/批次/敏感資格。 |
| 6A | Admin 憑車牌移車（第一版） | admin/members＋通知 | M | ✅（4） | 走通用通知目的地模型。含：憑車牌搜尋、車主解析、**未綁 LINE gating（明示無法通知不假送）**、二次確認、遮罩姓名+完整車牌核對、可選原因（擋出入口/車燈/施工/其他）、同車牌 5–10min 冷卻、reservation-independent dedupe、enqueue、**當次操作結果**、audit。送出後只顯示「通知已排入傳送，暫時無法送達會自動重試」。role：幹事可用、不看 ops 內部（#19 matrix）。 |
| 6B | 移車通知歷史/狀態（polish） | admin/members | M | ✅ defer（後續） | 最近通知時間+狀態、重送入口/歷史。**避免第一版耦合完整 outbox 狀態 UI**（pending/processing/sent/retrying/failed）。 |
| 7 | 移車/急件即時通知 | 通知/dispatcher | S–M | ✅（4） | **commit 後才 dispatch**：txn（業務寫入＋enqueue）→**commit**→回業務成功→**commit 後** best-effort「只 claim 這筆/dedupe key」bounded dispatch→LINE 失敗不回滾、cron 續 retry。（不可在 txn 未 commit 時觸發 dispatcher——另一連線看不到 row/讀到未完成狀態。）UI 三態文案：已排入／已送達／暫時失敗稍後重試。 |
| 8 | 本週概覽（上指標下待辦） | admin/page | M | ✅（3） | 鎖管理日曆當週主日（非 `getActiveEvent`）；標本週階段。容量顯示用**「可分配/保留·停用」總數，不用「外賓」字樣**（對齊 #14A 單一 blocked）。 |
| 9 | Sidebar 待辦徽章 | admin sidebar | S–M | ✅（3） | 與 #8 共用 **server-side query/service contract**（不硬 RPC）；business semantics 留 service；layout 一次取。先定義各 badge（P2 待審 status／牧養 open vs overdue／backlog pending vs 超時／系統健康**只系統管理員可見**）。 |
| 10 | P2 寫入型覆核 | admin/members/[id]＋eligibility inline | M | ✅ **交付阻擋已解除（2B-2a 模型 PR #41 / `155c7f7`；2B-2b 寫入 RPC＋明細頁 UI PR #42 / `c536b01`）；2B-2c 佇列列內操作＝非阻擋性便利化** | **避免雙重真相**：`review_status` 為權威、`p2_eligible` 改為衍生。**實作與本規格四處刻意分歧（以實作為準，見 [0032](../parking-system/supabase/migrations/0032_p2_review_status.sql) 標頭）**：① `p2_eligible` 衍生自 **`review_status='approved'` 而已、不含任何日期**——含日期會把「寫入者的 as-of」烘進去，兩個 reader 各自繼承（見 §6 2B-2a 的 silent-P3）。② **不新增 `effective_until`**：`p2_valid_until` 已經是截止日、正是 `priority.ts` 讀的權威，再加一個就是本列要消滅的雙重真相；只加 `p2_valid_from`。③ enum **三態** `unreviewed/approved/revoked`——`revoked` 必須代表「人撤銷過」，舊 false 回填成 revoked 是憑空捏造。④ **不加 `updated_at`**：樂觀鎖是 `review_version`（counter 非 timestamp，`0022:118-120`），顯示權威是 `reviewed_at`，該欄無消費者。<br>**2B-2a 已含**：`reviewed_by` FK 由 `users`→`admin_accounts`（原本根本存不進自己的覆核者）、`review_note`、`review_version`、幼兒到期改學年度制、匯入不得復活已撤銷者、**audit sanitizer 擋生日值**。**2B-2b 已含**（[0033](../parking-system/supabase/migrations/0033_p2_review_rpcs.sql)）：`set_p2_eligibility`／`mark_p2_reviewed`（「標記已覆核」≠「核准」，且**永不 inert**、不可照抄 0031 的 no-op 規則）、明細頁 inline `EligibilityForm`、匯入 precedence（**CSV 可建立無人決定過的資格，但不得覆寫任何人工治理欄**⇒`retained_governed`）、治理邊界收斂成**單一欄 `reviewed_at is not null`**（非 `review_version > 0`——那代表「RPC 寫過」不是「人決定過」）、**幼兒到期公式進 SQL 成 `IMMUTABLE` 函式＋CHECK** ⇒ 2B-2a 明寫的殘留（「不可覛改」只靠 UI）已關閉。**2B-2c 剩**：佇列列內操作（共用同一 service，非阻擋）。`pending/needs_information/rejected` 仍綁 #11——`mark_p2_reviewed` 用 **allowlist `<> 'approved'`** 拒絕，故 #11 新增狀態會 fail closed 而非默默可覆核。**依賴 #15，不依賴 #19**。 |
| 11 | P2 會友自助申請＋待審 inbox | member＋eligibility | L | ✅ defer（5） | #10 的完整五態 enum 在此補齊。 |
| 12 | 資料最小化橫幅 | eligibility, members/[id] | S | ✅（1） | 明示「不索取/不顯示診斷證明」。 |
| 13 | P1 同工名單＋「本週不停」自動釋出 | admin | M–L | 🕒 defer | auto-release 業務規則未定。 |
| 14A | 車位容量設定（交付前） | admin＋weekly_events | M | ✅ **已完成（2B-1，PR #40 / `8de24a0`）** | 解決「幹事不用 SQL 改容量」。`total_capacity`／`blocked_spaces`（顯示「保留·停用」、**不拆外賓/維修**）／effective 預覽。**transactional guard**：已分配後 `effective_capacity >= approved_count` 由 **DB RPC 在 txn 內**檢查（不能只 UI 警告）。寫 audit。**依賴 #15，不依賴 #19**。<br>**實作差異**：promised 集合＝`('approved','temp_approved')` 而非只 approved（`temp_approved` 已佔位，見 §6 2B-1）；`admin_reserved` 已**摺入 `blocked_spaces`** 並 `check (admin_reserved = 0)` 釘住 ⇒「保留·停用」單一數字**可證明**是全部。 |
| 14B | 申請開放 override（後續） | admin＋weekly_events | M | ✅ defer（3） | `application_override` enum（`automatic`/`forced_open`/`forced_closed`）。規則未定：與時間視窗互動、關閉後既有申請、分配後重開——先不做，不卡 14A。 |
| 15 | 稽核記錄（Audit Log） — 地基 | 橫切＋唯讀頁 | L | ✅ **全部完成**：**2A-1 ✅**（PR #38 / `8513912`）＋**2A-2 viewer ✅**（PR #39 / `d2e6890`）＋**2A-3 retention ✅**（PR #43 / `5db33bc`，migration `0034`） | **實作與下列原始規格有四處刻意分歧，以實作為準（見 [0030](../parking-system/supabase/migrations/0030_audit_substrate.sql) 標頭）**：①「app role 只 INSERT/SELECT」**做不到也不夠**——app 跑 service_role、RLS 對它無效，且 0004 已 blanket grant DML；改為 **revoke DML（含 TRUNCATE）＋ trigger 雙層**，且明確**不宣稱 immutability**（owner 仍有 DDL）、**不防 omission**（只提高偽造成本）。②「單一 RPC」升級為 **`private.append_audit_log`，EXECUTE 不授權給任何人**（含 service_role），只有 owner-controlled `SECURITY DEFINER` 業務 RPC 能在**業務 txn 內**呼叫＝audit 與業務同生共死。③ 治理拒絕**必須 typed return 不可 raise**（raise 會把記錄拒絕的那列一起 rollback）。④ metadata **flat depth-1**＋PII key denylist，由 RPC 內部組裝。原始規格其餘照做：actor 模型（actor_type enum＋actor_id＋actor_session_id＋actor_role_snapshot，**無 FK**）、存 ID 不存姓名、request_id（改 **NOT NULL**）、result（`success/denied/conflict`）。exemplar＝`set_admin_disabled`；其餘記錄項（容量/P2/PIN/群組/車牌 CRUD）隨各自 slice 接入。<br>原始規格存參：表已存在（[0003_infra.sql:49](../parking-system/supabase/migrations/0003_infra.sql#L49)）**無 insert path**→補 insert substrate。**actor 模型：`actor_type` enum（admin/staff_session/member/job/system）＋`actor_id` nullable＋`actor_role_snapshot` nullable**（不要四個 nullable FK；`actor_id` 為 snapshot ref、不做通用 FK）。**存 ID 不存姓名**，顯示時 join；刪除者顯示「已刪除會友（ID 尾碼 xxxx）」→ 故 **admin 帳號 soft-disable 不 hard-delete**（現況已 disabled_at）。其餘欄：action/entity_type/entity_id/event_id/request_id/result/metadata_redacted(allowlist)/created_at。**DB append-only**：app role 只 INSERT/SELECT、單一 RPC、**永不寫 PII/token/LINE ID**、retention 用受限 maintenance function。記錄：role change/帳號停用/容量修改/P2 覆核/PIN rotation/群組設定/會員車牌 CRUD。<br>**2A-3 retention（[0034](../parking-system/supabase/migrations/0034_audit_retention_purge.sql)）**：`purge_audit_logs` 每月清 24 個月前的列。**逃生口＝雙鎖**（交易域 GUC `audit.allow_purge` 只有 purge fn 開＋`current_user`＝table owner；SECURITY DEFINER 以 owner 身分執行、直接 service_role delete 不是 owner）⇒ 即使未來重演 blanket grant 也刪不掉；`UPDATE`/`TRUNCATE` 恆擋。**時鐘用 DB 的 `now()`、不收 `p_now`**（呼叫端傳未來時間即可洗掉全表——與 binding-PII 前例的有意分歧，因早刪 audit 不可逆）。`audit.substrate_enabled`／`audit.retention_purge` retention-exempt；只在真的刪了才寫 marker（否則永久灌爆）。verifier 釘 **fn owner ＝ table owner**（否則鎖2 連合法 purge 都擋）。UI 文案翻面「紀錄保留 24 個月，逾期後由定期維運作業清除」，**部署硬前置**＝prod cron 先設好（runbook §13）。 |
| 16 | 停車樣態分析（先聚合） | admin＋歷史 | L | ✅（5） | 開放 P3 決策支援；價值隨營運週數累積；不列具名 No-show 排名。 |
| 17 | 營運狀態頁 B＋C | admin/ops＋sidebar | M | ✅（3） | B 摺疊技術細節；C（有 #19）完整 ops 只給系統管理員。UTC→台北、改名、移 sidebar 最下。 |
| 18 | 側欄 IA 兩區 | admin sidebar | S–M | ✅（3） | 日常/系統維運，分區線＝#19 角色邊界。 |
| 19 | Admin 角色分級（兩級）＋新增管理者 | admin/accounts＋橫切 | M–L（地基） | ✅（**2C**） | 系統管理員/幹事；`role` enum（預留唯讀）。**session：敏感操作每 request 從 DB 讀 active+role**（既有 session 已重查 `disabled_at` [adminAuth.ts:36](../parking-system/server/http/adminAuth.ts#L36)，role 沿同路、不塞 cookie）；role 變更/停用 bump `session_version` 或刪 sessions；sidebar 隱藏只 UX。guardrails：不停用/降級最後一位系統管理員、不自我升權、禁自我降/停、CLI bootstrap=系統管理員、UI 預設幹事、重設密碼撤 sessions。role matrix 明確定義。 |
| 20 | 匯入中文 header＋reason 對照 | lib/memberImport | S | ✅（0） | ✅ reason 值已驗證＝現有 canonical（[DB enum p2_reason 0001:7](../parking-system/supabase/migrations/0001_enums_core.sql#L7)、TS `P2Reason`）：`mobility_long/mobility_short/pregnancy/elderly_companion/child_companion`（1–4 只是 CSV 輸入碼）。做法：**中文→canonical 集中在單一 `REASON_ALIASES` constant**，實作前對照 `memberImport.ts`/DB enum，別讓 parser/UI/DB 各一套。**未知→preview 錯誤要人工選、不 silently map、不解析模糊備註判敏感資格**。 |
| 21 | 簡易全體會友匯入 | admin/import＋service | M | ✅（0） | **重用既有 `memberImportService` 的 dry-run preview／`phoneNameConflicts`/`plateConflicts`/`reviewRequired`／apply**（非重建）。測試兩模式共存（P2 完整 vs 一般名冊）。 |
| 22 | 匯入手機容錯 | lib/memberImport `normalizePhone` | S | ✅（0） | 去非數字後：10 碼合 `^09\d{8}$` 接受／**9 碼合 `^9\d{8}$` 前置補一個 `0`（非字串「09」）再驗**／**科學記號（如 `9.12346E+8`）拒絕並提示「將 Excel 欄設文字後重匯」，不嘗試還原**（Excel 已捨入不可靠）／`+886`·`886` 是否支援另定。測試涵蓋全部。 |
| 23 | 點名備援清單搬 admin | /staff/print→admin | S–M | ✅（1） | 新增 `/admin/print`（gate `getAdminSession`，event 用管理日曆當週主日）；**`/staff/print` 移除或回 staff 首頁、不 redirect 到 /admin**（跨 auth domain 混亂）；**更新測試確認 staff PIN 不再能取列印資料**。資料源/`lib/staffRow`/`PrintButton` 全重用，保留 Staff-safe 最小內容。 |
| 24 | staff footer 精簡 | /staff StaffCheckIn | S | ✅（1，於 #23 後） | footer 只留「＋登記現場車輛」；結束鍵移 header 選單、保留二次確認。 |
| 25 | 通知死指令修正 | templates.ts | S | ✅ **必修（-1）** | 「回覆正在路上/請回覆確認」被 webhook ignored。全 template copy audit（≥2 則同類）。短期改寫指向 LIFF；正解=#26。 |
| 26 | 通知 LIFF deep-link 按鈕 | 通知模板＋LIFF | M | ✅（4） | 確認保留/放棄、正在路上、回會員頁點擊即開 LIFF。 |
| 27 | 通知內容 enrich | 通知模板＋payload | S–M | ✅（1） | 日期＋車牌＋粗體期限＋換行；producer 補 plate/date 到 payload。 |
| 28 | 管理我的車牌（全自助） | app/member＋新 routes | M | ✅（5） | 新增/刪除/設預設＋暱稱。**刪除擋所有未結束關聯**（upcoming open/waiting/approved/temp-approved·offer/未 finalized 已釋出/未來多週）；**soft delete（`active=false`）保留歷史 FK**。normalize＋unique on normalized plate；collision 訊息不洩他人姓名；set default transactional；至少留一台或明確允許零台。**增刪寫 audit**。濫用治理＝輕護欄（plate 唯一性＋audit＋一人一週一位天花板）＋社群處理（勸導→停用）。 |
| 29 | member 顯示候補序號 | app/member | S | ✅（1） | 「目前候補第 N 位」＋「順序可能因取消、資格與分配狀態而變動」（動態非固定號碼）。 |
| 30 | 取消加「不計違規」reassurance | app/member CancelButton | S | ✅（1） | 「10:30 前取消不計違規」，讓會友安心取消。可順帶補申請表「週五18:00截止」。 |

---

## 審查後的關鍵設計決策（跨切地基）

- **通用通知目的地模型** → #3/#6/#7。`recipient_kind`(member/line_group)＋`context_kind`(reservation/weekly_event/vehicle/system)＋nullable `recipient_user_id`/`weekly_event_id`/`reservation_id`/`vehicle_id`＋受控 `recipient_line_target`，加 **DB CHECK constraint** 保證每組合必要欄位。`groupId` 不顯示於一般 UI、不進 log/錯誤、不被 webhook 覆寫，走 allowlist/啟用確認。
- **稽核 substrate**（既有 `audit_logs` 補 insert）→ #10/#14A/#19/#28/所有寫入。`actor_type`＋`actor_id`＋`actor_role_snapshot`（非多個 nullable FK）；存 ID、DB 層 append-only。詳見 #15。
- **待辦計數 service contract**（不硬 RPC）→ #8/#9。
- **P2 寫入 service（review_status 權威、p2_eligible 衍生、樂觀鎖）** → #10。✅ **已建成**：`server/services/p2EligibilityService.ts`＋`POST /api/admin/eligibility`（2B-2b）；2B-2c 佇列與 #11 自助申請都接同一支，不得另開寫入路徑。
- **Admin 角色 enum＋session 撤銷** → #17-C/#18/#19/#5B/#6 matrix。
- **依賴關係（rev.3 釐清）**：`#10 需 #15、不需 #19`；`#14A 需 #15、不需 #19`；`#5B/#17/#18 需 #19`。→ Audit 與角色兩地基**可分離**，讓 #10/#14A 先於角色交付。

---

## 建議動工順序（rev.3 — delivery-first）

> prod 已 walkthrough 並清回 baseline；正式資料/OA/文案未完成。排序以交付價值優先。
> **每刀 prompt 固定加**：改 Next.js route/server action/cookie/layout/middleware/caching/navigation 前，先讀 `node_modules/next/dist/docs/` 對應文件，不靠記憶（`parking-system/AGENTS.md`）。

**Wave -1：文件與通知 correctness** — 更新 `current_handoff.md`（嚴重過期）／建 `pre-delivery-polish-backlog.md`／#25／#1／明列 PIN 自動派送 deferred
**Wave 0：正式資料匯入** — #20／#21（重用既有 preview/conflict）／#22（科學記號拒絕）／測試兩模式共存
**Wave 1：低風險交付 UX** — #23→#24／#30／#29／#12／#27／#5A
**Wave 2A：寫入治理地基** — #15 Audit substrate ✅ **全部完成**。**拆三刀：2A-1 substrate ✅（PR #38 / `8513912`）／2A-2 read-only viewer ✅（PR #39 / `d2e6890`，app-only 無 migration）／2A-3 retention ✅（PR #43 / `5db33bc`，migration `0034`）**
**Wave 2B：關鍵 Admin 寫入**（需 #15、不需 #19）— **2B-1 #14A 車位容量 ✅（PR #40 / `8de24a0`，migration `0031`）／#10 P2 覆核：2B-2a 模型 ✅（PR #41 / `155c7f7`，migration `0032`）、2B-2b 寫入 RPC＋UI ✅（PR #42 / `c536b01`，migration `0033`）⇒ Wave 2B 交付阻擋全部解除／2B-2c 佇列列內操作（非阻擋，可留交付後）**
**Wave 2C：角色地基** — #19 Admin roles＋session 撤銷＋role matrix
**Wave 3：其餘管理功能** — #8／#9／#17／#18／#5B／#14B override
**Wave 4：通知便利性** — 通用 destination model→#7→#6A（#6B 後續）→#3（最後，語意最敏感）→#4／#26
**Wave 5：會員自助與分析** — #28／#11／#16／#13
**Deferred/不做**：#2 ❌

---

## 交付分級

**交付前必修**：文件同步、#25、#20、#21、#22、#23、#24、#27、#30
**強烈建議交付前 — 全部完成 ✅**：#5A ✅、**#15 ✅（2A-1／2A-2／2A-3 全完成）→ 稽核有邊界、可清理**、**#14A ✅（2B-1）→ 容量已不需 SQL**、**#10 ✅（2B-2a＋2B-2b）→ 資格已不需 CSV**（幹事可自行核准/撤銷，且 CSV 不再能推翻人工決定；2B-2c 佇列列內操作為便利化、不阻擋交付）、#12 ✅。**⇒ 此清單已清空，開發面可進正式交付收尾**（剩交付後 ops，見 runbook §8/§13；及非阻擋 backlog：2B-2c、Wave 2C #19、retire `admin_reserved`）。

### Audit retention 政策（✅ 已實作於 2A-3 / `0034`）
**線上保留 24 個月、每月清理一次；不宣稱永久保存。** 理由：涵蓋兩個完整年度週期足以處理資格/容量/帳號/操作爭議；本系統非金融、醫療或法定會計帳冊，無支持永久保存的內控需求；audit 雖已最小化仍含 actor/entity stable ID，無限保存違反資料最小化；「量不大所以永不刪」不是治理政策。
規則：cutoff `created_at < now() - interval '24 months'`／受限 `SECURITY DEFINER` maintenance function／bounded batches／purge 只記 cutoff＋deleted_count，**不記被刪 ID 或其 metadata**。
**`audit.substrate_enabled` 與 `audit.retention_purge` 為 retention-exempt**——保留「trail 從何時開始、歷史依哪個政策被清」。
✅ 實作（`0034`）：0030 的 append-only trigger 擋掉**所有** DELETE，purge 的逃生口＝**雙鎖**——交易域 GUC `audit.allow_purge`（只有 `purge_audit_logs` 用 `set_config(...,true)` 開）＋ `current_user` ＝ table owner（SECURITY DEFINER 以 owner 執行、直接 service_role delete 不是 owner）。**時鐘用 DB `now()`、RPC 不收 `p_now`**（呼叫端傳未來時間即可洗全表；審查必改 1，與 binding-PII 前例的有意分歧）。verifier 釘 fn owner ＝ table owner（否則鎖2 連合法 purge 都擋）。UI 文案翻面的**部署硬前置**＝prod cron 先設好（runbook §13）。
**可交付後迭代**：#3、#4、#6、#8、#9、#11、#14B、#16、#17、#18、#19、#28、#5B
> #3 雖方便但人工重發 PIN 已能運作；反而 #10/#14A 仍碰 SQL 的交付風險更高。角色分級（#19）可留交付後。
> **更新（2026-07-17）**：#14A（2B-1）與 #10（2B-2a＋2B-2b）皆已完成 ⇒ **上句所指的交付風險已消除**，容量與 P2 資格都有 audited 的 Admin UI 路徑。僅存的「仍需手打 SQL」缺口是 **runbook §12.1 Step 0 的遠期 demo event 容量**（`/admin/capacity` 刻意只給當週/次週，見 §8 Wave 2B-1），屬 demo 走查而非同工日常營運。
