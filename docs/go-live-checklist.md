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
>
> **具名記錄不入本 repo。** 本 repo 為**公開**；「誰保管 OA token」「誰能停排程／壓 transport」與具名個人綁在一起公開，等於提供社交工程的著力點，且當事人未同意姓名上 GitHub。⇒ **本檔只記「已指派＋日期＋權威記錄在哪」**，姓名與聯絡方式一律放教會內部交接文件。

- [x] **OA token owner** — 一位具名的 OA 管理者，保管 channel access token＋channel secret；只透過 secret store 交付給 dev，**絕不進 repo**；定義輪替聯絡人。手把手操作步驟：[oa-token-owner-runbook.md](oa-token-owner-runbook.md)。 **已指派（記錄於 2026-07-29）**；具名資料見教會內部交接文件。
- [x] **Copy approver** — 一位具名簽核者，負責 3 個通知模板（`move_car_request`／`reservation_released`／`reservation_cancelled`）＋移車 A/B/C/D 變體。**未簽核前不得對真實會友送出任何一則。** **已指派（記錄於 2026-07-29）**；具名資料見教會內部交接文件。
- [x] **Scheduler / rollback on-call operator** — 一位具名 on-call，能 (a) **停用外部排程器**——**這是目前唯一即時、已驗證的 production kill switch**、(b) 跑 `requeue-failed`。**⚠️ 不要在 production 動 `NOTIFICATION_TRANSPORT` 或改 Vercel env 當作停送手段**（前者會被拒、後者要 redeploy 才生效，見 §2）。runbook：[dispatcher-ops.md](dispatcher-ops.md)。 **已指派（記錄於 2026-07-29）**；具名資料見教會內部交接文件。

> ⚠️ **三個角色目前由同一人兼任**（§1.2 的紀錄即為「本次使用者身兼 OA token owner 與 dev」）。形式上 gate 已過，**實質上沒有備援**——§2 的 rollback runbook 假設「on-call 能在你不在時動手」，但目前無第二人能停排程或跑 `requeue-failed`。**§1.7 有一條 HARD GATE：備援 on-call 就位是「pilot 擴大」的前置**（首批由主要 on-call 全程在場的 supervised pilot 不受此擋），通過條件是「已取得 runbook／告警處置／escalation 資訊，並由備援本人實際演練過一次」，不是名冊上多一個名字。（讀本檔的人不要因為三格都打勾就以為有三層保險。）

---

## 1. 交付日順序（按序執行，每步驗過才進下一步）

> 出處：[delivery-model-and-roadmap.md](delivery-model-and-roadmap.md) roadmap §5「post-delivery ops」。順序有意義：真 PII 落地前先升 Pro；真送出前先簽文案。

### 1.0 部署安全：關掉 Vercel 自動切換 production domain（交付前必做）

> **為什麼在最前面**：這一條不做，下面每一條「改完部署」的步驟都可能被搶跑。已有三次同型漂移（[current_handoff.md](current_handoff.md) §6.37／§6.41／§6.48），最近一次是 `0035` 進 main 後 Vercel 立刻切了 app、migration 三天後才套用。

- **Who**：dev
- [x] **已完成並驗證（2026-07-27，見 [current_handoff.md](current_handoff.md) §6.48）**：Vercel → Settings → Environments → Production → Branch Tracking → 關掉 **Auto-assign Custom Production Domains**（Production branch 維持 `main`）。以建立本規則的 docs-only PR #51 實跑驗收：merge 後停在 **Staged**、正式 domain 仍服務舊 **Current**，Promote 後才切換（指紋比對證實），promote 未動到 toggle。
- **Verify**：**不要另外製造測試 commit**——拿建立這條規則的那支 docs-only PR 當第一次驗收（無 migration、A✅B✅、blast radius 最低，即使 toggle 沒設成功而直上 production 也只是文件）。merge 後 Deployments 該筆狀態應為 **Staged**、production domain 仍指向前一版（**Current**）；手動 **Promote** 後才變 Current，且不會 rebuild。
- ⚠️ **這個設定會自己還原**：Instant Rollback 之後 Vercel 會自動關掉 auto-assign，而「Undo Rollback」**又會把它打開**。**每次 rollback 後回頭確認一次**（見 [prod-deploy-runbook.md](prod-deploy-runbook.md) §1.5／§2.5）。
- ⚠️ **本專案是 Vercel Hobby**：Instant Rollback **只保證回得到「上一個 production deployment」**（Pro/Enterprise 才能挑任一曾服務過 production 的版本）。不要把「挑一個更舊的已知良好版本」當成 recovery plan。
- **之後每次含 migration 的 release**：merge → `db push` → `db:verify:remote` → 在 staged URL smoke → Promote → 在正式 domain smoke → **回頭確認 auto-assign 仍為 OFF**。順序與 A/B/R 相容性判斷見 [prod-deploy-runbook.md](prod-deploy-runbook.md) §1.5、§2.5。

### 1.1 資料保護：備份 ＋ 不被暫停（真 PII 落地前）

> **決策（2026-07-18）：先不升 Pro**（省 ~US$25/月）⇒ 走 **Free ＋自管備份**。可隨時回頭改：升 Pro 是 dashboard 一鍵、就地升級（同 project ref/URL/key、資料不動、Vercel env 不需改），升完每日備份自動開。
>
> **為什麼這一項還在**：升 Pro 從來不是為了效能或容量（本專案規模對 Free 綽綽有餘），**唯一真正的理由是備份**——Free **零每日備份**，而系統存真會友 PII（姓名/車牌/電話/資格含未成年生日）＋不可重建的 append-only 稽核軌。所以「先不付」不會讓這個 gate 消失，只是把它從「按一下升 Pro」換成「自己顧備份」。

- **Who**：dev（建置備份）＋ operator（顧它有在跑）
- [x] **自管加密備份上線 — 選 Free 後的新交付 gate，非可選**（2026-07-20 完成並驗證，見 [current_handoff.md](current_handoff.md) §6.37）：真 PII ＋不可重建稽核軌若零備份，就是唯一會真痛的風險。CSV 也救不回綁定/預約/稽核/幹事手動覆核。
  - **實作已在 main**（PR #44 / `cc6b66a`，一輪外部審查後修正）：排程 GitHub Action `pg_dump（public+private）→ age 加密 → 上傳 R2/B2`，**每次產出 dump ＋ manifest 兩個檔**（manifest 記每張表列數＋dump 雜湊）。程式＋設定＋還原見 **[backup-restore-runbook.md](backup-restore-runbook.md)**。
  - **還原有四道自動關卡**（全過才算成功，非零退出）：雜湊比對／pg_restore 錯誤 allowlist／**逐表列數與 manifest 完全一致**／`verify_schema_prod.sql` 通過。**「印出列數讓人自己看」不是災難復原的成功條件**——部分還原與整張表消失在數字裡都很正常。
  - **✅ 已完成 arm、備份實跑中**（原「待教會填」六項全數完成；2026-07-29 實查更正——本檔一度仍列為待辦）：`gh variable list` 顯示 **`BACKUP_ENABLED=true`（2026-07-20 設定）**＋`AGE_RECIPIENT`／`S3_BUCKET`／`S3_ENDPOINT`／`AWS_DEFAULT_REGION`，`gh secret list` 顯示 `SUPABASE_DB_URL`／`AWS_ACCESS_KEY_ID`／`AWS_SECRET_ACCESS_KEY`／**`HEARTBEAT_URL`** 均已設定。
    **實跑證據**：`gh run list --workflow=db-backup.yml` 連續成功；2026-07-28 19:27 UTC 該筆產出 `parking-20260728T192803Z.pgc.age`（254,106 bytes）＋manifest（涵蓋 18 張表）並上傳 `s3://parking-db-backups/parking-db/`。**該筆晚於當日的真名冊匯入 ⇒ 57 位會友資料已在異地加密備份內。**
    還原演練已於 2026-07-20 執行並通過四道關卡（`restore: OK`，見 [current_handoff.md](current_handoff.md)）。
    **原六項留存供日後輪替／重建時參照**：① age 金鑰對（私鑰離線、≥2 人各一份、與備份分開放）② R2/B2 private bucket ③ GitHub Secrets/Variables ④ bucket lifecycle rule ⑤ `HEARTBEAT_URL` ⑥ `BACKUP_ENABLED=true`。
    ⚠️ **這一格的教訓**：勾選框會過期。**涉及外部系統狀態（GitHub Actions／Vercel／cron／Supabase）的項目，回答前用 `gh`／dashboard 實查，不要只信本檔的勾**。
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
- [x] **已完成（2026-07-28）**：正式名冊已匯入 prod，**現況 57 位 ＝ CSV 54 位 ＋ 手動自建 3 位**。2026-07-29 以匯入器自身 pipeline 做過 reconciliation（見 [feature-triage.md](feature-triage.md) #34 專節）。
  - **殘留待辦（名冊面，非阻擋）**：① **⚠️ `reviewRequired` 4 位 ＝ 目前持有「無截止日的 P2」，不只是資料不漂亮**（2026-07-29 外部審查指出、已讀碼確認）：3 位「原因 2 短期不便」與 1 位孕婦因**無申請日期**，`computeEligibility` 回 `valid_until: null, review_date: today, reviewRequired: true`（[memberImport.ts:132-136](../parking-system/lib/memberImport.ts#L132-L136)——刻意不猜日期）；但 `import_member` 仍以 **`review_status = 'approved'`** 寫入（[0038:422-428](../parking-system/supabase/migrations/0038_member_maintenance.sql#L422-L428)），而 `p2_eligible` **只衍生自 `review_status='approved'`、不含任何日期**（#10／`0032`），且 `isWithinEligibilityWindow` 對 `validUntil = null` 視為**無上界**。⇒ **這 4 位在分配上等同永久 P2**，直到有人設定效期為止。`p2_review_date = today` 只讓他們出現在覆核佇列，**不會限制分配**。<br>**⇒ cohort-level gate（非阻擋整個 pilot）**：這 4 位**在納入 pilot cohort／對其開放停車申請之前，必須先完成覆核設定效期，或該批暫不納入**。（本主日的規劃是綁定宣導＋少數已綁定同工試跑，這 4 位不在其中 ⇒ 不影響本週。）**這批綁定宣導時抓不到**——他們會正常綁定、資格靜靜躺著；② **1 位因缺手機被擋下未匯入**（孩童生日已填，補手機即可）；③ 其餘被跳過者的處理方式已定為**宣導綁定時人工處理**——不在名冊者送出綁定申請會以 `unmatched_at_capture` 浮出，但**補建會友後原申請不能直接核准**（`0038` 讀送出當下凍結的 `matched_user_id_at_capture`），需請本人**重新送出**。
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

- [ ] **HARD GATE — 備援 on-call 已就位（`pilot 擴大`前必須先過；首批 supervised pilot 不受此擋）**
  > **這個 gate 不是「有人被指定」。** 名字寫上去零成本、也零效果——§2 的 rollback runbook 假設有人**當下能動手**，而 §0 目前三個角色由同一人兼任。真正要擋的情境是：主日早上出事，唯一懂系統的人在飛機上／住院／手機沒電。
  >
  > ⇒ 通過條件是**至少一位備援已實際具備接手能力**，不是名冊上多一個名字。
  >
  > **但這個 gate 擋的是「擴大」，不是「開始」**（2026-07-29 外部審查修正——原文同時寫「未過不得開始第一批放行」又留「縮小規模是可接受替代」，兩者互相矛盾）。
  > 首批由主要 on-call 全程在場的 supervised pilot **不受此 gate 擋**；它擋的是把 cohort 放大到人工接不住的規模。
  >
  > ```
  > 極小型 supervised pilot → 撐過至少一個主日 → 備援 on-call ready → GATE PASS → 擴大 cohort
  > ```
  >
  > 這與本節原本「先一個小組、撐過至少一個主日再擴大」完全對齊。

  **通過條件（四項全需成立）**：
  1. **已取得 runbook 並讀過**：[dispatcher-ops.md](dispatcher-ops.md)（停排程／transport／requeue）＋本檔 §2 rollback ＋ [prod-deploy-runbook.md](prod-deploy-runbook.md) §1.5/§2.5（Instant Rollback 會關掉 auto-assign、Undo 又會打開）。
  2. **告警處置**：知道 `/outbox-alert` 的 503 會送到哪裡、收到後第一步做什麼；知道備份 heartbeat（dead-man's-switch）沒 ping 代表什麼、去哪看。
  3. **escalation 資訊齊備**：主要 on-call 的聯絡方式、Supabase／Vercel／Cloudflare R2／cron 排程器的登入途徑（**憑證走 secret store，不進 repo**）、以及「打不通時第二順位是誰」。
  4. **實際演練過一次**：由**備援本人**（非主要 on-call 代跑）完成一次 rollback 演練——**停外部 dispatcher 排程 → 確認排程已停、沒有新的 dispatch invocation → 若當下已有 in-flight run，等該輪跑完 → 以 `/admin/ops`（通知系統狀態）確認沒有新的送出批次、queue 狀態合理 → 恢復排程 → 確認正常 drain**。演練日期記入本檔。⚠️ **演練的必須是真正的 production kill switch**（停排程），**不要碰 `NOTIFICATION_TRANSPORT`**——理由見 §2。

  **Verify**：四項逐一確認、記錄演練日期。**未過不得擴大 cohort。**
  **具名資料一律不入本 repo**（同 §0）：此處只記「已就位＋演練日期」，姓名與聯絡方式放教會內部交接文件。

  **gate 未過時允許的範圍（bounded supervised pilot）——三項全需成立**：
  1. **主要 on-call 當日全程在場且可即時處置**；
  2. **cohort 小到系統整個失效一個主日仍可人工接回**（判準：同工能否靠 `/admin/print` 的紙本清單把那個主日撐完——能，就在範圍內）；
  3. 已在 [admin-operations-guide.md](admin-operations-guide.md) 對同工說明「失效時怎麼辦」。

  **⇒ 縮小規模是「合法的起步路徑」，不是「跳過 gate」**；一旦要擴大，四項條件必須先補完。
  💡 **首個 supervised 主日其實是做第 4 項演練最好的時機**——備援在旁跟跑，真出狀況時主要 on-call 就在現場。
- **Who**：church office（發綁定碼）＋ admin（審核綁定）＋ Scheduler operator（看健康度）
- **Verify**：先一個小組走綁定碼流程 → admin 審核寫 `line_id`（尊重 `users_line_id_key` 唯一性、衝突要顯式處理）→ 只對該 cohort 開送出 → **看 `/outbox-alert` 撐過至少一個主日循環再擴大**。每次擴大前：無不明 terminal `failed`、無 stale `processing` lease、DUE backlog 在門檻內、未綁定車主顯示 fallback 文案、log/`last_error` **絕無** `line_id`/車牌/內文。
- **Detail**：[go-live-readiness.md](go-live-readiness.md) §5（pilot rollout）、[binding-ops.md](binding-ops.md)

---

## 2. Rollback（隨時可用，operator runbook）

**1. 先停外部排程器** —— dispatcher 是 pull-driven；停排程會阻止**新的 scheduled invocation／新的送出批次**。⚠️ **已經開始執行的 dispatch run 不會被取消**，可能仍把本輪已 claim 的通知送完（已 claim 的列也持有 lease 直到到期）。⇒ **停用後要確認沒有新的 invocation，才算止血完成**——不要期待「按下停用的那一秒起絕對零送出」。

**2. ⚠️ 不要在 production 改 `NOTIFICATION_TRANSPORT`**（本檔原本寫「壓回 `mock`/`log`」，**已於 2026-07-29 更正**）：
- **根本沒有 `log` mode**。`getLineTransport()` 只認 `mock` 與 `line`，其餘（含未設）一律 `invalid_transport_mode`。
- **`mock` 在 production 會被主動拒絕**（`mock_in_production`，[lineTransport.ts:117-129](../parking-system/server/services/notification/lineTransport.ts#L117-L129)）——那是刻意的設計：production 不得靜默 no-op 真實通知。
- 硬設下去確實會停止送出，但機制是**讓每一次排程 invocation 拋錯**——crash-loop 假扮 kill switch，還會把真正的告警淹掉。**不是 rollback 手段。**

**3. ⚠️ 「拔掉 `LINE_CHANNEL_ACCESS_TOKEN`」不是即時 kill switch，事故當下不要靠它**（2026-07-29 外部審查更正）：程式面確實會以 `missing_line_token` 在 claim 任何一列之前 fail fast（不送出、也不標 `sent`），**但 Vercel 上刪改 Environment Variable 不會影響正在服務的 deployment**——要建立新的 deployment 才生效。事故當下刪掉 token，現行 production deployment 仍握著舊值、仍可能照送。
⇒ **目前唯一即時、已驗證的 production kill switch 就是第 1 步（停外部排程器）。**
📌 **已知缺口**：若未來需要「排程照跑、但即時禁止對外送出」，必須**另做一個 production-safe 的 kill switch**（例如 DB 端旗標，dispatcher 每輪讀取）——目前系統**沒有**這個東西，不要用 env 或 transport mode 假冒。

**4. 根因修好後才** `requeue-failed`（手動限定、絕不 replay 進壞掉的 transport）。

（`LINE_SEND_ENABLED` **未被任何程式碼讀取**，設它不影響行為。）詳見 [go-live-readiness.md](go-live-readiness.md) §6、[dispatcher-ops.md](dispatcher-ops.md)。

---

## 3. 交付後持續 ops（非一次性、非阻擋交付）

- **通知 LIFF deep-link（#26）** — 讓通知一觸就開會員頁動作；#25 已把「回覆」死指令改成導向會員頁，deep-link 是其正解。見 [feature-triage.md](feature-triage.md) #26。
- **監控** `/outbox-alert`（503＝不健康，外部 monitor 收信）、audit purge 每月 run 的 `hasMore` warning。
- **確認自管備份最近一次成功**（§1.1 選 Free 後的持續責任——備份靜默失敗＝回到零備份，比沒設更危險，因為你以為有）。若日後升 Pro，此條移除。
- **非阻擋 dev backlog**（要不要做由你決定，皆可留）：2B-2c P2 佇列列內操作、retire `admin_reserved`、a11y menu 語意。見 [pre-delivery-polish-backlog.md](pre-delivery-polish-backlog.md)「可交付後迭代」。
  - 已完成、不再是 backlog：**Wave 2C #19 admin 角色分級**（PR #45／#46）、**`server-only` 邊界**（Tier 0-1，PR #54）。
