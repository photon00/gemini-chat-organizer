# Gemini Chat Organizer

A Chrome extension that adds folder-based organization to [Gemini](https://gemini.google.com) chats, similar to ChatGPT's project folders.

## Features

- **Create folders** – Organize chats into custom folders (e.g., Work, Personal, Research)
- **Filter by folder** – Click a folder tab to show only chats in that folder
- **Assign chats** – Use the folder icon next to each chat to assign it to a folder
- **Persistent storage** – Folders and assignments are stored locally in Chrome

## Installation

1. Clone or download this folder
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `Gemini_organizer` folder

## Usage

1. Open [gemini.google.com](https://gemini.google.com) and sign in
2. The extension adds a **Folders** bar at the top of the chat sidebar
3. Click **Add Folder** in the extension popup (click the puzzle icon → Gemini Chat Organizer) to create folders
4. Click the folder icon next to a chat to assign it to a folder
5. Click folder tabs to filter the chat list

## Customization

If the extension doesn’t detect chats correctly (e.g., after a Gemini UI update), you may need to adjust the selectors in `content.js`:

- `findChatListItems()` – Selectors used to find chat list items
- `findSidebar()` – Selector for the sidebar container
- `getChatId()` – Logic for identifying each chat (URL, data attributes, or text hash)

## Privacy

All data is stored locally in Chrome (`chrome.storage.local`). Nothing is sent to external servers.

## Optional: Add Icons

For a custom icon in the toolbar, add PNG files to the `icons/` folder:

- `icon16.png` (16×16)
- `icon48.png` (48×48)
- `icon128.png` (128×128)

Then add this to `manifest.json`:

```json
"action": {
  "default_popup": "popup.html",
  "default_icon": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "default_title": "Gemini Chat Organizer"
},
"icons": {
  "16": "icons/icon16.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png"
}
```
