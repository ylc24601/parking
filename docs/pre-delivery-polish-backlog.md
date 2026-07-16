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
- [ ] #23 點名備援清單搬 admin
  - Gate：新增 `/admin/print`（gate `getAdminSession`）；`/staff/print` 移除且測試確認 staff PIN 不再能取列印資料
  - Source：feature-triage.md #23
- [ ] #24 staff footer 精簡
  - Gate：footer 只留「＋登記現場車輛」；結束鍵移 header 選單、保留二次確認
  - Source：feature-triage.md #24
- [ ] #27 通知內容 enrich
  - Gate：日期＋車牌＋粗體期限＋換行；producer 補 plate/date 到 payload
  - Source：feature-triage.md #27
- [ ] #30 取消加「不計違規」reassurance
  - Gate：「10:30 前取消不計違規」文案
  - Source：feature-triage.md #30

---

## 強烈建議交付前（因目前仍需 CSV/SQL，不符「幹事自行操作」）

> 三者**只需 #15 Audit、不需 #19 角色**，可先於角色交付。

- [ ] #5A 名冊瀏覽（最小欄位、server 分頁）
  - Gate：server pagination；不匯出/不 bulk/不預載敏感事由；點入才讀完整
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
- [ ] #12 資料最小化橫幅
  - Gate：明示「不索取/不顯示診斷證明」
  - Source：feature-triage.md #12

---

## 可交付後迭代（依賴分組，較易讀）

- **通知便利性**：#7 → #6 → #26 → #3 → #4
  - #26 LIFF deep-link 按鈕＝#25 的正解（讓通知一觸開會員頁動作）
- **管理與治理**：#8、#9、#14B、#17、#18、**#19（角色地基，Wave 2C）**、#5B
- **會員與分析**：#11、#16、#28

---

## DEFERRED — PIN 自動派送（#3 群發 / #4 個別私訊）

**明確延後，交付前不做。** 理由：

- **cron retry 反覆旋轉 PIN ＝最大風險**：明碼不落地（scrypt 單向），push 失敗**無法重送同一組碼**，只能撤舊碼產新碼——若讓 cron 自動 retry，會反覆旋轉 PIN、把已發給同工的碼作廢。
- 需獨立安全 design review（service 邊界、groupId allowlist/不 auto-trust webhook、每次旋轉寫 audit）。#4 另需同工完成 OA 綁定＋輪值表 model。
- **人工重發 PIN 已能運作**（`/admin/staff-pin` 重發＝新碼、舊碼立即失效，手動轉交當週同工）——交付風險反而遠低於仍碰 SQL 的 #10/#14A。

詳見 [feature-triage.md](feature-triage.md) #3/#4 與「建議動工順序」（#3 排 Wave 4 最後、語意最敏感）。
