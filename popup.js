// popup.js — Lead Scraper (Zoho Format + Supabase Cloud Sync)

// ── Supabase config ───────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://oacgorejjshlayvacorq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GxvJ2qdDNrQP6ckwsVdQpw_j1HQA-J2';

async function saveScrapeToCloud(leads, query) {
  const summary = {
    query: query,
    total_leads:   leads.length,
    with_phone:    leads.filter(l => l.phone).length,
    with_email:    leads.filter(l => l.email).length,
    with_website:  leads.filter(l => l.website).length,
    with_linkedin: leads.filter(l => l.linkedin_url).length,
    leads: leads.map(l => ({
      name: l.name, title: l.title, company: l.company,
      address: l.address, phone: l.phone, email: l.email,
      website: l.website, rating: l.rating, reviews: l.reviews,
      hours: l.hours, linkedin_url: l.linkedin_url, maps_url: l.maps_url
    }))
  };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/scrapes`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(summary)
    });
    if (res.ok) {
      log('☁ Saved to cloud dashboard', 'ok');
    } else {
      log(`☁ Cloud save failed (${res.status})`, 'warn');
    }
  } catch (err) {
    log(`☁ Cloud save error: ${err.message}`, 'warn');
  }
}


// ── State ────────────────────────────────────────────────────────────────────
let scrapedLeads = [];
let parsedQuery  = null;
const selectedTitles = new Set();

// ── Elements ─────────────────────────────────────────────────────────────────
const mainToggle      = document.getElementById('mainToggle');
const statusLabel     = document.getElementById('statusLabel');
const offPanel        = document.getElementById('offPanel');
const onPanel         = document.getElementById('onPanel');
const filterToggleBtn = document.getElementById('filterToggleBtn');
const filterBody      = document.getElementById('filterBody');
const filterArrow     = document.getElementById('filterArrow');
const queryInput      = document.getElementById('queryInput');
const pagesSelect     = document.getElementById('pagesSelect');
const scrapeBtn       = document.getElementById('scrapeBtn');
const logBox          = document.getElementById('logBox');
const statusTxt       = document.getElementById('statusTxt');
const leadCount       = document.getElementById('leadCount');
const postActions     = document.getElementById('postActions');
const adjustBtn       = document.getElementById('adjustBtn');
const downloadBtn     = document.getElementById('downloadBtn');
const newSearchBtn    = document.getElementById('newSearchBtn');
const fPhone          = document.getElementById('fPhone');
const fEmail          = document.getElementById('fEmail');
const fWebsite        = document.getElementById('fWebsite');
const fLinkedin       = document.getElementById('fLinkedin');
const fRating         = document.getElementById('fRating');

// ── Init ─────────────────────────────────────────────────────────────────────
chrome.storage.local.get(['scraperOn', 'lastQuery'], result => {
  const isOn = result.scraperOn || false;
  mainToggle.checked = isOn;
  if (result.lastQuery) queryInput.value = result.lastQuery;
  renderToggle(isOn);
});

mainToggle.addEventListener('change', () => {
  const isOn = mainToggle.checked;
  chrome.storage.local.set({ scraperOn: isOn });
  renderToggle(isOn);
});

function renderToggle(isOn) {
  statusLabel.textContent = isOn ? 'ON' : 'OFF';
  statusLabel.className   = 'toggle-status' + (isOn ? ' on' : '');
  offPanel.classList.toggle('hidden', isOn);
  onPanel.classList.toggle('hidden', !isOn);
}

// ── Filter panel accordion ────────────────────────────────────────────────────
let filterOpen = false;
filterToggleBtn.addEventListener('click', () => {
  filterOpen = !filterOpen;
  filterBody.classList.toggle('hidden', !filterOpen);
  filterArrow.textContent = filterOpen ? '▲' : '▼';
});

// ── Job title chips ───────────────────────────────────────────────────────────
document.querySelectorAll('#titleChips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const val = chip.dataset.val;
    if (selectedTitles.has(val)) {
      selectedTitles.delete(val);
      chip.classList.remove('active');
    } else {
      selectedTitles.add(val);
      chip.classList.add('active');
    }
  });
});

// ── Scrape button ─────────────────────────────────────────────────────────────
scrapeBtn.addEventListener('click', startScraping);
queryInput.addEventListener('keydown', e => { if (e.key === 'Enter') startScraping(); });

// ── Post-scrape actions ───────────────────────────────────────────────────────
downloadBtn.addEventListener('click', () => {
  const filtered = applyFilters(scrapedLeads);
  doDownload(filtered);
});

adjustBtn.addEventListener('click', () => {
  filterOpen = true;
  filterBody.classList.remove('hidden');
  filterArrow.textContent = '▲';
  postActions.classList.add('hidden');
  scrapeBtn.disabled    = false;
  scrapeBtn.textContent = '✓ Apply & Download';
  scrapeBtn.onclick     = applyAndDownload;
});

function applyAndDownload() {
  const filtered = applyFilters(scrapedLeads);
  log(`Filters applied → ${filtered.length} leads match`, 'info');
  doDownload(filtered);
  scrapeBtn.textContent = '▶ Scrape Leads';
  scrapeBtn.onclick     = startScraping;
  postActions.classList.remove('hidden');
}

newSearchBtn.addEventListener('click', () => {
  scrapedLeads = [];
  parsedQuery  = null;
  logBox.innerHTML = '<div class="l info">Ready — set filters, enter a search, click Scrape.</div>';
  postActions.classList.add('hidden');
  setStatus('Idle', '');
  updateCount(0);
  scrapeBtn.disabled    = false;
  scrapeBtn.textContent = '▶ Scrape Leads';
  scrapeBtn.onclick     = startScraping;
});

// ── Main scrape flow ──────────────────────────────────────────────────────────
async function startScraping() {
  const query = queryInput.value.trim();
  if (!query) { log('Enter a search query first.', 'warn'); return; }

  chrome.storage.local.set({ lastQuery: query });
  scrapeBtn.disabled    = true;
  scrapeBtn.textContent = '⏳ Running...';
  postActions.classList.add('hidden');
  logBox.innerHTML = '';
  updateCount(0);
  setStatus('Parsing query...', 'active');

  parsedQuery = parseQuery(query);
  const pages = parseInt(pagesSelect.value);

  if (parsedQuery.isMulti) {
    log(`Multi-search: ${parsedQuery.parts.length} categories`, 'info');
    parsedQuery.parts.forEach(p => log(`  → "${p}"`, 'find'));
  }

  try {
    // ── Step 1: Scrape ────────────────────────────────────────────────────────
    const allLeads = [];

    for (let si = 0; si < parsedQuery.searches.length; si++) {
      const s = parsedQuery.searches[si];
      log(`Searching: "${s.query}"`, 'info');
      setStatus(`Search ${si+1} / ${parsedQuery.searches.length}...`, 'active');

      const leads = await findLinkedInProfiles(s.query, pages);
      leads.forEach(l => { l._label = s.label; l._titles = s.titles; });
      allLeads.push(...leads);
      log(`  → ${leads.length} profiles found`, leads.length > 0 ? 'ok' : '');

      if (si < parsedQuery.searches.length - 1) await sleep(2500);
    }

    scrapedLeads = dedup(allLeads);
    updateCount(scrapedLeads.length);
    log(`✓ ${scrapedLeads.length} unique profiles`, 'ok');

    if (!scrapedLeads.length) {
      log('No results. Try different keywords.', 'warn');
      setStatus('No results', '');
      scrapeBtn.disabled    = false;
      scrapeBtn.textContent = '▶ Scrape Leads';
      return;
    }

    // ── Step 2: Enrich ────────────────────────────────────────────────────────
    log(`Enriching ${scrapedLeads.length} leads...`, 'info');

    for (let i = 0; i < scrapedLeads.length; i++) {
      const lead  = scrapedLeads[i];
      const label = (lead.company || lead.name || '?').substring(0, 38);
      const line  = log(`[${i+1}/${scrapedLeads.length}] ${label}`, 'find');
      setStatus(`Enriching ${i+1} / ${scrapedLeads.length}`, 'active');

      await enrichLead(lead, query);

      const b = [];
      if (lead.phone)   b.push('📞');
      if (lead.email)   b.push('✉');
      if (lead.website) b.push('🌐');
      if (lead.address) b.push('📍');
      if (lead.hours)   b.push('🕐');
      if (b.length) line.textContent += '  ' + b.join(' ');

      await sleep(1200 + Math.random() * 1000);
    }

    log(`✅ Done! ${scrapedLeads.length} leads ready.`, 'ok');
    setStatus(`✅ ${scrapedLeads.length} leads ready`, 'done');
    postActions.classList.remove('hidden');

  } catch (err) {
    log(`Error: ${err.message}`, 'warn');
    setStatus('Error — see log', '');
    console.error(err);
  } finally {
    scrapeBtn.disabled    = false;
    scrapeBtn.textContent = '▶ Scrape Leads';
  }
}

// ── Query parser ──────────────────────────────────────────────────────────────
function parseQuery(query) {
  const inMatch  = query.match(/\s+in\s+(.+)$/i);
  const location = inMatch ? inMatch[1].trim() : '';
  const base     = inMatch ? query.replace(inMatch[0], '').trim() : query;
  const parts    = base.split(/\s+and\s+|,\s*|\s*&\s*/i).map(p => p.trim()).filter(Boolean);

  if (parts.length <= 1) {
    return { isMulti: false, parts: [query], location, searches: [{ query, label: 'all', titles: [query] }] };
  }

  const searches = [];
  const loc = location ? ' ' + location : '';

  searches.push({ query: parts.join(' ') + loc, label: 'combined', titles: [...parts] });

  if (parts.length >= 3) {
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        searches.push({ query: `${parts[i]} ${parts[j]}${loc}`, label: 'pair', titles: [parts[i], parts[j]] });
      }
    }
  }

  parts.forEach(p => searches.push({ query: p + loc, label: 'individual', titles: [p] }));
  return { isMulti: true, parts, location, searches };
}

// ── LinkedIn search ───────────────────────────────────────────────────────────
async function findLinkedInProfiles(query, numPages) {
  const all = [];
  for (let page = 0; page < numPages; page++) {
    const start = page * 10;
    const url = `https://www.google.com/search?q=${encodeURIComponent('site:linkedin.com/in ' + query)}&num=10&start=${start}&hl=en`;
    try {
      const tab = await newTab(url);
      await tabLoaded(tab.id);
      const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractLinkedInResults });
      await chrome.tabs.remove(tab.id);
      all.push(...(res?.[0]?.result || []));
    } catch (err) {
      log(`  Page ${page+1} error: ${err.message}`, 'warn');
    }
    if (page < numPages - 1) await sleep(2000 + Math.random() * 2000);
  }
  return all;
}

function extractLinkedInResults() {
  const leads = [];
  document.querySelectorAll('div.g, [data-hveid]').forEach(block => {
    try {
      const h3   = block.querySelector('h3');
      const snip = block.querySelector('div.VwiC3b, div[data-sncf]');
      const link = block.querySelector('a[href]');
      if (!h3 || !link || !link.href.includes('linkedin.com/in/')) return;
      const raw     = (h3.textContent || '').trim();
      const snippet = (snip?.textContent || '').trim().substring(0, 200);
      let clean = raw.replace(/\s*[|·]\s*LinkedIn.*/i, '').trim();
      let name = clean, title = '', company = '';
      for (const sep of [' - ', ' – ', ' — ']) {
        if (clean.includes(sep)) {
          const idx = clean.indexOf(sep);
          name = clean.slice(0, idx).trim();
          const rest = clean.slice(idx + sep.length).trim();
          const at = rest.split(/ at /i);
          if (at.length >= 2) { title = at[0].trim(); company = at.slice(1).join(' at ').trim(); }
          else title = rest;
          break;
        }
      }
      if (name && name.length >= 3) {
        leads.push({ name, title, company, linkedin_url: link.href.split('?')[0], snippet,
                     phone: '', email: '', website: '', address: '', hours: '',
                     rating: '', reviews: '', maps_url: '', _label: '', _titles: [] });
      }
    } catch (_) {}
  });
  return leads;
}

// ── Enrichment ────────────────────────────────────────────────────────────────
async function enrichLead(lead, originalQuery) {
  const term = lead.company || lead.name;
  if (!term) return;
  const loc = extractLocation(originalQuery);
  const url = `https://www.google.com/search?q=${encodeURIComponent(`${term}${loc ? ' '+loc : ''} phone hours address`)}&hl=en`;
  try {
    const tab = await newTab(url);
    await tabLoaded(tab.id);
    const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractBusinessInfo });
    await chrome.tabs.remove(tab.id);
    const info = res?.[0]?.result;
    if (info) Object.assign(lead, info);
  } catch (_) {}
}

function extractBusinessInfo() {
  const text = document.body.innerText || '';
  const result = {};
  const phoneM = text.match(/\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/);
  if (phoneM) result.phone = phoneM[0];
  const addrM = text.match(/\d{1,5}\s[\w\s\.]+(?:St\.?|Ave\.?|Blvd\.?|Dr\.?|Rd\.?|Ln\.?|Way|Pkwy|Suite|Ste)[^,\n]{0,40},\s*[\w\s]+,\s*[A-Z]{2}\s*\d{5}/i);
  if (addrM) result.address = addrM[0].trim();
  const hoursM = text.match(/(?:Open\s*·?\s*)?(?:Closes?\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*[AP]M|Open\s+24\s+hours|Temporarily\s+closed)/i);
  if (hoursM) result.hours = hoursM[0].trim();
  const ratingM = text.match(/(\d\.\d)\s*(?:stars?|rating|\([\d,]+\s*review)/i);
  if (ratingM) result.rating = ratingM[1];
  const emailM = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,6}/);
  if (emailM) {
    const e = emailM[0].toLowerCase();
    if (!['noreply','example','test','sentry','schema','w3.org'].some(b => e.includes(b))) result.email = e;
  }
  const skip = ['google.com','linkedin.com','facebook.com','twitter.com','instagram.com','youtube.com','yelp.com','wikipedia.org'];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href || '';
    if (href.startsWith('http') && !skip.some(d => href.includes(d))) { result.website = href; break; }
  }
  const mapsA = document.querySelector('a[href*="google.com/maps"]');
  if (mapsA) result.maps_url = mapsA.href;
  return result;
}

// ── Filter application ────────────────────────────────────────────────────────
function applyFilters(leads) {
  const ratingMin = parseFloat(fRating.value) || 0;
  const titles    = [...selectedTitles];
  return leads.filter(lead => {
    if (fPhone.checked    && !lead.phone)        return false;
    if (fEmail.checked    && !lead.email)        return false;
    if (fWebsite.checked  && !lead.website)      return false;
    if (fLinkedin.checked && !lead.linkedin_url) return false;
    if (ratingMin > 0 && lead.rating && parseFloat(lead.rating) < ratingMin) return false;
    if (titles.length > 0) {
      const text = `${lead.title} ${lead.company} ${lead.snippet}`.toLowerCase();
      if (!titles.some(t => text.includes(t.toLowerCase()))) return false;
    }
    return true;
  });
}

// ── CSV builder — Zoho Format ─────────────────────────────────────────────────
// Zoho columns: First Name, Last Name, Title, Company, Street,
//               Phone, Email, Website, Description, Rating, LinkedIn URL

const ZOHO_HEADERS = [
  'First Name', 'Last Name', 'Title', 'Company',
  'Street', 'Phone', 'Email', 'Website',
  'Description', 'Rating', 'LinkedIn URL'
];

function splitName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  return {
    first: parts[0] || '',
    last:  parts.slice(1).join(' ') || ''
  };
}

function zohoRow(l) {
  const { first, last } = splitName(l.name);
  return [
    first,
    last,
    l.title       || '',
    l.company     || '',
    l.address     || '',
    l.phone       || '',
    l.email       || '',
    l.website     || '',
    l.snippet     || '',
    l.rating      || '',
    l.linkedin_url || ''
  ];
}

function buildCSV(leads, qInfo) {
  const esc = v => `"${(v||'').toString().replace(/"/g,'""')}"`;
  const row = l => zohoRow(l).map(esc).join(',');

  // Simple flat CSV — single search
  if (!qInfo || !qInfo.isMulti) {
    return '\uFEFF' + [ZOHO_HEADERS.map(esc).join(','), ...leads.map(row)].join('\r\n');
  }

  // Sectioned CSV — multi search
  let csv = '\uFEFF';
  const blank = ','.repeat(ZOHO_HEADERS.length - 1);

  function addSection(title, sLeads) {
    if (!sLeads.length) return;
    csv += esc(`=== ${title.toUpperCase()} — ${sLeads.length} LEADS ===`) + blank + '\r\n';
    csv += ZOHO_HEADERS.map(esc).join(',') + '\r\n';
    sLeads.forEach(l => { csv += row(l) + '\r\n'; });
    csv += blank + '\r\n';
  }

  // Section 1 — all combined
  addSection(`ALL COMBINED: ${qInfo.parts.join(' + ')}`, leads.filter(l => l._label === 'combined'));

  // Section 2 — pairs
  const pairLeads = leads.filter(l => l._label === 'pair');
  if (pairLeads.length) {
    const groups = {};
    pairLeads.forEach(l => {
      const k = (l._titles || []).join(' + ');
      if (!groups[k]) groups[k] = [];
      groups[k].push(l);
    });
    Object.entries(groups).forEach(([k, g]) => addSection(k, g));
  }

  // Section 3 — individual
  const indLeads = leads.filter(l => l._label === 'individual');
  if (indLeads.length) {
    const groups = {};
    indLeads.forEach(l => {
      const k = l._titles?.[0] || l.title || 'Other';
      if (!groups[k]) groups[k] = [];
      groups[k].push(l);
    });
    Object.entries(groups).forEach(([k, g]) => addSection(k, g));
  }

  return csv;
}

function doDownload(filtered) {
  if (!filtered.length) { log('No leads match your filters.', 'warn'); return; }
  const csv      = buildCSV(filtered, parsedQuery);
  const filename = 'zoho_leads_' + sanitize(queryInput.value) + '_' + dateStr() + '.csv';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  log(`✅ Downloaded: ${filename} (${filtered.length} leads)`, 'ok');

  // Send this scrape to the cloud dashboard
  saveScrapeToCloud(filtered, queryInput.value.trim());
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function newTab(url) { return chrome.tabs.create({ url, active: false }); }

function tabLoaded(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); reject(new Error('Tab timeout')); }, 25000);
    function fn(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer); chrome.tabs.onUpdated.removeListener(fn); setTimeout(resolve, 1200);
      }
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dedup(arr) {
  const seen = new Set();
  return arr.filter(l => { const k = l.linkedin_url || l.name; if (seen.has(k)) return false; seen.add(k); return true; });
}

function extractLocation(query) {
  const places = [
    'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
    'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
    'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
    'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada',
    'New Hampshire','New Jersey','New Mexico','New York','North Carolina',
    'North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island',
    'South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont',
    'Virginia','Washington','West Virginia','Wisconsin','Wyoming',
    'NC','NY','CA','TX','FL','GA','IL','PA','OH','MI','NJ','VA','WA',
    'AZ','MA','TN','IN','MO','MD','WI','MN','CO','AL','SC','LA','KY',
    'Chennai','Mumbai','Delhi','Bangalore','Hyderabad','Kolkata','Pune',
    'Riyadh','Jeddah','Dubai','Abu Dhabi','Doha','Kuwait','Bahrain',
  ];
  for (const p of places) { if (new RegExp(`\\b${p}\\b`, 'i').test(query)) return p; }
  return query.trim().split(/\s+/).slice(-2).join(' ');
}

function sanitize(s) { return s.replace(/[^a-z0-9]/gi,'_').replace(/_+/g,'_').substring(0,40); }
function dateStr()   { return new Date().toISOString().slice(0,10).replace(/-/g,''); }

function log(msg, type = '') {
  const d = document.createElement('div');
  d.className = 'l ' + type; d.textContent = msg;
  logBox.appendChild(d); logBox.scrollTop = logBox.scrollHeight;
  return d;
}

function setStatus(msg, cls = '') { statusTxt.textContent = msg; statusTxt.className = 'status-text ' + cls; }
function updateCount(n) { const s = leadCount.querySelector('span'); if (s) s.textContent = n; }
