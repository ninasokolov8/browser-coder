/**
 * Security Test Suite for Browser Coder
 * 
 * This is an educational security testing framework that demonstrates
 * common attack vectors and verifies they are properly blocked.
 * 
 * Structure:
 * - attacks/javascript.mjs - JavaScript attack vectors with explanations
 * - attacks/typescript.mjs - TypeScript attack vectors with explanations
 * - attacks/python.mjs - Python attack vectors with explanations
 * - attacks/php.mjs - PHP attack vectors with explanations
 * - attacks/java.mjs - Java attack vectors with explanations
 * 
 * Each test includes a human-readable explanation of how hackers use
 * that particular attack vector in real-world scenarios.
 * 
 * Run in Docker: docker compose -f docker-compose.test.yml up test-security --build
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Import attack vectors from modular files
import { javascriptTests } from './attacks/javascript.mjs';
import { typescriptTests } from './attacks/typescript.mjs';
import { pythonTests } from './attacks/python.mjs';
import { phpTests } from './attacks/php.mjs';
import { javaTests } from './attacks/java.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
  serverUrl: process.env.API_URL || process.argv.find(a => a.startsWith('--server='))?.split('=')[1] || 'http://api:3001',
  timeout: 15000,
  reportDir: path.join(__dirname, '..', 'reports'),
};

// Test result tracking
const results = {
  passed: 0,
  failed: 0,
  errors: 0,
  tests: [],
  startTime: Date.now(),
  suite: 'security',
};

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function log(color, ...args) {
  console.log(color, ...args, colors.reset);
}

// ============================================
// COMBINE ALL TESTS FROM MODULAR FILES
// ============================================

const SECURITY_TESTS = {
  javascript: javascriptTests,
  typescript: typescriptTests,
  python: pythonTests,
  php: phpTests,
  java: javaTests,
};

// ============================================
// TEST EXECUTION
// ============================================

async function executeCode(language, code) {
  try {
    const response = await fetch(`${CONFIG.serverUrl}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language, code }),
    });
    
    if (!response.ok) {
      const text = await response.text();
      return { blocked: true, reason: `HTTP ${response.status}`, httpError: true, errorBody: text };
    }
    
    const data = await response.json();
    
    // Check if blocked by security filter (case-insensitive)
    const errorLower = (data.error || '').toLowerCase();
    const stderrLower = (data.stderr || '').toLowerCase();
    
    const isSecurityBlocked = 
      errorLower.includes('blocked') || 
      errorLower.includes('security') || 
      errorLower.includes('not allowed') ||
      errorLower.includes('security violation') ||
      stderrLower.includes('blocked') || 
      stderrLower.includes('not allowed') ||
      stderrLower.includes('security violation');
    
    return {
      blocked: isSecurityBlocked,
      stdout: data.stdout,
      stderr: data.stderr,
      error: data.error,
    };
  } catch (err) {
    return { blocked: false, error: err.message };
  }
}

async function runTest(language, test) {
  const startTime = Date.now();
  
  try {
    const result = await executeCode(language, test.code);
    const duration = Date.now() - startTime;
    
    let passed;
    let reason;
    
    if (test.expectBlocked) {
      // Test expects the code to be blocked by security filter
      passed = result.blocked;
      reason = passed 
        ? `✓ Correctly blocked: ${result.error || result.stderr || 'Security filter triggered'}`
        : `✗ VULNERABILITY: Code executed when it should be blocked!`;
    } else {
      // Test expects the code to execute successfully (not blocked by security)
      // Note: Runtime errors are OK - we just care that security didn't block it
      passed = !result.blocked;
      if (passed && test.expectedOutput) {
        passed = result.stdout?.includes(test.expectedOutput);
        reason = passed 
          ? `✓ Executed correctly with expected output`
          : `✗ Output mismatch: expected "${test.expectedOutput}"`;
      } else {
        reason = passed 
          ? `✓ Executed successfully (not blocked by security)`
          : `✗ Unexpectedly blocked by security: ${result.error || result.stderr}`;
      }
    }
    
    return {
      name: test.name,
      language,
      category: test.category,
      expectBlocked: test.expectBlocked,
      passed,
      reason,
      duration,
      result,
      code: test.code,
      explanation: test.explanation,
    };
  } catch (err) {
    return {
      name: test.name,
      language,
      category: test.category,
      expectBlocked: test.expectBlocked,
      passed: false,
      reason: `Error: ${err.message}`,
      duration: Date.now() - startTime,
      code: test.code,
      explanation: test.explanation,
    };
  }
}

async function runSecurityTests() {
  log(colors.bold + colors.cyan, '\n════════════════════════════════════════════════════════════════');
  log(colors.bold + colors.cyan, '           🔒 BROWSER CODER SECURITY TEST SUITE');
  log(colors.bold + colors.cyan, '                    Educational Edition');
  log(colors.bold + colors.cyan, '════════════════════════════════════════════════════════════════\n');
  
  log(colors.blue, `  Server: ${CONFIG.serverUrl}`);
  log(colors.blue, `  Test Files: attacks/*.mjs (modular structure)`);
  
  // Wait for server
  log(colors.yellow, '\n  Waiting for server...');
  let serverReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch(`${CONFIG.serverUrl}/health`);
      if (response.ok) {
        serverReady = true;
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  
  if (!serverReady) {
    log(colors.red, '\n  ✗ Server not available. Exiting.\n');
    process.exit(1);
  }
  log(colors.green, '  ✓ Server is ready!\n');
  
  // Print test summary
  const testCounts = Object.entries(SECURITY_TESTS).map(([lang, tests]) => `${lang}: ${tests.length}`);
  log(colors.blue, `  Tests loaded: ${testCounts.join(', ')}`);
  log(colors.blue, `  Total: ${Object.values(SECURITY_TESTS).flat().length} test cases\n`);
  
  // Run tests by language
  for (const [language, tests] of Object.entries(SECURITY_TESTS)) {
    log(colors.bold + colors.magenta, `\n  ┌──────────────────────────────────────────────────────────────`);
    log(colors.bold + colors.magenta, `  │ ${language.toUpperCase()} SECURITY TESTS (${tests.length} tests)`);
    log(colors.bold + colors.magenta, `  └──────────────────────────────────────────────────────────────`);
    
    // Group by category
    const categories = {};
    for (const test of tests) {
      if (!categories[test.category]) categories[test.category] = [];
      categories[test.category].push(test);
    }
    
    for (const [category, categoryTests] of Object.entries(categories)) {
      log(colors.cyan, `\n    📁 ${category.replace(/_/g, ' ').toUpperCase()}`);
      
      for (const test of categoryTests) {
        const result = await runTest(language, test);
        results.tests.push(result);
        
        if (result.passed) {
          results.passed++;
          log(colors.green, `      ✓ ${result.name}`);
          log(colors.dim + colors.green, `        └─ ${result.reason} (${result.duration}ms)`);
        } else {
          results.failed++;
          log(colors.red, `      ✗ ${result.name}`);
          log(colors.red, `        └─ ${result.reason}`);
          if (result.result?.stdout) {
            log(colors.yellow, `        └─ stdout: ${result.result.stdout.substring(0, 100)}`);
          }
        }
      }
    }
  }
  
  // Generate summary
  results.endTime = Date.now();
  results.totalDuration = results.endTime - results.startTime;
  
  await generateReport();
  printSummary();
  
  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

function printSummary() {
  const total = results.passed + results.failed + results.errors;
  const passRate = ((results.passed / total) * 100).toFixed(1);
  
  log(colors.bold + colors.cyan, '\n════════════════════════════════════════════════════════════════');
  log(colors.bold + colors.cyan, '                       TEST SUMMARY');
  log(colors.bold + colors.cyan, '════════════════════════════════════════════════════════════════\n');
  
  log(colors.green, `  ✓ Passed:  ${results.passed}`);
  log(colors.red, `  ✗ Failed:  ${results.failed}`);
  log(colors.yellow, `  ⚠ Errors:  ${results.errors}`);
  log(colors.blue, `  ━━━━━━━━━━━━━━━━━━`);
  log(colors.bold, `  Total:     ${total}`);
  log(colors.bold, `  Pass Rate: ${passRate}%`);
  log(colors.blue, `  Duration:  ${(results.totalDuration / 1000).toFixed(2)}s`);
  
  if (results.failed > 0) {
    log(colors.red, '\n  ⚠️  SECURITY VULNERABILITIES DETECTED!\n');
    
    const failures = results.tests.filter(t => !t.passed);
    for (const f of failures) {
      log(colors.red, `    • ${f.name}`);
      log(colors.yellow, `      ${f.reason}`);
    }
  } else {
    log(colors.green, '\n  ✅ ALL SECURITY TESTS PASSED!\n');
  }
  
  const reportFiles = results.reportFiles || { json: 'security-report-latest.json', html: 'security-report-latest.html' };
  log(colors.blue, `\n  📄 Report saved: ${CONFIG.reportDir}/${reportFiles.json}`);
  log(colors.blue, `  🌐 HTML Report:  ${CONFIG.reportDir}/${reportFiles.html}\n`);
}

async function generateReport() {
  // Create reports directory
  try {
    await fs.mkdir(CONFIG.reportDir, { recursive: true });
  } catch {}
  
  // Generate date prefix: yyyy-mm-dd
  const now = new Date();
  const datePrefix = now.toISOString().split('T')[0]; // yyyy-mm-dd
  const timeStamp = now.toISOString().replace(/[:.]/g, '-').split('T')[1]; // HH-MM-SS-mmmZ
  
  // JSON Report with explanations
  const jsonReport = {
    suite: 'security',
    version: '2.0',
    description: 'Educational Security Test Report - Learn how hackers exploit code execution vulnerabilities',
    timestamp: now.toISOString(),
    server: CONFIG.serverUrl,
    summary: {
      total: results.passed + results.failed + results.errors,
      passed: results.passed,
      failed: results.failed,
      errors: results.errors,
      passRate: ((results.passed / (results.passed + results.failed + results.errors)) * 100).toFixed(2) + '%',
      duration: results.totalDuration,
    },
    statistics: generateStatistics(),
    tests: results.tests,
    vulnerabilities: results.tests.filter(t => !t.passed && t.expectBlocked),
  };
  
  // Save versioned reports with date prefix
  const jsonFileName = `${datePrefix}_security-report_${timeStamp}.json`;
  const htmlFileName = `${datePrefix}_security-report_${timeStamp}.html`;
  
  await fs.writeFile(
    path.join(CONFIG.reportDir, jsonFileName),
    JSON.stringify(jsonReport, null, 2)
  );
  
  // HTML Report with educational content
  const htmlReport = generateHTMLReport(jsonReport);
  await fs.writeFile(
    path.join(CONFIG.reportDir, htmlFileName),
    htmlReport
  );
  
  // Also save as 'latest' for easy access
  await fs.writeFile(
    path.join(CONFIG.reportDir, 'security-report-latest.json'),
    JSON.stringify(jsonReport, null, 2)
  );
  await fs.writeFile(
    path.join(CONFIG.reportDir, 'security-report-latest.html'),
    htmlReport
  );
  
  // Update the log messages
  results.reportFiles = {
    json: jsonFileName,
    html: htmlFileName,
  };
}

function generateStatistics() {
  const stats = {
    byLanguage: {},
    byCategory: {},
  };
  
  for (const test of results.tests) {
    // By language
    if (!stats.byLanguage[test.language]) {
      stats.byLanguage[test.language] = { total: 0, passed: 0, failed: 0 };
    }
    stats.byLanguage[test.language].total++;
    if (test.passed) stats.byLanguage[test.language].passed++;
    else stats.byLanguage[test.language].failed++;
    
    // By category
    if (!stats.byCategory[test.category]) {
      stats.byCategory[test.category] = { total: 0, passed: 0, failed: 0 };
    }
    stats.byCategory[test.category].total++;
    if (test.passed) stats.byCategory[test.category].passed++;
    else stats.byCategory[test.category].failed++;
  }
  
  return stats;
}

function generateHTMLReport(data) {
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
  
  // Generate language tabs content
  const languages = Object.keys(byLanguage);
  const categories = Object.keys(byCategory);
  
  // Generate test cards for a list of tests
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
            <span class="test-badge cat-badge">${getCategoryIcon(test.category)} ${formatCategoryName(test.category)}</span>
          </div>
          <div class="test-result">
            <span class="expected">Expected: ${test.expectBlocked ? '🚫 Blocked' : '✅ Execute'}</span>
            <span class="actual">${test.passed ? '✓ Correct' : '✗ Wrong'}</span>
          </div>
          ${explanation ? `
          <details class="explanation">
            <summary>📚 Learn about this attack</summary>
            <div class="explanation-content">${explanation}</div>
          </details>
          ` : ''}
          <details class="code-details">
            <summary>👁️ View Code</summary>
            <pre><code>${escapeHtml(test.code)}</code></pre>
          </details>
        </div>`;
    }).join('');
  }
  
  // Generate By Language content
  let byLanguageHTML = '';
  let isFirstLang = true;
  for (const [language, categories] of Object.entries(byLanguage)) {
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
          <span class="lang-stats">${langStats.passed}/${langStats.total} tests (${langPassRate}%)</span>
        </div>
        <div class="lang-bar">
          <div class="lang-bar-fill" style="width: ${langPassRate}%; background: ${langPassRate == 100 ? '#22c55e' : '#ef4444'}"></div>
        </div>
      </div>
      
      ${getLanguageTips(language)}
      
      <div class="categories-accordion">
        ${Object.entries(categories).map(([category, tests]) => {
          const catPassed = tests.filter(t => t.passed).length;
          return `
          <details class="category-section">
            <summary class="category-header">
              <span>${getCategoryIcon(category)} ${formatCategoryName(category)}</span>
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
          <h2>${formatCategoryName(category)}</h2>
          <span class="cat-stats-badge">${catStats.passed}/${catStats.total} (${catPassRate}%)</span>
        </div>
      </div>
      
      ${getCategoryTips(category)}
      
      <div class="lang-groups">
        ${Object.entries(langs).map(([lang, tests]) => `
          <details class="lang-group">
            <summary>${getLanguageIcon(lang)} ${lang.toUpperCase()} (${tests.length})</summary>
            <div class="tests-grid">${generateTestCards(tests)}</div>
          </details>
        `).join('')}
      </div>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🔒 Security Educational Report - Browser Coder</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
      min-height: 100vh;
      color: #e2e8f0; 
      line-height: 1.6; 
    }
    .container { max-width: 1600px; margin: 0 auto; padding: 2rem; }
    
    /* Hero Header */
    .hero { 
      text-align: center; 
      padding: 3rem 2rem; 
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(139, 92, 246, 0.1) 100%);
      border-radius: 1.5rem; 
      border: 1px solid rgba(99, 102, 241, 0.3);
      margin-bottom: 2rem;
      position: relative;
      overflow: hidden;
    }
    .hero::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
    }
    .hero h1 { 
      font-size: 3rem; 
      margin-bottom: 0.75rem; 
      background: linear-gradient(135deg, #f8fafc 0%, #a5b4fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      position: relative;
    }
    .hero .subtitle { 
      color: #a5b4fc; 
      font-size: 1.25rem; 
      margin-bottom: 0.5rem;
      position: relative;
    }
    .hero .tagline {
      color: #94a3b8;
      font-size: 1rem;
      font-style: italic;
      position: relative;
    }
    .timestamp { color: #64748b; font-size: 0.875rem; margin-top: 1rem; position: relative; }
    
    /* Intro Section */
    .intro-section {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.95));
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 1rem;
      padding: 2rem;
      margin-bottom: 2rem;
      position: relative;
      overflow: hidden;
    }
    .intro-section::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #6366f1, #8b5cf6, #a855f7, #6366f1);
      background-size: 300% 100%;
      animation: shimmer 3s ease-in-out infinite;
    }
    @keyframes shimmer {
      0%, 100% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
    }
    .intro-card {
      display: flex;
      gap: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .intro-icon {
      font-size: 3rem;
      flex-shrink: 0;
    }
    .intro-content h2 {
      color: #e2e8f0;
      font-size: 1.5rem;
      margin: 0 0 1rem 0;
    }
    .intro-content p {
      color: #94a3b8;
      font-size: 1rem;
      line-height: 1.8;
      margin: 0 0 0.75rem 0;
    }
    .intro-content p:last-child { margin-bottom: 0; }
    .intro-content strong { color: #e2e8f0; }
    .intro-content em { color: #f87171; font-style: normal; }
    .intro-highlight {
      background: rgba(99, 102, 241, 0.15);
      border-left: 3px solid #6366f1;
      padding: 0.75rem 1rem;
      border-radius: 0.25rem;
      margin-top: 1rem !important;
    }
    .intro-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    @media (max-width: 768px) { .intro-grid { grid-template-columns: 1fr; } }
    .intro-mini-card {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 0.75rem;
      padding: 1rem;
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
    }
    .intro-mini-icon { font-size: 1.5rem; }
    .intro-mini-text {
      color: #94a3b8;
      font-size: 0.9rem;
      line-height: 1.6;
    }
    .intro-mini-text strong { color: #a5b4fc; display: block; margin-bottom: 0.25rem; }
    .intro-cta {
      background: linear-gradient(135deg, rgba(74, 222, 128, 0.1), rgba(52, 211, 153, 0.05));
      border: 1px solid rgba(74, 222, 128, 0.3);
      border-radius: 0.75rem;
      padding: 1rem 1.25rem;
      text-align: center;
    }
    .intro-cta p {
      color: #6ee7b7;
      font-size: 1rem;
      margin: 0;
    }
    .intro-cta strong { color: #4ade80; }
    
    /* Stats Dashboard */
    .dashboard { 
      display: grid; 
      grid-template-columns: repeat(5, 1fr);
      gap: 1rem; 
      margin-bottom: 2rem;
    }
    @media (max-width: 900px) { .dashboard { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 600px) { .dashboard { grid-template-columns: repeat(2, 1fr); } }
    
    .stat-card { 
      background: rgba(30, 41, 59, 0.8);
      backdrop-filter: blur(10px);
      padding: 1.5rem; 
      border-radius: 1rem; 
      text-align: center; 
      border: 1px solid rgba(99, 102, 241, 0.2);
      transition: all 0.3s ease;
    }
    .stat-card:hover { 
      transform: translateY(-4px); 
      box-shadow: 0 12px 40px rgba(99, 102, 241, 0.2);
      border-color: rgba(99, 102, 241, 0.4);
    }
    .stat-value { font-size: 2.5rem; font-weight: 700; }
    .stat-label { color: #94a3b8; font-size: 0.85rem; margin-top: 0.25rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-card.pass .stat-value { color: #4ade80; }
    .stat-card.fail .stat-value { color: #f87171; }
    .stat-card.total .stat-value { color: #60a5fa; }
    .stat-card.rate .stat-value { color: ${statusColor}; }
    .stat-card.time .stat-value { color: #c084fc; }
    
    /* Main Tabs */
    .tabs-container {
      background: rgba(30, 41, 59, 0.6);
      border-radius: 1rem;
      border: 1px solid rgba(99, 102, 241, 0.2);
      overflow: hidden;
    }
    .main-tabs {
      display: flex;
      background: rgba(15, 23, 42, 0.8);
      border-bottom: 1px solid rgba(99, 102, 241, 0.2);
    }
    .main-tab {
      flex: 1;
      padding: 1rem 1.5rem;
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 500;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }
    .main-tab:hover { background: rgba(99, 102, 241, 0.1); color: #e2e8f0; }
    .main-tab.active { 
      background: rgba(99, 102, 241, 0.2); 
      color: #a5b4fc; 
      border-bottom: 2px solid #818cf8;
    }
    .tab-content { display: none; padding: 1.5rem; }
    .tab-content.active { display: block; }
    
    /* Sub Navigation (Language/Category pills) */
    .sub-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding: 1rem;
      background: rgba(15, 23, 42, 0.5);
      border-bottom: 1px solid rgba(99, 102, 241, 0.1);
    }
    .sub-nav-btn {
      padding: 0.5rem 1rem;
      background: rgba(51, 65, 85, 0.5);
      border: 1px solid transparent;
      border-radius: 2rem;
      color: #94a3b8;
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .sub-nav-btn:hover { background: rgba(99, 102, 241, 0.2); color: #e2e8f0; }
    .sub-nav-btn.active { 
      background: rgba(99, 102, 241, 0.3); 
      color: #a5b4fc; 
      border-color: rgba(99, 102, 241, 0.5);
    }
    
    /* Language/Category Sections */
    .lang-section, .cat-section { display: none; }
    .lang-section.active, .cat-section.active { display: block; animation: fadeIn 0.3s ease; }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .lang-header, .cat-header {
      padding: 1.5rem;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, transparent 100%);
      border-radius: 0.75rem;
      margin-bottom: 1.5rem;
    }
    .lang-title, .cat-title {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .lang-icon, .cat-icon { font-size: 2.5rem; }
    .lang-title h2, .cat-title h2 { font-size: 1.75rem; color: #f8fafc; }
    .lang-stats, .cat-stats-badge {
      padding: 0.25rem 0.75rem;
      background: rgba(99, 102, 241, 0.2);
      border-radius: 1rem;
      font-size: 0.85rem;
      color: #a5b4fc;
    }
    .lang-bar {
      margin-top: 1rem;
      height: 8px;
      background: rgba(51, 65, 85, 0.5);
      border-radius: 4px;
      overflow: hidden;
    }
    .lang-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 1s ease;
    }
    
    /* Tips Box */
    .tips-box {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(6, 182, 212, 0.05) 100%);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 0.75rem;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .tips-box h3 {
      color: #34d399;
      font-size: 1.1rem;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .tips-box .tip {
      background: rgba(0, 0, 0, 0.2);
      padding: 1rem;
      border-radius: 0.5rem;
      margin-bottom: 0.75rem;
      border-left: 3px solid #10b981;
    }
    .tips-box .tip:last-child { margin-bottom: 0; }
    .tips-box .tip-title {
      color: #6ee7b7;
      font-weight: 600;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .tips-box .tip-content {
      color: #94a3b8;
      font-size: 0.9rem;
      line-height: 1.7;
    }
    .tips-box .tip-content code {
      background: rgba(0, 0, 0, 0.3);
      padding: 0.1rem 0.4rem;
      border-radius: 0.25rem;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.85em;
      color: #fbbf24;
    }
    .tips-box .tip-content strong { color: #e2e8f0; }
    
    /* Explain box - Simple explanations */
    .explain-box {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(37, 99, 235, 0.08));
      border: 1px solid rgba(59, 130, 246, 0.4);
      border-radius: 0.75rem;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .explain-box h3 {
      color: #60a5fa;
      font-size: 1.1rem;
      margin: 0 0 0.75rem 0;
    }
    .explain-simple p {
      color: #e2e8f0;
      font-size: 1rem;
      line-height: 1.8;
      margin: 0 0 1rem 0;
    }
    .explain-simple p strong { color: #93c5fd; }
    .explain-example {
      background: rgba(0, 0, 0, 0.25);
      border-left: 3px solid #3b82f6;
      padding: 0.75rem 1rem;
      border-radius: 0.25rem;
      color: #94a3b8;
      font-size: 0.9rem;
      line-height: 1.6;
    }
    .explain-example strong { color: #60a5fa; }
    
    /* Mind-blown box */
    .mindblown-box {
      background: linear-gradient(135deg, rgba(244, 63, 94, 0.1) 0%, rgba(168, 85, 247, 0.05) 100%);
      border: 1px solid rgba(244, 63, 94, 0.3);
      border-radius: 0.75rem;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .mindblown-box h3 {
      color: #fb7185;
      font-size: 1.1rem;
      margin-bottom: 1rem;
    }
    .mindblown-box .fact {
      background: rgba(0, 0, 0, 0.2);
      padding: 1rem;
      border-radius: 0.5rem;
      margin-bottom: 0.75rem;
      border-left: 3px solid #f43f5e;
    }
    .mindblown-box .fact:last-child { margin-bottom: 0; }
    .mindblown-box .fact-emoji { font-size: 1.5rem; margin-right: 0.75rem; }
    .mindblown-box .fact-content { color: #e2e8f0; font-size: 0.95rem; }
    
    /* Cheat Sheet */
    .cheatsheet-box {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(6, 78, 59, 0.2));
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 0.75rem;
      padding: 1.25rem;
      margin-top: 1rem;
    }
    .cheatsheet-box h3 {
      color: #34d399;
      margin: 0 0 1rem 0;
      font-size: 1.1rem;
    }
    .cheat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 0.75rem;
    }
    .cheat-item {
      background: rgba(15, 23, 42, 0.6);
      border-radius: 0.5rem;
      padding: 0.75rem;
      border: 1px solid rgba(51, 65, 85, 0.5);
    }
    .cheat-bad {
      color: #f87171;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.8rem;
      margin-bottom: 0.4rem;
      padding: 0.25rem 0.5rem;
      background: rgba(248, 113, 113, 0.1);
      border-radius: 0.25rem;
    }
    .cheat-good {
      color: #34d399;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.8rem;
      margin-bottom: 0.4rem;
      padding: 0.25rem 0.5rem;
      background: rgba(52, 211, 153, 0.1);
      border-radius: 0.25rem;
    }
    .cheat-why {
      color: #94a3b8;
      font-size: 0.75rem;
      font-style: italic;
      border-top: 1px solid rgba(51, 65, 85, 0.5);
      padding-top: 0.4rem;
      margin-top: 0.4rem;
    }
    .cheat-pro-tips {
      margin-top: 1rem;
      background: rgba(99, 102, 241, 0.1);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 0.5rem;
      padding: 0.75rem 1rem;
    }
    .cheat-pro-tips h4 {
      color: #a5b4fc;
      margin: 0 0 0.5rem 0;
      font-size: 0.9rem;
    }
    .cheat-pro-tips ul {
      margin: 0;
      padding-left: 1.25rem;
      color: #e2e8f0;
    }
    .cheat-pro-tips li {
      margin-bottom: 0.25rem;
      font-size: 0.85rem;
    }
    .cheat-pro-tips li:last-child { margin-bottom: 0; }
    .cheat-pro-tips code {
      background: rgba(99, 102, 241, 0.2);
      padding: 0.1rem 0.35rem;
      border-radius: 0.25rem;
      font-size: 0.8rem;
      color: #c7d2fe;
    }
    
    /* Category Accordion */
    .categories-accordion { margin-top: 1rem; }
    .category-section {
      background: rgba(15, 23, 42, 0.5);
      border-radius: 0.75rem;
      margin-bottom: 0.75rem;
      border: 1px solid rgba(51, 65, 85, 0.5);
      overflow: hidden;
    }
    .category-header {
      padding: 1rem 1.25rem;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 500;
      color: #e2e8f0;
      transition: background 0.2s;
    }
    .category-header:hover { background: rgba(99, 102, 241, 0.1); }
    .category-stats {
      padding: 0.2rem 0.6rem;
      background: rgba(99, 102, 241, 0.2);
      border-radius: 1rem;
      font-size: 0.8rem;
      color: #a5b4fc;
    }
    .category-section[open] .category-header {
      background: rgba(99, 102, 241, 0.1);
      border-bottom: 1px solid rgba(99, 102, 241, 0.2);
    }
    
    /* Lang Groups */
    .lang-groups { margin-top: 1rem; }
    .lang-group {
      background: rgba(15, 23, 42, 0.5);
      border-radius: 0.75rem;
      margin-bottom: 0.75rem;
      border: 1px solid rgba(51, 65, 85, 0.5);
      overflow: hidden;
    }
    .lang-group summary {
      padding: 1rem 1.25rem;
      cursor: pointer;
      font-weight: 500;
      color: #e2e8f0;
      transition: background 0.2s;
    }
    .lang-group summary:hover { background: rgba(99, 102, 241, 0.1); }
    .lang-group[open] summary {
      background: rgba(99, 102, 241, 0.1);
      border-bottom: 1px solid rgba(99, 102, 241, 0.2);
    }
    
    /* Tests Grid */
    .tests-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
      gap: 1rem;
      padding: 1rem;
    }
    @media (max-width: 500px) { .tests-grid { grid-template-columns: 1fr; } }
    
    /* Test Cards */
    .test-card {
      background: rgba(30, 41, 59, 0.8);
      border-radius: 0.75rem;
      padding: 1.25rem;
      border: 1px solid rgba(51, 65, 85, 0.5);
      transition: all 0.2s;
    }
    .test-card:hover { 
      border-color: rgba(99, 102, 241, 0.4);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }
    .test-card.pass { border-left: 4px solid #22c55e; }
    .test-card.fail { border-left: 4px solid #ef4444; }
    
    .test-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .test-status { font-size: 1.25rem; }
    .test-card.pass .test-status { color: #4ade80; }
    .test-card.fail .test-status { color: #f87171; }
    .test-name { flex: 1; font-weight: 600; font-size: 0.95rem; color: #f8fafc; }
    .test-duration { 
      color: #64748b; 
      font-size: 0.75rem; 
      padding: 0.15rem 0.5rem;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 1rem;
    }
    
    .test-meta {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
    }
    .test-badge {
      font-size: 0.75rem;
      padding: 0.2rem 0.6rem;
      border-radius: 1rem;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .lang-badge { background: rgba(59, 130, 246, 0.2); color: #93c5fd; }
    .cat-badge { background: rgba(168, 85, 247, 0.2); color: #c4b5fd; }
    
    .test-result {
      display: flex;
      gap: 1rem;
      margin-bottom: 0.75rem;
      font-size: 0.8rem;
    }
    .expected { color: #94a3b8; }
    .actual { color: #64748b; }
    
    /* Explanation */
    .explanation {
      margin-top: 0.75rem;
      border-top: 1px solid rgba(51, 65, 85, 0.5);
      padding-top: 0.75rem;
    }
    .explanation summary {
      cursor: pointer;
      color: #60a5fa;
      font-size: 0.85rem;
      user-select: none;
      transition: color 0.2s;
    }
    .explanation summary:hover { color: #93c5fd; }
    .explanation-content {
      margin-top: 0.75rem;
      padding: 1rem;
      background: rgba(15, 23, 42, 0.6);
      border-radius: 0.5rem;
      font-size: 0.85rem;
      line-height: 1.8;
    }
    .explanation-content strong { color: #f8fafc; }
    .explanation-content .attack-title {
      color: #f87171;
      font-weight: bold;
      font-size: 1.05rem;
      margin-bottom: 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .explanation-content .safe-title {
      color: #4ade80;
      font-weight: bold;
      font-size: 1.05rem;
      margin-bottom: 0.75rem;
    }
    .explanation-content p { margin: 0.5rem 0; color: #cbd5e1; }
    .explanation-content ul { margin: 0.5rem 0 0.5rem 1.5rem; }
    .explanation-content li { margin: 0.25rem 0; color: #94a3b8; }
    
    /* Code */
    .code-details {
      margin-top: 0.75rem;
    }
    .code-details summary {
      cursor: pointer;
      color: #64748b;
      font-size: 0.8rem;
      user-select: none;
      transition: color 0.2s;
    }
    .code-details summary:hover { color: #94a3b8; }
    .code-details pre {
      margin-top: 0.5rem;
      padding: 1rem;
      background: #020617;
      border-radius: 0.5rem;
      overflow-x: auto;
      font-size: 0.8rem;
      border: 1px solid rgba(51, 65, 85, 0.5);
    }
    .code-details code {
      color: #e2e8f0;
      font-family: 'Monaco', 'Menlo', 'Fira Code', monospace;
    }
    
    /* Educational Tab */
    .edu-content { padding: 1.5rem; }
    .edu-lang-section { display: none; }
    .edu-lang-section.active { display: block; animation: fadeIn 0.3s ease; }
    .edu-lang-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1.5rem;
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(168, 85, 247, 0.1) 100%);
      border-radius: 1rem;
      margin-bottom: 1.5rem;
      border: 1px solid rgba(99, 102, 241, 0.3);
    }
    .edu-lang-icon { font-size: 3rem; }
    .edu-lang-header h2 { 
      font-size: 1.75rem; 
      color: #f8fafc;
      background: linear-gradient(135deg, #f8fafc 0%, #a5b4fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .edu-section {
      background: rgba(30, 41, 59, 0.6);
      border-radius: 1rem;
      padding: 2rem;
      margin-bottom: 1.5rem;
      border: 1px solid rgba(99, 102, 241, 0.2);
    }
    .edu-section h2 {
      font-size: 1.5rem;
      margin-bottom: 1.5rem;
      color: #f8fafc;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .edu-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 1.5rem;
    }
    .edu-card {
      background: rgba(15, 23, 42, 0.8);
      border-radius: 0.75rem;
      padding: 1.5rem;
      border: 1px solid rgba(51, 65, 85, 0.5);
      transition: all 0.3s;
    }
    .edu-card:hover {
      border-color: rgba(99, 102, 241, 0.4);
      transform: translateY(-2px);
    }
    .edu-card h3 {
      color: #a5b4fc;
      font-size: 1.1rem;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .edu-card p {
      color: #94a3b8;
      font-size: 0.9rem;
      line-height: 1.7;
      margin-bottom: 1rem;
    }
    .edu-card code {
      background: rgba(0, 0, 0, 0.3);
      padding: 0.1rem 0.4rem;
      border-radius: 0.25rem;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.85em;
      color: #fbbf24;
    }
    .edu-card .good-use {
      background: rgba(16, 185, 129, 0.1);
      padding: 1rem;
      border-radius: 0.5rem;
      border-left: 3px solid #10b981;
    }
    .edu-card .good-use h4 {
      color: #34d399;
      font-size: 0.9rem;
      margin-bottom: 0.5rem;
    }
    .edu-card .good-use p {
      color: #94a3b8;
      font-size: 0.85rem;
      margin: 0;
    }
    
    /* Vulnerabilities Alert */
    .vulnerabilities { 
      background: rgba(239, 68, 68, 0.1); 
      border: 1px solid rgba(239, 68, 68, 0.3); 
      border-radius: 1rem; 
      padding: 1.5rem; 
      margin: 1.5rem 0; 
    }
    .vulnerabilities h2 { color: #f87171; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; }
    .vuln-item { 
      padding: 1rem; 
      margin: 0.5rem 0; 
      background: rgba(0,0,0,0.2); 
      border-radius: 0.5rem;
      border-left: 3px solid #ef4444;
    }
    
    /* Success Banner */
    .success-banner {
      text-align: center;
      padding: 2.5rem;
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: 1rem;
      margin: 1.5rem 0;
    }
    .success-banner h2 { color: #4ade80; margin-bottom: 0.5rem; font-size: 1.5rem; }
    .success-banner p { color: #94a3b8; }
    .success-banner .checkmark {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    
    /* Footer */
    .footer {
      text-align: center;
      padding: 2rem;
      color: #64748b;
      font-size: 0.85rem;
      margin-top: 2rem;
      border-top: 1px solid rgba(51, 65, 85, 0.5);
    }
    .footer a { color: #60a5fa; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <header class="hero">
      <h1>🔒 Security Educational Report</h1>
      <p class="subtitle">Learn How Hackers Exploit Code Execution Vulnerabilities</p>
      <p class="tagline">"Know thy enemy and know yourself; in a hundred battles, you will never be defeated." - Sun Tzu</p>
      <p class="timestamp">Generated: ${data.timestamp} | Server: ${data.server}</p>
    </header>
    
    <div class="intro-section">
      <div class="intro-card">
        <div class="intro-icon">🤔</div>
        <div class="intro-content">
          <h2>Wait... Why Does This Report Exist?</h2>
          <p>
            Great question! Our platform lets you <strong>write and run real code</strong> directly in your browser - 
            JavaScript, Python, PHP, Java, TypeScript - just like a real development environment (IDE).
          </p>
          <p>
            But here's the thing: if someone can run code on our servers, what stops them from running 
            <em>malicious</em> code? Like reading secret files, deleting databases, or attacking other users?
          </p>
          <p class="intro-highlight">
            <strong>That's exactly what these tests check!</strong> We throw every hacking trick in the book at our security 
            filters to make sure they catch the bad stuff while letting the good code through.
          </p>
        </div>
      </div>
      
      <div class="intro-grid">
        <div class="intro-mini-card">
          <span class="intro-mini-icon">🛡️</span>
          <div class="intro-mini-text">
            <strong>For You:</strong> Your code runs in a safe sandbox. One user's code can't affect another.
          </div>
        </div>
        <div class="intro-mini-card">
          <span class="intro-mini-icon">🔐</span>
          <div class="intro-mini-text">
            <strong>For Us:</strong> Even if someone tries something sneaky, the server stays protected.
          </div>
        </div>
        <div class="intro-mini-card">
          <span class="intro-mini-icon">🎓</span>
          <div class="intro-mini-text">
            <strong>For Learning:</strong> See how hackers think - and why security matters!
          </div>
        </div>
      </div>
      
      <div class="intro-cta">
        <p>
          <strong>👇 Scroll down to explore:</strong> Test results, attack techniques, 
          mind-blowing security facts, and how these same "dangerous" skills can be used to build amazing things!
        </p>
      </div>
    </div>
    
    <div class="dashboard">
      <div class="stat-card total">
        <div class="stat-value">${data.summary.total}</div>
        <div class="stat-label">Total Tests</div>
      </div>
      <div class="stat-card pass">
        <div class="stat-value">${data.summary.passed}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat-card fail">
        <div class="stat-value">${data.summary.failed}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat-card rate">
        <div class="stat-value">${data.summary.passRate}</div>
        <div class="stat-label">Pass Rate</div>
      </div>
      <div class="stat-card time">
        <div class="stat-value">${(data.summary.duration / 1000).toFixed(1)}s</div>
        <div class="stat-label">Duration</div>
      </div>
    </div>
    
    ${data.vulnerabilities.length > 0 ? `
    <div class="vulnerabilities">
      <h2>⚠️ Security Vulnerabilities Detected</h2>
      <p style="color: #f87171; margin-bottom: 1rem;">The following attack vectors were NOT blocked and need immediate attention:</p>
      ${data.vulnerabilities.map(v => `
        <div class="vuln-item">
          <strong style="color: #fca5a5;">${escapeHtml(v.name)}</strong><br>
          <small style="color: #94a3b8;">${escapeHtml(v.reason)}</small>
        </div>
      `).join('')}
    </div>
    ` : `
    <div class="success-banner">
      <div class="checkmark">🛡️</div>
      <h2>All Security Tests Passed!</h2>
      <p>Your system successfully blocked all ${data.summary.total} tested attack vectors.</p>
    </div>
    `}
    
    <div class="tabs-container">
      <div class="main-tabs">
        <button class="main-tab active" data-tab="by-language">📚 By Language</button>
        <button class="main-tab" data-tab="by-category">🎯 By Attack Type</button>
        <button class="main-tab" data-tab="educational">🧠 Use For Good</button>
      </div>
      
      <!-- By Language Tab -->
      <div class="tab-content active" id="by-language">
        <div class="sub-nav">
          ${languages.map((lang, i) => `
            <button class="sub-nav-btn ${i === 0 ? 'active' : ''}" data-target="${lang}">
              ${getLanguageIcon(lang)} ${lang.toUpperCase()}
            </button>
          `).join('')}
        </div>
        ${byLanguageHTML}
      </div>
      
      <!-- By Category Tab -->
      <div class="tab-content" id="by-category">
        <div class="sub-nav">
          ${categories.map((cat, i) => `
            <button class="sub-nav-btn ${i === 0 ? 'active' : ''}" data-target="${cat}">
              ${getCategoryIcon(cat)} ${formatCategoryName(cat)}
            </button>
          `).join('')}
        </div>
        ${byCategoryHTML}
      </div>
      
      <!-- Educational Tab -->
      <div class="tab-content" id="educational">
        <div class="sub-nav">
          ${languages.map((lang, i) => `
            <button class="sub-nav-btn ${i === 0 ? 'active' : ''}" data-target="${lang}">
              ${getLanguageIcon(lang)} ${lang.toUpperCase()}
            </button>
          `).join('')}
          <button class="sub-nav-btn" data-target="overview">
            📖 Overview
          </button>
        </div>
        ${generateEducationalContent(languages)}
      </div>
    </div>
    
    <footer class="footer">
      <p>🔒 Browser Coder Security Test Suite v3.0 - Educational Edition</p>
      <p>Built for learning. Built for protection. Built for the curious mind.</p>
    </footer>
  </div>
  
  <script>
    // Main tab switching
    document.querySelectorAll('.main-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
        
        // Activate first sub-nav item
        const activeTab = document.getElementById(tab.dataset.tab);
        const firstSubNav = activeTab.querySelector('.sub-nav-btn');
        if (firstSubNav) firstSubNav.click();
      });
    });
    
    // Sub navigation (language/category pills)
    document.querySelectorAll('.sub-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const parent = btn.closest('.tab-content');
        parent.querySelectorAll('.sub-nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const target = btn.dataset.target;
        const tabId = parent.id;
        
        // Handle different tab types
        if (tabId === 'by-language') {
          parent.querySelectorAll('.lang-section').forEach(s => {
            s.classList.remove('active');
            if (s.dataset.language === target) s.classList.add('active');
          });
        } else if (tabId === 'by-category') {
          parent.querySelectorAll('.cat-section').forEach(s => {
            s.classList.remove('active');
            if (s.dataset.category === target) s.classList.add('active');
          });
        } else if (tabId === 'educational') {
          parent.querySelectorAll('.edu-lang-section').forEach(s => {
            s.classList.remove('active');
            if (s.dataset.eduLang === target) s.classList.add('active');
          });
        }
      });
    });
    
    // Initialize first sections
    document.querySelector('.lang-section')?.classList.add('active');
    document.querySelector('.cat-section')?.classList.add('active');
    document.querySelector('.edu-lang-section')?.classList.add('active');
    
    // Auto-expand failed tests
    document.querySelectorAll('.test-card.fail .explanation').forEach(el => el.open = true);
  </script>
</body>
</html>`;
}
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatExplanation(explanation) {
  if (!explanation) return '';
  
  // Parse the explanation format
  const lines = explanation.trim().split('\n');
  let html = '';
  let inList = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    if (trimmed.startsWith('🎯 ATTACK:')) {
      html += `<div class="attack-title">${escapeHtml(trimmed)}</div>`;
    } else if (trimmed.startsWith('✅ SAFE:')) {
      html += `<div class="safe-title">${escapeHtml(trimmed)}</div>`;
    } else if (trimmed.startsWith('How hackers use this:') || 
               trimmed.startsWith('Real-world impact:') ||
               trimmed.startsWith('This is legitimate code')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p><strong>${escapeHtml(trimmed)}</strong></p>`;
    } else if (trimmed.startsWith('- ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${escapeHtml(trimmed.substring(2))}</li>`;
    } else if (trimmed.match(/^\d+\./)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${escapeHtml(trimmed)}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${escapeHtml(trimmed)}</p>`;
    }
  }
  
  if (inList) html += '</ul>';
  return html;
}

function getLanguageIcon(language) {
  const icons = {
    javascript: '🟨',
    typescript: '🔷',
    python: '🐍',
    php: '🐘',
    java: '☕',
  };
  return icons[language] || '📄';
}

function getCategoryIcon(category) {
  const icons = {
    command_execution: '⚡',
    file_system: '📁',
    network: '🌐',
    code_injection: '💉',
    system_access: '🖥️',
    memory_access: '🧠',
    encoding_bypass: '🔐',
    prototype_pollution: '☠️',
    global_access: '🌍',
    reflect_proxy: '🪞',
    timer_abuse: '⏰',
    async_exploits: '⚡',
    dangerous_modules: '⚠️',
    safe_code: '✅',
    type_abuse: '📝',
    decorator_abuse: '🎭',
    deserialization: '📦',
    introspection: '🔍',
    code_manipulation: '🔧',
    signal_handling: '📡',
    superglobal_access: '🔑',
    jndi_injection: '🎯',
    script_engine: '📜',
    unsafe_memory: '💾',
    classloader: '📚',
    security_bypass: '🚫',
    native_code: '⚙️',
    reflection: '🪞',
    serialization: '📦',
  };
  return icons[category] || '📋';
}

function formatCategoryName(category) {
  return category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ═══════════════════════════════════════════════════════════════════════════════
// EDUCATIONAL CONTENT - "USE FOR GOOD" TIPS AND MIND-BLOWING FACTS
// ═══════════════════════════════════════════════════════════════════════════════

function getLanguageTips(language) {
  const tips = {
    javascript: `
      <div class="tips-box">
        <h3>💡 Use These Powers For Good</h3>
        <div class="tip">
          <div class="tip-title">🔧 Build CLI Tools with child_process</div>
          <div class="tip-content">
            Instead of malicious use, <code>child_process</code> can automate your development workflow! 
            Build your own CLI tools: automated git operations, file processors, deployment scripts.
            <strong>Pro tip:</strong> Use <code>execSync</code> for simple commands, <code>spawn</code> for streaming large outputs.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🌐 Create Powerful Dev Servers</div>
          <div class="tip-content">
            The same <code>http</code> and <code>net</code> modules hackers exploit can build amazing dev tools!
            Create mock APIs, proxy servers, WebSocket servers for real-time apps.
            <strong>Did you know?</strong> You can build a full HTTP server in just 5 lines of Node.js code.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">⚡ Master eval() Safely</div>
          <div class="tip-content">
            While <code>eval()</code> is dangerous with user input, it powers amazing tools!
            Build expression parsers, formula calculators, or dynamic code playgrounds (like this app!).
            <strong>Safe pattern:</strong> Always sanitize and never eval user input directly.
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Mind-Blowing JavaScript Facts</h3>
        <div class="fact">
          <span class="fact-emoji">⚡</span>
          <span class="fact-content">
            <strong>V8 Engine Magic:</strong> JavaScript can be as fast as C++ when JIT-compiled properly. 
            The same language that runs in browsers can now compete with compiled languages!
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🌍</span>
          <span class="fact-content">
            <strong>Prototype Power:</strong> The prototype chain you see blocked here is how every JS object inherits methods.
            Understanding it deeply lets you create elegant, memory-efficient code patterns!
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🔮</span>
          <span class="fact-content">
            <strong>Proxy & Reflect:</strong> These "dangerous" APIs let you build reactive frameworks like Vue.js!
            They intercept ALL object operations - reads, writes, function calls, everything!
          </span>
        </div>
      </div>
      <div class="cheatsheet-box">
        <h3>🛡️ JavaScript Security Cheat Sheet</h3>
        <div class="cheat-grid">
          <div class="cheat-item">
            <div class="cheat-bad">❌ eval(userInput)</div>
            <div class="cheat-good">✅ JSON.parse(userInput)</div>
            <div class="cheat-why">Parse data safely without code execution</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ innerHTML = userInput</div>
            <div class="cheat-good">✅ textContent = userInput</div>
            <div class="cheat-why">Prevents XSS attacks in DOM manipulation</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ new Function(userCode)</div>
            <div class="cheat-good">✅ Use a sandboxed iframe or Web Worker</div>
            <div class="cheat-why">Isolate dynamic code execution</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ document.cookie accessible</div>
            <div class="cheat-good">✅ Set HttpOnly and Secure flags</div>
            <div class="cheat-why">Protect cookies from JS theft</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ window.location = userUrl</div>
            <div class="cheat-good">✅ Validate URL with new URL() + allowlist</div>
            <div class="cheat-why">Prevent open redirect attacks</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ Object.assign(target, userObj)</div>
            <div class="cheat-good">✅ Pick specific properties only</div>
            <div class="cheat-why">Block prototype pollution via __proto__</div>
          </div>
        </div>
        <div class="cheat-pro-tips">
          <h4>🔥 Pro Security Tips</h4>
          <ul>
            <li><code>Object.freeze()</code> makes objects immutable - great for config!</li>
            <li><code>'use strict'</code> catches silent errors and prevents bad patterns</li>
            <li>Use <code>crypto.randomUUID()</code> not <code>Math.random()</code> for tokens</li>
            <li>CSP headers are your best friend against XSS</li>
            <li><code>Intl.Segmenter</code> handles Unicode safely - no regex for user text!</li>
          </ul>
        </div>
      </div>
    `,
    typescript: `
      <div class="tips-box">
        <h3>💡 TypeScript Superpowers</h3>
        <div class="tip">
          <div class="tip-title">🛡️ Type Guards as Security</div>
          <div class="tip-content">
            TypeScript's type system can <strong>prevent entire classes of bugs</strong> at compile time!
            Create strict types for user input, API responses, and data validation.
            <strong>Pro tip:</strong> Use discriminated unions and <code>never</code> to make invalid states unrepresentable.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🏗️ Build Your Own DSL</div>
          <div class="tip-content">
            TypeScript's advanced types let you create <strong>domain-specific languages</strong> that catch errors at compile time!
            Build type-safe SQL query builders, API clients, or configuration systems.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">📦 Safer npm Packages</div>
          <div class="tip-content">
            Publish npm packages with <code>.d.ts</code> files and consumers get autocomplete + type checking.
            <strong>Did you know?</strong> You can use TypeScript to analyze JavaScript files without converting them!
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 TypeScript Tricks</h3>
        <div class="fact">
          <span class="fact-emoji">🧠</span>
          <span class="fact-content">
            <strong>Turing Complete Types:</strong> TypeScript's type system is so powerful, you can implement 
            a JSON parser or even simple games entirely within the type system!
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🎭</span>
          <span class="fact-content">
            <strong>Type Branding:</strong> You can create "branded" types that are impossible to mix up.
            <code>type USD = number & { __brand: 'USD' }</code> - Now you can't accidentally add USD to EUR!
          </span>
        </div>
      </div>
      <div class="cheatsheet-box">
        <h3>🛡️ TypeScript Security Cheat Sheet</h3>
        <div class="cheat-grid">
          <div class="cheat-item">
            <div class="cheat-bad">❌ any type everywhere</div>
            <div class="cheat-good">✅ unknown + type guards</div>
            <div class="cheat-why">Forces explicit validation of external data</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ as Type (type assertion)</div>
            <div class="cheat-good">✅ Type predicates: is Type</div>
            <div class="cheat-why">Runtime validation, not just compile-time lies</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ object as Record&lt;string, any&gt;</div>
            <div class="cheat-good">✅ Zod/io-ts for runtime validation</div>
            <div class="cheat-why">Schema validation at API boundaries</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ String enums for user input</div>
            <div class="cheat-good">✅ const assertions + Set.has()</div>
            <div class="cheat-why">Type-safe input validation</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ Return Promise&lt;any&gt;</div>
            <div class="cheat-good">✅ Return Promise&lt;Result&lt;T, Error&gt;&gt;</div>
            <div class="cheat-why">Force error handling at compile time</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ Mutable shared state</div>
            <div class="cheat-good">✅ Readonly&lt;T&gt; and readonly arrays</div>
            <div class="cheat-why">Immutability prevents side effects</div>
          </div>
        </div>
        <div class="cheat-pro-tips">
          <h4>🔥 TypeScript Security Patterns</h4>
          <ul>
            <li><code>satisfies</code> operator validates without widening types</li>
            <li>Template literal types can validate string formats at compile time</li>
            <li><code>NoInfer&lt;T&gt;</code> prevents type inference attacks in generics</li>
            <li>Use <code>strictNullChecks</code> - it catches SO many bugs</li>
            <li>Branded types for IDs: <code>type UserId = string & { readonly __brand: unique symbol }</code></li>
          </ul>
        </div>
      </div>
    `,
    python: `
      <div class="tips-box">
        <h3>💡 Python Powers For Good</h3>
        <div class="tip">
          <div class="tip-title">🤖 Automation Master</div>
          <div class="tip-content">
            The same <code>os</code> and <code>subprocess</code> modules hackers exploit can automate your entire workflow!
            Build backup scripts, file organizers, system monitors, deployment pipelines.
            <strong>Pro tip:</strong> Use <code>pathlib</code> instead of <code>os.path</code> for cleaner code.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🕷️ Web Scraping for Research</div>
          <div class="tip-content">
            <code>urllib</code> and <code>requests</code> can ethically gather data for research, price monitoring, or building datasets.
            Respect <code>robots.txt</code>, add delays, and always check terms of service!
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🔬 Dynamic Magic Methods</div>
          <div class="tip-content">
            Python's <code>__getattr__</code>, <code>__setattr__</code> can build amazing abstractions!
            Create lazy-loading objects, automatic API wrappers, or debugging proxies.
            <strong>Example:</strong> Django ORM uses these to make database queries feel like Python objects.
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Python Secrets</h3>
        <div class="fact">
          <span class="fact-emoji">🐍</span>
          <span class="fact-content">
            <strong>Everything is an Object:</strong> Even functions, classes, and modules are objects in Python.
            You can add attributes to functions: <code>my_func.metadata = "value"</code>!
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">⚡</span>
          <span class="fact-content">
            <strong>Comprehension Performance:</strong> List comprehensions aren't just prettier - they're faster!
            They're optimized at the bytecode level and avoid function call overhead.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🎪</span>
          <span class="fact-content">
            <strong>Metaclasses:</strong> Classes are instances of metaclasses. You can customize how classes themselves work!
            Django, SQLAlchemy, and many frameworks use this to create intuitive APIs.
          </span>
        </div>
      </div>
      <div class="cheatsheet-box">
        <h3>🛡️ Python Security Cheat Sheet</h3>
        <div class="cheat-grid">
          <div class="cheat-item">
            <div class="cheat-bad">❌ eval(user_input)</div>
            <div class="cheat-good">✅ ast.literal_eval(user_input)</div>
            <div class="cheat-why">Only parses literals, no code execution</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ pickle.loads(untrusted_data)</div>
            <div class="cheat-good">✅ json.loads() or msgpack</div>
            <div class="cheat-why">Pickle can execute arbitrary code!</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ os.system(f"cmd {user}")</div>
            <div class="cheat-good">✅ subprocess.run([cmd, user], shell=False)</div>
            <div class="cheat-why">Array args prevent shell injection</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ yaml.load(data)</div>
            <div class="cheat-good">✅ yaml.safe_load(data)</div>
            <div class="cheat-why">YAML can execute Python objects!</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ open(user_path).read()</div>
            <div class="cheat-good">✅ Validate path with pathlib.resolve()</div>
            <div class="cheat-why">Prevent path traversal ../../../etc/passwd</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ SQL f-strings: f"WHERE id={id}"</div>
            <div class="cheat-good">✅ Parameterized: cursor.execute(sql, (id,))</div>
            <div class="cheat-why">Prevents SQL injection attacks</div>
          </div>
        </div>
        <div class="cheat-pro-tips">
          <h4>🔥 Python Security Secrets</h4>
          <ul>
            <li><code>secrets</code> module for crypto-safe random tokens, not <code>random</code></li>
            <li><code>hashlib.scrypt()</code> for password hashing with salt</li>
            <li><code>defusedxml</code> library prevents XXE attacks in XML parsing</li>
            <li>Use <code>bandit</code> to scan your code for security issues</li>
            <li><code>__slots__</code> prevents dynamic attribute injection attacks</li>
            <li>Virtual environments isolate dependencies - use them!</li>
          </ul>
        </div>
      </div>
    `,
    php: `
      <div class="tips-box">
        <h3>💡 PHP Modern Superpowers</h3>
        <div class="tip">
          <div class="tip-title">🚀 PHP 8+ Revolution</div>
          <div class="tip-content">
            Modern PHP is nothing like PHP 4! With JIT compilation, PHP 8 can be <strong>3x faster</strong>.
            Named arguments, attributes, match expressions - it's a completely different language now!
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🌐 WebSocket Servers in PHP!</div>
          <div class="tip-content">
            <strong>Holy shit moment:</strong> PHP wasn't designed for long-running processes, but tools like 
            <code>ReactPHP</code> and <code>Swoole</code> let you build async WebSocket servers that rival Node.js!
            You can handle 100,000+ concurrent connections from PHP.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🔐 Security Best Practices</div>
          <div class="tip-content">
            Always use <code>password_hash()</code> (never MD5!), parameterized queries with PDO,
            and <code>htmlspecialchars()</code> for output. These simple habits prevent 90% of PHP vulnerabilities!
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 PHP Myths Busted</h3>
        <div class="fact">
          <span class="fact-emoji">💨</span>
          <span class="fact-content">
            <strong>PHP Powers 78% of the Web:</strong> WordPress, Wikipedia, Facebook (originally), Slack's backend - 
            all PHP! The language you love to hate runs most of the internet.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🔥</span>
          <span class="fact-content">
            <strong>Swoole vs Node.js:</strong> In benchmarks, PHP with Swoole extension outperforms Node.js 
            in many HTTP scenarios. Yes, really! The async PHP revolution is real.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🧬</span>
          <span class="fact-content">
            <strong>Traits + Anonymous Classes:</strong> PHP can do things that feel impossible!
            Create classes on the fly, compose behaviors with traits, build framework-level magic.
          </span>
        </div>
      </div>
      <div class="cheatsheet-box">
        <h3>🛡️ PHP Security Cheat Sheet</h3>
        <div class="cheat-grid">
          <div class="cheat-item">
            <div class="cheat-bad">❌ md5($password)</div>
            <div class="cheat-good">✅ password_hash($password, PASSWORD_DEFAULT)</div>
            <div class="cheat-why">Bcrypt with salt, auto-upgrades algorithm</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ mysql_query("SELECT * WHERE id=$id")</div>
            <div class="cheat-good">✅ PDO prepared statements</div>
            <div class="cheat-why">mysql_* is deprecated AND vulnerable</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ echo $userInput</div>
            <div class="cheat-good">✅ echo htmlspecialchars($input, ENT_QUOTES)</div>
            <div class="cheat-why">Prevents XSS in HTML context</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ include($_GET['page'].'.php')</div>
            <div class="cheat-good">✅ Allowlist: in_array($page, $allowed)</div>
            <div class="cheat-why">LFI/RFI is a top PHP vulnerability</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ unserialize($userInput)</div>
            <div class="cheat-good">✅ json_decode($userInput)</div>
            <div class="cheat-why">PHP Object Injection is devastating</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ header("Location: $url")</div>
            <div class="cheat-good">✅ Validate with filter_var($url, FILTER_VALIDATE_URL)</div>
            <div class="cheat-why">Open redirect prevention</div>
          </div>
        </div>
        <div class="cheat-pro-tips">
          <h4>🔥 PHP Security Arsenal</h4>
          <ul>
            <li><code>disable_functions</code> in php.ini: exec, system, shell_exec, passthru</li>
            <li><code>open_basedir</code> restricts file access to specific directories</li>
            <li><code>random_bytes()</code> for crypto-safe random data</li>
            <li>Use <code>sodium_*</code> functions for modern encryption</li>
            <li>Set <code>session.cookie_httponly = 1</code> to protect sessions</li>
            <li>Composer <code>audit</code> command checks for vulnerable dependencies</li>
          </ul>
        </div>
      </div>
    `,
    java: `
      <div class="tips-box">
        <h3>💡 Java Hidden Powers</h3>
        <div class="tip">
          <div class="tip-title">🪞 Reflection for Testing</div>
          <div class="tip-content">
            The same reflection hackers use for evil powers amazing testing frameworks!
            JUnit, Mockito, and Spring all use reflection extensively.
            <strong>Pro tip:</strong> Use <code>setAccessible(true)</code> to test private methods (but only in tests!).
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🎯 Annotation Processors</div>
          <div class="tip-content">
            Java annotations + reflection = magic! Build your own <code>@Cached</code>, <code>@Retry</code>, or <code>@Benchmark</code> annotations.
            Lombok generates code at compile time using these techniques!
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">📡 Build Your Own RPC</div>
          <div class="tip-content">
            Serialization (when used safely!) enables distributed computing.
            gRPC, Apache Kafka, Hazelcast - all use serialization to send objects across networks.
            <strong>Safe practice:</strong> Use allowlists and never deserialize untrusted data.
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Java Secrets</h3>
        <div class="fact">
          <span class="fact-emoji">☕</span>
          <span class="fact-content">
            <strong>JVM Languages:</strong> The JVM runs Kotlin, Scala, Groovy, Clojure, and more!
            Learn one runtime, use many languages. Android (Kotlin), Spark (Scala), Gradle (Groovy).
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🚀</span>
          <span class="fact-content">
            <strong>GraalVM Native Image:</strong> Compile Java to native executables that start in milliseconds!
            No JVM warmup, tiny memory footprint - perfect for serverless and CLI tools.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🔮</span>
          <span class="fact-content">
            <strong>Project Loom:</strong> Virtual threads are coming! Handle millions of concurrent tasks 
            with code as simple as sequential programming. Java's async revolution.
          </span>
        </div>
      </div>
      <div class="cheatsheet-box">
        <h3>🛡️ Java Security Cheat Sheet</h3>
        <div class="cheat-grid">
          <div class="cheat-item">
            <div class="cheat-bad">❌ new ObjectInputStream(untrusted)</div>
            <div class="cheat-good">✅ JSON/Protobuf, or ObjectInputFilter</div>
            <div class="cheat-why">Deserialization is Java's #1 vulnerability</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ Runtime.exec(userInput)</div>
            <div class="cheat-good">✅ ProcessBuilder with argument arrays</div>
            <div class="cheat-why">Prevents shell injection attacks</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ SQL: "SELECT * WHERE id=" + id</div>
            <div class="cheat-good">✅ PreparedStatement with parameters</div>
            <div class="cheat-why">SQL injection still happens in 2025</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ new File(userPath)</div>
            <div class="cheat-good">✅ Paths.get(base).resolve(user).normalize()</div>
            <div class="cheat-why">Path traversal prevention</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ DocumentBuilder.parse(untrusted)</div>
            <div class="cheat-good">✅ Disable external entities (XXE)</div>
            <div class="cheat-why">XXE can read files, make requests</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ Class.forName(userInput)</div>
            <div class="cheat-good">✅ Allowlist of permitted classes</div>
            <div class="cheat-why">Reflection can bypass security</div>
          </div>
        </div>
        <div class="cheat-pro-tips">
          <h4>🔥 Java Security Arsenal</h4>
          <ul>
            <li>Use <code>SecurityManager</code> (deprecated but still works) or custom ClassLoader</li>
            <li><code>java.security.SecureRandom</code> for crypto, not <code>java.util.Random</code></li>
            <li>OWASP Dependency Check scans for vulnerable libraries</li>
            <li><code>sealed</code> classes (Java 17+) prevent unauthorized inheritance</li>
            <li><code>record</code> classes are immutable by default - use them!</li>
            <li>JEP 411: Security Manager deprecation - use containers instead</li>
          </ul>
        </div>
      </div>
    `,
  };
  return tips[language] || '';
}

function getCategoryTips(category) {
  const tips = {
    command_execution: `
      <div class="explain-box">
        <h3>🎯 What is Command Execution?</h3>
        <div class="explain-simple">
          <p><strong>In Simple Words:</strong> Imagine your computer is a restaurant kitchen. 
          Command execution is like having a direct line to the chef - you can order ANYTHING. 
          "Make me a pizza" ✅ or "Set the kitchen on fire" 🔥 - the chef just follows orders blindly.</p>
          <div class="explain-example">
            <strong>Real-World Example:</strong> You type "notepad.exe" in Run dialog - that's command execution. 
            Now imagine a website letting you type ANY command and running it on their server. That's the danger!
          </div>
        </div>
      </div>
      <div class="tips-box">
        <h3>💡 Command Execution - Use For Good</h3>
        <div class="tip">
          <div class="tip-title">🔧 DevOps & Infrastructure Automation</div>
          <div class="tip-content">
            Command execution is the backbone of modern DevOps! Terraform, Ansible, Chef, Puppet - they all execute
            commands to provision servers. Build your own infrastructure automation that spins up entire cloud 
            environments with one command.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🔄 Git Hooks & Pre-commit</div>
          <div class="tip-content">
            Every time you commit code, git hooks can run commands automatically! Lint your code, run tests,
            check for secrets, format files. Tools like Husky and pre-commit use this power.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🐳 Container Orchestration</div>
          <div class="tip-content">
            Docker, Kubernetes, docker-compose - all execute commands in isolated environments. 
            Build your own container management tool or deployment pipeline!
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Mind-Blowing Command Facts</h3>
        <div class="fact">
          <span class="fact-emoji">🌍</span>
          <span class="fact-content">
            <strong>The Internet Runs on Bash:</strong> Over 70% of servers worldwide run Linux, 
            and most are managed through shell commands. The humble terminal script powers Netflix, Amazon, Google!
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🚀</span>
          <span class="fact-content">
            <strong>NASA Uses Shell Scripts:</strong> The Mars rovers were partially controlled by shell scripts! 
            Command execution literally reached another planet.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">💰</span>
          <span class="fact-content">
            <strong>$1 Billion Bug:</strong> The Shellshock vulnerability (2014) affected every Bash shell since 1989. 
            A single bug in command parsing threatened the entire internet infrastructure.
          </span>
        </div>
      </div>
      <div class="cheatsheet-box">
        <h3>🛡️ Command Execution Defense Cheat Sheet</h3>
        <div class="cheat-grid">
          <div class="cheat-item">
            <div class="cheat-bad">❌ shell: true with user input</div>
            <div class="cheat-good">✅ execFile() with argument array</div>
            <div class="cheat-why">Shell interpretation enables injection</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ Concatenating commands</div>
            <div class="cheat-good">✅ Use dedicated libraries (ShellJS)</div>
            <div class="cheat-why">Libraries handle escaping properly</div>
          </div>
          <div class="cheat-item">
            <div class="cheat-bad">❌ Running as root/admin</div>
            <div class="cheat-good">✅ Least privilege principle</div>
            <div class="cheat-why">Limits damage if compromised</div>
          </div>
        </div>
      </div>
    `,
    file_system: `
      <div class="explain-box">
        <h3>🎯 What is File System Access?</h3>
        <div class="explain-simple">
          <p><strong>In Simple Words:</strong> Your computer is like a huge library. 
          File system access is having a library card that lets you read ANY book, write in ANY book, 
          or even burn books 🔥. Now imagine giving that card to a stranger from the internet!</p>
          <div class="explain-example">
            <strong>Real-World Example:</strong> You download a "calculator app" that secretly reads your 
            browser's saved passwords file. Or a website trick that lets attackers read /etc/passwd on servers.
          </div>
        </div>
      </div>
      <div class="tips-box">
        <h3>💡 File System - Use For Good</h3>
        <div class="tip">
          <div class="tip-title">📊 Log Aggregation & Analysis</div>
          <div class="tip-content">
            Build your own Splunk! Parse log files, extract patterns, generate dashboards. 
            Tools like Filebeat, Fluentd, Logstash all read files at massive scale. Create real-time 
            monitoring systems that alert you when errors spike.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🎨 Static Site Generators</div>
          <div class="tip-content">
            Jekyll, Hugo, Gatsby, Next.js - they all read markdown files and generate websites! 
            Build your own blog engine, documentation generator, or portfolio builder.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🔍 Code Refactoring Tools</div>
          <div class="tip-content">
            Tools like jscodeshift, ast-grep, and sed transform thousands of files automatically. 
            Rename a function across 500 files? Search-replace on steroids!
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 File System Secrets</h3>
        <div class="fact">
          <span class="fact-emoji">🔮</span>
          <span class="fact-content">
            <strong>Everything is a File:</strong> On Unix/Linux, even your keyboard, monitor, and network 
            are "files"! /dev/null, /dev/random, /proc/cpuinfo - the file abstraction is everywhere.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">⚡</span>
          <span class="fact-content">
            <strong>SSDs Changed Everything:</strong> Modern NVMe SSDs can read 7,000MB/sec! 
            Your entire movie collection (100GB) loads in 14 seconds. File I/O isn't the bottleneck anymore.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">📁</span>
          <span class="fact-content">
            <strong>Git is Just Files:</strong> The entire Git version control is just clever file 
            organization in .git folder. Objects, refs, HEAD - all plain files!
          </span>
        </div>
      </div>
    `,
    network: `
      <div class="explain-box">
        <h3>🎯 What is Network Access?</h3>
        <div class="explain-simple">
          <p><strong>In Simple Words:</strong> Network access is like having a phone that can call 
          ANYONE in the world, send ANY message, and pretend to be ANYONE. Great for staying connected, 
          dangerous if a bad program can make calls on your behalf!</p>
          <div class="explain-example">
            <strong>Real-World Example:</strong> A compromised server starts secretly sending your 
            customer database to an attacker's server in another country, or joins a botnet to attack others.
          </div>
        </div>
      </div>
      <div class="tips-box">
        <h3>💡 Network - Use For Good</h3>
        <div class="tip">
          <div class="tip-title">🎮 Multiplayer Game Servers</div>
          <div class="tip-content">
            Every online game uses sockets! Build your own game server - real-time position sync, 
            chat, matchmaking. Libraries like Socket.io, Netty, Twisted make it easy.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">📡 IoT & Home Automation</div>
          <div class="tip-content">
            Smart home devices communicate over networks! Build your own home automation hub, 
            control lights, thermostats, cameras. MQTT protocol powers millions of IoT devices.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🔄 Real-Time Collaboration</div>
          <div class="tip-content">
            Google Docs, Figma, VS Code Live Share - all use network sockets for real-time sync. 
            Build collaborative tools where changes appear instantly for all users!
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Network Mind-Blowers</h3>
        <div class="fact">
          <span class="fact-emoji">🌊</span>
          <span class="fact-content">
            <strong>Undersea Cables:</strong> 99% of international data travels through 380 underwater cables! 
            A shark bite in the Pacific could slow down your Netflix.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">⚡</span>
          <span class="fact-content">
            <strong>Light-Speed Limits:</strong> Your ping to a server 10,000km away can never be under 33ms - 
            physics! That's why stock traders pay millions to be meters closer to exchanges.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🔢</span>
          <span class="fact-content">
            <strong>Port 80 is Historic:</strong> Tim Berners-Lee chose port 80 for HTTP somewhat randomly in 1991. 
            Now billions of requests flow through this arbitrary number every second!
          </span>
        </div>
      </div>
    `,
    code_injection: `
      <div class="explain-box">
        <h3>🎯 What is Code Injection?</h3>
        <div class="explain-simple">
          <p><strong>In Simple Words:</strong> Imagine a fortune teller who reads exactly what you write 
          on a piece of paper. You write "I will be rich" and they read it aloud. But a trickster writes 
          "...rich. Also, give me all your money!" - and the fortune teller reads that too!</p>
          <div class="explain-example">
            <strong>Real-World Example:</strong> A website calculator that uses eval("5+5") works great. 
            But someone enters "5+5; deleteAllUsers()" and the whole database is gone!
          </div>
        </div>
      </div>
      <div class="tips-box">
        <h3>💡 Dynamic Code - Use For Good</h3>
        <div class="tip">
          <div class="tip-title">📚 Interactive Documentation</div>
          <div class="tip-content">
            RunKit, Observable, Jupyter Notebooks - execute code examples in docs! 
            Build tutorials where readers can modify and run code instantly. Learning by doing!
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🎨 Creative Coding Platforms</div>
          <div class="tip-content">
            Processing, p5.js, Shadertoy - run user code to create art! Build platforms for 
            generative art, music visualization, or interactive installations.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">📊 Low-Code/No-Code Tools</div>
          <div class="tip-content">
            Retool, Zapier, Airtable formulas - business logic without traditional coding! 
            Build tools that let non-programmers create complex automation safely.
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Code Injection Shockers</h3>
        <div class="fact">
          <span class="fact-emoji">📜</span>
          <span class="fact-content">
            <strong>SQL Injection is 25+ Years Old:</strong> First documented in 1998, still #3 on OWASP Top 10 in 2024! 
            We've known the fix for decades, yet breaches keep happening.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🎲</span>
          <span class="fact-content">
            <strong>Bobby Tables:</strong> XKCD's famous comic about "Robert'); DROP TABLE Students;--" 
            is based on real incidents. Schools have actually lost data to this exact attack!
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🏆</span>
          <span class="fact-content">
            <strong>Biggest Bug Bounty:</strong> Google paid $31,337 for a single code injection bug! 
            Finding these vulnerabilities ethically can be a career.
          </span>
        </div>
      </div>
    `,
    safe_code: `
      <div class="explain-box">
        <h3>🎯 What is Safe Code?</h3>
        <div class="explain-simple">
          <p><strong>In Simple Words:</strong> Safe code is like a skilled chef who can make amazing meals 
          using only the standard kitchen tools - no dangerous machinery needed! 
          Pure calculations, data transformations, algorithms - the real craft of programming.</p>
          <div class="explain-example">
            <strong>Real-World Example:</strong> Sorting a list, calculating fibonacci numbers, parsing JSON - 
            these operations can't hack a system. They're the 99% of code that does useful work safely!
          </div>
        </div>
      </div>
      <div class="tips-box">
        <h3>💚 Why Safe Code is Actually Exciting</h3>
        <div class="tip">
          <div class="tip-title">🧮 Algorithms Power Everything</div>
          <div class="tip-content">
            Google's PageRank, Spotify's recommendations, Netflix's streaming optimization - all "just" algorithms! 
            Master data structures and algorithms to build world-changing products.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🎯 Pure Functions = Superpowers</div>
          <div class="tip-content">
            Functions without side effects are predictable, testable, parallelizable. 
            React, Redux, functional programming - all about harnessing pure functions for 
            maintainable, scalable code.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">⚡ Performance Optimization</div>
          <div class="tip-content">
            The difference between O(n²) and O(n log n) can mean seconds vs hours! 
            Safe code patterns like memoization, lazy evaluation, and caching are the 
            secret weapons of high-performance systems.
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Safe Code Superpowers</h3>
        <div class="fact">
          <span class="fact-emoji">🧬</span>
          <span class="fact-content">
            <strong>Functional Programming Rises:</strong> Languages like Rust, Elm, and Haskell 
            make dangerous operations impossible by design! The future of secure code is here.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🔒</span>
          <span class="fact-content">
            <strong>Capability-Based Security:</strong> Instead of "can this code run?", ask "what can this code access?" 
            Deno, CloudFlare Workers use this model - safe by default!
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🎭</span>
          <span class="fact-content">
            <strong>WebAssembly Sandboxing:</strong> Run any language in the browser safely! 
            WASM has no access to DOM, network, or filesystem unless explicitly granted.
          </span>
        </div>
      </div>
    `,
    deserialization: `
      <div class="explain-box">
        <h3>🎯 What is Deserialization?</h3>
        <div class="explain-simple">
          <p><strong>In Simple Words:</strong> Imagine receiving a flat-pack furniture box (serialized data). 
          Deserialization is assembling it. But what if the instructions secretly say "and then unlock the front door"? 
          You followed the instructions and now your house is compromised!</p>
          <div class="explain-example">
            <strong>Real-World Example:</strong> Java applications receive user data as serialized objects. 
            Attacker sends a crafted object that, when "unpacked," executes malicious code. 
            This caused the Equifax breach affecting 147 million people!
          </div>
        </div>
      </div>
      <div class="tips-box">
        <h3>💡 Serialization - Use For Good</h3>
        <div class="tip">
          <div class="tip-title">💾 State Persistence</div>
          <div class="tip-content">
            Save game states, user sessions, application settings - serialization lets you freeze 
            and restore program state! Build apps that remember exactly where users left off.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🔄 Distributed Systems</div>
          <div class="tip-content">
            Microservices communicate via serialized data! Protocol Buffers (Google), Avro (Apache), 
            MessagePack - fast, type-safe serialization for inter-service communication.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">📨 Message Queues</div>
          <div class="tip-content">
            Kafka, RabbitMQ, SQS - all serialize messages for async processing! 
            Build systems that handle millions of events per second.
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Serialization Shockers</h3>
        <div class="fact">
          <span class="fact-emoji">💥</span>
          <span class="fact-content">
            <strong>Log4Shell (2021):</strong> The worst vulnerability in decades - a simple log message 
            could execute arbitrary code! Affected millions of Java applications worldwide.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🎯</span>
          <span class="fact-content">
            <strong>PHP Object Injection:</strong> WordPress, Drupal, Joomla have all had object injection bugs. 
            Unserialize() is so dangerous it should probably be removed from PHP!
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🛡️</span>
          <span class="fact-content">
            <strong>The Fix is Simple:</strong> Use JSON, not native serialization! 
            JSON can only represent data, not code. Yet developers keep using dangerous formats.
          </span>
        </div>
      </div>
    `,
    prototype_pollution: `
      <div class="explain-box">
        <h3>🎯 What is Prototype Pollution?</h3>
        <div class="explain-simple">
          <p><strong>In Simple Words:</strong> In JavaScript, all objects share a "template" (prototype). 
          Imagine every house in a city sharing the same blueprint. If someone poisons the blueprint 
          to add "trap door in basement," every house suddenly has that trap door!</p>
          <div class="explain-example">
            <strong>Real-World Example:</strong> A user submits JSON with "__proto__.isAdmin = true". 
            Now EVERY object in the system has isAdmin = true! Authentication bypassed for everyone.
          </div>
        </div>
      </div>
      <div class="tips-box">
        <h3>💡 Prototypes - Use For Good</h3>
        <div class="tip">
          <div class="tip-title">🔧 Polyfills</div>
          <div class="tip-content">
            Prototypes let you add Array.includes() to old browsers! Babel, core-js use 
            prototype extension to bring modern JS to legacy environments.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🎨 Method Chaining</div>
          <div class="tip-content">
            jQuery's $().hide().show().animate() - all prototype methods! 
            Build fluent APIs that read like natural language.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🧪 Test Mocking</div>
          <div class="tip-content">
            Override console.log, Date.now(), Math.random() for testing! 
            Prototype manipulation enables powerful test utilities.
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Prototype Pollution Shockers</h3>
        <div class="fact">
          <span class="fact-emoji">📦</span>
          <span class="fact-content">
            <strong>Lodash Had It:</strong> The most downloaded npm package (50M/week) 
            had prototype pollution bugs! CVE-2019-10744 affected millions of projects.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🔗</span>
          <span class="fact-content">
            <strong>jQuery Too:</strong> jQuery.extend() could be exploited until v3.4.0. 
            Billions of websites were potentially vulnerable for years!
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🛡️</span>
          <span class="fact-content">
            <strong>Object.create(null):</strong> Creates an object with NO prototype at all! 
            This simple trick blocks all pollution attacks. Why isn't everyone using it?
          </span>
        </div>
      </div>
    `,
    introspection: `
      <div class="explain-box">
        <h3>🎯 What is Introspection?</h3>
        <div class="explain-simple">
          <p><strong>In Simple Words:</strong> Introspection is code looking at itself in a mirror. 
          It can see its own organs, understand its structure, even modify itself! 
          Like a robot that can open itself up and rewire its own circuits.</p>
          <div class="explain-example">
            <strong>Real-World Example:</strong> Python's dir() shows all attributes of any object. 
            An attacker can discover hidden functions, private variables, and find ways to exploit them.
          </div>
        </div>
      </div>
      <div class="tips-box">
        <h3>💡 Introspection - Use For Good</h3>
        <div class="tip">
          <div class="tip-title">🔍 IDE Autocomplete</div>
          <div class="tip-content">
            VS Code's IntelliSense, PyCharm's autocomplete - all use introspection! 
            Build developer tools that understand code at runtime.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🧪 Testing Frameworks</div>
          <div class="tip-content">
            pytest auto-discovers test functions, unittest finds test classes - introspection magic! 
            Build smart test runners that adapt to your code structure.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">📄 API Documentation</div>
          <div class="tip-content">
            Swagger, Sphinx, Javadoc - auto-generate docs from code! 
            Introspection extracts docstrings, type hints, and signatures automatically.
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Introspection Mind-Blowers</h3>
        <div class="fact">
          <span class="fact-emoji">🐍</span>
          <span class="fact-content">
            <strong>Python's Everything is Public:</strong> Python has no real private members - 
            _name is just a convention! __name uses name mangling but can still be accessed.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">☕</span>
          <span class="fact-content">
            <strong>Java Reflection Breaks Encapsulation:</strong> setAccessible(true) can access 
            ANY private field! The JVM's security is based on trust, not enforcement.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🦀</span>
          <span class="fact-content">
            <strong>Rust Limits Reflection:</strong> Rust intentionally has minimal reflection 
            to prevent entire classes of bugs. Compile-time safety over runtime flexibility!
          </span>
        </div>
      </div>
    `,
    reflection: `
      <div class="explain-box">
        <h3>🎯 What is Reflection?</h3>
        <div class="explain-simple">
          <p><strong>In Simple Words:</strong> Reflection is calling someone you've never met 
          using just their phone number. You can call any function if you know its name - even private ones! 
          It's like having a master key to every lock in the building.</p>
          <div class="explain-example">
            <strong>Real-World Example:</strong> Java's Class.forName(userInput).newInstance() - 
            user controls which class gets loaded! Attackers inject classes that execute shell commands.
          </div>
        </div>
      </div>
      <div class="tips-box">
        <h3>💡 Reflection - Use For Good</h3>
        <div class="tip">
          <div class="tip-title">🔌 Plugin Systems</div>
          <div class="tip-content">
            VS Code extensions, Minecraft mods, Webpack plugins - all use reflection to load code dynamically! 
            Build extensible applications that users can customize.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🎯 Dependency Injection</div>
          <div class="tip-content">
            Spring, Angular, NestJS - inject dependencies at runtime using reflection! 
            Build loosely-coupled, testable applications.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">📦 ORM Mapping</div>
          <div class="tip-content">
            Hibernate, SQLAlchemy, TypeORM - map database rows to objects automatically! 
            Reflection inspects classes to generate SQL queries.
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Reflection Revelations</h3>
        <div class="fact">
          <span class="fact-emoji">⚡</span>
          <span class="fact-content">
            <strong>Java Serialization Uses Reflection:</strong> When you deserialize an object, 
            Java uses reflection to call constructors and set fields. This is why deserialization is dangerous!
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🔧</span>
          <span class="fact-content">
            <strong>Spring is 90% Reflection:</strong> The entire Spring Framework is built on reflection. 
            @Autowired, @Controller, @Service - all discovered and wired via reflection!
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🏎️</span>
          <span class="fact-content">
            <strong>MethodHandles are Faster:</strong> Java 7+ introduced MethodHandles as a faster 
            alternative to reflection. 10x faster method invocation!
          </span>
        </div>
      </div>
    `,
    memory_access: `
      <div class="explain-box">
        <h3>🎯 What is Memory Access?</h3>
        <div class="explain-simple">
          <p><strong>In Simple Words:</strong> Computer memory is like a giant spreadsheet where programs 
          store their data. Memory access attacks are like reading someone else's rows in the spreadsheet - 
          you might find passwords, encryption keys, or private data!</p>
          <div class="explain-example">
            <strong>Real-World Example:</strong> Heartbleed bug (2014) let attackers read random chunks of 
            server memory - including passwords and private keys of millions of sites!
          </div>
        </div>
      </div>
      <div class="tips-box">
        <h3>💡 Memory Management - Use For Good</h3>
        <div class="tip">
          <div class="tip-title">🎮 Game Development</div>
          <div class="tip-content">
            Game engines manipulate memory directly for performance! Entity Component Systems, 
            object pools, and custom allocators - build games that run at 60+ FPS.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">📊 High-Performance Computing</div>
          <div class="tip-content">
            NumPy, TensorFlow operate on memory directly for speed. Build scientific computing 
            applications that process data millions of times faster than pure Python.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🔧 Systems Programming</div>
          <div class="tip-content">
            Operating systems, drivers, embedded systems - all require direct memory control. 
            Learn Rust for safe systems programming!
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Memory Mysteries</h3>
        <div class="fact">
          <span class="fact-emoji">❄️</span>
          <span class="fact-content">
            <strong>Cold Boot Attack:</strong> RAM keeps data for seconds after power-off! 
            Freeze the RAM with compressed air and extract encryption keys. Physical access = game over.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🔬</span>
          <span class="fact-content">
            <strong>Rowhammer:</strong> Rapidly reading memory rows can flip bits in adjacent rows! 
            Hardware bug exploitable via software. Your RAM is betraying you.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🦀</span>
          <span class="fact-content">
            <strong>Rust Prevents 70% of Bugs:</strong> Microsoft found 70% of their CVEs are memory safety issues. 
            Rust eliminates these at compile time. The future is memory-safe!
          </span>
        </div>
      </div>
    `,
    encoding_bypass: `
      <div class="explain-box">
        <h3>🎯 What is Encoding Bypass?</h3>
        <div class="explain-simple">
          <p><strong>In Simple Words:</strong> Security filters are like bouncers checking IDs. 
          Encoding bypass is wearing a disguise - same person, different appearance! 
          "password" might be blocked, but "%70%61%73%73%77%6F%72%64" (URL-encoded) sneaks through!</p>
          <div class="explain-example">
            <strong>Real-World Example:</strong> A firewall blocks "SELECT * FROM users" but allows 
            "SEL%45CT * FROM users" (URL-encoded 'E'). Same attack, different costume!
          </div>
        </div>
      </div>
      <div class="tips-box">
        <h3>💡 Encoding - Use For Good</h3>
        <div class="tip">
          <div class="tip-title">🌍 Internationalization</div>
          <div class="tip-content">
            UTF-8 encoding lets you build apps for all languages - Chinese, Arabic, Emoji! 
            Build truly global applications that speak every language.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">📸 Data URLs</div>
          <div class="tip-content">
            Embed images directly in HTML as base64! Build single-file web apps, 
            email signatures with images, or offline-first PWAs.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🔐 Secure Tokens</div>
          <div class="tip-content">
            JWTs, session tokens, API keys - all use base64 encoding! Understand encoding 
            to build authentication systems properly.
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Encoding Enigmas</h3>
        <div class="fact">
          <span class="fact-emoji">📧</span>
          <span class="fact-content">
            <strong>Email Still Uses 7-bit:</strong> Email was designed for 7-bit ASCII! 
            That's why attachments are base64 - increasing file size by 33%. Thanks, 1970s!
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🎭</span>
          <span class="fact-content">
            <strong>Unicode Homographs:</strong> аррӏе.com looks like apple.com but uses Cyrillic letters! 
            Browsers now show "xn--" for suspicious domains. Punycode is both solution and problem.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">😀</span>
          <span class="fact-content">
            <strong>Emoji Are 4 Bytes:</strong> A single emoji can be up to 28 bytes (family with skin tones)! 
            That "max 140 chars" tweet might only fit 35 emojis.
          </span>
        </div>
      </div>
    `,
    global_access: `
      <div class="explain-box">
        <h3>🎯 What is Global Access?</h3>
        <div class="explain-simple">
          <p><strong>In Simple Words:</strong> Global variables are like public bulletin boards in a shared office. 
          Anyone can read them, anyone can write to them. Useful for announcements, 
          dangerous if someone posts malicious instructions that everyone follows!</p>
          <div class="explain-example">
            <strong>Real-World Example:</strong> JavaScript's window object exposes EVERYTHING. 
            A malicious script can override window.fetch to intercept all network requests!
          </div>
        </div>
      </div>
      <div class="tips-box">
        <h3>💡 Globals - Use For Good</h3>
        <div class="tip">
          <div class="tip-title">📊 Application State</div>
          <div class="tip-content">
            Redux, Vuex, MobX - global state management done right! Build apps where state 
            is predictable, debuggable, and time-travel capable.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🎨 Theme/Config Systems</div>
          <div class="tip-content">
            CSS custom properties, React Context, environment variables - global config patterns! 
            Build apps that adapt to user preferences instantly.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">📝 Logging & Analytics</div>
          <div class="tip-content">
            Global loggers (Winston, Bunyan) and analytics (Google Analytics) need global access! 
            Build observability systems that track app behavior.
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Global Gotchas</h3>
        <div class="fact">
          <span class="fact-emoji">🌐</span>
          <span class="fact-content">
            <strong>window.name Leaks:</strong> window.name persists across navigations! 
            You could load evil.com, set window.name, navigate to bank.com, and bank sees the data!
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">📦</span>
          <span class="fact-content">
            <strong>npm Supply Chain:</strong> Any npm package can access globals! 
            This is how event-stream malware stole Bitcoin wallets in 2018.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🔒</span>
          <span class="fact-content">
            <strong>Object.freeze() is Shallow:</strong> You can freeze window but not its nested objects! 
            window.Object.prototype is still mutable even after freezing window.
          </span>
        </div>
      </div>
    `,
    timer_abuse: `
      <div class="explain-box">
        <h3>🎯 What is Timer Abuse?</h3>
        <div class="explain-simple">
          <p><strong>In Simple Words:</strong> Timers are like alarm clocks for code - "run this in 5 seconds." 
          But what if you set 1 million alarms per second? The whole system slows to a crawl! 
          Or use timing to guess secrets by measuring response speed.</p>
          <div class="explain-example">
            <strong>Real-World Example:</strong> Timing attacks can guess passwords! If checking "aaaaa" 
            takes 1ms but "passw" takes 2ms (more characters matched), attackers can brute-force faster.
          </div>
        </div>
      </div>
      <div class="tips-box">
        <h3>💡 Timers - Use For Good</h3>
        <div class="tip">
          <div class="tip-title">🎮 Animation & Games</div>
          <div class="tip-content">
            requestAnimationFrame, game loops, physics engines - all timer-based! 
            Build smooth 60fps animations and interactive experiences.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">📊 Debouncing & Throttling</div>
          <div class="tip-content">
            Prevent expensive operations from running too often! Search-as-you-type, 
            scroll handlers, resize listeners - timers make UX smooth.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">⏰ Scheduling Systems</div>
          <div class="tip-content">
            Cron jobs, task schedulers, reminder apps - timer fundamentals! 
            Build systems that act on schedule.
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Timing Terrors</h3>
        <div class="fact">
          <span class="fact-emoji">🔬</span>
          <span class="fact-content">
            <strong>Spectre Used Timers:</strong> The Spectre CPU vulnerability used high-resolution timers 
            to read protected memory! Browsers reduced timer precision from 5μs to 1ms because of this.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">💰</span>
          <span class="fact-content">
            <strong>HFT Nanoseconds:</strong> High-frequency traders pay millions for nanosecond advantages! 
            Being 1 microsecond faster = billions in profits. Time literally is money.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🎯</span>
          <span class="fact-content">
            <strong>setImmediate vs setTimeout(0):</strong> They're NOT the same! 
            setImmediate runs after I/O, setTimeout after the minimum delay. Order matters!
          </span>
        </div>
      </div>
    `,
    async_exploits: `
      <div class="explain-box">
        <h3>🎯 What are Async Exploits?</h3>
        <div class="explain-simple">
          <p><strong>In Simple Words:</strong> Async code is like ordering food at a busy restaurant. 
          You order (start async task), wait (other code runs), get food (callback fires). 
          Race conditions happen when two orders get mixed up - you get someone else's food (data)!</p>
          <div class="explain-example">
            <strong>Real-World Example:</strong> Check user balance → User withdraws simultaneously → 
            Both checks pass → Both withdrawals succeed → Bank loses money! Classic race condition.
          </div>
        </div>
      </div>
      <div class="tips-box">
        <h3>💡 Async - Use For Good</h3>
        <div class="tip">
          <div class="tip-title">⚡ High-Performance Servers</div>
          <div class="tip-content">
            Node.js handles 1M+ concurrent connections with async I/O! Build servers 
            that scale to millions of users without millions of threads.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🔄 Parallel Processing</div>
          <div class="tip-content">
            Promise.all(), asyncio.gather() - run tasks in parallel! Process thousands 
            of API calls, file operations, or database queries simultaneously.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">📱 Responsive UIs</div>
          <div class="tip-content">
            Never block the main thread! Async code keeps apps responsive while 
            loading data. Build apps that feel instant.
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Async Anomalies</h3>
        <div class="fact">
          <span class="fact-emoji">🌀</span>
          <span class="fact-content">
            <strong>Callback Hell Was Real:</strong> Before Promises, JavaScript had 10+ levels of nested callbacks! 
            async/await was so game-changing it got added to Python, C#, Rust, and Swift.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">⚛️</span>
          <span class="fact-content">
            <strong>Atomics Save the Day:</strong> JavaScript's SharedArrayBuffer + Atomics enable 
            safe multi-threaded programming! Lock-free data structures in the browser.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🐘</span>
          <span class="fact-content">
            <strong>PostgreSQL ACID:</strong> Database transactions use locks to prevent race conditions. 
            BEGIN, COMMIT, ROLLBACK - your bank account is safe because of these!
          </span>
        </div>
      </div>
    `,
    dangerous_modules: `
      <div class="explain-box">
        <h3>🎯 What are Dangerous Modules?</h3>
        <div class="explain-simple">
          <p><strong>In Simple Words:</strong> Modules are like power tools in a workshop. 
          A hammer is safe, but a chainsaw needs training! Some modules (os, subprocess, eval) 
          give full system access - perfectly safe for experts, dangerous for untrusted code.</p>
          <div class="explain-example">
            <strong>Real-World Example:</strong> Python's pickle module can execute arbitrary code when loading data! 
            A pickle file is not just data - it's a program in disguise.
          </div>
        </div>
      </div>
      <div class="tips-box">
        <h3>💡 Powerful Modules - Use For Good</h3>
        <div class="tip">
          <div class="tip-title">🤖 Automation Bots</div>
          <div class="tip-content">
            os, subprocess, shutil - automate EVERYTHING! Backup scripts, deployment bots, 
            system maintenance tools. The sysadmin's best friends.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">🔧 Development Tools</div>
          <div class="tip-content">
            Build your own linters, formatters, scaffolding tools! Read code, analyze it, 
            transform it, write it back. Meta-programming magic.
          </div>
        </div>
        <div class="tip">
          <div class="tip-title">📊 System Monitoring</div>
          <div class="tip-content">
            psutil, os.statvfs, platform - build monitoring dashboards! Track CPU, memory, 
            disk usage. Build your own htop or Activity Monitor.
          </div>
        </div>
      </div>
      <div class="mindblown-box">
        <h3>🤯 Module Mysteries</h3>
        <div class="fact">
          <span class="fact-emoji">🐍</span>
          <span class="fact-content">
            <strong>Python's import is Turing-Complete:</strong> import statements can run arbitrary code! 
            __import__("os").system("rm -rf /") is valid Python. Import is not safe.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">📦</span>
          <span class="fact-content">
            <strong>npm postinstall Scripts:</strong> Installing a package can run ANY code! 
            This is how eslint-scope malware stole npm tokens in 2018.
          </span>
        </div>
        <div class="fact">
          <span class="fact-emoji">🛡️</span>
          <span class="fact-content">
            <strong>Deno's Permission Model:</strong> Deno requires --allow-read, --allow-net, etc. 
            First runtime to make module permissions explicit. The future of secure imports!
          </span>
        </div>
      </div>
    `,
  };
  return tips[category] || '';
}

function generateEducationalContent(languages) {
  // Generate language-specific sections
  let langSectionsHTML = '';
  let isFirst = true;
  
  for (const lang of languages) {
    const activeClass = isFirst ? ' active' : '';
    isFirst = false;
    
    langSectionsHTML += `
    <div class="edu-lang-section${activeClass}" data-edu-lang="${lang}">
      <div class="edu-lang-header">
        <span class="edu-lang-icon">${getLanguageIcon(lang)}</span>
        <h2>${lang.toUpperCase()} - Use For Good</h2>
      </div>
      ${getLanguageTips(lang)}
    </div>`;
  }
  
  // Overview section (general content)
  const overviewHTML = `
    <div class="edu-lang-section" data-edu-lang="overview">
      <div class="edu-section">
        <h2>🎯 Why Learn About Security Vulnerabilities?</h2>
        <p style="color: #94a3b8; font-size: 1.1rem; line-height: 1.8; margin-bottom: 1.5rem;">
          Understanding how attacks work makes you a <strong style="color: #a5b4fc;">better developer</strong>. 
          The same techniques hackers use to break systems can be channeled into building 
          <strong style="color: #4ade80;">powerful, legitimate tools</strong>. 
          This knowledge helps you write more secure code, build better architectures, and create amazing developer tools.
        </p>
        
        <div class="edu-grid">
          <div class="edu-card">
            <h3>🔧 DevOps & Automation</h3>
            <p>
              The <code>child_process</code> and <code>subprocess</code> modules that enable RCE attacks 
              also power every CI/CD pipeline in existence! GitHub Actions, Jenkins, Docker - they all execute commands.
            </p>
            <div class="good-use">
              <h4>✨ Build This:</h4>
              <p>Create your own deployment tool that git pulls, runs tests, and deploys to production with a single command.</p>
            </div>
          </div>
          
          <div class="edu-card">
            <h3>🌐 Real-Time Applications</h3>
            <p>
              Network sockets that attackers use for backdoors power amazing real-time apps!
              WebSockets, game servers, chat applications, live dashboards.
            </p>
            <div class="good-use">
              <h4>✨ Build This:</h4>
              <p>A collaborative whiteboard or multiplayer game using WebSockets - same technology, creative purpose!</p>
            </div>
          </div>
          
          <div class="edu-card">
            <h3>📊 Data Processing</h3>
            <p>
              File system access enables both data theft AND powerful ETL pipelines!
              Process logs, transform data, generate reports, analyze codebases.
            </p>
            <div class="good-use">
              <h4>✨ Build This:</h4>
              <p>A log analyzer that parses nginx logs and generates beautiful usage dashboards.</p>
            </div>
          </div>
          
          <div class="edu-card">
            <h3>🧪 Testing Frameworks</h3>
            <p>
              Reflection and introspection - the tools of deserialization attacks - power every testing framework!
              JUnit, Jest, pytest all inspect and manipulate code dynamically.
            </p>
            <div class="good-use">
              <h4>✨ Build This:</h4>
              <p>Your own test runner that auto-discovers tests, mocks dependencies, and generates coverage reports.</p>
            </div>
          </div>
          
          <div class="edu-card">
            <h3>🎓 Educational Platforms</h3>
            <p>
              Code execution (sandboxed!) enables platforms like this one, LeetCode, Replit, CodePen.
              Millions learn to code through safe code execution environments.
            </p>
            <div class="good-use">
              <h4>✨ Build This:</h4>
              <p>An interactive coding tutorial that runs examples in real-time as users learn.</p>
            </div>
          </div>
          
          <div class="edu-card">
            <h3>🤖 AI & ML Pipelines</h3>
            <p>
              Dynamic code generation powers no-code tools, AI assistants, and ML pipelines.
              GitHub Copilot suggestions, Jupyter notebooks, data science workflows.
            </p>
            <div class="good-use">
              <h4>✨ Build This:</h4>
              <p>A natural language to SQL converter that safely generates and runs database queries.</p>
            </div>
          </div>
        </div>
      </div>
      
      <div class="edu-section">
        <h2>🤯 Mind-Blowing Cross-Language Facts</h2>
        <div class="edu-grid">
          <div class="edu-card" style="border-left: 4px solid #f472b6;">
            <h3>🌐 Every Language Can Be a Server</h3>
            <p>
              <strong>PHP Socket Servers:</strong> Despite PHP being "not designed" for long-running processes, 
              Swoole and ReactPHP let you build WebSocket servers handling 100k+ connections!
              <br><br>
              <strong>Java in the Browser:</strong> GraalJS lets you run JavaScript inside Java, and TeaVM compiles Java to WebAssembly!
              <br><br>
              <strong>Python for Everything:</strong> From AI (PyTorch) to desktop apps (PyQt) to mobile (Kivy) - one language, infinite possibilities.
            </p>
          </div>
          
          <div class="edu-card" style="border-left: 4px solid #a78bfa;">
            <h3>⚡ Performance Surprises</h3>
            <p>
              <strong>JavaScript vs C++:</strong> Modern V8 JIT compilation can make JS code as fast as C++ in many scenarios!
              <br><br>
              <strong>PHP 8 Revolution:</strong> JIT compilation made PHP 3x faster for computation-heavy tasks. It's not the slow language you remember!
              <br><br>
              <strong>Python Numba:</strong> Add <code>@jit</code> decorator and your Python code compiles to machine code, running 100x faster!
            </p>
          </div>
          
          <div class="edu-card" style="border-left: 4px solid #4ade80;">
            <h3>🔄 Languages Learning From Each Other</h3>
            <p>
              <strong>Async/Await:</strong> Started in C#, now in JavaScript, Python, Rust, Swift - everyone adopted it!
              <br><br>
              <strong>Type Systems:</strong> TypeScript inspired Python's type hints, and Flow. Static typing is spreading!
              <br><br>
              <strong>Pattern Matching:</strong> From ML/Haskell to Python 3.10's match, Java's switch expressions, and JavaScript's TC39 proposals.
            </p>
          </div>
        </div>
      </div>
      
      <div class="edu-section">
        <h2>🛡️ Security Best Practices Cheat Sheet</h2>
        <div class="edu-grid">
          <div class="edu-card">
            <h3>🔐 Input Validation</h3>
            <p>
              <strong>Never trust user input.</strong> Validate on both client AND server.
              Use allowlists over blocklists. Sanitize for the context (HTML, SQL, shell).
            </p>
            <code style="display: block; margin-top: 0.5rem; padding: 0.5rem; background: rgba(0,0,0,0.3); border-radius: 0.25rem;">
              const sanitized = input.replace(/[^a-zA-Z0-9]/g, '');
            </code>
          </div>
          
          <div class="edu-card">
            <h3>🔒 Least Privilege</h3>
            <p>
              Give code only the permissions it needs. Run containers as non-root.
              Use separate database users for read vs write operations.
            </p>
            <code style="display: block; margin-top: 0.5rem; padding: 0.5rem; background: rgba(0,0,0,0.3); border-radius: 0.25rem;">
              DROP USER IF EXISTS readonly; CREATE USER readonly WITH PASSWORD 'xxx';
            </code>
          </div>
          
          <div class="edu-card">
            <h3>📝 Secure Defaults</h3>
            <p>
              Don't rely on users to configure security. Make the default secure.
              Disable dangerous functions, require authentication, encrypt by default.
            </p>
            <code style="display: block; margin-top: 0.5rem; padding: 0.5rem; background: rgba(0,0,0,0.3); border-radius: 0.25rem;">
              disable_functions = exec, system, shell_exec
            </code>
          </div>
          
          <div class="edu-card">
            <h3>🔍 Defense in Depth</h3>
            <p>
              Multiple layers of security! Firewall + WAF + input validation + parameterized queries + encryption + monitoring.
              If one fails, others protect you.
            </p>
          </div>
        </div>
      </div>
    </div>`;

  return `
    <div class="edu-content">
      ${langSectionsHTML}
      ${overviewHTML}
    </div>
  `;
}

// Run the tests
runSecurityTests();
