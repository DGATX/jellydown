import { WebSocket, WebSocketServer } from 'ws';
import { Server } from 'http';
import { downloadService } from '../services/download.service';
import { DownloadProgress } from '../models/types';

interface ClientConnection {
  ws: WebSocket;
  subscriptions: Map<string, () => void>; // sessionId -> unsubscribe function
  isAlive: boolean;
}

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients: Set<ClientConnection> = new Set();

  // Server-side ping interval to keep connections alive through reverse proxies
  // Most proxies timeout idle connections after 60-120 seconds
  const pingInterval = setInterval(() => {
    clients.forEach((client) => {
      if (!client.isAlive) {
        // Connection didn't respond to last ping, terminate it
        client.ws.terminate();
        return;
      }
      client.isAlive = false;
      client.ws.ping();
    });
  }, 30000); // Ping every 30 seconds

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  wss.on('connection', (ws: WebSocket) => {
    const client: ClientConnection = {
      ws,
      subscriptions: new Map(),
      isAlive: true
    };
    clients.add(client);

    // Handle pong responses (connection is alive)
    ws.on('pong', () => {
      client.isAlive = true;
    });

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        handleMessage(client, message);
      } catch {
        // Ignore invalid messages
      }
    });

    ws.on('close', () => {
      // Unsubscribe from all sessions
      client.subscriptions.forEach(unsubscribe => unsubscribe());
      clients.delete(client);
    });

    ws.on('error', () => {
      client.subscriptions.forEach(unsubscribe => unsubscribe());
      clients.delete(client);
    });
  });

  function handleMessage(client: ClientConnection, message: { type: string; sessionId?: string }) {
    switch (message.type) {
      case 'subscribe':
        if (message.sessionId) {
          subscribeToSession(client, message.sessionId);
        }
        break;

      case 'unsubscribe':
        if (message.sessionId) {
          unsubscribeFromSession(client, message.sessionId);
        }
        break;

      case 'ping':
        send(client.ws, { type: 'pong' });
        break;
    }
  }

  function subscribeToSession(client: ClientConnection, sessionId: string) {
    // Don't subscribe twice
    if (client.subscriptions.has(sessionId)) return;

    // Subscribe to progress updates
    const unsubscribe = downloadService.onProgress(sessionId, (progress: DownloadProgress) => {
      send(client.ws, {
        type: 'progress',
        ...progress
      });
    });

    client.subscriptions.set(sessionId, unsubscribe);

    // Send current progress immediately
    const currentProgress = downloadService.getProgress(sessionId);
    if (currentProgress) {
      send(client.ws, {
        type: 'progress',
        ...currentProgress
      });
    }
  }

  function unsubscribeFromSession(client: ClientConnection, sessionId: string) {
    const unsubscribe = client.subscriptions.get(sessionId);
    if (unsubscribe) {
      unsubscribe();
      client.subscriptions.delete(sessionId);
    }
  }

  function send(ws: WebSocket, data: object) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  return wss;
}
