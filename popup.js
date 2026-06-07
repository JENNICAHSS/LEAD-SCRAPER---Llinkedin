// popup.js — Lead Scraper Extension

const mainToggle  = document.getElementById('mainToggle');
const statusLabel = document.getElementById('statusLabel');
const offPanel    = document.getElementById('offPanel');
const onPanel     = document.getElementById('onPanel');
const queryInput  = document.getElementById('queryInput');
const pagesSelect = document.getElementById('pagesSelect');
const scrapeBtn   = document.getElementById('scrapeBtn');
const logBox      = document.getElementById('logBox');
const statusTxt   = document.getElementById('statusTxt');
const leadCount   = document.getElementById('leadCount');

let totalLeads = 0;

// ── Load saved state ────────────────────────────────────────────────────────
chrome.storage.local.get(['scraperOn', 'lastQuery'], result => {
  const isOn = result.scraperOn || false;
  mainToggle.checked = isOn;
  if (result.lastQuery) queryInput.value = result.lastQuery;
  renderToggle(isOn);
});

// ── Toggle handler ──────────────────────────────────────────────────────────
mainToggle.addEventListener('change', () => {
  const isOn = mainToggle.checked;
  chrome.storage.local.set({ scraperOn: isOn });
  renderToggle(isOn);
});

function renderToggle(isOn) {
  statusLabel.textContent = isOn ? 'ON' : 'OFF';
  statusLabel.className = 'toggle-status' + (isOn ? ' on' : '');
  offPanel.classList.toggle('hidden', isOn);
  onPanel.classList.toggle('hidden', !isOn);
}

// ── Start scraping ──────────────────────────────────────────────────────────
scrapeBtn.addEventListener('click', startScraping);
queryInput.addEventListener('keydown', e => { if (e.key === 'Enter') startScraping(); });

async function startScraping() {
  const query = queryInput.value.trim();
  if (!query) { log('Enter a search query first.', 'warn'); return; }

  chrome.storage.local.set({ lastQuery: query });

  scrapeBtn.disabled = true;
  scrapeBtn.textContent = '⏳ Running...';
  logBox.innerHTML = '';
  totalLeads = 0;
  updateCount(0);
  setStatus('Searching...', 'active');

  log(`Query: "${query}"`, 'info');

  const pages = parseInt(pagesSelect.value);

  try {
    // ── Step 1: Find LinkedIn profiles ─────────────────────────────────────
    const profiles = await findLinkedInProfiles(query, pages);

    if (!profiles.length) {
      log('No results found. Try different keywords.', 'warn');
      setStatus('No results', '');
      return;
    }

    const unique = dedup(profiles);
    log(`✓ ${unique.length} unique profiles found`, 'ok');
    updateCount(unique.length);

    // ── Step 2: Enrich each lead ────────────────────────────────────────────
    log('Enriching with phone, address, hours...', 'info');
    setStatus(`Enriching 0 / ${unique.length}`, 'active');

    for (let i = 0; i < unique.length; i++) {
      const lead = unique[i];
      const label = (lead.company || lead.name || '?').substring(0, 35);
      const lineEl = logLine(`[${i+1}/${unique.length}] ${label}`, 'find');
      setStatus(`Enriching ${i+1} / ${unique.length}`, 'active');

      await enrichLead(lead, query);

      const badges = [];
      if (lead.phone)   badges.push('📞');
      if (lead.email)   badges.push('✉');
      if (lead.website) badges.push('🌐');
      if (lead.address) badges.push('📍');
      if (lead.hours)   badges.push('🕐');
      if (badges.length) lineEl.textContent += '  ' + badges.join(' ');

      await sleep(1200 + Math.random() * 1000);
    }

    // ── Step 3: Download CSV ────────────────────────────────────────────────
    const csv      = buildCSV(unique);
    const filename = 'leads_' + sanitize(query) + '_' + dateStr() + '.csv';
    downloadCSV(csv, filename);

    log(`✅ ${unique.length} leads saved → ${filename}`, 'ok');
    setStatus(`✅ Done — ${unique.length} leads`, 'done');

  } catch (err) {
    log(`Error: ${err.message}`, 'warn');
    setStatus('Error — see log', '');
    console.error(err);
  } finally {
    scrapeBtn.disabled = false;
    scrapeBtn.textContent = '▶ Scrape Leads';
  }
}


// ────────────────────────────────────────────────────────────────────────────
// STEP 1 — Find LinkedIn profiles via Google (real browser tabs)
// ────────────────────────────────────────────────────────────────────────────
async function findLinkedInProfiles(query, numPages) {
  const all = [];

  for (let page = 0; page < numPages; page++) {
    const start = page * 10;
    const gq    = `site:linkedin.com/in ${query}`;
    const url   = `https://www.google.com/search?q=${encodeURIComponent(gq)}&num=10&start=${start}&hl=en`;

    log(`  Google page ${page + 1} / ${numPages}...`);

    try {
      const tab = await newTab(url);
      await tabLoaded(tab.id);

      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractLinkedInResults
      });

      await chrome.tabs.remove(tab.id);

      const batch = res?.[0]?.result || [];
      all.push(...batch);
      log(`  Page ${page + 1}: ${batch.length} found`);

    } catch (err) {
      log(`  Page ${page + 1} failed: ${err.message}`, 'warn');
    }

    if (page < numPages - 1) await sleep(2000 + Math.random() * 2000);
  }

  return all;
}

// Runs inside the Google search results tab
function extractLinkedInResults() {
  const leads = [];

  document.querySelectorAll('div.g, [data-hveid]').forEach(block => {
    try {
      const h3   = block.querySelector('h3');
      const snip = block.querySelector('div.VwiC3b, div[data-sncf]');
      const link = block.querySelector('a[href]');

      if (!h3 || !link) return;
      if (!link.href.includes('linkedin.com/in/')) return;

      const raw     = (h3.textContent || '').trim();
      const snippet = (snip?.textContent || '').trim().substring(0, 200);

      // Parse "Name - Title at Company | LinkedIn"
      let clean   = raw.replace(/\s*[|·]\s*LinkedIn.*/i, '').trim();
      let name    = clean, title = '', company = '';

      for (const sep of [' - ', ' – ', ' — ']) {
        if (clean.includes(sep)) {
          const idx  = clean.indexOf(sep);
          name       = clean.slice(0, idx).trim();
          const rest = clean.slice(idx + sep.length).trim();
          const at   = rest.split(/ at /i);
          if (at.length >= 2) {
            title   = at[0].trim();
            company = at.slice(1).join(' at ').trim();
          } else {
            title = rest;
          }
          break;
        }
      }

      if (name && name.length >= 3) {
        leads.push({
          name, title, company,
          linkedin_url: link.href.split('?')[0],
          snippet,
          phone: '', email: '', website: '',
          address: '', hours: '', rating: '',
          reviews: '', maps_url: ''
        });
      }
    } catch (_) {}
  });

  return leads;
}


// ────────────────────────────────────────────────────────────────────────────
// STEP 2 — Enrich each lead with business details
// ────────────────────────────────────────────────────────────────────────────
async function enrichLead(lead, originalQuery) {
  const term = lead.company || lead.name;
  if (!term) return;

  const loc = extractLocation(originalQuery);
  const q   = loc ? `${term} ${loc} phone hours address` : `${term} phone hours address`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en`;

  try {
    const tab = await newTab(url);
    await tabLoaded(tab.id);

    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractBusinessInfo
    });

    await chrome.tabs.remove(tab.id);

    const info = res?.[0]?.result;
    if (info) Object.assign(lead, info);

  } catch (_) {}
}

// Runs inside the Google business search tab
function extractBusinessInfo() {
  const text   = document.body.innerText || '';
  const result = {};

  // Phone — US format
  const phoneM = text.match(/\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/);
  if (phoneM) result.phone = phoneM[0];

  // Address
  const addrM = text.match(
    /\d{1,5}\s[\w\s\.]+(?:St\.?|Ave\.?|Blvd\.?|Dr\.?|Rd\.?|Ln\.?|Way|Pkwy|Suite|Ste)[^,\n]{0,40},\s*[\w\s]+,\s*[A-Z]{2}\s*\d{5}/i
  );
  if (addrM) result.address = addrM[0].trim();

  // Hours
  const hoursM = text.match(
    /(?:Open\s*·?\s*)?(?:Closes?\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*[AP]M|Open\s+24\s+hours|Temporarily\s+closed)/i
  );
  if (hoursM) result.hours = hoursM[0].trim();

  // Rating
  const ratingM = text.match(/(\d\.\d)\s*(?:stars?|rating|\([\d,]+\s*review)/i);
  if (ratingM) result.rating = ratingM[1];

  // Reviews count
  const revM = text.match(/([\d,]+)\s*(?:Google\s+)?reviews?/i);
  if (revM) result.reviews = revM[1];

  // Email
  const emailM = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,6}/);
  if (emailM) {
    const e = emailM[0].toLowerCase();
    const bad = ['noreply','example','test','sentry','schema','w3.org'];
    if (!bad.some(b => e.includes(b))) result.email = e;
  }

  // Website — first non-Google/social link
  const skip = ['google.com','linkedin.com','facebook.com','twitter.com',
                 'instagram.com','youtube.com','yelp.com','wikipedia.org'];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href || '';
    if (href.startsWith('http') && !skip.some(d => href.includes(d))) {
      result.website = href;
      break;
    }
  }

  // Google Maps link
  const mapsA = document.querySelector('a[href*="google.com/maps"]');
  if (mapsA) result.maps_url = mapsA.href;

  return result;
}


// ────────────────────────────────────────────────────────────────────────────
// STEP 3 — Build CSV and download
// ────────────────────────────────────────────────────────────────────────────
function buildCSV(leads) {
  const headers = [
    'Full Name','Job Title','Company','Address','Phone',
    'Business Hours','Rating','Reviews','Website','Email',
    'LinkedIn URL','Google Maps Link','Bio Summary'
  ];

  const esc = v => `"${(v || '').toString().replace(/"/g, '""')}"`;

  const rows = leads.map(l => [
    l.name, l.title, l.company, l.address, l.phone,
    l.hours, l.rating, l.reviews, l.website, l.email,
    l.linkedin_url, l.maps_url, l.snippet
  ].map(esc).join(','));

  return '\uFEFF' + [headers.map(esc).join(','), ...rows].join('\r\n');
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


// ────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ────────────────────────────────────────────────────────────────────────────
function newTab(url) {
  return chrome.tabs.create({ url, active: false });
}

function tabLoaded(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(fn);
      reject(new Error('Tab load timeout'));
    }, 25000);

    function fn(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(fn);
        setTimeout(resolve, 1200); // wait for dynamic content
      }
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dedup(arr) {
  const seen = new Set();
  return arr.filter(l => {
    const k = l.linkedin_url || l.name;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

function extractLocation(query) {
  const states = [
    'Alabama','Alaska','Arizona','Arkansas','California','Colorado',
    'Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho',
    'Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine',
    'Maryland','Massachusetts','Michigan','Minnesota','Mississippi',
    'Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey',
    'New Mexico','New York','North Carolina','North Dakota','Ohio',
    'Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina',
    'South Dakota','Tennessee','Texas','Utah','Vermont','Virginia',
    'Washington','West Virginia','Wisconsin','Wyoming',
    'NC','NY','CA','TX','FL','GA','IL','PA','OH','MI','NJ','VA',
    'WA','AZ','MA','TN','IN','MO','MD','WI','MN','CO','AL','SC',
  ];
  for (const s of states) {
    if (new RegExp(`\\b${s}\\b`, 'i').test(query)) return s;
  }
  const w = query.trim().split(/\s+/);
  return w.slice(-2).join(' ');
}

function sanitize(s) {
  return s.replace(/[^a-z0-9]/gi, '_').replace(/_+/g,'_').substring(0, 40);
}

function dateStr() {
  return new Date().toISOString().slice(0,10).replace(/-/g,'');
}

// ── UI helpers ──────────────────────────────────────────────────────────────
function log(msg, type = '') {
  const d = document.createElement('div');
  d.className = 'l ' + type;
  d.textContent = msg;
  logBox.appendChild(d);
  logBox.scrollTop = logBox.scrollHeight;
  return d;
}

function logLine(msg, type = '') {
  return log(msg, type);
}

function setStatus(msg, cls = '') {
  statusTxt.textContent = msg;
  statusTxt.className = 'status-text ' + cls;
}

function updateCount(n) {
  totalLeads = n;
  const span = leadCount.querySelector('span');
  if (span) span.textContent = n;
}
