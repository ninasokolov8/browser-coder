// Internationalization
import { reportLocales as i18n } from './locales.js';

let currentLang = localStorage.getItem('hacklab-lang') || 'en';

// Runtime-only highlight state.
// This is intentionally NOT saved to localStorage/sessionStorage, so a normal page
// refresh clears the red border exactly as requested.
let newReportHighlightKey = null;
let highlightNewestReportOnNextLoad = false;

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('hacklab-lang', lang);

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (i18n[lang][key]) {
      el.textContent = i18n[lang][key];
    }
  });
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.title = i18n[lang].pageTitle;

  // Reload dynamic content with new language
  loadReports();
  checkCanRunTests();
}

// Language toggle
document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => setLanguage(btn.dataset.lang));
});

// Parse report filename to extract info
function parseReportFilename(filename) {
  // Format 1: 2026-01-06_security-report_17-50-55-146Z.html (old)
  // Format 2: 2026-01-06_security-report_2026-01-06_21-53-48-280Z.html (new)

  // Try new format first (with extra date in middle)
  let match = filename.match(/(\d{4}-\d{2}-\d{2})_security-report_\d{4}-\d{2}-\d{2}_(\d{2})-(\d{2})-(\d{2})-(\d+)Z(.*)?\.html/);

  // Fall back to old format
  if (!match) {
    match = filename.match(/(\d{4}-\d{2}-\d{2})_security-report_(\d{2})-(\d{2})-(\d{2})-(\d+)Z(.*)?\.html/);
  }

  if (!match) return null;

  const [, date, hours, minutes, seconds, ms, suffix] = match;
  const isHebrew = suffix === '_he';

  return {
    date,
    time: `${hours}:${minutes}:${seconds}`,
    timestamp: `${date}T${hours}:${minutes}:${seconds}.${ms}Z`,
    isHebrew,
    jsonFile: filename.replace('.html', '.json').replace('_he', ''),
  };
}

// Format date for display
function formatDate(dateStr) {
  const date = new Date(dateStr);
  const locale = currentLang === 'he' ? 'he-IL' : 'en-US';
  return date.toLocaleDateString(locale, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

// Load and display reports
async function loadReports() {
  const container = document.getElementById('reports-container');

  try {
    // Fetch the reports list from the server API
    const response = await fetch('/api/reports');

    if (!response.ok) {
      throw new Error('Failed to load reports');
    }

    const reports = await response.json();

    if (!reports || reports.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-state-icon">📭</div>
          <p data-i18n="noReports">${i18n[currentLang].noReports}</p>
        </div>
      `;
      return;
    }

    // Group reports (pair English and Hebrew)
    const reportGroups = {};
    reports.forEach(r => {
      if (r.type === 'html') {
        const info = parseReportFilename(r.name);
        if (info) {
          const key = `${info.date}_${info.time}`;
          if (!reportGroups[key]) {
            reportGroups[key] = {
              date: info.date,
              time: info.time,
              timestamp: info.timestamp,
              english: null,
              hebrew: null,
              json: null,
              summary: r.summary
            };
          }
          if (info.isHebrew) {
            reportGroups[key].hebrew = r.name;
          } else {
            reportGroups[key].english = r.name;
            if (r.summary) reportGroups[key].summary = r.summary;
          }
        }
      } else if (r.type === 'json' && !r.name.includes('latest')) {
        const info = parseReportFilename(r.name.replace('.json', '.html'));
        if (info) {
          const key = `${info.date}_${info.time}`;
          if (!reportGroups[key]) {
            reportGroups[key] = { date: info.date, time: info.time, timestamp: info.timestamp };
          }
          reportGroups[key].json = r.name;
        }
      }
    });

    // Sort by date (newest first)
    const sortedGroups = Object.values(reportGroups)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (highlightNewestReportOnNextLoad && sortedGroups.length > 0) {
      const newestGroup = sortedGroups[0];
      newReportHighlightKey = `${newestGroup.date}_${newestGroup.time}`;
      highlightNewestReportOnNextLoad = false;
    }

    // Update stats
    const statsBar = document.getElementById('stats-bar');
    const latestSummary = sortedGroups[0]?.summary;
    statsBar.innerHTML = `
      <div class="stat-item">
        <span class="stat-value">${sortedGroups.length}</span>
        <span class="stat-label" data-i18n="totalReports">${i18n[currentLang].totalReports}</span>
      </div>
      ${latestSummary ? `
      <div class="stat-item">
        <span class="stat-value">${latestSummary.passRate}</span>
        <span class="stat-label" data-i18n="latestRate">${i18n[currentLang].latestRate}</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${latestSummary.total}</span>
        <span class="stat-label" data-i18n="totalTests">${i18n[currentLang].totalTests}</span>
      </div>
      ` : ''}
    `;

    // Render report cards
    container.innerHTML = sortedGroups.map(group => {
      const summary = group.summary || {};
      const passRate = parseFloat(summary.passRate) || 0;
      const badgeClass = passRate === 100 ? 'badge-success' : passRate >= 90 ? 'badge-warning' : 'badge-danger';
                const groupKey = `${group.date}_${group.time}`;
      const isNewReport = newReportHighlightKey === groupKey;

      return `
        <div class="report-card${isNewReport ? ' report-card-new' : ''}" data-report-key="${groupKey}">
          ${isNewReport ? `<div class="report-card-new-badge">${i18n[currentLang].newReport}</div>` : ''}
          <div class="report-header">
            <div>
              <div class="report-date">📅 ${formatDate(group.date)}</div>
              <div class="report-time">🕐 ${group.time} UTC</div>
            </div>
            ${summary.passRate ? `
            <span class="report-badge ${badgeClass}">${summary.passRate}</span>
            ` : ''}
          </div>

          ${summary.passed !== undefined ? `
          <div class="report-stats">
            <div class="report-stat passed">
              <span>✓</span>
              <span class="value">${summary.passed}</span>
              <span data-i18n="passed">${i18n[currentLang].passed}</span>
            </div>
            <div class="report-stat failed">
              <span>✗</span>
              <span class="value">${summary.failed}</span>
              <span data-i18n="failed">${i18n[currentLang].failed}</span>
            </div>
          </div>
          ` : ''}

          <div class="report-actions">
            ${group.english ? `
            <a href="${group.english}" target="_blank" class="action-btn action-btn-primary">
              🇬🇧 English
            </a>
            ` : ''}
            ${group.hebrew ? `
            <a href="${group.hebrew}" target="_blank" class="action-btn action-btn-hebrew">
              🇮🇱 עברית
            </a>
            ` : ''}
            ${group.json ? `
            <a href="${group.json}" download class="action-btn action-btn-secondary">
              📥 JSON
            </a>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

  } catch (error) {
    console.error('Error loading reports:', error);
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">⚠️</div>
        <p>Failed to load reports. Make sure the server is running.</p>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.5rem;">${error.message}</p>
      </div>
    `;
  }
}

// Check if tests can be run
async function checkCanRunTests() {
  try {
    const response = await fetch('/api/reports/can-run');
    const data = await response.json();

    const section = document.getElementById('run-tests-section');
    const btn = document.getElementById('run-tests-btn');
    const cooldownInfo = document.getElementById('cooldown-info');

    section.style.display = 'flex';

    if (data.canRun) {
      btn.disabled = false;
      btn.innerHTML = `<span>🚀</span><span data-i18n="runTests">${i18n[currentLang].runTests}</span>`;
      cooldownInfo.innerHTML = '';
    } else {
      btn.disabled = true;
      btn.innerHTML = `<span>⏳</span><span data-i18n="runTests">${i18n[currentLang].runTests}</span>`;
      cooldownInfo.innerHTML = `
        <span data-i18n="cooldownMsg">${i18n[currentLang].cooldownMsg}</span>
        <span class="time">${data.hoursRemaining} ${i18n[currentLang].hours}</span>
      `;
    }
  } catch (error) {
    console.error('Error checking test status:', error);
  }
}

// Run security tests
async function runTests() {
  const btn = document.getElementById('run-tests-btn');
  const banner = document.getElementById('test-status-banner');
  const statusText = document.getElementById('test-status-text');
  const terminalWindow = document.getElementById('terminal-window');
  const terminalOutput = document.getElementById('terminal-output');
  const terminalBody = document.getElementById('terminal-body');

  try {
    // Update UI to running state
    btn.disabled = true;
    btn.classList.add('running');
    btn.innerHTML = `<span>⏳</span><span data-i18n="runningTests">${i18n[currentLang].runningTests}</span>`;

    banner.className = 'test-status-banner visible';
    statusText.textContent = i18n[currentLang].runningTests;

    // Show terminal window
    terminalWindow.classList.add('visible');
    terminalOutput.textContent = '';

    // Start the tests
    const response = await fetch('/api/reports/run-tests', { method: 'POST' });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Failed to start tests');
    }

    // Poll for completion with output streaming
    pollTestStatus();

  } catch (error) {
    console.error('Error running tests:', error);
    btn.disabled = false;
    btn.classList.remove('running');
    banner.className = 'test-status-banner visible error';
    statusText.textContent = error.message;

    setTimeout(() => {
      banner.classList.remove('visible');
      checkCanRunTests();
    }, 5000);
  }
}

// Convert ANSI codes to HTML with proper span handling
function ansiToHtml(text) {
  // Map ANSI codes to CSS classes
  const ansiMap = {
    '1': 'ansi-bold',
    '2': 'ansi-dim',
    '31': 'ansi-red',
    '32': 'ansi-green',
    '33': 'ansi-yellow',
    '34': 'ansi-blue',
    '35': 'ansi-magenta',
    '36': 'ansi-cyan',
    '37': 'ansi-white',
    '90': 'ansi-dim',
  };

  let result = '';
  let openSpans = 0;
  let i = 0;

  while (i < text.length) {
    // Check for escape sequence
    if (text[i] === '\x1b' && text[i + 1] === '[') {
      // Find the end of the escape sequence
      let j = i + 2;
      while (j < text.length && text[j] !== 'm') j++;

      if (j < text.length) {
        const code = text.slice(i + 2, j);

        if (code === '0') {
          // Reset - close all open spans
          while (openSpans > 0) {
            result += '</span>';
            openSpans--;
          }
        } else {
          // Apply style
          const className = ansiMap[code];
          if (className) {
            result += `<span class="${className}">`;
            openSpans++;
          }
        }
        i = j + 1;
        continue;
      }
    }

    // Regular character - escape HTML
    const char = text[i];
    if (char === '<') result += '&lt;';
    else if (char === '>') result += '&gt;';
    else if (char === '&') result += '&amp;';
    else result += char;
    i++;
  }

  // Close any remaining open spans
  while (openSpans > 0) {
    result += '</span>';
    openSpans--;
  }

  return result;
}

// Poll for test completion with output streaming
let pollInterval = null;
let outputOffset = 0;

async function pollTestStatus() {
  const banner = document.getElementById('test-status-banner');
  const statusText = document.getElementById('test-status-text');
  const btn = document.getElementById('run-tests-btn');
  const terminalWindow = document.getElementById('terminal-window');
  const terminalOutput = document.getElementById('terminal-output');
  const terminalBody = document.getElementById('terminal-body');
  const terminalCursor = document.getElementById('terminal-cursor');

  if (pollInterval) clearInterval(pollInterval);
  outputOffset = 0;

  pollInterval = setInterval(async () => {
    try {
      // Fetch new output
      const outputResponse = await fetch(`/api/reports/output?offset=${outputOffset}`);
      const outputData = await outputResponse.json();

      if (outputData.output) {
        terminalOutput.innerHTML += ansiToHtml(outputData.output);
        outputOffset = outputData.totalLength;
        // Auto-scroll to bottom
        terminalBody.scrollTop = terminalBody.scrollHeight;
      }

      if (!outputData.running) {
        clearInterval(pollInterval);
        pollInterval = null;

        // Hide cursor when done
        terminalCursor.style.display = 'none';

        if (outputData.progress === 'completed') {
          banner.className = 'test-status-banner visible success';
          statusText.textContent = i18n[currentLang].testsComplete;

          // Reload reports after a short delay and highlight the newly-created report.
          // The highlight lives only in this JS runtime and disappears on page refresh.
          setTimeout(() => {
            highlightNewestReportOnNextLoad = true;
            loadReports();
            checkCanRunTests();
            banner.classList.remove('visible');
            btn.classList.remove('running');
          }, 2000);
        } else {
          banner.className = 'test-status-banner visible error';
          statusText.textContent = i18n[currentLang].testsFailed;

          setTimeout(() => {
            banner.classList.remove('visible');
            checkCanRunTests();
            btn.classList.remove('running');
          }, 5000);
        }
      }
    } catch (error) {
      console.error('Error polling status:', error);
    }
  }, 500); // Poll faster for smoother output
}

// Check for ongoing test on page load
async function checkOngoingTest() {
  try {
    const response = await fetch('/api/reports/status');
    const status = await response.json();

    if (status.running) {
      const btn = document.getElementById('run-tests-btn');
      const banner = document.getElementById('test-status-banner');
      const statusText = document.getElementById('test-status-text');
      const terminalWindow = document.getElementById('terminal-window');
      const terminalOutput = document.getElementById('terminal-output');
      const terminalCursor = document.getElementById('terminal-cursor');

      btn.disabled = true;
      btn.classList.add('running');
      btn.innerHTML = `<span>⏳</span><span>${i18n[currentLang].runningTests}</span>`;

      banner.className = 'test-status-banner visible';
      statusText.textContent = i18n[currentLang].runningTests;

      // Show terminal with existing output
      terminalWindow.classList.add('visible');
      if (status.output) {
        terminalOutput.innerHTML = ansiToHtml(status.output);
        outputOffset = status.output.length;
      }
      terminalCursor.style.display = 'inline-block';

      pollTestStatus();
    }
  } catch (error) {
    console.error('Error checking ongoing test:', error);
  }
}

document.querySelector('#run-tests-btn')?.addEventListener('click', runTests);

// Apply the saved language before loading translated dynamic content.
setLanguage(currentLang);
checkOngoingTest();
