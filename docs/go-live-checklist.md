# Go-Live Checklist（交付走查 — 單一權威清單）

> **給教會 admin 的白話總覽（系統邏輯＋後台每頁怎麼用＋試營運怎麼走）在 [admin-operations-guide.md](admin-operations-guide.md)**，本檔的第 1.7 節在那邊有對應的白話說明；**勾選與驗證方式仍以本檔為準**。
>
> **交付日照這一份走。** 這是把分散在三處的交付待辦整合成的**唯一**權威 pre-flight：
> [prod-deploy-runbook.md](prod-deploy-runbook.md) §8/§13、[delivery-model-and-roadmap.md](delivery-model-and-roadmap.md) roadmap、[go-live-readiness.md](go-live-readiness.md) §1/§5。
>
> **紀律（同 [pre-delivery-polish-backlog.md](pre-delivery-polish-backlog.md)）**：本檔只記「做什麼／誰做／怎麼驗／出處」。**詳細步驟一律以連結的來源為準、不在此重述**——避免兩份文件分歧。
>
> **開發面已全數完成**（[pre-delivery-polish-backlog.md](pre-delivery-polish-backlog.md)：交付前必修＋強烈建議兩節皆清空；容量／P2 資格不需 SQL／CSV、稽核有邊界可清理）。**本檔只管交付日的 ops**——這些步驟幾乎都需要教會的正式憑證／資料／簽核，不在開發軌上。

---

## 0. 前置 gate — 先指派三個負責人（不指派不啟動）

> 出處：[go-live-readiness.md](go-live-readiness.md) §1。下面每一步的「誰」都指回這三個角色。

- [ ] **OA token owner** — 一位具名的 OA 管理者，保管 channel access token＋channel secret；只透過 secret store 交付給 dev，**絕不進 repo**；定義輪替聯絡人。手把手操作步驟：[oa-token-owner-runbook.md](oa-token-owner-runbook.md)。
- [ ] **Copy approver** — 一位具名簽核者，負責 3 個通知模板（`move_car_request`／`reservation_released`／`reservation_cancelled`）＋移車 A/B/C/D 變體。**未簽核前不得對真實會友送出任何一則。**
- [ ] **Scheduler / rollback on-call operator** — 一位具名 on-call，能 (a) 停用外部排程器、(b) 把 transport 壓回 `mock`/`log`、(c) 跑 `requeue-failed`。runbook：[dispatcher-ops.md](dispatcher-ops.md)。

---

## 1. 交付日順序（按序執行，每步驗過才進下一步）

> 出處：[delivery-model-and-roadmap.md](delivery-model-and-roadmap.md) roadmap §5「post-delivery ops」。順序有意義：真 PII 落地前先升 Pro；真送出前先簽文案。

### 1.1 資料保護：備份 ＋ 不被暫停（真 PII 落地前）

> **決策（2026-07-18）：先不升 Pro**（省 ~US$25/月）⇒ 走 **Free ＋自管備份**。可隨時回頭改：升 Pro 是 dashboard 一鍵、就地升級（同 project ref/URL/key、資料不動、Vercel env 不需改），升完每日備份自動開。
>
> **為什麼這一項還在**：升 Pro 從來不是為了效能或容量（本專案規模對 Free 綽綽有餘），**唯一真正的理由是備份**——Free **零每日備份**，而系統存真會友 PII（姓名/車牌/電話/資格含未成年生日）＋不可重建的 append-only 稽核軌。所以「先不付」不會讓這個 gate 消失，只是把它從「按一下升 Pro」換成「自己顧備份」。

- **Who**：dev（建置備份）＋ operator（顧它有在跑）
- [x] **自管加密備份上線 — 選 Free 後的新交付 gate，非可選**（2026-07-20 完成並驗證，見 [current_handoff.md](current_handoff.md) §6.37）：真 PII ＋不可重建稽核軌若零備份，就是唯一會真痛的風險。CSV 也救不回綁定/預約/稽核/幹事手動覆核。
  - **實作已在 main**（PR #44 / `cc6b66a`，一輪外部審查後修正）：排程 GitHub Action `pg_dump（public+private）→ age 加密 → 上傳 R2/B2`，**每次產出 dump ＋ manifest 兩個檔**（manifest 記每張表列數＋dump 雜湊）。程式＋設定＋還原見 **[backup-restore-runbook.md](backup-restore-runbook.md)**。
  - **還原有四道自動關卡**（全過才算成功，非零退出）：雜湊比對／pg_restore 錯誤 allowlist／**逐表列數與 manifest 完全一致**／`verify_schema_prod.sql` 通過。**「印出列數讓人自己看」不是災難復原的成功條件**——部分還原與整張表消失在數字裡都很正常。
  - **待教會填**：① 產 age 金鑰對、私鑰離線保管（**≥2 人各一份、跟備份分開放**）；② 建 R2/B2 private bucket；③ 設 GitHub Secrets/Variables；④ bucket lifecycle rule；⑤ **設 `HEARTBEAT_URL`**（見下）；⑥ 全部就緒後才把 `BACKUP_ENABLED` 設成 `true`（**arm 之前 workflow 什麼都不做**，故 merge 不會每天噴失敗信）。
  - **⚠️ 監控要對「沒發生」告警**：GitHub 只在「有跑但失敗」時寄信。本 repo 是**公開**的，而 **GitHub 對公開 repo 會在無活動 60 天後自動停用排程 workflow**——教會交付後 repo 必然安靜，屆時備份**無聲停止、不產生任何錯誤**。故必須設 dead-man's-switch heartbeat（healthchecks.io 免費即可），沒收到 ping 才會有人知道。
  - **Verify**：arm 後手動觸發跑一次 ＋ **做一次 §5 還原演練**看到 `restore: OK`——未驗過還原的備份等於沒有備份。
  - **替代**：若治理要求 PII 不進第三方雲 ⇒ 同一支腳本設 `LOCAL_DEST` 走 NAS／加密硬碟（需 self-hosted runner 或本機 cron），見 runbook §7。
- [ ] **暫停 foot-gun 處置**：Free 一週無活動會自動暫停。平常 11+ 個 cron 一直打 DB 不會觸發；**但 §2 rollback 第一步是停排程** ⇒ 停機數日後 DB 可能暫停、app 掛掉需到 dashboard 手動喚醒。記住此點（或 rollback 時留一個輕量 keep-alive ping）。
- **升 Pro 的替代路（日後若改主意）**：[prod-deploy-runbook.md](prod-deploy-runbook.md) §8——就地升級、同 project ref、勿建新專案；升完 Verify＝每日備份在 dashboard 顯示啟用（Pro 內含滾動 7 天；PITR 是額外付費 add-on、非必需）；記日期＋執行者進 [current_handoff.md](current_handoff.md)。

### 1.2 教會正式 OA 接線
- [x] **已完成並驗證（2026-07-20，見 [current_handoff.md](current_handoff.md) §6.38）**
- **Who**：OA token owner（提供憑證）＋ dev（換 env、repoint URL）——本次使用者身兼兩者。
- **Verify**：換 `LINE_CHANNEL_ACCESS_TOKEN`＋`LINE_CHANNEL_SECRET`（Messaging）、`LINE_LOGIN_CHANNEL_ID`＋`NEXT_PUBLIC_LIFF_ID`（LIFF，本次沿用既有 channel 故值未變）；LIFF endpoint＋Messaging webhook URL 指到同一 Vercel domain；`NEXT_PUBLIC_LIFF_ID` 是 build-time ⇒ **觸發一次新 build**；LINE Login channel 設 **Published**；跑一次 webhook Verify＋真機 bind/notify 冒煙。**移除舊 dev OA token**（改 `NOTIFICATION_TRANSPORT` **不會**讓舊 token 失效；這個 token 類型 Console 無獨立 revoke 按鈕，**Reissue 本身即撤銷**，失效有數分鐘級傳播延遲，見 [oa-token-owner-runbook.md](oa-token-owner-runbook.md) §8）。
- **Detail**：[prod-deploy-runbook.md](prod-deploy-runbook.md) §13、§11（token 失效語意）、[member-liff-setup.md](member-liff-setup.md)、[oa-token-owner-runbook.md](oa-token-owner-runbook.md)

### 1.3 匯入真會友 CSV（P2 申請資料）
- **Who**：church office（提供 CSV）＋ admin（走 Admin 匯入 UI）
- **Verify**：透過 `/admin`（會友匯入）跑 preview → 檢查衝突/資格 → apply；spot-check 資格正確；`line_id` 匯入時維持 NULL（綁定另外接）。若輪替過 service-role key，**避開 30 分鐘匯入窗**（它同時簽 import HMAC）。
- **Detail**：[member-import-ops.md](member-import-ops.md)、[delivery-model-and-roadmap.md](delivery-model-and-roadmap.md)（CSV→schema 對照）

### 1.4 文案 sign-off（真送出前的硬 gate）
- [x] **已完成（2026-07-20，見 [current_handoff.md](current_handoff.md) §6.39）**：3 個通知模板＋移車 A/B/C/D 變體＋取消兩種措辭全部簽核。過程中抓到 `move_car_request` code 跟 doc 已經分岔（code 誤植「處理，現場有停車同工協助」，非簽核過的「移動您的愛車」）並修正，另把 `reservation_released`／`reservation_cancelled` 從未進過 doc 的「暫定文案」正式定稿；4 個 pin test 釘住確切文字，日後任一邊改動未同步會直接讓 CI 失敗。
- **Who**：Copy approver
- **Verify**：3 個通知模板＋移車 A/B/C/D 變體全部簽核。**未簽核前 1.6 不得開。**
- **Detail**：[oa-onboarding-and-move-car-copy.md](oa-onboarding-and-move-car-copy.md)、[go-live-readiness.md](go-live-readiness.md) §1

### 1.5 排程上線 — dispatcher（11）＋ audit purge cron（第 12，本輪新增）
- [x] **已完成並驗證（2026-07-21，見 [current_handoff.md](current_handoff.md) §6.40）**：既有 11 個 cron 逐一 test run 全數 200、URL host 仍為 prod domain，secret 未漂移；新增第 12 個 job（`purge-audit-logs`，cron-job.org `0 4 1 * *` Asia/Taipei＝每月 1 號 04:00）已建立並排程。`?dryRun=1` 驗證回 `retentionMonths:24`、`deletedBefore:"2024-07-21 14:25:15+00"`（今天往前推 24 個月，剛好對上）、`wouldPurge:0`（prod 資料還新，無超期紀錄本屬正常）——第二個硬 gate 過關，`/admin/audit` 的 24 個月保留文案自此誠實。
- **Who**：Scheduler operator
- **Verify**：11 個既有 cron 指到 Vercel domain 且 `JOB_TRIGGER_SECRET` 相符（[prod-deploy-runbook.md](prod-deploy-runbook.md) §6.5）。**新增第 12 個：`GET /api/internal/jobs/purge-audit-logs`，每月一次**（cron-job.org Asia/Taipei 整點慣例，或 Vercel Pro `0 4 1 * *`）。
  - ⚠️ **這是 1.4 之外的第二個硬 gate**：`/admin/audit` 現在對幹事宣稱「紀錄保留 24 個月，逾期後由定期維運作業清除」——**這句只有在這個 cron 真的在跑時才誠實**。上線前先用 `?dryRun=1` 打一次，必須回 `retentionMonths: 24` 且 `deletedBefore` ≈ 24 個月前，才可信任該文案。
- **Detail**：[prod-deploy-runbook.md](prod-deploy-runbook.md) §13（audit purge cron 條目）、§6.5、[dispatcher-ops.md](dispatcher-ops.md)

### 1.6 開啟真實送出（`NOTIFICATION_TRANSPORT=line`）
- [x] **已完成並驗證（2026-07-22，見 [current_handoff.md](current_handoff.md) §6.41）**：驗證途中發現 1.4 的 `templates.ts` 修正其實從未 commit／push，prod 仍在送舊文案——已修正並部署，重測後手機收到的文字精確符合簽核版本（「…移動您的愛車…」），`status=sent`／`last_error` null。
- **Who**：Scheduler operator（1.4 簽核後）
- **Verify**：fail-fast 契約仍在（無 token 時 `transport=line` 會在 claim 前中止、絕不把列標 `sent`）；先對一位知情 operator 帳號送單一測試通知，確認到達再繼續。⚠️ `LINE_SEND_ENABLED` 目前**未被任何程式碼讀取**（唯一真正閘門是 `NOTIFICATION_TRANSPORT`）——單次測試改用手動插入一筆指定 `user_id` 的 outbox 列＋觸發一次 dispatch＋精確 SQL 核對該列，見 [oa-token-owner-runbook.md](oa-token-owner-runbook.md) §7。
- **Detail**：[go-live-readiness.md](go-live-readiness.md) §2（config lock）、[dispatcher-ops.md](dispatcher-ops.md)

### 1.7 Pilot 分批放行（onboard + bind，逐步）
- **Who**：church office（發綁定碼）＋ admin（審核綁定）＋ Scheduler operator（看健康度）
- **Verify**：先一個小組走綁定碼流程 → admin 審核寫 `line_id`（尊重 `users_line_id_key` 唯一性、衝突要顯式處理）→ 只對該 cohort 開送出 → **看 `/outbox-alert` 撐過至少一個主日循環再擴大**。每次擴大前：無不明 terminal `failed`、無 stale `processing` lease、DUE backlog 在門檻內、未綁定車主顯示 fallback 文案、log/`last_error` **絕無** `line_id`/車牌/內文。
- **Detail**：[go-live-readiness.md](go-live-readiness.md) §5（pilot rollout）、[binding-ops.md](binding-ops.md)

---

## 2. Rollback（隨時可用，operator runbook）

先停外部排程器（dispatcher 是 pull-driven，無排程＝無送出）→ transport 壓回 `mock`/`log`（真正生效的關鍵在這裡——`LINE_SEND_ENABLED` 目前未被任何程式碼讀取，設它不影響行為）→ **根因修好後才** `requeue-failed`（手動限定、絕不 replay 進壞掉的 transport）。詳見 [go-live-readiness.md](go-live-readiness.md) §6、[dispatcher-ops.md](dispatcher-ops.md)。

---

## 3. 交付後持續 ops（非一次性、非阻擋交付）

- **通知 LIFF deep-link（#26）** — 讓通知一觸就開會員頁動作；#25 已把「回覆」死指令改成導向會員頁，deep-link 是其正解。見 [feature-triage.md](feature-triage.md) #26。
- **監控** `/outbox-alert`（503＝不健康，外部 monitor 收信）、audit purge 每月 run 的 `hasMore` warning。
- **確認自管備份最近一次成功**（§1.1 選 Free 後的持續責任——備份靜默失敗＝回到零備份，比沒設更危險，因為你以為有）。若日後升 Pro，此條移除。
- **非阻擋 dev backlog**（要不要做由你決定，皆可留）：2B-2c P2 佇列列內操作、Wave 2C #19 admin 角色分級、retire `admin_reserved`、`server-only` 套件、a11y menu 語意。見 [pre-delivery-polish-backlog.md](pre-delivery-polish-backlog.md)「可交付後迭代」。
