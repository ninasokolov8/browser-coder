/**
 * HTML Report Generator
 * Generates localized HTML reports from test results
 */

import { getTranslation, formatCategory } from '../i18n/index.mjs';
import { getStyles } from './styles.mjs';
import { escapeHtml, formatExplanation, getLanguageIcon, getCategoryIcon, formatCategoryName } from './helpers.mjs';

/**
 * Generate an HTML report in the specified language
 */
export function generateReport(data, lang = 'en') {
  const t = getTranslation(lang);
  const passRate = parseFloat(data.summary.passRate);
  const statusColor = passRate === 100 ? '#22c55e' : passRate >= 90 ? '#eab308' : '#ef4444';
  
  // Group tests by language and category
  const byLanguage = {};
  const byCategory = {};
  for (const test of data.tests) {
    if (!byLanguage[test.language]) byLanguage[test.language] = {};
    if (!byLanguage[test.language][test.category]) byLanguage[test.language][test.category] = [];
    byLanguage[test.language][test.category].push(test);
    
    if (!byCategory[test.category]) byCategory[test.category] = {};
    if (!byCategory[test.category][test.language]) byCategory[test.category][test.language] = [];
    byCategory[test.category][test.language].push(test);
  }
  
  const languages = Object.keys(byLanguage);
  const categories = Object.keys(byCategory);

  // Generate test cards
  function generateTestCards(tests) {
    return tests.map(test => {
      const statusClass = test.passed ? 'pass' : 'fail';
      const statusIcon = test.passed ? '✓' : '✗';
      const explanation = test.explanation ? formatExplanation(test.explanation) : '';
      
      return `
        <div class="test-card ${statusClass}">
          <div class="test-header">
            <span class="test-status">${statusIcon}</span>
            <span class="test-name">${escapeHtml(test.name)}</span>
            <span class="test-duration">${test.duration}ms</span>
          </div>
          <div class="test-meta">
            <span class="test-badge lang-badge">${getLanguageIcon(test.language)} ${test.language}</span>
            <span class="test-badge cat-badge">${getCategoryIcon(test.category)} ${formatCategory(test.category, lang)}</span>
          </div>
          <div class="test-result">
            <span class="expected">${t.testExpected}: ${test.expectBlocked ? '🚫 ' + t.testBlocked : '✅ ' + t.testExecute}</span>
            <span class="actual">${test.passed ? '✓ ' + t.testCorrect : '✗ ' + t.testWrong}</span>
          </div>
          ${explanation ? `
          <details class="explanation">
            <summary>📚 ${t.testLearnAttack}</summary>
            <div class="explanation-content">${explanation}</div>
          </details>
          ` : ''}
          <details class="code-details">
            <summary>👁️ ${t.testViewCode}</summary>
            <pre><code>${escapeHtml(test.code)}</code></pre>
          </details>
        </div>`;
    }).join('');
  }

  // Generate language tips
  function generateLanguageTips(language) {
    const langTips = t.languageTips[language];
    if (!langTips) return '';
    
    let html = `
      <div class="tips-box">
        <h3>💡 ${langTips.title}</h3>
        ${langTips.tips.map(tip => `
          <div class="tip">
            <div class="tip-title">${tip.title}</div>
            <div class="tip-content">${tip.content}</div>
          </div>
        `).join('')}
      </div>
    `;
    
    if (langTips.facts) {
      html += `
        <div class="mindblown-box">
          <h3>🤯 ${lang === 'he' ? 'עובדות מדהימות' : 'Mind-Blowing Facts'}</h3>
          ${langTips.facts.map(fact => `
            <div class="fact">
              <span class="fact-emoji">${fact.emoji}</span>
              <span class="fact-content"><strong>${fact.title}:</strong> ${fact.content}</span>
            </div>
          `).join('')}
        </div>
      `;
    }
    
    return html;
  }

  // Generate By Language content
  let byLanguageHTML = '';
  let isFirstLang = true;
  for (const [language, cats] of Object.entries(byLanguage)) {
    const langStats = data.statistics.byLanguage[language];
    const langPassRate = ((langStats.passed / langStats.total) * 100).toFixed(0);
    const langActiveClass = isFirstLang ? ' active' : '';
    isFirstLang = false;
    
    byLanguageHTML += `
    <div class="lang-section${langActiveClass}" data-language="${language}">
      <div class="lang-header">
        <div class="lang-title">
          <span class="lang-icon">${getLanguageIcon(language)}</span>
          <h2>${language.toUpperCase()}</h2>
          <span class="lang-stats">${langStats.passed}/${langStats.total} ${lang === 'he' ? 'בדיקות' : 'tests'} (${langPassRate}%)</span>
        </div>
        <div class="lang-bar">
          <div class="lang-bar-fill" style="width: ${langPassRate}%; background: ${langPassRate == 100 ? '#22c55e' : '#ef4444'}"></div>
        </div>
      </div>
      
      ${generateLanguageTips(language)}
      
      <div class="categories-accordion">
        ${Object.entries(cats).map(([category, tests]) => {
          const catPassed = tests.filter(t => t.passed).length;
          return `
          <details class="category-section">
            <summary class="category-header">
              <span>${getCategoryIcon(category)} ${formatCategory(category, lang)}</span>
              <span class="category-stats">${catPassed}/${tests.length}</span>
            </summary>
            <div class="tests-grid">${generateTestCards(tests)}</div>
          </details>`;
        }).join('')}
      </div>
    </div>`;
  }
  
  // Generate By Category content
  let byCategoryHTML = '';
  let isFirstCategory = true;
  for (const [category, langs] of Object.entries(byCategory)) {
    const catStats = data.statistics.byCategory[category];
    const catPassRate = ((catStats.passed / catStats.total) * 100).toFixed(0);
    const catActiveClass = isFirstCategory ? ' active' : '';
    isFirstCategory = false;
    
    byCategoryHTML += `
    <div class="cat-section${catActiveClass}" data-category="${category}">
      <div class="cat-header">
        <div class="cat-title">
          <span class="cat-icon">${getCategoryIcon(category)}</span>
          <h2>${formatCategory(category, lang)}</h2>
          <span class="cat-stats-badge">${catStats.passed}/${catStats.total} (${catPassRate}%)</span>
        </div>
      </div>
      
      <div class="lang-groups">
        ${Object.entries(langs).map(([lng, tests]) => `
          <details class="lang-group">
            <summary>${getLanguageIcon(lng)} ${lng.toUpperCase()} (${tests.length})</summary>
            <div class="tests-grid">${generateTestCards(tests)}</div>
          </details>
        `).join('')}
      </div>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="${t.lang}" dir="${t.dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.title}</title>
  <style>${getStyles(statusColor)}</style>
</head>
<body>
  <div class="container">
    <!-- Hero -->
    <header class="hero">
      <h1>🔒 ${t.heroTitle}</h1>
      <p class="subtitle">${t.heroSubtitle}</p>
      <p class="tagline">${t.heroTagline}</p>
      <p class="timestamp">${t.timestamp}: ${data.timestamp}</p>
    </header>
    
    <!-- Intro -->
    <section class="intro-section">
      <div class="intro-card">
        <span class="intro-icon">🎓</span>
        <div class="intro-content">
          <h2>${t.introTitle}</h2>
          <p>${t.introP1}</p>
          <p>${t.introP2}</p>
          <p class="intro-highlight">${t.introHighlight}</p>
        </div>
      </div>
      
      <div class="intro-grid">
        <div class="intro-mini-card">
          <span class="intro-mini-icon">🎯</span>
          <div class="intro-mini-text">
            <strong>${t.miniCard1Title}</strong>
            ${t.miniCard1Text}
          </div>
        </div>
        <div class="intro-mini-card">
          <span class="intro-mini-icon">🛡️</span>
          <div class="intro-mini-text">
            <strong>${t.miniCard2Title}</strong>
            ${t.miniCard2Text}
          </div>
        </div>
        <div class="intro-mini-card">
          <span class="intro-mini-icon">💡</span>
          <div class="intro-mini-text">
            <strong>${t.miniCard3Title}</strong>
            ${t.miniCard3Text}
          </div>
        </div>
      </div>
      
      <div class="intro-cta">
        <p>${t.ctaText}</p>
      </div>
    </section>
    
    <!-- Stats Dashboard -->
    <div class="dashboard">
      <div class="stat-card pass">
        <div class="stat-value">${data.summary.passed}</div>
        <div class="stat-label">${t.statPassed}</div>
      </div>
      <div class="stat-card fail">
        <div class="stat-value">${data.summary.failed}</div>
        <div class="stat-label">${t.statFailed}</div>
      </div>
      <div class="stat-card total">
        <div class="stat-value">${data.summary.total}</div>
        <div class="stat-label">${t.statTotal}</div>
      </div>
      <div class="stat-card rate">
        <div class="stat-value">${data.summary.passRate}</div>
        <div class="stat-label">${t.statRate}</div>
      </div>
      <div class="stat-card time">
        <div class="stat-value">${data.summary.duration}</div>
        <div class="stat-label">${t.statDuration}</div>
      </div>
    </div>
    
    <!-- Main Tabs Container -->
    <div class="tabs-container">
      <div class="main-tabs">
        <button class="main-tab active" onclick="showMainTab('byLanguage')">📚 ${t.tabByLanguage}</button>
        <button class="main-tab" onclick="showMainTab('byCategory')">🏷️ ${t.tabByCategory}</button>
      </div>
      
      <!-- By Language View -->
      <div id="byLanguage-view" class="tab-content">
        <div class="lang-tabs">
          ${languages.map((lang, i) => `
            <button class="lang-tab${i === 0 ? ' active' : ''}" onclick="showLangSection('${lang}')">
              ${getLanguageIcon(lang)} ${lang.toUpperCase()}
            </button>
          `).join('')}
        </div>
        ${byLanguageHTML}
      </div>
      
      <!-- By Category View -->
      <div id="byCategory-view" class="tab-content" style="display: none;">
        <div class="cat-tabs">
          ${categories.map((cat, i) => `
            <button class="cat-tab${i === 0 ? ' active' : ''}" onclick="showCatSection('${cat}')">
              ${getCategoryIcon(cat)} ${formatCategory(cat, lang)}
            </button>
          `).join('')}
        </div>
        ${byCategoryHTML}
      </div>
    </div>
    
    <!-- Footer -->
    <footer class="footer">
      <p>${t.footerText}</p>
      <p><a href="/reports/">${t.footerBack}</a></p>
    </footer>
  </div>
  
  <script>
    function showMainTab(tab) {
      document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      event.target.classList.add('active');
      document.getElementById(tab + '-view').style.display = 'block';
    }
    
    function showLangSection(lang) {
      document.querySelectorAll('.lang-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.lang-section').forEach(s => s.classList.remove('active'));
      event.target.classList.add('active');
      document.querySelector('.lang-section[data-language="' + lang + '"]').classList.add('active');
    }
    
    function showCatSection(cat) {
      document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.cat-section').forEach(s => s.classList.remove('active'));
      event.target.classList.add('active');
      document.querySelector('.cat-section[data-category="' + cat + '"]').classList.add('active');
    }
  </script>
</body>
</html>`;
}

/**
 * Generate English report
 */
export function generateEnglishReport(data) {
  return generateReport(data, 'en');
}

/**
 * Generate Hebrew report
 */
export function generateHebrewReport(data) {
  return generateReport(data, 'he');
}
