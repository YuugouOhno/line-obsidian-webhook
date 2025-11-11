import crypto from 'crypto';
import git from 'simple-git';
import fs from 'fs/promises';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

dayjs.extend(timezone);
dayjs.tz.setDefault(process.env.TZ);

interface LineMessage {
  id: string;
  type: string;
  text: string;
}

interface LineEvent {
  type: string;
  timestamp: number;
  replyToken?: string;
  source?: {
    userId?: string;
  };
  message?: LineMessage;
}

interface LineWebhookBody {
  events: LineEvent[];
}

type GitOperationError = Error & {
  code?: string;
};

interface ProcessingResult {
  success: boolean;
  message: string;
}

const gitUser = { name: 'LINE Bot', email: 'bot@example.com' };

const RETRY_DELAY_MS = 1000;
const MAX_PUSH_ATTEMPTS = 3;
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 6000;

const createRandomDelay = () => Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS) + MIN_DELAY_MS;

const setupGitRepository = async (timestamp: number): Promise<{ repo: any; dirPath: string; filePath: string }> => {
  const repoDir = `/tmp/vault-${Date.now()}`;
  const remote = process.env.GIT_REPO!.replace(
    'https://',
    `https://${process.env.GH_TOKEN!}@`
  );

  const g = git();
  await g.clone(remote, repoDir, ['--depth', '1']);

  const repo = git(repoDir)
    .addConfig('user.name', gitUser.name)
    .addConfig('user.email', gitUser.email);

  const dirPath = `${repoDir}/02_notes/projects`;
  const filePath = `${dirPath}/project_LINE.md`;

  await fs.mkdir(dirPath, { recursive: true });

  return { repo, dirPath, filePath };
};

const writeMessageToFile = async (filePath: string, text: string, dateStr: string): Promise<boolean> => {
  const line = `- ${text}`;

  try {
    await fs.access(filePath);
    const existingContent = await fs.readFile(filePath, 'utf-8');

    // Check for duplicates
    if (existingContent.includes(line)) {
      return true; // isDuplicate
    }

    // Check if today's date exists in the file
    const lines = existingContent.split('\n');
    const dateIndex = lines.findIndex(l => l.trim() === dateStr);

    let newContent: string;
    if (dateIndex !== -1) {
      // Date found: insert right after the date
      lines.splice(dateIndex + 1, 0, line);
      newContent = lines.join('\n');
    } else {
      // Date not found: prepend to the beginning of the file
      newContent = `${dateStr}\n${line}\n\n${existingContent}`;
    }

    await fs.writeFile(filePath, newContent);
    return false; // not duplicate
  } catch {
    // File doesn't exist: create new file
    await fs.writeFile(filePath, `${dateStr}\n${line}\n`);
    return false; // not duplicate
  }
};

const pushWithRetry = async (repo: any): Promise<void> => {
  let pushAttempts = 0;
  
  while (pushAttempts < MAX_PUSH_ATTEMPTS) {
    try {
      await repo.push();
      break;
    } catch (pushError: any) {
      pushAttempts++;
      
      if (pushAttempts >= MAX_PUSH_ATTEMPTS) {
        throw pushError;
      }
      
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * pushAttempts));
      try {
        await repo.pull();
      } catch (pullError: any) {
        // Continue with push retry even if pull fails
      }
    }
  }
};

const processGitOperations = async (text: string, timestamp: number): Promise<void> => {
  const delay = createRandomDelay();
  await new Promise(resolve => setTimeout(resolve, delay));

  const ts = dayjs(timestamp);
  const dateStr = ts.format('YYYY-MM-DD');

  const { repo, filePath } = await setupGitRepository(timestamp);

  const isDuplicate = await writeMessageToFile(filePath, text, dateStr);
  if (isDuplicate) {
    return;
  }

  await repo.add(filePath).commit(`LINE ${dateStr}`);
  await pushWithRetry(repo);
};

export const main = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // 1) Signature verification
    const signature = event.headers['x-line-signature'];
    const body = event.body;
    
    if (!signature || !body) {
      return { statusCode: 400, body: 'Missing required headers or body' };
    }

    const hash = crypto
      .createHmac('SHA256', process.env.CHANNEL_SECRET!)
      .update(body)
      .digest('base64');
    
    if (hash !== signature) {
      return { statusCode: 401, body: 'Invalid signature' };
    }

    // 2) Parse and validate LINE event
    const webhookBody: LineWebhookBody = JSON.parse(body);
    const lineEvent = webhookBody.events[0];
    
    if (!lineEvent || lineEvent.type !== 'message' || lineEvent.message?.type !== 'text') {
      return { statusCode: 200, body: 'Event ignored - not a text message' };
    }
    
    const text = lineEvent.message.text.trim();
    
    // 3) Process Git operations
    await processGitOperations(text, lineEvent.timestamp);
    
    return { statusCode: 200, body: 'Message processed successfully' };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('LINE webhook processing failed:', errorMessage);
    return { statusCode: 500, body: 'Failed to process webhook' };
  }
};