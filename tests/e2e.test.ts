import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createServer, request } from 'http';
import { createRequire } from 'module';

type OutboxMessage = {
  type?: string;
  chatId?: string;
  content?: string;
  messageId?: string;
};

const require = createRequire(import.meta.url);

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => resolve(0));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function httpGet(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode || 0, body: data });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitFor<T>(
  fn: () => Promise<T | null>,
  timeoutMs = 10000,
  intervalMs = 200
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timeout after ${timeoutMs}ms`);
}

async function writeJsonFile(dir: string, data: object): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filePath = join(dir, fileName);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

async function clearDir(dir: string): Promise<void> {
  try {
    const files = await fs.readdir(dir);
    await Promise.all(
      files.map(file => fs.unlink(join(dir, file)))
    );
  } catch {
    // ignore
  }
}

async function readOutbox(dir: string): Promise<OutboxMessage[]> {
  const results: OutboxMessage[] = [];
  const files = await fs.readdir(dir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = join(dir, file);
    const raw = await fs.readFile(filePath, 'utf-8');
    await fs.unlink(filePath);
    results.push(JSON.parse(raw) as OutboxMessage);
  }
  return results;
}

function buildE2ePluginSource(): string {
  return `
import { promises as fs } from 'fs';
import { join } from 'path';

let handler = null;
let inboxDir = '';
let outboxDir = '';
let timer = null;
let processing = false;

async function processInbox() {
  if (processing || !inboxDir) return;
  processing = true;
  try {
    const files = await fs.readdir(inboxDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = join(inboxDir, file);
      const raw = await fs.readFile(filePath, 'utf-8');
      await fs.unlink(filePath);
      const data = JSON.parse(raw);
      if (!handler) continue;
      const msg = {
        id: data.id || \`msg-\${Date.now()}\`,
        chatId: data.chatId || data.chat_id || 'chat-e2e',
        chatType: data.chatType || data.chat_type || 'p2p',
        senderId: data.senderId || data.sender_id || 'user-e2e',
        senderName: data.senderName || data.sender_name || 'E2E User',
        content: data.content || data.text || '',
        timestamp: data.timestamp || new Date().toISOString(),
        platform: 'e2e',
        attachments: data.attachments,
        mentions: data.mentions
      };
      await handler(msg);
    }
  } catch {
    // ignore
  } finally {
    processing = false;
  }
}

async function writeOutbox(payload) {
  if (!outboxDir) return;
  await fs.mkdir(outboxDir, { recursive: true });
  const name = \`\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}.json\`;
  const filePath = join(outboxDir, name);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
  return name;
}

export default {
  name: 'e2e-channel',
  version: '1.0.0',
  async init(config) {
    inboxDir = config.inboxDir;
    outboxDir = config.outboxDir;
    await fs.mkdir(inboxDir, { recursive: true });
    await fs.mkdir(outboxDir, { recursive: true });
  },
  onMessage(h) {
    handler = h;
  },
  async start() {
    timer = setInterval(processInbox, Number(process.env.E2E_POLL_INTERVAL || '100'));
  },
  async stop() {
    if (timer) clearInterval(timer);
    timer = null;
  },
  async sendMessage(chatId, content) {
    const messageId = \`e2e-\${Date.now()}\`;
    await writeOutbox({
      type: 'message',
      chatId,
      content,
      messageId,
      timestamp: new Date().toISOString()
    });
    return { success: true, messageId };
  },
  async updateMessage(messageId, content) {
    await writeOutbox({
      type: 'update',
      messageId,
      content,
      timestamp: new Date().toISOString()
    });
  },
  async deleteMessage(messageId) {
    await writeOutbox({
      type: 'delete',
      messageId,
      timestamp: new Date().toISOString()
    });
  }
};
`;
}

describe('e2e', () => {
  const chatId = 'chat-e2e-12345678';
  const groupFolder = `private-${chatId.slice(-8)}`;
  let tempDir = '';
  let inboxDir = '';
  let outboxDir = '';
  let healthPort = 0;
  let child: ChildProcessWithoutNullStreams | null = null;
  let output = '';
  let exited = false;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'flashclaw-e2e-'));
    inboxDir = join(tempDir, 'e2e', 'inbox');
    outboxDir = join(tempDir, 'e2e', 'outbox');
    healthPort = await getAvailablePort();

    await fs.mkdir(join(tempDir, 'config'), { recursive: true });
    await fs.writeFile(
      join(tempDir, 'config', 'plugins.json'),
      JSON.stringify({ plugins: { feishu: { enabled: false } }, hotReload: false }, null, 2)
    );

    const pluginDir = join(tempDir, 'plugins', 'e2e-channel');
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        name: 'e2e-channel',
        version: '1.0.0',
        type: 'channel',
        main: 'index.ts',
        config: {
          inboxDir: { env: 'E2E_INBOX_DIR', required: true },
          outboxDir: { env: 'E2E_OUTBOX_DIR', required: true }
        }
      }, null, 2)
    );
    await fs.writeFile(join(pluginDir, 'index.ts'), buildE2ePluginSource());

    const tsxPath = require.resolve('tsx/cli');
    child = spawn(process.execPath, [tsxPath, 'src/index.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FLASHCLAW_HOME: tempDir,
        FLASHCLAW_MOCK_API: '1',
        FLASHCLAW_MOCK_RESPONSE_PREFIX: 'E2E',
        FLASHCLAW_MOCK_TOOL_MARKER: '[tool:send_message]',
        HEALTH_PORT: String(healthPort),
        E2E_INBOX_DIR: inboxDir,
        E2E_OUTBOX_DIR: outboxDir,
        LOG_LEVEL: 'error',
        BOT_NAME: 'FlashClaw',
      },
      stdio: 'pipe',
    });

    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      output += data.toString();
    });
    child.on('exit', () => {
      exited = true;
    });

    await waitFor(async () => {
      if (exited) {
        throw new Error(`Process exited early. Output:\n${output}`);
      }
      try {
        const res = await httpGet(`http://127.0.0.1:${healthPort}/health`);
        return res.statusCode === 200 ? res.body : null;
      } catch {
        return null;
      }
    }, 15000, 300);
  }, 20000);

  afterAll(async () => {
    if (child && !exited) {
      child.kill('SIGTERM');
      await waitFor(async () => (exited ? true : null), 5000, 200).catch(() => {});
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  }, 10000);

  it('responds to inbound message', async () => {
    await clearDir(outboxDir);
    await writeJsonFile(inboxDir, {
      id: 'msg-1',
      chatId,
      chatType: 'p2p',
      senderId: 'user-1',
      senderName: 'E2E User',
      content: 'hello e2e',
      timestamp: new Date().toISOString(),
    });

    const response = await waitFor(async () => {
      const messages = await readOutbox(outboxDir);
      return messages.find(m => m.type === 'message' && m.chatId === chatId) || null;
    }, 10000, 200);

    expect(response.content).toContain('FlashClaw: E2E:');
    expect(response.content).toContain('hello e2e');
  }, 15000);

  it('executes scheduled task via tool', async () => {
    await clearDir(outboxDir);
    const tasksDir = join(tempDir, 'data', 'ipc', 'main', 'tasks');
    const scheduleValue = new Date(Date.now() + 1500).toISOString();
    await writeJsonFile(tasksDir, {
      type: 'schedule_task',
      prompt: 'E2E scheduled task [tool:send_message]',
      schedule_type: 'once',
      schedule_value: scheduleValue,
      context_mode: 'isolated',
      groupFolder,
    });

    const response = await waitFor(async () => {
      const messages = await readOutbox(outboxDir);
      return messages.find(m => m.type === 'message' && m.chatId === chatId) || null;
    }, 15000, 300);

    expect(response.content).toContain('FlashClaw: E2E TOOL:');
    expect(response.content).toContain('E2E scheduled task');
  }, 20000);
});
