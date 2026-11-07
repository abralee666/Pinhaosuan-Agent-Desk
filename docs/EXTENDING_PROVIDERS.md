# 拼好算 Agent Desk · 平台扩展与适配器开发指南

拼好算 Agent Desk 采用**微内核 + 可插拔适配器（Pluggable Provider Architecture）**设计。我们不仅原生适配了 Codex 与 Google Antigravity，更在底层将平台抽象为统一的契约接口（Provider Contract）。

开发者或用户可以根据个人工作流和偏好，接入任何本地 AI CLI（如 Claude Code、Cursor、Kiro、WorkBuddy、Coze）或本地大模型服务（如 Ollama、vLLM、LocalAI），实现同平台无缝换号、跨平台接力与手机端远程操控。

---

## 一、架构总览

```
  ┌────────────────────────────────────────────────────────┐
  │         用户终端交互层 (Desktop Web / Mobile Web)        │
  └───────────────────────────┬────────────────────────────┘
                              │ HTTP / SSE / REST
  ┌───────────────────────────▼────────────────────────────┐
  │                 Agent Desk Core Server                 │
  │     (任务上下文 · 检查点 · 记忆库 · 哨兵调度 · 手机桥接)     │
  └─────────────┬───────────────────────────┬──────────────┘
                │                           │
  ┌─────────────▼─────────────┐   ┌─────────▼──────────────┐
  │   官方提供者 (Built-in)   │   │   自定义提供者 (Custom)  │
  │  - Codex CLI              │   │  - Claude Code         │
  │  - Antigravity CLI (agy)  │   │  - Ollama / 本地模型   │
  └───────────────────────────┘   │  - 自定义 API / CLI    │
                                  └────────────────────────┘
```

所有的平台适配器均位于 `lib/` 目录下（如 `lib/codex.mjs`、`lib/antigravity.mjs`）。核心服务端只依赖标准契约，不硬编码具体平台的私有逻辑。

---

## 二、平台适配器标准契约（Provider Interface）

一个完整的平台适配器需要导出一个符合规范的 Class 或模块对象，满足以下核心生命周期：

### 1. 发现与检测（Detection）
在 `lib/local-agents.mjs` 中注册该平台的基本信息：
```javascript
export const localProviders = [
  {
    id: 'my-agent',               // 唯一平台标识 (小写英文字符)
    name: 'My Custom Agent',      // 界面展示名称
    command: 'my-agent',          // PATH 环境变量中的执行命令
    folder: 'MyAgent',            // Windows 安装文件夹名 (可选)
    exe: 'MyAgent.exe',           // Windows 可执行文件名 (可选)
    processes: ['my-agent.exe', 'my-agent'], // 用于探测是否正在运行的进程名
    ready: true                   // 是否对用户开放连接能力
  },
  // ... 其他平台
];
```

### 2. 账号与额度状态（Status & Quota）
实现账号会话检测与周期额度查询：
```javascript
/**
 * 查询指定账号的额度状态与重置窗口
 * @param {Object} account - 账号实体
 * @returns {Promise<Object>} QuotaReport
 */
export async function queryQuota(account) {
  // 返回标准格式：
  return {
    valid: true,
    windows: {
      fiveHour: { remaining: 85, capacity: 100, resetAt: '2026-11-07T18:00:00Z' },
      weekly: { remaining: 60, capacity: 100, resetAt: '2026-11-10T00:00:00Z' }
    },
    ordinaryUsageAllowed: true // 是否允许执行模型推理
  };
}
```

### 3. 模型目录（Model Catalog）
返回该平台支持的模型列表与推理强度档位：
```javascript
export function listModels() {
  return [
    { id: 'model-pro', name: 'Pro Model', defaultEffort: 'medium' },
    { id: 'model-fast', name: 'Fast Model', defaultEffort: 'low' }
  ];
}
```

### 4. 回合执行器（Turn Execution & Streaming）
执行一轮具体指令，支持流式日志、文件增量感知与断点快照：
```javascript
/**
 * @param {Object} params
 * @param {string} params.taskId 任务 ID
 * @param {string} params.workspace 本地项目工作区绝对路径
 * @param {string} params.prompt 用户指令或跨平台接力交付包
 * @param {string} params.executionMode 'read-only' | 'workspace' | 'full-access'
 * @param {boolean} params.networkAccess 是否允许联网
 * @param {Function} params.onEvent 执行过程中的流式事件回调
 * @returns {Promise<Object>} 执行交付结果
 */
export async function runTurn({ taskId, workspace, prompt, executionMode, networkAccess, onEvent }) {
  // 1. 启动本地进程或发送 HTTP 请求
  // 2. 通过 onEvent({ kind: 'step' | 'message', text: '...' }) 推送给前端
  // 3. 收集产出文件哈希并写入检查点
  return {
    success: true,
    replyText: '执行完成',
    producedFiles: ['output.txt']
  };
}
```

---

## 三、快速接入示例：接入 Claude Code CLI

以下是一个简化示例，展示如何用不到 80 行代码为 Claude Code 编写适配器：

```javascript
// lib/providers/claude.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';

export class ClaudeAdapter {
  constructor({ executablePath = 'claude' } = {}) {
    this.cmd = executablePath;
  }

  async checkLogin() {
    // 执行 claude --version 或检查本地认证文件
    return { loggedIn: true, user: 'claude-user' };
  }

  async run({ workspace, prompt, onMessage }) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cmd, ['-p', prompt], {
        cwd: workspace,
        env: { ...process.env, CI: 'true' },
        shell: true
      });

      let fullOutput = '';
      child.stdout.on('data', chunk => {
        const text = chunk.toString();
        fullOutput += text;
        if (onMessage) onMessage(text);
      });

      child.on('close', code => {
        if (code === 0) {
          resolve({ ok: true, output: fullOutput });
        } else {
          reject(new Error(`Claude exited with code ${code}`));
        }
      });
    });
  }
}
```

---

## 四、跨平台接力数据包（Handoff Packet）约定

当一个平台额度耗尽或发生故障时，Agent Desk 会自动打包当前任务的上下文：
- **项目工作区文件**：已创建或修改的代码、文档保持原样。
- **对话历史与目标**：包含用户的初始需求与多轮交互摘要。
- **共享记忆（Shared Memory）**：包含固定的系统规则与约束（如代码风格、交付格式）。
- **未尽事宜与检查点**：上一回合未完成的目标，接手的平台会根据交付包直接续写，无需用户重新交代背景。

开发者在实现新平台时，只需将该数据包作为 `prompt` 的前置背景注入即可享受无缝接力。

---

## 五、测试与验证

拼好算拥有覆盖 184 项行为约束的端到端测试套件。添加新适配器后，请运行：
```bash
npm test
```
只要原有测试全部通过，即可确保系统稳定可靠、无数据回滚与私密信息泄漏风险。
