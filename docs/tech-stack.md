# 技術架構規劃 (Tech Stack)

> 狀態：討論中，會隨對話持續更新。標記 `[TBD]` 的項目尚未拍板。

## 0. 已確認的關鍵決策

- **技術路線：全自研（不 fork Platane/snk）**。原因：想完全掌控路徑演算法與渲染邏輯，不受既有專案架構侷限，也避免授權/署名上的牽絆。
- 語言/執行環境：**TypeScript / Node.js**。理由：GitHub Actions 生態最成熟，SVG 字串操作、GraphQL API 呼叫、動畫時間軸計算都有成熟套件，開發速度最快。
- 路徑規劃演算法：**接近最佳解的路徑規劃**（非單純機械式來回掃描），詳見第 3 節。
- 輸出格式：**只做 SVG 動畫**，不產出 GIF。
- 主題：**單一深色主題**，不做 light/dark 雙版本。

## 1. 專案結構（規劃中）

```
WolverineCommit.Snake/
├── docs/                          # 設計與規劃文件（本資料夾）
├── src/
│   ├── data/
│   │   └── fetchContributions.ts  # 呼叫 GitHub GraphQL API 取得 contribution calendar
│   ├── pathfinding/
│   │   └── solveSnakePath.ts      # 蛇的路徑規劃演算法（核心難點，見第 3 節）
│   ├── render/
│   │   ├── theme.ts               # 色碼與樣式常數（方案 A：深藍 + 琥珀金）
│   │   ├── renderGrid.ts          # 背景格子（GitHub contribution 配色）
│   │   ├── renderSnake.ts         # 蛇頭 / 蛇身渲染與逐步動畫時間軸
│   │   └── renderEventBubble.ts   # Event 泡泡 + 連線動畫
│   └── index.ts                   # CLI 進入點：串接 data → pathfinding → render → 輸出 SVG
├── dist/                           # build 產物（實際內容存放於 `output` 分支，見 tech-stack.md 第 5 節）
├── .github/
│   └── workflows/
│       └── generate-snake.yml     # 排程執行，產出 SVG 並推送到 output 分支
├── package.json
├── tsconfig.json
├── LICENSE
└── README.md
```

## 2. 核心技術棧

| 項目 | 選型 | 備註 |
|---|---|---|
| 語言 | TypeScript | 型別安全，方便描述格子/座標/路徑等資料結構 |
| 執行環境 | Node.js（於 GitHub Actions runner 執行） | 免額外安裝執行環境設定 |
| 資料來源 | GitHub GraphQL API（`contributionsCollection.contributionCalendar`） | 需要一組 GitHub Personal Access Token，存放於 repo secret |
| 路徑演算法 | 自研，近似最佳解（貪婪 + 局部優化），見第 3 節 | 全案技術難度最高的部分 |
| 渲染輸出 | 純手刻 SVG 字串／模板，動畫用 SMIL `<animate>` 或 CSS animation | 不依賴額外的 canvas/瀏覽器渲染套件，維持輕量 |
| 自動化 | GitHub Actions（cron 排程 + 手動觸發 + push 觸發） | 詳見第 5 節 |
| 發布方式 | 推送到 `output` 分支，README 用 `<img>` 直接引用該分支上的單一 SVG | 詳見第 5 節 |

## 3. 路徑規劃演算法（自研核心難點）

**目標**：規劃一條蛇的移動路徑，能吃到所有「有 contribution 的格子」，且路徑看起來自然流暢（不是死板的逐行來回掃描），同時蛇不能咬到自己（不可穿越已存在的蛇身格子）。

**策略（分階段）**：

1. **貪婪選點**：每一步優先選擇「距離最近、尚未吃到的 contribution 格子」作為短期目標。
2. **尋路**：兩點之間用 A\* / BFS 在目前空格（未被蛇身佔據）中尋路，保證每一步移動合法。
3. **局部路徑優化**：貪婪法產生的路徑通常有繞路，用 2-opt / Or-opt 類的局部優化，縮短總路徑長度，讓移動軌跡更平滑、更接近人類直覺的路線。
4. **死路 fallback**：若貪婪法找不到任何可達的未吃格子（蛇身把自己困住），改為沿著目前可達邊界繞行，直到重新找到可達的目標格；必要時允許蛇身長度暫時「以尾端跟隨方式」讓路（即尾巴移動騰出空間），避免整個流程卡死。

**風險與待驗證項目**：
- 大格數（GitHub 一年份約 7×53 = 371 格）下，貪婪 + A\* 的效能是否足夠在 CI 中快速跑完，需要實測。
- 死路情況的處理邏輯是實作中最容易出 bug 的地方，需要寫測試案例覆蓋（例如刻意建構一個容易困住蛇的假資料）。

**走訪範圍（已確認）**：蛇只在「有 contribution 的格子」之間移動與吃格，經過空白格時不停留、不觸發任何動畫。優點是路徑短、演算法複雜度低、整輪動畫更密集精彩；代價是若 contribution 很稀疏，蛇的移動軸線在視覺上會呈現「跳格」（非相鄰格子之間直接移動），這在 renderer 畫移動動畫時需要用平滑的曲線/位移動畫來銜接，而不是畫成沿格線走的直角轉彎。

## 3.1 蛇身長度與迴圈重置機制（已確認）

- **固定長度**：蛇身維持固定節數（草案：10 節），吃到新格子時頭部前進、尾端同步收縮，行為如經典貪食蛇，不會無限變長。
- **迴圈重置**：蛇吃完所有 contribution 格子（= 走完一輪）後，重置回起始點，所有已吃格子在視覺上恢復原狀（背景格子顏色還原），停頓 1–2 秒（見 `visual-design.md` 第 5 節）後開始下一輪。
- 選擇固定長度而非「吃越多越長」的理由：動畫循環邏輯簡單、SVG 檔案大小與渲染複雜度可控，不會因為蛇身隨時間不斷變長而讓後期渲染越來越吃力。

## 4. 客製化重點對應（呼應 visual-design.md）

1. **顏色主題**：`render/theme.ts` 集中管理方案 A 色碼常數。
2. **蛇頭渲染**：`render/renderSnake.ts` 依目前移動方向渲染方向感箭頭圖示。
3. **Event 泡泡動畫**：`render/renderEventBubble.ts` 依格子 contribution 等級決定泡泡大小/亮度，並產生氣泡→蛇尾的連線動畫（時間軸見 `visual-design.md` 第 5 節）。

## 5. GitHub Actions 排程與發布方式（已確認）

- **排程頻率**：每天 1 次，UTC 0 點（cron `0 0 * * *`）。理由：GitHub contribution 資料本身以「天」為單位更新，跑得更頻繁沒有實質意義。
- **額外觸發條件**：
  - `workflow_dispatch`：手動觸發，方便測試。
  - `push` 到 `main` 分支：修改程式碼後可立即看到效果，不用等排程。
- **輸出分支**：使用獨立的 `output` 分支存放產出的 SVG（不進 `main` 分支歷史，避免每天產生大量 commit 污染主線）。
- **README 嵌入方式**：因只有單一深色主題，直接用 `<img>` 引用 `output` 分支上的檔案：

  ```markdown
  ![wolverine-snake](https://raw.githubusercontent.com/<user>/WolverineCommit.Snake/output/dist/wolverine-snake.svg)
  ```

## 6. License

- 因為全自研、不依賴 `snk` 程式碼，不再有 fork 的署名/授權牽絆。
- 建議：以 **MIT License** 開源本專案（著作權歸屬自己），符合 GitHub profile widget 這類專案的社群慣例，方便他人參考或再改造。
- **README 致意文字（已確認：加）**：在 README 底部加一行簡短文字，說明本專案的創意靈感來自「GitHub contribution snake」這類社群專案，純粹社群禮貌與致意，不涉及程式碼依賴或授權義務。

## 7. 待討論清單

- [ ] 路徑演算法的效能與死路處理需要在實作階段驗證（見第 3 節風險項目）
- [ ] 蛇身固定節數的實際數值（草案 10 節，需依實際渲染效果微調）
