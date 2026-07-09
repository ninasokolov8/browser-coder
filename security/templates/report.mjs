/**
 * HTML Report Generator
 * Generates localized HTML reports from test results
 */

import { getTranslation, formatCategory } from '../i18n/index.mjs';
import { getStyles } from './styles.mjs';
import { escapeHtml, formatExplanation, formatLocalizedInline, formatPlainInlineText, getLanguageIcon, getCategoryIcon, formatCategoryName } from './helpers.mjs';
import { getAllTests } from '../attacks/index.mjs';


function localizeAttackExplanations(data, lang = 'en') {
  const normalizedLang = String(lang || 'en').toLowerCase().startsWith('he') ? 'he' : 'en';

  if (normalizedLang === 'en' || !data?.tests?.length) {
    return data;
  }

  const translatedTests = getAllTests(normalizedLang);
  const explanationByKey = new Map(
    translatedTests.map(test => [`${test.language}::${test.name}`, test.explanation])
  );

  const localizeTest = (test) => {
    const translatedExplanation = explanationByKey.get(`${test.language}::${test.name}`);
    return translatedExplanation ? { ...test, explanation: translatedExplanation } : test;
  };

  return {
    ...data,
    tests: data.tests.map(localizeTest),
    vulnerabilities: Array.isArray(data.vulnerabilities)
      ? data.vulnerabilities.map(localizeTest)
      : data.vulnerabilities,
  };
}

/**
 * Generate an HTML report in the specified language
 */
export function generateReport(data, lang = 'en') {
  const t = getTranslation(lang);
  data = localizeAttackExplanations(data, lang);
  const passRate = parseFloat(data.summary.passRate);
  const statusColor = passRate === 100 ? '#22c55e' : passRate >= 90 ? '#eab308' : '#ef4444';
  const directionMark = t.dir === 'rtl' ? '\u200F' : '';
  const bidi = (value) => value == null ? '' : `${directionMark}${value}`;
  const inline = (value) => formatLocalizedInline(bidi(value), t.dir);
  const plainInline = (value) => formatPlainInlineText(value, t.dir);
  
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
      const explanation = test.explanation ? formatLocalizedInline(formatExplanation(test.explanation), t.dir) : '';
      
      return `
        <div class="test-card ${statusClass}">
          <div class="test-header">
            <span class="test-status">${statusIcon}</span>
            <span class="test-name">${plainInline(test.name)}</span>
            <span class="test-duration" dir="ltr">${test.duration}ms</span>
          </div>
          <div class="test-meta">
            <span class="test-badge lang-badge">${getLanguageIcon(test.language)} <span class="language-label" dir="ltr">${test.language}</span></span>
            <span class="test-badge cat-badge" dir="${t.dir}">${getCategoryIcon(test.category)} ${formatCategory(test.category, lang)}</span>
          </div>
          <div class="test-result">
            <span class="expected" dir="${t.dir}">${t.testExpected}: ${test.expectBlocked ? '🚫 ' + t.testBlocked : '✅ ' + t.testExecute}</span>
            <span class="actual" dir="${t.dir}">${test.passed ? '✓ ' + t.testCorrect : '✗ ' + t.testWrong}</span>
          </div>
          ${explanation ? `
          <details class="explanation">
            <summary dir="${t.dir}">📚 ${t.testLearnAttack}</summary>
            <div class="explanation-content" dir="${t.dir}">${explanation}</div>
          </details>
          ` : ''}
          <details class="code-details">
            <summary dir="${t.dir}">👁️ ${t.testViewCode}</summary>
            <pre dir="ltr"><code dir="ltr">${escapeHtml(test.code)}</code></pre>
          </details>
        </div>`;
    }).join('');
  }

  // Generate language tips
  function generateLanguageTips(language) {
    const langTips = t.languageTips[language];
    if (!langTips) return '';
    
    let html = `
      <div class="tips-box" dir="${t.dir}">
        <h3 dir="${t.dir}">💡 ${inline(langTips.title)}</h3>
        ${langTips.tips.map(tip => `
          <div class="tip" dir="${t.dir}">
            <div class="tip-title" dir="${t.dir}">${inline(tip.title)}</div>
            <div class="tip-content" dir="${t.dir}">${inline(tip.content)}</div>
          </div>
        `).join('')}
      </div>
    `;
    
    if (langTips.facts) {
      html += `
        <div class="mindblown-box" dir="${t.dir}">
          <h3 dir="${t.dir}">🤯 ${lang === 'he' ? 'עובדות מדהימות' : 'Mind-Blowing Facts'}</h3>
          ${langTips.facts.map(fact => `
            <div class="fact">
              <span class="fact-emoji">${fact.emoji}</span>
              <span class="fact-content" dir="${t.dir}"><strong>${inline(fact.title)}:</strong> ${inline(fact.content)}</span>
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
          <h2><span class="language-label" dir="ltr">${language.toUpperCase()}</span></h2>
          <span class="lang-stats" dir="auto">${langStats.passed}/${langStats.total} ${lang === 'he' ? 'בדיקות' : 'tests'} (${langPassRate}%)</span>
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
          <details class="category-section" dir="${t.dir}">
            <summary class="category-header">
              <span>${getCategoryIcon(category)} ${formatCategory(category, lang)}</span>
              <span class="category-stats" dir="ltr">${catPassed}/${tests.length}</span>
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
          <h2 dir="${t.dir}">${formatCategory(category, lang)}</h2>
          <span class="cat-stats-badge" dir="ltr">${catStats.passed}/${catStats.total} (${catPassRate}%)</span>
        </div>
      </div>
      
      <div class="lang-groups">
        ${Object.entries(langs).map(([lng, tests]) => `
          <details class="lang-group" dir="${t.dir}">
            <summary dir="${t.dir}">${getLanguageIcon(lng)} <span class="language-label" dir="ltr">${lng.toUpperCase()}</span> <span class="numeric-value" dir="ltr">(${tests.length})</span></summary>
            <div class="tests-grid">${generateTestCards(tests)}</div>
          </details>
        `).join('')}
      </div>
    </div>`;
  }

  // Generate "Use For Good" educational content
  const educationalTitle = lang === 'he' ? 'השתמש בכוחות לטובה' : 'Use These Powers For Good';
  const educationalIntro = lang === 'he' 
    ? 'למדת על טכניקות אבטחה מסוכנות - עכשיו הנה איך להשתמש באותו ידע לבניית דברים מדהימים!' 
    : 'You\'ve learned about dangerous security techniques - now here\'s how to use that same knowledge to build amazing things!';
  const factsTitle = lang === 'he' ? 'עובדות מדהימות' : 'Mind-Blowing Facts';
  const cheatSheetTitle = lang === 'he' ? 'גליון עזר אבטחה' : 'Security Cheat Sheet';
  const proTipsTitle = lang === 'he' ? 'טיפים מקצועיים' : 'Pro Security Tips';
  
  let useForGoodHTML = `
    <div class="educational-intro">
      <div class="educational-hero" dir="${t.dir}">
        <span class="edu-icon">🧠</span>
        <div class="edu-content" dir="${t.dir}">
          <h2>${inline(educationalTitle)}</h2>
          <p>${inline(educationalIntro)}</p>
        </div>
      </div>
    </div>
    
    <div class="edu-sections">
  `;
  
  // Add tips for each language with full cheat sheets
  for (const language of languages) {
    const langTips = t.languageTips[language];
    if (!langTips) continue;
    
    useForGoodHTML += `
      <div class="edu-lang-section">
        <h3 class="edu-lang-title" dir="${t.dir}">${getLanguageIcon(language)} <span class="language-label" dir="ltr">${language.toUpperCase()}</span><span class="title-separator"> - </span><span>${inline(langTips.title)}</span></h3>
        
        <div class="tips-box" dir="${t.dir}">
          <h4 dir="${t.dir}">💡 ${lang === 'he' ? 'השתמש בכוחות לטובה' : 'Use These Powers For Good'}</h4>
          ${langTips.tips.map(tip => `
            <div class="tip" dir="${t.dir}">
              <div class="tip-title" dir="${t.dir}">${inline(tip.title)}</div>
              <div class="tip-content" dir="${t.dir}">${inline(tip.content)}</div>
            </div>
          `).join('')}
        </div>
        
        ${langTips.facts && langTips.facts.length > 0 ? `
          <div class="mindblown-box" dir="${t.dir}">
            <h4 dir="${t.dir}">🤯 ${factsTitle}</h4>
            ${langTips.facts.map(fact => `
              <div class="fact">
                <span class="fact-emoji">${fact.emoji}</span>
                <span class="fact-content" dir="${t.dir}"><strong>${inline(fact.title)}:</strong> ${inline(fact.content)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}
        
        ${langTips.cheatSheet && langTips.cheatSheet.length > 0 ? `
          <div class="cheatsheet-box" dir="${t.dir}">
            <h4 dir="${t.dir}">🛡️ <span class="language-label" dir="ltr">${language.toUpperCase()}</span> ${cheatSheetTitle}</h4>
            <div class="cheat-grid" dir="${t.dir}">
              ${langTips.cheatSheet.map(item => `
                <div class="cheat-item" dir="${t.dir}">
                  <div class="cheat-bad" dir="auto">❌ ${item.bad}</div>
                  <div class="cheat-good" dir="auto">✅ ${item.good}</div>
                  <div class="cheat-why" dir="${t.dir}">${inline(item.why)}</div>
                </div>
              `).join('')}
            </div>
            ${langTips.proTips && langTips.proTips.length > 0 ? `
              <div class="cheat-pro-tips" dir="${t.dir}">
                <h5 dir="${t.dir}">🔥 ${proTipsTitle}</h5>
                <ul>
                  ${langTips.proTips.map(tip => `<li dir="${t.dir}">${inline(tip)}</li>`).join('')}
                </ul>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }
  
  // Add category tips section
  const categoryTipsTitle = lang === 'he' ? 'הבן את סוגי ההתקפות' : 'Understand Attack Types';
  if (t.categoryTips) {
    useForGoodHTML += `
      <div class="category-tips-section">
        <h3 dir="${t.dir}">📚 ${categoryTipsTitle}</h3>
    `;
    
    for (const category of categories) {
      const catTips = t.categoryTips[category];
      if (!catTips) continue;
      
      useForGoodHTML += `
        <div class="category-tip-card" dir="${t.dir}">
          <div class="explain-box" dir="${t.dir}">
            <h4 dir="${t.dir}">🎯 ${inline(catTips.title)}</h4>
            <div class="explain-simple" dir="${t.dir}">
              <p><strong>${lang === 'he' ? 'במילים פשוטות:' : 'In Simple Words:'}</strong> ${inline(catTips.simple)}</p>
              <div class="explain-example">
                <strong>${lang === 'he' ? 'דוגמה מהעולם האמיתי:' : 'Real-World Example:'}</strong> ${inline(catTips.example)}
              </div>
            </div>
          </div>
          
          ${catTips.tips && catTips.tips.length > 0 ? `
            <div class="tips-box" dir="${t.dir}">
              <h5 dir="${t.dir}">💡 ${getCategoryIcon(category)} ${formatCategory(category, lang)} - ${lang === 'he' ? 'שימושים לטובה' : 'Use For Good'}</h5>
              ${catTips.tips.map(tip => `
                <div class="tip" dir="${t.dir}">
                  <div class="tip-title" dir="${t.dir}">${inline(tip.title)}</div>
                  <div class="tip-content" dir="${t.dir}">${inline(tip.content)}</div>
                </div>
              `).join('')}
            </div>
          ` : ''}
          
          ${catTips.facts && catTips.facts.length > 0 ? `
            <div class="mindblown-box" dir="${t.dir}">
              <h5 dir="${t.dir}">🤯 ${factsTitle}</h5>
              ${catTips.facts.map(fact => `
                <div class="fact">
                  <span class="fact-emoji">${fact.emoji}</span>
                  <span class="fact-content" dir="${t.dir}"><strong>${inline(fact.title)}:</strong> ${inline(fact.content)}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }
    
    useForGoodHTML += `</div>`;
  }
  
  // Add general security cheat sheet
  useForGoodHTML += `
    <div class="cheatsheet-section" dir="${t.dir}">
      <h3 dir="${t.dir}">📋 ${lang === 'he' ? 'עקרונות אבטחה כלליים' : 'General Security Principles'}</h3>
      <div class="cheatsheet-grid" dir="${t.dir}">
        <div class="cheat-card" dir="${t.dir}">
          <h4 dir="${t.dir}">🚫 ${lang === 'he' ? 'לעולם אל' : 'Never'}</h4>
          <ul>
            <li dir="${t.dir}">${lang === 'he' ? 'אל תסמוך על קלט משתמש' : 'Trust user input blindly'}</li>
            <li dir="${t.dir}">${lang === 'he' ? 'אל תאחסן סיסמאות בטקסט גלוי' : 'Store passwords in plain text'}</li>
            <li dir="${t.dir}">${lang === 'he' ? 'אל תשתמש ב-eval() על קלט משתמש' : 'Use eval() on user input'}</li>
            <li dir="${t.dir}">${lang === 'he' ? 'אל תחשוף הודעות שגיאה מפורטות' : 'Expose detailed error messages'}</li>
            <li dir="${t.dir}">${lang === 'he' ? 'אל תשתמש במפתחות הארדקוד' : 'Hardcode API keys or secrets'}</li>
          </ul>
        </div>
        <div class="cheat-card" dir="${t.dir}">
          <h4 dir="${t.dir}">✅ ${lang === 'he' ? 'תמיד' : 'Always'}</h4>
          <ul>
            <li dir="${t.dir}">${lang === 'he' ? 'נקה וולידציה לכל קלט' : 'Sanitize and validate all input'}</li>
            <li dir="${t.dir}">${lang === 'he' ? 'השתמש בשאילתות פרמטריות' : 'Use parameterized queries'}</li>
            <li dir="${t.dir}">${lang === 'he' ? 'הפעל CSP (Content Security Policy)' : 'Implement Content Security Policy'}</li>
            <li dir="${t.dir}">${lang === 'he' ? 'הצפין נתונים רגישים' : 'Encrypt sensitive data'}</li>
            <li dir="${t.dir}">${lang === 'he' ? 'עדכן תלויות באופן קבוע' : 'Keep dependencies updated'}</li>
          </ul>
        </div>
        <div class="cheat-card" dir="${t.dir}">
          <h4 dir="${t.dir}">🛡️ ${lang === 'he' ? 'עקרונות הגנה' : 'Defense Principles'}</h4>
          <ul>
            <li dir="${t.dir}">${lang === 'he' ? 'הגנה בעומק - שכבות מרובות' : 'Defense in depth - multiple layers'}</li>
            <li dir="${t.dir}">${lang === 'he' ? 'עיקרון ההרשאה המינימלית' : 'Principle of least privilege'}</li>
            <li dir="${t.dir}">${lang === 'he' ? 'רישום ובקרה' : 'Logging and monitoring'}</li>
            <li dir="${t.dir}">${lang === 'he' ? 'בדיקות אבטחה אוטומטיות' : 'Automated security testing'}</li>
            <li dir="${t.dir}">${lang === 'he' ? 'סקירות קוד קבועות' : 'Regular code reviews'}</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
  `;

  return `<!DOCTYPE html>
<html lang="${t.lang}" dir="${t.dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.title}</title>
  <style>${getStyles(statusColor)}</style>
</head>
<body dir="${t.dir}" class="report report-${lang}">
  <div class="container">
    <!-- Hero -->
    <header class="hero">
      <h1>🔒 ${inline(t.heroTitle)}</h1>
      <p class="subtitle">${inline(t.heroSubtitle)}</p>
      <p class="tagline">${inline(t.heroTagline)}</p>
      <p class="timestamp">${t.timestamp}: ${data.timestamp}</p>
    </header>
    
    <!-- Intro -->
    <section class="intro-section">
      <div class="intro-card">
        <span class="intro-icon">🎓</span>
        <div class="intro-content" dir="${t.dir}">
          <h2>${inline(t.introTitle)}</h2>
          <p>${inline(t.introP1)}</p>
          <p>${inline(t.introP2)}</p>
          <p class="intro-highlight">${inline(t.introHighlight)}</p>
        </div>
      </div>
      
      <div class="intro-grid">
        <div class="intro-mini-card">
          <span class="intro-mini-icon">🎯</span>
          <div class="intro-mini-text" dir="${t.dir}">
            <strong>${inline(t.miniCard1Title)}</strong>
            ${inline(t.miniCard1Text)}
          </div>
        </div>
        <div class="intro-mini-card">
          <span class="intro-mini-icon">🛡️</span>
          <div class="intro-mini-text" dir="${t.dir}">
            <strong>${inline(t.miniCard2Title)}</strong>
            ${inline(t.miniCard2Text)}
          </div>
        </div>
        <div class="intro-mini-card">
          <span class="intro-mini-icon">💡</span>
          <div class="intro-mini-text" dir="${t.dir}">
            <strong>${inline(t.miniCard3Title)}</strong>
            ${inline(t.miniCard3Text)}
          </div>
        </div>
      </div>
      
      <div class="intro-cta">
        <p>${inline(t.ctaText)}</p>
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
        <button class="main-tab active" onclick="showMainTab(event, 'byLanguage')">📚 ${t.tabByLanguage}</button>
        <button class="main-tab" onclick="showMainTab(event, 'byCategory')">🏷️ ${t.tabByCategory}</button>
        <button class="main-tab" onclick="showMainTab(event, 'useForGood')">🧠 ${lang === 'he' ? 'השתמש לטובה' : 'Use For Good'}</button>
      </div>
      
      <!-- By Language View -->
      <div id="byLanguage-view" class="tab-content">
        <div class="lang-tabs">
          ${languages.map((lang, i) => `
            <button class="lang-tab${i === 0 ? ' active' : ''}" onclick="showLangSection(event, '${lang}')">
              ${getLanguageIcon(lang)} <span class="language-label" dir="ltr">${lang.toUpperCase()}</span>
            </button>
          `).join('')}
        </div>
        ${byLanguageHTML}
      </div>
      
      <!-- By Category View -->
      <div id="byCategory-view" class="tab-content" style="display: none;">
        <div class="cat-tabs">
          ${categories.map((cat, i) => `
            <button class="cat-tab${i === 0 ? ' active' : ''}" onclick="showCatSection(event, '${cat}')">
              ${getCategoryIcon(cat)} ${formatCategory(cat, lang)}
            </button>
          `).join('')}
        </div>
        ${byCategoryHTML}
      </div>
      
      <!-- Use For Good View -->
      <div id="useForGood-view" class="tab-content" style="display: none;">
        ${useForGoodHTML}
      </div>
    </div>
    
    <!-- Footer -->
    <footer class="footer">
      <p>${t.footerText}</p>
      <p><a href="/reports/">${t.footerBack}</a></p>
    </footer>
  </div>
  
  <script>
    function showMainTab(event, tab) {
      document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      event.currentTarget.classList.add('active');
      document.getElementById(tab + '-view').style.display = 'block';
    }
    
    function showLangSection(event, lang) {
      document.querySelectorAll('.lang-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.lang-section').forEach(s => s.classList.remove('active'));
      event.currentTarget.classList.add('active');
      document.querySelector('.lang-section[data-language="' + lang + '"]').classList.add('active');
    }
    
    function showCatSection(event, cat) {
      document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.cat-section').forEach(s => s.classList.remove('active'));
      event.currentTarget.classList.add('active');
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
