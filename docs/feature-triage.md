# Feature Triage — 功能決策索引

> 最後檢視：2026-07-30

## 本檔回答什麼

**記錄**：① 哪些功能值得做　② 何時做　③ 尚未完成項目的產品與實作邊界。

**不記錄**：production go-live 操作、目前 repo 實作狀態、完整施工歷史、交付門檻勾選清單——這些各有專屬權威檔，本檔不重述。

### Source of truth

| 問題 | 權威 |
|---|---|
| 功能決策／優先序 | **本檔** |
| 目前 repo 實作狀態與施工歷史 | [current_handoff.md](current_handoff.md) |
| production / pilot ops | [go-live-checklist.md](go-live-checklist.md) |
| 交付門檻可勾清單 | [pre-delivery-polish-backlog.md](pre-delivery-polish-backlog.md) |
| 程式實際語意 | code / migration 標頭 |

### desired behavior vs current behavior

```
Accepted future scope / desired behavior  → 本檔 Active feature details
Current implemented behavior              → code / migration
```

feature **尚未完成時，兩者不同是預期狀態**，不是矛盾。
標為 `Done` 後仍不同 ⇒ **以 implementation 為準**，並把差異記入該項 `History`。

---

## 詞彙表

| 欄位 | 允許值 | 中文 |
|---|---|---|
| **Decision** | `Do` | 已接受、值得做 |
| | `Reject` | 不做 |
| **Status** | `Ready` | 規格已足夠開工 |
| | `Blocked` | 缺一個**別人要給的**決策（產品規則／domain 語意），實作者無法自行決定 |
| | `Deferred` | 規格已夠、無待決事項，純粹刻意排到未來 |
| | `Done` | 已實作完成並 merge |
| | `Closed` | 決定不做、已結案 |
| **Delivery** | `Pre-delivery` | 交付前 |
| | `Pre-pilot` | pilot 前 |
| | `Pilot-early` | pilot 初期 |
| | `Post-delivery` | 交付後 |
| | `—` | 無交付時點，或已完成 |
| **Size** | `S` | < 半天 |
| | `S–M` / `M` / `M–L` | 介於之間／1–2 天／偏大 |
| | `L` | 需切多刀 |
| **Deployment** | `None` / `App-only` / `Migration` / `Migration + App` / `Config` / `TBD` | 這項功能的 rollout 類型 |

**`Blocked` 優先於 `Deferred`**：只要存在一個實作者無法自行決定的待決事項，一律 `Blocked`，不論排程多後面。

**分界線**：slice 內的**設計工作**（安全 design review、要建的新 model、選型）算在工作量裡 ⇒ 仍是 `Deferred`（例：#3 需獨立 design review、#4 需輪值表 model，兩者的約束都已寫定）。**別人要給的決策**（產品規則、domain 語意）⇒ `Blocked`（例：#28「至少留一台或允許零台」、34a `profile_confirmed_at` 語意）。
判準：**這件事我讀完規格能自己決定嗎？** 能 ⇒ `Deferred`；不能 ⇒ `Blocked`。

**`Delivery` 與 `Deployment` 不同**：`Delivery` 答「何時交付」，完成後成為 `—`；`Deployment` 答「rollout 類型」，**完成後仍保留**（例如 #19 帶 migration `0035`/`0036`，清成 `—` 就是在 canonical state 裡丟資訊）。

**Emoji 只作視覺輔助，不承擔 machine semantics**——不再使用 `✅ defer`、`✅（4）` 這類把 acceptance 與 timing 混在一起的複合符號。

### Validation invariants

```
Reject           ⇔ Closed
Done | Closed    ⇒ 不出現在 Current work
Blocked          ⇒ details 內必須有 "Unresolved decision" 段落，明載待決事項
Deferred         ⇒ details 內不得有 Unresolved decision（有 ⇒ 應為 Blocked）
Ready | Pre-*    ⇒ details 內必須有 Acceptance 段落
Done             ⇒ Acceptance 已由實作／驗證滿足
```

---

## Canonical layer

**本檔內哪一段是權威**（避免 dashboard／inventory／details／compatibility view 形成新的四重真相）：

| 區塊 | 角色 |
|---|---|
| **Feature inventory** | **canonical state（top-level）** — Decision / Status / Delivery / Size / Deployment 的唯一權威 |
| **#34 Work items 表** | **canonical state（#34 internal）** — 唯一例外；#34 六個子刀狀態各異，單一 row 表達不了 |
| **Active feature details** | **canonical specification** — Problem / Decision / Constraints / Acceptance 的唯一權威 |
| **Current work** | dashboard，純 projection，不建立新語意 |
| **交付分級** | compatibility view，為既有外部引用保留 |
| **Archive** | historical, **non-normative** |

不一致時：狀態以 inventory（`#34` 子項以 Work items 表）為準，規格以 details 為準。

---

## Current work

> 只回答「現在下一步」。不出現 `Done`／`Closed`，也不列完整 post-delivery backlog（那在「交付分級」）。

| Work | Status | Delivery | Why now |
|---|---|---|---|
| #33a 眷屬年齡＋學齡前 badge | `Ready` | `Pre-delivery` | 交付前唯一剩項；app-only、零新增揭露 |
| #35 本週申請清單 | `Ready` | `Pre-pilot` | 試營運除錯：今天**沒有任何一頁**看得到 pending／waiting 是誰，只能下 SQL |
| 34-0 Import integrity | `Ready` | `Pre-pilot` | 下一輪正式資料導入前的營運風險 |
| 34-0b-A Import auditability | `Ready` | `Pre-pilot` | 影響最大的批次寫入是唯一沒有 audit 的路徑 |
| 34a Profile completeness | **`Blocked`** | `Pre-pilot` | 仍是 pilot gate，但**先定 `profile_confirmed_at` 語意**再開工 |
| #36 晚鳥即時預約 | **`Blocked`** | `Pre-pilot` | PRD 已寫、實作沒做，落差已教錯會友一次；**先釘並發／公平規則**再開工 |
| 34b 會友自助維護 | `Deferred` | `Pilot-early` | 接 `0038` 已備妥的 vehicle lifecycle |
| #11 P2 自助申請 | `Deferred` | `Pilot-early` | 與 34b 合併規劃，治理仍留 admin |

**其餘 `Blocked`（不在近期視野）**：#13 P1 每週狀態生命週期未定／#14B override 與時間視窗互動規則未定／#28「至少留一台或允許零台」未定／#31 眷屬 model 與撤銷語意未定。

---

## Feature inventory

> **canonical state。** 一行一條，含已完成項。規格細節見「Active feature details」，已完成項全文見「Archive」。

| ID | Feature | Surface | Decision | Status | Delivery | Size | Deployment | Wave | 摘要 |
|---|---|---|---|---|---|---|---|---|---|
| #1 | 換人「換碼」＋手動轉發文案 | admin/staff-pin | Do | Done | — | S | App-only | -1 | 重發＝新碼、舊 hash 立即失效 |
| #2 | 顯示回同一組 PIN | admin/staff-pin | Reject | Closed | — | — | None | — | scrypt 單向、明碼不落地 |
| #3 | PIN 自動發同工 LINE 群 | webhook/通知/cron | Do | Deferred | Post-delivery | M | Migration + App | 4 | cron retry 反覆旋轉 PIN 為最大風險；需獨立 design review |
| #4 | PIN 個別私訊值班人 | 通知＋綁定＋輪值表 | Do | Deferred | Post-delivery | L | TBD | 4 | 需同工完成 OA 綁定；全自動需輪值表 model |
| #5A | 名冊瀏覽（最小欄位、server 分頁） | admin/members | Do | Done | — | M | App-only | 1 | 不匯出、不 bulk、不預載敏感事由 |
| #5B | 名冊匯出／批次／敏感欄位權限 | admin/members | Do | Deferred | Post-delivery | M | Migration + App | 3d | 5B-a 匯出已完成（`0037`）；5B-b 顯示分級、5B-c 批次待做 |
| #6A | Admin 憑車牌移車（第一版） | admin/members＋通知 | Do | Deferred | Post-delivery | M | Migration + App | 4 | 走通用通知目的地模型；未綁 LINE 明示不假送 |
| #6B | 移車通知歷史／狀態（polish） | admin/members | Do | Deferred | Post-delivery | M | App-only | 後續 | 避免第一版耦合完整 outbox 狀態 UI |
| #7 | 移車／急件即時通知 | 通知/dispatcher | Do | Deferred | Post-delivery | S–M | Migration + App | 4 | commit 後才 dispatch；UI 三態文案 |
| #8 | 本週概覽（上指標下待辦） | admin/page | Do | Done | — | M | App-only | 3a | `getWeekOverview`＋`deriveWeekStage`（PR #47） |
| #9 | Sidebar 待辦徽章 | admin sidebar | Do | Done | — | S–M | App-only | 3a | snapshot 模型：layout 一次取、Provider 餵側欄＋概覽（PR #47） |
| #10 | P2 寫入型覆核 | admin/members/[id]＋eligibility inline | Do | Deferred | Post-delivery | M | Migration + App | 2B-2 | 2B-2a／2B-2b 已完成（`0032`/`0033`）；剩 2B-2c 佇列列內操作 |
| #11 | P2 會友自助申請＋待審 inbox | member＋eligibility | Do | Deferred | Pilot-early | L | TBD | 5 | #10 的完整五態 enum 在此補齊 |
| #12 | 資料最小化橫幅 | eligibility, members/[id] | Do | Done | — | S | App-only | 1 | 明示不索取／不顯示診斷證明 |
| #13 | P1 同工名單＋本週是否需要系統車位 | admin | Do | Blocked | — | M–L | TBD | — | 每週狀態生命週期未定（初始化／標記責任／鎖定時點）；UI 須問「是否需要系統車位」而非「有沒有來」 |
| #14A | 車位容量設定 | admin＋weekly_events | Do | Done | — | M | Migration + App | 2B-1 | 幹事不用 SQL 改容量；DB RPC 在 txn 內守 capacity（`0031`） |
| #14B | 申請開放 override | admin＋weekly_events | Do | Blocked | — | M | TBD | 3 | `application_override` enum；與時間視窗互動規則未定 |
| #15 | 稽核記錄（Audit Log）— 地基 | 橫切＋唯讀頁 | Do | Done | — | L | Migration + App | 2A | substrate／viewer／retention 三刀全完成（`0030`/`0034`） |
| #16 | 停車樣態分析（先聚合） | admin＋歷史 | Do | Deferred | Post-delivery | L | TBD | 5 | 價值隨營運週數累積；不列具名 No-show 排名 |
| #17 | 營運狀態頁 B＋C | admin/ops＋sidebar | Do | Done | — | M | App-only | 3b | 頁改名「通知系統狀態」；幹事只收 health enum |
| #18 | 側欄 IA 兩區 | admin sidebar | Do | Done | — | S–M | App-only | 3c | `daily`/`system` 是 IA 非 auth boundary |
| #19 | Admin 角色分級（兩級）＋新增管理者 | admin/accounts＋橫切 | Do | Done | — | M–L | Migration + App | 2C | 系統管理員／幹事；`0035`/`0036`（PR #45/#46） |
| #20 | 匯入中文 header＋reason 對照 | lib/memberImport | Do | Done | — | S | App-only | 0 | 中文→canonical 集中在單一 `REASON_ALIASES` |
| #21 | 簡易全體會友匯入 | admin/import＋service | Do | Done | — | M | App-only | 0 | 重用既有 `memberImportService`，非重建 |
| #22 | 匯入手機容錯 | lib/memberImport | Do | Done | — | S | App-only | 0 | 9 碼補 `0`；科學記號拒絕不還原 |
| #23 | 點名備援清單搬 admin | /staff/print→admin | Do | Done | — | S–M | App-only | 1 | 新增 `/admin/print`；staff PIN 不再能取列印資料 |
| #24 | staff footer 精簡 | /staff StaffCheckIn | Do | Done | — | S | App-only | 1 | footer 只留「＋登記現場車輛」 |
| #25 | 通知死指令修正 | templates.ts | Do | Done | — | S | App-only | -1 | 「回覆」被 webhook ignored；改導向會員頁 |
| #26 | 通知 LIFF deep-link 按鈕 | 通知模板＋LIFF | Do | Deferred | Post-delivery | M | App-only | 4 | #25 的正解 |
| #27 | 通知內容 enrich | 通知模板＋payload | Do | Done | — | S–M | App-only | 1 | 日期＋車牌＋粗體期限＋換行 |
| #28 | 管理我的車牌（全自助） | app/member＋新 routes | Do | Blocked | Post-delivery | M | App-only | 5 | DB 語意已由 `0038` 交付；剩會友端 UI 與產品決定 |
| #29 | member 顯示候補序號 | app/member | Do | Done | — | S | App-only | 1 | 動態序號非固定號碼 |
| #30 | 取消加「不計違規」reassurance | app/member CancelButton | Do | Done | — | S | App-only | 1 | 讓會友安心取消 |
| #31 | 一位會友同時符合多種 P2 事由 | DB `users`＋import＋#10 覆核 | Do | Blocked | Post-delivery | M–L | Migration + App | — | 風險在效期不在優先序；眷屬 model 與撤銷語意未定 |
| #32 | 本週概覽沒有目前申請狀況 | admin/page | Do | Done | — | S | App-only | 3e | 補 `pending`／`waiting` 兩數字＋優先·一般拆解，同一支 `getWeekOverview`（PR #59） |
| #33a | 眷屬顯示年齡＋幼兒學齡前 badge | admin/members/[id] | Do | **Ready** | **Pre-delivery** | S | App-only | 3e | 標籤定義只能是 `childCompanionValidUntil`，不得新寫規則 |
| #33b | 覆核佇列帶眷屬衍生 enum | admin/eligibility | Reject | Closed | — | S | None | — | 不為此放寬該頁隱私姿態（使用者 2026-07-28 定） |
| #34 | **Member Data Lifecycle**（Epic） | 匯入 UI／member LIFF／#10／綁定 | Do | **Ready** | **Pre-pilot** | L | TBD | — | 子刀狀態見 #34 Work items 表 |
| #35 | 本週申請清單（點數字看名單） | admin/week（新頁） | Do | **Ready** | **Pre-pilot** | S–M | App-only | 3f | #32 的下游；pending／waiting 目前無任何 UI 可見 |
| #36 | 週五分配後晚鳥即時預約 | member apply＋`0023` RPC | Do | **Blocked** | **Pre-pilot** | M | Migration + App | — | PRD §六.3 已寫、**未實作**；並發／公平規則待釘 |

---

## Cross-feature invariants

> 跨 feature 的不變量。各 feature 只寫 `Invariants: INV-0x` 指標，不再逐條複述。

- **`INV-01` P2 governance** — P2 寫入 service（`review_status` 權威、`p2_eligible` 衍生、樂觀鎖）→ #10。✅ **已建成**：`server/services/p2EligibilityService.ts`＋`POST /api/admin/eligibility`（2B-2b）；2B-2c 佇列與 #11 自助申請、**#34 會友自助補正**都接同一支，不得另開寫入路徑。**`review_status` 只是 P2 eligibility 的治理權威，不是整份 profile 的 approval flag** —— 只有 P2 提案落 `unreviewed`，且**永不**由會友端直接寫 `review_status`／`p2_valid_*`（與匯入的 `retained_governed` 同一條線）。
- **`INV-02` Member profile completeness** — `getMemberCompleteness` **server authoritative、UI 只拿結果顯示**；表單與匯入共用同一份 condition-aware 規則，**不可演變成 CSV validator 一套、LIFF form 一套、Admin review 又一套**。
- **`INV-03` Vehicle lifecycle** — `0038` 已備妥：soft delete（`is_active=false` 保留歷史 FK）／**使用中才唯一**（`vehicles_active_plate_uq` partial）／未結束預約擋停用（交易內、車列鎖下判定）／衝突訊息不洩他人姓名（只回 `active_plate_owned_by_other`）／增刪寫 audit。→ #28／#34b。
- **`INV-04` Audit actor model** — 既有 `audit_logs` 補 insert substrate → #10/#14A/#19/#28/所有寫入。`actor_type`＋`actor_id`＋`actor_role_snapshot`（非多個 nullable FK）；**存 ID、DB 層 append-only**；audit 與業務**同 transaction**（route 後補 audit ❌）。audit `actor_type='member'` 已預留。詳見 #15。
- **`INV-05` Notification dispatch** — 通用通知目的地模型 → #3/#6/#7。`recipient_kind`(member/line_group)＋`context_kind`(reservation/weekly_event/vehicle/system)＋nullable `recipient_user_id`/`weekly_event_id`/`reservation_id`/`vehicle_id`＋受控 `recipient_line_target`，加 **DB CHECK constraint** 保證每組合必要欄位。`groupId` 不顯示於一般 UI、不進 log/錯誤、不被 webhook 覆寫，走 allowlist/啟用確認。**commit-then-dispatch**：txn commit 後才 dispatch。
- **`INV-06` Admin role boundary** — Admin 角色 enum＋session 撤銷 → #17-C/#18/#19/#5B/#6 matrix。敏感操作每 request 從 DB 讀 active+role，不塞 cookie；role 變更／停用 bump `session_version` 或刪 sessions；sidebar 隱藏只 UX。
- **「會友提案 → 幹事覆核」骨架** → #11／#34。**三種語意必須分開，不可共用一個 approval flag**（外部審查修正）：**① 基本資料 completeness（`INV-02`）／② 車輛 maintenance（`INV-03`，本人可直接改）／③ P2 application-review（`INV-01`）**。

---

## Active feature details

> **canonical specification。** 狀態以 `Feature inventory` 為準（`#34` 子項以下方 Work items 表為準）。
> 每項固定四層：`Problem`（為什麼）／`Decision`＋`Constraints`（要做什麼、不做什麼）／`Acceptance`（怎麼算完成）／`History`（決策沿革，**非需求**）。
> `Acceptance` 是 `Ready` 與 `Pre-delivery`／`Pre-pilot` 項目的**必要欄位**（見 Validation invariants）；`Deferred` 項可在排入近期時再補，不預先虛構驗收標準。
> `Blocked` 項必須有 `Unresolved decision` 段落，寫明**誰要決定什麼**。

---

### #3 PIN 自動發同工 LINE 群

**Decision:** Do ｜ **Status:** Deferred ｜ **Delivery:** Post-delivery
**Size:** M（＋安全 design review）｜ **Deployment:** Migration + App ｜ **Invariants:** INV-04, INV-05

#### Problem
⚠️ **cron retry 反覆旋轉 PIN＝最大風險**。明碼不落地→push 失敗**無法重送同碼**，只能撤舊碼產新碼。

#### Decision
**service 邊界**：`issueAndSendToGroup(eventId)`（cron 唯一入口、一次性；內部 issue 回明碼→in-process 交 push，明碼不持久化）／`rotateAndSend(eventId)`（**admin 專用**，撤上一組再產新碼送）。

#### Constraints
**push 失敗＝不自動 retry、標記「派送失敗」**，管理者手動「重新發碼並再送」（＝旋轉）。每次旋轉寫 audit。groupId 走 **allowlist/啟用流程**，不 auto-trust webhook。需獨立 design review。

#### History
Wave 4（排最後，語意最敏感）。人工重發 PIN 已能運作，故不阻擋交付。

---

### #4 PIN 個別私訊值班人

**Decision:** Do ｜ **Status:** Deferred ｜ **Delivery:** Post-delivery
**Size:** L ｜ **Deployment:** TBD ｜ **Depends on:** 同工 OA 綁定、輪值表 model ｜ **Invariants:** INV-05

#### Constraints
需同工完成 OA 綁定；全自動需輪值表 model。

#### History
Wave 4。

---

### #5B 名冊匯出／批次／敏感欄位權限

**Decision:** Do ｜ **Status:** Deferred ｜ **Delivery:** Post-delivery
**Size:** M ｜ **Deployment:** Migration + App ｜ **Depends on:** #19 ｜ **Invariants:** INV-04, INV-06
**Remaining slices:** 5B-b、5B-c

#### Current scope — 5B-b／5B-c
**5B-b 敏感欄位顯示分級**（明細頁依角色遮罩眷屬/生日）＋**5B-c 批次** → **post-delivery deferred**（無具體需求；今日幹事仍看完整電話/P2 事由，本刀不碰）。

#### Completed history — 5B-a（Wave 3 3d，PR #50 `314d838`，migration `0037`）
**5B-a 名冊匯出**（僅系統管理員、含 audit）✅：新 capability `export_members`＋POST `/api/admin/members/export`（body-less、`guardAdminOrigin`、`no-store`）＋keyset 讀（cutoff）＋spreadsheet-injection 防護＋migration `0037` `log_member_roster_export`（FOR SHARE 重新授權＋audit `member_roster.export`，denied 不稽核）。**非 round-trip**（人類可讀行政匯出）。

---

### #6A Admin 憑車牌移車（第一版）

**Decision:** Do ｜ **Status:** Deferred ｜ **Delivery:** Post-delivery
**Size:** M ｜ **Deployment:** Migration + App ｜ **Depends on:** INV-05 destination model ｜ **Invariants:** INV-04, INV-05, INV-06

#### Decision
走通用通知目的地模型。含：憑車牌搜尋、車主解析、**未綁 LINE gating（明示無法通知不假送）**、二次確認、遮罩姓名+完整車牌核對、可選原因（擋出入口/車燈/施工/其他）、同車牌 5–10min 冷卻、reservation-independent dedupe、enqueue、**當次操作結果**、audit。

#### Constraints
送出後只顯示「通知已排入傳送，暫時無法送達會自動重試」。role：幹事可用、不看 ops 內部（#19 matrix）。

#### History
Wave 4。

---

### #6B 移車通知歷史／狀態（polish）

**Decision:** Do ｜ **Status:** Deferred ｜ **Delivery:** Post-delivery
**Size:** M ｜ **Deployment:** App-only ｜ **Depends on:** #6A

#### Decision
最近通知時間+狀態、重送入口/歷史。

#### Constraints
**避免第一版耦合完整 outbox 狀態 UI**（pending/processing/sent/retrying/failed）。

---

### #7 移車／急件即時通知

**Decision:** Do ｜ **Status:** Deferred ｜ **Delivery:** Post-delivery
**Size:** S–M ｜ **Deployment:** Migration + App ｜ **Invariants:** INV-05

#### Decision
**commit 後才 dispatch**：txn（業務寫入＋enqueue）→**commit**→回業務成功→**commit 後** best-effort「只 claim 這筆/dedupe key」bounded dispatch→LINE 失敗不回滾、cron 續 retry。

#### Constraints
（不可在 txn 未 commit 時觸發 dispatcher——另一連線看不到 row/讀到未完成狀態。）UI 三態文案：已排入／已送達／暫時失敗稍後重試。

#### History
Wave 4，排在 destination model 之後、#6A 之前。

---

### #10 P2 寫入型覆核

**Decision:** Do ｜ **Status:** Deferred ｜ **Delivery:** Post-delivery
**Size:** M ｜ **Deployment:** Migration + App ｜ **Depends on:** #15（不依賴 #19）｜ **Invariants:** INV-01, INV-04
**Remaining slice:** 2B-2c（佇列列內操作）

#### Current scope — 2B-2c
**2B-2c 剩**：佇列列內操作（共用同一 service，非阻擋）。

#### Decision
**避免雙重真相**：`review_status` 為權威、`p2_eligible` 改為衍生。

#### Constraints
`pending/needs_information/rejected` 仍綁 #11——`mark_p2_reviewed` 用 **allowlist `<> 'approved'`** 拒絕，故 #11 新增狀態會 fail closed 而非默默可覆核。

#### Completed history — 2B-2a／2B-2b

> **Historical specification — superseded by implementation**（實作為準，見 [0032](../parking-system/supabase/migrations/0032_p2_review_status.sql) 標頭）

**實作與本規格四處刻意分歧**：
- ① `p2_eligible` 衍生自 **`review_status='approved'` 而已、不含任何日期**——含日期會把「寫入者的 as-of」烘進去，兩個 reader 各自繼承（見 §6 2B-2a 的 silent-P3）。
- ② **不新增 `effective_until`**：`p2_valid_until` 已經是截止日、正是 `priority.ts` 讀的權威，再加一個就是本列要消滅的雙重真相；只加 `p2_valid_from`。
- ③ enum **三態** `unreviewed/approved/revoked`——`revoked` 必須代表「人撤銷過」，舊 false 回填成 revoked 是憑空捏造。
- ④ **不加 `updated_at`**：樂觀鎖是 `review_version`（counter 非 timestamp，`0022:118-120`），顯示權威是 `reviewed_at`，該欄無消費者。

**2B-2a 已含**（PR #41 / `155c7f7`，migration `0032`）：`reviewed_by` FK 由 `users`→`admin_accounts`（原本根本存不進自己的覆核者）、`review_note`、`review_version`、幼兒到期改學年度制、匯入不得復活已撤銷者、**audit sanitizer 擋生日值**。

**2B-2b 已含**（PR #42 / `c536b01`，[0033](../parking-system/supabase/migrations/0033_p2_review_rpcs.sql)）：`set_p2_eligibility`／`mark_p2_reviewed`（「標記已覆核」≠「核准」，且**永不 inert**、不可照抄 0031 的 no-op 規則）、明細頁 inline `EligibilityForm`、匯入 precedence（**CSV 可建立無人決定過的資格，但不得覆寫任何人工治理欄**⇒`retained_governed`）、治理邊界收斂成**單一欄 `reviewed_at is not null`**（非 `review_version > 0`——那代表「RPC 寫過」不是「人決定過」）、**幼兒到期公式進 SQL 成 `IMMUTABLE` 函式＋CHECK** ⇒ 2B-2a 明寫的殘留（「不可覛改」只靠 UI）已關閉。

---

### #11 P2 會友自助申請＋待審 inbox

**Decision:** Do ｜ **Status:** Deferred ｜ **Delivery:** Pilot-early
**Size:** L ｜ **Deployment:** TBD ｜ **Depends on:** #10、#34a ｜ **Invariants:** INV-01, INV-02

#### Decision
#10 的完整五態 enum 在此補齊。

#### History
原列 Wave 5；改判為 **pilot 初期**，與 #34b 合併規劃——孩童生日等本人最清楚的資料移回本人輸入，治理仍在 admin。

---

### #13 P1 同工名單＋本週是否需要系統車位

**Decision:** Do ｜ **Status:** **Blocked** ｜ **Delivery:** —
**Size:** M–L ｜ **Deployment:** TBD

#### Unresolved decision（Blocked 原因）
**每週 P1 狀態的生命週期未定**：① 每週的 P1 列如何初始化（誰建、何時建、預設值是什麼）② 由誰負責標記「本週需要系統車位」（同工自己？幹事代填？）③ 何時鎖定／截止後是否還能改。

> 舊敘述為「auto-release 業務規則未定」——那個詞本身就是舊模型的殘留：新語意下沒有「預設保留六格、在外服事再自動 release」這回事，同工平時本來就停自管區、不占系統車位。

#### Constraints（2026-07-30 語意釘正，實作時必須遵守）
- ⚠️ **不得依賴 DB 的 historical `default 'reserved'`**（[0002:23](../parking-system/supabase/migrations/0002_events_reservations.sql#L23)）。那個預設值在**舊模型**下合理（每位 P1 預設占一格、沒來才 skipped），在新語意下卻危險：**建立 weekly P1 列時若沒顯式寫 status，DB 會自動判定「這位同工需要占用 23 格中的一格」**，靜靜吃掉會友的車位。⇒ **writer 必須顯式寫入狀態；未經本週明確判定「需要系統車位」者，不得消耗容量。** 今天沒有任何 writer，所以不是 production bug，但這正是 #13 最容易重新踩回舊模型的地方。
- **UI 要問的是「本週是否需要占用系統管理的車位」，不可問「本週有沒有來／要不要停車」。** 教會另有自行控管的停車區供全職同工使用，**完全不在本系統容量內**；**會來教會但停自管區的人不占系統車位**，兩種問法會得到不同答案。建議形式：

  ```
  王同工   ○ 使用教會自管停車區    ● 本週需保留系統車位
  ```

  而非 `☐ 本週不停車`。
- `active_full_time_staff_reserved` ＝ `COUNT(status='reserved')` ＝ **本週需要占用 23 格中一格的同工數**。`computeCapacity` 的減項因此是正確的、**不需修改**——要守住的是填入這個欄位的語意。
- 舊文件曾把它記成「名單人數 − 本週標記不停車的人數」（＝在數出席）。照那個語意填，同工都來、都停自管區時會算成滿員，**平白吃掉會友的車位**。該敘述已於本刀在 PRD／development_plan／operations guide／`lib/types.ts`／`lib/allocation/allocate.ts`／seed fixture 六處更正。
- **不必改 member apply flow**：全職同工被 `staff_use_p1` 擋在會友申請之外是**設計正確**——P1 要用系統車位不應與 P2/P3 搶排序，而是由本功能標記 `reserved`、讓容量先扣一格。缺的只是操作介面。

---

### #14B 申請開放 override

**Decision:** Do ｜ **Status:** **Blocked** ｜ **Delivery:** —
**Size:** M ｜ **Deployment:** TBD ｜ **Depends on:** #14A（已完成）

#### Decision
`application_override` enum（`automatic`/`forced_open`/`forced_closed`）。

#### Unresolved decision（Blocked 原因）
規則未定：與時間視窗互動、關閉後既有申請、分配後重開——先不做，不卡 14A。

---

### #16 停車樣態分析（先聚合）

**Decision:** Do ｜ **Status:** Deferred ｜ **Delivery:** Post-delivery
**Size:** L ｜ **Deployment:** TBD

#### Decision
開放 P3 決策支援；價值隨營運週數累積。

#### Constraints
不列具名 No-show 排名。

#### History
Wave 5。

---

### #26 通知 LIFF deep-link 按鈕

**Decision:** Do ｜ **Status:** Deferred ｜ **Delivery:** Post-delivery
**Size:** M ｜ **Deployment:** App-only

#### Decision
確認保留/放棄、正在路上、回會員頁點擊即開 LIFF。

#### History
Wave 4。#25 已把「回覆」死指令改成導向會員頁，本項是其正解。

---

### #28 管理我的車牌（全自助）

**Decision:** Do ｜ **Status:** **Blocked** ｜ **Delivery:** Post-delivery
**Size:** M ｜ **Deployment:** App-only ｜ **Invariants:** INV-03, INV-04

#### Problem
**Tier 0-2 做的是 ADMIN 側**（幹事在會友明細頁新增／停用／恢復車輛），會友自助仍待做——但本項要的 DB 語意已經成立且已驗證：**soft delete ＝ `is_active=false`（保留歷史 FK）**、**唯一性改為「使用中才唯一」**（`vehicles_active_plate_uq` partial on `is_active`，車牌因此可轉手而不改寫歷史）、**未結束預約擋停用**（在交易內、車列鎖下判定，狀態集合對齊 `lib/allocation/transitions.ts` 的非終局狀態）、**衝突訊息不洩他人姓名**（只回 `active_plate_owned_by_other`）、**增刪寫 audit**。

#### Current scope
剩下的是會友端 UI／路由、設預設＋暱稱、以及「至少留一台或允許零台」的產品決定。

#### Unresolved decision（Blocked 原因）
**「至少留一台或允許零台」未定**——這是產品規則，實作者無法自行決定：允許零台則會友可把自己停到不能申請；強制留一台則「換車」變成必須先新增再停用。決定後本項即為 `Ready`。

#### Constraints
原始規格：新增/刪除/設預設＋暱稱。**刪除擋所有未結束關聯**（upcoming open/waiting/approved/temp-approved·offer/未 finalized 已釋出/未來多週）；**soft delete（`active=false`）保留歷史 FK**。normalize＋unique on normalized plate；collision 訊息不洩他人姓名；set default transactional；至少留一台或明確允許零台。**增刪寫 audit**。濫用治理＝輕護欄（plate 唯一性＋audit＋一人一週一位天花板）＋社群處理（勸導→停用）。

#### History
Wave 5；地基已由 Tier 0-2（`0038`）交付。

---

### #31 一位會友同時符合多種 P2 事由

**Decision:** Do ｜ **Status:** **Blocked** ｜ **Delivery:** Post-delivery
**Size:** M–L ｜ **Deployment:** Migration + App ｜ **Depends on:** #10（`review_status` 模型已成立）｜ **Invariants:** INV-01

#### Problem
**現況＝一人一事由**：`users.p2_reason` 單欄（[0001:47](../parking-system/supabase/migrations/0001_enums_core.sql#L47)）＋`p2_valid_until` 單一截止日；匯入以手機為會友主鍵，同一人多列 `申請原因` 不一致時 `resolveP2Group` **fail closed 整位跳過**（`GroupConflictField='reason_type'`）。

**真實案例（2026-07-28 首次真會友名冊，已去識別化）**：一位會友一支手機兩台車——一台對應配偶行動不便（原因 1、**永久**），另一台對應幼兒同行（原因 3，`childCompanionValidUntil` 算出的效期為數年後的 8/31）。**兩者同時成立，但系統只能擇一**。

**風險不是優先序、是效期**：P2 有一個成立事由即為 P2，擇一不影響本週分配；但 `p2_valid_until` 會跟著被選中的事由走 ⇒ **選到短效期的那個，資格會提早失效**（本例選了永久的原因 1 是對的，但這靠人判斷、無護欄）。

#### Decision（若要做）
`users` 單欄 → `member_p2_grounds` 一對多（每筆 reason＋眷屬＋valid_until＋各自 review_status），`p2_valid_until` 衍生為 `max(grounds.valid_until)`；匯入改為「同人多事由＝合併不衝突」而非 fail closed；#10 覆核 UI 要能逐事由核准/撤銷。

#### Unresolved decision（Blocked 原因）
**先決條件**：#10 的 `review_status` 權威模型已成立（可直接沿用），但**眷屬 model 與撤銷語意未定**，且無實際需求量（首份名冊 59 位僅 1 例）⇒ 不卡交付。

#### 今日的暫行規則（人工）
**擇一時**：選**效期最長**的事由；被捨棄的事由寫入備註。

---

### #32 首頁「本週概覽」沒有目前申請狀況

**Decision:** Do ｜ **Status:** **Done**（PR #59）｜ **Delivery:** —
**Size:** S ｜ **Deployment:** App-only ｜ **Depends on:** — ｜ **Migration:** No

#### Problem
**（2026-07-28 使用者回報）**：[/admin 首頁](../parking-system/app/admin/AdminOverview.tsx#L88-L96) 上指標只有**車位供給**三個數字——「可分配總數／保留·停用／已核准」（`promised` ＝ `approved`＋`temp_approved`，見 [parkingRepository.ts:2153](../parking-system/server/repositories/parkingRepository.ts#L2153)）。**申請端的需求量完全看不到**：週三～週五 `application_open` 階段，申請都還是 `pending`、分配尚未跑，於是「已核准」恆為 0 ⇒ 幹事**在最需要判斷供需的那幾天，首頁是空的**，只能改去別頁翻。

#### Decision
**要補的兩個數字**：`pending`（申請中）與 `waiting`（候補），且 **`pending` 再拆「優先／一般」**（2026-07-30 使用者提出）。

**為什麼拆得起**：`reservations.effective_priority`（smallint `check in (1,2,3)`，[0002:42](../parking-system/supabase/migrations/0002_events_reservations.sql#L42)）在**申請當下就凍結在該筆預約上** ⇒ 原本那一次 `select('status')` 改成 `select('status, effective_priority')`、在 app 端做二維計數即可。**不新增資料源、不 join `users`、不開 RPC、無 migration**，規模仍是 `S`。

#### Constraints
- 已核准已有、不重複；`attended`/`no_show`/`cancelled_*`/`walk_in` 等**終局狀態屬事後分析（#16），v1 不放**——概覽是「現在要不要處理」不是報表。
- ① 與容量同一支 `getWeekOverview`、同一個 `weekly_event_id`，**不得另開資料源**（否則首頁自己跟自己不一致）。
- ② PostgREST 無 group-by，別為此開 RPC／也別打三次 head-count——**一次 `select('status, effective_priority')` 取本週 reservations 在 app 端計數**即可（本週量級數十筆）。**`countPromisedReservations` 保留不動**（它仍是 `/admin/capacity` 的 promised read path，改簽名會外溢到那一頁）；概覽的 `promised` 改由同一次 select 供給，讓三個 reservation-derived 指標同源。
- ③ **標籤隨階段變**：分配前 `pending` ＝「申請中」；**分配開始後理應趨向 0**（分配會轉成 approved/waiting），仍非 0 時上 warning tone、**不要無條件隱藏**。⚠️ **warning ＝「需要注意」，不等於「有漏勾」**：`hasFridayAllocationRun` 把 `job_runs` 的 `running` 也算已分配（[parkingRepository.ts:2755](../parking-system/server/repositories/parkingRepository.ts#L2755)），而 Friday job 是**先 claim 成 running、才讀 pending 去分配** ⇒ 分配執行中的短暫窗口會**合法**出現這個組合。可能是分配仍在執行、卡住、或有殘留資料，UI 文案不得斷言人為疏漏。
- ④ 供需一眼可讀＝把「申請中」排在「可分配總數」旁。
- ⑤ 純計數、無個資，幹事/系統管理員同視野，**不需 #19 capability 判斷**。
- ⑥ **⚠️ 顯示的是凍結值，且不得改成即時重算**。「優先」的定義是：**週五分配器依凍結的 `effective_priority` 排在一般車之前的 reservation（目前即 `<= 2`）**——不是「P2」。兩者今天數字相同，但定義不同：P1 若存在也屬「優先」（見 Acceptance）。分配器排序讀的就是這個凍結欄位（[sort.ts:15-17](../parking-system/lib/allocation/sort.ts#L15-L17)）⇒ 概覽的「優先 N 位」＝**分配時真的會排在前面的那 N 位**。
  - 凍結值的典型例子：某人申請後 P2 資格才被撤銷，這裡仍計為優先，**與分配結果一致**。任何「順手修正成 join `users` 依今日資格重算」都會造出「概覽說 4 位、分配器算 3 位」的第二真相 ⇒ 明令禁止。
  - 眷屬型 P2（長者／幼兒同行）需當週宣告才是 2，`computeApplyPriority` 申請當下已結算，**不在此重判**。
- ⑦ **不要留一個永遠 0 的 P1 欄**：P1 不走申請流程（全職同工位在 `weekly_staff_allocations`，見 [priority.ts:6-7](../parking-system/lib/allocation/priority.ts#L6-L7)），現場登記固定寫 3（[parkingRepository.ts:1220](../parking-system/server/repositories/parkingRepository.ts#L1220)）⇒ 畫面上只有「優先／一般」兩個數字。「本週同工佔幾位」是另一個資料源，屬 #13。**但 P1 若真出現在 reservation 上，歸入「優先」而非報錯**（見 Acceptance 與 History）。
- ⑧ **service 一律回完整 breakdown、UI v1 只在「申請中」顯示拆解**（使用者 2026-07-30 定）：候補的優先序影響的是遞補順序而非本週供需判斷；日後要顯示不必再改 service。

#### Acceptance
- `application_open` 階段首頁可看到 `pending`／`waiting`；分配後 `pending` 正常為 0、非 0 時呈 warning tone。
- `pending` 顯示「優先／一般」拆解（例「申請中 12（優先 3／一般 9）」），數字取自凍結的 `effective_priority`、**未經任何即時資格重算**；測試需涵蓋「申請後 P2 資格被撤銷、仍計為優先」這一 case（frozen-value 的代表例）。
- **恆等式：優先 ＋ 一般 ＝ 申請中總數**（恆成立，不靠例外維持）。DTO 欄位命名為 **`priority`／`general`**（對齊畫面文案「優先／一般」）而非 `p2`／`p3`：判定為 `effective_priority <= 2` ／ `=== 3`。**P1 計入「優先」、不 fail loud**——理由見下方 History 的 2026-07-30 註記。
- `WeekOverview` type 加欄（含 `waiting` 的 breakdown，即使 UI v1 不顯示）＋既有測試補 case。

#### Implementation notes
**規模 S**：app-only、**無 migration**、無新頁面。預計改動 `AdminOverview`／`adminOverviewService`／`WeekOverview` type。**下游**：兩個數字是 #35 名單頁的入口連結。

#### History
2026-07-28 依使用者實際操作回報加入 triage（Wave 3 3e）。技術上非阻擋（不做也能運作），但它補的是 #8 在 `application_open` 階段**首頁等於空白**的缺口——正是同工交付後每週最常看的那幾天 ⇒ **建議併進交付前收尾**。

**2026-07-30 命名與 P1 處置改判**（推翻同日稍早的 `p2 === 2` ＋ fail-loud 決定）：外部審查正確指出「叫 `p2` 卻用 `<= 2` 等於把 P1＋P2 改名」，但**修正方向選錯了一邊**。改用審查自己提出的另一條路——**欄位改名 `priority`／`general`**，命名與畫面文案一致，`<= 2` 就完全合理。

**不 fail loud 的理由**：分配器**明確支援並有測試釘住 P1 reservation**（[sort.ts:4](../parking-system/lib/allocation/sort.ts#L4)；[allocate.test.ts:127](../parking-system/tests/unit/allocation/allocate.test.ts#L127) `'P1 always ranks before P3'`）⇒ P1 列並非「模型不接受」，只是今天沒有寫入路徑。若因此 throw，未來任何一刀（如 #13）寫出 P1 列時，**第一個爆的是每位管理員每次登入必看的 `/admin` 首頁**——用不相干功能的落地炸掉 dashboard，而「優先」本來就是它正確的歸屬。只保留 DB CHECK 擋得住的範圍外值（`0002:42` 限定 1/2/3）會 throw，以確保恆等式不會靜靜失效。

**背景（使用者 2026-07-30 提供）**：教會另有 **6 個由教會自行控管的全職同工車位，完全不在本系統的容量之內**（位置在深處易被擋，同工早進晚出故影響不大）——那 6 格本週停了幾台**都不進任何公式**。系統管理的是另一個池：23 格 ＝ 保留·停用 ＋ 本週需要佔用系統車位的 P1 ＋ P2/P3 會友。

⇒ `computeCapacity` 的公式 **`23 − 保留·停用 − 本週佔用系統車位的 P1` 是正確的，不需修改**；`active_full_time_staff_reserved` 的正確語意是「**本週有幾位 P1 需要佔用這 23 格中的一格**」（例：某週 2 位同工要提早離開、不停教會自管區 ⇒ `reserved = 2` ⇒ 可分配 `23−3−2 = 18`），**不是**「六位同工本週有幾位來教會」。⚠️ [admin-operations-guide.md](admin-operations-guide.md) 對該欄的**解釋**目前寫成後者（「P1 名單裡扣掉本週標記不停車的人」），照那個語意填會平白吃掉會友的車位 ⇒ 另立待辦釘正語意，**公式與程式碼不動**。

---

### #33a 眷屬顯示年齡＋幼兒「學齡前／已入學」

**Decision:** Do ｜ **Status:** **Ready** ｜ **Delivery:** **Pre-delivery**
**Size:** S ｜ **Deployment:** App-only ｜ **Migration:** No

#### Problem
**需求（2026-07-28 使用者提出）**：會友資料與覆核畫面要能看到幼兒與長者的年齡，並標示學齡前／非學齡前。

**資料已存在、不需 migration**：`eligibility_dependents(dependent_kind, dependent_name, dependent_birthdate)`（[0020:15](../parking-system/supabase/migrations/0020_member_import.sql#L15)，`dependent_kind` enum＝`impaired/child/elder`）；匯入已收 `孩童生日1–3`／`長者生日`（[memberImportSchema.ts:46-52](../parking-system/lib/memberImportSchema.ts#L46-L52)）。明細頁**已經在顯示眷屬與原始生日**（[members/[id]/page.tsx:116-128](../parking-system/app/admin/members/[id]/page.tsx#L116-L128)）。

#### Decision
**33a 明細頁**：眷屬列在既有生日後補「N 歲」，`child` 另加 `學齡前`／`已入學` badge。**零新增揭露**——該頁本來就顯示完整生日（頁首已有 #12 資料最小化橫幅），年齡是更粗的衍生值。純 presentation、無 service 改動。

#### Constraints
- **⚠️「學齡前」不是新規則、不得新寫一條**：權威已存在＝`childCompanionValidUntil(bd)`（[eligibilityStatus.ts](../parking-system/lib/eligibilityStatus.ts)，國民教育法 9/1 inclusive cutoff，回傳入學前一年的 08-31）。標籤定義**只能是** `asOf <= childCompanionValidUntil(bd)` ⇒ 學齡前。任何自行用「年齡 < 6」判斷都會與 P2 效期在 9/1 前後差整整一年（該檔案標頭已明寫兩個相差一天的孩子差一個學年）——**那就是本專案最典型的雙重真相**。
- **⚠️ as-of 必須是參數、不得用 clock**（同檔標頭鐵律）：本項兩個 surface 問的都是「今天要不要處理」⇒ `asOf = taipeiToday(now)`；**絕不可**被 `priority.ts` 的分配判定重用（那支的 as-of 是 `sunday_date`）。
- **⚠️ 長者無年齡規則**：全 codebase 找不到 65 歲之類門檻，`elderly_companion` 只是事由、效期通常永久 ⇒ 顯示長者年齡**純屬輔助判讀，不得推導任何資格**；且 `長者生日` 為選填、常為 NULL ⇒ null 要顯示「生日未填」而非算成 0 歲。年齡＝週歲（滿歲），台北曆日計算。
- **其他**：display-only、不寫 audit；若日後真要記，`0030`/`0035` 的 sanitizer 會擋 birthdate-shaped key 帶日期值（**boolean 才放行**）⇒ 只能記布林/enum。

#### Acceptance
- 明細頁每位眷屬在既有生日後顯示「N 歲」（週歲、台北曆日）。
- `child` 眷屬顯示 `學齡前`／`已入學`，判定**呼叫 `childCompanionValidUntil`**，不得另寫年齡門檻——測試需涵蓋 9/1 前後相差一天的兩個生日，兩者學年不同。
- `asOf` 由呼叫端傳入（`taipeiToday(now)`），非在函式內讀 clock。
- 生日為 NULL 時顯示「生日未填」，不顯示 0 歲、不顯示 badge。
- `/admin/eligibility` 覆核佇列**未新增**任何眷屬欄位（#33b 已否決）。

#### History
與 #31（一人多事由）相關但獨立：#31 是能不能存多個事由，本項是把已存的那一個看清楚。Wave 3 3e，與 #32 同批。

---

### #34 Member Data Lifecycle 會友資料生命週期（Epic）

**Decision:** Do ｜ **Status:** **Ready** ｜ **Delivery:** **Pre-pilot** ｜ **Size:** L（拆五刀，六個 work item）
**Deployment:** TBD ｜ **Invariants:** INV-01, INV-02, INV-03, INV-04

> **問題重新定義（採納外部審查）**：不是「CSV 改善」也不是「增加會員自助修改功能」，而是**把會友資料的 source of truth，從同工代填改成本人提交＋系統檢核＋必要治理覆核**。交付日的大量代填錯誤證明這不是 nice-to-have，是**下一輪正式資料導入前該收斂的營運風險** ⇒ 前三刀 **pilot 前**做，不整包丟 Wave 5。
>
> **來源＝交付日實況（2026-07-28，已匯入 prod 57 位）**：轉入 CSV 有**大量同工代填錯誤**與**該填卻空白的欄位**。
>
> **長期 architecture decision**：**CSV ＝ bootstrap / bulk compatibility tool；`/member` 逐漸成為資料的正常 source-of-truth surface。**

#### Work items — canonical child state

> **這張表是 `#34` 內部 work item 狀態的權威**（`Feature inventory` 只放 parent 一列）。
> **Parent 聚合規則**：`#34` 的 Status／Delivery **反映下一個 actionable tranche**，不是所有 child 的聚合完成度——取「尚未 Done/Closed 的 child 中 Delivery 最早的那一個」。全部 child 皆 Done/Closed ⇒ parent `Done`。

| Work item | 主題 | Decision | Status | Delivery | Deployment |
|---|---|---|---|---|---|
| 34-0 | Import integrity（匯入完整性） | Do | Ready | Pre-pilot | App-only |
| 34-0b-A | Import auditability（真正發生的 mutation 可稽核） | Do | Ready | Pre-pilot | Migration + App |
| 34-0b-B | Import run / diagnostics | Do | Deferred | Post-delivery | Migration + App |
| 34a | Profile completeness & confirmation | Do | Blocked | Pre-pilot | TBD |
| 34b | Member self-maintenance | Do | Deferred | Pilot-early | TBD |
| 34c | New-member intake | Do | Deferred | Post-delivery | Migration + App |

**Acceptance**：Epic parent 無獨立驗收標準——由各 work item 各自承擔（見上表連結的小節）。parent 標為 `Ready` 只表示**下一個 tranche**（34-0／34-0b-A）可開工。

#### 為什麼「再加強 CSV 驗證」不是根治
匯入驗證已經很嚴：姓名/車牌/手機 row-level 必填（[memberImport.ts:189-193](../parking-system/lib/memberImport.ts#L189-L193)）、手機格式＋科學記號防護、同手機任一列壞掉整位跳過（Wave 0 row-completeness）、同手機不同姓名/同車牌多 owner/P2 資料矛盾一律 fail closed（Wave 0.1）。但 `0912xxxxxx + ABC-1234` **格式全對，不代表那是張三的手機與車牌**。驗證器能查格式，查不了歸屬，也叫不動知道答案的人。⇒ **換資料來源，不是再疊一層 parser 規則**。

#### 貫穿全 Epic 的第一個 technical task
**抽出 member profile completeness domain rule**（審查建議，採納為第一個工作項）：

```text
getMemberCompleteness(profile) → { complete: boolean, missing: [...] }
```

**server authoritative、UI 只拿結果顯示**（`INV-02`）。現有 condition-aware 規則（reason 1/2 → 行動不便者姓名；reason 4 → 長者姓名＋生日；reason 3 → 孩童或孕婦資料；孩童**有姓名沒生日**不算 malformed、只降成 `reviewRequired`）必須收進這一份，**不可演變成 CSV validator 一套、LIFF form 一套、Admin review 又一套**。

---

#### 34-0 Import integrity — **strict by default**

**Status:** Ready ｜ **Delivery:** Pre-pilot ｜ **Deployment:** App-only

**Problem — 現況（已驗證）**：preview 出現錯誤/衝突時，操作者勾一個「上方標記為錯誤/衝突的列會被略過，其餘合法會友仍會寫入。我已了解並仍要匯入。」就能送出——`disabled={busy || (hasSkips && !acknowledged)}`（[MemberImport.tsx:238-245](../parking-system/app/admin/import/MemberImport.tsx#L238-L245)）。**這個 acknowledge 逃生口本身就是要改掉的核心。**

**Decision（二輪審查改判，採納）：不引入任何 mode，預設所有 CSV import 都 strict。** 只要存在系統明確知道會跳過資料的 hard issue——`validationErrors`／`phoneNameConflicts`／`identityConflicts`／`plateConflicts`／`batchPlateConflicts`／`groupConflicts`——就**不能 Apply**，一般管理員只看到「**有錯誤 → 請修正後重新預覽**」。

**Constraints：**
- **⛔ 明確否決「以名冊是否為空自動判定 bootstrap」**（已由審查駁回、理由成立）：500 人第一次只匯進 300 人，`users` 就已不為 0，第二次進來會被誤判成 incremental——**但正式名冊 bootstrap 根本還沒完成**。且未來可能已有少數手工建立的會員或 pilot 人員，正式 roster 才第一次進來。**「DB 是否為空」不是 business state。** 操作者自選同樣否決（會被誤選）。
- **partial import ＝ exceptional path，不是 normal path**：若未來真有「先匯 490 位、10 位之後處理」的實際需求，另做一個**系統管理員限定**的例外操作「略過錯誤資料並匯入其餘」，需二次確認＋寫 audit。**strict 是常態、partial 是例外**——比建立 bootstrap state 簡單，也更符合現在準備交付的系統。
- **⚠️ `reviewRequired` 不可混成 hard error**（兩輪審查一致）：「幼兒同行但生日缺失」與「手機格式錯誤／同車牌兩個人／同手機不同姓名」不是同一種問題。

| 類別 | 行為 |
|---|---|
| **Hard blocker** | 不能 Apply |
| **Incomplete / review required** | 可建立 member，但**該會員不是 Ready** |

後者的收斂路徑正是 34a：本人補資料 → completeness PASS → 本人確認 → P2 若需要仍由 Admin review。

**Non-goal**：**這一刀解不了「ABC-1234 是不是王小明的」**，但能擋掉「明明系統知道有問題，仍產生半套正式名冊」。

**Acceptance：**
- preview 出現任一 hard issue 時 Apply **不可點**，且沒有任何勾選框能解除——`acknowledged` 逃生口已移除。
- 只有 `reviewRequired` 時 Apply **可點**，寫入成功，該會員標為未完成（不是 Ready）。
- 一般管理員看到的訊息是「有錯誤 → 請修正後重新預覽」，不是「將略過 N 列」。
- 例外的 partial import 若實作，僅系統管理員可用、二次確認、寫 audit。

---

#### 34-0b-A Import auditability

**Status:** Ready ｜ **Delivery:** Pre-pilot ｜ **Deployment:** Migration + App ｜ **Invariants:** INV-04

**Problem — 現況（已驗證）**：`/api/admin/members/import/apply` **完全不寫 audit**，報表只回瀏覽器且刻意不落地（[apply/route.ts:12](../parking-system/app/api/admin/members/import/apply/route.ts#L12) 明寫 "The CSV, report, and token are never logged"）。這在 #15 之後是明顯缺口：容量、P2 覆核、角色、車輛、名冊匯出全都寫 audit，**唯獨影響最大的批次寫入沒有**。

**Decision — 真正發生的 mutation 必須可稽核。** 兩種列：
- **per-member**：`member.import`，`entity_id` ＝ user UUID，metadata 僅 `created`／`vehicles_added`／`eligibility_written` 等布林與計數。這能回答「**這位會員是什麼時候因 CSV import 建立的？誰操作的？**」而完全不需把電話車牌複製進 audit。
- **batch summary**：`member_import.apply`，僅 profile 與計數（rows／members／created／updated／vehicles_added／review_required／result）。

**Constraints：**
- **⚠️ 二輪審查的關鍵修正（採納）：audit ≠ import report，兩層要分開，不可為了保存 report 而破壞 audit substrate 的設計。** audit 的既有姿態就是「ordinary input validation 不 audit，避免把 user-supplied values 拉進 metadata」，且 writer 已硬性禁止 phone/line_id/plate/name/remarks/birthdate/address/email 出現在 metadata（`0030`／`0035` denylist）。**不要為 CSV report 打破它。**
- **⚠️ 交易邊界（讀碼補充，審查規格未涵蓋）**：審查要求「audit 與 business write 同 transaction」——**per-member 列可以且必須如此**（`import_member` RPC 內部 append，天然同 txn，符合 #15「audit 與業務同生共死」）。但 **batch summary 不可能同 txn**：[memberImportService.ts:343-353](../parking-system/server/services/memberImportService.ts#L343-L353) 明寫 "Per-member RPC is atomic, but the whole CSV is not one transaction"，每位會友各自 commit，**整批沒有一個包住的 transaction**。⇒ batch 列是 best-effort 的收尾列；**per-member 列才是權威 trail**。實作推論：中途失敗（`CsvImportExecutionError`）時 batch 列不會寫出，但已 commit 的 per-member 列仍在——這是可接受的，也正是為什麼權威必須放在 per-member。
- **實作要求**：`import_member` RPC 需取得 actor admin id／actor session id／request id（**route 後補 audit ❌**），沿用 #15 的 SECURITY DEFINER 業務 RPC 模式。

**Acceptance：**
- 每一位因匯入而 commit 的會友都有一列 `member.import`，與該會友的寫入**同 transaction**（RPC 失敗則兩者皆不存在）。
- audit metadata 只含布林與計數，**不含** phone／plate／name／birthdate 等——沿用 `0030`／`0035` denylist，該 denylist 不得為此放寬。
- 整批成功時另有一列 `member_import.apply`（僅 profile 與計數）；中途失敗時該列不存在，但已 commit 的 per-member 列仍在。
- 匯入報表仍不落地，audit 不是 report 的替代品。

---

#### 34-0b-B Import Run / Import Diagnostics

**Status:** Deferred ｜ **Delivery:** Post-delivery ｜ **Deployment:** Migration + App

**Decision**：`member_import_runs`（performed_by／performed_at／profile／各項計數／result）＋短期 `member_import_issues`（`import_run_id`／`line_number`／`issue_code`，例 `line 37 → phone_name_conflict`），**不保存 raw row**。

**為什麼延後**：**審查判斷「不一定」pilot 前做，我同意**：34-0 改 strict 後，「寫完才發現有人被跳過」這個主要問題已大幅消除 ⇒ 不為一個已被 gate 消除的問題再引入一整套 PII report storage。等實際操作證明需要再做。

---

#### 34a 我的資料＋完整度＋本人確認

**Status:** **Blocked** ｜ **Delivery:** Pre-pilot ｜ **Deployment:** TBD ｜ **Invariants:** INV-02

**Decision — completeness 先於 confirm（採納審查修正）。** 原本提「唯讀看資料→按正確」是錯的順序——王小明的孩童生日空白時，他按下「資料正確」會把**一份不完整的資料認證成正確**。正確流程是：**完整度檢查 → 本人補齊 → 本人確認 → 必要時行政覆核**。

畫面顯示「資料完整」或「還有 2 項需補填」（例：⚠ 尚未填寫孩童生日／⚠ 尚未確認車牌），**全部 completeness rule 通過才出現「確認我的資料」**。

**Unresolved decision（Blocked 原因）**：**`profile_confirmed_at` 的語意必須先定義**（審查正確指出：這是 DB write，**不是先前說的「零寫入風險」**）：任何相關欄位後續被修改 ⇒ `profile_confirmed_at` 歸 null、要求重新確認；並決定是否寫 audit（傾向寫，`actor_type='member'`）。
仍列 `Pre-pilot`——它是 pilot gate，只是下一步是**完成這個決策**而不是直接 coding。

**Acceptance**（決策底定後適用）：
- completeness 不通過時**看不到**「確認我的資料」按鈕；缺項逐條列出。
- 本人補齊後 completeness PASS，才可送出確認並寫入 `profile_confirmed_at`。
- 任一相關欄位事後被修改 ⇒ `profile_confirmed_at` 回到 null，重新要求確認。
- P2 欄位即使由本人填寫，仍走 `INV-01` 治理，不因本人確認而視為核准。

---

#### 34b 本人補正 — 三種欄位是三種權限模型

**Status:** Deferred ｜ **Delivery:** Pilot-early ｜ **Deployment:** TBD ｜ **Invariants:** INV-01, INV-02, INV-03

審查在此比原本的切法更細，採納：

| 欄位 | 模型 |
|---|---|
| **車輛新增／停用／恢復** | **可本人直接改**。`0038` 已備妥 soft delete／使用中才唯一／未結束預約不可停用／衝突不洩他人身分 ⇒ 把 #28 接到 member surface 是自然下一步 |
| **手機號碼** | **不可 direct edit**。`users.id` 才是 identity、phone 是 mutable attribute（`0038` 整刀正是為修正「把 phone 當 identity」），且 phone 同時參與 binding identity ⇒ 走「提出變更 → 驗證／admin confirmation → update identity」 |
| **P2 資料**（行動不便／孕婦／長者同行／幼兒同行＋孩童生日） | 本人可填，但 **submission ≠ eligibility approval**，走 #10 既有治理 |

**⚠️ 審查的重要修正（採納）**：**不要把一般 profile update 也塞進 `review_status='unreviewed'`**。`review_status` 是 **P2 eligibility 的治理權威**，不是整份 profile 的 approval flag。三者語意分開：**基本資料 completeness／車輛 maintenance／P2 application-review**。（先前「會友送出的一律落 `unreviewed`」講得太寬——那條鐵律只適用於 P2 治理欄。）

---

#### 34c 新會友 self-onboarding

**Status:** Deferred ｜ **Delivery:** Post-delivery（系統穩定後才建，但**現在就該定架構**）｜ **Deployment:** Migration + App

審查與原案的差異其實比看起來小：**排序一致**（都放最後），差別在**現在就要把目標架構定下來**，否則會一直複製今天的問題——「同工先輸 CSV → 會友才能綁 OA → 會友再修同工輸錯的資料」。

**目標流程**：`LINE identity（伺服器已驗證）→ pending member intake → 幹事核可 → 同一 transaction 內 create member + vehicles + binding + audit`；P2 若有申請仍進 #10 review。

**Constraints：**
- **共識：不讓未知使用者直接 INSERT canonical `users`**，但也**不必先由同工替他輸一列 CSV**。
- **⚠️ 不要塞進 `pending_binding`**：該表用途已很明確（capture-time identity snapshot／approved-rejected／retention／PII redaction／concurrency）——`0038` 之所以 freeze `matched_user_id_at_capture`，正是為了避免 phone reassignment 造成跨人錯綁，代價是**送出當下無會員 ⇒ 事後才建會員也不能直接核准、必須重送**。另建 `member_intake_submissions`，讓 binding 與 profile onboarding 的 lifecycle 不互相污染。

**屆時 CSV 退回它真正的角色**＝**bootstrap / bulk compatibility tool**，而非日常會友資料建立與維護入口。

---

#### Epic history — 匯入實況與 reconciliation

**❌ 更正上一版的錯誤主張**：曾寫過「34-0b 讓**今天這批**可被追查」——**這句不成立**，審查修得對。report 未保存、瀏覽器已關、當時無 audit 也無 import run ⇒ **新增的 audit 無法回溯創造歷史**，精確重建「某次匯入第 53 列被跳過、理由是 X」是做不到的。
**今天這批能做的是 reconciliation（不是 historical audit reconstruction），兩者文件上必須分清。**

**✅ reconciliation 已完成（2026-07-29）**：跑**匯入器自身的 pipeline**（`importMembersFromCsvText` ＋ stub repository，非人工讀檔）核對 `01.主日停車場申請名冊2026.07.匯入用.csv`：
- 61 資料列 → **54 位會友、60 台車**
- **擋下 1 位**：檔案第 12 行缺手機號碼（孩童生日已填，補上手機即可正常匯入）
- **群組衝突 0、同檔車牌衝突 0** —— 匯入前待補清單的「同手機兩種申請原因」已解決
- **`reviewRequired` 4 位**：3 位原因 2（短期不便）無申請日期 ⇒ 算不出 6 個月效期；1 位孕婦（另計）
- **prod 57 位 ＝ CSV 54 ＋ 使用者手動自建 3 位**（已確認，差額結清）

⚠️ **範圍限制**：stub repo 的跑法**不涵蓋 DB 側衝突**（同手機不同名／identity candidate／車牌已屬他人）——那三類由 `import_member` RPC 判定，需連真 DB 才驗得出。
⇒ 這是**一次性營運核對，不是新功能**。`reviewRequired` 那 4 位必須在 `/admin/eligibility` 覆核佇列清——**綁定宣導抓不到他們**（他們會正常綁定，資格靜靜躺著）。

**連帶：文件同步 ✅ 已完成（2026-07-29）**
`docs/current_handoff.md` header／剩餘 ops 行與 `go-live-checklist.md §1.3` 原寫「尚未匯入正式教會會員資料」，**已同步為「2026-07-28 已匯入 prod、57 位」**。（§6.x 內的歷史敘述**刻意不動**——那些是當時狀態的正確紀錄。）
**名冊面殘留待辦記於 go-live §1.3**（4 位 `reviewRequired` 待設效期／1 位缺手機未匯入／其餘跳過者於宣導綁定時人工處理）——**權威在 go-live-checklist，本檔不重述**。
**已知機制細節**：不在名冊者送出綁定申請會以 `unmatched_at_capture` 浮出；但補建會友後**原申請不能直接核准**（`0038` 核准讀送出當下凍結的 `matched_user_id_at_capture`，[0038:708](../parking-system/supabase/migrations/0038_member_maintenance.sql#L708)），需請本人**重新送出**。

---

### #35 本週申請清單（點數字看名單）

**Decision:** Do ｜ **Status:** **Ready** ｜ **Delivery:** **Pre-pilot**
**Size:** S–M ｜ **Deployment:** App-only ｜ **Migration:** No ｜ **Depends on:** #32（入口連結）

#### Problem
**（2026-07-30 使用者提出：試營運除錯特別需要）** 後台**沒有任何一頁看得到 pending／waiting 是誰**——`/admin/print` 讀的是 Staff-safe 投影 `staff_checkin_view`，且[明確排除](../parking-system/server/repositories/parkingRepository.ts#L1191-L1194) `waiting`／`pending`（"not actionable at the entrance"）；`/admin/members` 是名冊、不分週；`/admin/eligibility` 只管 P2 資格。⇒ 同工問「他說他申請了，系統有收到嗎？」，今天只能下 SQL。

#### Decision
概覽（#32）的數字做成連結 → **新頁 `/admin/week`**，以 query param 篩選（`?status=pending`、`?priority=2`）。

**⛔ 不做成首頁 inline 展開**：`/admin` 首頁目前是零 PII 的 dashboard，而 [members/[id]](../parking-system/app/admin/members/[id]/page.tsx#L21-L25) 之所以掛 `force-dynamic`＋`revalidate = 0` 正是因為它 render PII。inline 展開等於把「每次登入必看到的那一頁」整體降級成 PII surface，違反 #12 姿態。

#### Constraints
- **欄位最小集**：姓名／車牌／狀態／優先·一般／申請時間／候補序位。**不放電話、不放 P2 事由**——要看事由點進 `members/[id]`（該頁已有 #12 橫幅）。與 `/admin/eligibility` 刻意不帶眷屬資料同一條線。
- **⛔ 不重用、也不放寬 `staff_checkin_view`**：它刻意只給 `is_priority` 布林而藏 raw priority，又刻意排除 pending／waiting——那是**現場 PIN 讀得到的東西**。本頁走 admin repo 直讀 `reservations` join `users`/`vehicles`，staff／admin 兩條投影保持分離。
- **排序**：候補**必須照 `allocation_order`**（那就是真正的遞補順序）。⚠️ pending 階段 `allocation_order` 為 null，**不得在本頁用 `sort.ts` 預覽「將來會排第幾」**——那是分配結果的第二實作，與週五實際結果一有出入就會在除錯時誤導人。v1 照申請時間排，畫面明寫「實際順序於週五分配時產生」。
- **PII posture**：沿用 `members/[id]` 的 `dynamic = 'force-dynamic'`＋`revalidate = 0`＋`no-store`。
- **Role（使用者 2026-07-30 定）：幹事可看、不新增 capability。** 幹事今天已能開 `/admin/members` 看全名冊、開 `/admin/print` 看全部車牌（[adminNav.ts](../parking-system/lib/adminNav.ts) 兩項皆無 capability gate）⇒ 本頁不構成新的揭露等級。
- **不寫 audit**：唯讀畫面，依 #15 既有姿態（#5B-a 匯出寫 audit 是因為它產生**可攜檔案**，兩者不同）。

#### Acceptance
- `/admin/week` 列出本週全部 `pending`／`waiting`，含姓名、車牌、狀態、優先·一般、申請時間；候補列另顯序位。
- 候補依 `allocation_order` 遞增排序；pending 依申請時間排序且畫面明示順序尚未產生。
- 頁面不出現電話與 P2 事由；不新增 capability，幹事登入即可開啟。
- 概覽（#32）的「申請中／候補」數字可點擊，帶對應 filter 進入本頁。
- 資料不取自 `staff_checkin_view`。

#### History
2026-07-30 由 #32 的討論衍生（「能否點選人數看到名單」）。獨立成條而非併入 #32：#32 零 PII 可立即上線，本頁需定 role 邊界與欄位集，值得獨立 review ⇒ 兩刀分開（使用者已定）。Wave 3 3f。

---

### #36 週五分配後晚鳥即時預約

**Decision:** Do ｜ **Status:** **Blocked** ｜ **Delivery:** **Pre-pilot**
**Size:** M ｜ **Deployment:** Migration + App ｜ **Depends on:** —

#### Problem
**PRD 已寫、但從未實作**。[PRD §六.3](Church_Parking_Management_System_PRD.md) 明訂「**晚鳥即時預約**：週五分配後若未滿額，系統保持開放，新申請採『隨送隨核准』直到滿額」。

實際行為相反：Friday allocation 一 claim（`job_runs` 進 `running`），`apply_reservation` 即回 `applications_closed`（[0023:49](../parking-system/supabase/migrations/0023_member_apply.sql#L49)），會友從此無法線上申請，即使**真的還有空位**。

**這個落差已經造成一次實害**：撰寫會友說明時照 PRD 寫成「週五後有空位就隨到隨核准」，等於教錯會友行為（PR #60 review 抓出）。canonical requirement 與實作不一致，下一個人還會再照它寫錯一次 ⇒ 必須明確列為 backlog item，而不是留在 PRD 裡看起來像已實作。

#### Decision
週五分配後，若**真的有沒有任何既有權利主張的空位**，新申請直接核准。

**不是**把 `applications_closed` 改成開放而已——必須在 **transaction 內**判定：

```
Friday allocation 已完成
        │
        ▼
還有可分配容量？
   ├─ 否 → 拒絕
   └─ 是 → 有 waiting / temp_approved 嗎？
            ├─ 有 → 拒絕（既有候補權利優先）
            └─ 無 → 新申請直接 approved
```

#### Constraints
- ① **分配後的新申請不得再進 `pending`**：要嘛 atomic direct approve、要嘛拒絕。留下分配後的 `pending` 列會讓 #32 的 warning 永久亮著，也沒有任何流程會再處理它。
- ② **不得超賣**：「檢查 capacity → insert approved」必須在 **DB transactional guard** 內完成（比照 `0031` 的容量守衛），**不可**在 TypeScript 先 count 再 insert。
- ③ **既有 `waiting` / 進行中的 offer 一律優先於晚鳥**：晚鳥不得插隊，尤其**不得搶正在 2 小時確認中的 `temp_approved`**——那是**已經 hold 住的一格**，`approved < capacity` 並不代表有空位（`countPromisedReservations` 之所以把 `temp_approved` 算進 promised，正是同一個理由）。
  **「只要存在任何 `waiting`，晚鳥即不得 direct approve」是第一版的定案，不留例外。** 理由：offer `expired`／`declined` 後該筆會回到 `waiting` 且 `allocation_order` **未被改動**（[0024:41-42](../parking-system/supabase/migrations/0024_offer_expiry_guard.sql#L41-L42)）⇒ **候補權利仍然存在**。若日後要讓「錯過一次 offer 即失去候補權」，那是獨立的 business-rule change，須自行走決策，不得以 #36 的例外形式偷渡。
- ④ **不順便做「週五後加入候補尾端」**：那是另一條產品規則。第一版只解決「**真的有剩位卻不能申請**」。
- ⑤ **容量沿用現有 `computeCapacity` 語意**（含 blocked／guest／P1 減項），**不在這一刀重新發明容量公式**。
- ⑥ **`effective_priority` 仍須照常凍結**：「直接核准、不排序」≠ priority 不重要——後續 P2 的 10:20 提醒、10:45／10:55 釋出時點全都依 priority 運作（[release.ts](../parking-system/lib/allocation/release.ts)）。
- ⑦ **#14B 必須建立在本項的 automatic semantics 之上**：先定義「正常模式」怎麼運作，才談得上 `forced_open` 到底 override 了什麼。⇒ **本項不可併入 #14B**（那是人工 override，且自身仍 Blocked）。
- ⑧ **窗口有結束時間，且不得晚於主日 10:30**：PRD §八.4 明訂 **10:30 起進入現場調度**——「不再保證依候補順位保留車位，以現場交通安全、入口秩序與 Staff 指引為優先」，而 10:30 的 release sweep 也會廣播給全體候補、語意是**現場先到先停**。線上 direct-approve 若延續到那之後，等於在系統裡發出一個現場已經不保證的承諾。**確切截止點（10:00 現場點名開始／10:30 切點）列為待決**，見下方 Unresolved decision。
  ⚠️ **連帶影響容量算法**：若窗口允許進入 10:00–10:30，此時已可能有 `attended` 與現場車輛，「真的有空位」就**不能只看 `approved + temp_approved`**。截止點一旦選在 10:00 之後，容量判定必須一併重新定義。
- ⑨ **direct approve 必須寫出完整的 approved row**：`0002:74` 有 `check (status <> 'approved' or release_deadline_at is not null)`，而 `release_deadline_at` 依 frozen `effective_priority` 算出：**direct approve 的初始 deadline 為 P3 10:30、P2 10:45**；10:55 只有在 `p2_on_the_way` 為真時才成立（[release.ts:18-19](../parking-system/lib/allocation/release.ts#L18-L19)），亦即晚鳥核准後**另經既有「正在路上」回報流程**才會延長，不是核准當下的值。Friday allocator 正是 freeze priority → `computeReleaseDeadline` → 一併寫入（[fridayAllocationService.ts:64](../parking-system/server/services/fridayAllocationService.ts#L64)）。⇒ 晚鳥路徑**不可只 insert `approved`**，必須同一 statement 寫入 `approved_at` 與 deadline，否則 DB 直接拒絕。

#### Unresolved decision（Blocked 原因）
需求本身清楚，卡的是以下三項：
- **晚鳥線上窗口何時截止**（見 Constraint ⑧）：選 10:00（現場點名開始）還是 10:30（現場調度切點）。**上限已定：不得晚於 10:30。**
- 兩人同時搶最後一格的判定放在哪一層（RPC 內 `for update` 鎖 event 列？）
- 晚鳥核准是否發通知、用哪個 template

> **「有 `waiting` 是否一律拒絕」不是待決事項**——見 Constraint ③，第一版直接釘死為「是」。錯過一次 offer 後是否失去候補權，是**另一個 business-rule change**，不得偷偷變成 #36 的例外。

#### Acceptance
以容量 20 為例：

| 情境 | 期望 |
|---|---|
| 分配後 `approved=17`、`waiting=0`、`temp_approved=0` | 新申請**直接 approved**，可用到 20 |
| `approved=20` | 新申請**拒絕** |
| `approved=19`、`temp_approved=1` | 新申請**拒絕**（不得搶 held seat） |
| `approved=19`、`waiting=1` | 新申請**拒絕**（既有候補優先） |
| 兩人同時搶最後一格 | **最多一人** approved，不超賣 |
| 窗口截止時點之後（不晚於主日 10:30） | 新申請**拒絕**，即使仍有空位 |

**每一筆晚鳥核准的列必須是完整的 approved row**：`effective_priority` 與一般申請一樣被正確凍結，且**同一 statement 內**寫入 `approved_at` 與依該 frozen priority 算出的 `release_deadline_at`（P3 10:30／P2 10:45）。**不可產生缺少 deadline 的 approved 列**——`0002:74` 的 CHECK 會直接拒絕，而那個 CHECK 正是為了讓「已核准卻沒有釋出時點」這種列不可能存在。

#### History
2026-07-30 由 PR #60 的文件審查衍生——會友說明照 PRD 寫，才發現 PRD 與實作不一致。**獨立成條、不併入 #14B**（外部審查判定）：#36 是自動業務規則，#14B 是人工 override，把前者綁進一個自身仍 Blocked 的 feature 只會一起卡住。
**文件分工**：面向會友的說明**一律描述今天 production 的真實行為**（＝分配後線上登記關閉）；PRD 保留這條產品需求，但標明尚未實作。現況與產品目標不再混為一談。

> **compatibility view。** 依 `Delivery` token 分組投影 `Feature inventory`；狀態權威仍在 inventory，本節不建立新語意。
> 舊版「交付前必修／強烈建議交付前／可交付後迭代」的敘述已完成其任務，移入 Archive 保存。

- **`Pre-delivery`（交付前）**：#33a
- **`Pre-pilot`（pilot 前）**：34-0、34-0b-A、34a、#35、#36
- **`Pilot-early`（pilot 初期）**：34b、#11
- **`Post-delivery`（交付後）**：#3、#4、#5B（5B-b／5B-c）、#6A、#6B、#7、#10（2B-2c）、#16、#26、#28、#31、34-0b-B、34c
- **No delivery target（`Blocked`，等產品決策）**：#13、#14B
- **`Done`**：#1、#5A、#8、#9、#12、#14A、#15、#17、#18、#19、#20、#21、#22、#23、#24、#25、#27、#29、#30、#32
- **`Closed`**：#2、#33b

---

## Archive — historical, non-normative

> ⚠️ **本節只保存歷史決策與已失效規格。**
> **不得用於判斷目前 feature status、scope 或 implementation requirement。**
> Current truth 以 `Feature inventory`、`#34 Work items`、`Active feature details` 與實際 code / migration 為準。

### Done — 已實作完成

#### #1 換人「換碼」＋手動轉發文案
**Status:** Done ｜ **Wave:** -1 ｜ **Deployment:** App-only

重發＝新碼、舊 hash 立即失效。文案：「換人值班？重發即可，舊 PIN 立即失效。請將新 PIN 手動傳給本週值班同工。」

#### #5A 名冊瀏覽（最小欄位、server 分頁）
**Status:** Done ｜ **Wave:** 1 ｜ **Deployment:** App-only

server pagination；欄位僅姓名/遮罩電話/車牌摘要/狀態；**不匯出、不 bulk、不預載敏感事由**，點入才讀完整。可在 role 前上（現有 admin session gate）；明確接受「全名冊可見」姿態先於 role。

#### #8 本週概覽（上指標下待辦）
**Status:** Done ｜ **Wave:** 3 3a ｜ **PR:** #47 ｜ **Deployment:** App-only

鎖管理日曆當週主日（非 `getActiveEvent`）；標本週階段。容量顯示用**「可分配總數/保留·停用/已核准」，不用「外賓」字樣**（對齊 #14A 單一 blocked）。**實作**：`getWeekOverview`（`adminOverviewService`）＋`deriveWeekStage`（`lib/weekStage`，五階段）；`/admin` 首頁 `AdminOverview`。

#### #9 Sidebar 待辦徽章
**Status:** Done ｜ **Wave:** 3 3a ｜ **PR:** #47 ｜ **Deployment:** App-only

與 #8 共用 **service contract**（不硬 RPC）：`adminTodoService.getAdminTodoSnapshot`（fail-soft、`React.cache` request clock）＋`badgeForHref`。**snapshot 模型**：layout 一次取 → `AdminTodoProvider` 單一源餵側欄＋概覽（共用 layout 在 soft-nav 不重跑，故不可各自取數）。badge：P2 待審／牧養 open（v1 不分逾期）／ops `attention`（含 due_backlog_stale，只系統管理員）；ops backlog 正常排空不亮。

> 原「關鍵設計決策」的 **待辦計數 service contract（不硬 RPC）→ #8/#9** 一條，因 #8/#9 已完成、不再約束未來實作，於本次 normalization 未升格為 INV，保存於此。

#### #12 資料最小化橫幅
**Status:** Done ｜ **Wave:** 1 ｜ **Deployment:** App-only

明示「不索取/不顯示診斷證明」。

#### #14A 車位容量設定（交付前）
**Status:** Done ｜ **Wave:** 2B-1 ｜ **PR:** #40 / `8de24a0` ｜ **Migration:** `0031` ｜ **Deployment:** Migration + App

解決「幹事不用 SQL 改容量」。`total_capacity`／`blocked_spaces`（顯示「保留·停用」、**不拆外賓/維修**）／effective 預覽。**transactional guard**：已分配後 `effective_capacity >= approved_count` 由 **DB RPC 在 txn 內**檢查（不能只 UI 警告）。寫 audit。**依賴 #15，不依賴 #19**。

> **Historical specification — superseded by implementation**
>
> **實作差異**：promised 集合＝`('approved','temp_approved')` 而非只 approved（`temp_approved` 已佔位，見 §6 2B-1）；`admin_reserved` 已**摺入 `blocked_spaces`** 並 `check (admin_reserved = 0)` 釘住 ⇒「保留·停用」單一數字**可證明**是全部。

#### #15 稽核記錄（Audit Log）— 地基
**Status:** Done ｜ **Wave:** 2A ｜ **PR:** 2A-1 #38 / `8513912`；2A-2 viewer #39 / `d2e6890`；2A-3 retention #43 / `5db33bc` ｜ **Migration:** `0030`、`0034` ｜ **Deployment:** Migration + App

> **Historical specification — superseded by implementation**（實作為準，見 [0030](../parking-system/supabase/migrations/0030_audit_substrate.sql) 標頭）

**實作與下列原始規格有四處刻意分歧**：
- ①「app role 只 INSERT/SELECT」**做不到也不夠**——app 跑 service_role、RLS 對它無效，且 0004 已 blanket grant DML；改為 **revoke DML（含 TRUNCATE）＋ trigger 雙層**，且明確**不宣稱 immutability**（owner 仍有 DDL）、**不防 omission**（只提高偽造成本）。
- ②「單一 RPC」升級為 **`private.append_audit_log`，EXECUTE 不授權給任何人**（含 service_role），只有 owner-controlled `SECURITY DEFINER` 業務 RPC 能在**業務 txn 內**呼叫＝audit 與業務同生共死。
- ③ 治理拒絕**必須 typed return 不可 raise**（raise 會把記錄拒絕的那列一起 rollback）。
- ④ metadata **flat depth-1**＋PII key denylist，由 RPC 內部組裝。原始規格其餘照做：actor 模型（actor_type enum＋actor_id＋actor_session_id＋actor_role_snapshot，**無 FK**）、存 ID 不存姓名、request_id（改 **NOT NULL**）、result（`success/denied/conflict`）。exemplar＝`set_admin_disabled`；其餘記錄項（容量/P2/PIN/群組/車牌 CRUD）隨各自 slice 接入。

**原始規格存參**：表已存在（[0003_infra.sql:49](../parking-system/supabase/migrations/0003_infra.sql#L49)）**無 insert path**→補 insert substrate。**actor 模型：`actor_type` enum（admin/staff_session/member/job/system）＋`actor_id` nullable＋`actor_role_snapshot` nullable**（不要四個 nullable FK；`actor_id` 為 snapshot ref、不做通用 FK）。**存 ID 不存姓名**，顯示時 join；刪除者顯示「已刪除會友（ID 尾碼 xxxx）」→ 故 **admin 帳號 soft-disable 不 hard-delete**（現況已 disabled_at）。其餘欄：action/entity_type/entity_id/event_id/request_id/result/metadata_redacted(allowlist)/created_at。**DB append-only**：app role 只 INSERT/SELECT、單一 RPC、**永不寫 PII/token/LINE ID**、retention 用受限 maintenance function。記錄：role change/帳號停用/容量修改/P2 覆核/PIN rotation/群組設定/會員車牌 CRUD。

**2A-3 retention（[0034](../parking-system/supabase/migrations/0034_audit_retention_purge.sql)）**：`purge_audit_logs` 每月清 24 個月前的列。**逃生口＝雙鎖**（交易域 GUC `audit.allow_purge` 只有 purge fn 開＋`current_user`＝table owner；SECURITY DEFINER 以 owner 身分執行、直接 service_role delete 不是 owner）⇒ 即使未來重演 blanket grant 也刪不掉；`UPDATE`/`TRUNCATE` 恆擋。**時鐘用 DB 的 `now()`、不收 `p_now`**（呼叫端傳未來時間即可洗掉全表——與 binding-PII 前例的有意分歧，因早刪 audit 不可逆）。`audit.substrate_enabled`／`audit.retention_purge` retention-exempt；只在真的刪了才寫 marker（否則永久灌爆）。verifier 釘 **fn owner ＝ table owner**（否則鎖2 連合法 purge 都擋）。UI 文案翻面「紀錄保留 24 個月，逾期後由定期維運作業清除」，**部署硬前置**＝prod cron 先設好（runbook §13）。

##### Audit retention 政策（✅ 已實作於 2A-3 / `0034`）
**線上保留 24 個月、每月清理一次；不宣稱永久保存。** 理由：涵蓋兩個完整年度週期足以處理資格/容量/帳號/操作爭議；本系統非金融、醫療或法定會計帳冊，無支持永久保存的內控需求；audit 雖已最小化仍含 actor/entity stable ID，無限保存違反資料最小化；「量不大所以永不刪」不是治理政策。
規則：cutoff `created_at < now() - interval '24 months'`／受限 `SECURITY DEFINER` maintenance function／bounded batches／purge 只記 cutoff＋deleted_count，**不記被刪 ID 或其 metadata**。
**`audit.substrate_enabled` 與 `audit.retention_purge` 為 retention-exempt**——保留「trail 從何時開始、歷史依哪個政策被清」。
✅ 實作（`0034`）：0030 的 append-only trigger 擋掉**所有** DELETE，purge 的逃生口＝**雙鎖**——交易域 GUC `audit.allow_purge`（只有 `purge_audit_logs` 用 `set_config(...,true)` 開）＋ `current_user` ＝ table owner（SECURITY DEFINER 以 owner 執行、直接 service_role delete 不是 owner）。**時鐘用 DB `now()`、RPC 不收 `p_now`**（呼叫端傳未來時間即可洗全表；審查必改 1，與 binding-PII 前例的有意分歧）。verifier 釘 fn owner ＝ table owner（否則鎖2 連合法 purge 都擋）。UI 文案翻面的**部署硬前置**＝prod cron 先設好（runbook §13）。

#### #17 營運狀態頁 B＋C
**Status:** Done ｜ **Wave:** 3 3b ｜ **PR:** #48 ｜ **Deployment:** App-only（無 migration）

> **Historical specification — superseded by implementation**（C 部分以實作為準）

頁改名「通知系統狀態」。**B**：白話健康摘要當主角、技術細節與死信重送摺疊 `<details>`（異常時預設展開）、時間 UTC→台北（重用 `fmtTaipeiDateTime`、標時區）、sidebar 移最下。**C 以實作為準**：幹事**不放行進 `/admin/ops`**，改在「本週概覽」看白話健康——`notificationHealth`（healthy/attention/unavailable）與技術 `ops` **拆兩欄**（`ops` 非 null ⇒ 具 view_ops——幹事恆 null、superadmin 在 health 無法取得時亦 null；授權以 role/capability 為準；幹事只收 enum 不落地計數），異常→「通知系統異常，請聯絡系統管理員」linkless 列；**health 查詢失敗隔離**（不連帶清空 P2/牧養、不 fail-open 當正常）；🎉 重定義為「此角色需處理的事項」。無 migration。

#### #18 側欄 IA 兩區
**Status:** Done ｜ **Wave:** 3 3c ｜ **PR:** #49 ｜ **Deployment:** App-only（無 migration）

日常/系統維運，分區線＝#19 角色邊界。**只加分界線、無可見區標**（使用者定）；`daily`/`system` 是 IA 非 auth boundary。新 `lib/adminNav.ts`（`buildAdminNav`：capability 過濾先於 zone；`zone` 顯式非從 capability 推斷）；幹事 system 區空⇒不渲染 divider（與今日一致）。a11y：兩區 `role=group`＋`aria-label`（視覺仍無區標）。無 migration。

#### #19 Admin 角色分級（兩級）＋新增管理者
**Status:** Done ｜ **Wave:** 2C ｜ **PR:** 2C-1 #45 `76e93f8`；2C-2 #46 `ca9de80` ｜ **Migration:** `0035`、`0036` ｜ **Deployment:** Migration + App

系統管理員/幹事；`role` enum（預留唯讀）。**session：敏感操作每 request 從 DB 讀 active+role**（既有 session 已重查 `disabled_at` [adminAuth.ts:36](../parking-system/server/http/adminAuth.ts#L36)，role 沿同路、不塞 cookie）；role 變更/停用 bump `session_version` 或刪 sessions；sidebar 隱藏只 UX。guardrails：不停用/降級最後一位系統管理員、不自我升權、禁自我降/停、CLI bootstrap=系統管理員、UI 預設幹事、重設密碼撤 sessions。role matrix 明確定義。

#### #20 匯入中文 header＋reason 對照
**Status:** Done ｜ **Wave:** 0 ｜ **Deployment:** App-only

✅ reason 值已驗證＝現有 canonical（[DB enum p2_reason 0001:7](../parking-system/supabase/migrations/0001_enums_core.sql#L7)、TS `P2Reason`）：`mobility_long/mobility_short/pregnancy/elderly_companion/child_companion`（1–4 只是 CSV 輸入碼）。做法：**中文→canonical 集中在單一 `REASON_ALIASES` constant**，實作前對照 `memberImport.ts`/DB enum，別讓 parser/UI/DB 各一套。**未知→preview 錯誤要人工選、不 silently map、不解析模糊備註判敏感資格**。

#### #21 簡易全體會友匯入
**Status:** Done ｜ **Wave:** 0 ｜ **Deployment:** App-only

**重用既有 `memberImportService` 的 dry-run preview／`phoneNameConflicts`/`plateConflicts`/`reviewRequired`／apply**（非重建）。測試兩模式共存（P2 完整 vs 一般名冊）。

#### #22 匯入手機容錯
**Status:** Done ｜ **Wave:** 0 ｜ **Deployment:** App-only

去非數字後：10 碼合 `^09\d{8}$` 接受／**9 碼合 `^9\d{8}$` 前置補一個 `0`（非字串「09」）再驗**／**科學記號（如 `9.12346E+8`）拒絕並提示「將 Excel 欄設文字後重匯」，不嘗試還原**（Excel 已捨入不可靠）／`+886`·`886` 是否支援另定。測試涵蓋全部。

#### #23 點名備援清單搬 admin
**Status:** Done ｜ **Wave:** 1 ｜ **Deployment:** App-only

新增 `/admin/print`（gate `getAdminSession`，event 用管理日曆當週主日）；**`/staff/print` 移除或回 staff 首頁、不 redirect 到 /admin**（跨 auth domain 混亂）；**更新測試確認 staff PIN 不再能取列印資料**。資料源/`lib/staffRow`/`PrintButton` 全重用，保留 Staff-safe 最小內容。

#### #24 staff footer 精簡
**Status:** Done ｜ **Wave:** 1（於 #23 後）｜ **Deployment:** App-only

footer 只留「＋登記現場車輛」；結束鍵移 header 選單、保留二次確認。

#### #25 通知死指令修正
**Status:** Done ｜ **Wave:** -1（必修）｜ **Deployment:** App-only

「回覆正在路上/請回覆確認」被 webhook ignored。全 template copy audit（≥2 則同類）。短期改寫指向 LIFF；正解=#26。

#### #27 通知內容 enrich
**Status:** Done ｜ **Wave:** 1 ｜ **Deployment:** App-only

日期＋車牌＋粗體期限＋換行；producer 補 plate/date 到 payload。

#### #29 member 顯示候補序號
**Status:** Done ｜ **Wave:** 1 ｜ **Deployment:** App-only

「目前候補第 N 位」＋「順序可能因取消、資格與分配狀態而變動」（動態非固定號碼）。

#### #30 取消加「不計違規」reassurance
**Status:** Done ｜ **Wave:** 1 ｜ **Deployment:** App-only

「10:30 前取消不計違規」，讓會友安心取消。可順帶補申請表「週五18:00截止」。

---

### Closed — 決定不做

#### #2 顯示回同一組 PIN
**Decision:** Reject ｜ **Status:** Closed

scrypt 單向、明碼不落地；換人本就該撤舊碼。

#### #33b 覆核佇列帶眷屬衍生 enum
**Decision:** Reject ｜ **Status:** Closed ｜ 使用者 2026-07-28 定「33a 即可」

`/admin/eligibility` **維持刻意不帶眷屬任何資料**（[eligibilityReviewService.ts:10](../parking-system/server/services/eligibilityReviewService.ts#L10) 明寫 "No PII beyond name … (no phone/dependents)"）。曾評估「只帶衍生 enum（`preschool`/`school_age`/`unknown`）、不帶生日/年齡/姓名」，但那仍是該頁隱私姿態的一次放寬，而覆核者點進明細頁即可看到（33a 已足）⇒ **不為此破線**。日後若真有「在列表就要分流」的需求再重啟，且屆時仍以「只帶衍生 enum」為底線。

共用的需求脈絡（眷屬資料位置、`childCompanionValidUntil` 權威、as-of 鐵律、長者無年齡規則）見 `Active feature details` 的 #33a。

---

### Wave chronology — 建議動工順序（rev.3 — delivery-first，歷史）

> 本節記錄各刀的施工順序與完成標記。**Wave 已不是狀態模型**——目前狀態看 `Feature inventory`，Wave 只作為歷史標籤與跨文件對照（`pre-delivery-polish-backlog.md` 仍以 Wave 分節）。

> prod 已 walkthrough 並清回 baseline；正式資料/OA/文案未完成。排序以交付價值優先。
> **每刀 prompt 固定加**：改 Next.js route/server action/cookie/layout/middleware/caching/navigation 前，先讀 `node_modules/next/dist/docs/` 對應文件，不靠記憶（`parking-system/AGENTS.md`）。

**Wave -1：文件與通知 correctness** — 更新 `current_handoff.md`（嚴重過期）／建 `pre-delivery-polish-backlog.md`／#25／#1／明列 PIN 自動派送 deferred
**Wave 0：正式資料匯入** — #20／#21（重用既有 preview/conflict）／#22（科學記號拒絕）／測試兩模式共存
**Wave 1：低風險交付 UX** — #23→#24／#30／#29／#12／#27／#5A
**Wave 2A：寫入治理地基** — #15 Audit substrate ✅ **全部完成**。**拆三刀：2A-1 substrate ✅（PR #38 / `8513912`）／2A-2 read-only viewer ✅（PR #39 / `d2e6890`，app-only 無 migration）／2A-3 retention ✅（PR #43 / `5db33bc`，migration `0034`）**
**Wave 2B：關鍵 Admin 寫入**（需 #15、不需 #19）— **2B-1 #14A 車位容量 ✅（PR #40 / `8de24a0`，migration `0031`）／#10 P2 覆核：2B-2a 模型 ✅（PR #41 / `155c7f7`，migration `0032`）、2B-2b 寫入 RPC＋UI ✅（PR #42 / `c536b01`，migration `0033`）⇒ Wave 2B 交付阻擋全部解除／2B-2c 佇列列內操作（非阻擋，可留交付後）**
**Wave 2C：角色地基 ✅ 全部完成** — #19 Admin roles＋session 撤銷＋role matrix。**2C-1 兩層角色（系統管理員／幹事）✅（PR #45 `76e93f8`，migration `0035`）／2C-2 帳號管理 UI＋create/role/revoke RPC ✅（PR #46 `ca9de80`，migration `0036`）**
**Wave 3：其餘管理功能** — **3a #8 概覽＋#9 徽章 ✅ 完成**；**3b #17 通知系統狀態 B＋C ✅ 完成**；**3c #18 側欄兩區 ✅ 完成**；**3d #5B-a 名冊匯出 ✅ 完成**；**3e #32 概覽補申請狀況 ✅ 完成（PR #59）＋#33a 眷屬年齡/學齡前（尚待完成；皆 S、app-only、無 migration；#33b 覆核佇列 ❌ 不做）**；**3f #35 本週申請清單（`Pre-pilot`，#32 的下游）**；剩 **#14B override**（規則未定、需先產品決策）。#5B-b 顯示分級／#5B-c 批次 → post-delivery deferred
**Wave 4：通知便利性** — 通用 destination model→#7→#6A（#6B 後續）→#3（最後，語意最敏感）→#4／#26
**Wave 5：會員自助與分析** — ⚠️ **#34 已改版為 Member Data Lifecycle：34-0／34-0b-A／34a 拉到 pilot 前，不屬本 wave**（見專節）。本 wave 剩：**34b 會友自助維護**（車輛可本人直接改；**手機不可 direct edit**；P2 走 #10）＋**#11 P2 自助申請**（pilot 初期、合併規劃）→#28→**34c 新會友 self-onboarding**（系統穩定後）→#16／#13
**Deferred/不做**：#2 ❌

#### 依賴關係（rev.3 釐清，歷史）
`#10 需 #15、不需 #19`；`#14A 需 #15、不需 #19`；`#5B/#17/#18 需 #19`。→ Audit 與角色兩地基**可分離**，讓 #10/#14A 先於角色交付。

（此條原列於「關鍵設計決策」，屬已完成的 dependency resolution，不再約束未來實作 ⇒ 未升格為 INV。）

---

### 交付分級 — 歷史敘述

> 這段是舊版的交付門檻分級。**其判斷已完成任務**（清單已清空），保存脈絡用；目前的交付時點看上方 `交付分級` 與 `Feature inventory`。

**交付前必修**：文件同步、#25、#20、#21、#22、#23、#24、#27、#30
**強烈建議交付前 — 全部完成 ✅**：#5A ✅、**#15 ✅（2A-1／2A-2／2A-3 全完成）→ 稽核有邊界、可清理**、**#14A ✅（2B-1）→ 容量已不需 SQL**、**#10 ✅（2B-2a＋2B-2b）→ 資格已不需 CSV**（幹事可自行核准/撤銷，且 CSV 不再能推翻人工決定；2B-2c 佇列列內操作為便利化、不阻擋交付）、#12 ✅。**⇒ 此清單已清空，開發面可進正式交付收尾**（剩交付後 ops，見 runbook §8/§13；及非阻擋 backlog：2B-2c、retire `admin_reserved`）。**Wave 2C #19 角色地基已完成**（見動工順序）。
**可交付後迭代**：#3、#4、#6、#11、#14B、#16、#28、#5B-b／#5B-c（#8／#9／#17／#18／#19／#5B-a ✅ 已完成）

> **#34 不在此列**（兩輪外部審查改判）：**34-0 Import integrity（strict by default）／34-0b-A Import auditability／34a Profile completeness & confirmation ＝ pilot 前**，屬正式資料建立流程的 correctness，不是交付後便利化。
> **#32（概覽補申請狀況）例外**：技術上非阻擋（不做也能運作），但它補的是 #8 在 `application_open` 階段**首頁等於空白**的缺口——正是同工交付後每週最常看的那幾天。S 規模、app-only、無 migration ⇒ **建議併進交付前收尾，不要放到交付後**。
> #3 雖方便但人工重發 PIN 已能運作；反而 #10/#14A 仍碰 SQL 的交付風險更高。角色分級（#19）可留交付後。
> **更新（2026-07-25）**：#19（Wave 2C-1／2C-2）已完成 merged，此處「可留交付後」已成歷史脈絡。
> **更新（2026-07-17）**：#14A（2B-1）與 #10（2B-2a＋2B-2b）皆已完成 ⇒ **上句所指的交付風險已消除**，容量與 P2 資格都有 audited 的 Admin UI 路徑。僅存的「仍需手打 SQL」缺口是 **runbook §12.1 Step 0 的遠期 demo event 容量**（`/admin/capacity` 刻意只給當週/次週，見 §8 Wave 2B-1），屬 demo 走查而非同工日常營運。

---

### 判定圖例（舊詞彙，歷史）

> 已由上方「詞彙表」取代。舊符號 `✅／🕒／❌` 曾同時承載 decision、timing 與完成度，正是本次 normalization 要拆開的東西。

| 判定 | 意義 |
|------|------|
| ✅ 加入 backlog | 可行、值得做 |
| 🕒 defer | 可做但現在不划算，或有前置依賴 |
| ❌ 不做 | 與隱私邊界／架構衝突，或成本不成比例 |

規模：S（<半天）／M（1–2 天）／L（需切多刀）。

---

### 文件版本沿革

- **rev.1（2026-07-16）**：30 條判定＋動工順序。
- **rev.2**：一輪審查，修規格＋改 delivery-first 排序。
- **rev.3**：二輪審查，修實作語意（PIN 旋轉、commit-then-dispatch、雙真相、actor 模型、拒絕科學記號…）＋拆 Wave 2A/2B/2C。
- **rev.4（2026-07-29）**：IA normalization——Decision/Status/Delivery/Size/Deployment 五欄正交、canonical layer、#34 升格 Epic、歷史內容隔離進本節。

**rev.1–3 的文件「目的」原文**：Phase 9 收官後的功能規劃；記錄可行性與**實作語意決策**。**已動工：Wave -1/0/0.1/1 ✅、2A（全）✅、2B（全）✅、2C #19 ✅（PR #45/#46）、3a #8/#9 ✅（PR #47）、3b #17 ✅（PR #48）、3c #18 ✅、3d #5B-a ✅**（每列狀態欄為準；實作與規格分歧處**一律以實作為準**並記在該列與 migration 標頭）。

**對應**：[current_handoff.md](current_handoff.md)（每刀 merge 後同步，最新到 Wave 3 3d §6.47；其後 §6.48／§6.48.1 為上 prod 與 staged deployment 制度）、[prod-deploy-runbook.md](prod-deploy-runbook.md)。
