/**
 * JellyDown API Client
 * Handles all communication with the backend
 */

class JellyfinAPI {
  constructor() {
    this.baseUrl = '';
  }

  async request(method, endpoint, body = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include'
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, options);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Request failed');
    }

    return data;
  }

  // Auth endpoints
  async connect(serverUrl) {
    return this.request('POST', '/api/auth/connect', { serverUrl });
  }

  async login(serverUrl, username, password) {
    return this.request('POST', '/api/auth/login', { serverUrl, username, password });
  }

  async logout() {
    return this.request('POST', '/api/auth/logout');
  }

  async getSession() {
    return this.request('GET', '/api/auth/session');
  }

  // Library endpoints
  async getLibraryViews() {
    return this.request('GET', '/api/library/views');
  }

  async getItems(options = {}) {
    const params = new URLSearchParams();

    if (options.parentId) params.set('parentId', options.parentId);
    if (options.includeItemTypes) params.set('includeItemTypes', options.includeItemTypes);
    if (options.sortBy) params.set('sortBy', options.sortBy);
    if (options.sortOrder) params.set('sortOrder', options.sortOrder);
    if (options.limit) params.set('limit', options.limit);
    if (options.startIndex) params.set('startIndex', options.startIndex);
    if (options.searchTerm) params.set('searchTerm', options.searchTerm);
    if (options.recursive) params.set('recursive', options.recursive);

    const query = params.toString();
    return this.request('GET', `/api/library/items${query ? '?' + query : ''}`);
  }

  async getItem(itemId) {
    return this.request('GET', `/api/library/items/${itemId}`);
  }

  async getSeasons(seriesId) {
    return this.request('GET', `/api/library/items?parentId=${seriesId}&includeItemTypes=Season&sortBy=SortName&sortOrder=Ascending`);
  }

  async getEpisodes(seasonId) {
    return this.request('GET', `/api/library/items?parentId=${seasonId}&includeItemTypes=Episode&sortBy=SortName&sortOrder=Ascending`);
  }

  getImageUrl(itemId, type = 'Primary', maxWidth = 400) {
    return `/api/library/items/${itemId}/image?type=${type}&maxWidth=${maxWidth}`;
  }

  // Download endpoints
  async getPresets() {
    return this.request('GET', '/api/download/presets');
  }

  async getDownloads() {
    return this.request('GET', '/api/download/list');
  }

  async startDownload(itemId, mediaSourceId, preset, audioStreamIndex = 0) {
    console.log('API.startDownload called:', { itemId, mediaSourceId, preset, audioStreamIndex });
    const result = await this.request('POST', '/api/download/start', {
      itemId,
      mediaSourceId,
      preset,
      audioStreamIndex
    });
    console.log('API.startDownload response:', result);
    return result;
  }

  async getProgress(sessionId) {
    return this.request('GET', `/api/download/progress/${sessionId}`);
  }

  async cancelDownload(sessionId) {
    return this.request('DELETE', `/api/download/${sessionId}`);
  }

  async removeDownload(sessionId) {
    return this.request('DELETE', `/api/download/${sessionId}/remove`);
  }

  async resumeDownload(sessionId) {
    return this.request('POST', `/api/download/${sessionId}/resume`);
  }

  getStreamUrl(sessionId) {
    return `/api/download/stream/${sessionId}`;
  }

  // Cache endpoints
  async getCached() {
    return this.request('GET', '/api/download/cache');
  }

  getCacheStreamUrl(id) {
    return `/api/download/cache/${id}/stream`;
  }

  async deleteCached(id) {
    return this.request('DELETE', `/api/download/cache/${id}`);
  }

  // Queue management endpoints
  async pauseDownload(sessionId) {
    return this.request('POST', `/api/download/${sessionId}/pause`);
  }

  async unpauseDownload(sessionId) {
    return this.request('POST', `/api/download/${sessionId}/unpause`);
  }

  async moveToFront(sessionId) {
    return this.request('POST', `/api/download/${sessionId}/move-to-front`);
  }

  async reorderDownload(sessionId, position) {
    return this.request('PUT', `/api/download/${sessionId}/position`, { position });
  }

  async getQueueInfo() {
    return this.request('GET', '/api/download/queue/info');
  }

  // Settings endpoints
  async getSettings() {
    return this.request('GET', '/api/settings');
  }

  async updateSettings(settings) {
    return this.request('PUT', '/api/settings', settings);
  }
}

// Export singleton
window.api = new JellyfinAPI();
