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
    const ts = dayjs(lineEvent.timestamp);
    const dateStr = ts.format('YYYY-MM-DD');
    const year = ts.format('YYYY');
    const timeStr = ts.format('HH:mm');
    const line = `- ${timeStr} ${text}\n`;

    // 3) Git ops ---------------------------------------------------------------
    const repoDir = '/tmp/vault';
    const remote = process.env.GIT_REPO!.replace(
      'https://',
      `https://${process.env.GH_TOKEN!}@`
    );
    
    const g = git();
    await g.clone(remote, repoDir, ['--depth', '1']);
    const repo = git(repoDir)
      .addConfig('user.name', gitUser.name)
      .addConfig('user.email', gitUser.email);

    const dirPath = `${repoDir}/01_diary/${year}`;
    const filePath = `${dirPath}/${dateStr}.md`;
    
    // Create directory if it doesn't exist
    await fs.mkdir(dirPath, { recursive: true });
    
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, '## Timeline\n');
    }
    
    await fs.appendFile(filePath, line);
    await repo.add(filePath).commit(`LINE ${dateStr} ${timeStr}`).push();
    
    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('Error processing LINE webhook:', error);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};