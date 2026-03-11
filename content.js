/**
 * Gemini Chat Organizer - Content Script
 * Adds folder organization to the Gemini sidebar via filtering + folder assignment
 * Does NOT move/clone DOM - preserves Gemini's React event handlers
 */

(function () {
  'use strict';

  const STORAGE_KEYS = {
    FOLDERS: 'gemini_organizer_folders',
    MAPPINGS: 'gemini_organizer_mappings',
    COLLAPSED: 'gemini_organizer_collapsed',
  };

  const DEFAULT_FOLDERS = [
    { id: 'default', name: 'All Chats', order: 0 },
  ];

  let currentFolderFilter = 'default';
  let chatItemWrappers = new Map(); // element -> wrapper div

  function getChatId(element) {
    const dataId = element.getAttribute('data-conversation-id') ||
      element.getAttribute('data-id') ||
      element.closest('[data-conversation-id]')?.getAttribute('data-conversation-id');
    if (dataId) return dataId;

    let link = element.tagName && element.tagName.toLowerCase() === 'a' ? element : 
               (element.querySelector('a[href*="/app/"]') || element.closest('a[href*="/app/"]') || element.querySelector('a[href*="gemini"]') || element.closest('a[href*="gemini"]'));
    
    if (link?.href) {
      const urlMatch = link.href.match(/[\/=]([a-zA-Z0-9_-]{10,})/);
      if (urlMatch) return urlMatch[1];
    }

    const text = (element.textContent || '').trim().slice(0, 100);
    if (text) {
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
      }
      return `text_${Math.abs(hash)}`;
    }
    return null;
  }

  function getChatTitle(element) {
    const titleEl = element.querySelector('.conversation-title') || 
      element.querySelector('[data-title]') ||
      element.querySelector('span[title]') ||
      element.querySelector('.chat-title, [class*="title"]') ||
      element;
    return (titleEl?.textContent || titleEl?.title || 'Untitled').trim().slice(0, 80);
  }

  function findChatListItems(includeProcessed = false) {
    const selectors = [
      'a[data-test-id="conversation"]',
      '.conversation-items-container a[href*="/app/"]',
      '[role="listitem"]',
      '[data-testid="conversation-item"]',
      'a[href*="gemini.google.com"]'
    ];

    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      const filtered = Array.from(items).filter(el => {
        const text = (el.textContent || '').trim();
        const isUnprocessed = includeProcessed || (!el.hasAttribute('data-gco-processed') && !el.closest('[data-gco-processed]'));
        return text.length > 0 && text.length < 500 &&
          !el.closest('#gco-organizer-root') && isUnprocessed;
      });
      if (filtered.length > 0) {
        return filtered.filter(el =>
          !filtered.some(other => other !== el && other.contains(el))
        );
      }
    }
    return [];
  }

  /**
   * Find where to inject: between Gem and Chats (對話).
   * Target order: Gem → Folders → Chats.
   */
  function findChatListContainer() {
    const items = findChatListItems(true);
    if (items.length === 0) return null;

    let el = items[0];
    let scrollContainer = null;
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      const isScrollable = /auto|scroll|overlay/.test(style.overflowY);
      if (isScrollable) {
        scrollContainer = el;
        break;
      }
      el = el.parentElement;
    }
    if (!scrollContainer) return { container: items[0].parentElement, insertBefore: null };

    const labels = ['對話', 'Chats', 'Conversations'];
    const labelEl = Array.from(scrollContainer.querySelectorAll('*')).find(el =>
      labels.some(t => el.textContent?.trim() === t || el.textContent?.trim().startsWith(t))
    );
    let chatsSection = null;
    if (labelEl) {
      let p = labelEl.parentElement;
      while (p && p !== scrollContainer) {
        if (p.contains(items[0])) {
          chatsSection = p;
          break;
        }
        p = p.parentElement;
      }
    }
    if (chatsSection && chatsSection.parentElement) {
      return { container: chatsSection.parentElement, insertBefore: chatsSection };
    }
    let insertBefore = null;
    let n = items[0];
    while (n && n !== scrollContainer) {
      if (n.parentElement === scrollContainer) {
        insertBefore = n;
        break;
      }
      n = n.parentElement;
    }
    if (insertBefore && !scrollContainer.contains(insertBefore)) insertBefore = null;
    return { container: scrollContainer, insertBefore };
  }

  async function loadData() {
    const result = await chrome.storage.local.get([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.MAPPINGS, STORAGE_KEYS.COLLAPSED]);
    return {
      folders: result[STORAGE_KEYS.FOLDERS] || DEFAULT_FOLDERS,
      mappings: result[STORAGE_KEYS.MAPPINGS] || {},
      collapsed: result[STORAGE_KEYS.COLLAPSED] || false,
    };
  }

  async function saveMapping(chatId, chatTitle, folderId, url) {
    const { mappings } = await loadData();
    const mappingData = { folderId, title: chatTitle, url };
    if (chatId) mappings[chatId] = mappingData;
    if (chatTitle) mappings[chatTitle] = mappingData;
    await chrome.storage.local.set({ [STORAGE_KEYS.MAPPINGS]: mappings });
  }

  function escapeHtml(text) {
    const el = document.createElement('div');
    el.textContent = text;
    return el.innerHTML;
  }

  /**
   * Add folder dropdown to a chat item (as a small icon that opens menu)
   */
  function addFolderButton(chatElement, chatId, chatTitle) {
    const wrapper = chatElement.closest('.conversation-items-container') || chatElement.closest('li') || chatElement.parentElement || chatElement;
    if (wrapper.querySelector('.gco-folder-btn') || chatElement.querySelector('.gco-folder-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'gco-folder-btn';
    btn.title = 'Assign to folder';
    btn.textContent = '📁';
    btn.type = 'button';

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const { folders, mappings } = await loadData();
      
      const mapping = mappings[chatId] || mappings[chatTitle];
      let assignedFolder = 'default';
      if (typeof mapping === 'string') {
        assignedFolder = mapping;
      } else if (mapping && mapping.folderId) {
        assignedFolder = mapping.folderId;
      }

      const menu = document.createElement('div');
      menu.className = 'gco-folder-menu';
      folders.sort((a, b) => a.order - b.order).forEach(f => {
        const item = document.createElement('div');
        item.className = 'gco-folder-menu-item' + (f.id === assignedFolder ? ' active' : '');
        item.textContent = f.name;
        item.addEventListener('click', async (e2) => {
          e2.stopPropagation();
          const url = chatElement.href || chatElement.querySelector('a')?.href || window.location.origin + '/app/' + chatId.replace('text_', '');
          await saveMapping(chatId, chatTitle, f.id, url);
          applyFolderFilter(currentFolderFilter);
          menu.remove();
        });
        menu.appendChild(item);
      });
      document.body.appendChild(menu);
      const rect = btn.getBoundingClientRect();
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom + 4}px`;
      const close = () => {
        menu.remove();
        document.removeEventListener('click', close);
      };
      setTimeout(() => document.addEventListener('click', close), 0);
    });

    chatElement.style.position = 'relative';
    chatElement.style.paddingLeft = '32px';
    chatElement.setAttribute('data-gco-processed', 'true');
    chatElement.setAttribute('data-gco-chat-id', chatId || '');
    
    chatElement.appendChild(btn);
  }

  let isApplyingFilter = false;

  /**
   * Show/hide chat items based on folder filter
   */
  async function applyFolderFilter(folderId) {
    if (isApplyingFilter) return;
    isApplyingFilter = true;
    
    try {
      currentFolderFilter = folderId;
    const { mappings } = await loadData();
    const items = findChatListItems(true);
    
    const visibleMappedUrls = new Set();
    
    items.forEach(el => {
      const wrapper = el.closest('.conversation-items-container') || el.closest('li') || el.parentElement || el;
      if (!wrapper?.style) return;
      const chatId = el.getAttribute('data-gco-chat-id') || getChatId(el);
      const title = getChatTitle(el);
      const mapping = mappings[chatId] || mappings[title];
      
      let assignedFolder = 'default';
      if (typeof mapping === 'string') {
        assignedFolder = mapping;
      } else if (mapping && mapping.folderId) {
        assignedFolder = mapping.folderId;
      }

      const isMatch = folderId === 'default' || assignedFolder === folderId;
      wrapper.style.display = isMatch ? '' : 'none';
      
      if (isMatch && typeof mapping === 'object' && mapping.url) {
        visibleMappedUrls.add(mapping.url);
      } else if (isMatch) {
        const link = el.href || el.querySelector('a')?.href;
        if (link) visibleMappedUrls.add(link);
      }
    });

    // Handle "missing" chats that Gemini hasn't loaded into the DOM yet
    const { container } = findChatListContainer() || {};
    if (container) {
      // Clean up any old missing chats container
      const oldContainer = container.querySelector('.gco-missing-chats');
      if (oldContainer) oldContainer.remove();

      if (folderId !== 'default') {
        const missingChats = [];
        
        // Find all chats in storage mapped to this folder that aren't visible
        Object.entries(mappings).forEach(([key, mapping]) => {
          if (typeof mapping === 'object' && mapping.folderId === folderId && mapping.url) {
            if (!visibleMappedUrls.has(mapping.url)) {
              // Deduplicate in case saved under both text hash and chat ID
              if (!missingChats.find(c => c.url === mapping.url)) {
                missingChats.push(mapping);
              }
            }
          }
        });

        if (missingChats.length > 0) {
          const missingContainer = document.createElement('div');
          missingContainer.className = 'gco-missing-chats';
          
          const label = document.createElement('div');
          label.className = 'gco-missing-chats-title';
          label.textContent = 'Archived visually (click to load)';
          missingContainer.appendChild(label);

          missingChats.forEach(chat => {
            const link = document.createElement('a');
            link.className = 'gco-missing-chat-link';
            link.href = chat.url;
            link.textContent = '📄 ' + (chat.title || 'Unknown Chat');
            
            // Force browser navigation to bypass SPA interceptors
            link.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              window.location.href = chat.url;
            });
            
            missingContainer.appendChild(link);
          });

          // Append to the bottom of the Gemini chat list container
          container.appendChild(missingContainer);
        }
      }
    }
    } finally {
      setTimeout(() => { isApplyingFilter = false; }, 50);
    }
  }

  /**
   * Inject folder bar and process chat items
   */
  async function injectFolderOrganization() {
    if (document.getElementById('gco-organizer-root')) return;

    const { container, insertBefore } = findChatListContainer() || {};
    if (!container) return;

    const { folders, collapsed } = await loadData();
    const sortedFolders = [...folders].sort((a, b) => a.order - b.order);

    const root = document.createElement('div');
    root.id = 'gco-organizer-root';
    root.className = 'gco-organizer' + (collapsed ? ' collapsed' : '');

    root.innerHTML = `
      <div class="gco-header">
        <span class="gco-title" title="Toggle folders">
          <span class="gco-collapse-icon">▼</span>
          📁 Folders
        </span>
        <button class="gco-manage-btn" title="Manage folders">⚙</button>
      </div>
      <div class="gco-folder-tabs"></div>
    `;

    root.querySelector('.gco-title').addEventListener('click', async () => {
      const isCollapsed = root.classList.toggle('collapsed');
      await chrome.storage.local.set({ [STORAGE_KEYS.COLLAPSED]: isCollapsed });
    });

    const tabsContainer = root.querySelector('.gco-folder-tabs');
    sortedFolders.forEach(f => {
      const tab = document.createElement('button');
      tab.className = 'gco-folder-tab' + (f.id === currentFolderFilter ? ' active' : '');
      tab.textContent = f.name;
      tab.dataset.folderId = f.id;
      tab.addEventListener('click', () => {
        root.querySelectorAll('.gco-folder-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        applyFolderFilter(f.id);
      });
      tabsContainer.appendChild(tab);
    });

    root.querySelector('.gco-manage-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openPopup' });
    });

    try {
      const ref = (insertBefore && container.contains(insertBefore)) ? insertBefore : container.firstChild;
      container.insertBefore(root, ref);
    } catch (e) {
      container.insertBefore(root, container.firstChild);
    }

    // Process existing chat items
    const chatItems = findChatListItems();
    chatItems.forEach(item => {
      const chatId = getChatId(item);
      const title = getChatTitle(item);
      addFolderButton(item, chatId, title);
    });
    applyFolderFilter(currentFolderFilter);

    // Observe for new chat items (Gemini loads dynamically)
    const observer = new MutationObserver(() => {
      if (isApplyingFilter) return;
      
      findChatListItems().forEach(item => {
        const chatId = getChatId(item);
        const title = getChatTitle(item);
        addFolderButton(item, chatId, title);
      });
      applyFolderFilter(currentFolderFilter);
    });
    observer.observe(container, { childList: true, subtree: true });
  }

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local' && (changes[STORAGE_KEYS.FOLDERS] || changes[STORAGE_KEYS.MAPPINGS])) {
      
      const root = document.getElementById('gco-organizer-root');
      if (root) {
        // Just rebuild the tabs!
        const { folders } = await loadData();
        const sortedFolders = [...folders].sort((a, b) => a.order - b.order);
        const tabsContainer = root.querySelector('.gco-folder-tabs');
        tabsContainer.innerHTML = '';
        sortedFolders.forEach(f => {
          const tab = document.createElement('button');
          tab.className = 'gco-folder-tab' + (f.id === currentFolderFilter ? ' active' : '');
          tab.textContent = f.name;
          tab.dataset.folderId = f.id;
          tab.addEventListener('click', () => {
            root.querySelectorAll('.gco-folder-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            applyFolderFilter(f.id);
          });
          tabsContainer.appendChild(tab);
        });
      }

      applyFolderFilter(currentFolderFilter);
    }
  });

  // Helper to scroll and wait for lazy-loaded items
  async function scrollAllChats() {
    const listContainer = document.querySelector('infinite-scroller, [data-test-id="all-conversations"], .chat-history-list');
    let scrollEl = listContainer;
    
    // Find the actual scrollable element
    while (scrollEl && scrollEl !== document.body) {
      if (getComputedStyle(scrollEl).overflowY.match(/(scroll|auto|overlay)/)) {
        break;
      }
      scrollEl = scrollEl.parentElement;
    }
    
    if (!scrollEl) return;

    let previousHeight = 0;
    let retries = 0;

    while (retries < 3) {
      const currentHeight = scrollEl.scrollHeight;
      scrollEl.scrollTo(0, currentHeight);
      
      // Give Gemini's React/API time to fetch and render the next batch
      await new Promise(r => setTimeout(r, 600)); 
      
      if (scrollEl.scrollHeight > currentHeight) {
        retries = 0; // Reset retries if we actually grew
      } else {
        retries++;
      }
    }
    
    // Scroll back to top after we are done
    scrollEl.scrollTo(0, 0);
  }

  // Listen for signals from popup to scrape all chats
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'forceUpdateSidebar') {
      (async () => {
        const root = document.getElementById('gco-organizer-root');
        if (root) {
          const { folders } = await loadData();
          const sortedFolders = [...folders].sort((a, b) => a.order - b.order);
          const tabsContainer = root.querySelector('.gco-folder-tabs');
          tabsContainer.innerHTML = '';
          sortedFolders.forEach(f => {
            const tab = document.createElement('button');
            tab.className = 'gco-folder-tab' + (f.id === currentFolderFilter ? ' active' : '');
            tab.textContent = f.name;
            tab.dataset.folderId = f.id;
            tab.addEventListener('click', () => {
              root.querySelectorAll('.gco-folder-tab').forEach(t => t.classList.remove('active'));
              tab.classList.add('active');
              applyFolderFilter(f.id);
            });
            tabsContainer.appendChild(tab);
          });
          applyFolderFilter(currentFolderFilter);
        }
      })();
      sendResponse({ status: 'ok' });
      return true;
    }

    if (request.action === 'scrapeAllChats') {
      
      scrollAllChats().then(() => {
        // Direct aggressive DOM scrape instead of just what is visible in `findChatListItems`
        const allLinks = Array.from(document.querySelectorAll('a[href*="/app/"]'));
        const scraped = [];
        const seenIds = new Set();
  
        allLinks.forEach(el => {
          const urlMatch = el.href.match(/\/app\/([a-zA-Z0-9_-]{10,})/);
          if (urlMatch) {
            const id = urlMatch[1];
            // Avoid duplicates
            if (seenIds.has(id)) return;
            seenIds.add(id);
  
            const titleEl = el.querySelector('.conversation-title') || el.querySelector('[data-title]') || el;
            const title = (titleEl.textContent || titleEl.title || 'Untitled').trim().slice(0, 100);
            
            scraped.push({ id, title, url: el.href });
          }
        });
        
        sendResponse({ chats: scraped });
      });
      return true; // Keep message channel open for async response
    }
  });

  function waitAndInject() {
    const result = findChatListContainer();
    if (result?.container) {
      injectFolderOrganization();
      return;
    }
    const observer = new MutationObserver(() => {
      const res = findChatListContainer();
      if (res?.container) {
        injectFolderOrganization();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      if (!document.getElementById('gco-organizer-root')) {
        const res = findChatListContainer();
        if (res?.container) injectFolderOrganization();
      }
      observer.disconnect();
    }, 15000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(waitAndInject, 1500));
  } else {
    setTimeout(waitAndInject, 1500);
  }
})();
