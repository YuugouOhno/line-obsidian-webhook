import { main } from '../src/handler';

// Add a small delay to allow async operations to complete in tests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
import { APIGatewayProxyEvent } from 'aws-lambda';
import crypto from 'crypto';
import fs from 'fs/promises';
import git from 'simple-git';

// Mock dependencies
jest.mock('fs/promises');
jest.mock('simple-git');
jest.mock('dayjs', () => {
  const mockDayjs = jest.fn(() => ({
    format: jest.fn((format: string) => {
      if (format === 'YYYY-MM-DD') return '2025-06-25';
      if (format === 'YYYY') return '2025';
      if (format === 'HH:mm') return '14:30';
      return '';
    }),
  }));
  (mockDayjs as any).extend = jest.fn();
  (mockDayjs as any).tz = { setDefault: jest.fn() };
  return mockDayjs;
});

const mockFs = fs as jest.Mocked<typeof fs>;
const mockGit = git as jest.MockedFunction<typeof git>;

describe('LINE Webhook Handler', () => {
  const mockRepo = {
    addConfig: jest.fn().mockReturnThis(),
    add: jest.fn().mockReturnThis(),
    commit: jest.fn().mockReturnThis(),
    push: jest.fn().mockResolvedValue(undefined),
  };

  const mockGitInstance = {
    clone: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Environment variables
    process.env.CHANNEL_SECRET = 'test-channel-secret';
    process.env.GIT_REPO = 'https://github.com/test/repo.git';
    process.env.GH_TOKEN = 'test-token';
    process.env.TZ = 'Asia/Tokyo';

    // Mock git
    mockGit.mockReturnValueOnce(mockGitInstance as any);
    mockGit.mockReturnValueOnce(mockRepo as any);

    // Mock fs
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.access.mockRejectedValue(new Error('File not found'));
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.appendFile.mockResolvedValue(undefined);
    mockFs.readFile.mockResolvedValue('## Timeline\n');
  });

  const createMockEvent = (body: string, signature?: string): APIGatewayProxyEvent => {
    const actualSignature = signature || crypto
      .createHmac('SHA256', 'test-channel-secret')
      .update(body)
      .digest('base64');

    return {
      body,
      headers: {
        'x-line-signature': actualSignature,
      },
      httpMethod: 'POST',
      isBase64Encoded: false,
      path: '/webhook',
      pathParameters: null,
      queryStringParameters: null,
      stageVariables: null,
      requestContext: {} as any,
      resource: '',
      multiValueHeaders: {},
      multiValueQueryStringParameters: null,
    };
  };

  describe('Success Cases', () => {
    test('should process valid LINE text message', async () => {
      const lineWebhookBody = {
        events: [{
          type: 'message',
          timestamp: 1640995200000, // 2022-01-01 00:00:00 UTC
          message: {
            type: 'text',
            text: 'Hello World',
          },
        }],
      };

      const event = createMockEvent(JSON.stringify(lineWebhookBody));
      const result = await main(event);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('OK');

      // Wait for async operations to complete
      await delay(50);

      // Verify git operations
      expect(mockGitInstance.clone).toHaveBeenCalledWith(
        'https://test-token@github.com/test/repo.git',
        '/tmp/vault',
        ['--depth', '1']
      );

      // Verify file operations
      expect(mockFs.mkdir).toHaveBeenCalledWith('/tmp/vault/01_diary/2025', { recursive: true });
      expect(mockFs.writeFile).toHaveBeenCalledWith('/tmp/vault/01_diary/2025/2025-06-25.md', '## Timeline\n');
      expect(mockFs.appendFile).toHaveBeenCalledWith('/tmp/vault/01_diary/2025/2025-06-25.md', '- 14:30 Hello World\n');

      // Verify git commit
      expect(mockRepo.add).toHaveBeenCalledWith('/tmp/vault/01_diary/2025/2025-06-25.md');
      expect(mockRepo.commit).toHaveBeenCalledWith('LINE 2025-06-25 14:30');
      expect(mockRepo.push).toHaveBeenCalled();
    });

    test('should append to existing diary file', async () => {
      mockFs.access.mockResolvedValueOnce(undefined); // File exists
      mockFs.readFile.mockResolvedValueOnce('## Timeline\n- 10:00 Previous message'); // Existing content

      const lineWebhookBody = {
        events: [{
          type: 'message',
          timestamp: 1640995200000,
          message: {
            type: 'text',
            text: 'Second message',
          },
        }],
      };

      const event = createMockEvent(JSON.stringify(lineWebhookBody));
      const result = await main(event);

      expect(result.statusCode).toBe(200);
      expect(mockFs.writeFile).not.toHaveBeenCalled(); // Should not create new file
      expect(mockFs.readFile).toHaveBeenCalledWith('/tmp/vault/01_diary/2025/2025-06-25.md', 'utf-8');
      expect(mockFs.appendFile).toHaveBeenCalledWith('/tmp/vault/01_diary/2025/2025-06-25.md', '\n'); // Add newline first
      expect(mockFs.appendFile).toHaveBeenCalledWith('/tmp/vault/01_diary/2025/2025-06-25.md', '- 14:30 Second message\n');
    });
  });

  describe('Error Cases', () => {
    test('should reject invalid signature', async () => {
      const lineWebhookBody = { events: [] };
      const event = createMockEvent(JSON.stringify(lineWebhookBody), 'invalid-signature');

      const result = await main(event);

      expect(result.statusCode).toBe(401);
      expect(result.body).toBe('Bad Signature');
    });

    test('should reject missing signature', async () => {
      const event = createMockEvent('{}');
      delete event.headers['x-line-signature'];

      const result = await main(event);

      expect(result.statusCode).toBe(400);
      expect(result.body).toBe('Missing signature or body');
    });

    test('should reject missing body', async () => {
      const event = createMockEvent('{}');
      event.body = null;

      const result = await main(event);

      expect(result.statusCode).toBe(400);
      expect(result.body).toBe('Missing signature or body');
    });

    test('should ignore non-text messages', async () => {
      const lineWebhookBody = {
        events: [{
          type: 'message',
          timestamp: 1640995200000,
          message: {
            type: 'image',
          },
        }],
      };

      const event = createMockEvent(JSON.stringify(lineWebhookBody));
      const result = await main(event);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Ignore non-text');
      expect(mockGitInstance.clone).not.toHaveBeenCalled();
    });

    test('should ignore non-message events', async () => {
      const lineWebhookBody = {
        events: [{
          type: 'follow',
          timestamp: 1640995200000,
        }],
      };

      const event = createMockEvent(JSON.stringify(lineWebhookBody));
      const result = await main(event);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Ignore non-text');
      expect(mockGitInstance.clone).not.toHaveBeenCalled();
    });

    test('should handle git operation errors', async () => {
      mockGitInstance.clone.mockRejectedValueOnce(new Error('Git clone failed'));

      const lineWebhookBody = {
        events: [{
          type: 'message',
          timestamp: 1640995200000,
          message: {
            type: 'text',
            text: 'Hello World',
          },
        }],
      };

      const event = createMockEvent(JSON.stringify(lineWebhookBody));
      const result = await main(event);

      expect(result.statusCode).toBe(500);
      expect(result.body).toBe('Internal Server Error');
    });

    test('should handle file system errors', async () => {
      mockFs.mkdir.mockRejectedValueOnce(new Error('Permission denied'));

      const lineWebhookBody = {
        events: [{
          type: 'message',
          timestamp: 1640995200000,
          message: {
            type: 'text',
            text: 'Hello World',
          },
        }],
      };

      const event = createMockEvent(JSON.stringify(lineWebhookBody));
      const result = await main(event);

      expect(result.statusCode).toBe(500);
      expect(result.body).toBe('Internal Server Error');
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty events array', async () => {
      const lineWebhookBody = { events: [] };
      const event = createMockEvent(JSON.stringify(lineWebhookBody));

      const result = await main(event);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('Ignore non-text');
    });

    test('should handle messages with leading/trailing whitespace', async () => {
      const lineWebhookBody = {
        events: [{
          type: 'message',
          timestamp: 1640995200000,
          message: {
            type: 'text',
            text: '  Hello World  ',
          },
        }],
      };

      const event = createMockEvent(JSON.stringify(lineWebhookBody));
      const result = await main(event);

      expect(result.statusCode).toBe(200);
      expect(mockFs.appendFile).toHaveBeenCalledWith('/tmp/vault/01_diary/2025/2025-06-25.md', '- 14:30 Hello World\n');
    });

    test('should parse multiple time entries in one message', async () => {
      const lineWebhookBody = {
        events: [{
          type: 'message',
          timestamp: 1640995200000,
          message: {
            type: 'text',
            text: '13:13 notebooklmを使いたい - 13:46 てすと、！！！',
          },
        }],
      };

      const event = createMockEvent(JSON.stringify(lineWebhookBody));
      const result = await main(event);

      expect(result.statusCode).toBe(200);
      expect(mockFs.appendFile).toHaveBeenCalledWith('/tmp/vault/01_diary/2025/2025-06-25.md', '- 13:13 notebooklmを使いたい\n- 13:46 てすと、！！！\n');
    });
  });
});