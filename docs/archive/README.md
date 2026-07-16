# docs/archive — 已完成、不再執行的文件

此資料夾收放**已經跑完、不會再執行**的一次性 runbook / 素材，僅作歷史紀錄。
現役（ongoing）operator 文件與交付後 ops 文件仍留在 `docs/` 上層。

> ⚠️ 「歸檔」＝已完成、可安全略過；不代表刪除。若日後有相同需求，先確認情境是否已被
> 現役文件（Admin UI / 交付後 ops runbook）取代，通常不需回頭執行這裡的文件。

## 內容

| 文件 | 原用途 | 完成 / 歸檔 | 現況 |
|---|---|---|---|
| [binding-pilot-runbook.md](binding-pilot-runbook.md) | 在**開發者自有測試 OA**端到端跑 5A 擷取 + 5B binding CLI（`issue→送碼→capture→核准→reject`） | pilot 完成 2026-07-05；歸檔 2026-07-16 | 5B 綁定審核已包進 Admin UI（`/admin/bindings`，handoff §6.27/§6.29）；不需再跑 |

## 沒有歸檔、仍在用的相關文件（留在 `docs/`）

- `oa-dry-run-request.md` / `oa-dry-run-operator-setup.md` / `oa-dry-run-tunnel-runbook.md`
  — 教會**正式** OA 的 capture dry-run，屬**交付後 ops**，尚未執行。
- `oa-onboarding-and-move-car-copy.md` — 對外文案，仍待 sign-off。
- `binding-ops.md` / `dispatcher-ops.md` / `member-import-ops.md` / `admin-account-ops.md`
  / `member-liff-setup.md` / `prod-deploy-runbook.md` — 現役 operator / 部署 runbook。
