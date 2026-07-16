# 功能想法 Triage（rev.2 — 已外部審查一輪）

> 目的：Phase 9 收官後，逐一討論想改動的功能，記錄可行性與設計決策；**尚未實作**。
> rev.1：2026-07-16 完成 30 條判定＋動工順序。
> rev.2：2026-07-16 經一輪外部審查，修正規格與**改為 delivery-first 排序**（見文末）。
> 對應：[current_handoff.md](current_handoff.md)（⚠️ 已過期，Wave -1 待修）、[prod-deploy-runbook.md](prod-deploy-runbook.md)、[v2-backlog.md](v2-backlog.md)

---

## 判定圖例 (verdict legend)

| 判定 | 意義 |
|------|------|
| ✅ 加入 backlog | 可行、值得做 |
| 🕒 defer / 延後 | 可做但現在不划算，或有前置依賴 |
| ❌ 不做 | 與隱私邊界／架構衝突，或成本不成比例 |

規模標記：S（<半天）／M（1–2 天）／L（需切多刀）。

---

## 想法一覽（30 條）

| # | 想法 | 相關 surface | 規模 | 判定 | 備註（含審查後修正） |
|---|------|--------------|------|------|------|
| 1 | 換人值班「換碼」（撤舊碼）＋手動轉發文案 | admin/staff-pin | S | ✅ 現有即正解 | 現有「重新發碼」＝新碼、舊 hash 立即失效。文案：「換人值班？重發即可，舊 PIN 立即失效。請將新 PIN 手動傳給本週值班同工。」**交付前完成**（配合 #3/#4 deferred）。 |
| 2 | 顯示回當週同一組 PIN | admin/staff-pin | — | ❌ 不做 | scrypt 單向、明碼不落地；換人本就該撤舊碼，看回舊碼反安全。 |
| 3 | PIN 每週**自動發同工 LINE 群** | webhook/通知/cron/staff-pin | **M＋安全 design review** | ✅ backlog（Wave 4） | ⚠️ **最大風險＝cron retry 反覆旋轉 PIN**（重跑再發碼→舊碼立即失效）。**採方案 A**：產碼+push **同步一次**、失敗→標記人工重發（明碼不落地，無法自動重送同碼）、**不建可逆秘密儲存**。`ensureWeeklyStaffPin(eventId)` 冪等（當週已有自動批次有效 PIN 則不重發）。每次旋轉寫 audit。groupId 走 **allowlist/啟用流程**，不 auto-trust webhook 捕獲。需獨立 design review。 |
| 4 | PIN**個別私訊**當週值班人 | 通知＋member 綁定＋輪值表 | L | ✅ defer（Wave 4，於 #3 後） | 需值班同工完成 OA 綁定（都是會友但不一定已綁）。全自動選人需系統內輪值表 model。 |
| 5A | 名冊瀏覽：**列全部會友（最小欄位、server 分頁）** | admin/members | M | ✅ backlog（Wave 1） | server-side pagination、25–50/頁；欄位僅**姓名/遮罩電話/車牌摘要或遮罩/啟用·綁定·資格狀態**；不預載眷屬/敏感事由、**不匯出、不 bulk edit**、點入明細才讀完整。可在 role 前上（現有 admin session gate）；**明確接受**「全名冊可見」隱私姿態先於 role。不把全體載入 client 再前端分頁。 |
| 5B | 名冊**匯出/批次/敏感欄位權限** | admin/members | M | ✅ backlog（Wave 3） | 依賴 #19：幹事能否看完整電話、誰可匯出、誰可批次、誰可看敏感資格詳情。 |
| 6 | Admin **憑車牌隨時請移車** | admin/members（新動作）＋通知 | M–L | ✅ backlog（Wave 4） | 走**通用通知目的地模型**（見地基）。護欄：**二次確認、遮罩姓名+完整車牌供核對、可選原因（擋出入口/車燈/施工/其他）、同車牌 5–10min 冷卻、reservation-independent dedupe、audit、顯示最近通知時間+狀態、未綁 LINE 明示「無法通知」不假裝送**。role：**幹事可用、但不看 ops 技術細節**（#19 matrix）。 |
| 7 | 移車/急件**即時通知** | 通知/dispatcher | S–M | ✅ backlog（Wave 4） | **best-effort、不阻塞業務操作**：txn 內 enqueue 成功即回→best-effort 觸發「只 claim 這筆/dedupe key」的 bounded dispatch→LINE 失敗不回滾業務、cron 續 retry。UI **三態文案**：已排入傳送／已送達 LINE／暫時失敗稍後重試（不用模糊「通知成功」）。 |
| 8 | **本週概覽**（Admin 首頁，上指標下待辦） | admin/page（現空） | M | ✅ backlog（Wave 3） | 必鎖**管理日曆當週主日**（非 `getActiveEvent`）；標本週階段數字才可解讀。容量顯示用**「可分配 / 保留·停用」總數，不用「外賓」字樣**（與 #14 單一 blocked 語意對齊）。上 KPI 下待辦連各頁；mockup 快速操作為各自獨立功能，先 link-only。 |
| 9 | **Sidebar 待辦徽章** | admin sidebar | S–M | ✅ backlog（Wave 3） | 與 #8 待辦共用**一份 server-side query/service contract**（不硬「一支 RPC」）；business semantics 留 service、SQL 只聚合；layout 一次取傳 sidebar、每頁不重複呼叫；暫不 polling。**先定義各 badge**：P2 待審=哪些 status／牧養=open 或 overdue／通知 backlog=全 pending 或超時／系統健康異常**只系統管理員可見**。 |
| 10 | **P2 寫入型覆核**（狀態機） | admin/members/[id]＋admin/eligibility inline | M | ✅ backlog（Wave 3） | **不只幾顆按鈕**：資料層先定 `review_status` enum（pending/approved/rejected/needs_information/revoked）＋`reviewed_at/by`、`review_note`、`effective_from/until`、`revoked_at/by`、**`version`/`updated_at` optimistic lock（兩 admin 併發覆蓋）**。「標記已覆核」≠「核准資格」（不同動作）。UX：寫入放明細頁、eligibility 頁保留佇列＋inline，共用寫入 service。 |
| 11 | **P2 會友自助申請＋待審 inbox** | member＋admin/eligibility | L | ✅ backlog（Wave 5，於 #10 後） | 現無自助送件流程，要新建送件 UI＋進件審核。 |
| 12 | **資料最小化橫幅** | admin/eligibility, members/[id] | S | ✅ backlog（Wave 1） | 明示「不索取/不顯示診斷證明」。便宜治理訊號。 |
| 13 | P1 全職同工名單管理＋「本週不停」自動釋出 | admin（新） | M–L | 🕒 defer / 另計 | auto-release 是未定業務規則（mockup 標「提案待確認」）。 |
| 14 | **本週車位設定** | admin（新）＋weekly_events | M | ✅ backlog（Wave 3） | **transactional guard**：當週已分配後 `effective_capacity >= approved_count` 由 **DB RPC 在 txn 內**檢查更新（不能只靠 UI 警告）。**第一版單一 blocked 語意**：`total_capacity`／`blocked_spaces`（顯示用「保留·停用」字樣，**不拆外賓/維修**、不加未定業務語意）／`application_override` enum（`automatic`/`forced_open`/`forced_closed`，比 boolean 清楚）。toggle 語意要定義：override vs 時間規則、關閉後已送申請如何處理、分配後重開是否允許。未來拆欄再保留 constraint。 |
| 15 | **稽核記錄（Audit Log）** — 地基 | 橫切（所有寫入）＋唯讀頁 | L | ✅ backlog（Wave 2） | ✅ **表已存在**（[0003_infra.sql:49](../parking-system/supabase/migrations/0003_infra.sql#L49) `audit_logs`）但**無 insert path**→這刀＝補 insert substrate＋對齊/補欄位。**存 ID 不存姓名**：actor_admin_id/actor_role_snapshot/action/entity_type/entity_id/event_id/request_id/result/metadata_redacted/created_at；顯示時 join，刪除者顯示「已刪除會友（ID 尾碼 xxxx）」。**actor 多型**（Admin/Staff/Member 自助/Job/System，非 `admin_id NOT NULL`）。**DB 落實 append-only**：app role 只 INSERT/SELECT、單一 RPC、metadata allowlist（不塞 raw body）、**永不寫 PII/token/LINE ID**、retention 用受限 maintenance function。記錄：role change/帳號停用/容量修改/P2 覆核/PIN rotation/群組設定/**會員車牌 CRUD(#28)**。 |
| 16 | **停車樣態分析**（先聚合） | admin（新）＋歷史 | L | ✅ backlog（Wave 5） | 決策支援：開放 P3 依據。價值隨營運週數累積；「候補等待週數」需先定義；圖表用 dataviz skill。**不列具名 No-show 排名**。 |
| 17 | **營運狀態頁重構 B＋C** | admin/ops＋sidebar | M | ✅ backlog（Wave 3） | B：白話健康＋「怎麼辦」在上、技術細節+重送工具摺疊。C（有 #19）：完整技術 ops 只給系統管理員。quick win：UTC→台北、改名（→系統通知健康）、異常給指引、移 sidebar 最下。 |
| 18 | **側欄資訊架構重整**（日常/系統維運兩區） | admin sidebar | S–M | ✅ backlog（Wave 3） | 上區日常工作、下區系統維運（車位設定·稽核·營運狀態）。**分區線 = #19 角色邊界**。 |
| 19 | **Admin 角色分級（兩級）＋新增管理者 UI** | admin/accounts＋橫切敏感面 | M–L（地基） | ✅ backlog（Wave 2） | 兩級＝**系統管理員/幹事**（照人設命名）。**`role` enum**（非 boolean，預留第三級唯讀）。**session：敏感操作每次從 DB 讀 current active+role**（既有 session 已每 request 重查 `disabled_at` [adminAuth.ts:36](../parking-system/server/http/adminAuth.ts#L36)，role 沿同路、**不塞 cookie**）；sidebar 隱藏只 UX 非安全控制；role 變更/停用 bump `session_version` 或刪該帳號 sessions。guardrails：不停用/降級最後一位系統管理員、不自我升權、禁自我降/停、CLI bootstrap=系統管理員、UI 新增預設=幹事、重設密碼撤舊 sessions。**role matrix 明確定義**（含 #6 幹事可用移車但不看 ops 內部）。 |
| 20 | **匯入器支援中文 header ＋中文 reason 對照** | lib/memberImport | S | ✅ backlog（Wave 0） | 中文→英文 header 對照＋**明確 reason 值對照**（行動不便長期→mobility_long／短期→mobility_short／陪同長者→elderly_companion／陪同幼兒→child_companion／懷孕→pregnancy）。**未知→preview 錯誤要人工選、不 silently map、不解析模糊備註判敏感資格**。讓 [import-templates](import-templates/) 可直接匯入。 |
| 21 | **簡易全體會友匯入**（reason 選填） | admin/import＋匯入 service | M | ✅ backlog（Wave 0） | 新增一般會友匯入變體，**重用既有 `memberImportService` 的 dry-run preview、`phoneNameConflicts`/`plateConflicts`/`reviewRequired`、apply 流程**（非重建）。測試**兩模式共存不互破**（P2 完整申請 vs 一般精簡名冊）。對應 [會友簡易名單範本](import-templates/會友簡易名單範本.csv)。 |
| 22 | **匯入手機容錯補 0**（Excel 掉前導零） | lib/memberImport `normalizePhone` | S | ✅ backlog（Wave 0） | ⚠️ 修正：**補「一個 `0`」不是字串「09」**（否則 11 碼）。規格：去非數字後 → 10 碼合 `^09\d{8}$` 接受／**9 碼合 `^9\d{8}$` 前置補一個 0 再驗**／其他拒絕不猜。測試：Excel numeric cell、scientific notation、前後空白、`+886…`、`886…`、固網誤入、9 碼非 9 開頭。`+886` 是否接受另定，但不 silently 過度推測。 |
| 23 | **點名備援清單搬 admin** | /staff/print → admin＋sidebar | S–M | ✅ backlog（Wave 1） | staff 地下室無印表機、列印非 staff 權限。event 解析用管理日曆當週主日、gate 改 `getAdminSession`。資料源/`lib/staffRow`/`PrintButton` 全重用；保留 Staff-safe 最小內容。放側欄日常工作區。 |
| 24 | **staff footer 精簡**（結束鍵移 header） | /staff StaffCheckIn | S | ✅ backlog（Wave 1，於 #23 後） | footer 只留全寬「＋登記現場車輛」；「結束當週點名」移 header 選單、保留二次確認。省兩列、零誤觸。 |
| 25 | **通知文案 correctness 修正**（死指令） | templates.ts | S | ✅ **go-live 必修（Wave -1）** | webhook capture-only、「回覆正在路上/請回覆確認」被 ignored→P2 以為講了、車位照釋出。**Wave -1 做全 template copy audit**（`p2_arrival_reminder`＋`offer_2hr_confirm` 至少兩則同類）：短期改寫指向 LIFF/移除該句；正解=#26。 |
| 26 | **通知可動作化：LIFF deep-link 按鈕** | 通知模板＋LIFF | M | ✅ backlog（Wave 4） | 確認保留/放棄、正在路上、回會員頁做成點擊即開 LIFF。吸收 phase9「通知 deep-link」backlog。 |
| 27 | **通知內容 enrich**（日期＋車牌＋粗體期限＋換行） | 通知模板＋producer payload | S–M | ✅ backlog（Wave 1） | 現況核准通知無日期/車牌/具體時間。producer 端須補 plate/date 到 payload。語氣維持。 |
| 28 | **管理我的車牌**（member 自助 CRUD，全自助） | app/member＋新 routes | M | ✅ backlog（Wave 5） | 新增/刪除/設預設全自助＋暱稱。**刪除擋所有未結束關聯**（upcoming open event/waiting/approved/temp-approved·offer/未 finalized 之已釋出/未來多週）；**soft delete（`active=false`）保留歷史 reservation FK**，不 hard delete 用過的車牌。normalize 大小寫/空白/連字號＋**unique on normalized plate**；collision 安全訊息**不洩另一車主姓名**；set default 要 transactional；至少留一台或明確允許零台。**增刪寫 audit（#15）**。濫用治理（P2 出借）＝輕護欄（plate 唯一性＋audit 可見＋一人一週一位天花板）＋社群處理（勸導→停用）。 |
| 29 | **member 顯示候補序號** | app/member 狀態卡 | S | ✅ backlog（Wave 1） | 顯示**「目前候補第 N 位」**＋一行「順序可能因取消、資格與分配狀態而變動」（rank 動態、非固定號碼）。 |
| 30 | **取消加「恩慈／不計違規」reassurance** | app/member CancelButton | S | ✅ backlog（Wave 1） | 現況缺「10:30 前取消不計違規」。行為面：讓會友安心取消、不硬佔車位害候補白等。可順帶補申請表「週五18:00截止」提示。 |

---

## 審查後的關鍵設計決策（跨切地基）

動工時一次做、多功能共用。這些決策已納入上表對應列：

- **通用通知目的地模型**（取代「把 FK 改 nullable」）→ #3/#6/#7 共用。明確欄位：`recipient_kind`（member / line_group）、`context_kind`（reservation / weekly_event / vehicle / system）、`recipient_user_id` nullable、`recipient_line_target`（受控）、`weekly_event_id`/`reservation_id`/`vehicle_id` nullable，並加 **DB CHECK constraint** 確保每種組合的必要欄位（member+vehicle=移車、line_group+weekly_event=PIN 群、member+reservation=核准/取消/遞補）。`groupId` 屬 LINE 群識別資訊：不顯示於一般 Admin UI、不進 log/錯誤訊息、不被 webhook 任意覆寫，走 **allowlist/啟用確認**。
- **稽核 substrate**（既有 `audit_logs` 表補 insert）→ #10/#14/#19/#28/所有寫入吐稽核。存 ID 不存姓名、actor 多型、DB 層 append-only。詳見 #15。
- **待辦計數 service contract**（不硬 RPC）→ #8/#9。repository 聚合、service 定 badge 語意、layout 一次取。
- **P2 寫入 service（含 review_status 狀態機＋optimistic lock）** → #10。
- **Admin 角色 enum ＋ session 撤銷/版本** → #17-C/#18/#19/#5B/#6 role matrix。一條角色線同時定義「誰能看/操作」與側欄分區。

---

## 建議動工順序（rev.2 — delivery-first）

> 背景：prod 已完成 walkthrough 並清回 baseline；**正式教會資料、正式 OA、文案 sign-off 尚未完成**。排序以「交付價值」優先，大型地基延後至真正需要時。
> 每刀走 plan mode＋外部審查。**每刀 prompt 固定加**：修改 Next.js route/server action/cookie/layout/middleware/caching/navigation 前，先讀 `node_modules/next/dist/docs/` 對應文件，不靠記憶（見 `parking-system/AGENTS.md`）。

**Wave -1：文件與通知 correctness**
- 更新 `current_handoff.md`（現況嚴重過期，仍寫 Phase 3/4）
- 建立 `pre-delivery-polish-backlog.md`；指定 source of truth（現況=handoff／prod 操作=runbook／功能=polish backlog）
- **#25** 通知死指令＋全 template copy audit
- **#1** 換碼＋手動轉發文案
- 明列「PIN 自動派送（#3/#4）不在本次交付範圍，交付初期幹事手動轉發」

**Wave 0：正式資料匯入**
- **#20** 中文 header＋reason 對照
- **#21** 簡易會友匯入（重用既有 dry-run/conflict pipeline）
- **#22** 補前導零
- 測試 P2 完整匯入與一般名冊匯入共存

**Wave 1：低風險交付 UX**
- **#23** 列印搬 Admin → **#24** Staff footer
- **#30** 取消 reassurance、**#29** 候補序號、**#12** 隱私橫幅、**#27** 通知 enrich
- **#5A** 最小欄位、分頁式全體名冊

**Wave 2：治理地基**
- **#15** Audit Log substrate
- **#19** Admin roles ＋ session 撤銷 ＋ role matrix

**Wave 3：管理功能**
- **#10** P2 寫入覆核、**#14** 單一 `blocked_spaces` 車位設定
- **#8** 概覽（用「保留/停用」總數）、**#9** 徽章
- **#17/#18** Ops 與 sidebar 分層、**#5B** 匯出/批次/敏感欄位權限

**Wave 4：通知便利性**
- 通用 notification destination model → **#7** 即時 dispatch → **#6** 任意車牌移車 → **#3** PIN 發群（最後，語意最敏感）→ **#4** 個別私訊

**Wave 5：會員自助與長期分析**
- **#28** 管理車牌、**#11** P2 自助申請、**#16** 聚合分析、**#13** P1 名單/auto-release

**Deferred/不做**：#2 ❌。

---

## 交付分級（避免 polish 膨脹成新 Phase）

**交付前必修**：文件同步、#25、#20、#21、#22、#23、#24、#27、#30
**強烈建議交付前**：#5A、#10、#14、#12
> 原因：資格維護與車位容量目前仍需 CSV/SQL，不符「教會幹事可自行操作」的交付目標。

**可交付後迭代**：#3、#4、#8、#9、#11、#16、#17、#18、#28、#5B
> #3 雖方便，但人工 Admin 重發 PIN 已能運作；反而 #10/#14 仍碰 SQL 的交付風險更高。
