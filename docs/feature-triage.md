# 功能想法 Triage（討論筆記，未實作）

> 目的：Phase 9 收官後，逐一討論想改動的功能，只**記錄與判定可行性**，暫不動 code。
> 全部談完再一起規劃動工。
> 開始：2026-07-16 ｜ 對應：[v2-backlog.md](v2-backlog.md)、[current_handoff.md](current_handoff.md)、[prod-deploy-runbook.md](prod-deploy-runbook.md)

---

## 判定圖例 (verdict legend)

| 判定 | 意義 |
|------|------|
| ✅ 加入 backlog | 可行、值得做，記進 backlog 待排期 |
| 🕒 defer / 延後 | 可做但現在不划算，或有前置依賴 |
| ❌ 不做 | 與隱私邊界／架構衝突，或成本不成比例 |
| ❓ 需補資訊 | 要先確認某件事才能判 |

規模標記：S（小，<半天）／M（中，1–2 天）／L（大，需切多刀）。

---

## 本輪討論 (2026-07-16 起)

| # | 想法 | 相關 surface | 規模 | 隱私影響 | 依賴／卡點 | 判定 | 備註 |
|---|------|--------------|------|----------|------------|------|------|
| 1 | 換人值班時「換碼」（撤舊碼） | admin/staff-pin | S（文案） | 無 | 無 | ✅ 現有即正解 | 現有「重新發碼」＝產生新碼、舊 hash 立即失效，正是換人該有的撤銷語意。頂多加一句 UX 文案「換人值班？重發即可，舊碼自動失效」。 |
| 2 | 管理頁直接顯示回當週同一組 PIN | admin/staff-pin | — | 高 | — | ❌ 不做 | PIN 是 scrypt 單向雜湊、明碼不落地（發一次即不可回讀）。要顯示得改存可還原明碼＝反轉設計；且換人情境本就該撤舊碼，「看回舊碼」反而反安全。 |
| 3 | PIN 每週**自動發到同工 LINE 群**（interim） | webhook / 通知管道 / cron / staff-pin | M | 全群可見＋留群聊記錄（已接受） | ①OA 允許入群＋加 OA 進同工群 ②webhook 擴充擷取 groupId ③outbox 新增「系統→群、無 user」通知路徑 ④新模板 `staff_pin_notice` ⑤前一天 cron：ensure-event→發碼→推群 | ✅ 加入 backlog | **繞過綁定問題**（不需任何同工綁定）。解掉「私訊很麻煩」。發群 API 的 `to` 已支援 groupId，transport 送得出，主要新工在 outbox 目的地模型＋webhook 擷取。 |
| 4 | 之後改「個別私訊」當週值班人 | 同上＋member 綁定＋輪值表 | L（多刀） | 1:1 精準、不外洩全群（較佳） | ①值班同工需完成 OA 綁定（都是會友但**不一定已綁**，因不一定有停車）②若要全自動選人需系統內輪值表 model＋Admin 輸入 UI | ✅ backlog（defer 於 #3 之後） | 全是會友 → 重用現有 member 綁定拿 line_id，不另建。半自動（發碼頁挑人按送）可先於全自動輪值表。 |
| 5 | 會友管理頁一進畫面**列全部會友**（含現有欄位、分頁） | admin/members | M | 中：預設攤開全體姓名/遮罩電話/車牌（使用者接受） | 需分頁；底層 `searchMembers` 已有 limit/hasMore，加「列全部」模式即可 | ✅ 加入 backlog | 現況刻意「查了才顯示 PII」，此為有意識的隱私姿態轉變。與已知 backlog「Admin 功能缺口」同組。 |
| 6 | Admin **憑車牌隨時請移車**（非主日、辦公室接電話代發） | admin/members（新動作）＋通知管道 | M–L | 車牌→車主僅限已綁 line_id 會友；訪客/未綁→通知不了（同現有限制） | ①**新「不綁 event/reservation」通知路徑**（現在 enqueue 必帶 eventId＋reservation_id，dedupe/FK 都靠它）②車主須已綁 line_id ③權限擴張：移車從「現場 Staff PIN 動作」→「Admin 隨時動作」 | ✅ 加入 backlog | 現有移車是 Staff 現場頁專屬＋綁當週 event（[moveCarService.ts:28](../parking-system/server/services/moveCarService.ts#L28)），打不到「任意日任意車牌」。重用 `move_car_request` 模板＋車牌→車主解析。 |
| 7 | 移車（及急件）**即時通知** | 通知管道 / dispatcher | S–M | 無 | enqueue 後 inline 觸發一次 dispatch（dispatcher 有原子 claim/lease，安全）；cron 當後盾重試 | ✅ 加入 backlog | 現況 enqueue-only、等排程那一拍（實測 ~2min）。inline dispatch 對所有急件有用，移車尤其。可與 #6 一起出。 |
| 8 | **本週概覽**（Admin 首頁，**上指標下待辦**版） | admin/page（現為空）| M | 低：純聚合 counts、零 PII | ①數字全可由 weekly_events＋reservations 算出 ②**必鎖管理日曆當週主日、非 `getActiveEvent`**（後者最新未-finalized 會誤判）③需標本週階段（報名中/已分配/主日/已結算）數字才可解讀 | ✅ 加入 backlog | 參考 [mockup 本週概覽](../mockup/index.html#L890)。改良：上半 KPI 指標，下半「待辦」區連各頁；比 mockup 靜態儀表板多了時態與待辦入口，順便給空白 Admin 首頁落地。mockup 快速操作（車位設定/報表匯出/稽核記錄）為**各自獨立功能**，概覽先 link-only。 |
| 9 | **Sidebar 待辦徽章**（像通知紅點） | admin sidebar（全頁） | S–M | 低：counts only | 與 #8 待辦區**共用一份「待辦計數」來源**（P2 待審／牧養未處理／通知佇列 backlog）；查詢要輕（一支 RPC 回全部徽章數，每頁渲染） | ✅ 加入 backlog | mockup 側欄已示範此模式（[牧養關懷紅點 2](../mockup/index.html#L871)）。新鮮度＝頁面載入即時；要即時跳動才需輪詢。可與 #8 綁在一起做。 |
| 10 | **P2 寫入型覆核**（核准/編輯/撤銷/標記已覆核）＋ `reviewed_by` 稽核（Phase 1：幹事直接核定） | admin/members/[id]（寫入動作）＋ admin/eligibility（inline 快捷） | M | 中：敏感事由/眷屬，session-gated | 需 `reviewed_by_admin_id` migration（對應已知 follow-up）；一個寫入 service | ✅ 加入 backlog | **現況資格審查全唯讀、P2 只能靠 CSV 匯入進來**。UX 決策：**不合併兩頁**——寫入動作放明細頁（需完整脈絡），資格審查頁保留為「時間驅動佇列」＋ inline 快捷，兩處共用同一寫入 service。detail view vs work-queue 兩條進入軸，不重複。 |
| 11 | **P2 會友自助申請 ＋ 待審 inbox**（Phase 2） | member（新申請 UI）＋ admin/eligibility（進件佇列） | L | 中 | defer 於 #10 之後；需 member-facing 送件流程＋ intake 狀態 | ✅ backlog（Phase 2） | 對應 mockup 的「P2 待審核申請」。現系統無會友自助申請流程，要新建送件 UI＋進件審核。 |
| 12 | **資料最小化橫幅**（資格審查/明細頁） | admin/eligibility, members/[id] | S | — | 無 | ✅ 加入 backlog | 參 [mockup banner](../mockup/index.html#L942)：明示「不索取/不顯示診斷證明」。便宜的治理訊號。 |
| 13 | **P1 全職同工名單管理**（新增/移除 ＋「本週不停」自動釋出） | admin（新） | M–L | — | 「本週不停自動釋出」是**未定業務規則**（mockup 標「提案待確認」） | 🕒 defer / 另計 | 使用者決定不納入資格審查這輪。名單管理與 auto-release 可拆：名單管理較單純，auto-release 需先敲業務規則。 |
| 14 | **本週車位設定**（stepper 改 blocked_spaces ＋ 申請開放 toggle） | admin（新）＋ weekly_events | M | 低 | design-time：(a) 外賓保留/停用維修**拆兩欄 or 一個 blocked 總數** (b) 開放 toggle 與**時間視窗/週五分配**的互動規則 | ✅ 加入 backlog | 已知「車位設定」缺口。現況只能改 SQL。坑：容量在**週五分配後**才改會擠掉人 → UI 需提示/限時機。 |
| 15 | **稽核記錄（Audit Log）** — **地基先行** | 橫切（所有 admin 寫入）＋ admin 唯讀頁 | L | 中：對象欄含姓名＝PII | **決策：在第一批寫入功能（#10 P2 寫入、#14 改容量…）之前/同時建 substrate**，讓寫入一出生就吐稽核，避免回頭逐一改 service | ✅ 加入 backlog（**優先地基**） | 現況無稽核 log。治理：append-only（不給 update/delete 權）、保存 2–3 年、僅 Admin 讀；與 90 天綁定 PII 清除是兩套 retention，需分開設計。 |
| 16 | **停車樣態分析**（先只做**聚合統計**） | admin（新）＋歷史資料 | L | 低（聚合）；**不列具名 No-show 排名** | ①價值隨營運週數累積（demo 資料算不出、需實跑幾週）②「候補等待週數」metric 需先定義③圖表用 dataviz skill | ✅ 加入 backlog | **決策支援：開放 P3 的重要依據**（使用率餘裕/No-show 有效容量/候補深度）。聚合 KPI＋每週申請-到場-No-show 圖＋分配結構；**具名排名先不做**（隱私/公審邊界）。 |
| 17 | **營運狀態頁按讀者分層重構**（方案 **B＋C**） | admin/ops ＋ sidebar | M | 無（皆 counts/碼） | 診斷：現頁混工程與幹事兩種讀者，術語（due/retrying/stale/死信重送/error code/UTC）幹事看不懂；C 部分依賴 #19 角色 | ✅ 加入 backlog | **B**：白話健康＋「怎麼辦」在上、技術細節＋重送工具摺疊。**C（有 #19 角色後）**：完整技術 ops 只給系統管理員，幹事只看白話健康。含 quick win：**UTC→台北**、**改名**（營運狀態→系統通知健康）、異常給指引、**移 sidebar 最下**。與 #9 徽章呼應。 |
| 18 | **側欄資訊架構重整**（日常工作／系統維運 兩區） | admin sidebar（全頁） | S–M | — | 「系統維運」區可視性接 #19 角色 | ✅ 加入 backlog | 上區＝日常工作（概覽·會友·資格·牧養·現場PIN·匯入）；下區＝系統維運（車位設定·稽核·營運狀態），中間分隔線。**此分區線 = #19 角色邊界**（系統維運區 = 系統管理員 only）。 |
| 19 | **Admin 角色分級（兩級）＋新增管理者 UI** | admin/accounts ＋橫切敏感面 | M–L（準地基） | — | ①現況：平權 peer model、無 role 欄、建帳號只能 CLI ②每個敏感路由/頁加「是否系統管理員」檢查 | ✅ 加入 backlog | 兩級＝**系統管理員 / 幹事**（照人設命名，非「權限高低」）。改良：**`role` enum 欄位**（非 boolean，為未來「長執唯讀」預留第三級）；**最小權限預設**（UI 新建=幹事，升權另為刻意動作）；bootstrap＝CLI 建的第一位為系統管理員、保留≥1 位啟用中系統管理員、不能自我升權；新增帳號重用現有「密碼顯示一次」pattern；**角色變更必進稽核（#15）**。 |

| 20 | **匯入器支援中文 header**（＋reason 中文→代碼值對照） | lib/memberImport 匯入 | S | 無 | 現況 parser 硬吃英文 header（[memberImport.ts:160](../parking-system/lib/memberImport.ts#L160)），中文檔→`missing_headers` | ✅ 加入 backlog | 加一層「中文→英文」header 對照＋reason「行動不便/長者…→1/4」值對照，幹事不用背代碼。讓 [docs/import-templates](import-templates/) 兩份範本可直接匯入。 |
| 21 | **簡易全體會友匯入**（reason 選填、精簡欄位） | admin/import ＋匯入 service | M | 中：名單 PII | 現況匯入器**每列必填 reason_type 1–4＝P2-only**，無 P3/一般會友路徑 | ✅ 加入 backlog | 對應 [會友簡易名單範本](import-templates/會友簡易名單範本.csv)（姓名/手機/車牌/優先序/P2事由/備註）。新 import 變體或擴充現有；與 #5 列全部會友、#20 中文 header 連動。**已交付中文範本檔供幹事先整理名單。** |
| 22 | **匯入手機容錯補 0**（Excel 掉前導零防呆） | lib/memberImport `normalizePhone` | S | 無 | Excel 存 CSV 會把 `0912…` 變 `912…`；現 `normalizePhone` 只去非數字、驗證 `^09\d{8}$` 直接擋掉 | ✅ 加入 backlog | 手機是身分主鍵，掉 0＝匯入失敗/對不上。做法：normalize 時「9 碼且開頭 9」→ 補回 `09`；仍保留 `^09\d{8}$` 最終驗證。高 CP 值防呆。範本 README 已加 Excel 警告。 |
| 23 | **點名備援清單搬到 admin**（/staff/print → /admin） | /staff/print → admin ＋ sidebar | S–M | 保留 Staff-safe 最小內容（實體紙本隱私） | event 解析改用**管理日曆當週主日**（非 `getActiveEvent`）；gate 改 `getAdminSession` | ✅ 加入 backlog | 原因：staff 地下室**無印表機**、列印**非 staff 權限**；正確流程＝辦公室主日前先印好交同工。資料源/`lib/staffRow`/`PrintButton` 全重用。放側欄「日常工作」區（#18）。移除 staff 列印入口（除非保留唯讀 fallback）。 |
| 24 | **staff footer 精簡**：結束鍵移 header、footer 單顆 | /staff StaffCheckIn footer/header | S | 無 | 依賴 #23（列印移走後才剩兩顆）；結束鍵**保留二次確認 sheet** | ✅ 加入 backlog | 拿掉列印後 footer 只留全寬「＋登記現場車輛」（高頻）；「結束當週點名」（一場一次、不可復原）移到 header 選單。省兩列、清單可視區最大、零誤觸。延續 **staff＝純現場動作** 收斂主題。原 footer 三顆直排 [StaffCheckIn.tsx:672](../parking-system/app/staff/StaffCheckIn.tsx#L672)。 |

| 25 | **通知文案 correctness 修正**（死指令） | templates.ts p2_arrival_reminder / offer_2hr_confirm | S | 無 | webhook capture-only、只認綁定指令；「回覆正在路上/請回覆確認」→ `ignored`、後端沒接 | ✅ **go-live 必修** | 上線模板叫會友「回覆正在路上」但 webhook 不處理→P2 以為講了、車位照釋出。短期先改寫指向 LIFF（「請開 LINE 選單…」）或移除該句；正解＝ #26 deep-link 按鈕。真正 on-the-way 走 [onTheWayService](../parking-system/server/services/onTheWayService.ts) / LIFF。 |
| 26 | **通知可動作化：LIFF deep-link 按鈕** | 通知模板＋LIFF | M | 無 | 需 LIFF URL；LINE Flex/URI action button；接 #25 消死指令 | ✅ 加入 backlog | 確認保留/放棄、正在路上、回會員頁做成點擊即開 LIFF 對應動作。**升級並吸收** phase9「通知 deep-link」backlog。friction：讀訊息→開App→找按鈕 ⇒ 訊息內點一下。 |
| 27 | **通知內容 enrich**（主日日期＋車牌＋粗體期限＋換行） | 通知模板＋producer payload | S–M | 低（車牌屬本人） | 模板只讀 row 上 payload → producer 端須補 plate/date 欄位 | ✅ 加入 backlog | 現況核准通知無日期/車牌/具體時間（多車會友不知哪台）。參 [mockup 核准/遞補](../mockup/index.html#L427) 的分行＋粗體期限結構。語氣維持現狀（已夠溫和）。 |

| 28 | **管理我的車牌**（member plate 自助 CRUD，**全自助**） | app/member ＋新 routes | M | 低（本人車牌） | 驗證：新增不得撞他人車牌（walk-in plate unique index）；刪除擋本週有預約者；P2 綁人不綁車（解耦） | ✅ 加入 backlog | 現況只能選不能管、加減車要找同工（[MemberStatus.tsx:428](../parking-system/app/member/MemberStatus.tsx#L428)）。**新增/刪除/設預設全自助**（使用者定案）。含暱稱。參 [mockup 我的車牌](../mockup/index.html#L276)。**濫用治理（P2 出借車位給 P3）＝輕護欄＋社群處理**：①plate 唯一性擋借已註冊者車牌 ②車牌增刪寫稽核（#15）使換牌可見 ③一人一週一位＝傷害天花板 ④勸導→停用（現有 admin 停用＋#19）。**不另建反濫用機器**——量級低頻低傷、且部分已擋。 |
| 29 | **member 顯示候補序號 #N** | app/member 狀態卡 | S | 無（自己排位） | rank 資料已存在（reservation_waiting 模板已用） | ✅ 加入 backlog | 現況只說「候補中…依序遞補」無序號（[MemberStatus.tsx:77](../parking-system/app/member/MemberStatus.tsx#L77)）。會友想知「排第幾」。surface 到狀態卡即可。 |
| 30 | **取消加「恩慈／不計違規」reassurance** | app/member CancelButton | S | 無 | 準確：自行取消（期限前）不罰 | ✅ 加入 backlog | 現況取消只寫「車位釋出給候補」（[MemberStatus.tsx:358](../parking-system/app/member/MemberStatus.tsx#L358)），缺「10:30 前取消不計違規」。**行為面**：讓會友安心取消、不硬佔車位害候補白等（mockup 設計理由 [:370](../mockup/index.html#L370)）。可順帶補申請表「週五18:00截止」提示（次要）。 |

---

## 跨切共用地基（規劃期一次做、多功能共用）

隨討論浮現的**共用底層**，動工時應合併，避免重複工：

- **不綁預約/event 的通知路徑** → #3（PIN 發群）＋ #6（憑車牌移車）共用
- **待辦計數來源（一支 RPC）** → #8（概覽待辦區）＋ #9（側欄徽章）共用
- **稽核寫入 substrate** → #15，且 **#10 / #14 / 所有 admin 寫入** 都要吐稽核 → **地基先行**（使用者已定）
- **P2 寫入 service** → #10（明細頁動作）＋資格審查頁 inline 快捷共用
- **Admin 角色（兩級 enum）** → #19，且 **#17 ops 分級（C）／#18 側欄系統維運區可視性** 都以角色為界 → 準地基（一條角色線同時定義「誰能看/操作」與側欄分區）

---

## 建議動工順序（依賴關係分波）

> 每刀照慣例走 plan mode ＋ 外部審查。小補（S、無依賴）可隨時插隊填空檔。

**Wave 0 — go-live 必修（先修、獨立）**
- **#25** 通知死指令修正（S）— 已上線 correctness，趁真會友還沒接入先改。

**Wave 1 — 準地基（先行，後面多數功能靠它）**
- **#15** 稽核 Audit Log substrate（L）— 最先；之後每個寫入功能一出生就吐稽核。
- **#19** Admin 角色分級 enum ＋ 新增管理者（M–L）— gate ops/側欄/帳號；角色變更本身也吐稽核。

**Wave 2 — 共用地基（中層，一次做解鎖多功能）**
- 不綁 event 通知路徑（解鎖 #3、#6）
- 待辦計數源 RPC（解鎖 #8、#9）
- P2 寫入 service（解鎖 #10）
- 通知 LIFF deep-link 基礎 **#26**（同時完成 #25 正解）

**Wave 3 — 解鎖後的主功能**
- 通知路徑上：**#3** PIN 發群、**#6** 憑車牌移車、**#7** 即時通知
- 計數源上：**#8** 概覽、**#9** 側欄徽章
- 稽核＋角色上：**#10** P2 寫入覆核、**#14** 車位設定、**#17** 營運狀態 B+C、**#18** 側欄 IA
- 會友端：**#28** 管理我的車牌、**#5** 列全部會友、**#21** 簡易全體匯入
- **#16** 停車樣態分析（價值隨營運週數累積，可較後）

**Wave 4 — 獨立小補（無依賴，隨時可做）**
- **#20** 中文 header、**#22** 手機補 0、**#29** 候補序號、**#30** 恩慈取消、**#12** 隱私橫幅、**#27** 通知內容 enrich、**#1** 換碼 UX 文案
- **#23** 列印搬 admin → **#24** staff footer 精簡（#24 依賴 #23）

**Deferred**
- **#4** PIN 個別私訊（待 #3 ＋ 同工綁定推廣）、**#11** P2 自助申請 inbox（待 #10）、**#13** P1 同工管理（業務規則未定）、**#2** ❌ 不做

---

## 已知 backlog（供參考，非本輪新提）

**交付後 ops（runbook §8/§13）**：升 Supabase Pro、換教會正式 OA、真會友 CSV、文案 sign-off、通知 deep-link polish。

**Feature backlog**：Admin 功能缺口（概覽/單筆新增會友/車位設定/匯入 template）、a11y modal focus-trap、landing 改版。

**Phase 8 follow-up**：資格審查寫入型覆核（需 `reviewed_by_admin_id` migration）、匯入稽核欄、staff per-device session/PIN 輪替、另兩種牧養觸發。
