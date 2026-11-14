# 材料数据计算 · 独立版（v1.1.0）

本目录是「材料数据计算」的完整源码，包含三个可独立交付的端：

| 目录 | 形态 | 启动 / 使用方式 | 数据位置 |
| --- | --- | --- | --- |
| `web/` | 离线网页版（零依赖静态站点） | 双击 `start.cmd` 或 `index.html` | 浏览器 localStorage |
| `desktop/` | Windows 桌面版构建工程（Electron） | `npm install` → `npm run dist`，产物为单文件便携 EXE | `%APPDATA%\SSMaterialDataCalc` |
| `miniprogram/` | 微信小程序工程（圆片算量） | 微信开发者工具导入 | 微信本地缓存 |

三端使用同一套公式：公式版本 **2.1.0**，包含角料重量（双排 ×0.12、单排 ×0.22）。

## 快速验证

```powershell
cd web
node test/smoke.js

cd ..\miniprogram
node test/smoke.js
node test/pages.js
node tools/verify.js
```

桌面版构建：

```powershell
cd ..\desktop
npm install
npm run dist
```

国内网络可先设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 与
`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`。

## 与 v0.2.0 完整版的关系

`../desktop/`、`../outputs/preview-site/`、`../docs/` 是 MatManager v0.2.0 完整版（含供应商与材料单据）的源码与文档。v1.1.0 只保留「数据计算」模块，两条产品线数据互不自动同步；计算口径同源，v1.1.0 新增角料重量。

## 目录说明

```text
standalone/
├─ README.md                 # 本文件
├─ web/
│  ├─ index.html             # 页面入口
│  ├─ assets/                # 样式与图标
│  ├─ src/                   # calculation / parameter / batch / history / export / ui
│  ├─ vendor/                # SheetJS 0.20.3（XLSX 导出与读取）
│  ├─ test/smoke.js          # 逻辑冒烟测试
│  ├─ server.js              # 零依赖静态服务器
│  ├─ start.cmd              # 双击启动
│  ├─ package.json
│  └─ README.md              # 网页版说明（含角料口径、常见问题）
├─ desktop/
│  ├─ main.js                # Electron 主进程（中文菜单、单实例、app:// 协议）
│  ├─ package.json           # electron-builder 便携 EXE 配置
│  └─ assets/icon.ico        # 程序图标
└─ miniprogram/
   ├─ app.js / app.json / app.wxss
   ├─ pages/                 # 单次计算、批量计算、历史记录、参数维护
   ├─ utils/                 # 计算内核、参数、历史、批量、导出、格式化
   ├─ test/                  # smoke.js、pages.js
   ├─ tools/verify.js        # 工程静态自检
   └─ docs/微信小程序部署指南.md
```

> `desktop` 打包时通过 `extraResources` 直接引用 `../web` 的页面资源，不复制、不改动网页源码；开发调试可用 `npm start`（`electron .`）先看窗口效果。
