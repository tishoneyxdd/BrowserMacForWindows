
/* global window, document */

const APP_NAME = 'Safari for Windows';
const STORAGE_KEY = 'safari-windows-state-v2';
const MAX_HISTORY_ITEMS = 1500;
const MAX_BOOKMARKS = 500;
const DUCKDUCKGO_SEARCH_URL = 'https://duckduckgo.com/?q=%s';

const DEFAULT_SETTINGS = {
  homepage: 'about:newtab',
  showBookmarksBar: true,
  openLinksInNewTab: true
};

const state = {
  tabs: [],
  activeTabId: null,
  bookmarks: [],
  history: [],
  downloads: [],
  settings: { ...DEFAULT_SETTINGS },
  restoredSessionTabs: [],
  restoredActiveTabId: null
};

const webviewByTabId = new Map();
let tabCounter = 0;
let panelType = null;
let persistTimer = null;
let suggestions = [];
let activeSuggestionIndex = -1;

const refs = {
  tabStrip: document.getElementById('tabStrip'),
  newTabBtn: document.getElementById('newTabBtn'),
  backBtn: document.getElementById('backBtn'),
  forwardBtn: document.getElementById('forwardBtn'),
  reloadBtn: document.getElementById('reloadBtn'),
  homeBtn: document.getElementById('homeBtn'),
  addressBar: document.getElementById('addressBar'),
  bookmarkToggleBtn: document.getElementById('bookmarkToggleBtn'),
  bookmarksBar: document.getElementById('bookmarksBar'),
  webviews: document.getElementById('webviews'),
  suggestions: document.getElementById('suggestions'),
  loadingIndicator: document.getElementById('loadingIndicator'),
  securityIndicator: document.getElementById('securityIndicator'),
  statusText: document.getElementById('statusText'),
  zoomText: document.getElementById('zoomText'),
  sidePanel: document.getElementById('sidePanel'),
  panelTitle: document.getElementById('panelTitle'),
  panelBody: document.getElementById('panelBody'),
  closePanelBtn: document.getElementById('closePanelBtn'),
  windowTitle: document.getElementById('windowTitle'),
  historyPanelBtn: document.getElementById('historyPanelBtn'),
  bookmarksPanelBtn: document.getElementById('bookmarksPanelBtn'),
  downloadsPanelBtn: document.getElementById('downloadsPanelBtn'),
  settingsPanelBtn: document.getElementById('settingsPanelBtn'),
  minimizeWindow: document.getElementById('minimizeWindow'),
  maximizeWindow: document.getElementById('maximizeWindow'),
  closeWindow: document.getElementById('closeWindow')
};

initialize().catch((error) => {
  console.error(error);
  setStatus(`Startup error: ${error.message}`);
});

async function initialize() {
  restoreState();
  bindEvents();
  subscribeDownloadEvents();
  await hydrateDownloads();
  restoreSessionTabs();
  renderTabs();
  renderBookmarksBar();
  updateBookmarksBarVisibility();
  updateNavigationControls();
  updateBookmarkStar();

  if (window.electronAPI?.app?.getVersion) {
    const version = await window.electronAPI.app.getVersion().catch(() => null);
    if (version) {
      refs.windowTitle.textContent = `${APP_NAME} v${version}`;
    }
  }
}

function bindEvents() {
  refs.minimizeWindow.addEventListener('click', () => {
    window.electronAPI.window.minimize();
  });

  refs.maximizeWindow.addEventListener('click', () => {
    window.electronAPI.window.maximizeToggle();
  });

  refs.closeWindow.addEventListener('click', () => {
    window.electronAPI.window.close();
  });

  refs.newTabBtn.addEventListener('click', () => {
    createTab({ url: 'about:newtab', makeActive: true });
  });

  refs.tabStrip.addEventListener('click', (event) => {
    const closeBtn = event.target.closest('[data-action="close-tab"]');
    if (closeBtn) {
      event.stopPropagation();
      closeTab(closeBtn.dataset.id);
      return;
    }

    const tabItem = event.target.closest('.tab-item');
    if (tabItem) {
      activateTab(tabItem.dataset.id);
    }
  });

  refs.backBtn.addEventListener('click', () => goBack());
  refs.forwardBtn.addEventListener('click', () => goForward());
  refs.reloadBtn.addEventListener('click', () => reloadActiveTab());
  refs.homeBtn.addEventListener('click', () => goHome());
  refs.bookmarkToggleBtn.addEventListener('click', () => toggleBookmarkForActiveTab());

  refs.historyPanelBtn.addEventListener('click', () => togglePanel('history'));
  refs.bookmarksPanelBtn.addEventListener('click', () => togglePanel('bookmarks'));
  refs.downloadsPanelBtn.addEventListener('click', () => togglePanel('downloads'));
  refs.settingsPanelBtn.addEventListener('click', () => togglePanel('settings'));
  refs.closePanelBtn.addEventListener('click', () => closePanel());

  refs.panelBody.addEventListener('click', handlePanelClick);

  refs.addressBar.addEventListener('keydown', onAddressKeyDown);
  refs.addressBar.addEventListener('input', onAddressInput);
  refs.addressBar.addEventListener('focus', onAddressFocus);
  refs.addressBar.addEventListener('blur', () => {
    window.setTimeout(hideSuggestions, 150);
  });

  refs.suggestions.addEventListener('mousedown', (event) => {
    const item = event.target.closest('.suggestion-item');
    if (!item) {
      return;
    }

    event.preventDefault();
    const index = Number(item.dataset.index);
    const suggestion = suggestions[index];
    if (suggestion) {
      applySuggestion(suggestion);
    }
  });

  refs.bookmarksBar.addEventListener('click', (event) => {
    const button = event.target.closest('.bookmark-chip');
    if (!button) {
      return;
    }

    const url = decodeURIComponent(button.dataset.url || '');
    if (url) {
      navigateInTab(getActiveTabId(), url, { fromUser: true });
    }
  });

  document.addEventListener('click', (event) => {
    const insideAddress = event.target.closest('.address-wrap') || event.target.closest('.suggestions');
    if (!insideAddress) {
      hideSuggestions();
    }
  });

  document.addEventListener('keydown', handleKeyboardShortcuts);
}

function subscribeDownloadEvents() {
  if (!window.electronAPI?.downloads) {
    return;
  }

  window.electronAPI.downloads.onCreated((payload) => {
    upsertDownload(payload);
    if (panelType === 'downloads') {
      renderPanel();
    }
  });

  window.electronAPI.downloads.onUpdated((payload) => {
    upsertDownload(payload);
    if (panelType === 'downloads') {
      renderPanel();
    }
  });

  window.electronAPI.downloads.onDone((payload) => {
    upsertDownload(payload);
    setStatus(`Download ${payload.state}: ${payload.filename}`);
    if (panelType === 'downloads') {
      renderPanel();
    }
  });
}

async function hydrateDownloads() {
  if (!window.electronAPI?.downloads?.list) {
    return;
  }

  const list = await window.electronAPI.downloads.list().catch(() => []);
  if (!Array.isArray(list)) {
    return;
  }

  state.downloads = list;
}

function restoreState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.bookmarks)) {
      state.bookmarks = parsed.bookmarks.slice(0, MAX_BOOKMARKS);
    }

    if (Array.isArray(parsed.history)) {
      state.history = parsed.history.slice(0, MAX_HISTORY_ITEMS);
    }

    if (parsed.settings && typeof parsed.settings === 'object') {
      state.settings = {
        ...DEFAULT_SETTINGS,
        homepage: typeof parsed.settings.homepage === 'string' ? parsed.settings.homepage : DEFAULT_SETTINGS.homepage,
        showBookmarksBar: Boolean(parsed.settings.showBookmarksBar),
        openLinksInNewTab: parsed.settings.openLinksInNewTab !== false
      };
    }

    if (Array.isArray(parsed.sessionTabs)) {
      state.restoredSessionTabs = parsed.sessionTabs;
    }

    if (typeof parsed.activeTabId === 'string') {
      state.restoredActiveTabId = parsed.activeTabId;
    }
  } catch (error) {
    console.error('Failed to parse local state', error);
  }
}

function queuePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const sessionTabs = state.tabs
      .filter((tab) => !tab.isPrivate)
      .map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.pageMode === 'web' ? tab.url : tab.virtualUrl || tab.url
      }))
      .slice(0, 20);

    const payload = {
      bookmarks: state.bookmarks.slice(0, MAX_BOOKMARKS),
      history: state.history.slice(0, MAX_HISTORY_ITEMS),
      settings: state.settings,
      sessionTabs,
      activeTabId: state.activeTabId
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, 120);
}

function restoreSessionTabs() {
  const restored = state.restoredSessionTabs;
  if (!Array.isArray(restored) || restored.length === 0) {
    createTab({ url: 'about:newtab', makeActive: true });
    return;
  }

  let preferredIndex = 0;
  if (state.restoredActiveTabId) {
    const foundIndex = restored.findIndex((tab) => tab.id === state.restoredActiveTabId);
    if (foundIndex >= 0) {
      preferredIndex = foundIndex;
    }
  }

  const createdTabIds = [];
  for (const tab of restored.slice(0, 12)) {
    const created = createTab({
      url: tab.url || 'about:newtab',
      makeActive: false,
      title: tab.title || 'New Tab'
    });
    createdTabIds.push(created.id);
  }

  if (createdTabIds.length === 0) {
    createTab({ url: 'about:newtab', makeActive: true });
    return;
  }

  if (preferredIndex < 0 || preferredIndex >= createdTabIds.length) {
    preferredIndex = 0;
  }

  if (createdTabIds[preferredIndex]) {
    activateTab(createdTabIds[preferredIndex]);
  } else {
    activateTab(createdTabIds[0]);
  }
}

function createTab(options = {}) {
  const tab = {
    id: `tab-${Date.now()}-${++tabCounter}`,
    title: options.title || 'New Tab',
    url: 'about:blank',
    virtualUrl: '',
    displayInput: '',
    favicon: '',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    isPrivate: Boolean(options.isPrivate),
    zoomFactor: 1,
    pageMode: 'web',
    searchQuery: ''
  };

  state.tabs.push(tab);
  createWebviewForTab(tab);

  if (options.makeActive !== false) {
    activateTab(tab.id);
  }

  if (options.url) {
    navigateInTab(tab.id, options.url, { fromUser: false });
  } else {
    navigateInTab(tab.id, 'about:newtab', { fromUser: false });
  }

  renderTabs();
  queuePersist();
  return tab;
}

function closeTab(tabId) {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) {
    return;
  }

  const [removed] = state.tabs.splice(index, 1);
  const webview = webviewByTabId.get(removed.id);
  if (webview) {
    webview.remove();
  }
  webviewByTabId.delete(removed.id);

  if (state.tabs.length === 0) {
    createTab({ url: 'about:newtab', makeActive: true });
    queuePersist();
    return;
  }

  if (state.activeTabId === removed.id) {
    const fallback = state.tabs[Math.max(0, index - 1)] || state.tabs[0];
    activateTab(fallback.id);
  }

  renderTabs();
  updateNavigationControls();
  updateBookmarkStar();
  queuePersist();
}
function activateTab(tabId) {
  const tab = state.tabs.find((candidate) => candidate.id === tabId);
  if (!tab) {
    return;
  }

  state.activeTabId = tab.id;

  for (const candidate of state.tabs) {
    const webview = webviewByTabId.get(candidate.id);
    if (!webview) {
      continue;
    }

    if (candidate.id === tab.id) {
      webview.classList.add('active');
    } else {
      webview.classList.remove('active');
    }
  }

  renderTabs();
  updateAddressBar();
  updateNavigationControls();
  updateBookmarkStar();
  updateSecurityIndicator();
  updateWindowTitle();
  updateZoomText(tab.zoomFactor);
  setStatus('Ready');
  queuePersist();
}

function getActiveTabId() {
  return state.activeTabId;
}

function getActiveTab() {
  return state.tabs.find((tab) => tab.id === state.activeTabId) || null;
}

function getActiveWebview() {
  const activeId = getActiveTabId();
  if (!activeId) {
    return null;
  }

  return webviewByTabId.get(activeId) || null;
}

function createWebviewForTab(tab) {
  const webview = document.createElement('webview');
  webview.className = 'browser-webview';
  webview.partition = tab.isPrivate ? `temp:${tab.id}` : 'persist:safari-browser';
  webview.setAttribute('allowpopups', 'false');
  webview.src = 'about:blank';

  if (typeof webview.setWindowOpenHandler === 'function') {
    webview.setWindowOpenHandler((details) => {
      if (!details || !details.url) {
        return { action: 'deny' };
      }

      if (isExternalProtocol(details.url)) {
        window.electronAPI.browser.openExternal(details.url);
      } else if (state.settings.openLinksInNewTab) {
        createTab({ url: details.url, makeActive: true });
      } else {
        navigateInTab(tab.id, details.url, { fromUser: false });
      }

      return { action: 'deny' };
    });
  }

  webview.addEventListener('dom-ready', () => {
    const currentTab = findTab(tab.id);
    if (!currentTab) {
      return;
    }

    try {
      webview.setZoomFactor(currentTab.zoomFactor || 1);
      syncNavigationFlags(currentTab, webview);
      if (currentTab.id === state.activeTabId) {
        updateNavigationControls();
      }
    } catch (_error) {
      // Ignore transient webview exceptions.
    }
  });

  webview.addEventListener('did-start-loading', () => {
    const currentTab = findTab(tab.id);
    if (!currentTab) {
      return;
    }

    currentTab.isLoading = true;
    if (currentTab.id === state.activeTabId) {
      refs.loadingIndicator.classList.add('active');
      setStatus('Loading...');
    }

    renderTabs();
  });

  webview.addEventListener('did-stop-loading', () => {
    const currentTab = findTab(tab.id);
    if (!currentTab) {
      return;
    }

    currentTab.isLoading = false;
    syncNavigationFlags(currentTab, webview);

    if (currentTab.id === state.activeTabId) {
      refs.loadingIndicator.classList.remove('active');
      updateNavigationControls();
      setStatus('Ready');
    }

    renderTabs();
  });

  webview.addEventListener('did-navigate', (event) => {
    handleNavigationEvent(tab.id, event.url);
  });

  webview.addEventListener('did-navigate-in-page', (event) => {
    handleNavigationEvent(tab.id, event.url);
  });

  webview.addEventListener('page-title-updated', (event) => {
    const currentTab = findTab(tab.id);
    if (!currentTab) {
      return;
    }

    const nextTitle = sanitizeTitle(event.title || currentTab.title);
    currentTab.title = nextTitle;
    updateExistingHistoryTitle(currentTab.url, nextTitle);

    if (currentTab.id === state.activeTabId) {
      updateWindowTitle();
    }

    renderTabs();
    queuePersist();
  });

  webview.addEventListener('page-favicon-updated', (event) => {
    const currentTab = findTab(tab.id);
    if (!currentTab) {
      return;
    }

    if (Array.isArray(event.favicons) && event.favicons[0]) {
      currentTab.favicon = event.favicons[0];
      renderTabs();
      queuePersist();
    }
  });

  webview.addEventListener('update-target-url', (event) => {
    if (tab.id !== state.activeTabId) {
      return;
    }

    setStatus(event.url || 'Ready');
  });

  webview.addEventListener('did-fail-load', (event) => {
    if (event.errorCode === -3) {
      return;
    }

    const currentTab = findTab(tab.id);
    if (!currentTab) {
      return;
    }

    currentTab.isLoading = false;
    if (currentTab.id === state.activeTabId) {
      refs.loadingIndicator.classList.remove('active');
      setStatus(`Load failed: ${event.errorDescription}`);
    }

    renderTabs();
  });

  refs.webviews.appendChild(webview);
  webviewByTabId.set(tab.id, webview);
}

function findTab(tabId) {
  return state.tabs.find((tab) => tab.id === tabId) || null;
}

function navigateInTab(tabId, input, options = {}) {
  const tab = findTab(tabId);
  if (!tab) {
    return;
  }

  const webview = webviewByTabId.get(tabId);
  if (!webview) {
    return;
  }

  const resolved = resolveInput(input);

  if (resolved.type === 'newtab') {
    loadStartPage(tab, webview);
    if (tab.id === state.activeTabId) {
      updateAddressBar();
      updateSecurityIndicator();
    }
    renderTabs();
    queuePersist();
    return;
  }

  tab.pageMode = 'web';
  tab.searchQuery = '';
  tab.displayInput = '';
  tab.virtualUrl = '';
  tab.url = resolved.url;
  tab.title = sanitizeTitle(tab.title || 'New Tab');

  if (options.fromUser) {
    hideSuggestions();
  }

  try {
    webview.loadURL(resolved.url);
  } catch (error) {
    setStatus(`Navigation error: ${error.message}`);
  }

  if (tab.id === state.activeTabId) {
    refs.addressBar.value = resolved.url;
    updateSecurityIndicator();
  }

  queuePersist();
}

function resolveInput(rawInput) {
  let input = (rawInput || '').trim();

  if (!input) {
    return { type: 'newtab' };
  }

  if (input === 'about:newtab') {
    return { type: 'newtab' };
  }

  if (looksLikeUrl(input)) {
    const normalized = normalizeUrl(input);
    return { type: 'url', url: normalized };
  }

  return { type: 'url', url: buildWebSearchUrl(input) };
}

function looksLikeUrl(input) {
  if (!input || /\s/.test(input)) {
    return false;
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(input)) {
    return true;
  }

  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(\/.*)?$/.test(input)) {
    return true;
  }

  if (input.includes('.') && /^[\w.-]+(?::\d+)?(\/.*)?$/.test(input)) {
    return true;
  }

  return false;
}

function normalizeUrl(input) {
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(input)) {
    return input;
  }

  if (input.startsWith('localhost') || /^\d{1,3}(?:\.\d{1,3}){3}/.test(input)) {
    return `http://${input}`;
  }

  return `https://${input}`;
}

function buildWebSearchUrl(query) {
  return DUCKDUCKGO_SEARCH_URL.replace('%s', encodeURIComponent(query));
}
function loadStartPage(tab, webview) {
  const bookmarks = state.bookmarks.slice(0, 8);
  const fallbackSites = [
    { title: 'Apple', url: 'https://www.apple.com' },
    { title: 'GitHub', url: 'https://github.com' },
    { title: 'YouTube', url: 'https://www.youtube.com' },
    { title: 'Wikipedia', url: 'https://www.wikipedia.org' }
  ];

  const quickLinks = bookmarks.length > 0 ? bookmarks : fallbackSites;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Start Page</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "SF Pro Text", "Segoe UI", sans-serif;
      background: linear-gradient(145deg, #f5f8ff, #deebfb);
      color: #1e2f45;
      display: grid;
      place-items: center;
      padding: 30px;
    }
    .wrap {
      width: min(900px, 96vw);
      background: rgba(255,255,255,0.78);
      border: 1px solid rgba(66,96,132,0.25);
      border-radius: 18px;
      backdrop-filter: blur(10px);
      box-shadow: 0 18px 45px rgba(16,30,44,0.2);
      padding: 22px;
    }
    h1 { margin: 0 0 8px; font-size: 30px; }
    p { margin: 0 0 16px; color: #4e6784; }
    .links { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
    a {
      text-decoration: none;
      border-radius: 12px;
      border: 1px solid rgba(66,96,132,0.22);
      background: #fff;
      color: #2a4668;
      padding: 12px;
      font-weight: 600;
    }
    a:hover { border-color: #1d73da; color: #1d73da; }
    .tip {
      margin-top: 16px;
      font-size: 13px;
      color: #4e6784;
      background: rgba(255,255,255,0.7);
      border-radius: 10px;
      padding: 10px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Start Page</h1>
    <p>Use the address bar to browse or search with DuckDuckGo.</p>
    <div class="links">
      ${quickLinks.map((item) => `<a href="${escapeAttr(item.url)}">${escapeHtml(item.title)}</a>`).join('')}
    </div>
    <div class="tip">Tips: Ctrl+L focus address bar, Ctrl+T new tab, Ctrl+D bookmark page.</div>
  </div>
</body>
</html>`;

  tab.pageMode = 'newtab';
  tab.searchQuery = '';
  tab.virtualUrl = 'about:newtab';
  tab.url = 'about:newtab';
  tab.displayInput = 'about:newtab';
  tab.title = 'Start Page';
  tab.favicon = '';

  webview.loadURL(htmlToDataUrl(html));

  if (tab.id === state.activeTabId) {
    setStatus('Start page loaded');
  }
}

function handleNavigationEvent(tabId, url) {
  const tab = findTab(tabId);
  const webview = webviewByTabId.get(tabId);
  if (!tab || !webview || !url) {
    return;
  }

  const internalDataPage = url.startsWith('data:text/html');

  if (!internalDataPage) {
    tab.pageMode = 'web';
    tab.searchQuery = '';
    tab.virtualUrl = '';
    tab.displayInput = '';
    tab.url = url;

    if (shouldTrackUrl(url)) {
      addHistoryEntry({
        title: sanitizeTitle(tab.title),
        url,
        visitedAt: Date.now(),
        kind: 'web'
      });
    }
  }

  syncNavigationFlags(tab, webview);

  if (tab.id === state.activeTabId) {
    updateAddressBar();
    updateNavigationControls();
    updateSecurityIndicator();
  }

  queuePersist();
}

function syncNavigationFlags(tab, webview) {
  try {
    tab.canGoBack = webview.canGoBack();
    tab.canGoForward = webview.canGoForward();
  } catch (_error) {
    tab.canGoBack = false;
    tab.canGoForward = false;
  }
}

function goBack() {
  const webview = getActiveWebview();
  if (!webview) {
    return;
  }

  try {
    if (webview.canGoBack()) {
      webview.goBack();
    }
  } catch (_error) {
    // Ignore.
  }
}

function goForward() {
  const webview = getActiveWebview();
  if (!webview) {
    return;
  }

  try {
    if (webview.canGoForward()) {
      webview.goForward();
    }
  } catch (_error) {
    // Ignore.
  }
}

function reloadActiveTab() {
  const tab = getActiveTab();
  const webview = getActiveWebview();
  if (!tab || !webview) {
    return;
  }

  if (tab.pageMode === 'newtab') {
    loadStartPage(tab, webview);
    renderTabs();
    return;
  }

  try {
    webview.reload();
  } catch (_error) {
    // Ignore.
  }
}

function goHome() {
  const tabId = getActiveTabId();
  if (!tabId) {
    return;
  }

  navigateInTab(tabId, state.settings.homepage || 'about:newtab', { fromUser: true });
}

function onAddressKeyDown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();

    if (activeSuggestionIndex >= 0) {
      const suggestion = suggestions[activeSuggestionIndex];
      if (suggestion) {
        applySuggestion(suggestion);
        return;
      }
    }

    navigateInTab(getActiveTabId(), refs.addressBar.value, { fromUser: true });
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveSuggestionSelection(1);
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveSuggestionSelection(-1);
    return;
  }

  if (event.key === 'Escape') {
    hideSuggestions();
  }
}

function onAddressInput() {
  renderSuggestions(refs.addressBar.value);
}

function onAddressFocus() {
  if (refs.addressBar.value.trim()) {
    renderSuggestions(refs.addressBar.value);
  }
}

function renderSuggestions(input) {
  const query = (input || '').trim().toLowerCase();
  if (!query) {
    hideSuggestions();
    return;
  }

  const nextSuggestions = [];
  nextSuggestions.push({
    type: 'search',
    value: input.trim(),
    label: `Search for "${input.trim()}"`,
    hint: 'DuckDuckGo'
  });

  const matches = [];
  for (const item of [...state.bookmarks, ...state.history]) {
    const title = String(item.title || '').toLowerCase();
    const url = String(item.url || '').toLowerCase();
    if (title.includes(query) || url.includes(query)) {
      matches.push(item);
    }
  }

  const seen = new Set();
  for (const item of matches) {
    if (!item.url || seen.has(item.url)) {
      continue;
    }

    seen.add(item.url);
    nextSuggestions.push({
      type: 'url',
      value: item.url,
      label: item.title || item.url,
      hint: item.url
    });

    if (nextSuggestions.length >= 8) {
      break;
    }
  }

  suggestions = nextSuggestions;
  activeSuggestionIndex = -1;

  refs.suggestions.innerHTML = nextSuggestions
    .map((item, index) => `
      <div class="suggestion-item" data-index="${index}">
        <div>${item.type === 'search' ? '&#128269;' : '&#128279;'}</div>
        <div>
          <div>${escapeHtml(item.label)}</div>
          <div class="hint">${escapeHtml(item.hint || '')}</div>
        </div>
      </div>
    `)
    .join('');

  refs.suggestions.classList.remove('hidden');
}

function hideSuggestions() {
  refs.suggestions.classList.add('hidden');
  suggestions = [];
  activeSuggestionIndex = -1;
}

function moveSuggestionSelection(delta) {
  if (!suggestions.length) {
    return;
  }

  activeSuggestionIndex += delta;

  if (activeSuggestionIndex < 0) {
    activeSuggestionIndex = suggestions.length - 1;
  }
  if (activeSuggestionIndex >= suggestions.length) {
    activeSuggestionIndex = 0;
  }

  for (const [index, element] of Array.from(refs.suggestions.children).entries()) {
    if (index === activeSuggestionIndex) {
      element.classList.add('active');
    } else {
      element.classList.remove('active');
    }
  }
}

function applySuggestion(suggestion) {
  if (suggestion.type === 'url') {
    navigateInTab(getActiveTabId(), suggestion.value, { fromUser: true });
  } else {
    navigateInTab(getActiveTabId(), suggestion.value, { fromUser: true });
  }
}
function toggleBookmarkForActiveTab() {
  const tab = getActiveTab();
  if (!tab) {
    return;
  }

  const targetUrl = tab.pageMode === 'web' ? tab.url : tab.virtualUrl;
  if (!targetUrl || !shouldBookmarkUrl(targetUrl)) {
    setStatus('This page cannot be bookmarked.');
    return;
  }

  const index = state.bookmarks.findIndex((item) => item.url === targetUrl);
  if (index >= 0) {
    const removed = state.bookmarks.splice(index, 1)[0];
    setStatus(`Removed bookmark: ${removed.title || removed.url}`);
  } else {
    state.bookmarks.unshift({
      id: `bm-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      title: tab.title || targetUrl,
      url: targetUrl,
      createdAt: Date.now()
    });
    state.bookmarks = state.bookmarks.slice(0, MAX_BOOKMARKS);
    setStatus('Bookmark added.');
  }

  updateBookmarkStar();
  renderBookmarksBar();
  queuePersist();

  if (panelType === 'bookmarks') {
    renderPanel();
  }
}

function updateBookmarkStar() {
  const tab = getActiveTab();
  if (!tab) {
    refs.bookmarkToggleBtn.innerHTML = '&#x2606;';
    return;
  }

  const targetUrl = tab.pageMode === 'web' ? tab.url : tab.virtualUrl;
  const exists = state.bookmarks.some((item) => item.url === targetUrl);
  refs.bookmarkToggleBtn.innerHTML = exists ? '&#x2605;' : '&#x2606;';
}

function addHistoryEntry(entry) {
  if (!entry || !entry.url) {
    return;
  }

  const index = state.history.findIndex((item) => item.url === entry.url);
  if (index >= 0) {
    const existing = state.history[index];
    existing.title = entry.title || existing.title;
    existing.visitedAt = entry.visitedAt || Date.now();
    existing.kind = entry.kind || existing.kind || 'web';
    state.history.splice(index, 1);
    state.history.unshift(existing);
  } else {
    state.history.unshift({
      id: `hs-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      title: entry.title || entry.url,
      url: entry.url,
      visitedAt: entry.visitedAt || Date.now(),
      kind: entry.kind || 'web'
    });
  }

  state.history = state.history.slice(0, MAX_HISTORY_ITEMS);
  queuePersist();

  if (panelType === 'history') {
    renderPanel();
  }
}

function updateExistingHistoryTitle(url, title) {
  if (!url || !title) {
    return;
  }

  const item = state.history.find((entry) => entry.url === url);
  if (item) {
    item.title = title;
    queuePersist();
  }
}

function shouldTrackUrl(url) {
  return /^https?:\/\//i.test(url) || url.startsWith('file:');
}

function shouldBookmarkUrl(url) {
  return /^https?:\/\//i.test(url);
}

function renderTabs() {
  refs.tabStrip.innerHTML = state.tabs
    .map((tab) => {
      const activeClass = tab.id === state.activeTabId ? 'active' : '';
      const title = escapeHtml(sanitizeTitle(tab.title));
      const favicon = tab.favicon
        ? `<img class="tab-favicon" src="${escapeAttr(tab.favicon)}" alt="">`
        : '<span class="tab-favicon"></span>';
      const loadingDot = tab.isLoading ? '&#8226; ' : '';

      return `
        <div class="tab-item ${activeClass}" data-id="${tab.id}" title="${title}">
          ${favicon}
          <div class="tab-title">${loadingDot}${title}</div>
          <div class="tab-close" data-action="close-tab" data-id="${tab.id}">&#10005;</div>
        </div>
      `;
    })
    .join('');
}

function renderBookmarksBar() {
  if (state.bookmarks.length === 0) {
    refs.bookmarksBar.innerHTML = '<small style="color: #4b5f79;">No bookmarks yet. Press Ctrl+D on a page to save one.</small>';
    return;
  }

  refs.bookmarksBar.innerHTML = state.bookmarks
    .slice(0, 20)
    .map((bookmark) => `
      <button class="bookmark-chip" data-url="${encodeURIComponent(bookmark.url)}" title="${escapeAttr(bookmark.url)}">
        ${escapeHtml(bookmark.title || bookmark.url)}
      </button>
    `)
    .join('');
}

function updateBookmarksBarVisibility() {
  refs.bookmarksBar.classList.toggle('hidden', !state.settings.showBookmarksBar);
}

function updateAddressBar() {
  const tab = getActiveTab();
  if (!tab) {
    refs.addressBar.value = '';
    return;
  }

  refs.addressBar.value = tab.virtualUrl || tab.url || '';
}

function updateNavigationControls() {
  const tab = getActiveTab();
  if (!tab) {
    refs.backBtn.disabled = true;
    refs.forwardBtn.disabled = true;
    refs.reloadBtn.disabled = true;
    return;
  }

  refs.backBtn.disabled = !tab.canGoBack;
  refs.forwardBtn.disabled = !tab.canGoForward;
  refs.reloadBtn.disabled = false;
}

function updateSecurityIndicator() {
  const tab = getActiveTab();
  if (!tab) {
    refs.securityIndicator.textContent = '';
    return;
  }

  const value = tab.virtualUrl || tab.url || '';

  if (value.startsWith('about:newtab')) {
    refs.securityIndicator.textContent = '\u2605';
    return;
  }

  if (/^https:\/\//i.test(value)) {
    refs.securityIndicator.textContent = '\ud83d\udd12';
    return;
  }

  if (/^http:\/\//i.test(value)) {
    refs.securityIndicator.textContent = '\u26a0';
    return;
  }

  refs.securityIndicator.textContent = '\ud83d\udd17';
}

function updateWindowTitle() {
  const tab = getActiveTab();
  const title = tab ? sanitizeTitle(tab.title) : APP_NAME;
  document.title = `${title} - ${APP_NAME}`;
}

function updateZoomText(value) {
  const percent = Math.round((value || 1) * 100);
  refs.zoomText.textContent = `${percent}%`;
}

function setStatus(message) {
  refs.statusText.textContent = String(message || 'Ready');
}
function togglePanel(type) {
  if (panelType === type && !refs.sidePanel.classList.contains('hidden')) {
    closePanel();
    return;
  }

  panelType = type;
  refs.sidePanel.classList.remove('hidden');
  renderPanel();
}

function closePanel() {
  panelType = null;
  refs.sidePanel.classList.add('hidden');
}

function renderPanel() {
  if (!panelType) {
    closePanel();
    return;
  }

  if (panelType === 'bookmarks') {
    renderBookmarksPanel();
    return;
  }

  if (panelType === 'history') {
    renderHistoryPanel();
    return;
  }

  if (panelType === 'downloads') {
    renderDownloadsPanel();
    return;
  }

  if (panelType === 'settings') {
    renderSettingsPanel();
  }
}

function renderBookmarksPanel() {
  refs.panelTitle.textContent = 'Bookmarks';

  if (!state.bookmarks.length) {
    refs.panelBody.innerHTML = '<div class="panel-card"><p>No bookmarks saved yet.</p></div>';
    return;
  }

  refs.panelBody.innerHTML = state.bookmarks
    .map((bookmark) => `
      <div class="panel-card">
        <h3>${escapeHtml(bookmark.title || bookmark.url)}</h3>
        <small>${escapeHtml(bookmark.url)}</small>
        <div class="panel-actions">
          <button data-action="open-url" data-url="${encodeURIComponent(bookmark.url)}">Open</button>
          <button data-action="delete-bookmark" data-id="${bookmark.id}">Delete</button>
        </div>
      </div>
    `)
    .join('');
}

function renderHistoryPanel() {
  refs.panelTitle.textContent = 'History';

  const controls = `
    <div class="panel-card">
      <h3>History Controls</h3>
      <div class="panel-actions">
        <button data-action="clear-history">Clear history</button>
      </div>
    </div>
  `;

  if (!state.history.length) {
    refs.panelBody.innerHTML = `${controls}<div class="panel-card"><p>No history yet.</p></div>`;
    return;
  }

  refs.panelBody.innerHTML =
    controls +
    state.history
      .slice(0, 300)
      .map((item) => `
        <div class="panel-card">
          <h3>${escapeHtml(item.title || item.url)}</h3>
          <small>${escapeHtml(item.url)}</small>
          <p style="margin-top: 5px; font-size: 12px;">${formatTime(item.visitedAt)}</p>
          <div class="panel-actions">
            <button data-action="open-url" data-url="${encodeURIComponent(item.url)}">Open</button>
            <button data-action="delete-history" data-id="${item.id}">Delete</button>
          </div>
        </div>
      `)
      .join('');
}

function renderDownloadsPanel() {
  refs.panelTitle.textContent = 'Downloads';

  const controls = `
    <div class="panel-card">
      <h3>Downloads Controls</h3>
      <div class="panel-actions">
        <button data-action="clear-downloads">Clear finished</button>
      </div>
    </div>
  `;

  if (!state.downloads.length) {
    refs.panelBody.innerHTML = `${controls}<div class="panel-card"><p>No downloads yet.</p></div>`;
    return;
  }

  refs.panelBody.innerHTML =
    controls +
    state.downloads
      .slice()
      .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))
      .map((item) => {
        const total = Number(item.totalBytes || 0);
        const received = Number(item.receivedBytes || 0);
        const progress = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
        return `
          <div class="panel-card">
            <h3>${escapeHtml(item.filename || 'Unknown file')}</h3>
            <small>${escapeHtml(item.url || '')}</small>
            <p style="margin-top: 6px; font-size: 12px;">
              ${escapeHtml(item.state || 'progressing')} | ${formatBytes(received)} / ${total > 0 ? formatBytes(total) : '?'} (${progress}%)
            </p>
            <div class="panel-actions">
              <button data-action="show-download" data-id="${item.id}">Show in folder</button>
            </div>
          </div>
        `;
      })
      .join('');
}

function renderSettingsPanel() {
  refs.panelTitle.textContent = 'Settings';

  refs.panelBody.innerHTML = `
    <div class="settings-row">
      <label>Default search engine</label>
      <input type="text" value="DuckDuckGo (Permanent)" readonly>
    </div>

    <div class="settings-row">
      <label for="settingHomepage">Homepage</label>
      <input id="settingHomepage" type="text" value="${escapeAttr(state.settings.homepage || 'about:newtab')}" placeholder="about:newtab or https://example.com">
    </div>

    <div class="settings-row">
      <label><input id="settingBookmarksBar" type="checkbox" ${state.settings.showBookmarksBar ? 'checked' : ''}> Show bookmarks bar</label>
      <label><input id="settingLinksNewTab" type="checkbox" ${state.settings.openLinksInNewTab ? 'checked' : ''}> Open popups in a new tab</label>
    </div>

    <div class="settings-row">
      <button data-action="save-settings">Save settings</button>
    </div>

    <div class="settings-row">
      <button data-action="export-data">Export browser data</button>
      <button data-action="import-data">Import browser data</button>
    </div>
  `;
}

async function handlePanelClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  const action = button.dataset.action;

  if (action === 'open-url') {
    const url = decodeURIComponent(button.dataset.url || '');
    if (url) {
      navigateInTab(getActiveTabId(), url, { fromUser: true });
      closePanel();
    }
    return;
  }

  if (action === 'delete-bookmark') {
    state.bookmarks = state.bookmarks.filter((bookmark) => bookmark.id !== button.dataset.id);
    renderBookmarksBar();
    renderPanel();
    updateBookmarkStar();
    queuePersist();
    return;
  }

  if (action === 'delete-history') {
    state.history = state.history.filter((entry) => entry.id !== button.dataset.id);
    renderPanel();
    queuePersist();
    return;
  }

  if (action === 'clear-history') {
    state.history = [];
    renderPanel();
    queuePersist();
    setStatus('History cleared.');
    return;
  }

  if (action === 'show-download') {
    const id = button.dataset.id;
    await window.electronAPI.downloads.showInFolder(id).catch(() => null);
    return;
  }

  if (action === 'clear-downloads') {
    const remaining = await window.electronAPI.downloads.clearFinished().catch(() => []);
    if (Array.isArray(remaining)) {
      state.downloads = remaining;
      renderPanel();
      setStatus('Finished downloads cleared.');
    }
    return;
  }

  if (action === 'save-settings') {
    const homepageValue = document.getElementById('settingHomepage').value.trim() || 'about:newtab';
    const showBookmarksBar = document.getElementById('settingBookmarksBar').checked;
    const openLinksInNewTab = document.getElementById('settingLinksNewTab').checked;

    state.settings.homepage = homepageValue;
    state.settings.showBookmarksBar = showBookmarksBar;
    state.settings.openLinksInNewTab = openLinksInNewTab;

    updateBookmarksBarVisibility();
    queuePersist();
    setStatus('Settings saved.');
    return;
  }

  if (action === 'export-data') {
    const payload = {
      exportedAt: new Date().toISOString(),
      bookmarks: state.bookmarks,
      history: state.history,
      settings: state.settings
    };

    const stamp = new Date().toISOString().replace(/[T:.]/g, '-').slice(0, 19);
    const response = await window.electronAPI.storage.exportJson(`safari-data-${stamp}.json`, payload).catch(() => null);
    if (response?.ok) {
      setStatus(`Exported data to ${response.path}`);
    }
    return;
  }

  if (action === 'import-data') {
    const response = await window.electronAPI.storage.importJson().catch(() => null);
    if (!response || !response.ok || !response.data) {
      return;
    }

    const data = response.data;
    if (Array.isArray(data.bookmarks)) {
      state.bookmarks = data.bookmarks.slice(0, MAX_BOOKMARKS);
    }

    if (Array.isArray(data.history)) {
      state.history = data.history.slice(0, MAX_HISTORY_ITEMS);
    }

    if (data.settings && typeof data.settings === 'object') {
      state.settings = {
        ...DEFAULT_SETTINGS,
        homepage: typeof data.settings.homepage === 'string' ? data.settings.homepage : DEFAULT_SETTINGS.homepage,
        showBookmarksBar: Boolean(data.settings.showBookmarksBar),
        openLinksInNewTab: data.settings.openLinksInNewTab !== false
      };
    }

    renderBookmarksBar();
    updateBookmarksBarVisibility();
    updateBookmarkStar();
    renderPanel();
    queuePersist();
    setStatus(`Imported data from ${response.path}`);
  }
}

function upsertDownload(payload) {
  const index = state.downloads.findIndex((item) => item.id === payload.id);
  if (index >= 0) {
    state.downloads[index] = { ...state.downloads[index], ...payload };
  } else {
    state.downloads.push(payload);
  }
}
function handleKeyboardShortcuts(event) {
  const target = event.target;
  const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
  const ctrlOrMeta = event.ctrlKey || event.metaKey;

  if (ctrlOrMeta && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    refs.addressBar.focus();
    refs.addressBar.select();
    return;
  }

  if (ctrlOrMeta && event.key.toLowerCase() === 't') {
    event.preventDefault();
    createTab({ url: 'about:newtab', makeActive: true });
    return;
  }

  if (ctrlOrMeta && event.key.toLowerCase() === 'w') {
    event.preventDefault();
    if (state.activeTabId) {
      closeTab(state.activeTabId);
    }
    return;
  }

  if (ctrlOrMeta && event.key.toLowerCase() === 'r') {
    event.preventDefault();
    reloadActiveTab();
    return;
  }

  if (ctrlOrMeta && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    toggleBookmarkForActiveTab();
    return;
  }

  if (ctrlOrMeta && event.key.toLowerCase() === 'h') {
    event.preventDefault();
    togglePanel('history');
    return;
  }

  if (ctrlOrMeta && event.key.toLowerCase() === 'j') {
    event.preventDefault();
    togglePanel('downloads');
    return;
  }

  if (event.altKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    goBack();
    return;
  }

  if (event.altKey && event.key === 'ArrowRight') {
    event.preventDefault();
    goForward();
    return;
  }

  if (event.key === 'F5') {
    event.preventDefault();
    reloadActiveTab();
    return;
  }

  if (event.key === 'F12') {
    const webview = getActiveWebview();
    if (webview) {
      webview.openDevTools();
    }
    return;
  }

  if (ctrlOrMeta && (event.key === '+' || event.key === '=')) {
    event.preventDefault();
    changeZoom(0.1);
    return;
  }

  if (ctrlOrMeta && event.key === '-') {
    event.preventDefault();
    changeZoom(-0.1);
    return;
  }

  if (ctrlOrMeta && event.key === '0') {
    event.preventDefault();
    setZoom(1);
    return;
  }

  if (ctrlOrMeta && !isTyping && event.key === 'Tab') {
    event.preventDefault();
    cycleTabs(event.shiftKey ? -1 : 1);
  }
}

function changeZoom(delta) {
  const tab = getActiveTab();
  const webview = getActiveWebview();
  if (!tab || !webview) {
    return;
  }

  const next = Math.min(3, Math.max(0.3, (tab.zoomFactor || 1) + delta));
  setZoom(next);
}

function setZoom(value) {
  const tab = getActiveTab();
  const webview = getActiveWebview();
  if (!tab || !webview) {
    return;
  }

  tab.zoomFactor = value;
  try {
    webview.setZoomFactor(value);
    updateZoomText(value);
    queuePersist();
  } catch (_error) {
    // Ignore.
  }
}

function cycleTabs(direction) {
  if (state.tabs.length < 2) {
    return;
  }

  const currentIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  if (currentIndex < 0) {
    return;
  }

  let nextIndex = currentIndex + direction;
  if (nextIndex < 0) {
    nextIndex = state.tabs.length - 1;
  }
  if (nextIndex >= state.tabs.length) {
    nextIndex = 0;
  }

  activateTab(state.tabs[nextIndex].id);
}

function isExternalProtocol(url) {
  return /^(mailto:|tel:|sms:)/i.test(url || '');
}

function sanitizeTitle(title) {
  const cleaned = String(title || 'New Tab').trim();
  if (!cleaned) {
    return 'New Tab';
  }

  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
}

function htmlToDataUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(epochMs) {
  const date = new Date(Number(epochMs || Date.now()));
  return date.toLocaleString();
}
