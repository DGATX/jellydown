import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Server as HttpServer } from 'http';

// Mock ws module with proper class constructors
vi.mock('ws', async () => {
  // Import EventEmitter inside the mock factory to avoid hoisting issues
  const { EventEmitter: EE } = await import('events');

  class MockWebSocket {
    readyState = 1; // OPEN
    send = vi.fn();
    on = vi.fn();
    close = vi.fn();
    static OPEN = 1;
    static CLOSED = 3;
  }

  class MockWebSocketServer extends EE {
    constructor(_options: any) {
      super();
    }
  }

  return {
    WebSocket: MockWebSocket,
    WebSocketServer: MockWebSocketServer
  };
});

// Mock download service
vi.mock('../../services/download.service', () => ({
  downloadService: {
    onProgress: vi.fn(),
    getProgress: vi.fn()
  }
}));

import { setupWebSocket } from '../../websocket/progress';
import { downloadService } from '../../services/download.service';
import { WebSocket, WebSocketServer } from 'ws';

describe('WebSocket Progress Handler', () => {
  let mockHttpServer: HttpServer;
  let wss: EventEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpServer = new EventEmitter() as HttpServer;
    wss = setupWebSocket(mockHttpServer) as unknown as EventEmitter;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setupWebSocket', () => {
    it('should create WebSocket server and return it', () => {
      // The setupWebSocket function creates a WebSocketServer and returns it
      // We can verify this by checking the returned object is an EventEmitter (our mock)
      expect(wss).toBeDefined();
      expect(wss).toBeInstanceOf(EventEmitter);
    });
  });

  describe('connection handling', () => {
    it('should handle new client connection', () => {
      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 1;
      mockWs.send = vi.fn();

      wss.emit('connection', mockWs);

      // Verify the client is set up (on handlers called)
      expect(mockWs.listenerCount('message')).toBeGreaterThan(0);
      expect(mockWs.listenerCount('close')).toBeGreaterThan(0);
      expect(mockWs.listenerCount('error')).toBeGreaterThan(0);
    });
  });

  describe('message handling', () => {
    it('should handle subscribe message', () => {
      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 1;
      mockWs.send = vi.fn();

      const unsubscribeFn = vi.fn();
      vi.mocked(downloadService.onProgress).mockReturnValue(unsubscribeFn);
      vi.mocked(downloadService.getProgress).mockReturnValue({
        sessionId: 'session-123',
        status: 'transcoding',
        progress: 50
      } as any);

      wss.emit('connection', mockWs);

      // Send subscribe message
      mockWs.emit('message', Buffer.from(JSON.stringify({
        type: 'subscribe',
        sessionId: 'session-123'
      })));

      expect(downloadService.onProgress).toHaveBeenCalledWith(
        'session-123',
        expect.any(Function)
      );

      // Should send current progress immediately
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('session-123')
      );
    });

    it('should handle unsubscribe message', () => {
      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 1;
      mockWs.send = vi.fn();

      const unsubscribeFn = vi.fn();
      vi.mocked(downloadService.onProgress).mockReturnValue(unsubscribeFn);
      vi.mocked(downloadService.getProgress).mockReturnValue(undefined);

      wss.emit('connection', mockWs);

      // Subscribe first
      mockWs.emit('message', Buffer.from(JSON.stringify({
        type: 'subscribe',
        sessionId: 'session-123'
      })));

      // Then unsubscribe
      mockWs.emit('message', Buffer.from(JSON.stringify({
        type: 'unsubscribe',
        sessionId: 'session-123'
      })));

      expect(unsubscribeFn).toHaveBeenCalled();
    });

    it('should handle ping message with pong response', () => {
      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 1;
      mockWs.send = vi.fn();

      wss.emit('connection', mockWs);

      mockWs.emit('message', Buffer.from(JSON.stringify({
        type: 'ping'
      })));

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'pong' })
      );
    });

    it('should ignore invalid JSON messages', () => {
      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 1;
      mockWs.send = vi.fn();

      wss.emit('connection', mockWs);

      // Should not throw
      mockWs.emit('message', Buffer.from('invalid json {'));

      // No response sent
      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('should not subscribe twice to same session', () => {
      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 1;
      mockWs.send = vi.fn();

      const unsubscribeFn = vi.fn();
      vi.mocked(downloadService.onProgress).mockReturnValue(unsubscribeFn);
      vi.mocked(downloadService.getProgress).mockReturnValue(undefined);

      wss.emit('connection', mockWs);

      // Subscribe twice
      mockWs.emit('message', Buffer.from(JSON.stringify({
        type: 'subscribe',
        sessionId: 'session-123'
      })));
      mockWs.emit('message', Buffer.from(JSON.stringify({
        type: 'subscribe',
        sessionId: 'session-123'
      })));

      // onProgress should only be called once
      expect(downloadService.onProgress).toHaveBeenCalledTimes(1);
    });

    it('should handle subscribe without sessionId gracefully', () => {
      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 1;
      mockWs.send = vi.fn();

      wss.emit('connection', mockWs);

      // Should not throw
      mockWs.emit('message', Buffer.from(JSON.stringify({
        type: 'subscribe'
      })));

      expect(downloadService.onProgress).not.toHaveBeenCalled();
    });
  });

  describe('progress broadcasting', () => {
    it('should send progress updates to subscribed clients', () => {
      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 1;
      mockWs.send = vi.fn();

      let progressCallback: ((progress: any) => void) | undefined;
      vi.mocked(downloadService.onProgress).mockImplementation((sessionId, cb) => {
        progressCallback = cb;
        return vi.fn();
      });
      vi.mocked(downloadService.getProgress).mockReturnValue(undefined);

      wss.emit('connection', mockWs);

      mockWs.emit('message', Buffer.from(JSON.stringify({
        type: 'subscribe',
        sessionId: 'session-123'
      })));

      // Simulate progress update
      progressCallback?.({
        sessionId: 'session-123',
        status: 'transcoding',
        progress: 75
      });

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"progress":75')
      );
    });

    it('should not send to closed connections', () => {
      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 3; // CLOSED
      mockWs.send = vi.fn();

      let progressCallback: ((progress: any) => void) | undefined;
      vi.mocked(downloadService.onProgress).mockImplementation((sessionId, cb) => {
        progressCallback = cb;
        return vi.fn();
      });
      vi.mocked(downloadService.getProgress).mockReturnValue(undefined);

      wss.emit('connection', mockWs);

      mockWs.emit('message', Buffer.from(JSON.stringify({
        type: 'subscribe',
        sessionId: 'session-123'
      })));

      // Change state to closed
      mockWs.readyState = 3;

      // Simulate progress update
      progressCallback?.({
        sessionId: 'session-123',
        status: 'transcoding',
        progress: 75
      });

      // Send should not be called because connection is closed
      // Note: The first call might have happened before state change
      const sendCalls = (mockWs.send as any).mock.calls.filter(
        (call: any[]) => call[0].includes('"progress":75')
      );
      expect(sendCalls).toHaveLength(0);
    });
  });

  describe('disconnection handling', () => {
    it('should unsubscribe from all sessions on close', () => {
      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 1;
      mockWs.send = vi.fn();

      const unsubscribeFn = vi.fn();
      vi.mocked(downloadService.onProgress).mockReturnValue(unsubscribeFn);
      vi.mocked(downloadService.getProgress).mockReturnValue(undefined);

      wss.emit('connection', mockWs);

      // Subscribe to multiple sessions
      mockWs.emit('message', Buffer.from(JSON.stringify({
        type: 'subscribe',
        sessionId: 'session-1'
      })));
      mockWs.emit('message', Buffer.from(JSON.stringify({
        type: 'subscribe',
        sessionId: 'session-2'
      })));

      // Close connection
      mockWs.emit('close');

      expect(unsubscribeFn).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe from all sessions on error', () => {
      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 1;
      mockWs.send = vi.fn();

      const unsubscribeFn = vi.fn();
      vi.mocked(downloadService.onProgress).mockReturnValue(unsubscribeFn);
      vi.mocked(downloadService.getProgress).mockReturnValue(undefined);

      wss.emit('connection', mockWs);

      mockWs.emit('message', Buffer.from(JSON.stringify({
        type: 'subscribe',
        sessionId: 'session-123'
      })));

      // Error event
      mockWs.emit('error', new Error('Connection error'));

      expect(unsubscribeFn).toHaveBeenCalled();
    });
  });

  describe('current progress on subscribe', () => {
    it('should send current progress when subscribing to active download', () => {
      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 1;
      mockWs.send = vi.fn();

      vi.mocked(downloadService.onProgress).mockReturnValue(vi.fn());
      vi.mocked(downloadService.getProgress).mockReturnValue({
        sessionId: 'session-123',
        status: 'transcoding',
        progress: 42,
        completedSegments: 21,
        totalSegments: 50
      } as any);

      wss.emit('connection', mockWs);

      mockWs.emit('message', Buffer.from(JSON.stringify({
        type: 'subscribe',
        sessionId: 'session-123'
      })));

      // Should send current progress immediately
      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentData.type).toBe('progress');
      expect(sentData.progress).toBe(42);
      expect(sentData.completedSegments).toBe(21);
    });

    it('should not send anything when no current progress', () => {
      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 1;
      mockWs.send = vi.fn();

      vi.mocked(downloadService.onProgress).mockReturnValue(vi.fn());
      vi.mocked(downloadService.getProgress).mockReturnValue(undefined);

      wss.emit('connection', mockWs);

      mockWs.emit('message', Buffer.from(JSON.stringify({
        type: 'subscribe',
        sessionId: 'session-123'
      })));

      // Should not send anything
      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });
});
