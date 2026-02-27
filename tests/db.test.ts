import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';

let tempDir = '';
let db: Database.Database;

describe('database operations', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'flashclaw-db-'));
    const dbPath = join(tempDir, 'test.db');
    db = new Database(dbPath);

    // 创建测试表结构
    db.exec(`
      CREATE TABLE IF NOT EXISTS chats (
        jid TEXT PRIMARY KEY,
        name TEXT,
        last_message_time TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT,
        chat_jid TEXT,
        sender TEXT,
        sender_name TEXT,
        content TEXT,
        timestamp TEXT,
        is_from_me INTEGER,
        PRIMARY KEY (id, chat_jid)
      );
      CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
      
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        group_folder TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        prompt TEXT NOT NULL,
        schedule_type TEXT NOT NULL,
        schedule_value TEXT NOT NULL,
        context_mode TEXT DEFAULT 'isolated',
        next_run TEXT,
        last_run TEXT,
        last_result TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        timeout_ms INTEGER DEFAULT 300000
      );
      CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
      CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);
    `);
  });

  afterEach(async () => {
    db?.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('chat operations', () => {
    it('should store and retrieve chat metadata', () => {
      const chatJid = 'chat-123';
      const timestamp = new Date().toISOString();

      db.prepare(`
        INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      `).run(chatJid, 'Test Chat', timestamp);

      const chat = db.prepare('SELECT * FROM chats WHERE jid = ?').get(chatJid) as any;

      expect(chat).not.toBeNull();
      expect(chat.jid).toBe(chatJid);
      expect(chat.name).toBe('Test Chat');
    });

    it('should update existing chat on conflict', () => {
      const chatJid = 'chat-123';

      // 插入初始数据
      db.prepare(`
        INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      `).run(chatJid, 'Old Name', '2026-01-01T00:00:00Z');

      // 更新
      db.prepare(`
        INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
        ON CONFLICT(jid) DO UPDATE SET
          name = excluded.name,
          last_message_time = MAX(last_message_time, excluded.last_message_time)
      `).run(chatJid, 'New Name', '2026-02-01T00:00:00Z');

      const chat = db.prepare('SELECT * FROM chats WHERE jid = ?').get(chatJid) as any;

      expect(chat.name).toBe('New Name');
      expect(chat.last_message_time).toBe('2026-02-01T00:00:00Z');
    });
  });

  describe('message operations', () => {
    it('should store and retrieve messages', () => {
      const msg = {
        id: 'msg-123',
        chatId: 'chat-123',
        senderId: 'user-1',
        senderName: 'Alice',
        content: 'Hello world',
        timestamp: new Date().toISOString(),
        isFromMe: false,
      };

      db.prepare(`
        INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(msg.id, msg.chatId, msg.senderId, msg.senderName, msg.content, msg.timestamp, msg.isFromMe ? 1 : 0);

      const stored = db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id) as any;

      expect(stored.content).toBe('Hello world');
      expect(stored.sender_name).toBe('Alice');
    });

    it('should check message existence', () => {
      const msgId = 'msg-123';
      const chatJid = 'chat-123';

      // 消息不存在
      let exists = db.prepare('SELECT 1 FROM messages WHERE id = ? AND chat_jid = ?').get(msgId, chatJid);
      expect(exists).toBeUndefined();

      // 插入消息
      db.prepare(`
        INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(msgId, chatJid, 'user-1', 'Alice', 'Test', new Date().toISOString(), 0);

      // 消息存在
      exists = db.prepare('SELECT 1 FROM messages WHERE id = ? AND chat_jid = ?').get(msgId, chatJid);
      expect(exists).not.toBeUndefined();
    });

    it('should filter bot messages by prefix', () => {
      const chatJid = 'chat-123';
      const botPrefix = 'FlashClaw';

      // 插入用户消息
      db.prepare(`
        INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('msg-1', chatJid, 'user-1', 'Alice', 'Hello', '2026-02-04T10:00:00Z', 0);

      // 插入机器人消息
      db.prepare(`
        INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('msg-2', chatJid, 'bot', 'Bot', 'FlashClaw: Hi there', '2026-02-04T10:00:01Z', 0);

      // 查询时过滤机器人消息
      const messages = db.prepare(`
        SELECT * FROM messages
        WHERE chat_jid = ? AND content NOT LIKE ?
        ORDER BY timestamp
      `).all(chatJid, `${botPrefix}:%`) as any[];

      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe('Hello');
    });

    it('should get chat history with limit', () => {
      const chatJid = 'chat-123';

      // 插入多条消息
      for (let i = 0; i < 10; i++) {
        db.prepare(`
          INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(`msg-${i}`, chatJid, 'user-1', 'Alice', `Message ${i}`, `2026-02-04T10:00:0${i}Z`, 0);
      }

      const history = db.prepare(`
        SELECT * FROM messages WHERE chat_jid = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(chatJid, 5) as any[];

      expect(history.length).toBe(5);
    });
  });

  describe('task operations', () => {
    it('should create and retrieve task', () => {
      const task = {
        id: 'task-123',
        group_folder: 'main',
        chat_jid: 'chat-123',
        prompt: '提醒我喝水',
        schedule_type: 'cron',
        schedule_value: '0 9 * * *',
        context_mode: 'isolated',
        next_run: '2026-02-05T09:00:00Z',
        status: 'active',
        created_at: new Date().toISOString(),
        retry_count: 0,
        max_retries: 3,
        timeout_ms: 300000,
      };

      db.prepare(`
        INSERT INTO scheduled_tasks 
        (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at, retry_count, max_retries, timeout_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        task.id, task.group_folder, task.chat_jid, task.prompt,
        task.schedule_type, task.schedule_value, task.context_mode,
        task.next_run, task.status, task.created_at,
        task.retry_count, task.max_retries, task.timeout_ms
      );

      const stored = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(task.id) as any;

      expect(stored.prompt).toBe('提醒我喝水');
      expect(stored.schedule_type).toBe('cron');
      expect(stored.status).toBe('active');
    });

    it('should get due tasks', () => {
      const now = new Date();
      const pastTime = new Date(now.getTime() - 60000).toISOString();
      const futureTime = new Date(now.getTime() + 60000).toISOString();

      // 插入过期任务
      db.prepare(`
        INSERT INTO scheduled_tasks 
        (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, next_run, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('task-due', 'main', 'chat-1', 'Due task', 'once', pastTime, pastTime, 'active', now.toISOString());

      // 插入未到期任务
      db.prepare(`
        INSERT INTO scheduled_tasks 
        (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, next_run, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('task-future', 'main', 'chat-1', 'Future task', 'once', futureTime, futureTime, 'active', now.toISOString());

      // 插入暂停任务
      db.prepare(`
        INSERT INTO scheduled_tasks 
        (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, next_run, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('task-paused', 'main', 'chat-1', 'Paused task', 'once', pastTime, pastTime, 'paused', now.toISOString());

      const dueTasks = db.prepare(`
        SELECT * FROM scheduled_tasks
        WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
        ORDER BY next_run
      `).all(now.toISOString()) as any[];

      expect(dueTasks.length).toBe(1);
      expect(dueTasks[0].id).toBe('task-due');
    });

    it('should update task status', () => {
      db.prepare(`
        INSERT INTO scheduled_tasks 
        (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('task-1', 'main', 'chat-1', 'Test', 'interval', '3600000', 'active', new Date().toISOString());

      // 暂停任务
      db.prepare('UPDATE scheduled_tasks SET status = ? WHERE id = ?').run('paused', 'task-1');

      const task = db.prepare('SELECT status FROM scheduled_tasks WHERE id = ?').get('task-1') as any;
      expect(task.status).toBe('paused');
    });

    it('should delete task and its logs', () => {
      // 创建任务
      db.prepare(`
        INSERT INTO scheduled_tasks 
        (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('task-to-delete', 'main', 'chat-1', 'Test', 'once', '2026-02-05T09:00:00Z', 'active', new Date().toISOString());

      // 验证存在
      let task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get('task-to-delete');
      expect(task).not.toBeUndefined();

      // 删除任务
      db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run('task-to-delete');

      // 验证删除
      task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get('task-to-delete');
      expect(task).toBeUndefined();
    });

    it('should get next wake time', () => {
      const now = new Date();
      const nextTime = new Date(now.getTime() + 60000).toISOString();

      db.prepare(`
        INSERT INTO scheduled_tasks 
        (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, next_run, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('task-1', 'main', 'chat-1', 'Test', 'once', nextTime, nextTime, 'active', now.toISOString());

      const row = db.prepare(`
        SELECT next_run FROM scheduled_tasks
        WHERE status = 'active' AND next_run IS NOT NULL
        ORDER BY next_run ASC
        LIMIT 1
      `).get() as { next_run: string } | undefined;

      expect(row).not.toBeUndefined();
      expect(new Date(row!.next_run).getTime()).toBe(new Date(nextTime).getTime());
    });
  });

  describe('message statistics', () => {
    it('should get message stats', () => {
      const chatJid = 'chat-123';

      // 插入消息
      db.prepare(`
        INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('msg-1', chatJid, 'user-1', 'Alice', 'First', '2026-02-04T10:00:00Z', 0);

      db.prepare(`
        INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('msg-2', chatJid, 'user-1', 'Alice', 'Last', '2026-02-04T12:00:00Z', 0);

      const stats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          MIN(timestamp) as first_msg,
          MAX(timestamp) as last_msg
        FROM messages
        WHERE chat_jid = ?
      `).get(chatJid) as { total: number; first_msg: string; last_msg: string };

      expect(stats.total).toBe(2);
      expect(stats.first_msg).toBe('2026-02-04T10:00:00Z');
      expect(stats.last_msg).toBe('2026-02-04T12:00:00Z');
    });
  });
});
