# OA Token Owner 操作手冊（給教會 OA 管理者）

> **這份文件給誰**：[go-live-checklist.md](go-live-checklist.md) 第 0 節指定的 **OA token owner**（一位具名的教會 LINE OA 管理者）。目的是手把手帶你完成「取得金鑰 → 安全交給開發者 → 驗證上線」的全流程。
>
> **來源**：本檔整合自 [go-live-readiness.md](go-live-readiness.md) §1（決策脈絡）、[prod-deploy-runbook.md](prod-deploy-runbook.md) §6.1/§6.2/§13（實際操作步驟）、[oa-dry-run-operator-setup.md](oa-dry-run-operator-setup.md)（console 操作示範）。若本檔與來源衝突，以來源為準。

---

## 0. 你要管的是什麼、為什麼要小心

你要保管的是兩把「數位鑰匙」，任何拿到它們的人都可以**冒充教會 OA 帳號**對外發送訊息、或讀取 webhook（教會 OA 帳號收到的即時事件通知）內容：

| 名稱 | 英文 | 這把鑰匙能做什麼 |
|---|---|---|
| **Channel Secret**（頻道密鑰） | `LINE_CHANNEL_SECRET` | 驗證「這則訊息真的是 LINE 官方送來的」，防止有人假冒 LINE 偽造事件打進系統 |
| **Channel Access Token**（頻道存取權杖） | `LINE_CHANNEL_ACCESS_TOKEN` | 直接授權系統**代表教會 OA 發送訊息**給會友 |

外洩的後果：陌生人可以冒用教會 OA 的名義發訊息給所有會友（詐騙/騷擾），或竄改系統收到的資料。這就是為什麼 checklist 要求「只透過 secret store（密鑰保管工具）交付、絕不進 repo（程式碼庫）」——**訊息軟體、email、截圖都會留下永久紀錄，一旦外流無法收回**；repo 的版本紀錄（git history）即使事後刪除也很難徹底清乾淨。

---

## 1. 前置準備

- [ ] 你有教會 LINE OA 的**管理者權限**，能登入 [developers.line.biz](https://developers.line.biz)（LINE Developers Console，官方後台）與 [manager.line.biz](https://manager.line.biz)（LINE OA Manager，官方客服後台）。
- [ ] 若教會有一套**密碼管理器**（password manager，例如 1Password、Bitwarden 這類工具，或教會既有慣用的密鑰保管方式）可以做**一次性、有存取紀錄**的分享，而不是用聊天訊息直接貼文字。
- [ ] 你已經知道要交付給誰（開發者的身分／聯絡方式已確認）。

---

## 2. 步驟 A — 到 LINE Developers Console 取得金鑰

登入 [developers.line.biz](https://developers.line.biz) → 選教會的 **Provider**（LINE 帳號的組織單位）→ 找到 **Messaging API channel**（這就是教會現有的 OA 本體——這步是**沿用教會既有的 OA**，不是新建一個，見下方說明）。

| 項目 | 位置 | 動作 |
|---|---|---|
| **Channel Secret** | *Basic settings* 分頁 | 直接顯示，複製下來 |
| **Channel Access Token** | *Messaging API* 分頁 → 捲到 "Channel access token" 區塊 | 按 **Issue**（發行）產生一組**長效（long-lived）token**；若之前已經有發行過，記得先確認是否要**重新發行**（重新發行會讓舊的 token 立刻失效，見第 8 節） |
| **Webhook URL** | *Messaging API* 分頁 | **網域不變**（這裡的網址是既有、已在跑的正式部署，不是新建的）——但**這個 channel 過去沒接過這個系統**，欄位大概是空的，要第一次手動填入：`https://parking-omega-one.vercel.app/api/line/webhook`；按 **Verify**（驗證）應回 200 成功 |
| **Use webhook** | *Messaging API* 分頁 | 開關切到 **ON**（開啟） |

> ⚠️ 這個 provider 底下通常會有好幾組長得很像的數字 ID（LIFF app、LINE Login channel、Messaging API channel 各自有一組），複製時容易貼錯。複製後**貼到密碼管理器暫存欄位時，順手標註清楚是哪一項**，別急著往下一步丟。

---

## 3. 步驟 B — LINE Login channel（LIFF 相關 ID）

同一個 provider 底下，需要一個 **LINE Login channel**（負責會友端登入用的 LIFF app，LIFF = LINE Front-end Framework，是嵌在 LINE App 裡的網頁登入機制）。

**先確認：教會的 provider 底下有沒有這個 channel。** 開發階段用的是開發者自己測試用的 provider，**教會的 provider 底下大機率還沒有**——這不是「去既有 channel 抄幾個值」，很可能是**要新建一個**。兩種情況分開處理：

### 3.1 若還沒有 → 新建（一次性設定）

1. 進入教會的 provider（跟第 2 節同一個，**不要**另開新 provider——LIFF 拿到的 `userId` 要跟 OA 端一致，兩者必須同 provider）。
2. **Create channel → LINE Login**；建好後記下 Channel ID，對應到 `LINE_LOGIN_CHANNEL_ID`。
3. 該 channel 內 **LIFF → Add**（新增一個 LIFF app）：
   - **Size**：`Full`
   - **Endpoint URL**：`https://parking-omega-one.vercel.app/member`
   - **Scope**：勾 `openid`（登入驗證必要）+ `profile`
   - **Add friend option**：`On (Normal)`（讓會友登入同意畫面順便帶一次加好友）
4. **Linked OA**（連結 OA）——**不在 LIFF 的表單裡，在這個 LINE Login channel 的 *Basic settings* 分頁**，往下捲到「Linked OA」，選第 2 節那個教會 Messaging API channel（教會 OA 本體）。條件：OA 與此 channel 同 provider、你的 console 帳號在該 OA 有 Admin 權限。（這格沒選到也不會擋登入功能——`userId` 一致性是靠同 provider 保證的，這格只影響「登入同意畫面要不要順便帶加好友」。）
5. 記下 LIFF ID，對應到 `NEXT_PUBLIC_LIFF_ID`。
6. **把這個 channel 從 Developing 切成 Published**（channel 頁頂部）——這步是即時生效、不需要 LINE 審核，但**不切的話，沒有在這個 channel 掛角色的 LINE 帳號登入會直接失敗**（LINE 登入頁顯示「無法正常執行！」）。

### 3.2 若已經有 → 直接取值

| 項目 | 位置 | 動作 |
|---|---|---|
| **LINE Login Channel ID** | *Basic settings* 分頁 | 複製下來，對應到 `LINE_LOGIN_CHANNEL_ID` |
| **LIFF ID** | *LIFF* 分頁 | 複製下來，對應到 `NEXT_PUBLIC_LIFF_ID` |
| **LIFF Endpoint URL** | *LIFF* 分頁 → 該 LIFF app 設定 | 確認已填 `https://parking-omega-one.vercel.app/member`；Size 應為 `Full`、Scope 應勾 `openid`+`profile`、Add friend 應為 `On (Normal)` |
| **Channel 狀態** | 該 channel 首頁 | 必須是 **Published**（已發布） |

> `NEXT_PUBLIC_LIFF_ID` 這個值其實**不算機密**——它最終會被打包進瀏覽器可看到的前端程式碼（client bundle），任何人開發者工具都看得到。仍然建議跟其他 3 個值一起走同一套安全交付流程，單純是為了流程一致、不用特別區分「這個可以隨便傳」；但如果不小心外流，風險遠低於另外 3 個。

---

## 4. 步驟 C — 打包，準備交付

到這裡你手上應該有 **4 樣東西**：

1. `LINE_CHANNEL_SECRET`（Channel Secret）
2. `LINE_CHANNEL_ACCESS_TOKEN`（Channel Access Token）
3. `LINE_LOGIN_CHANNEL_ID`
4. `NEXT_PUBLIC_LIFF_ID`

**檢查清單（交付前）：**
- [ ] 4 樣東西都已確認來源正確（不是複製到別的 channel 的 ID——參考第 2 節的警告）。
- [ ] 沒有任何一項貼到聊天視窗、email 草稿、或任何文件檔案裡。
- [ ] 準備好放進密碼管理器的**一次性分享連結**，或教會既有的安全交付流程。

---

## 5. 步驟 D — 透過 secret store 安全交付給開發者

**只能用**下列方式之一：
- 密碼管理器的**共享項目**（shared item）功能，邀請開發者的帳號存取。
- 密碼管理器的**一次性分享連結**（one-time share link），連結開過一次就失效。
- **iPhone 內建的密碼分享**（雙方都用 Apple 裝置時可用，見下方說明）。

**絕對不能用**：
- ❌ LINE、Slack、簡訊等聊天工具直接貼文字
- ❌ Email（即使是「刪除」也可能留在寄件備份/收件方存檔）
- ❌ 截圖、Google Doc、Notion 等一般文件工具
- ❌ 寫進任何 git repo（即使是私有 repo，即使之後刪除，git 版本紀錄仍可能保留）

交付後，**在密碼管理器原本存放的位置也刪除/收回這份分享**（若工具支援「限次查看」就不用額外動作）。

### 5.1 用 iPhone 內建密碼分享（可以，前提是雙方都是 Apple 裝置使用者）

iPhone／Mac 的「密碼」App（Passwords，iOS 17 之後叫 **iCloud 鑰匙圈**／**iCloud Keychain**，可儲存並分享帳密的內建系統）本質上就是一個密碼管理器，符合「secret store」的要求。有兩種用法：

| 方式 | 怎麼做 | 特性 |
|---|---|---|
| **AirDrop 分享單一密碼** | 在「密碼」App（或 Safari 已存密碼）裡找到這筆項目 → 點分享 → 選 **AirDrop**（蘋果裝置間的點對點無線傳輸，端對端加密、不經過網路伺服器）→ 選開發者的裝置 | 一次性、點對點，開發者收到後會直接存進**對方自己的密碼 App**，等同交給了對方的密碼管理器，符合安全要求 |
| **建立共享密碼群組**（iOS 17／macOS Sonoma 之後） | 「密碼」App → 左上角 **+** → **新增共享群組** → 邀請開發者的 Apple ID 加入 → 把這幾筆金鑰放進該群組 | 持續同步的共享空間，之後要收回權限只要把開發者移出群組即可，適合未來還會再交付/更新金鑰的情境 |

**使用前務必確認：**
- [ ] 開發者也有 Apple 裝置並登入 iCloud（AirDrop／共享群組都需要雙方是 Apple 生態系使用者）。
- [ ] AirDrop 傳送前，**目視確認裝置名稱是對方本人**，避免傳到附近其他裝置。若雙方不是聯絡人，AirDrop 可能要暫時切到「所有人（10 分鐘內）」——傳完記得**切回「僅限聯絡人」或關閉**，別讓 AirDrop 一直開在公開模式。
- [ ] 傳送地點選在**面對面、非公開擁擠場合**（AirDrop 內容本身有加密，但面對面能確保傳送對象正確）。

這個方式**只解決「owner 交給開發者」這一段**；開發者拿到之後仍要照第 6 節把值設進 Vercel，這份手冊的其餘步驟不變。

---

## 6. 交付之後：開發者端會做什麼（讓你知道流程沒有卡住）

這部分是開發者的責任，但你可以用這份對照表確認事情有在推進：

- 開發者把 4 個值分別設進 **Vercel（部署平台）的 Environment Variables（環境變數）**，且**只設在 Production（正式環境）scope**，不設在 Preview／Development（測試/開發環境）——這是為了避免正式金鑰被非正式環境誤用。
- `NEXT_PUBLIC_LIFF_ID` 比較特別：這個值是**編譯期（build-time）就烤進程式碼**的，改了之後**必須重新 build 一次**，光是重新部署（redeploy）不會生效。
- 其餘三個值改了之後，需要**重新部署**但不一定要重新 build。

---

## 7. 交付後驗證（不驗證等於沒做完）

- [ ] LINE Developers Console 的 webhook **Verify** 按下去回 200（第 2 節已做，交付後如有重新發行 token 建議再驗一次）。
- [ ] 找一支手機，實際掃 LIFF 連結登入一次，確認能正常進到會友頁面（不是卡在 `登入已過期` 這種錯誤畫面）。
  - 若看到「登入已過期」但其實不是過期問題，通常是 `LINE_LOGIN_CHANNEL_ID` 貼錯——回頭比對第 3 節。
  - 若 LIFF 完全打不開（顯示找不到頁面），通常是 `NEXT_PUBLIC_LIFF_ID` 貼錯，或忘記重新 build。
- [ ] **真的發一則通知，但只對一位知情同意的內部人員自己的帳號送，不要對真會友亂送**：⚠️ `LINE_SEND_ENABLED` 這個變數**目前沒有任何程式碼讀取它**（見 `.env.example` 該變數旁的註解），翻它 true/false 不會改變任何行為——**唯一真正決定會不會送出的是 `NOTIFICATION_TRANSPORT`**（設成 `line` 之後，`notification_outbox` 裡任何待送列，下次排程跑到就會真的送出）。安全做法：先確認 `notification_outbox` 目前沒有殘留待送列（查 `/api/internal/jobs/outbox-status`），再手動插入**一筆**指定 `user_id` 為這位知情同意者的通知，手動觸發一次 `dispatch-notifications`，最後用**精確 SQL 查那一筆**（不是看彙總健康度）確認 `status=sent`、`sent_at` 有值，同時手機也真的收到。這樣即使測試沒做好，最多打擾到一個知情的自己人，不會誤發給會友。

---

## 8. 舊 token 的處理

如果這次是把「開發者測試用的 OA token」換成「教會正式 OA token」：
- [ ] ⚠️ **修正（2026-07-20 實測確認）**：長效 channel access token 這個類型，LINE Developers Console **沒有獨立的 revoke 按鈕**——回到**舊的開發測試 channel**（不是新教會 channel）按 **Reissue**，這個動作本身就會讓舊 token 失效，不用另外找撤銷選項。（官方文件：reissue 會使目前有效的長效 token 立即失效；新 reissue 出來的值不用存、不用放進任何地方。）
- [ ] **要驗證舊 token 真的失效**：拿舊 token 對 LINE API 打一次任意需要驗證的請求（例如查 profile 或發訊息 API），預期應該被拒絕（401）。**實測發現可能有短暫（數分鐘級）的傳播延遲**——第一次仍回 200 不代表失敗，等幾分鐘後重新驗證再下結論。沒驗證過的撤銷，等於沒撤銷。
- [ ] 注意：光是把系統設定（`NOTIFICATION_TRANSPORT`）從測試模式切到正式模式，**不會讓舊 token 失效**——舊 token 若沒手動 reissue 並驗證，仍然是有效的、可被濫用的金鑰。

---

## 9. 金鑰輪替（rotation）與聯絡人

- [ ] **定義輪替聯絡人**：如果你（OA token owner）離職、失聯、或懷疑金鑰外洩，誰是可以立即接手重新發行金鑰的人？把這個人的聯絡方式記在教會內部的交接文件（不是這份 repo 文件）。
- **什麼情況要輪替（重新發行）金鑰**：
  - 懷疑金鑰外洩（例如不小心貼到公開頻道、截圖分享出去）。
  - OA token owner 或開發者人員異動。
  - 定期安全盤點時（教會可自訂週期，例如每年一次）。
- **怎麼輪替**：回到第 2 節的 Messaging API 分頁重新 **Issue** 一次 Channel Access Token（舊的立刻失效），或在 Basic settings 重新產生 Channel Secret；產生後**整個第 4–7 節流程要重跑一次**（重新交付給開發者、重新設進 Vercel、重新驗證）。

---

## 10. 紅線總結（絕對不可以）

- ❌ 把任何一把金鑰貼進聊天訊息、email、文件、截圖
- ❌ 把金鑰寫進 git repo 的任何檔案（含 `.env` 若被誤加進版本控制）
- ❌ 用同一份訊息同時傳「教會 OA 的帳密」和「金鑰」（分開交付，降低單一外洩事件的損害範圍）
- ❌ 交付後忘記在密碼管理器收回分享連結

---

**相關文件**：[go-live-checklist.md](go-live-checklist.md)（總清單）· [go-live-readiness.md](go-live-readiness.md) §1（為什麼要這樣分工）· [prod-deploy-runbook.md](prod-deploy-runbook.md) §6/§13（開發者端完整技術步驟）· [dispatcher-ops.md](dispatcher-ops.md)（金鑰在系統裡怎麼被使用、出事怎麼緊急處置）
