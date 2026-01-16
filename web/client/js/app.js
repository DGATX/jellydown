/**
 * JellyDown Main Application
 * Coordinates UI and handles user interactions
 */

(function() {
  'use strict';

  // State
  let currentServerUrl = '';
  let currentServerName = '';
  let currentLibraryId = '';
  let currentItem = null;
  let selectedPreset = 'medium';
  let presets = [];
  let items = [];
  let isLoading = false;
  let hasMore = true;
  let searchTimeout = null;

  // Sort state
  let currentSort = 'SortName,Ascending'; // format: 'field,direction'

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
    sortSelect: document.getElementById('sort-select'),

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
    subtitleSelectContainer: document.getElementById('subtitle-select-container'),
    subtitleSelect: document.getElementById('subtitle-select'),
    subtitleMethodContainer: document.getElementById('subtitle-method-container'),
    downloadEstimate: document.getElementById('download-estimate'),
    startDownload: document.getElementById('start-download'),

    // Series browser
    seriesBrowser: document.getElementById('series-browser'),
    seriesBreadcrumb: document.getElementById('series-breadcrumb'),
    seriesList: document.getElementById('series-list'),
    backToSeries: document.getElementById('back-to-series'),

    // Downloads page
    downloadsBtn: document.getElementById('downloads-btn'),
    downloadBadge: document.getElementById('download-badge'),
    downloadsPage: document.getElementById('downloads-page'),
    downloadsBack: document.getElementById('downloads-back'),
    downloadsPageTabs: document.getElementById('downloads-page-tabs'),
    downloadsActive: document.getElementById('downloads-active'),
    downloadsCompleted: document.getElementById('downloads-completed'),
    downloadsList: document.getElementById('downloads-list'),
    downloadsEmpty: document.getElementById('downloads-empty'),
    cacheContent: document.getElementById('cache-content'),

    // Batch actions
    batchActions: document.getElementById('batch-actions'),
    pauseAllBtn: document.getElementById('pause-all-btn'),
    resumeAllBtn: document.getElementById('resume-all-btn'),
    clearCompletedBtn: document.getElementById('clear-completed-btn'),

    // Settings page
    settingsBtn: document.getElementById('settings-btn'),
    settingsPage: document.getElementById('settings-page'),
    settingsBack: document.getElementById('settings-back'),
    maxConcurrentInput: document.getElementById('max-concurrent'),
    downloadsDirInput: document.getElementById('downloads-dir'),
    defaultRetentionType: document.getElementById('default-retention-type'),
    defaultRetentionDays: document.getElementById('default-retention-days'),
    retentionDaysLabel: document.getElementById('retention-days-label'),
    presetsList: document.getElementById('presets-list'),
    addPresetBtn: document.getElementById('add-preset-btn'),
    settingsSaveSuccess: document.getElementById('settings-save-success'),

    // Inline preset editor
    presetEditor: document.getElementById('preset-editor'),
    presetEditorTitle: document.getElementById('preset-editor-title'),
    presetNameInput: document.getElementById('preset-name'),
    presetMaxWidthInput: document.getElementById('preset-max-width'),
    presetVideoBitrateInput: document.getElementById('preset-video-bitrate'),
    presetAudioBitrateInput: document.getElementById('preset-audio-bitrate'),
    presetAudioChannelsSelect: document.getElementById('preset-audio-channels'),
    presetVideoCodecSelect: document.getElementById('preset-video-codec'),
    cancelPresetEdit: document.getElementById('cancel-preset-edit'),
    savePresetBtn: document.getElementById('save-preset'),

    // Download overlay
    downloadOverlay: document.getElementById('download-overlay'),
    downloadTitle: document.getElementById('download-title'),
    downloadStatus: document.getElementById('download-status'),
    progressFill: document.getElementById('progress-fill'),
    progressCircle: document.getElementById('progress-circle'),
    progressPercent: document.getElementById('progress-percent'),
    progressSegments: document.getElementById('progress-segments'),
    cancelDownload: document.getElementById('cancel-download'),

    // Library content container
    libraryContent: document.getElementById('library-content')
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
  // Saved Servers (Backend + localStorage fallback)
  // ============================================

  let savedServers = [];

  async function loadSavedServers() {
    try {
      const result = await window.api.getSavedServers();
      savedServers = result.servers || [];
      renderSavedServers();
    } catch (err) {
      console.error('Failed to load saved servers:', err);
      // Fall back to localStorage
      try {
        const data = localStorage.getItem('jellydown_recent_servers');
        savedServers = data ? JSON.parse(data).map(s => ({
          id: `local_${s.url}`,
          name: s.name || 'Jellyfin Server',
          serverUrl: s.url,
          username: ''
        })) : [];
        renderSavedServers();
      } catch {
        savedServers = [];
      }
    }
  }

  async function saveServerToBackend(serverUrl, serverName, username) {
    try {
      // Check if server already exists
      const existing = savedServers.find(s => s.serverUrl === serverUrl);
      if (existing) return;

      const result = await window.api.saveServer(serverName, serverUrl, username);
      savedServers.push(result.server);
    } catch (err) {
      console.error('Failed to save server:', err);
    }
  }

  async function removeSavedServer(serverId) {
    try {
      await window.api.removeServer(serverId);
      savedServers = savedServers.filter(s => s.id !== serverId);
      renderSavedServers();
    } catch (err) {
      console.error('Failed to remove server:', err);
    }
  }

  function renderSavedServers() {
    if (savedServers.length === 0) {
      elements.recentServers.style.display = 'none';
      return;
    }

    elements.recentServers.style.display = 'block';
    elements.recentServersList.innerHTML = savedServers.map(server => `
      <div class="recent-server-item" data-id="${server.id}" data-url="${server.serverUrl}">
        <div class="recent-server-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </div>
        <div class="recent-server-info">
          <div class="recent-server-name">${server.name || 'Jellyfin Server'}</div>
          <div class="recent-server-url">${server.serverUrl}${server.username ? ` (${server.username})` : ''}</div>
        </div>
        <button class="recent-server-remove" data-id="${server.id}" title="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `).join('');

    // Add click handlers for quick connect
    elements.recentServersList.querySelectorAll('.recent-server-item').forEach(item => {
      item.addEventListener('click', (e) => {
        // Don't trigger if clicking remove button
        if (e.target.closest('.recent-server-remove')) return;

        const serverId = item.dataset.id;
        const serverUrl = item.dataset.url;
        const server = savedServers.find(s => s.id === serverId);

        if (server && server.username) {
          // Show quick login modal for saved server
          showQuickLoginModal(server);
        } else {
          // Just fill in the URL
          elements.serverUrl.value = serverUrl;
          elements.connectForm.dispatchEvent(new Event('submit'));
        }
      });
    });

    // Add remove button handlers
    elements.recentServersList.querySelectorAll('.recent-server-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeSavedServer(btn.dataset.id);
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
      currentServerName = result.server.name;

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

      // Save server for quick reconnect
      await saveServerToBackend(currentServerUrl, currentServerName || 'Jellyfin Server', username);

      await loadLibrary();
      showScreen('library');
    } catch (err) {
      showError(elements.loginError, err.message);
    } finally {
      setLoading(elements.loginForm.querySelector('button'), false);
    }
  }

  // Quick login modal for saved servers
  let quickLoginServer = null;

  function showQuickLoginModal(server) {
    quickLoginServer = server;

    // Create modal if it doesn't exist
    let modal = document.getElementById('quick-login-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'quick-login-modal';
      modal.className = 'quick-login-modal';
      modal.innerHTML = `
        <div class="quick-login-backdrop"></div>
        <div class="quick-login-content">
          <h3 class="quick-login-title">Enter Password</h3>
          <p class="quick-login-server"></p>
          <form class="quick-login-form">
            <input type="password" class="quick-login-password settings-input" placeholder="Password" autocomplete="current-password">
            <div class="quick-login-error error-message"></div>
            <div class="quick-login-actions">
              <button type="button" class="quick-login-cancel btn btn-secondary">Cancel</button>
              <button type="submit" class="quick-login-submit btn btn-primary">Login</button>
            </div>
          </form>
        </div>
      `;
      document.body.appendChild(modal);

      // Add event listeners
      modal.querySelector('.quick-login-backdrop').addEventListener('click', hideQuickLoginModal);
      modal.querySelector('.quick-login-cancel').addEventListener('click', hideQuickLoginModal);
      modal.querySelector('.quick-login-form').addEventListener('submit', handleQuickLogin);
    }

    // Update modal content
    modal.querySelector('.quick-login-server').textContent = `${server.name} (${server.username}@${server.serverUrl})`;
    modal.querySelector('.quick-login-password').value = '';
    modal.querySelector('.quick-login-error').classList.remove('visible');
    modal.classList.add('active');
    modal.querySelector('.quick-login-password').focus();
  }

  function hideQuickLoginModal() {
    const modal = document.getElementById('quick-login-modal');
    if (modal) {
      modal.classList.remove('active');
    }
    quickLoginServer = null;
  }

  async function handleQuickLogin(e) {
    e.preventDefault();
    if (!quickLoginServer) return;

    const modal = document.getElementById('quick-login-modal');
    const password = modal.querySelector('.quick-login-password').value;
    const submitBtn = modal.querySelector('.quick-login-submit');
    const errorEl = modal.querySelector('.quick-login-error');

    setLoading(submitBtn, true);
    hideError(errorEl);

    try {
      await window.api.loginToSavedServer(quickLoginServer.id, password);
      hideQuickLoginModal();
      await loadLibrary();
      showScreen('library');
    } catch (err) {
      showError(errorEl, err.message || 'Login failed');
    } finally {
      setLoading(submitBtn, false);
    }
  }

  function handleBackToConnect() {
    elements.username.value = '';
    elements.password.value = '';
    hideError(elements.loginError);
    renderSavedServers();
    showScreen('connect');
  }

  // ============================================
  // Library Screen
  // ============================================

  async function loadLibrary() {
    try {
      // Load views
      const viewsResult = await window.api.getLibraryViews();

      // Render nav (no more Cache tab - it's now in Downloads page)
      elements.libraryNav.innerHTML = viewsResult.items.map((view, index) => `
        <button data-id="${view.id}" class="${index === 0 ? 'active' : ''}">${view.name}</button>
      `).join('');

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

      // Parse sort option (format: "field,direction")
      const [sortBy, sortOrder] = currentSort.split(',');

      const result = await window.api.getItems({
        parentId: currentLibraryId,
        includeItemTypes: 'Movie,Series',
        sortBy: sortBy,
        sortOrder: sortOrder,
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

    // Close settings/downloads pages if open
    if (elements.settingsPage.classList.contains('active')) {
      hideSettingsPage();
    }
    if (elements.downloadsPage.classList.contains('active')) {
      hideDownloadsPage();
    }

    // Update active state
    elements.libraryNav.querySelectorAll('button').forEach(btn => {
      btn.classList.remove('active');
    });
    button.classList.add('active');

    const tabId = button.dataset.id;

    // Regular library tab - no more cache handling here
    currentLibraryId = tabId;
    elements.searchInput.value = '';
    loadItems(true);
  }

  // Sort dropdown change handler
  function handleSortChange(e) {
    currentSort = e.target.value;
    saveSortPreference();
    loadItems(true);
  }

  // LocalStorage key for sort preference
  const SORT_PREF_KEY = 'jellydown_sort_preference';

  function saveSortPreference() {
    try {
      localStorage.setItem(SORT_PREF_KEY, currentSort);
    } catch {
      // localStorage might be disabled
    }
  }

  function loadSortPreference() {
    try {
      const savedSort = localStorage.getItem(SORT_PREF_KEY);
      if (savedSort) {
        currentSort = savedSort;
        // Update UI
        elements.sortSelect.value = currentSort;
      }
    } catch {
      // localStorage might be disabled
    }
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
    currentServerName = '';
    currentLibraryId = '';
    items = [];
    elements.serverUrl.value = '';
    elements.username.value = '';
    elements.password.value = '';
    elements.moviesGrid.innerHTML = '';

    // Reload and show saved servers
    await loadSavedServers();
    renderSavedServers();

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

        // Subtitle tracks
        if (item.subtitleStreams && item.subtitleStreams.length > 0) {
          elements.subtitleSelectContainer.style.display = 'block';
          elements.subtitleSelect.innerHTML = '<option value="-1">None</option>' +
            item.subtitleStreams.map(stream =>
              `<option value="${stream.index}">
                ${stream.displayTitle}
              </option>`
            ).join('');
          // Hide subtitle method options until a subtitle is selected
          elements.subtitleMethodContainer.style.display = 'none';
          const burnRadio = document.querySelector('input[name="subtitle-method"][value="burn"]');
          if (burnRadio) burnRadio.checked = true;
        } else {
          elements.subtitleSelectContainer.style.display = 'none';
          elements.subtitleMethodContainer.style.display = 'none';
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

      // If no seasons found, try to load episodes directly from the series
      if (seriesSeasons.length === 0) {
        console.log('[JellyDown] No seasons found, loading episodes directly from series');
        await loadEpisodesFromSeries(seriesId);
      } else {
        renderSeasons();
      }
    } catch (err) {
      console.error('Failed to load seasons:', err);
      elements.seriesList.innerHTML = '<p class="error">Failed to load seasons</p>';
    }
  }

  async function loadEpisodesFromSeries(seriesId) {
    try {
      const result = await window.api.getEpisodesFromSeries(seriesId);
      seasonEpisodes = result.items || [];

      if (seasonEpisodes.length === 0) {
        elements.seriesList.innerHTML = '<p class="series-empty">No episodes found for this series</p>';
        return;
      }

      // Set currentSeason to null since there are no seasons
      currentSeason = null;
      renderEpisodesNoSeason();
    } catch (err) {
      console.error('Failed to load episodes from series:', err);
      elements.seriesList.innerHTML = '<p class="error">Failed to load episodes</p>';
    }
  }

  function renderEpisodesNoSeason() {
    // Update breadcrumb - no season level
    elements.seriesBreadcrumb.innerHTML = `
      <span class="current">${currentSeries.name}</span>
      <span class="separator">›</span>
      <span class="current">Episodes</span>
    `;

    // Render episode list
    elements.seriesList.innerHTML = seasonEpisodes.map(ep => `
      <div class="series-list-item episode-item" data-episode-id="${ep.id}">
        <div class="series-list-item-thumb episode-thumb">
          ${ep.imageUrl
            ? `<img src="${ep.imageUrl}" alt="${ep.name}">`
            : `<div class="episode-number">E${ep.indexNumber || '?'}</div>`
          }
        </div>
        <div class="series-list-item-info">
          <div class="series-list-item-title">${ep.indexNumber ? `${ep.indexNumber}. ` : ''}${ep.name}</div>
          <div class="series-list-item-meta">
            ${ep.runtime ? formatRuntime(ep.runtime) : ''}
          </div>
        </div>
        <div class="series-list-item-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9,18 15,12 9,6"/>
          </svg>
        </div>
      </div>
    `).join('');

    // Add click handlers
    elements.seriesList.querySelectorAll('.episode-item').forEach(item => {
      item.addEventListener('click', () => {
        const episodeId = item.dataset.episodeId;
        const episode = seasonEpisodes.find(e => e.id === episodeId);
        if (episode) {
          selectEpisode(episode);
        }
      });
    });
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

    // Build season actions bar with preset selector and batch buttons
    const seasonActionsHtml = `
      <div class="season-actions">
        <div class="season-actions-preset">
          <select id="season-preset-select" class="season-preset-select">
            ${presets.map(p => `<option value="${p.id}" ${p.id === selectedPreset ? 'selected' : ''}>${p.resolution} (${p.bitrateFormatted})</option>`).join('')}
          </select>
        </div>
        <div class="season-actions-buttons">
          <button class="season-action-btn download-all" data-action="download-all">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7,10 12,15 17,10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Transcode All
          </button>
          <button class="season-action-btn cancel-all" data-action="cancel-all">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            Cancel All
          </button>
        </div>
      </div>
    `;

    // Render episode list with season actions at top
    elements.seriesList.innerHTML = seasonActionsHtml + seasonEpisodes.map(episode => `
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

    // Add click handlers for episode items
    elements.seriesList.querySelectorAll('.series-list-item').forEach(item => {
      item.addEventListener('click', () => {
        const episodeId = item.dataset.episodeId;
        openEpisodeDownload(episodeId);
      });
    });

    // Season actions event handlers
    const seasonPresetSelect = document.getElementById('season-preset-select');
    const downloadAllBtn = elements.seriesList.querySelector('[data-action="download-all"]');
    const cancelAllBtn = elements.seriesList.querySelector('[data-action="cancel-all"]');

    if (seasonPresetSelect) {
      seasonPresetSelect.addEventListener('change', (e) => {
        selectedPreset = e.target.value;
      });
    }

    if (downloadAllBtn) {
      downloadAllBtn.addEventListener('click', async () => {
        if (seasonEpisodes.length === 0) {
          showToast('No episodes to transcode', 'error');
          return;
        }

        const preset = selectedPreset;
        const items = seasonEpisodes.map(ep => ({ itemId: ep.id }));

        downloadAllBtn.disabled = true;
        downloadAllBtn.textContent = 'Starting...';

        try {
          const result = await window.api.startBatchDownload(items, preset);
          const successCount = result.results.filter(r => r.success).length;
          showToast(`Queued ${successCount} of ${items.length} episodes for transcoding`);
          refreshDownloadsList();
        } catch (err) {
          console.error('Batch download failed:', err);
          showToast('Failed to start transcodes: ' + err.message, 'error');
        } finally {
          downloadAllBtn.disabled = false;
          downloadAllBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7,10 12,15 17,10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Transcode All
          `;
        }
      });
    }

    if (cancelAllBtn) {
      cancelAllBtn.addEventListener('click', async () => {
        if (seasonEpisodes.length === 0) {
          showToast('No episodes in this season', 'error');
          return;
        }

        const itemIds = seasonEpisodes.map(ep => ep.id);

        cancelAllBtn.disabled = true;
        cancelAllBtn.textContent = 'Cancelling...';

        try {
          const result = await window.api.cancelBatchDownloads(itemIds);
          if (result.cancelled > 0 || result.removed > 0) {
            showToast(`Cancelled ${result.cancelled}, removed ${result.removed} transcodes`);
            refreshDownloadsList();
          } else {
            showToast('No active transcodes for this season');
          }
        } catch (err) {
          console.error('Batch cancel failed:', err);
          showToast('Failed to cancel transcodes: ' + err.message, 'error');
        } finally {
          cancelAllBtn.disabled = false;
          cancelAllBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            Cancel All
          `;
        }
      });
    }
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

      // Subtitle tracks
      if (episode.subtitleStreams && episode.subtitleStreams.length > 0) {
        elements.subtitleSelectContainer.style.display = 'block';
        elements.subtitleSelect.innerHTML = '<option value="-1">None</option>' +
          episode.subtitleStreams.map(stream =>
            `<option value="${stream.index}">
              ${stream.displayTitle}
            </option>`
          ).join('');
        // Hide subtitle method options until a subtitle is selected
        elements.subtitleMethodContainer.style.display = 'none';
        const burnRadio = document.querySelector('input[name="subtitle-method"][value="burn"]');
        if (burnRadio) burnRadio.checked = true;
      } else {
        elements.subtitleSelectContainer.style.display = 'none';
        elements.subtitleMethodContainer.style.display = 'none';
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
    // Get source video width to determine recommendations
    const sourceWidth = currentItem?.videoInfo?.width || 1920;

    elements.qualityPresets.innerHTML = presets.map(preset => {
      // Determine if this preset is higher resolution than source
      const isOverkill = preset.maxWidth > sourceWidth * 1.1; // 10% tolerance
      const isHevc = preset.videoCodec === 'hevc';

      return `
        <div class="quality-preset ${preset.id === selectedPreset ? 'selected' : ''} ${isOverkill ? 'overkill' : ''}" data-id="${preset.id}">
          <div class="quality-preset-header">
            <span class="quality-preset-name">${preset.resolution}</span>
            ${isHevc ? '<span class="quality-preset-badge hevc">HEVC</span>' : ''}
            ${isOverkill ? '<span class="quality-preset-badge overkill">Higher than source</span>' : ''}
          </div>
          <span class="quality-preset-info">${preset.bitrateFormatted} • ${preset.sizePerHourFormatted}</span>
          <span class="quality-preset-desc">${preset.description}</span>
        </div>
      `;
    }).join('');
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

  function handleSubtitleSelectChange() {
    const subtitleIndex = parseInt(elements.subtitleSelect.value);
    // Show subtitle method options only when a subtitle is selected
    if (subtitleIndex >= 0) {
      elements.subtitleMethodContainer.style.display = 'block';
    } else {
      elements.subtitleMethodContainer.style.display = 'none';
      // Reset to burn when no subtitle is selected
      const burnRadio = document.querySelector('input[name="subtitle-method"][value="burn"]');
      if (burnRadio) burnRadio.checked = true;
    }
  }

  function getSubtitleMethod() {
    const selected = document.querySelector('input[name="subtitle-method"]:checked');
    return selected ? selected.value : 'burn';
  }

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
    const subtitleStreamIndex = parseInt(elements.subtitleSelect.value);
    const subtitleMethod = getSubtitleMethod(); // 'burn' or 'soft'
    const preset = selectedPreset;

    console.log('audioStreamIndex:', audioStreamIndex);
    console.log('subtitleStreamIndex:', subtitleStreamIndex);
    console.log('subtitleMethod:', subtitleMethod);
    console.log('mediaSource:', item.mediaSource);

    // Close modal
    closeMovieModal();

    // Request notification permission on first download (non-blocking)
    if (!notificationsEnabled && Notification.permission === 'default') {
      requestNotificationPermission();
    }

    try {
      console.log('Calling downloadManager.startDownload');
      const result = await window.downloadManager.startDownload(
        item.id,
        item.mediaSource?.id,
        preset,
        audioStreamIndex,
        subtitleStreamIndex,
        subtitleMethod,
        `${item.name}.mp4`,
        item.name // Pass title for notifications
      );
      console.log('Download started:', result);

      // Show toast notification (stay on library page so user can queue more)
      showToast(`Started transcoding "${item.name}"`);

      // Update the download badge immediately
      refreshDownloadsList();
    } catch (err) {
      console.error('Transcode failed:', err);
      showToast('Failed to start transcode: ' + err.message, 'error');
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
      downloading: 'Transcoding segments...',
      processing: 'Processing final file...',
      completed: 'Transcode complete!'
    };
    elements.downloadStatus.textContent = statusTexts[data.status] || data.status;
  }

  async function handleCancelDownload() {
    await window.downloadManager.cancelCurrentDownload();
    hideDownloadOverlay();
  }

  // ============================================
  // Downloads Page
  // ============================================

  let downloadsPollInterval = null;
  let currentDownloadsTab = 'active';

  function showDownloadsPage() {
    // Close settings page if open
    if (elements.settingsPage.classList.contains('active')) {
      elements.settingsPage.classList.remove('active');
    }
    // Hide library content, show downloads page
    if (elements.libraryContent) {
      elements.libraryContent.style.display = 'none';
    }
    elements.downloadsPage.classList.add('active');

    // Start polling for updates
    refreshDownloadsList();
    downloadsPollInterval = setInterval(refreshDownloadsList, 2000);

    // Load cached files for the completed tab
    loadCacheForDownloadsPage();
  }

  function hideDownloadsPage() {
    elements.downloadsPage.classList.remove('active');
    if (elements.libraryContent) {
      elements.libraryContent.style.display = 'block';
    }

    // Stop polling
    if (downloadsPollInterval) {
      clearInterval(downloadsPollInterval);
      downloadsPollInterval = null;
    }
  }

  function switchDownloadsTab(tab) {
    currentDownloadsTab = tab;

    // Update tab buttons
    elements.downloadsPageTabs.querySelectorAll('.page-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Update content visibility
    elements.downloadsActive.classList.toggle('active', tab === 'active');
    elements.downloadsCompleted.classList.toggle('active', tab === 'completed');

    const logTab = document.getElementById('downloads-log');
    if (logTab) {
      logTab.classList.toggle('active', tab === 'log');
    }

    // Show/hide batch actions only on active tab
    elements.batchActions.style.display = tab === 'active' ? 'flex' : 'none';

    // Load content based on tab
    if (tab === 'completed') {
      loadCacheForDownloadsPage();
    }
  }

  // Alias for backwards compatibility
  function openDownloadsPanel() {
    showDownloadsPage();
  }

  function closeDownloadsPanel() {
    hideDownloadsPage();
  }

  // ============================================
  // Batch Queue Controls
  // ============================================

  async function handlePauseAll() {
    try {
      elements.pauseAllBtn.disabled = true;
      const result = await window.api.pauseAllDownloads();
      showToast(`Paused ${result.paused} transcode${result.paused !== 1 ? 's' : ''}`);
      refreshDownloadsList();
    } catch (err) {
      showToast('Failed to pause transcodes: ' + err.message, 'error');
    } finally {
      elements.pauseAllBtn.disabled = false;
    }
  }

  async function handleResumeAll() {
    try {
      elements.resumeAllBtn.disabled = true;
      const result = await window.api.resumeAllDownloads();
      showToast(`Resumed ${result.resumed} transcode${result.resumed !== 1 ? 's' : ''}`);
      refreshDownloadsList();
    } catch (err) {
      showToast('Failed to resume transcodes: ' + err.message, 'error');
    } finally {
      elements.resumeAllBtn.disabled = false;
    }
  }

  async function handleClearCompleted() {
    if (!confirm('Clear all completed, failed, and cancelled transcodes from the list?')) {
      return;
    }

    try {
      elements.clearCompletedBtn.disabled = true;
      const result = await window.api.clearCompletedDownloads();
      showToast(`Cleared ${result.cleared} transcode${result.cleared !== 1 ? 's' : ''}`);
      refreshDownloadsList();
    } catch (err) {
      showToast('Failed to clear transcodes: ' + err.message, 'error');
    } finally {
      elements.clearCompletedBtn.disabled = false;
    }
  }

  // ============================================
  // Cache / Completed Downloads
  // ============================================

  let cacheData = [];

  // Load cache data for the downloads page completed tab
  async function loadCacheForDownloadsPage() {
    try {
      const result = await window.api.getCached();
      cacheData = result.cached || [];
      renderCacheContent();
    } catch (err) {
      console.error('Failed to fetch cache:', err);
    }
  }

  function renderCacheContent() {
    const container = elements.cacheContent;
    if (!container) return;

    if (!cacheData || cacheData.length === 0) {
      container.innerHTML = `
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

    // Separate movies and episodes (default to movie if type not set)
    const movies = cacheData.filter(item => !item.type || item.type === 'movie');
    const episodes = cacheData.filter(item => item.type === 'episode');
    console.log('Movies:', movies.length, 'Episodes:', episodes.length);

    // Sort movies alphabetically by title
    movies.sort((a, b) => a.title.localeCompare(b.title));

    // Group episodes by series name, then by season
    const showsMap = new Map();
    episodes.forEach(ep => {
      const seriesName = ep.seriesName || 'Unknown Series';
      if (!showsMap.has(seriesName)) {
        showsMap.set(seriesName, new Map());
      }
      const seasonNum = ep.seasonNumber || 0;
      if (!showsMap.get(seriesName).has(seasonNum)) {
        showsMap.get(seriesName).set(seasonNum, []);
      }
      showsMap.get(seriesName).get(seasonNum).push(ep);
    });

    // Sort shows alphabetically, seasons numerically, episodes by episode number
    const sortedShows = Array.from(showsMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    sortedShows.forEach(([, seasons]) => {
      const sortedSeasons = Array.from(seasons.entries()).sort((a, b) => a[0] - b[0]);
      seasons.clear();
      sortedSeasons.forEach(([seasonNum, eps]) => {
        eps.sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0));
        seasons.set(seasonNum, eps);
      });
    });

    let html = '';

    // Movies section
    if (movies.length > 0) {
      html += `
        <div class="cache-section">
          <h3 class="cache-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
              <line x1="7" y1="2" x2="7" y2="22"/>
              <line x1="17" y1="2" x2="17" y2="22"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <line x1="2" y1="7" x2="7" y2="7"/>
              <line x1="2" y1="17" x2="7" y2="17"/>
              <line x1="17" y1="17" x2="22" y2="17"/>
              <line x1="17" y1="7" x2="22" y2="7"/>
            </svg>
            Movies (${movies.length})
          </h3>
          <table class="cache-table">
            <thead>
              <tr>
                <th class="col-title">Title</th>
                <th class="col-quality">Quality</th>
                <th class="col-size">Size</th>
                <th class="col-date">Date</th>
                <th class="col-retention">Retention</th>
                <th class="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${movies.map(item => `
                <tr data-cache-id="${item.id}">
                  <td class="col-title">${escapeHtml(item.title)}</td>
                  <td class="col-quality">${formatVideoQuality(item.videoInfo)}</td>
                  <td class="col-size">${item.sizeFormatted}</td>
                  <td class="col-date">${formatDate(item.createdAt)}</td>
                  <td class="col-retention">
                    <span class="retention-display">${formatRetention(item.retention)}</span>
                    <button class="cache-action-btn edit-retention-btn" data-action="edit-retention" title="Edit retention">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                  </td>
                  <td class="col-actions">
                    <button class="cache-action-btn" data-action="download" title="Download">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7,10 12,15 17,10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                    </button>
                    <button class="cache-action-btn delete-btn" data-action="delete" title="Delete">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3,6 5,6 21,6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      </svg>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    // TV Shows section
    if (sortedShows.length > 0) {
      html += `
        <div class="cache-section">
          <h3 class="cache-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="7" width="20" height="15" rx="2" ry="2"/>
              <polyline points="17,2 12,7 7,2"/>
            </svg>
            TV Shows (${episodes.length} episodes)
          </h3>
      `;

      sortedShows.forEach(([seriesName, seasons]) => {
        const episodeCount = Array.from(seasons.values()).reduce((sum, eps) => sum + eps.length, 0);
        html += `
          <div class="cache-show-group">
            <h4 class="cache-show-title">${escapeHtml(seriesName)} <span class="episode-count">(${episodeCount} episodes)</span></h4>
        `;

        Array.from(seasons.entries()).forEach(([seasonNum, eps]) => {
          html += `
            <div class="cache-season-group">
              <h5 class="cache-season-title">Season ${seasonNum}</h5>
              <table class="cache-table">
                <thead>
                  <tr>
                    <th class="col-ep">Ep</th>
                    <th class="col-title">Title</th>
                    <th class="col-quality">Quality</th>
                    <th class="col-size">Size</th>
                    <th class="col-date">Date</th>
                    <th class="col-retention">Retention</th>
                    <th class="col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${eps.map(ep => `
                    <tr data-cache-id="${ep.id}">
                      <td class="col-ep">${ep.episodeNumber || '-'}</td>
                      <td class="col-title">${escapeHtml(ep.episodeName || ep.title)}</td>
                      <td class="col-quality">${formatVideoQuality(ep.videoInfo)}</td>
                      <td class="col-size">${ep.sizeFormatted}</td>
                      <td class="col-date">${formatDate(ep.createdAt)}</td>
                      <td class="col-retention">
                        <span class="retention-display">${formatRetention(ep.retention)}</span>
                        <button class="cache-action-btn edit-retention-btn" data-action="edit-retention" title="Edit retention">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                      </td>
                      <td class="col-actions">
                        <button class="cache-action-btn" data-action="download" title="Download">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7,10 12,15 17,10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                        </button>
                        <button class="cache-action-btn delete-btn" data-action="delete" title="Delete">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3,6 5,6 21,6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `;
        });

        html += '</div>';
      });

      html += '</div>';
    }

    container.innerHTML = html;

    // Add event listeners for all action buttons
    container.querySelectorAll('tr[data-cache-id]').forEach(row => {
      const id = row.dataset.cacheId;
      const cacheItem = cacheData.find(c => c.id === id);

      row.querySelector('[data-action="download"]').addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.href = window.api.getCacheStreamUrl(id);
      });

      row.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
        e.stopPropagation();
        const displayTitle = cacheItem?.episodeName || cacheItem?.title || 'this item';
        if (confirm(`Delete "${displayTitle}" from cache?`)) {
          try {
            await window.api.deleteCached(id);
            loadCacheForDownloadsPage();
            showToast('Deleted from cache');
          } catch (err) {
            showToast('Failed to delete: ' + err.message, 'error');
          }
        }
      });

      const editRetentionBtn = row.querySelector('[data-action="edit-retention"]');
      if (editRetentionBtn) {
        editRetentionBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          handleEditRetention(id);
        });
      }
    });
  }

  function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatRetention(retention) {
    if (!retention) return '<span class="retention-forever">Forever</span>';
    if (retention.effectiveDays === null) return '<span class="retention-forever">Forever</span>';

    const suffix = retention.isOverride ? ' <span class="retention-override">(custom)</span>' : '';

    if (retention.expiresAt) {
      const daysRemaining = Math.ceil((new Date(retention.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysRemaining <= 0) return `<span class="retention-expired">Expired</span>${suffix}`;
      if (daysRemaining <= 7) return `<span class="retention-warning">${daysRemaining}d left</span>${suffix}`;
      return `<span class="retention-normal">${daysRemaining}d left</span>${suffix}`;
    }
    return `<span class="retention-normal">${retention.effectiveDays}d</span>${suffix}`;
  }

  async function handleEditRetention(cacheId) {
    const cacheItem = cacheData.find(c => c.id === cacheId);
    const current = cacheItem?.retention?.retentionDays ?? cacheItem?.retention?.effectiveDays ?? null;

    const input = prompt(
      'Enter retention in days (1-365), or leave empty for "forever":',
      current === null ? '' : current.toString()
    );

    if (input === null) return; // Cancelled

    let retentionDays;
    if (input.trim() === '' || input.toLowerCase() === 'forever') {
      retentionDays = null;
    } else {
      retentionDays = parseInt(input, 10);
      if (isNaN(retentionDays) || retentionDays < 1 || retentionDays > 365) {
        showToast('Invalid retention value. Must be 1-365 days or empty for forever.', 'error');
        return;
      }
    }

    try {
      await window.api.updateCachedRetention(cacheId, retentionDays);
      showToast('Retention updated');
      loadCacheForDownloadsPage();
    } catch (err) {
      showToast('Failed to update retention: ' + err.message, 'error');
    }
  }

  function formatVideoQuality(videoInfo) {
    if (!videoInfo) return '<span class="quality-unknown">--</span>';

    const parts = [];

    // Resolution badge
    if (videoInfo.resolutionLabel) {
      parts.push(`<span class="quality-badge quality-resolution">${videoInfo.resolutionLabel}</span>`);
    }

    // Codec badge
    if (videoInfo.codecLabel) {
      const codecClass = videoInfo.codec === 'hevc' || videoInfo.codec === 'h265' ? 'hevc' : '';
      parts.push(`<span class="quality-badge quality-codec ${codecClass}">${videoInfo.codecLabel}</span>`);
    }

    // Bitrate
    if (videoInfo.bitrateFormatted) {
      parts.push(`<span class="quality-bitrate">${videoInfo.bitrateFormatted}</span>`);
    }

    return parts.join(' ') || '<span class="quality-unknown">--</span>';
  }

  // ============================================
  // Settings Page
  // ============================================

  async function showSettingsPage() {
    // Close downloads page if open
    if (elements.downloadsPage.classList.contains('active')) {
      hideDownloadsPage();
    }
    // Show the settings page
    if (elements.libraryContent) {
      elements.libraryContent.style.display = 'none';
    }
    if (elements.settingsPage) {
      elements.settingsPage.classList.add('active');
    } else {
      console.error('Settings page element not found');
      showToast('Settings page not available', 'error');
      return;
    }

    // Hide the inline preset editor
    closePresetEditor();

    // Hide save success message
    if (elements.settingsSaveSuccess) {
      elements.settingsSaveSuccess.classList.remove('visible');
    }

    // Load settings data
    try {
      const settings = await window.api.getSettings();
      if (elements.maxConcurrentInput) {
        elements.maxConcurrentInput.value = settings.maxConcurrentDownloads || 5;
      }
      if (elements.downloadsDirInput) {
        elements.downloadsDirInput.value = settings.downloadsDir || '';
      }
      // Load retention settings
      if (elements.defaultRetentionType) {
        const retention = settings.defaultRetentionDays;
        if (retention === null || retention === undefined) {
          elements.defaultRetentionType.value = 'forever';
          elements.defaultRetentionDays.style.display = 'none';
          elements.retentionDaysLabel.style.display = 'none';
        } else {
          elements.defaultRetentionType.value = 'days';
          elements.defaultRetentionDays.value = retention;
          elements.defaultRetentionDays.style.display = 'inline-block';
          elements.retentionDaysLabel.style.display = 'inline';
        }
      }
      currentPresets = settings.presets || [];
      renderPresetsList();
    } catch (err) {
      console.error('Failed to load settings:', err);
      showToast('Failed to load settings', 'error');
    }

    // Fetch and display server information (non-blocking)
    loadServerInfo();
  }

  async function loadServerInfo() {
    const serverNameEl = document.getElementById('server-info-name');
    const serverVersionEl = document.getElementById('server-info-version');
    const hwaccelStatusEl = document.getElementById('hwaccel-status');

    // Set loading state
    if (hwaccelStatusEl) {
      hwaccelStatusEl.textContent = 'Loading...';
      hwaccelStatusEl.className = 'hwaccel-status loading';
    }

    try {
      const systemInfo = await window.api.getSystemInfo();

      if (serverNameEl) serverNameEl.textContent = systemInfo.serverName || 'Unknown';
      if (serverVersionEl) serverVersionEl.textContent = systemInfo.version || 'Unknown';

      if (hwaccelStatusEl) {
        const accelType = systemInfo.encoderLocationType || 'software';

        // Check for error states
        if (accelType === 'error' || accelType === 'unknown (requires admin)') {
          hwaccelStatusEl.textContent = 'Unavailable';
          hwaccelStatusEl.className = 'hwaccel-status loading';
          hwaccelStatusEl.title = 'Could not retrieve hardware acceleration info. Try logging out and back in.';
        } else if (systemInfo.hardwareAccelerationEnabled) {
          hwaccelStatusEl.textContent = accelType.toUpperCase();
          hwaccelStatusEl.className = 'hwaccel-status enabled';
          hwaccelStatusEl.title = 'Hardware acceleration is enabled';
        } else {
          hwaccelStatusEl.textContent = 'Software';
          hwaccelStatusEl.className = 'hwaccel-status disabled';
          hwaccelStatusEl.title = 'Using software encoding';
        }
      }
    } catch (err) {
      console.error('Failed to load server info:', err);
      if (serverNameEl) serverNameEl.textContent = 'Error';
      if (serverVersionEl) serverVersionEl.textContent = 'Error';
      if (hwaccelStatusEl) {
        hwaccelStatusEl.textContent = 'Unknown';
        hwaccelStatusEl.className = 'hwaccel-status loading';
      }
    }
  }

  function hideSettingsPage() {
    elements.settingsPage.classList.remove('active');
    if (elements.libraryContent) {
      elements.libraryContent.style.display = 'block';
    }
    // Close preset editor if open
    closePresetEditor();
  }

  // Debounce timer for auto-save
  let settingsSaveTimeout = null;

  async function saveSettings(showFeedback = false) {
    try {
      const maxConcurrent = parseInt(elements.maxConcurrentInput.value, 10);
      if (isNaN(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 20) {
        if (showFeedback) showToast('Max concurrent transcodes must be between 1 and 20', 'error');
        return;
      }

      const downloadsDir = elements.downloadsDirInput.value.trim();
      if (!downloadsDir) {
        if (showFeedback) showToast('Downloads directory is required', 'error');
        return;
      }

      // Get retention setting
      const retentionType = elements.defaultRetentionType?.value;
      let defaultRetentionDays = null;
      if (retentionType === 'days') {
        const days = parseInt(elements.defaultRetentionDays.value, 10);
        if (isNaN(days) || days < 1 || days > 365) {
          if (showFeedback) showToast('Retention days must be between 1 and 365', 'error');
          return;
        }
        defaultRetentionDays = days;
      }

      await window.api.updateSettings({
        maxConcurrentDownloads: maxConcurrent,
        downloadsDir: downloadsDir,
        presets: currentPresets,
        defaultRetentionDays: defaultRetentionDays
      });

      // Show inline success message briefly
      if (elements.settingsSaveSuccess) {
        elements.settingsSaveSuccess.classList.add('visible');
        setTimeout(() => {
          elements.settingsSaveSuccess.classList.remove('visible');
        }, 1500);
      }

      // Also reload presets for the quality selector
      const presetsResult = await window.api.getPresets();
      presets = presetsResult.presets;

    } catch (err) {
      console.error('Failed to save settings:', err);
      if (showFeedback) showToast('Failed to save settings: ' + err.message, 'error');
    }
  }

  function debouncedSaveSettings() {
    clearTimeout(settingsSaveTimeout);
    settingsSaveTimeout = setTimeout(() => saveSettings(false), 500);
  }

  // ============================================
  // Preset Editor
  // ============================================

  let currentPresets = [];
  let editingPresetIndex = -1;

  function renderPresetsList() {
    elements.presetsList.innerHTML = '';

    currentPresets.forEach((preset, index) => {
      const resolution = preset.maxWidth <= 854 ? '480p' :
                        preset.maxWidth <= 1280 ? '720p' :
                        preset.maxWidth <= 1920 ? '1080p' : '4K';
      const videoBitrateMbps = (preset.maxBitrate / 1_000_000).toFixed(1);
      const audioBitrateKbps = preset.audioBitrate / 1000;
      const codecLabel = preset.videoCodec === 'hevc' ? 'HEVC' : 'H.264';

      const item = document.createElement('div');
      item.className = 'preset-item';
      item.innerHTML = `
        <div class="preset-item-info">
          <div class="preset-item-name">${preset.name}</div>
          <div class="preset-item-details">${resolution} • ${codecLabel} • ${videoBitrateMbps} Mbps video • ${audioBitrateKbps} kbps audio</div>
        </div>
        <div class="preset-item-actions">
          <button class="edit-btn" data-index="${index}">Edit</button>
          <button class="delete-btn" data-index="${index}">Delete</button>
        </div>
      `;
      elements.presetsList.appendChild(item);
    });

    // Add event listeners
    elements.presetsList.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => openPresetEditor(parseInt(e.target.dataset.index)));
    });
    elements.presetsList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => deletePreset(parseInt(e.target.dataset.index)));
    });
  }

  function openPresetEditor(index = -1) {
    editingPresetIndex = index;

    if (index >= 0) {
      // Editing existing preset
      const preset = currentPresets[index];
      elements.presetEditorTitle.textContent = 'Edit Preset';
      elements.presetNameInput.value = preset.name;
      elements.presetMaxWidthInput.value = preset.maxWidth;
      elements.presetVideoBitrateInput.value = preset.maxBitrate / 1_000_000;
      elements.presetAudioBitrateInput.value = preset.audioBitrate / 1000;
      elements.presetAudioChannelsSelect.value = preset.audioChannels;
      elements.presetVideoCodecSelect.value = preset.videoCodec || 'h264';
    } else {
      // Adding new preset
      elements.presetEditorTitle.textContent = 'Add Preset';
      elements.presetNameInput.value = '';
      elements.presetMaxWidthInput.value = 1920;
      elements.presetVideoBitrateInput.value = 5;
      elements.presetAudioBitrateInput.value = 192;
      elements.presetAudioChannelsSelect.value = 2;
      elements.presetVideoCodecSelect.value = 'h264';
    }

    // Show inline editor
    elements.presetEditor.classList.add('active');
    // Scroll to editor
    elements.presetEditor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closePresetEditor() {
    if (elements.presetEditor) {
      elements.presetEditor.classList.remove('active');
    }
    editingPresetIndex = -1;
  }

  function savePreset() {
    const name = elements.presetNameInput.value.trim();
    if (!name) {
      showToast('Preset name is required', 'error');
      return;
    }

    const preset = {
      id: editingPresetIndex >= 0 ? currentPresets[editingPresetIndex].id : `custom_${Date.now()}`,
      name: name,
      maxWidth: parseInt(elements.presetMaxWidthInput.value),
      maxBitrate: parseFloat(elements.presetVideoBitrateInput.value) * 1_000_000,
      audioBitrate: parseInt(elements.presetAudioBitrateInput.value) * 1000,
      audioChannels: parseInt(elements.presetAudioChannelsSelect.value),
      videoCodec: elements.presetVideoCodecSelect.value,
      audioCodec: 'aac'
    };

    if (editingPresetIndex >= 0) {
      currentPresets[editingPresetIndex] = preset;
    } else {
      currentPresets.push(preset);
    }

    renderPresetsList();
    closePresetEditor();
  }

  function deletePreset(index) {
    if (currentPresets.length <= 1) {
      showToast('You must have at least one preset', 'error');
      return;
    }
    currentPresets.splice(index, 1);
    renderPresetsList();
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
    // Filter to only show active items (not completed/failed/cancelled)
    // Those belong in the Completed tab (from cache)
    const activeDownloads = (downloads || []).filter(d =>
      d.status !== 'completed' && d.status !== 'failed' && d.status !== 'cancelled'
    );

    if (activeDownloads.length === 0) {
      elements.downloadsEmpty.style.display = 'flex';
      // Remove any existing download items
      const items = elements.downloadsList.querySelectorAll('.download-item');
      items.forEach(item => item.remove());
      return;
    }

    elements.downloadsEmpty.style.display = 'none';

    // Update or create download items
    activeDownloads.forEach(download => {
      let item = elements.downloadsList.querySelector(`[data-session-id="${download.sessionId}"]`);

      if (!item) {
        item = createDownloadItem(download);
        elements.downloadsList.insertBefore(item, elements.downloadsEmpty);
      } else {
        updateDownloadItem(item, download);
      }
    });

    // Remove items that no longer exist
    const existingIds = new Set(activeDownloads.map(d => d.sessionId));
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
    const progressPercent = Math.round((download.progress || 0) * 100);

    let progressContent = '';
    let statsContent = '';

    if (isTranscoding) {
      const bytesDownloaded = download.bytesDownloaded || 0;
      const progress = download.progress || 0;
      // Estimate total size based on progress (only if we have meaningful progress)
      const estimatedTotal = progress > 0.01 ? Math.round(bytesDownloaded / progress) : 0;
      const sizeStr = estimatedTotal > 0
        ? `${formatBytes(bytesDownloaded)} / ${formatBytes(estimatedTotal)}`
        : formatBytes(bytesDownloaded);

      progressContent = `
        <div class="download-item-progress">
          <div class="progress-bar transcoding">
            <div class="progress-fill" style="width: ${progressPercent}%"></div>
          </div>
        </div>
      `;
      statsContent = `
        <div class="download-item-stats">
          <span class="percent">${progressPercent}%</span>
          <span class="size">${sizeStr}</span>
        </div>
      `;
    } else if (download.status === 'downloading') {
      const { speed, eta } = calculateSpeedAndETA(download);
      const speedStr = formatSpeed(speed);
      const etaStr = eta ? formatETA(eta) : '--';
      const bytesStr = formatBytes(download.bytesDownloaded || 0);

      progressContent = `
        <div class="download-item-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${progressPercent}%"></div>
          </div>
        </div>
      `;
      statsContent = `
        <div class="download-item-stats">
          <span class="percent">${progressPercent}%</span>
          <span class="speed">${speedStr}</span>
          <span class="eta">ETA: ${etaStr}</span>
          <span class="size">${bytesStr}</span>
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
      const progressPercent = Math.round((download.progress || 0) * 100);
      if (progressFill) {
        progressFill.style.width = `${progressPercent}%`;
      }
      const percentEl = item.querySelector('.percent');
      if (percentEl) {
        percentEl.textContent = `${progressPercent}%`;
      }
      // Update file size display
      const sizeEl = item.querySelector('.size');
      if (sizeEl) {
        const bytesDownloaded = download.bytesDownloaded || 0;
        const progress = download.progress || 0;
        const estimatedTotal = progress > 0.01 ? Math.round(bytesDownloaded / progress) : 0;
        const sizeStr = estimatedTotal > 0
          ? `${formatBytes(bytesDownloaded)} / ${formatBytes(estimatedTotal)}`
          : formatBytes(bytesDownloaded);
        sizeEl.textContent = sizeStr;
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

      // Update speed and ETA for downloading status
      if (download.status === 'downloading') {
        const { speed, eta } = calculateSpeedAndETA(download);
        const speedEl = item.querySelector('.speed');
        if (speedEl) {
          speedEl.textContent = formatSpeed(speed);
        }
        const etaEl = item.querySelector('.eta');
        if (etaEl) {
          etaEl.textContent = `ETA: ${eta ? formatETA(eta) : '--'}`;
        }
        const sizeEl = item.querySelector('.size');
        if (sizeEl) {
          sizeEl.textContent = formatBytes(download.bytesDownloaded || 0);
        }
      } else {
        // Other statuses - update segments display
        const segmentsEl = item.querySelector('.segments');
        if (segmentsEl) {
          segmentsEl.textContent = `${download.completedSegments} / ${download.totalSegments} segments`;
        }
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
          showToast(`Resuming "${download.title || 'transcode'}"...`);
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
      downloading: 'Transcoding',
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
  // Theme Management
  // ============================================

  const THEME_PREF_KEY = 'jellydown_theme';
  let currentTheme = 'system'; // 'system', 'dark', 'light'

  function initTheme() {
    // Load saved preference
    try {
      const saved = localStorage.getItem(THEME_PREF_KEY);
      if (saved && ['system', 'dark', 'light'].includes(saved)) {
        currentTheme = saved;
      }
    } catch {
      // localStorage might be disabled
    }

    applyTheme();
    updateThemeToggleUI();

    // Listen for system preference changes
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (currentTheme === 'system') {
          applyTheme();
        }
      });
    }
  }

  function applyTheme() {
    let effectiveTheme = currentTheme;

    if (currentTheme === 'system') {
      // Detect system preference
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        effectiveTheme = 'light';
      } else {
        effectiveTheme = 'dark';
      }
    }

    // Apply theme to document
    if (effectiveTheme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  function setTheme(theme) {
    if (!['system', 'dark', 'light'].includes(theme)) return;

    currentTheme = theme;
    applyTheme();
    updateThemeToggleUI();

    // Save preference
    try {
      localStorage.setItem(THEME_PREF_KEY, theme);
    } catch {
      // localStorage might be disabled
    }
  }

  function updateThemeToggleUI() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;

    toggle.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === currentTheme);
    });
  }

  // ============================================
  // Poster Size
  // ============================================

  const POSTER_SIZE_KEY = 'jellydown_poster_size';
  let currentPosterSize = 'medium'; // 'small', 'medium', 'large', 'xlarge'

  function initPosterSize() {
    // Load saved preference
    try {
      const saved = localStorage.getItem(POSTER_SIZE_KEY);
      if (saved && ['small', 'medium', 'large', 'xlarge'].includes(saved)) {
        currentPosterSize = saved;
      }
    } catch {
      // localStorage might be disabled
    }

    applyPosterSize();
    updatePosterSizeToggleUI();
  }

  function applyPosterSize() {
    const grid = elements.moviesGrid;
    if (!grid) return;

    // Remove all size classes
    grid.classList.remove('poster-small', 'poster-medium', 'poster-large', 'poster-xlarge');
    // Add current size class
    grid.classList.add(`poster-${currentPosterSize}`);
  }

  function setPosterSize(size) {
    if (!['small', 'medium', 'large', 'xlarge'].includes(size)) return;

    currentPosterSize = size;
    applyPosterSize();
    updatePosterSizeToggleUI();

    // Save preference
    try {
      localStorage.setItem(POSTER_SIZE_KEY, size);
    } catch {
      // localStorage might be disabled
    }
  }

  function updatePosterSizeToggleUI() {
    const toggle = document.getElementById('size-toggle');
    if (!toggle) return;

    toggle.querySelectorAll('.size-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.size === currentPosterSize);
    });
  }

  // ============================================
  // Event Log
  // ============================================

  const EVENT_LOG_KEY = 'jellydown_event_log';
  const MAX_LOG_ENTRIES = 50;
  let eventLog = [];

  function initEventLog() {
    try {
      const saved = localStorage.getItem(EVENT_LOG_KEY);
      if (saved) {
        eventLog = JSON.parse(saved);
      }
    } catch {
      eventLog = [];
    }
  }

  function addLogEntry(type, title, details = null) {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      type, // 'started', 'completed', 'failed', 'cancelled'
      title,
      details,
      timestamp: new Date().toISOString()
    };

    eventLog.unshift(entry);

    // Keep only last 50 entries
    if (eventLog.length > MAX_LOG_ENTRIES) {
      eventLog = eventLog.slice(0, MAX_LOG_ENTRIES);
    }

    saveEventLog();
    renderEventLog();
  }

  function saveEventLog() {
    try {
      localStorage.setItem(EVENT_LOG_KEY, JSON.stringify(eventLog));
    } catch {
      // localStorage might be full or disabled
    }
  }

  function clearEventLog() {
    eventLog = [];
    saveEventLog();
    renderEventLog();
    showToast('Event log cleared');
  }

  function renderEventLog() {
    const container = document.getElementById('event-log-content');
    if (!container) return;

    if (eventLog.length === 0) {
      container.innerHTML = `
        <div class="event-log-empty">
          <p>No events recorded yet</p>
          <span>Download activity will appear here</span>
        </div>
      `;
      return;
    }

    container.innerHTML = eventLog.map(entry => {
      const time = new Date(entry.timestamp);
      const timeStr = time.toLocaleString();
      const relativeTime = getRelativeTime(time);

      let icon = '';
      let statusClass = '';
      switch (entry.type) {
        case 'started':
          icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
          statusClass = 'started';
          break;
        case 'completed':
          icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20,6 9,17 4,12"/></svg>';
          statusClass = 'completed';
          break;
        case 'failed':
          icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
          statusClass = 'failed';
          break;
        case 'cancelled':
          icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
          statusClass = 'cancelled';
          break;
      }

      return `
        <div class="event-log-entry ${statusClass}">
          <div class="event-log-icon">${icon}</div>
          <div class="event-log-info">
            <div class="event-log-title">${escapeHtml(entry.title)}</div>
            ${entry.details ? `<div class="event-log-details">${escapeHtml(entry.details)}</div>` : ''}
            <div class="event-log-time" title="${timeStr}">${relativeTime}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function getRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  }

  // ============================================
  // Notifications
  // ============================================

  const NOTIFICATION_PREF_KEY = 'jellydown_notifications_enabled';
  let notificationsEnabled = false;
  let notificationPermission = 'default';

  // Check if notifications are supported and enabled
  function initNotifications() {
    if (!('Notification' in window)) {
      console.log('[Notifications] Not supported in this browser');
      return;
    }

    notificationPermission = Notification.permission;

    // Load user preference
    try {
      notificationsEnabled = localStorage.getItem(NOTIFICATION_PREF_KEY) === 'true';
    } catch {
      // localStorage might be disabled
    }

    // If permission was already granted, enable notifications
    if (notificationPermission === 'granted' && notificationsEnabled) {
      console.log('[Notifications] Enabled');
    }
  }

  // Request notification permission (called on first download)
  async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;

    if (Notification.permission === 'granted') {
      notificationsEnabled = true;
      saveNotificationPreference(true);
      return true;
    }

    if (Notification.permission === 'denied') {
      console.log('[Notifications] Permission previously denied');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      notificationPermission = permission;

      if (permission === 'granted') {
        notificationsEnabled = true;
        saveNotificationPreference(true);
        console.log('[Notifications] Permission granted');
        return true;
      }
    } catch (err) {
      console.error('[Notifications] Permission request failed:', err);
    }

    return false;
  }

  function saveNotificationPreference(enabled) {
    try {
      localStorage.setItem(NOTIFICATION_PREF_KEY, enabled ? 'true' : 'false');
    } catch {
      // localStorage might be disabled
    }
  }

  // Send a notification
  function sendNotification(title, body, options = {}) {
    if (!notificationsEnabled || Notification.permission !== 'granted') {
      return;
    }

    try {
      const notification = new Notification(title, {
        body: body,
        icon: '/favicon.ico', // Use app icon if available
        badge: '/favicon.ico',
        tag: options.tag || 'jellydown-notification',
        renotify: options.renotify || false,
        silent: options.silent || false,
        ...options
      });

      // Auto-close after 5 seconds
      setTimeout(() => {
        notification.close();
      }, 5000);

      // Focus window when clicked
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (err) {
      console.error('[Notifications] Failed to send:', err);
    }
  }

  // Notify on transcode complete
  function notifyDownloadComplete(title) {
    sendNotification(
      'Transcode Complete',
      `"${title}" has finished transcoding`,
      { tag: 'download-complete', renotify: true }
    );
  }

  // Notify on transcode failed
  function notifyDownloadFailed(title, error) {
    sendNotification(
      'Transcode Failed',
      `"${title}" failed: ${error}`,
      { tag: 'download-failed', renotify: true }
    );
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

  // Format speed (bytes per second)
  function formatSpeed(bytesPerSecond) {
    if (!bytesPerSecond || bytesPerSecond <= 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Format ETA (seconds to human readable)
  function formatETA(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) {
      const mins = Math.floor(seconds / 60);
      const secs = Math.round(seconds % 60);
      return `${mins}m ${secs}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }

  // Calculate download speed and ETA from download data
  function calculateSpeedAndETA(download) {
    if (!download.downloadStartedAt || !download.bytesDownloaded) {
      return { speed: 0, eta: null };
    }

    const startTime = new Date(download.downloadStartedAt).getTime();
    const elapsedMs = Date.now() - startTime;
    const elapsedSeconds = elapsedMs / 1000;

    if (elapsedSeconds <= 0) return { speed: 0, eta: null };

    const speed = download.bytesDownloaded / elapsedSeconds;

    // Estimate total size based on progress
    // If we have X bytes at Y% progress, total = X / (Y/100)
    let eta = null;
    if (download.progress > 0 && download.progress < 1) {
      const estimatedTotalBytes = download.bytesDownloaded / download.progress;
      const remainingBytes = estimatedTotalBytes - download.bytesDownloaded;
      eta = remainingBytes / speed;
    }

    return { speed, eta };
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

    // Header logo - go back to default view
    const headerLogoLink = document.getElementById('header-logo-link');
    if (headerLogoLink) {
      headerLogoLink.addEventListener('click', (e) => {
        e.preventDefault();
        // Close settings/downloads pages if open
        if (elements.settingsPage.classList.contains('active')) {
          hideSettingsPage();
        }
        if (elements.downloadsPage.classList.contains('active')) {
          hideDownloadsPage();
        }
      });
    }

    // Sort controls
    elements.sortSelect.addEventListener('change', handleSortChange);

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

    // Subtitle selection - show/hide method options
    elements.subtitleSelect.addEventListener('change', handleSubtitleSelectChange);

    // Downloads page
    elements.downloadsBtn.addEventListener('click', showDownloadsPage);
    elements.downloadsBack.addEventListener('click', hideDownloadsPage);

    // Downloads page tabs
    elements.downloadsPageTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.page-tab');
      if (tab && tab.dataset.tab) {
        switchDownloadsTab(tab.dataset.tab);
      }
    });

    // Batch actions
    elements.pauseAllBtn.addEventListener('click', handlePauseAll);
    elements.resumeAllBtn.addEventListener('click', handleResumeAll);
    elements.clearCompletedBtn.addEventListener('click', handleClearCompleted);

    // Clear log button
    const clearLogBtn = document.getElementById('clear-log-btn');
    if (clearLogBtn) {
      clearLogBtn.addEventListener('click', clearEventLog);
    }

    // Settings page
    elements.settingsBtn.addEventListener('click', showSettingsPage);
    elements.settingsBack.addEventListener('click', hideSettingsPage);

    // Auto-save settings on input change
    if (elements.maxConcurrentInput) {
      elements.maxConcurrentInput.addEventListener('input', debouncedSaveSettings);
    }
    if (elements.downloadsDirInput) {
      elements.downloadsDirInput.addEventListener('input', debouncedSaveSettings);
    }

    // Retention settings
    if (elements.defaultRetentionType) {
      elements.defaultRetentionType.addEventListener('change', (e) => {
        const isForever = e.target.value === 'forever';
        elements.defaultRetentionDays.style.display = isForever ? 'none' : 'inline-block';
        elements.retentionDaysLabel.style.display = isForever ? 'none' : 'inline';
        debouncedSaveSettings();
      });
    }
    if (elements.defaultRetentionDays) {
      elements.defaultRetentionDays.addEventListener('input', debouncedSaveSettings);
    }

    // Inline preset editor
    elements.addPresetBtn.addEventListener('click', () => openPresetEditor(-1));
    elements.cancelPresetEdit.addEventListener('click', closePresetEditor);
    elements.savePresetBtn.addEventListener('click', savePreset);

    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.theme-btn');
        if (btn && btn.dataset.theme) {
          setTheme(btn.dataset.theme);
        }
      });
    }

    // Poster size toggle
    const sizeToggle = document.getElementById('size-toggle');
    if (sizeToggle) {
      sizeToggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.size-btn');
        if (btn && btn.dataset.size) {
          setPosterSize(btn.dataset.size);
        }
      });
    }

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (elements.presetEditor.classList.contains('active')) {
          closePresetEditor();
        } else if (elements.settingsPage.classList.contains('active')) {
          hideSettingsPage();
        } else if (elements.downloadsPage.classList.contains('active')) {
          hideDownloadsPage();
        } else if (elements.modal.classList.contains('active')) {
          closeMovieModal();
        }
      }
    });

    // Download manager callbacks - show toast notifications instead of overlay
    window.downloadManager.onProgress((data) => {
      // Progress is shown in the downloads panel, not here
    });
    window.downloadManager.onComplete((title) => {
      showToast('Transcode complete!');
      notifyDownloadComplete(title || 'Transcode');
      refreshDownloadsList();
    });
    window.downloadManager.onError((error, title) => {
      showToast('Transcode failed: ' + error, 'error');
      notifyDownloadFailed(title || 'Transcode', error);
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

    // Initialize theme (do this early for faster rendering)
    initTheme();

    // Initialize poster size
    initPosterSize();

    // Load saved sort preferences
    loadSortPreference();

    // Initialize notifications
    initNotifications();

    // Initialize event log
    initEventLog();

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

    // Load saved servers from backend and show on connect screen
    await loadSavedServers();
    renderSavedServers();
    showScreen('connect');
  }

  // Start the app
  init();
})();
