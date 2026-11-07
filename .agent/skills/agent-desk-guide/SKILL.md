---
name: agent-desk-guide
description: 拼好算 Agent Desk 核心架构与二次开发指南。当 AI 智能体（Agent）受邀协助维护、二次开发、增加新平台适配器（如 Claude Code, Cursor, Ollama 等）或调整 UI 与接力逻辑时激活。
---

# 拼好算 Agent Desk 开发者协同指南

本技能指导 AI 智能体（Agent）在接手本项目开发或协助用户扩展平台时，快速理清代码拓扑、遵循隐私与架构准则、高效增加功能并确保全部 184 项测试绿灯通过。

---

## 1. 项目拓扑一览

```
agent-desk/
├── server.mjs             # 主服务端：路由、任务状态机、哨兵调度、REST/SSE 接口
├── remote-relay.mjs       # 远程中继转发逻辑
├── lib/                   # 核心业务库
│   ├── codex.mjs          # Codex CLI 适配器
│   ├── antigravity.mjs    # Antigravity CLI 适配器
│   ├── local-agents.mjs   # 本机已安装 Agent 探测与注册中心
│   ├── platform-relay.mjs # 跨平台任务接力与上下文移交
│   ├── companion-server.mjs # 手机端配对与文件互传服务
│   ├── account-manager.mjs # 多账号切换与额度缓存池
│   └── store.mjs          # 任务与检查点轻量持久化
├── public/                # 纯静态前端（无构建打包依赖，即改即生效）
│   ├── index.html / app.js / style.css       # 电脑桌面端工作台
│   └── mobile.html / mobile.js / mobile.css  # 手机端轻量控制台
├── docs/                  # 官方设计、截图与扩展文档
│   └── EXTENDING_PROVIDERS.md # 适配器标准规范
└── tests/                 # 184 项全量测试集（基于 Node.js 原生 test runner）
```

---

## 2. 核心架构设计原则

1. **零构建黑盒（Zero-Build Frontend）**：
   `public/` 目录下全部使用现代原生 ES Module、CSS Custom Properties 和标准 Web Components，无需 Webpack、Vite 或 Babel。修改后刷新浏览器即生效。
2. **状态与私有数据严格隔离**：
   运行态数据写入 `data/user/`，不得将用户真实路径、邮箱凭证、Cookie 或会话内容提交到 Git 或放入公共发行包。
3. **测试驱动保证（Safety First）**：
   系统包含 184 项自动化测试（覆盖额度哨兵等待、换号接力、离线恢复、重试确认等关键场景）。任何代码变更后必须执行并通过 `npm test`。

---

## 3. 如何新增平台适配器（Step-by-step）

当用户要求：“我想接入我常用的 Claude Code / Ollama / 某个大模型 API”：

1. **注册平台信息**：
   在 `lib/local-agents.mjs` 中的 `localProviders` 数组中增加对应项，声明 `id`、`name`、`command` 与可执行文件探测逻辑。
2. **编写执行适配器**：
   在 `lib/` 目录下创建适配器文件（如 `lib/claude.mjs`），实现 `queryQuota`、`listModels` 和 `runTurn` 接口规范（详见 `docs/EXTENDING_PROVIDERS.md`）。
3. **注册至服务端调度**：
   在 `server.mjs` 的平台委托与回合执行中导入该适配器。
4. **验证与回归**：
   在项目根目录下执行 `npm test`，确保原有全部测试 100% 通过。

---

## 4. 移动端 UI 开发注意事项

- 手机端视图为 `public/mobile.html` + `public/mobile.js` + `public/mobile.css`。
- **任务切换**必须使用半屏抽屉（Bottom Sheet Drawer `#task-sheet`），禁止直接弹起操作系统原生 `<select>` 弹窗。
- 底层 `<select id="task-select">` 保持在 DOM 中隐藏（带有 `.sr-only`），确保测试断言与现有双向绑定不受影响。
- 手机端文件上传通过回形针按钮，限制最大 10MB，上传后存入电脑任务工作区。

---

## 5. 校验指令

```bash
# 启动本地服务进行人工体验
npm start

# 执行全量回归测试
npm test
```
