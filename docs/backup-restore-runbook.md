# Backup & Restore Runbook（教會 DB 加密備份）

> **這是什麼**：在 Supabase **Free tier**（無代管備份）期間的過渡備份方案。決策脈絡見
> [go-live-checklist.md](go-live-checklist.md) §1.1。升 Pro 後即可退休（見 §9）。
>
> **原理**：排程 GitHub Action 每天跑
> `pg_dump（public+private，schema+data）→ age 加密 → 上傳物件儲存`。
> **加密在離開 runner 之前發生**，儲存端永遠只有密文；能還原的私鑰由**教會離線保管**。
>
> **設計原則：寧可吵，不可假成功。** 備份系統最糟的失敗不是「壞掉」，而是**壞掉卻回報成功**——
> 那會製造出「我們有備份」的錯覺，直到真的要用時才發現沒有。所以每一條失敗路徑都必須非零退出，
> 還原更是四道關卡全過才算成功。

程式：[db-backup.sh](../scripts/backup/db-backup.sh)、[db-restore.sh](../scripts/backup/db-restore.sh)、[test-backup-scripts.sh](../scripts/backup/test-backup-scripts.sh)、[db-backup.yml](../.github/workflows/db-backup.yml)、[backup-ci.yml](../.github/workflows/backup-ci.yml)。

---

## 0. 每次備份產出兩個檔（成對，不可分開）

| 檔案 | 內容 |
|---|---|
| `parking-<時間戳>.pgc.age` | dump 本體（pg_dump custom format，age 加密） |
| `parking-<時間戳>.manifest.age` | **manifest**：`public`+`private` **每一張** base table 的列數、dump 的 SHA-256、備份時間、PG 版本（同樣 age 加密） |

**manifest 是「還原成功」有意義的關鍵。** 沒有它，還原只能印出一堆數字讓人自己看——但**部分還原、
被截斷的 dump、整張表消失，在一串數字裡都長得很正常**。有了 manifest，還原會**逐表比對**，
對不上就失敗。表清單是**從 catalog 動態列舉**的，不是手寫清單，所以「某張沒列到的表不見了」也抓得到。

> **誠實的邊界**：manifest 的列數在 dump 開始前一刻取得，與 dump 的 snapshot 差幾毫秒。若正好有並發寫入
> （例如 cron 寫 `audit_logs`），還原時會出現小幅落差並**失敗要你調查**——它 fail safe（吵），不會假裝沒事。

---

## 1. 一次性設定

### 1.1 產生 age 金鑰對（**私鑰是命根子**）
在**一台你信任的機器**上（不是 CI）：
```bash
age-keygen -o age-identity.txt      # 輸出會印 "Public key: age1....."
```
- **私鑰 `age-identity.txt`**：離線保管、**絕不進 git**、**絕不跟備份放同一處**。
  **弄丟＝所有備份變廢檔** ⇒ 建議至少**兩位負責人各存一份**（密碼管理器或印出鎖起來）。
- **公鑰 `age1...`**：不敏感，填進 GitHub Variable。

### 1.2 建立物件儲存（推薦 Cloudflare R2，Backblaze B2 亦可）
資料極小（單次約 0.2 MB × 2 檔），穩在免費額度內。建 **private** bucket，發 API token。
R2 endpoint 形如 `https://<accountid>.r2.cloudflarestorage.com`、region `auto`。

### 1.3 GitHub Secrets 與 Variables
Repo → Settings → Secrets and variables → Actions。

**Secrets**：`SUPABASE_DB_URL`（見 §1.6 ⚠️）、`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、
`HEARTBEAT_URL`（選填但**強烈建議**，見 §3）。

**Variables**：`AGE_RECIPIENT`（公鑰）、`S3_BUCKET`、`S3_ENDPOINT`、`S3_PREFIX`（選填，預設 `parking-db`）、
`AWS_DEFAULT_REGION`（R2＝`auto`）、**`BACKUP_ENABLED`（見 §1.5）**。

### 1.4 保留策略＝bucket lifecycle rule
在 bucket 設「刪除超過 N 天物件」（例如 90 天）。這比腳本刪可靠（server 端、不依賴 job 成功）。
（`LOCAL_DEST` 模式無 lifecycle，改由腳本 `RETENTION_DAYS` 就地清，見 §7。）

### 1.5 ⚠️ 最後才 arm：`BACKUP_ENABLED=true`
workflow **在 `BACKUP_ENABLED` 設成 `true` 之前什麼都不做**（乾淨跳過並留 notice）。所以
**merge 不會在你還沒建好金鑰/bucket 前每天噴失敗信**。

**一旦 arm，缺任何設定就是硬失敗（不再靜默跳過）**——因為「備份無聲停止」正是我們要防的失敗模式，
「未設定」只有在**第一次 arm 之前**才允許安靜。

**順序**：§1.1→§1.4 全部完成 → 設 `BACKUP_ENABLED=true` → §1.6 手動跑一次 → §5 還原演練。

### 1.6 首次執行
Actions → **Encrypted DB backup** → **Run workflow**。綠燈後確認 bucket 出現**兩個**檔。

> ⚠️ **`SUPABASE_DB_URL` 必須用 session-mode pooler**（port 5432、`aws-*.pooler.supabase.com`）：
> GitHub runner 只有 IPv4，而 Supabase 的 direct connection 是 IPv6-only。用 direct 會連不上。
> 另外 workflow 內釘 `postgresql-client-17` 對齊 server——**舊版 client 會拒絕 dump 新版 server**。

---

## 2. 每天做什麼
02:00（台北）跑一次：讀每張表列數 → dump 並在 stream 中加密 → 寫 manifest（含 dump 雜湊）→ 兩個檔一起上傳 →
成功才 ping heartbeat。腳本會**拒絕上傳空的或未加密的檔案**，且任何一步失敗都非零退出。

---

## 3. 監控 —— **要對「沒發生」告警，不只是對「失敗」告警**

**GitHub 寄信只涵蓋「有跑但失敗」。真正危險的是「根本沒跑」，它不產生任何錯誤，只有沉默——
而沉默跟成功長得一模一樣。** 這個 repo 是**公開**的，而 **GitHub 對公開 repo 會在無活動 60 天後
自動停用排程 workflow**；教會交付後 repo 必然安靜下來，所以這**不是理論風險，是預定會發生的事**。

⇒ **請設 `HEARTBEAT_URL`**（[healthchecks.io](https://healthchecks.io) 之類的 dead-man's switch 免費方案即可）：
備份成功才 ping，**超時沒收到 ping 就寄信給你**。這是唯一能抓到「排程停了」的機制。

另外每月看一眼：bucket 裡**最新物件的日期**是不是還在長。

---

## 4. 還原（disaster recovery）

**模型**：新開 Supabase 專案（空的 `public` schema）→ 把最近一份備份還原進去。schema／grants／函式／
trigger 都在備份裡，會一起回來。

```bash
# 需要 age-identity.txt（私鑰）。dump 與 manifest 兩個檔都要下載。
aws s3 cp s3://<bucket>/parking-db/parking-<戳>.pgc.age      . --endpoint-url <endpoint>
aws s3 cp s3://<bucket>/parking-db/parking-<戳>.manifest.age . --endpoint-url <endpoint>

AGE_IDENTITY=./age-identity.txt \
  scripts/backup/db-restore.sh parking-<戳>.pgc.age '<TARGET_DB_URL>'
```

**四道關卡全過才回報成功**，任一失敗即非零退出：
1. **artifact 與 manifest 的 SHA-256 相符**（拿錯檔、配錯對、檔案損壞 → 擋下）
2. **pg_restore 沒有 allowlist 以外的錯誤**。只容許兩種 Supabase 代管訊息：
   `schema "public" already exists`、`permission denied to change default privileges`。
   **其餘一律失敗**（dump 損壞、function/trigger/grant 還原失敗、`--disable-triggers` 權限問題…）。
   另外會核對 pg_restore 自己回報的 "errors ignored" 數量，避免沒被解析到的錯誤蒙混過關。
3. **每張表列數與 manifest 完全一致**，且**沒有表消失**
4. **`verify_schema_prod.sql` 通過**（32 條）——抓「資料在、但安全結構沒回來」的情況，這是列數看不到的

**失敗時診斷資料會留下來**：任一關卡失敗，腳本會在**當前目錄**留下 `restore-failed.log`
（pg_restore 完整輸出）與 `restore-failed-verify.log`（結構驗證輸出）再清掉暫存目錄。
**還原失敗卻把自己的證據刪掉，等於只做了一半的護欄**——而它銷毀證據的時機，正好是災難當下最需要它的時候。

- `<TARGET_DB_URL>` **沒有預設、不猜 prod**，必須自己打 ⇒ 不會因為省略而覆蓋錯的庫。
- **`--clean` 預設關閉**。它會**先 DROP 再建**，是破壞性的；只在對可丟棄的 scratch DB 重跑演練時才加。
- 終端**只會印 host/database，不印帳密**。
- 還原後：把 Vercel 的 `SUPABASE_URL`／`SERVICE_ROLE_KEY` 指到新專案。

---

## 5. 每月還原演練（紀律，不是選配）
**未驗過還原的備份等於沒有備份。**
```bash
psql '<admin_url>' -c 'create database restore_drill;'
AGE_IDENTITY=./age-identity.txt \
  scripts/backup/db-restore.sh <最近一份>.pgc.age '<admin_url，dbname=restore_drill>'
# 看到 "restore: OK" 才算過 → drop database restore_drill;
```
演練同時驗證：私鑰還在且正確、備份可解密、資料真的長得回來、結構完整。

---

## 6. CI 涵蓋什麼、不涵蓋什麼

[backup-ci.yml](../.github/workflows/backup-ci.yml)：shellcheck、workflow YAML lint、以及用假的
`pg_dump`/`age`/`psql`/`aws` 跑的**失敗路徑測試**（dump 失敗／空檔／未加密／上傳失敗／缺設定／還原前置條件／
不得印出密碼）。**它抓到過兩個真 bug**：空陣列展開在 bash 3.2 的 `set -u` 下致命，以及
**cleanup trap 的退出碼蓋掉致命錯誤、讓腳本回報成功**。

**不涵蓋**（刻意，講明以免誤以為有）：對真資料庫的完整資料往返。那需要真 Postgres＋真 schema，
由 §5 每月演練負責。**CI 證明護欄會擋，演練證明資料回得來。**

---

## 7. 替代目的地：NAS／加密硬碟
若治理要求 PII 不進第三方雲，設 `LOCAL_DEST` 取代 `S3_BUCKET`：
```bash
SUPABASE_DB_URL='...pooler...' AGE_RECIPIENT='age1...' \
  LOCAL_DEST=/mnt/nas/parking-backups RETENTION_DAYS=90 \
  scripts/backup/db-backup.sh
```
- 本機模式由腳本就地清除超過 `RETENTION_DAYS` 的舊檔。
- **但要有東西跑它**：GitHub 代管 runner 碰不到你的 NAS ⇒ 需 self-hosted runner 或本機 cron。
- 檔案仍是 age 加密 ⇒ NAS 被勒索軟體加密或被偷，內容仍是密文。
- NAS 是本機單點。理想＝**自動雲端（主力）＋偶爾手動拉一份到加密硬碟離線冷備**（近乎 3-2-1）。

---

## 8. 安全備註
- **私鑰是唯一的高價值秘密**：跟備份分開存、≥2 人各一份、弄丟＝備份全廢。
- `SUPABASE_DB_URL`／R2 keys 只放 GitHub Secrets，**絕不進 repo**。**本 repo 是公開的**，
  Actions log 全世界可讀 ⇒ 腳本一律不印連線字串（CI 有一條 guard 擋住任何人把它加回來）。
- 加密後的 dump **絕不進 git、絕不進公開 bucket**。
- 這套**新增了一個「密文 PII 躺在 bucket」的面**——這是選 Free 相對於一鍵升 Pro 多出來的責任；
  用 age 金鑰把風險壓到「沒私鑰就只是密文」。

---

## 9. 何時退休
升 Supabase Pro 後（dashboard 一鍵、就地升級、資料不動）即有每日代管備份＋7 天保留，
可停用此 workflow（把 `BACKUP_ENABLED` 設回非 `true`）或降頻當第二層。見
[prod-deploy-runbook.md](prod-deploy-runbook.md) §8。**這套能穩定跑本身，就是「便宜也能穩」的證據，
拿去說服決策者編 Pro 預算。**
