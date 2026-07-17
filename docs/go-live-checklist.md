# Go-Live Checklist（交付走查 — 單一權威清單）

> **交付日照這一份走。** 這是把分散在三處的交付待辦整合成的**唯一**權威 pre-flight：
> [prod-deploy-runbook.md](prod-deploy-runbook.md) §8/§13、[delivery-model-and-roadmap.md](delivery-model-and-roadmap.md) roadmap、[go-live-readiness.md](go-live-readiness.md) §1/§5。
>
> **紀律（同 [pre-delivery-polish-backlog.md](pre-delivery-polish-backlog.md)）**：本檔只記「做什麼／誰做／怎麼驗／出處」。**詳細步驟一律以連結的來源為準、不在此重述**——避免兩份文件分歧。
>
> **開發面已全數完成**（[pre-delivery-polish-backlog.md](pre-delivery-polish-backlog.md)：交付前必修＋強烈建議兩節皆清空；容量／P2 資格不需 SQL／CSV、稽核有邊界可清理）。**本檔只管交付日的 ops**——這些步驟幾乎都需要教會的正式憑證／資料／簽核，不在開發軌上。

---

## 0. 前置 gate — 先指派三個負責人（不指派不啟動）

> 出處：[go-live-readiness.md](go-live-readiness.md) §1。下面每一步的「誰」都指回這三個角色。

- [ ] **OA token owner** — 一位具名的 OA 管理者，保管 channel access token＋channel secret；只透過 secret store 交付給 dev，**絕不進 repo**；定義輪替聯絡人。
- [ ] **Copy approver** — 一位具名簽核者，負責 3 個通知模板（`move_car_request`／`reservation_released`／`reservation_cancelled`）＋移車 A/B/C/D 變體。**未簽核前不得對真實會友送出任何一則。**
- [ ] **Scheduler / rollback on-call operator** — 一位具名 on-call，能 (a) 停用外部排程器、(b) 把 transport 壓回 `mock`/`log`、(c) 跑 `requeue-failed`。runbook：[dispatcher-ops.md](dispatcher-ops.md)。

---

## 1. 交付日順序（按序執行，每步驗過才進下一步）

> 出處：[delivery-model-and-roadmap.md](delivery-model-and-roadmap.md) roadmap §5「post-delivery ops」。順序有意義：真 PII 落地前先升 Pro；真送出前先簽文案。

### 1.1 Supabase Free → Pro（真 PII 落地前）
- **Who**：dev（billing 需教會/擁有者帳號）
- **Verify**：專案未被 inactivity 暫停；daily backup / PITR 在 dashboard 顯示啟用；`SUPABASE_URL`/`SERVICE_ROLE_KEY` 不變故 Vercel env 不需改。**升級後把日期＋執行者記進 [current_handoff.md](current_handoff.md)。**
- **Detail**：[prod-deploy-runbook.md](prod-deploy-runbook.md) §8（就地升級、同 project ref、勿建新專案；先確認 demo/PII 已依 §12.3 清乾淨）

### 1.2 教會正式 OA 接線
- **Who**：OA token owner（提供憑證）＋ dev（換 env、repoint URL）
- **Verify**：換 `LINE_CHANNEL_ACCESS_TOKEN`＋`LINE_CHANNEL_SECRET`（Messaging）、`LINE_LOGIN_CHANNEL_ID`＋`NEXT_PUBLIC_LIFF_ID`（LIFF）；LIFF endpoint＋Messaging webhook URL 指到同一 Vercel domain；`NEXT_PUBLIC_LIFF_ID` 是 build-time ⇒ **觸發一次新 build**；LINE Login channel 設 **Published**；跑一次 webhook Verify＋真機 bind/notify 冒煙。**移除舊 dev OA token**（改 `NOTIFICATION_TRANSPORT` **不會**讓舊 token 失效）。
- **Detail**：[prod-deploy-runbook.md](prod-deploy-runbook.md) §13、§11（token 失效語意）、[member-liff-setup.md](member-liff-setup.md)

### 1.3 匯入真會友 CSV（P2 申請資料）
- **Who**：church office（提供 CSV）＋ admin（走 Admin 匯入 UI）
- **Verify**：透過 `/admin`（會友匯入）跑 preview → 檢查衝突/資格 → apply；spot-check 資格正確；`line_id` 匯入時維持 NULL（綁定另外接）。若輪替過 service-role key，**避開 30 分鐘匯入窗**（它同時簽 import HMAC）。
- **Detail**：[member-import-ops.md](member-import-ops.md)、[delivery-model-and-roadmap.md](delivery-model-and-roadmap.md)（CSV→schema 對照）

### 1.4 文案 sign-off（真送出前的硬 gate）
- **Who**：Copy approver
- **Verify**：3 個通知模板＋移車 A/B/C/D 變體全部簽核。**未簽核前 1.6 不得開。**
- **Detail**：[oa-onboarding-and-move-car-copy.md](oa-onboarding-and-move-car-copy.md)、[go-live-readiness.md](go-live-readiness.md) §1

### 1.5 排程上線 — dispatcher（11）＋ audit purge cron（第 12，本輪新增）
- **Who**：Scheduler operator
- **Verify**：11 個既有 cron 指到 Vercel domain 且 `JOB_TRIGGER_SECRET` 相符（[prod-deploy-runbook.md](prod-deploy-runbook.md) §6.5）。**新增第 12 個：`GET /api/internal/jobs/purge-audit-logs`，每月一次**（cron-job.org Asia/Taipei 整點慣例，或 Vercel Pro `0 4 1 * *`）。
  - ⚠️ **這是 1.4 之外的第二個硬 gate**：`/admin/audit` 現在對幹事宣稱「紀錄保留 24 個月，逾期後由定期維運作業清除」——**這句只有在這個 cron 真的在跑時才誠實**。上線前先用 `?dryRun=1` 打一次，必須回 `retentionMonths: 24` 且 `deletedBefore` ≈ 24 個月前，才可信任該文案。
- **Detail**：[prod-deploy-runbook.md](prod-deploy-runbook.md) §13（audit purge cron 條目）、§6.5、[dispatcher-ops.md](dispatcher-ops.md)

### 1.6 開啟真實送出（`NOTIFICATION_TRANSPORT=line`）
- **Who**：Scheduler operator（1.4 簽核後）
- **Verify**：fail-fast 契約仍在（無 token 時 `transport=line` 會在 claim 前中止、絕不把列標 `sent`）；先對一位知情 operator 帳號送單一測試通知（`LINE_SEND_ENABLED` 一次性翻 true 再翻回），確認到達再繼續。
- **Detail**：[go-live-readiness.md](go-live-readiness.md) §2（config lock）、[dispatcher-ops.md](dispatcher-ops.md)

### 1.7 Pilot 分批放行（onboard + bind，逐步）
- **Who**：church office（發綁定碼）＋ admin（審核綁定）＋ Scheduler operator（看健康度）
- **Verify**：先一個小組走綁定碼流程 → admin 審核寫 `line_id`（尊重 `users_line_id_key` 唯一性、衝突要顯式處理）→ 只對該 cohort 開送出 → **看 `/outbox-alert` 撐過至少一個主日循環再擴大**。每次擴大前：無不明 terminal `failed`、無 stale `processing` lease、DUE backlog 在門檻內、未綁定車主顯示 fallback 文案、log/`last_error` **絕無** `line_id`/車牌/內文。
- **Detail**：[go-live-readiness.md](go-live-readiness.md) §5（pilot rollout）、[binding-ops.md](binding-ops.md)

---

## 2. Rollback（隨時可用，operator runbook）

先停外部排程器（dispatcher 是 pull-driven，無排程＝無送出）→ transport 壓回 `mock`/`log`（＋`LINE_SEND_ENABLED=false`）→ **根因修好後才** `requeue-failed`（手動限定、絕不 replay 進壞掉的 transport）。詳見 [go-live-readiness.md](go-live-readiness.md) §6、[dispatcher-ops.md](dispatcher-ops.md)。

---

## 3. 交付後持續 ops（非一次性、非阻擋交付）

- **通知 LIFF deep-link（#26）** — 讓通知一觸就開會員頁動作；#25 已把「回覆」死指令改成導向會員頁，deep-link 是其正解。見 [feature-triage.md](feature-triage.md) #26。
- **監控** `/outbox-alert`（503＝不健康，外部 monitor 收信）、audit purge 每月 run 的 `hasMore` warning。
- **非阻擋 dev backlog**（要不要做由你決定，皆可留）：2B-2c P2 佇列列內操作、Wave 2C #19 admin 角色分級、retire `admin_reserved`、`server-only` 套件、a11y menu 語意。見 [pre-delivery-polish-backlog.md](pre-delivery-polish-backlog.md)「可交付後迭代」。
