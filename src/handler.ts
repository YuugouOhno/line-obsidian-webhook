import crypto from 'crypto';
import git from 'simple-git';
import fs from 'fs/promises';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

dayjs.extend(timezone);
dayjs.tz.setDefault(process.env.TZ);

interface LineEvent {
  type: string;
  timestamp: number;
  replyToken?: string;
  source?: {
    userId?: string;
  };
  message?: {
    id: string;
    type: string;
    text: string;
  };
}

interface LineWebhookBody {
  events: LineEvent[];
}

const gitUser = { name: 'LINE Bot', email: 'bot@example.com' };

const processGitOperations = async (text: string, timestamp: number, messageId?: string): Promise<void> => {
  console.log('Starting Git operations...');
  
  // Add random delay to reduce concurrent conflicts (more aggressive)
  const delay = Math.random() * 5000 + 1000; // 1-6 seconds
  await new Promise(resolve => setTimeout(resolve, delay));
  console.log(`Applied delay: ${delay.toFixed(0)}ms`);
  
  const ts = dayjs(timestamp);
  const dateStr = ts.format('YYYY-MM-DD');
  const year = ts.format('YYYY');
  const timeStr = ts.format('HH:mm');
  
  console.log(`Processing for date: ${dateStr}, time: ${timeStr}`);
  
  // Parse time-separated entries (e.g., "13:13 content - 13:46 more content")
  const timePattern = /(\d{1,2}:\d{2})\s+([^-]+?)(?=\s+-\s+\d{1,2}:\d{2}|$)/g;
  const matches = [...text.matchAll(timePattern)];
  
  let line = '';
  if (matches.length > 1) {
    // Multiple time entries in one message
    console.log(`Found ${matches.length} time entries`);
    for (const match of matches) {
      const [, time, content] = match;
      if (time && content) {
        line += `- ${time} ${content.trim()}\n`;
      }
    }
  } else {
    // Single entry with current timestamp
    line = `- ${timeStr} ${text}\n`;
    console.log('Single entry created');
  }

  console.log('Content to write:', line);

  // Git operations
  const repoDir = `/tmp/vault-${Date.now()}`;
  const remote = process.env.GIT_REPO!.replace(
    'https://',
    `https://${process.env.GH_TOKEN!}@`
  );
  
  console.log('Starting Git clone...');
  const g = git();
  await g.clone(remote, repoDir, ['--depth', '1']);
  console.log('Git clone completed');
  
  const repo = git(repoDir)
    .addConfig('user.name', gitUser.name)
    .addConfig('user.email', gitUser.email);

  const dirPath = `${repoDir}/01_diary/${year}`;
  const filePath = `${dirPath}/${dateStr}.md`;
  
  console.log(`Target file: ${filePath}`);
  
  // Create directory if it doesn't exist
  await fs.mkdir(dirPath, { recursive: true });
  console.log('Directory created/verified');
  
  try {
    await fs.access(filePath);
    console.log('File exists, reading content...');
    // Check for duplicate entries before adding
    const existingContent = await fs.readFile(filePath, 'utf-8');
    
    // Check for duplicate entries (by content or message ID)
    if (existingContent.includes(line.trim())) {
      console.log('Duplicate entry detected by content, skipping:', line.trim());
      return; // Skip duplicate
    }
    
    if (messageId && existingContent.includes(`<!-- MSG:${messageId} -->`)) {
      console.log('Duplicate entry detected by message ID, skipping:', messageId);
      return; // Skip duplicate
    }
    
    if (existingContent.trim() && !existingContent.endsWith('\n')) {
      await fs.appendFile(filePath, '\n');
      console.log('Added newline to existing file');
    }
  } catch {
    console.log('File does not exist, creating new file...');
    await fs.writeFile(filePath, '## Timeline\n');
  }
  
  console.log('Appending content to file...');
  // Add message ID as hidden comment for duplicate detection
  const finalContent = messageId ? `${line}<!-- MSG:${messageId} -->\n` : line;
  await fs.appendFile(filePath, finalContent);
  
  console.log('Starting Git commit and push...');
  await repo.add(filePath).commit(`LINE ${dateStr} ${timeStr}`);
  
  // Retry push with pull if conflict occurs (multiple attempts)
  let pushAttempts = 0;
  const maxAttempts = 3;
  
  while (pushAttempts < maxAttempts) {
    try {
      await repo.push();
      console.log('Git push completed successfully');
      break;
    } catch (pushError: any) {
      pushAttempts++;
      console.log(`Push attempt ${pushAttempts} failed:`, pushError.message);
      
      if (pushAttempts >= maxAttempts) {
        console.error('Git push failed after all retries');
        throw pushError;
      }
      
      // Wait and pull before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * pushAttempts));
      try {
        await repo.pull();
        console.log(`Pulled latest changes, retrying push (attempt ${pushAttempts + 1})`);
      } catch (pullError: any) {
        console.log('Pull failed, but continuing with push retry:', pullError.message);
      }
    }
  }
  console.log('Git operations completed successfully');
};

export const main = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // 1) Signature verify -------------------------------------------------------
    const signature = event.headers['x-line-signature'];
    const body = event.body;
    
    if (!signature || !body) {
      return { statusCode: 400, body: 'Missing signature or body' };
    }

    const hash = crypto
      .createHmac('SHA256', process.env.CHANNEL_SECRET!)
      .update(body)
      .digest('base64');
    
    if (hash !== signature) {
      return { statusCode: 401, body: 'Bad Signature' };
    }

    // 2) Parse LINE event -------------------------------------------------------
    const webhookBody: LineWebhookBody = JSON.parse(body);
    const lineEvent = webhookBody.events[0];
    
    if (!lineEvent || lineEvent.type !== 'message' || lineEvent.message?.type !== 'text') {
      return { statusCode: 200, body: 'Ignore non-text' };
    }
    
    const text = lineEvent.message.text.trim();
    const messageId = lineEvent.message.id;
    
    // 3) Process Git operations synchronously for now to ensure execution
    console.log('Processing message:', text, 'ID:', messageId);
    await processGitOperations(text, lineEvent.timestamp, messageId);
    
    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('Error processing LINE webhook:', error);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};