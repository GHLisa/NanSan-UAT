# 資料庫遷移：美東 → 新加坡（降低延遲）

> 目的：原 Neon DB 與 Vercel 函式皆在美東 `us-east-1`，台灣使用者每次互動需跨太平洋來回（~200ms+/趟），造成「點一下卡一下」。將**資料庫與 Vercel 函式一起搬到新加坡 `ap-southeast-1` / `sin1`**，使「台灣瀏覽器 → 新加坡函式 → 新加坡 DB」三者同區。
>
> 建立日期：2026-06-20

---

## 一、區域對照（務必認清，刪錯會出事）

| | Endpoint | 區域 | 狀態 |
|---|---|---|---|
| 舊 DB（待刪） | `ep-lively-pond-apco0dtp` | **us-east-1** | 確認線上已切換後再刪 |
| 新 DB（保留） | `ep-bitter-block-ao9i9e2v` | **ap-southeast-1** | ✅ 正式使用中，勿刪 |

---

## 二、已完成項目

### Repo 程式／設定（已改）
- `vercel.json`：加 `"regions": ["sin1"]` → 函式部署到新加坡（下次部署生效）。
- `.env.example`：文件化新加坡 pooled / 直連字串範例。
- `schema.prisma`：加上 `directUrl` 的**註解說明**（未啟用，避免缺 `DIRECT_URL` 時弄壞 build）。

### 本機 + 新加坡 DB（已完成並驗證）
- `.env` 的 `DATABASE_URL` 已指向新加坡 pooled（`ap-southeast-1`）。
- `npx prisma db push`：建表成功。
- `npm run db:seed`：灌入成功。
- 資料驗證：員工 18／部門 8／保險公司 14／案件 10／派案佇列 6／審核 5／結算 2。

> 備註：POC 資料採「重建」路線（db push + seed），未做 dput/restore。

---

### 雲端切換（已完成，2026-06-20）
- ✅ Vercel Production `DATABASE_URL` 已用 CLI 覆寫為新加坡 pooled（Sensitive）。
- ✅ 已 `vercel --prod` 部署成功（deployment `dpl_3jwnUmduXuejE296hBisTuhpKYRp`）。
- ✅ 正式網域：https://web-site-beryl-nu.vercel.app
- ✅ `vercel inspect` 確認所有 λ 函式區域為 **sin1**。
- ✅ 端到端驗證：登入 200；`X-Vercel-Id: hkg1::sin1`（香港 edge → 新加坡函式）；
  `/api/badge-counts` ~0.57s、`/api/dashboard` ~0.62s。
- 註：Vercel 只有 Production 設了 `DATABASE_URL`（無 Preview/Development），故只需換一處。

## 三、剩餘步驟

1. ⏳ **確認線上穩定（建議觀察 1～2 天）後，刪除美東舊 project**（見第五節）。
   - 在此之前舊 project 先保留，作為回退保險。

---

## 四、上線前最終檢查清單

刪除舊 project 前，以下每項都要 ✅：

- [ ] Vercel **Production** `DATABASE_URL` 已是新加坡字串（host 含 `ap-southeast-1` 與 `-pooler`）。
- [ ] Vercel **Preview**（若有用）`DATABASE_URL` 也已切換。
- [ ] 已觸發 **Redeploy** 且部署成功（非沿用舊 build）。
- [ ] 線上站台可正常**登入**。
- [ ] 線上可看到案件清單、儀表板數字（代表確實連到有資料的新 DB）。
- [ ] 派案池「新增派案／取件」可正常寫入。
- [ ] 沒有其他環境／排程／同事的本機仍連著美東 DB。

### 如何確認「線上真的連到新加坡」
任選一種：

1. **速度感**：DevTools → Network，看任一支 `/api/...` 的 **TTFB**。美東約 ~200ms+；新加坡應降到數十 ms。
2. **Neon 活動量**：Neon Console 進**新加坡 project** → Monitoring，操作線上站台時應看到連線數／查詢量上升；**美東 project** 則應持平（已無流量）。
3. **資料差異法**（最確定）：在新加坡 DB 改一筆好辨識的資料（例如某保險公司名稱加註記），線上重新整理若看得到該變更，即代表連的是新加坡。

> 建議刪除前先讓舊 project **閒置觀察 1～2 天**，確認線上完全無誤再刪。閒置幾乎不耗額度。

---

## 五、刪除美東舊 project

1. 登入 https://console.neon.tech
2. 左上專案下拉，選到**美東 project**（region 顯示 *US East (N. Virginia) / us-east-1*，endpoint `ep-lively-pond-...`）。
3. 進 **Settings**（專案層級）。
4. 最下方 **Danger Zone → Delete project**。
5. 依提示**輸入專案名稱**確認 → 送出。

> ⚠️ 刪除為**不可逆**：該 project 所有分支、資料、連線字串立即失效且無法復原。動手前再看一眼 region 是 **us-east-1**。

---

## 六、後續可選優化

- **啟用 `directUrl`**：本機 `.env` 與 Vercel **都**設好 `DIRECT_URL`（= 新加坡 DB 去掉 `-pooler` 的直連字串）後，把 `schema.prisma` 內 `// directUrl = env("DIRECT_URL")` 取消註解。讓 migration 走直連、執行期走 pooler。
  > 未在所有環境設定就啟用，會導致 `prisma generate`（含 Vercel build）失敗。
- **middleware / getSession 雙重 jwtVerify**：可由 middleware 驗證後將 payload 經 header 傳給 API 重用，省一次驗證（屬安全敏感重構，建議獨立進行）。
