/**
 * JellyDown Download Manager
 * Handles WebSocket progress updates and file downloads
 */

class DownloadManager {
  constructor() {
    this.ws = null;
    this.currentSession = null;
    this.filename = null;
    this.onProgressCallback = null;
    this.onCompleteCallback = null;
    this.onErrorCallback = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;

      // Resubscribe if we have an active session
      if (this.currentSession) {
        this.subscribe(this.currentSession);
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');

      // Attempt to reconnect if we have an active session
      if (this.currentSession && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), 2000 * this.reconnectAttempts);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  subscribe(sessionId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', sessionId }));
    }
  }

  unsubscribe(sessionId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'unsubscribe', sessionId }));
    }
  }

  handleMessage(data) {
    if (data.type === 'progress') {
      this.handleProgress(data);
    } else if (data.type === 'pong') {
      // Heartbeat response
    }
  }

  handleProgress(data) {
    if (data.sessionId !== this.currentSession) return;

    // Update UI
    if (this.onProgressCallback) {
      this.onProgressCallback(data);
    }

    // Handle completion
    if (data.status === 'completed') {
      this.handleComplete();
    } else if (data.status === 'failed') {
      this.handleError(data.error || 'Download failed');
    }
  }

  handleComplete() {
    if (!this.currentSession) return;

    // Trigger file download
    this.triggerDownload(this.currentSession, this.filename);

    // Notify callback
    if (this.onCompleteCallback) {
      this.onCompleteCallback();
    }

    // Cleanup
    this.unsubscribe(this.currentSession);
    this.currentSession = null;
    this.filename = null;
  }

  handleError(error) {
    if (this.onErrorCallback) {
      this.onErrorCallback(error);
    }

    // Cleanup
    if (this.currentSession) {
      this.unsubscribe(this.currentSession);
      this.currentSession = null;
      this.filename = null;
    }
  }

  triggerDownload(sessionId, filename) {
    const url = window.api.getStreamUrl(sessionId);

    // Create a temporary link and click it
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'download.mp4';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async startDownload(itemId, mediaSourceId, preset, audioStreamIndex, filename) {
    console.log('DownloadManager.startDownload called with:', { itemId, mediaSourceId, preset, audioStreamIndex, filename });

    // Ensure WebSocket is connected
    this.connect();

    // Start the download
    console.log('Calling API startDownload...');
    const result = await window.api.startDownload(itemId, mediaSourceId, preset, audioStreamIndex);
    console.log('API startDownload result:', result);

    this.currentSession = result.sessionId;
    this.filename = filename || result.filename;

    // Subscribe to progress updates
    this.subscribe(result.sessionId);

    return result;
  }

  async cancelCurrentDownload() {
    if (!this.currentSession) return;

    try {
      await window.api.cancelDownload(this.currentSession);
    } catch (err) {
      console.error('Failed to cancel download:', err);
    }

    this.unsubscribe(this.currentSession);
    this.currentSession = null;
    this.filename = null;
  }

  // Set callbacks
  onProgress(callback) {
    this.onProgressCallback = callback;
  }

  onComplete(callback) {
    this.onCompleteCallback = callback;
  }

  onError(callback) {
    this.onErrorCallback = callback;
  }

  isActive() {
    return this.currentSession !== null;
  }
}

// Export singleton
window.downloadManager = new DownloadManager();
