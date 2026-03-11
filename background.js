let popupWindowId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openPopup') {
    if (popupWindowId !== null) {
      // Check if window still exists
      chrome.windows.get(popupWindowId, (win) => {
        if (chrome.runtime.lastError || !win) {
          // Window was closed, create new
          createPopupWindow();
        } else {
          // Window exists, just focus it
          chrome.windows.update(popupWindowId, { focused: true });
        }
      });
    } else {
      createPopupWindow();
    }
    sendResponse({ ok: true });
  }
  return true;
});

function createPopupWindow() {
  chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 360,
    height: 480,
  }, (window) => {
    popupWindowId = window.id;
  });
}

// Clean up when window is closed
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === popupWindowId) {
    popupWindowId = null;
  }
});
