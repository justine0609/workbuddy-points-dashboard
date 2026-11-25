# WorkBuddy 积分消耗可视化大屏

> WorkBuddy Points Usage Dashboard

一个**零依赖、纯前端**的积分消耗数据可视化大屏：导入 WorkBuddy 导出的积分消耗明细（CSV），自动聚合统计，实时渲染 8 个可视化面板，直观呈现你的积分都花在了哪里。

![Tech](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![JS](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![ECharts](https://img.shields.io/badge/ECharts-5.x-AA344D)
![License](https://img.shields.io/badge/License-MIT-green)

---

## 功能特性

- **一键导入**：拖入或选择 CSV 文件，自动解析、自动聚合、自动渲染
- **8 个可视化面板**：
  - 4 张核心指标卡（总消耗 / 笔数 / 日均 / 单笔峰值）
  - 每日消耗趋势（积分 + 笔数双轴）
  - 模型消耗占比（饼图）
  - 使用端分布（积分 + 笔数双维度）
  - 模型消耗排行（横向条形图）
  - 单笔消耗区间分布
  - 时段消耗热力（小时 × 均值）
  - 消耗日历热力图
- **浅色清新风格**，1920×1080 自适应缩放，任意分辨率一屏看全
- **内置演示数据**，无需任何配置即可预览效果
- **数据不出浏览器**：所有统计在前端本地完成，不上传任何数据

---

## 快速开始

### 方式一：直接看效果（推荐）

1. 启动一个本地静态服务（任选其一）：

   ```bash
   # Python
   python -m http.server 8080

   # Node.js
   npx serve .
   ```

2. 浏览器打开 `http://127.0.0.1:8080/`，页面会自动载入演示数据

> ⚠️ 不要直接双击 `index.html`（`file://` 协议下 `fetch` 读 CSV 会被浏览器同源策略拦截）。想双击打开，请改用方式二。

### 方式二：双击打开（免服务）

把 `app.js` 里的演示数据加载方式改为内联，或使用任意「一键启动」的静态服务器工具（如 VS Code 的 Live Server 插件）。

### 方式三：导入自己的数据

打开页面后，点击右上角 **「导入数据」**，选择你的 CSV 文件即可。支持两种格式：

1. **WorkBuddy 导出的积分消耗明细**（推荐，直接可用）
2. 任意符合下方字段约定的 CSV

---

## 数据格式约定

CSV 文件需包含表头，字段名可灵活匹配（按关键词识别），但**必须包含「时间」和「积分消耗」两列**：

| 字段 | 说明 | 示例 |
|------|------|------|
| 时间 | 消耗发生时间，格式 `YYYY-MM-DD HH:MM:SS` | `2026-11-25 16:48:00` |
| 产品 | 产品名称 | `WorkBuddy` |
| 积分消耗 | 消耗的积分数（可为 0） | `5.23` |
| 模型 | 使用的模型 | `deepseek-v4-pro` |
| 使用端 | 使用客户端 | `WorkBuddy` / `app_cloud` |

示例：

```csv
时间,产品,积分消耗,模型,使用端
2026-11-25 16:48:00,WorkBuddy,5.23,deepseek-v4-pro,WorkBuddy
2026-11-25 11:55:00,WorkBuddy,0,hy4-flash-free,app_cloud
```

---

## 目录结构

```
.
├── index.html            大屏页面
├── app.js                前端逻辑（解析/聚合/渲染）
├── style.css             浅色清新样式
├── data/
│   └── usage_demo.csv    演示数据（脱敏模拟）
└── lib/
    └── echarts.min.js    ECharts 本地副本（离线可用）
```

---

## 技术实现

- **纯前端**：无后端、无框架、无构建步骤，打开即用
- **CSV 解析**：原生 JS 手写解析器，按表头关键词自动识别字段（兼容不同导出工具的列顺序）
- **实时聚合**：总量、日均、区间分布、时段均值等全部在浏览器内用 Map/Reduce 计算
- **图表渲染**：ECharts，8 个图表统一浅色配色、柔化国标
- **自适应**：逻辑画布 1920×1080，按窗口等比缩放居中

---

## 数据来源与隐私

`data/usage_demo.csv` 为**脱敏模拟数据**，仅用于演示，不包含任何真实使用记录。你自己的数据仅在浏览器本地解析，不会上传。

## 许可证

[MIT](LICENSE)
