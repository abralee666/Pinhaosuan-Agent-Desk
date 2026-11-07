// Each provider runs in a separate OS process and receives only its handoff packet.
// These are deterministic fixtures, never represented as real model inference.
import readline from 'node:readline';
import { digest } from './store.mjs';
const actor = process.argv[2];
const rl = readline.createInterface({ input: process.stdin });
const send = data => process.stdout.write(JSON.stringify(data) + '\n');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
rl.once('line', async line => {
  try {
    const pack = JSON.parse(line);
    const { hash, ...body } = pack;
    if (digest(body) !== hash) throw new Error('交接包校验失败');
    for (const file of pack.files) if (digest(file.content) !== file.sha256) throw new Error('文件内容与检查点不一致');
    send({ type: 'received', actor, contextHash: hash, memoryIds: pack.memories.map(m => m.id), completed: pack.completed, pid: process.pid });
    await pause(650);
    send({ type: 'message', text: `已读取 ${pack.memories.length} 条共享记忆、${pack.completed.length} 个已完成步骤和 ${pack.files.length} 个文件。` });
    const stages = [
      { label: '保存需求与项目约束', name: 'spec.md', content: `# 任务需求\n\n${pack.goal}\n\n## 共享约束\n\n${pack.memories.map(m => '- ' + m.text).join('\n')}\n\n这是确定性逻辑演示，不是模型生成的实现。\n` },
      { label: '保存任务计划与检查点', name: 'plan.json', content: JSON.stringify({ goal: pack.goal, steps: ['保存需求与项目约束', '保存任务计划与检查点', '接手并核对已有成果', '验证共享记忆与文件连续性'], memoryIds: pack.memories.map(m => m.id), author: actor }, null, 2) },
      { label: '接手并核对已有成果', name: 'handoff-receipt.json', content: JSON.stringify({ agent: actor, contextHash: hash, inheritedSteps: pack.completed, receivedMemories: pack.memories, inheritedFiles: pack.files.map(f => ({ name: f.name, sha256: f.sha256 })), checks: { contextIntegrity: true, fileIntegrity: true, resumedAfterCheckpoint: pack.completed.length >= 2 } }, null, 2) },
      { label: '验证共享记忆与文件连续性', name: 'verification.md', content: `# 接力验证报告\n\n运行方式：两个独立的模拟后台进程。\n\n- 上下文哈希校验：通过\n- 已有文件哈希校验：通过\n- 已继承步骤：${pack.completed.length}\n- 已继承共享记忆：${pack.memories.length}\n- 已继承文件：${pack.files.length}\n- 接手 Agent：${actor}\n\n## 接手时读取的记忆\n\n${pack.memories.map(m => '- ' + m.text).join('\n')}\n\n注意：这验证平台的交接机制，不验证真实 Antigravity 模型能力。\n` }
    ];
    for (let i = pack.nextStep; i < stages.length; i++) {
      await pause(800);
      send({ type: 'step', index: i, ...stages[i] });
      if (actor === 'codex' && i === 1) {
        await pause(500);
        send({ type: 'quota', reason: '测试注入：模拟额度耗尽，实际订阅额度未改变。' });
        rl.close(); return;
      }
    }
    send({ type: 'done' });
  } catch (error) { send({ type: 'error', text: error.message }); process.exitCode = 1; }
  rl.close();
});
