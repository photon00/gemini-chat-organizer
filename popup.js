const STORAGE_KEYS = {
  FOLDERS: 'gemini_organizer_folders',
  MAPPINGS: 'gemini_organizer_mappings',
};

const DEFAULT_FOLDERS = [
  { id: 'default', name: 'All Chats', order: 0 },
];

async function loadFolders() {
  const result = await chrome.storage.local.get([STORAGE_KEYS.FOLDERS]);
  return result[STORAGE_KEYS.FOLDERS] || DEFAULT_FOLDERS;
}

async function saveFolders(folders) {
  await chrome.storage.local.set({ [STORAGE_KEYS.FOLDERS]: folders });
}

function generateId() {
  return 'folder_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

// Immediately notify the active Gemini tab to instantly re-render its sidebar
function notifySidebarUpdate() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url.includes('gemini.google.com')) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'forceUpdateSidebar' }).catch(() => {});
    }
  });
}

function renderFolders(folders, mappings) {
  const list = document.getElementById('folderList');
  const sorted = [...folders].sort((a, b) => a.order - b.order);

  // Group mappings by folderId
  const chatsByFolder = {};
  if (mappings) {
    Object.entries(mappings).forEach(([idOrTitle, data]) => {
      // Data could be a string (legacy) or an object
      const folderId = typeof data === 'string' ? data : (data?.folderId || 'default');
      const title = typeof data === 'object' && data.title ? data.title : idOrTitle;
      const url = typeof data === 'object' ? data.url : null;
      
      if (!chatsByFolder[folderId]) chatsByFolder[folderId] = [];
      // Prevent duplicates if saved under both hash and ID
      if (!chatsByFolder[folderId].find(c => c.title === title || (url && c.url === url))) {
        chatsByFolder[folderId].push({ key: idOrTitle, title, url });
      }
    });
  }

  list.innerHTML = sorted
    .filter((f) => f.id !== 'default')
    .map(
      (f) => {
        const folderChats = chatsByFolder[f.id] || [];
        const chatsHtml = folderChats.map(c => `
          <div class="chat-item" data-chat-key="${c.key}">
            <span class="chat-name" title="${escapeHtml(c.title)}">📄 ${escapeHtml(c.title)}</span>
            <button class="remove-chat" title="Remove from folder">✖</button>
          </div>
        `).join('');

        return `
    <div class="folder-container" data-id="${f.id}" draggable="true">
      <div class="folder-item collapsed">
        <span class="drag-handle" title="Drag to reorder">☰</span>
        <span class="name" spellcheck="false" title="Click to view chats">${escapeHtml(f.name)} (${folderChats.length})</span>
        <div class="folder-actions">
          <button class="edit" title="Rename folder">✏️</button>
          <button class="delete" title="Delete folder">🗑</button>
        </div>
      </div>
      ${folderChats.length > 0 ? `<div class="folder-chats">${chatsHtml}</div>` : ''}
    </div>
  `})
    .join('');

  // Toggle accordion
  list.querySelectorAll('.folder-item .name').forEach(nameSpan => {
    nameSpan.addEventListener('click', (e) => {
      if (nameSpan.isContentEditable) return;
      const item = nameSpan.closest('.folder-item');
      item.classList.toggle('collapsed');
    });
  });

  // Remove chat assignments
  list.querySelectorAll('.remove-chat').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const chatKey = btn.closest('.chat-item').dataset.chatKey;
      const result = await chrome.storage.local.get([STORAGE_KEYS.MAPPINGS]);
      const currentMappings = result[STORAGE_KEYS.MAPPINGS] || {};
      
      delete currentMappings[chatKey];
      await chrome.storage.local.set({ [STORAGE_KEYS.MAPPINGS]: currentMappings });
      
      const folders = await loadFolders();
      renderFolders(folders, currentMappings);
    });
  });

  list.querySelectorAll('.delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this folder? Chats inside will be moved to "All Chats".')) return;
      const id = btn.closest('.folder-container').dataset.id;
      const folders = await loadFolders();
      const updated = folders.filter((f) => f.id !== id);
      
      const result = await chrome.storage.local.get([STORAGE_KEYS.MAPPINGS]);
      let currentMappings = result[STORAGE_KEYS.MAPPINGS] || {};
      
      // Cleanup mappings
      Object.entries(currentMappings).forEach(([key, data]) => {
        if (typeof data === 'string' && data === id) {
          delete currentMappings[key];
        } else if (typeof data === 'object' && data.folderId === id) {
          delete currentMappings[key];
        }
      });
      await chrome.storage.local.set({ [STORAGE_KEYS.MAPPINGS]: currentMappings });

      await saveFolders(updated);
      renderFolders(updated, currentMappings);
      notifySidebarUpdate();
    });
  });

  list.querySelectorAll('.edit').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const container = btn.closest('.folder-container');
      container.draggable = false; // Disable dragging while editing
      const nameEl = container.querySelector('.name');
      const currentName = nameEl.textContent.replace(/\s\(\d+\)$/, ''); // Strip out chat count
      
      nameEl.contentEditable = true;
      nameEl.textContent = currentName; // Show just the name while editing
      nameEl.focus();
      
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(nameEl);
      selection.removeAllRanges();
      selection.addRange(range);

      const saveEdit = async () => {
        nameEl.contentEditable = false;
        container.draggable = true;
        const newName = nameEl.textContent.trim();
        const folders = await loadFolders();
        const result = await chrome.storage.local.get([STORAGE_KEYS.MAPPINGS]);
        const mappings = result[STORAGE_KEYS.MAPPINGS] || {};

        if (newName && newName !== currentName) {
          const id = container.dataset.id;
          const folder = folders.find(f => f.id === id);
          if (folder) {
            folder.name = newName;
            await saveFolders(folders);
          }
        }
        // Force full re-render to put the chat count back!
        renderFolders(folders, mappings);
        notifySidebarUpdate();
      };

      nameEl.addEventListener('blur', saveEdit, { once: true });
      nameEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          nameEl.blur();
        }
        if (e.key === 'Escape') {
          nameEl.textContent = currentName;
          nameEl.blur();
        }
      });
    });
  });

  list.querySelectorAll('.folder-container').forEach(item => {
    item.addEventListener('dragstart', () => {
      if (item.querySelector('.name').isContentEditable) return;
      setTimeout(() => item.classList.add('dragging'), 0);
    });
    item.addEventListener('dragend', async () => {
      item.classList.remove('dragging');
      // Save order
      const folders = await loadFolders();
      const domIds = Array.from(list.querySelectorAll('.folder-container')).map(el => el.dataset.id);
      domIds.forEach((id, index) => {
        const folder = folders.find(f => f.id === id);
        if (folder) folder.order = index + 1;
      });
      await saveFolders(folders);
      notifySidebarUpdate();
    });
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.folder-container:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function escapeHtml(text) {
  const el = document.createElement('div');
  el.textContent = text;
  return el.innerHTML;
}

document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('folderList');
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const afterElement = getDragAfterElement(list, e.clientY);
    const dragging = document.querySelector('.dragging');
    if (dragging) {
      if (afterElement == null) {
        list.appendChild(dragging);
      } else {
        list.insertBefore(dragging, afterElement);
      }
    }
  });

  const folders = await loadFolders();
  const res = await chrome.storage.local.get([STORAGE_KEYS.MAPPINGS]);
  renderFolders(folders, res[STORAGE_KEYS.MAPPINGS] || {});

  const input = document.getElementById('newFolderName');
  const addBtn = document.getElementById('addFolderBtn');

  addBtn.addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name) return;

    const folders = await loadFolders();
    const mapRes = await chrome.storage.local.get([STORAGE_KEYS.MAPPINGS]);
    const maxOrder = Math.max(...folders.map((f) => f.order), 0);
    folders.push({
      id: generateId(),
      name,
      order: maxOrder + 1,
    });
    await saveFolders(folders);
    renderFolders(folders, mapRes[STORAGE_KEYS.MAPPINGS] || {});
    notifySidebarUpdate();
    input.value = '';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click();
  });

  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');

  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    exportBtn.textContent = 'Exporting...';

    try {
      const result = await chrome.storage.local.get([STORAGE_KEYS.FOLDERS, STORAGE_KEYS.MAPPINGS]);
      let mappings = result[STORAGE_KEYS.MAPPINGS] || {};

      // Try to ask the active tab to scrape ALL visible chats
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url?.includes('gemini.google.com')) {
        try {
          const response = await new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tab.id, { action: 'scrapeAllChats' }, (res) => {
              if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
              else resolve(res);
            });
            // Timeout in case content script isn't ready or listening (give it 30s for large histories)
            setTimeout(() => reject(new Error('timeout')), 30000);
          });
          
          if (response && response.chats) {
            // Merge the scraped chats with mapping data. Stored mappings take priority for folderId.
            response.chats.forEach(chat => {
              if (!mappings[chat.id]) {
                mappings[chat.id] = { folderId: 'default', title: chat.title, url: chat.url };
              } else if (typeof mappings[chat.id] === 'string') {
                mappings[chat.id] = { folderId: mappings[chat.id], title: chat.title, url: chat.url };
              }
              // If it already exists as an object, leave it so we preserve their manually assigned folder
            });
          }
        } catch (err) {
          console.log('Could not scrape visible chats from tab:', err);
        }
      }

      const data = {
        folders: result[STORAGE_KEYS.FOLDERS] || DEFAULT_FOLDERS,
        chats: mappings
      };
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `gemini_folders_export_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = 'Export';
    }
  });

  importBtn.addEventListener('click', () => {
    importFile.click();
  });

  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target.result);
        if (json.folders && json.chats) {
          
          if (confirm('Are you sure you want to restore these folders? This will merge with or overwrite current data.')) {
            const currentFolders = await loadFolders();
            const currentResult = await chrome.storage.local.get([STORAGE_KEYS.MAPPINGS]);
            const currentMappings = currentResult[STORAGE_KEYS.MAPPINGS] || {};

            // Basic merge strategy (latest wins for keys)
            const newFoldersMap = new Map();
            currentFolders.forEach(f => newFoldersMap.set(f.id, f));
            json.folders.forEach(f => newFoldersMap.set(f.id, f));
            
            const mergedMappings = { ...currentMappings, ...json.chats };

            await chrome.storage.local.set({
              [STORAGE_KEYS.FOLDERS]: Array.from(newFoldersMap.values()),
              [STORAGE_KEYS.MAPPINGS]: mergedMappings
            });

            renderFolders(Array.from(newFoldersMap.values()), mergedMappings);
            alert('Folders and mappings verified and imported successfully! Refresh Gemini to see changes.');
          }
        } else {
          alert('Invalid JSON file format. Missing "folders" or "chats" block.');
        }
      } catch (err) {
        alert('Failed to parse JSON file.');
        console.error(err);
      }
      importFile.value = ''; // Reset file input
    };
    reader.readAsText(file);
  });
});
