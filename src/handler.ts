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
  message?: {
    type: string;
    text: string;
  };
}

interface LineWebhookBody {
  events: LineEvent[];
}

const gitUser = { name: 'LINE Bot', email: 'bot@example.com' };

const processGitOperations = async (text: string, timestamp: number): Promise<void> => {
  console.log('Starting Git operations...');
  
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
    // Add a newline before new entries if file exists and has content
    const existingContent = await fs.readFile(filePath, 'utf-8');
    if (existingContent.trim() && !existingContent.endsWith('\n')) {
      await fs.appendFile(filePath, '\n');
      console.log('Added newline to existing file');
    }
  } catch {
    console.log('File does not exist, creating new file...');
    await fs.writeFile(filePath, '## Timeline\n');
  }
  
  console.log('Appending content to file...');
  await fs.appendFile(filePath, line);
  
  console.log('Starting Git commit and push...');
  await repo.add(filePath).commit(`LINE ${dateStr} ${timeStr}`);
  
  // Retry push with pull if conflict occurs
  try {
    await repo.push();
    console.log('Git push completed successfully');
  } catch (pushError: any) {
    console.log('Push failed, attempting pull and retry...', pushError.message);
    try {
      await repo.pull();
      await repo.push();
      console.log('Git push completed after pull');
    } catch (retryError: any) {
      console.error('Git push failed after retry:', retryError.message);
      throw retryError;
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
    
    // 3) Process Git operations synchronously for now to ensure execution
    console.log('Processing message:', text);
    await processGitOperations(text, lineEvent.timestamp);
    
    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('Error processing LINE webhook:', error);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};