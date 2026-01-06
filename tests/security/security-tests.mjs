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
  for (const test of data.tests) {
    if (!byLanguage[test.language]) byLanguage[test.language] = {};
    if (!byLanguage[test.language][test.category]) byLanguage[test.language][test.category] = [];
    byLanguage[test.language][test.category].push(test);
  }
  
  // Generate test sections with explanations
  let testsHTML = '';
  for (const [language, categories] of Object.entries(byLanguage)) {
    const langStats = data.statistics.byLanguage[language];
    const langPassRate = ((langStats.passed / langStats.total) * 100).toFixed(0);
    
    testsHTML += `<div class="language-section">
      <div class="language-header">
        <h2>${getLanguageIcon(language)} ${language.toUpperCase()}</h2>
        <span class="lang-stats">${langStats.passed}/${langStats.total} tests (${langPassRate}%)</span>
      </div>`;
    
    for (const [category, tests] of Object.entries(categories)) {
      const categoryPassed = tests.filter(t => t.passed).length;
      const categoryTotal = tests.length;
      const categoryIcon = getCategoryIcon(category);
      
      testsHTML += `<div class="category">
        <h3>${categoryIcon} ${formatCategoryName(category)} (${categoryPassed}/${categoryTotal})</h3>
        <div class="tests-grid">`;
      
      for (const test of tests) {
        const statusClass = test.passed ? 'pass' : 'fail';
        const statusIcon = test.passed ? '✓' : '✗';
        const explanation = test.explanation ? formatExplanation(test.explanation) : '';
        
        testsHTML += `
        <div class="test-card ${statusClass}">
          <div class="test-header">
            <span class="test-status">${statusIcon}</span>
            <span class="test-name">${escapeHtml(test.name)}</span>
            <span class="test-duration">${test.duration}ms</span>
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
            <summary>View Code</summary>
            <pre><code>${escapeHtml(test.code)}</code></pre>
          </details>
        </div>`;
      }
      
      testsHTML += `</div></div>`;
    }
    
    testsHTML += `</div>`;
  }
  
  // Category statistics
  let categoryStatsHTML = '';
  for (const [category, stats] of Object.entries(data.statistics.byCategory)) {
    const catPassRate = ((stats.passed / stats.total) * 100).toFixed(0);
    const barColor = catPassRate == 100 ? '#22c55e' : catPassRate >= 90 ? '#eab308' : '#ef4444';
    categoryStatsHTML += `
      <div class="cat-stat">
        <span class="cat-name">${getCategoryIcon(category)} ${formatCategoryName(category)}</span>
        <div class="cat-bar">
          <div class="cat-bar-fill" style="width: ${catPassRate}%; background: ${barColor}"></div>
        </div>
        <span class="cat-value">${stats.passed}/${stats.total}</span>
      </div>`;
  }
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Test Report - Browser Coder</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background: #0f172a; 
      color: #e2e8f0; 
      line-height: 1.6; 
      padding: 2rem; 
    }
    .container { max-width: 1400px; margin: 0 auto; }
    
    /* Header */
    .header { 
      text-align: center; 
      margin-bottom: 2rem; 
      padding: 2.5rem; 
      background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%); 
      border-radius: 1rem; 
      border: 1px solid #334155; 
    }
    .header h1 { font-size: 2.5rem; margin-bottom: 0.5rem; color: #f8fafc; }
    .header .subtitle { color: #94a3b8; font-size: 1.1rem; margin-bottom: 1rem; }
    .timestamp { color: #64748b; font-size: 0.875rem; }
    
    /* Summary Cards */
    .summary { 
      display: grid; 
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); 
      gap: 1rem; 
      margin: 2rem 0; 
    }
    .stat { 
      background: #1e293b; 
      padding: 1.5rem; 
      border-radius: 0.75rem; 
      text-align: center; 
      border: 1px solid #334155;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .stat:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
    .stat-value { font-size: 2.5rem; font-weight: bold; }
    .stat-label { color: #94a3b8; font-size: 0.875rem; margin-top: 0.5rem; }
    .pass .stat-value { color: #22c55e; }
    .fail .stat-value { color: #ef4444; }
    .total .stat-value { color: #60a5fa; }
    .rate .stat-value { color: ${statusColor}; }
    
    /* Category Stats */
    .category-stats {
      background: #1e293b;
      border-radius: 0.75rem;
      padding: 1.5rem;
      margin: 2rem 0;
      border: 1px solid #334155;
    }
    .category-stats h3 { margin-bottom: 1rem; color: #f8fafc; }
    .cat-stat { display: flex; align-items: center; margin: 0.5rem 0; gap: 1rem; }
    .cat-name { width: 200px; font-size: 0.9rem; color: #94a3b8; }
    .cat-bar { flex: 1; height: 8px; background: #334155; border-radius: 4px; overflow: hidden; }
    .cat-bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s; }
    .cat-value { width: 60px; text-align: right; font-size: 0.85rem; color: #64748b; }
    
    /* Language Sections */
    .language-section { 
      margin: 2rem 0; 
      background: #1e293b; 
      border-radius: 0.75rem; 
      padding: 1.5rem; 
      border: 1px solid #334155; 
    }
    .language-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid #334155;
    }
    .language-header h2 { font-size: 1.5rem; color: #60a5fa; }
    .lang-stats { color: #94a3b8; font-size: 0.9rem; }
    
    /* Category */
    .category { margin: 1.5rem 0; }
    .category h3 { 
      font-size: 1.1rem; 
      margin-bottom: 1rem; 
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    /* Tests Grid */
    .tests-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 1rem;
    }
    
    /* Test Cards */
    .test-card {
      background: #0f172a;
      border-radius: 0.5rem;
      padding: 1rem;
      border: 1px solid #334155;
      transition: border-color 0.2s;
    }
    .test-card:hover { border-color: #475569; }
    .test-card.pass { border-left: 3px solid #22c55e; }
    .test-card.fail { border-left: 3px solid #ef4444; }
    
    .test-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .test-status { font-size: 1.2rem; }
    .test-card.pass .test-status { color: #22c55e; }
    .test-card.fail .test-status { color: #ef4444; }
    .test-name { flex: 1; font-weight: 500; font-size: 0.9rem; }
    .test-duration { color: #64748b; font-size: 0.8rem; }
    
    .test-result {
      display: flex;
      gap: 1rem;
      margin: 0.5rem 0;
      font-size: 0.8rem;
    }
    .expected { color: #94a3b8; }
    .actual { color: #64748b; }
    
    /* Explanation */
    .explanation {
      margin-top: 0.75rem;
      border-top: 1px solid #334155;
      padding-top: 0.75rem;
    }
    .explanation summary {
      cursor: pointer;
      color: #60a5fa;
      font-size: 0.85rem;
      user-select: none;
    }
    .explanation summary:hover { color: #93c5fd; }
    .explanation-content {
      margin-top: 0.75rem;
      padding: 1rem;
      background: rgba(30, 58, 95, 0.3);
      border-radius: 0.5rem;
      font-size: 0.85rem;
      line-height: 1.7;
    }
    .explanation-content strong { color: #f8fafc; }
    .explanation-content .attack-title {
      color: #f87171;
      font-weight: bold;
      font-size: 1rem;
      margin-bottom: 0.5rem;
    }
    .explanation-content .safe-title {
      color: #4ade80;
      font-weight: bold;
      font-size: 1rem;
      margin-bottom: 0.5rem;
    }
    .explanation-content p { margin: 0.5rem 0; }
    .explanation-content ul { margin: 0.5rem 0 0.5rem 1.5rem; }
    
    /* Code */
    .code-details {
      margin-top: 0.5rem;
    }
    .code-details summary {
      cursor: pointer;
      color: #64748b;
      font-size: 0.8rem;
      user-select: none;
    }
    .code-details pre {
      margin-top: 0.5rem;
      padding: 0.75rem;
      background: #020617;
      border-radius: 0.375rem;
      overflow-x: auto;
      font-size: 0.8rem;
    }
    .code-details code {
      color: #e2e8f0;
      font-family: 'Monaco', 'Menlo', monospace;
    }
    
    /* Vulnerabilities Alert */
    .vulnerabilities { 
      background: rgba(239, 68, 68, 0.1); 
      border: 1px solid #ef4444; 
      border-radius: 0.75rem; 
      padding: 1.5rem; 
      margin: 2rem 0; 
    }
    .vulnerabilities h2 { color: #ef4444; margin-bottom: 1rem; }
    .vuln-item { 
      padding: 0.75rem; 
      margin: 0.5rem 0; 
      background: rgba(0,0,0,0.2); 
      border-radius: 0.5rem; 
    }
    
    /* Success Banner */
    .success-banner {
      text-align: center;
      padding: 2rem;
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid #22c55e;
      border-radius: 0.75rem;
      margin: 2rem 0;
    }
    .success-banner h2 { color: #22c55e; margin-bottom: 0.5rem; }
    .success-banner p { color: #94a3b8; }
    
    /* Footer */
    .footer {
      text-align: center;
      padding: 2rem;
      color: #64748b;
      font-size: 0.85rem;
      margin-top: 2rem;
      border-top: 1px solid #334155;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔒 Security Test Report</h1>
      <p class="subtitle">Educational Edition - Learn how hackers exploit code execution vulnerabilities</p>
      <p class="timestamp">Generated: ${data.timestamp}</p>
      <p class="timestamp">Server: ${data.server}</p>
    </div>
    
    <div class="summary">
      <div class="stat total">
        <div class="stat-value">${data.summary.total}</div>
        <div class="stat-label">Total Tests</div>
      </div>
      <div class="stat pass">
        <div class="stat-value">${data.summary.passed}</div>
        <div class="stat-label">Passed</div>
      </div>
      <div class="stat fail">
        <div class="stat-value">${data.summary.failed}</div>
        <div class="stat-label">Failed</div>
      </div>
      <div class="stat rate">
        <div class="stat-value">${data.summary.passRate}</div>
        <div class="stat-label">Pass Rate</div>
      </div>
      <div class="stat">
        <div class="stat-value">${(data.summary.duration / 1000).toFixed(1)}s</div>
        <div class="stat-label">Duration</div>
      </div>
    </div>
    
    <div class="category-stats">
      <h3>📊 Attack Categories</h3>
      ${categoryStatsHTML}
    </div>
    
    ${data.vulnerabilities.length > 0 ? `
    <div class="vulnerabilities">
      <h2>⚠️ Security Vulnerabilities Detected</h2>
      <p style="color: #f87171; margin-bottom: 1rem;">The following attack vectors were NOT blocked:</p>
      ${data.vulnerabilities.map(v => `
        <div class="vuln-item">
          <strong>${escapeHtml(v.name)}</strong><br>
          <small>${escapeHtml(v.reason)}</small>
        </div>
      `).join('')}
    </div>
    ` : `
    <div class="success-banner">
      <h2>✅ All Security Tests Passed!</h2>
      <p>No vulnerabilities detected. The system is secure against all ${data.summary.total} tested attack vectors.</p>
    </div>
    `}
    
    ${testsHTML}
    
    <div class="footer">
      <p>Browser Coder Security Test Suite v2.0 - Educational Edition</p>
      <p>Tests organized in modular files: attacks/*.mjs for easy maintenance and scaling</p>
    </div>
  </div>
  
  <script>
    // Auto-expand failed tests
    document.querySelectorAll('.test-card.fail .explanation').forEach(el => el.open = true);
  </script>
</body>
</html>`;
}

// Utility functions
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

// Run the tests
runSecurityTests();
