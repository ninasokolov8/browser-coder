/**
 * Security Test Runner
 * Executes attack tests against the API and collects results
 */

import { CONFIG, colors, log } from '../config.mjs';

// Import attack vectors
import { javascriptTests } from '../attacks/javascript.mjs';
import { typescriptTests } from '../attacks/typescript.mjs';
import { pythonTests } from '../attacks/python.mjs';
import { phpTests } from '../attacks/php.mjs';
import { javaTests } from '../attacks/java.mjs';

// All security tests by language
export const SECURITY_TESTS = {
  javascript: javascriptTests,
  typescript: typescriptTests,
  python: pythonTests,
  php: phpTests,
  java: javaTests,
};

// Test result tracking
export function createResultsTracker() {
  return {
    passed: 0,
    failed: 0,
    errors: 0,
    tests: [],
    startTime: Date.now(),
    suite: 'security',
  };
}

/**
 * Execute code against the API
 */
export async function executeCode(language, code) {
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
    
    // Check if blocked by security filter
    const errorLower = (data.error || '').toLowerCase();
    const stderrLower = (data.stderr || '').toLowerCase();
    const combinedOutput = errorLower + stderrLower;
    
    const blockedPatterns = [
      'security', 'blocked', 'forbidden', 'not allowed', 'restricted',
      'dangerous', 'prohibited', 'access denied', 'rate limit',
      'malicious', 'unsafe', 'blacklist', 'denied'
    ];
    
    const isBlocked = blockedPatterns.some(p => combinedOutput.includes(p)) ||
      (data.error && !data.stdout && !data.stderr?.includes('error:'));
    
    return {
      blocked: isBlocked,
      executed: !isBlocked && (data.stdout || data.stderr) && !data.error,
      stdout: data.stdout || '',
      stderr: data.stderr || '',
      error: data.error || null,
      reason: isBlocked ? (data.error || 'Security filter') : null,
    };
  } catch (error) {
    return {
      blocked: false,
      executed: false,
      error: error.message,
      networkError: true,
    };
  }
}

/**
 * Run a single test
 */
export async function runTest(language, test, results) {
  const startTime = Date.now();
  
  try {
    const result = await executeCode(language, test.code);
    const duration = Date.now() - startTime;
    
    let passed;
    if (test.expectBlocked) {
      passed = result.blocked || result.httpError;
    } else {
      passed = result.executed && !result.blocked;
    }
    
    const testResult = {
      name: test.name,
      language,
      category: test.category,
      code: test.code,
      expectBlocked: test.expectBlocked,
      passed,
      blocked: result.blocked,
      executed: result.executed,
      duration,
      explanation: test.explanation || null,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error,
    };
    
    results.tests.push(testResult);
    
    if (passed) {
      results.passed++;
      log(colors.green, `  ✓ ${test.name} (${duration}ms)`);
    } else {
      results.failed++;
      log(colors.red, `  ✗ ${test.name} (${duration}ms)`);
      log(colors.dim, `    Expected: ${test.expectBlocked ? 'blocked' : 'executed'}`);
      log(colors.dim, `    Got: ${result.blocked ? 'blocked' : result.executed ? 'executed' : 'error'}`);
      if (result.error) log(colors.dim, `    Error: ${result.error}`);
    }
    
    return testResult;
  } catch (error) {
    results.errors++;
    log(colors.red, `  ⚠ ${test.name}: ${error.message}`);
    return { name: test.name, error: error.message, passed: false };
  }
}

/**
 * Run all security tests
 */
export async function runAllTests(results, onProgress = null) {
  log(colors.bold + colors.cyan, '\n═══════════════════════════════════════════════════════════════════════════════');
  log(colors.bold + colors.cyan, '            🔒 BROWSER CODER - SECURITY TEST SUITE');
  log(colors.bold + colors.cyan, '═══════════════════════════════════════════════════════════════════════════════\n');
  
  log(colors.dim, `Target: ${CONFIG.serverUrl}`);
  log(colors.dim, `Timestamp: ${new Date().toISOString()}\n`);
  
  // Wait for server
  log(colors.yellow, '⏳ Waiting for server...');
  let serverReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${CONFIG.serverUrl}/health`);
      if (res.ok) {
        serverReady = true;
        break;
      }
    } catch {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  if (!serverReady) {
    log(colors.red, '❌ Server not responding');
    process.exit(1);
  }
  log(colors.green, '✓ Server ready\n');
  
  // Run tests by language
  const languages = Object.keys(SECURITY_TESTS);
  const totalTests = languages.reduce((sum, lang) => sum + SECURITY_TESTS[lang].length, 0);
  let completed = 0;
  
  for (const language of languages) {
    const tests = SECURITY_TESTS[language];
    const langIcon = getLanguageIcon(language);
    
    log(colors.bold + colors.blue, `\n${langIcon} ${language.toUpperCase()} (${tests.length} tests)`);
    log(colors.dim, '─'.repeat(60));
    
    for (const test of tests) {
      await runTest(language, test, results);
      completed++;
      if (onProgress) onProgress(completed, totalTests);
    }
  }
  
  return results;
}

/**
 * Print test summary to console
 */
export function printSummary(results) {
  const duration = ((Date.now() - results.startTime) / 1000).toFixed(2);
  const total = results.passed + results.failed;
  const passRate = total > 0 ? ((results.passed / total) * 100).toFixed(1) : 0;
  
  log(colors.bold + colors.cyan, '\n═══════════════════════════════════════════════════════════════════════════════');
  log(colors.bold + colors.cyan, '                              📊 SUMMARY');
  log(colors.bold + colors.cyan, '═══════════════════════════════════════════════════════════════════════════════\n');
  
  log(colors.green, `  ✓ Passed:  ${results.passed}`);
  log(colors.red,   `  ✗ Failed:  ${results.failed}`);
  if (results.errors > 0) {
    log(colors.yellow, `  ⚠ Errors:  ${results.errors}`);
  }
  log(colors.blue, `  📈 Rate:   ${passRate}%`);
  log(colors.dim, `  ⏱ Time:   ${duration}s\n`);
  
  if (results.failed === 0) {
    log(colors.bold + colors.green, '  🎉 ALL SECURITY TESTS PASSED! The sandbox is secure.\n');
  } else {
    log(colors.bold + colors.red, '  ⚠️  SECURITY VULNERABILITIES DETECTED!\n');
    
    const vulns = results.tests.filter(t => !t.passed && t.expectBlocked);
    if (vulns.length > 0) {
      log(colors.yellow, '  Unblocked attacks:');
      for (const v of vulns) {
        log(colors.red, `    - [${v.language}] ${v.name}`);
      }
    }
  }
  
  log(colors.bold + colors.cyan, '═══════════════════════════════════════════════════════════════════════════════\n');
}

/**
 * Generate statistics from results
 */
export function generateStatistics(results) {
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

// Helper functions
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
