# Member import operator runbook（會友資料匯入）

> 把教會 **P2 申請表 CSV** 匯入為會友資料（`users` + `vehicles` + `user_eligibility` + `eligibility_dependents`）。
> Phase 6 CLI（Admin UI 之後包裝）。**只匯入資料紀錄，`line_id` 不動**（綁定另外走 Phase 5A/5B）。
> 背景與 CSV→schema 對照見 [delivery-model-and-roadmap.md](delivery-model-and-roadmap.md)；欄位定義見
> [parking-application-form-fields.csv](parking-application-form-fields.csv)。
>
> ⚠️ **CSV 是真實會友個資（PII）。** 放在 repo 外的 `parking-system/members-data/`（已 `.gitignore`），
> **不要 commit**、**不要**把報表（可能含姓名/車牌）貼到共用日誌。合成範例在 `tests/fixtures/`（可 commit）。

---

## 指令

```bash
cd parking-system
# 乾跑（預設）：印驗證 + 投影報表，不寫入
npm run members:import -- --file ./members-data/applications.csv
# 確認報表無誤後，實際寫入
npm run members:import -- --file ./members-data/applications.csv --apply
```

- **預設 dry-run**；`--apply` 才寫。
- 有衝突或驗證錯誤時 exit code = 2（報表照印），方便腳本捕捉。

## CSV 規則

- 表頭用欄位英文 `field_name`（見欄位定義檔）。UTF-8。
- **會友識別鍵 = `mobile_phone`**（去除非數字）。**同一支手機的多列 = 同一位會友、多台車**（`license_plate` 逐列）。
- `reason_type`：1→`mobility_long`、2→`mobility_short`、4→`elderly_companion`、3→`child_companion`（或 `remarks` 註明懷孕且無孩童 → `pregnancy`）。
- **效期（`p2_valid_until`）**：長期行動不便 / 長者 → 永久（null）；短期行動不便 / 懷孕 → **申請日 + 6 個月**；孩童 → **最晚孩童生日 + 5 年**；**缺日期 → review_required**（`valid_until` 留 null、`review_date` 設為匯入日，報表列出）。

## 報表欄位

`rows`/`members`/`imported`/`updated`/`vehiclesAdded`/`dependentsAdded` 為計數；另有需要人工處理的清單：

| 清單 | 意義 / 處置 |
|---|---|
| `validationErrors` | 逐列缺必填 / 格式錯（如 `reason_type`、生日）→ 修 CSV 重跑；該列不匯入 |
| `phoneNameConflicts` | 同手機出現**不同姓名**（CSV 內或與既有資料）→ 該手機不匯入，人工釐清是否同人 |
| `plateConflicts` | 車牌已屬**其他會友** → 該車牌略過（會友本身仍建立），人工釐清是否重複/錯號 |
| `reviewRequired` | 暫時性資格缺日期無法算效期 → 已建立但標記待審，之後於 Admin UI 補 |

## 特性

- **冪等**：以手機 upsert 會友、車牌去重、`(kind+姓名+生日)` 去重 dependents、`user_eligibility` 依 user upsert。重跑不會重複。
- **原子**：每位會友一次 `import_member` RPC（單交易），typed 結果，不 throw。
- **dry-run 限制**：同一批次內「後面的車牌撞到前面剛建立的會友」只有 `--apply` 時才偵測得到（dry-run 不寫入，看不到批內剛建的車）。

## 之後

- 匯入建立的是**資料紀錄**；會友要收得到通知，還需**綁定 `line_id`**（見 [binding-ops.md](binding-ops.md)）。
- P3/一般會友不走此表，改由 member UI 自助建立（Phase 7）。
- 教會若另提供一般會友 CSV，可再加一條匯入路徑。
