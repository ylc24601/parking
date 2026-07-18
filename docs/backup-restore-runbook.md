# Backup & Restore Runbook（教會 DB 加密備份）

> **這是什麼**：在 Supabase **Free tier**（無代管備份）期間的過渡備份方案。決策脈絡見
> [go-live-checklist.md](go-live-checklist.md) §1.1（「先不升 Pro、走 Free ＋自管加密備份」）。
> 升 Pro 後（有每日備份）即可**退休**這套（見文末）。
>
> **原理一句話**：排程的 GitHub Action 每天跑
> `pg_dump（public+private，schema+data）→ age 加密（教會的公鑰）→ 上傳物件儲存`。
> **加密發生在離開 runner 之前**，所以儲存端（bucket／NAS／硬碟）永遠只看得到密文。
> 能還原的私鑰由**教會離線保管**。已本機實跑驗證：dump→加密→解密→還原後**逐表列數一致**、
> 且連安全結構（`audit_logs` append-only、`service_role` 被 revoke、purge 逃生口）都完整還原。

程式：[scripts/backup/db-backup.sh](../scripts/backup/db-backup.sh)、[scripts/backup/db-restore.sh](../scripts/backup/db-restore.sh)、[.github/workflows/db-backup.yml](../.github/workflows/db-backup.yml)。

---

## 1. 一次性設定

### 1.1 產生 age 金鑰對（**私鑰是這整套的命根子**）

在**一台你信任的機器**上（不是 CI）：
```bash
age-keygen -o age-identity.txt
# 輸出會印出 "Public key: age1....." —— 那是 recipient（公鑰）
```
- **`age-identity.txt`（私鑰）**：**離線保管、絕不進 git、絕不上傳到放備份的同一個地方**。
  它是唯一能把密文變回 PII 的東西。建議：存進密碼管理器，或印出來鎖起來，交給一位負責人。
  **弄丟私鑰 = 所有備份變廢檔。** 建議至少兩位負責人各存一份。
- **公鑰（`age1...`）**：不敏感，等一下填進 GitHub Variable。

### 1.2 建立物件儲存（推薦 Cloudflare R2；Backblaze B2 亦可）

任一 S3 相容儲存都行，資料極小（單檔約 0.2 MB、每天一份）穩在免費額度內：
- **Cloudflare R2**：建一個 private bucket，發一組 API token（Access Key ID／Secret）。endpoint 形如
  `https://<accountid>.r2.cloudflarestorage.com`，region 用 `auto`。
- **Backblaze B2**：建 private bucket，發 application key。endpoint 形如
  `https://s3.<region>.backblazeb2.com`，region 填該區。
- **bucket 保持 private**（非公開）。裡面是密文，但沒有理由讓它可公開列出。

### 1.3 設定 GitHub Secrets 與 Variables

Repo → Settings → Secrets and variables → Actions。

**Secrets（機密）**：
| 名稱 | 值 |
|---|---|
| `SUPABASE_DB_URL` | **session-mode pooler** 連線字串（見 §5 的 ⚠️） |
| `AWS_ACCESS_KEY_ID` | R2/B2 的 Access Key ID |
| `AWS_SECRET_ACCESS_KEY` | R2/B2 的 Secret |

**Variables（非機密）**：
| 名稱 | 值 |
|---|---|
| `AGE_RECIPIENT` | §1.1 的公鑰 `age1...` |
| `S3_BUCKET` | bucket 名稱 |
| `S3_ENDPOINT` | §1.2 的 endpoint URL |
| `S3_PREFIX` | 選填，預設 `parking-db` |
| `AWS_DEFAULT_REGION` | R2＝`auto`；B2/S3＝該區 |

### 1.4 保留策略（retention）＝ bucket lifecycle rule

**在 bucket 上設一條 lifecycle rule：刪除超過 N 天的物件**（例如 90 天）。這比在腳本裡刪更可靠
（server 端、不依賴 job 成功）。R2／B2 dashboard 都有此設定。
（本地 NAS／硬碟目的地沒有 lifecycle，改由腳本的 `RETENTION_DAYS` 就地清，見 §7。）

### 1.5 首次執行 ＋ 驗證

- Actions 分頁 → **Encrypted DB backup** → **Run workflow**（`workflow_dispatch`）。
- 綠燈後，到 bucket 確認出現 `parking-db/parking-<時間戳>.pgc.age`。
- **接著務必做一次 §4 的還原演練**——沒驗過還原的備份不算備份。

---

## 2. 它每天做什麼

`.github/workflows/db-backup.yml` 每天 02:00（台北）跑一次，裝好 `pg_dump 17`（對齊 Supabase）／`age`／`awscli`，
然後 [db-backup.sh](../scripts/backup/db-backup.sh)：一條 pipe 把 `pg_dump` 直接餵給 `age`（**明文 PII 從不落地**），
產出 `parking-<UTC時間戳>.pgc.age`，上傳 bucket。腳本會**拒絕上傳非 age 加密或空的檔案**。

**dump 範圍＝`public`＋`private` 兩個 schema 的 schema＋data**：整個 app 的世界（每張表的資料＋安全結構）。
Supabase 代管的 schema（auth／storage…）不備份——它們由新專案自帶。

---

## 3. 失敗會不會被發現

排程 workflow 失敗時，**GitHub 預設會寄信給 repo owner**；workflow 末尾另有一個 `::error::` 標記。
go-live-checklist §3 也列了「確認最近一次備份成功」為持續責任。**備份靜默失敗＝回到零備份，比沒設更危險**
（你以為有）。若要更主動，可在最後一步加一個 Slack/webhook ping。

---

## 4. 還原（disaster recovery）

**模型**：新開一個 Supabase 專案（空的 `public` schema）→ 把最近一份備份還原進去。schema／grants／函式／
trigger 全在備份裡，會一起回來（已驗證）。

```bash
# 在信任的機器上，手邊要有 age-identity.txt（私鑰）
aws s3 cp s3://<bucket>/parking-db/parking-<時間戳>.pgc.age . --endpoint-url <endpoint>   # 或從 NAS/硬碟取檔
AGE_IDENTITY=./age-identity.txt \
  scripts/backup/db-restore.sh parking-<時間戳>.pgc.age '<TARGET_DB_URL>'
```

- `<TARGET_DB_URL>`＝要還原進去的資料庫（新專案的連線字串）。**腳本沒有預設、不猜 prod**——你得自己打，
  所以絕不會因為省略而覆蓋錯的庫。
- **⚠️ pg_restore 對 Supabase 目標會回非零 exit code**，因為有幾行 **benign** 的 Supabase 代管訊息
  （`schema "public" already exists`、`permission denied ... role supabase_admin`、`--clean` 在空庫上的
  `does not exist`）。**成功與否看腳本印出的逐表列數，不看 exit code。** 這點腳本會提醒。
- 還原後：把 app（Vercel）的 `SUPABASE_URL`／`SERVICE_ROLE_KEY` 指到新專案；跑一次
  `verify_schema_prod.sql`（catalog-only、安全）確認結構完整。

---

## 5. 每月還原演練（紀律，不是選配）

**未驗過還原的備份等於沒有備份。** 每月一次：
```bash
# 對一個丟棄用的 scratch DB 演練，不碰任何真庫
psql '<admin_url>' -c 'create database restore_drill;'
AGE_IDENTITY=./age-identity.txt \
  scripts/backup/db-restore.sh <最近一份>.pgc.age '<admin_url 但 dbname=restore_drill>'
# 看列數合理 → drop database restore_drill;
```
演練同時驗證兩件事：備份檔可解密（私鑰還在、還對）、且真的能長回一個庫。

---

## 6. 監控

- 每天：workflow 綠燈（失敗會寄信）。
- 每月：§5 演練通過。
- bucket：偶爾看一眼有沒有持續長出新檔（lifecycle 有沒有誤刪太多）。

---

## 7. 替代目的地：NAS／加密硬碟（不走雲端）

若教會治理要求「PII 不進更多第三方雲」，同一支腳本可改寫本機路徑——**設 `LOCAL_DEST` 取代 `S3_BUCKET`**：
```bash
SUPABASE_DB_URL='...session-pooler...' AGE_RECIPIENT='age1...' \
  LOCAL_DEST=/mnt/nas/parking-backups RETENTION_DAYS=90 \
  scripts/backup/db-backup.sh
```
- `LOCAL_DEST` 模式下，腳本會**就地清除**超過 `RETENTION_DAYS` 天的舊檔（本機無 lifecycle rule）。
- 但**排程要有東西跑它**：GitHub 代管 runner 碰不到你的 NAS，故本機目的地需要
  **self-hosted runner** 或 NAS／某台常開機器上的 **cron**。
- 檔案仍是 age 加密 ⇒ 即使 NAS 被勒索軟體加密／被偷，內容仍是密文。
- **提醒**：NAS 是本機單點。理想是「自動雲端（主力）＋偶爾手動拉一份到加密硬碟離線冷備」＝近乎 3-2-1。

---

## 8. 安全備註

- **私鑰（age identity）是唯一的高價值秘密**：跟備份**分開**存，至少兩人各一份，弄丟＝備份全廢。
- **`SUPABASE_DB_URL`／R2 keys** 只放 GitHub Secrets，**絕不進 repo**。
- 加密後的 dump **絕不進 git、絕不進公開 bucket**。
- 這套**新增了一個「PII（密文）躺在 bucket」的面**——這正是它比「一鍵升 Pro」多出來的責任；
  用 age 金鑰把風險壓到「沒私鑰就只是密文」。

---

## 9. 何時退休這套

**升上 Supabase Pro 後**（dashboard 一鍵、就地升級、資料不動）即有每日代管備份＋7 天保留，
屆時可停用此 workflow（或降頻當第二層）。見 [prod-deploy-runbook.md](prod-deploy-runbook.md) §8。
本套件的存在本身就是「便宜也能穩穩跑」的證據，用來說服決策者編列 Pro 預算。
