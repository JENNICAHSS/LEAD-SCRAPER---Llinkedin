// background.js — Lead Scraper Extension
// Minimal service worker — all logic runs in popup.js

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ scraperOn: false });
  console.log('Lead Scraper installed.');
});
