/**
 * JellyDown Main Application
 * Coordinates UI and handles user interactions
 */

(function() {
  'use strict';

  // State
  let currentServerUrl = '';
  let currentLibraryId = '';
  let currentItem = null;
  let selectedPreset = 'medium';
  let presets = [];
  let items = [];
  let isLoading = false;
  let hasMore = true;
  let searchTimeout = null;

  // Series browsing state
  let currentSeries = null;
  let currentSeason = null;
  let seriesSeasons = [];
  let seasonEpisodes = [];

  // DOM Elements
  const screens = {
    connect: document.getElementById('connect-screen'),
    login: document.getElementById('login-screen'),
    library: document.getElementById('library-screen')
  };

  const elements = {
    // Connect screen
    connectForm: document.getElementById('connect-form'),
    serverUrl: document.getElementById('server-url'),
    connectError: document.getElementById('connect-error'),
    recentServers: document.getElementById('recent-servers'),
    recentServersList: document.getElementById('recent-servers-list'),

    // Login screen
    loginForm: document.getElementById('login-form'),
    username: document.getElementById('username'),
    password: document.getElementById('password'),
    loginError: document.getElementById('login-error'),
    serverBadge: document.getElementById('server-badge'),
    backToConnect: document.getElementById('back-to-connect'),

    // Library screen
    libraryNav: document.getElementById('library-nav'),
    moviesGrid: document.getElementById('movies-grid'),
    searchInput: document.getElementById('search-input'),
    loadingMore: document.getElementById('loading-more'),
    logoutBtn: document.getElementById('logout-btn'),

    // Modal
    modal: document.getElementById('movie-modal'),
    modalBackdrop: document.getElementById('modal-backdrop'),
    modalPoster: document.getElementById('modal-poster'),
    modalTitle: document.getElementById('modal-title'),
    modalMeta: document.getElementById('modal-meta'),
    modalOverview: document.getElementById('modal-overview'),
    modalTechnical: document.getElementById('modal-technical'),
    downloadOptions: document.getElementById('download-options'),
    qualityPresets: document.getElementById('quality-presets'),
    audioSelectContainer: document.getElementById('audio-select-container'),
    audioSelect: document.getElementById('audio-select'),
    downloadEstimate: document.getElementById('download-estimate'),
    startDownload: document.getElementById('start-download'),

    // Series browser
    seriesBrowser: document.getElementById('series-browser'),
    seriesBreadcrumb: document.getElementById('series-breadcrumb'),
    seriesList: document.getElementById('series-list'),
    backToSeries: document.getElementById('back-to-series'),

    // Settings modal
    settingsBtn: document.getElementById('settings-btn'),
    settingsModal: document.getElementById('settings-modal'),
    closeSettings: document.getElementById('close-settings'),
    maxConcurrentInput: document.getElementById('max-concurrent'),
    saveSettings: document.getElementById('save-settings'),

    // Download overlay
    downloadOverlay: document.getElementById('download-overlay'),
    downloadTitle: document.getElementById('download-title'),
    downloadStatus: document.getElementById('download-status'),
    progressFill: document.getElementById('progress-fill'),
    progressCircle: document.getElementById('progress-circle'),
    progressPercent: document.getElementById('progress-percent'),
    progressSegments: document.getElementById('progress-segments'),
    cancelDownload: document.getElementById('cancel-download'),

    // Downloads panel
    downloadsBtn: document.getElementById('downloads-btn'),
    downloadBadge: document.getElementById('download-badge'),
    downloadsPanel: document.getElementById('downloads-panel'),
    closeDownloads: document.getElementById('close-downloads'),
    downloadsList: document.getElementById('downloads-list'),
    downloadsEmpty: document.getElementById('downloads-empty'),

    // Cache grid (full page)
    cacheGrid: document.getElementById('cache-grid')
  };

  // ============================================
  // Screen Management
  // ============================================

  function showScreen(screenName) {
    Object.values(screens).forEach(screen => {
      screen.classList.remove('active');
    });
    screens[screenName].classList.add('active');
  }

  // ============================================
  // Error Handling
  // ============================================

  function showError(element, message) {
    element.textContent = message;
    element.classList.add('visible');
  }

  function hideError(element) {
    element.classList.remove('visible');
  }

  // ============================================
  // Recent Servers (localStorage)
  // ============================================

  const RECENT_SERVERS_KEY = 'jellydown_recent_servers';
  const MAX_RECENT_SERVERS = 5;

  function getRecentServers() {
    try {
      const data = localStorage.getItem(RECENT_SERVERS_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  function saveRecentServer(serverUrl, serverName) {
    const servers = getRecentServers();

    // Remove existing entry for this URL
    const filtered = servers.filter(s => s.url !== serverUrl);

    // Add to front of list
    filtered.unshift({
      url: serverUrl,
      name: serverName,
      lastUsed: Date.now()
    });

    // Keep only the most recent
    const trimmed = filtered.slice(0, MAX_RECENT_SERVERS);

    try {
      localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify(trimmed));
    } catch {
      // localStorage might be full or disabled
    }
  }

  function removeRecentServer(serverUrl) {
    const servers = getRecentServers();
    const filtered = servers.filter(s => s.url !== serverUrl);
    try {
      localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify(filtered));
    } catch {
      // Ignore
    }
    renderRecentServers();
  }

  function renderRecentServers() {
    const servers = getRecentServers();

    if (servers.length === 0) {
      elements.recentServers.style.display = 'none';
      return;
    }

    elements.recentServers.style.display = 'block';
    elements.recentServersList.innerHTML = servers.map(server => `
      <div class="recent-server-item" data-url="${server.url}">
        <div class="recent-server-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </div>
        <div class="recent-server-info">
          <div class="recent-server-name">${server.name || 'Jellyfin Server'}</div>
          <div class="recent-server-url">${server.url}</div>
        </div>
        <button class="recent-server-remove" data-url="${server.url}" title="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `).join('');

    // Add click handlers
    elements.recentServersList.querySelectorAll('.recent-server-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // Don't trigger if clicking remove button
        if (e.target.closest('.recent-server-remove')) return;

        const url = item.dataset.url;
        elements.serverUrl.value = url;
        elements.connectForm.dispatchEvent(new Event('submit'));
      });
    });

    // Add remove button handlers
    elements.recentServersList.querySelectorAll('.recent-server-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeRecentServer(btn.dataset.url);
      });
    });
  }

  function setLoading(button, loading) {
    if (loading) {
      button.classList.add('loading');
      button.disabled = true;
    } else {
      button.classList.remove('loading');
      button.disabled = false;
    }
  }

  // ============================================
  // Connect Screen
  // ============================================

  async function handleConnect(e) {
    e.preventDefault();
    hideError(elements.connectError);

    const serverUrl = elements.serverUrl.value.trim();
    if (!serverUrl) return;

    setLoading(elements.connectForm.querySelector('button'), true);

    try {
      const result = await window.api.connect(serverUrl);
      currentServerUrl = serverUrl;

      // Save to recent servers
      saveRecentServer(serverUrl, result.server.name);
      renderRecentServers();

      // Update server badge
      elements.serverBadge.querySelector('.server-name').textContent = result.server.name;

      showScreen('login');
    } catch (err) {
      showError(elements.connectError, err.message);
    } finally {
      setLoading(elements.connectForm.querySelector('button'), false);
    }
  }

  // ============================================
  // Login Screen
  // ============================================

  async function handleLogin(e) {
    e.preventDefault();
    hideError(elements.loginError);

    const username = elements.username.value.trim();
    const password = elements.password.value;

    if (!username) return;

    setLoading(elements.loginForm.querySelector('button'), true);

    try {
      await window.api.login(currentServerUrl, username, password);
      await loadLibrary();
      showScreen('library');
    } catch (err) {
      showError(elements.loginError, err.message);
    } finally {
      setLoading(elements.loginForm.querySelector('button'), false);
    }
  }

  function handleBackToConnect() {
    elements.username.value = '';
    elements.password.value = '';
    hideError(elements.loginError);
    showScreen('connect');
  }

  // ============================================
  // Library Screen
  // ============================================

  async function loadLibrary() {
    try {
      // Load views
      const viewsResult = await window.api.getLibraryViews();

      // Render nav with Cache tab at the end
      elements.libraryNav.innerHTML = viewsResult.items.map((view, index) => `
        <button data-id="${view.id}" class="${index === 0 ? 'active' : ''}">${view.name}</button>
      `).join('') + `
        <button data-id="__cache__" class="cache-tab">Cache</button>
      `;

      // Set initial library
      if (viewsResult.items.length > 0) {
        currentLibraryId = viewsResult.items[0].id;
        await loadItems();
      }

      // Load presets
      const presetsResult = await window.api.getPresets();
      presets = presetsResult.presets;
    } catch (err) {
      console.error('Failed to load library:', err);
    }
  }

  async function loadItems(reset = true) {
    if (isLoading) return;
    if (!reset && !hasMore) return;

    isLoading = true;

    if (reset) {
      items = [];
      elements.moviesGrid.innerHTML = '';
      hasMore = true;
    }

    elements.loadingMore.classList.add('visible');

    try {
      const searchTerm = elements.searchInput.value.trim();

      const result = await window.api.getItems({
        parentId: currentLibraryId,
        includeItemTypes: 'Movie,Series',
        sortBy: 'SortName',
        sortOrder: 'Ascending',
        limit: 50,
        startIndex: items.length,
        searchTerm: searchTerm || undefined,
        recursive: true
      });

      items = items.concat(result.items);
      hasMore = items.length < result.totalCount;

      renderItems(result.items);
    } catch (err) {
      console.error('Failed to load items:', err);
    } finally {
      isLoading = false;
      elements.loadingMore.classList.remove('visible');
    }
  }

  function renderItems(newItems) {
    const html = newItems.map(item => `
      <div class="movie-card" data-id="${item.id}">
        ${item.imageUrl
          ? `<img src="${item.imageUrl}" alt="${item.name}" loading="lazy">`
          : `<div class="movie-card-placeholder">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                 <rect x="2" y="2" width="20" height="20" rx="2"/>
                 <path d="M10 8l6 4-6 4V8z"/>
               </svg>
             </div>`
        }
        <div class="movie-card-overlay">
          <h3 class="movie-card-title">${item.name}</h3>
          ${item.year ? `<span class="movie-card-year">${item.year}</span>` : ''}
        </div>
      </div>
    `).join('');

    elements.moviesGrid.insertAdjacentHTML('beforeend', html);
  }

  function handleLibraryNavClick(e) {
    const button = e.target.closest('button');
    if (!button) return;

    // Update active state
    elements.libraryNav.querySelectorAll('button').forEach(btn => {
      btn.classList.remove('active');
    });
    button.classList.add('active');

    const tabId = button.dataset.id;

    // Handle Cache tab specially
    if (tabId === '__cache__') {
      showCacheView();
      return;
    }

    // Regular library tab
    showMoviesView();
    currentLibraryId = tabId;
    elements.searchInput.value = '';
    loadItems(true);
  }

  function handleSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadItems(true);
    }, 300);
  }

  function handleScroll() {
    const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
    if (scrollTop + clientHeight >= scrollHeight - 500) {
      loadItems(false);
    }
  }

  async function handleLogout() {
    try {
      await window.api.logout();
    } catch (err) {
      console.error('Logout error:', err);
    }

    // Reset state
    currentServerUrl = '';
    currentLibraryId = '';
    items = [];
    elements.serverUrl.value = '';
    elements.username.value = '';
    elements.password.value = '';
    elements.moviesGrid.innerHTML = '';

    showScreen('connect');
  }

  // ============================================
  // Movie Modal
  // ============================================

  async function openMovieModal(itemId) {
    try {
      const item = await window.api.getItem(itemId);
      currentItem = item;

      // Update modal content
      if (item.backdropUrl) {
        elements.modalBackdrop.style.backgroundImage = `url(${item.backdropUrl})`;
      } else {
        elements.modalBackdrop.style.backgroundImage = 'none';
      }

      elements.modalPoster.innerHTML = item.imageUrl
        ? `<img src="${item.imageUrl}" alt="${item.name}">`
        : '';

      elements.modalTitle.textContent = item.name;

      // Meta info
      const metaParts = [];
      if (item.year) metaParts.push(`<span>${item.year}</span>`);
      if (item.runtime) metaParts.push(`<span>${item.runtime} min</span>`);
      if (item.rating) metaParts.push(`<span class="rating">★ ${item.rating.toFixed(1)}</span>`);
      if (item.officialRating) metaParts.push(`<span>${item.officialRating}</span>`);
      elements.modalMeta.innerHTML = metaParts.join('');

      elements.modalOverview.textContent = item.overview || 'No description available.';

      // Check if this is a Series
      if (item.type === 'Series') {
        // Show series browser, hide download options
        elements.seriesBrowser.style.display = 'block';
        elements.downloadOptions.style.display = 'none';
        elements.modalTechnical.innerHTML = '';

        // Store series info and load seasons
        currentSeries = item;
        currentSeason = null;
        await loadSeasons(item.id);
      } else {
        // Show download options for Movies and Episodes
        elements.seriesBrowser.style.display = 'none';
        elements.downloadOptions.style.display = 'block';
        elements.backToSeries.style.display = 'none'; // Hide back button for direct movie access

        // Technical info
        const techParts = [];
        if (item.videoInfo) {
          if (item.videoInfo.width && item.videoInfo.height) {
            techParts.push(`<span class="tech-badge">${item.videoInfo.width}×${item.videoInfo.height}</span>`);
          }
          if (item.videoInfo.codec) {
            techParts.push(`<span class="tech-badge">${item.videoInfo.codec.toUpperCase()}</span>`);
          }
        }
        if (item.mediaSource?.container) {
          techParts.push(`<span class="tech-badge">${item.mediaSource.container.toUpperCase()}</span>`);
        }
        if (item.mediaSource?.size) {
          techParts.push(`<span class="tech-badge">${formatBytes(item.mediaSource.size)}</span>`);
        }
        elements.modalTechnical.innerHTML = techParts.join('');

        // Quality presets
        renderQualityPresets();

        // Audio tracks
        if (item.audioStreams && item.audioStreams.length > 1) {
          elements.audioSelectContainer.style.display = 'block';
          elements.audioSelect.innerHTML = item.audioStreams.map(stream =>
            `<option value="${stream.index}" ${stream.isDefault ? 'selected' : ''}>
              ${stream.displayTitle}
            </option>`
          ).join('');
        } else {
          elements.audioSelectContainer.style.display = 'none';
        }

        // Update estimate
        updateDownloadEstimate();
      }

      // Show modal
      elements.modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    } catch (err) {
      console.error('Failed to load movie details:', err);
    }
  }

  function closeMovieModal() {
    elements.modal.classList.remove('active');
    document.body.style.overflow = '';
    currentItem = null;
    currentSeries = null;
    currentSeason = null;
    seriesSeasons = [];
    seasonEpisodes = [];
  }

  // ============================================
  // Series Browser
  // ============================================

  async function loadSeasons(seriesId) {
    try {
      const result = await window.api.getSeasons(seriesId);
      seriesSeasons = result.items || [];
      renderSeasons();
    } catch (err) {
      console.error('Failed to load seasons:', err);
      elements.seriesList.innerHTML = '<p class="error">Failed to load seasons</p>';
    }
  }

  function renderSeasons() {
    // Update breadcrumb
    elements.seriesBreadcrumb.innerHTML = `
      <span class="current">${currentSeries.name}</span>
      <span class="separator">›</span>
      <span class="current">Seasons</span>
    `;

    // Render season list
    elements.seriesList.innerHTML = seriesSeasons.map(season => `
      <div class="series-list-item" data-season-id="${season.id}">
        <div class="series-list-item-thumb">
          ${season.imageUrl
            ? `<img src="${season.imageUrl}" alt="${season.name}">`
            : ''
          }
        </div>
        <div class="series-list-item-info">
          <div class="series-list-item-title">${season.name}</div>
          <div class="series-list-item-meta">${season.year || ''}</div>
        </div>
        <div class="series-list-item-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9,18 15,12 9,6"/>
          </svg>
        </div>
      </div>
    `).join('');

    // Add click handlers
    elements.seriesList.querySelectorAll('.series-list-item').forEach(item => {
      item.addEventListener('click', () => {
        const seasonId = item.dataset.seasonId;
        const season = seriesSeasons.find(s => s.id === seasonId);
        if (season) {
          currentSeason = season;
          loadEpisodes(seasonId);
        }
      });
    });
  }

  async function loadEpisodes(seasonId) {
    try {
      const result = await window.api.getEpisodes(seasonId);
      seasonEpisodes = result.items || [];
      renderEpisodes();
    } catch (err) {
      console.error('Failed to load episodes:', err);
      elements.seriesList.innerHTML = '<p class="error">Failed to load episodes</p>';
    }
  }

  function renderEpisodes() {
    // Update breadcrumb with back arrow
    elements.seriesBreadcrumb.innerHTML = `
      <button class="back-arrow-btn" data-action="back-to-seasons" title="Back to seasons">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <span class="current">${currentSeason.name}</span>
    `;

    // Add click handler for back button
    elements.seriesBreadcrumb.querySelector('[data-action="back-to-seasons"]')
      .addEventListener('click', () => {
        currentSeason = null;
        renderSeasons();
      });

    // Render episode list
    elements.seriesList.innerHTML = seasonEpisodes.map(episode => `
      <div class="series-list-item" data-episode-id="${episode.id}">
        <div class="series-list-item-thumb episode">
          ${episode.imageUrl
            ? `<img src="${episode.imageUrl}" alt="${episode.name}">`
            : ''
          }
        </div>
        <div class="series-list-item-info">
          <div class="series-list-item-title">
            ${episode.episodeNumber ? `${episode.episodeNumber}. ` : ''}${episode.name}
          </div>
          <div class="series-list-item-meta">
            ${episode.runtime ? `${episode.runtime} min` : ''}
          </div>
        </div>
        <div class="series-list-item-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7,10 12,15 17,10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </div>
      </div>
    `).join('');

    // Add click handlers
    elements.seriesList.querySelectorAll('.series-list-item').forEach(item => {
      item.addEventListener('click', () => {
        const episodeId = item.dataset.episodeId;
        openEpisodeDownload(episodeId);
      });
    });
  }

  async function openEpisodeDownload(episodeId) {
    try {
      const episode = await window.api.getItem(episodeId);
      currentItem = episode;

      // Update modal for episode
      elements.modalTitle.textContent = `${currentSeries.name} - ${episode.name}`;

      const metaParts = [];
      if (episode.seasonNumber) metaParts.push(`<span>S${episode.seasonNumber}</span>`);
      if (episode.episodeNumber) metaParts.push(`<span>E${episode.episodeNumber}</span>`);
      if (episode.runtime) metaParts.push(`<span>${episode.runtime} min</span>`);
      elements.modalMeta.innerHTML = metaParts.join('');

      elements.modalOverview.textContent = episode.overview || 'No description available.';

      // Technical info
      const techParts = [];
      if (episode.videoInfo) {
        if (episode.videoInfo.width && episode.videoInfo.height) {
          techParts.push(`<span class="tech-badge">${episode.videoInfo.width}×${episode.videoInfo.height}</span>`);
        }
        if (episode.videoInfo.codec) {
          techParts.push(`<span class="tech-badge">${episode.videoInfo.codec.toUpperCase()}</span>`);
        }
      }
      if (episode.mediaSource?.container) {
        techParts.push(`<span class="tech-badge">${episode.mediaSource.container.toUpperCase()}</span>`);
      }
      if (episode.mediaSource?.size) {
        techParts.push(`<span class="tech-badge">${formatBytes(episode.mediaSource.size)}</span>`);
      }
      elements.modalTechnical.innerHTML = techParts.join('');

      // Show download options, hide series browser
      elements.seriesBrowser.style.display = 'none';
      elements.downloadOptions.style.display = 'block';
      elements.backToSeries.style.display = 'flex'; // Show back button for episode view

      // Quality presets
      renderQualityPresets();

      // Audio tracks
      if (episode.audioStreams && episode.audioStreams.length > 1) {
        elements.audioSelectContainer.style.display = 'block';
        elements.audioSelect.innerHTML = episode.audioStreams.map(stream =>
          `<option value="${stream.index}" ${stream.isDefault ? 'selected' : ''}>
            ${stream.displayTitle}
          </option>`
        ).join('');
      } else {
        elements.audioSelectContainer.style.display = 'none';
      }

      // Update estimate
      updateDownloadEstimate();
    } catch (err) {
      console.error('Failed to load episode details:', err);
    }
  }

  function backToSeriesBrowser() {
    // Return to series browser view
    elements.downloadOptions.style.display = 'none';
    elements.seriesBrowser.style.display = 'block';

    // Restore series info in modal
    elements.modalTitle.textContent = currentSeries.name;

    const metaParts = [];
    if (currentSeries.year) metaParts.push(`<span>${currentSeries.year}</span>`);
    if (currentSeries.rating) metaParts.push(`<span class="rating">★ ${currentSeries.rating.toFixed(1)}</span>`);
    if (currentSeries.officialRating) metaParts.push(`<span>${currentSeries.officialRating}</span>`);
    elements.modalMeta.innerHTML = metaParts.join('');

    elements.modalOverview.textContent = currentSeries.overview || 'No description available.';
    elements.modalTechnical.innerHTML = '';

    // Show appropriate view
    if (currentSeason) {
      renderEpisodes();
    } else {
      renderSeasons();
    }
  }

  function renderQualityPresets() {
    elements.qualityPresets.innerHTML = presets.map(preset => `
      <div class="quality-preset ${preset.id === selectedPreset ? 'selected' : ''}" data-id="${preset.id}">
        <span class="quality-preset-name">${preset.resolution}</span>
        <span class="quality-preset-info">${preset.bitrateFormatted}</span>
      </div>
    `).join('');
  }

  function handleQualitySelect(e) {
    const preset = e.target.closest('.quality-preset');
    if (!preset) return;

    selectedPreset = preset.dataset.id;
    elements.qualityPresets.querySelectorAll('.quality-preset').forEach(p => {
      p.classList.remove('selected');
    });
    preset.classList.add('selected');

    updateDownloadEstimate();
  }

  function updateDownloadEstimate() {
    if (!currentItem || !currentItem.runtime) {
      elements.downloadEstimate.innerHTML = '';
      return;
    }

    const preset = presets.find(p => p.id === selectedPreset);
    if (!preset) return;

    const hours = currentItem.runtime / 60;
    const estimatedSize = preset.estimatedSizePerHour * hours;

    elements.downloadEstimate.innerHTML = `
      <div class="size">${formatBytes(estimatedSize * 1024 * 1024)}</div>
      <div class="label">Estimated file size</div>
    `;
  }

  // ============================================
  // Download
  // ============================================

  async function handleStartDownload() {
    console.log('handleStartDownload called');
    console.log('currentItem:', currentItem);
    console.log('selectedPreset:', selectedPreset);

    if (!currentItem) {
      console.error('No currentItem - cannot start download');
      alert('Error: No movie selected');
      return;
    }

    // Save item info before closing modal (which clears currentItem)
    const item = currentItem;
    const audioStreamIndex = parseInt(elements.audioSelect.value) || 0;
    const preset = selectedPreset;

    console.log('audioStreamIndex:', audioStreamIndex);
    console.log('mediaSource:', item.mediaSource);

    // Close modal
    closeMovieModal();

    try {
      console.log('Calling downloadManager.startDownload');
      const result = await window.downloadManager.startDownload(
        item.id,
        item.mediaSource?.id,
        preset,
        audioStreamIndex,
        `${item.name}.mp4`
      );
      console.log('Download started:', result);

      // Show toast notification and open downloads panel
      showToast(`Started downloading "${item.name}"`);
      openDownloadsPanel();
    } catch (err) {
      console.error('Download failed:', err);
      showToast('Failed to start download: ' + err.message, 'error');
    }
  }

  // Toast notification
  function showToast(message, type = 'success') {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('visible');
    });

    // Auto-hide after 4 seconds
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function showDownloadOverlay(title) {
    elements.downloadTitle.textContent = title;
    elements.downloadStatus.textContent = 'Initializing transcoding...';
    elements.progressFill.style.width = '0%';
    elements.progressCircle.style.strokeDashoffset = '176';
    elements.progressPercent.textContent = '0%';
    elements.progressSegments.textContent = '0 / 0 segments';
    elements.downloadOverlay.classList.add('active');
  }

  function hideDownloadOverlay() {
    elements.downloadOverlay.classList.remove('active');
  }

  function updateDownloadProgress(data) {
    const percent = Math.round(data.progress * 100);
    const circumference = 176; // 2 * PI * 28

    elements.progressFill.style.width = `${percent}%`;
    elements.progressCircle.style.strokeDashoffset = circumference - (circumference * data.progress);
    elements.progressPercent.textContent = `${percent}%`;
    elements.progressSegments.textContent = `${data.completedSegments} / ${data.totalSegments} segments`;

    // Update status text
    const statusTexts = {
      preparing: 'Waiting for transcoding to complete...',
      downloading: 'Downloading segments...',
      processing: 'Processing final file...',
      completed: 'Download complete!'
    };
    elements.downloadStatus.textContent = statusTexts[data.status] || data.status;
  }

  async function handleCancelDownload() {
    await window.downloadManager.cancelCurrentDownload();
    hideDownloadOverlay();
  }

  // ============================================
  // Downloads Panel
  // ============================================

  let downloadsPollInterval = null;

  function toggleDownloadsPanel() {
    if (elements.downloadsPanel.classList.contains('active')) {
      closeDownloadsPanel();
    } else {
      openDownloadsPanel();
    }
  }

  function openDownloadsPanel() {
    elements.downloadsPanel.classList.add('active');
    refreshDownloadsList();

    // Start polling for updates
    downloadsPollInterval = setInterval(refreshDownloadsList, 2000);
  }

  function closeDownloadsPanel() {
    elements.downloadsPanel.classList.remove('active');

    // Stop polling
    if (downloadsPollInterval) {
      clearInterval(downloadsPollInterval);
      downloadsPollInterval = null;
    }
  }

  // ============================================
  // Cache Grid (Full Page)
  // ============================================

  let cacheData = [];

  async function loadCacheGrid() {
    try {
      const result = await window.api.getCached();
      cacheData = result.cached || [];
      renderCacheGrid();
    } catch (err) {
      console.error('Failed to fetch cache:', err);
    }
  }

  function renderCacheGrid() {
    if (!cacheData || cacheData.length === 0) {
      elements.cacheGrid.innerHTML = `
        <div class="cache-empty-state">
          <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="8" y="8" width="48" height="48" rx="4"/>
            <path d="M24 32h16M32 24v16"/>
          </svg>
          <p>No cached videos</p>
          <span>Completed downloads will appear here for instant re-download</span>
        </div>
      `;
      return;
    }

    elements.cacheGrid.innerHTML = cacheData.map(item => `
      <div class="cache-item" data-cache-id="${item.id}">
        <div class="cache-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
        </div>
        <div class="cache-item-info">
          <div class="cache-item-title">${item.title}</div>
          <div class="cache-item-meta">${item.sizeFormatted}</div>
        </div>
        <div class="cache-item-actions">
          <button data-action="download" title="Download">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7,10 12,15 17,10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          <button class="delete-btn" data-action="delete" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3,6 5,6 21,6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    `).join('');

    // Add event listeners
    elements.cacheGrid.querySelectorAll('.cache-item').forEach(item => {
      const id = item.dataset.cacheId;
      const cacheItem = cacheData.find(c => c.id === id);

      item.querySelector('[data-action="download"]').addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.href = window.api.getCacheStreamUrl(id);
      });

      item.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${cacheItem?.title}" from cache?`)) {
          try {
            await window.api.deleteCached(id);
            loadCacheGrid();
            showToast('Deleted from cache');
          } catch (err) {
            showToast('Failed to delete: ' + err.message, 'error');
          }
        }
      });
    });
  }

  function showCacheView() {
    elements.moviesGrid.style.display = 'none';
    elements.cacheGrid.style.display = 'grid';
    elements.searchInput.parentElement.style.display = 'none'; // Hide search box
    elements.loadingMore.style.display = 'none';
    loadCacheGrid();
  }

  function showMoviesView() {
    elements.moviesGrid.style.display = 'grid';
    elements.cacheGrid.style.display = 'none';
    elements.searchInput.parentElement.style.display = 'flex'; // Show search box
    elements.loadingMore.style.display = '';
  }

  // ============================================
  // Settings Modal
  // ============================================

  async function openSettingsModal() {
    try {
      const settings = await window.api.getSettings();
      elements.maxConcurrentInput.value = settings.maxConcurrentDownloads || 5;
      elements.settingsModal.classList.add('active');
      document.body.style.overflow = 'hidden';
    } catch (err) {
      console.error('Failed to load settings:', err);
      showToast('Failed to load settings', 'error');
    }
  }

  function closeSettingsModal() {
    elements.settingsModal.classList.remove('active');
    document.body.style.overflow = '';
  }

  async function saveSettings() {
    try {
      const maxConcurrent = parseInt(elements.maxConcurrentInput.value, 10);
      if (isNaN(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 20) {
        showToast('Max concurrent downloads must be between 1 and 20', 'error');
        return;
      }

      await window.api.updateSettings({ maxConcurrentDownloads: maxConcurrent });
      showToast('Settings saved');
      closeSettingsModal();
    } catch (err) {
      console.error('Failed to save settings:', err);
      showToast('Failed to save settings: ' + err.message, 'error');
    }
  }

  async function refreshDownloadsList() {
    try {
      const result = await window.api.getDownloads();
      renderDownloadsList(result.downloads);
      updateDownloadBadge(result.downloads);
    } catch (err) {
      console.error('Failed to fetch downloads:', err);
    }
  }

  function renderDownloadsList(downloads) {
    if (!downloads || downloads.length === 0) {
      elements.downloadsEmpty.style.display = 'flex';
      // Remove any existing download items
      const items = elements.downloadsList.querySelectorAll('.download-item');
      items.forEach(item => item.remove());
      return;
    }

    elements.downloadsEmpty.style.display = 'none';

    // Update or create download items
    downloads.forEach(download => {
      let item = elements.downloadsList.querySelector(`[data-session-id="${download.sessionId}"]`);

      if (!item) {
        item = createDownloadItem(download);
        elements.downloadsList.insertBefore(item, elements.downloadsEmpty);
      } else {
        updateDownloadItem(item, download);
      }
    });

    // Remove items that no longer exist
    const existingIds = new Set(downloads.map(d => d.sessionId));
    const items = elements.downloadsList.querySelectorAll('.download-item');
    items.forEach(item => {
      if (!existingIds.has(item.dataset.sessionId)) {
        item.remove();
      }
    });
  }

  // Drag state
  let draggedItem = null;
  let draggedSessionId = null;

  function createDownloadItem(download) {
    const div = document.createElement('div');
    div.className = `download-item ${download.status}`;
    div.dataset.sessionId = download.sessionId;

    div.innerHTML = getDownloadItemContent(download);

    // Add event listeners
    const actions = div.querySelector('.download-item-actions');
    if (actions) {
      actions.addEventListener('click', (e) => handleDownloadAction(e, download));
    }

    // Add drag-and-drop for queued items
    if (download.status === 'queued') {
      setupDragHandlers(div, download);
    }

    return div;
  }

  function setupDragHandlers(item, download) {
    item.draggable = true;

    item.addEventListener('dragstart', (e) => {
      if (download.status !== 'queued') {
        e.preventDefault();
        return;
      }
      draggedItem = item;
      draggedSessionId = download.sessionId;
      item.classList.add('dragging');
      elements.downloadsList.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', download.sessionId);
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      elements.downloadsList.classList.remove('is-dragging');
      clearDragOverStates();
      draggedItem = null;
      draggedSessionId = null;
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!draggedItem || draggedItem === item) return;

      // Only allow dropping on queued items
      if (!item.classList.contains('queued')) return;

      e.dataTransfer.dropEffect = 'move';

      // Determine if we're above or below the middle
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      clearDragOverStates();
      if (e.clientY < midY) {
        item.classList.add('drag-over');
      } else {
        item.classList.add('drag-over-bottom');
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over', 'drag-over-bottom');
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!draggedSessionId || draggedSessionId === download.sessionId) return;

      // Only allow dropping on queued items
      if (download.status !== 'queued') return;

      const dropBelow = item.classList.contains('drag-over-bottom');
      clearDragOverStates();

      // Calculate new position
      let newPosition = download.queuePosition || 1;
      if (dropBelow) {
        newPosition += 1;
      }

      try {
        await window.api.reorderDownload(draggedSessionId, newPosition);
        refreshDownloadsList();
      } catch (err) {
        console.error('Failed to reorder download:', err);
        showToast('Failed to reorder: ' + err.message, 'error');
      }
    });
  }

  function clearDragOverStates() {
    elements.downloadsList.querySelectorAll('.drag-over, .drag-over-bottom').forEach(el => {
      el.classList.remove('drag-over', 'drag-over-bottom');
    });
  }

  function getDownloadItemContent(download) {
    const isTranscoding = download.status === 'transcoding';
    const transcodePercent = Math.round((download.transcodeProgress || 0) * 100);
    const downloadPercent = Math.round(download.progress * 100);

    let progressContent = '';
    let statsContent = '';

    if (isTranscoding) {
      progressContent = `
        <div class="download-item-progress">
          <div class="progress-bar transcoding">
            <div class="progress-fill" style="width: ${transcodePercent}%"></div>
          </div>
        </div>
      `;
      statsContent = `
        <div class="download-item-stats">
          <span class="percent">${transcodePercent}%</span>
          <span class="segments">${formatDuration(download.transcodedSeconds || 0)} / ${formatDuration(download.expectedDurationSeconds || 0)}</span>
        </div>
      `;
    } else if (download.status === 'downloading') {
      progressContent = `
        <div class="download-item-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${downloadPercent}%"></div>
          </div>
        </div>
      `;
      statsContent = `
        <div class="download-item-stats">
          <span class="percent">${downloadPercent}%</span>
          <span class="segments">${download.completedSegments} / ${download.totalSegments} segments</span>
        </div>
      `;
    } else if (download.status === 'processing' || download.status === 'completed') {
      progressContent = `
        <div class="download-item-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: 100%"></div>
          </div>
        </div>
      `;
      statsContent = `
        <div class="download-item-stats">
          <span class="percent">100%</span>
          <span class="segments">${download.totalSegments} segments</span>
        </div>
      `;
    }

    // Format status with queue position if queued
    let statusText = formatStatus(download.status);
    if (download.status === 'queued' && download.queuePosition) {
      statusText = `Queued (#${download.queuePosition})`;
    }

    // Drag handle for queued items
    const dragHandle = `
      <div class="download-item-drag-handle" title="Drag to reorder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="8" y1="6" x2="16" y2="6"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
          <line x1="8" y1="18" x2="16" y2="18"/>
        </svg>
      </div>
    `;

    return `
      <div class="download-item-header">
        ${dragHandle}
        <div class="download-item-title">${escapeHtml(download.title || download.filename || 'Unknown')}</div>
        <span class="download-item-status ${download.status}">${statusText}</span>
      </div>
      ${progressContent}
      ${statsContent}
      ${getDownloadActions(download)}
    `;
  }

  function updateDownloadItem(item, download) {
    // Update class
    item.className = `download-item ${download.status}`;

    // Re-render the entire content to handle status transitions properly
    const oldStatus = item.dataset.status;
    if (oldStatus !== download.status) {
      // Status changed - full re-render
      item.innerHTML = getDownloadItemContent(download);
      item.dataset.status = download.status;

      const actions = item.querySelector('.download-item-actions');
      if (actions) {
        actions.addEventListener('click', (e) => handleDownloadAction(e, download));
      }

      // Update drag handlers based on new status
      if (download.status === 'queued') {
        item.draggable = true;
        setupDragHandlers(item, download);
      } else {
        item.draggable = false;
      }
      return;
    }

    item.dataset.status = download.status;

    // Update status badge
    const statusEl = item.querySelector('.download-item-status');
    if (statusEl) {
      statusEl.className = `download-item-status ${download.status}`;
      let statusText = formatStatus(download.status);
      if (download.status === 'queued' && download.queuePosition) {
        statusText = `Queued (#${download.queuePosition})`;
      }
      statusEl.textContent = statusText;
    }

    // Update progress based on status
    const isTranscoding = download.status === 'transcoding';
    const progressFill = item.querySelector('.progress-fill');

    if (isTranscoding) {
      const transcodePercent = Math.round((download.transcodeProgress || 0) * 100);
      if (progressFill) {
        progressFill.style.width = `${transcodePercent}%`;
      }
      const percentEl = item.querySelector('.percent');
      if (percentEl) {
        percentEl.textContent = `${transcodePercent}%`;
      }
      const segmentsEl = item.querySelector('.segments');
      if (segmentsEl) {
        segmentsEl.textContent = `${formatDuration(download.transcodedSeconds || 0)} / ${formatDuration(download.expectedDurationSeconds || 0)}`;
      }
    } else {
      const downloadPercent = Math.round(download.progress * 100);
      if (progressFill) {
        progressFill.style.width = `${downloadPercent}%`;
      }
      const percentEl = item.querySelector('.percent');
      if (percentEl) {
        percentEl.textContent = `${downloadPercent}%`;
      }
      const segmentsEl = item.querySelector('.segments');
      if (segmentsEl) {
        segmentsEl.textContent = `${download.completedSegments} / ${download.totalSegments} segments`;
      }
    }
  }

  function getDownloadActions(download) {
    switch (download.status) {
      case 'completed':
        return `
          <div class="download-item-actions">
            <button class="primary" data-action="download">Download File</button>
          </div>
        `;
      case 'transcoding':
      case 'downloading':
      case 'processing':
        return `
          <div class="download-item-actions">
            <button class="danger" data-action="cancel">Cancel</button>
          </div>
        `;
      case 'queued':
        return `
          <div class="download-item-actions">
            <button class="move-btn" data-action="move-to-front" title="Move to front">Front</button>
            <button data-action="pause">Pause</button>
            <button class="danger" data-action="cancel">Cancel</button>
          </div>
        `;
      case 'paused':
        return `
          <div class="download-item-actions">
            <button class="primary" data-action="unpause">Resume</button>
            <button class="danger" data-action="cancel">Cancel</button>
          </div>
        `;
      case 'failed':
        if (download.canResume) {
          return `
            <div class="download-item-actions">
              <button class="primary" data-action="retry">Retry</button>
              <button data-action="remove">Dismiss</button>
            </div>
          `;
        }
        return `
          <div class="download-item-actions">
            <button data-action="remove">Dismiss</button>
          </div>
        `;
      default:
        return '';
    }
  }

  async function handleDownloadAction(e, download) {
    const button = e.target.closest('button');
    if (!button) return;

    const action = button.dataset.action;

    switch (action) {
      case 'download':
        // Trigger file download
        const url = window.api.getStreamUrl(download.sessionId);
        const link = document.createElement('a');
        link.href = url;
        link.download = download.filename || 'download.mp4';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        break;

      case 'cancel':
        try {
          await window.api.cancelDownload(download.sessionId);
          refreshDownloadsList();
        } catch (err) {
          console.error('Failed to cancel download:', err);
        }
        break;

      case 'remove':
        try {
          await window.api.removeDownload(download.sessionId);
          refreshDownloadsList();
        } catch (err) {
          console.error('Failed to remove download:', err);
        }
        break;

      case 'retry':
        try {
          button.disabled = true;
          button.textContent = 'Resuming...';
          await window.api.resumeDownload(download.sessionId);
          showToast(`Resuming "${download.title || 'download'}"...`);
          refreshDownloadsList();
        } catch (err) {
          console.error('Failed to resume download:', err);
          showToast('Failed to resume: ' + err.message, 'error');
          button.disabled = false;
          button.textContent = 'Retry';
        }
        break;

      case 'pause':
        try {
          await window.api.pauseDownload(download.sessionId);
          refreshDownloadsList();
        } catch (err) {
          console.error('Failed to pause download:', err);
          showToast('Failed to pause: ' + err.message, 'error');
        }
        break;

      case 'unpause':
        try {
          await window.api.unpauseDownload(download.sessionId);
          refreshDownloadsList();
        } catch (err) {
          console.error('Failed to unpause download:', err);
          showToast('Failed to resume: ' + err.message, 'error');
        }
        break;

      case 'move-to-front':
        try {
          await window.api.moveToFront(download.sessionId);
          refreshDownloadsList();
        } catch (err) {
          console.error('Failed to move download:', err);
          showToast('Failed to reorder: ' + err.message, 'error');
        }
        break;
    }
  }

  function updateDownloadBadge(downloads) {
    const activeCount = downloads.filter(d =>
      d.status === 'transcoding' || d.status === 'downloading' || d.status === 'processing' || d.status === 'queued'
    ).length;

    if (activeCount > 0) {
      elements.downloadBadge.textContent = activeCount;
      elements.downloadBadge.style.display = 'block';
    } else {
      elements.downloadBadge.style.display = 'none';
    }
  }

  function formatStatus(status) {
    const statusMap = {
      queued: 'Queued',
      paused: 'Paused',
      transcoding: 'Transcoding',
      downloading: 'Downloading',
      processing: 'Processing',
      completed: 'Complete',
      failed: 'Failed',
      cancelled: 'Cancelled'
    };
    return statusMap[status] || status;
  }

  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================
  // Utilities
  // ============================================

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // ============================================
  // Event Listeners
  // ============================================

  function setupEventListeners() {
    console.log('[JellyDown] Setting up event listeners...');

    // Connect screen
    elements.connectForm.addEventListener('submit', handleConnect);

    // Login screen
    elements.loginForm.addEventListener('submit', handleLogin);
    elements.backToConnect.addEventListener('click', handleBackToConnect);

    // Library screen
    elements.libraryNav.addEventListener('click', handleLibraryNavClick);
    elements.searchInput.addEventListener('input', handleSearch);
    elements.logoutBtn.addEventListener('click', handleLogout);
    window.addEventListener('scroll', handleScroll);

    // Movie grid clicks
    elements.moviesGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.movie-card');
      if (card) {
        openMovieModal(card.dataset.id);
      }
    });

    // Modal
    elements.modal.querySelector('.modal-backdrop').addEventListener('click', closeMovieModal);
    elements.modal.querySelector('.modal-close').addEventListener('click', closeMovieModal);
    elements.qualityPresets.addEventListener('click', handleQualitySelect);
    elements.backToSeries.addEventListener('click', backToSeriesBrowser);

    console.log('[JellyDown] Adding download button listener to:', elements.startDownload);
    if (elements.startDownload) {
      elements.startDownload.addEventListener('click', function(e) {
        console.log('[JellyDown] Download button clicked!');
        handleStartDownload();
      });
      console.log('[JellyDown] Download button listener added successfully');
    } else {
      console.error('[JellyDown] ERROR: startDownload element not found!');
    }

    // Download overlay
    elements.cancelDownload.addEventListener('click', handleCancelDownload);

    // Downloads panel
    elements.downloadsBtn.addEventListener('click', toggleDownloadsPanel);
    elements.closeDownloads.addEventListener('click', closeDownloadsPanel);

    // Settings modal
    elements.settingsBtn.addEventListener('click', openSettingsModal);
    elements.closeSettings.addEventListener('click', closeSettingsModal);
    elements.saveSettings.addEventListener('click', saveSettings);
    elements.settingsModal.querySelector('.modal-backdrop').addEventListener('click', closeSettingsModal);

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (elements.settingsModal.classList.contains('active')) {
          closeSettingsModal();
        } else if (elements.modal.classList.contains('active')) {
          closeMovieModal();
        } else if (elements.downloadsPanel.classList.contains('active')) {
          closeDownloadsPanel();
        }
      }
    });

    // Download manager callbacks - show toast notifications instead of overlay
    window.downloadManager.onProgress((data) => {
      // Progress is shown in the downloads panel, not here
    });
    window.downloadManager.onComplete(() => {
      showToast('Download complete!');
      refreshDownloadsList();
    });
    window.downloadManager.onError((error) => {
      showToast('Download failed: ' + error, 'error');
      refreshDownloadsList();
    });
  }

  // ============================================
  // Initialization
  // ============================================

  async function init() {
    console.log('[JellyDown] ========== INITIALIZING ==========');
    console.log('[JellyDown] Elements check:');
    console.log('  - startDownload:', elements.startDownload);
    console.log('  - modal:', elements.modal);
    console.log('  - qualityPresets:', elements.qualityPresets);
    console.log('  - downloadsBtn:', elements.downloadsBtn);

    try {
      setupEventListeners();
      console.log('[JellyDown] Event listeners set up successfully');
    } catch (err) {
      console.error('[JellyDown] ERROR setting up event listeners:', err);
    }

    // Check for existing session
    try {
      const session = await window.api.getSession();
      if (session.authenticated) {
        currentServerUrl = session.serverUrl;
        await loadLibrary();
        showScreen('library');
        return;
      }
    } catch (err) {
      // No session, show connect screen
    }

    // Show recent servers on connect screen
    renderRecentServers();
    showScreen('connect');
  }

  // Start the app
  init();
})();
