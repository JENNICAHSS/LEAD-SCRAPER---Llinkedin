# 🔎 Lead Scraper — Free Chrome Extension

> Type any search. Get a full lead list with names, phones, emails, addresses, and hours — exported to Excel. No paid tools. No API keys. Completely free.

-----

## What It Does

This Chrome extension finds business leads from LinkedIn profiles via Google search, then automatically enriches each lead with contact details scraped from their company website and Google Business listings.

**You type:** `medical spa owners North Carolina`

**You get:** An Excel-ready CSV with:

|Field           |Example                                          |
|----------------|-------------------------------------------------|
|Full Name       |Jessica Taylor                                   |
|Job Title       |Owner & Medical Director                         |
|Company         |Glow Med Spa                                     |
|Address         |123 Main St, Raleigh, NC 27601                   |
|Phone           |(919) 555-0142                                   |
|Business Hours  |Closes 6 PM                                      |
|Rating          |4.8                                              |
|Website         |<https://glowmedspa.com>                         |
|Email           |[info@glowmedspa.com](mailto:info@glowmedspa.com)|
|LinkedIn URL    |linkedin.com/in/jessica-taylor                   |
|Google Maps Link|maps.google.com/…                                |

-----

## Installation

**Takes about 30 seconds.**

1. Download or clone this repository
1. Open Chrome and go to `chrome://extensions/`
1. Turn on **Developer Mode** (top-right toggle)
1. Click **“Load unpacked”**
1. Select the `lead_scraper_extension` folder
1. Pin the 🔎 icon to your toolbar

-----

## How to Use

1. Click the **🔎** icon in your Chrome toolbar
1. Toggle the switch **ON**
1. Type your search query
1. Select how many pages to scrape
1. Click **▶ Scrape Leads**
1. A `.csv` file downloads automatically when done — opens in Excel or Google Sheets

**Toggle OFF** when you’re done — your browser works completely normally.

-----

## Search Examples

```
medical spa owners North Carolina
realtors in Austin Texas
gym owners Florida
dentists Phoenix Arizona
restaurant owners Chicago Illinois
real estate agents New York
lawyers in Miami Florida
```

-----

## How It Works

```
Google search: site:linkedin.com/in [your query]
        ↓
Parses name, title, company, LinkedIn URL from results
        ↓
Google search per company → extracts phone, address, hours, rating
        ↓
Scrapes company website → finds email address
        ↓
Downloads everything as a formatted CSV
```

No LinkedIn account needed. No API keys. No paid subscriptions.

-----

## Notes

- Opens brief background tabs while scraping — this is normal
- Built-in delays prevent Google rate limiting
- ~30 leads takes roughly 5–8 minutes
- If Google shows a CAPTCHA, wait 10–15 minutes and retry

-----

## Files

```
lead_scraper_extension/
├── manifest.json       # Chrome extension config
├── popup.html          # Extension UI
├── popup.js            # All scraping logic
├── background.js       # Service worker
└── icons/              # Extension icons
```

-----

## License

MIT — free to use, modify, and share.