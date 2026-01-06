/**
 * Security Test Suite - Main Entry Point
 * 
 * Run: node security/run.mjs
 * Or:  node security/run.mjs --server=http://localhost:3001
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { CONFIG, colors, log } from './config.mjs';
import { 
  createResultsTracker, 
  runAllTests, 
  printSummary, 
  generateStatistics 
} from './runner/index.mjs';
import { generateEnglishReport, generateHebrewReport } from './templates/report.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Generate and save all reports
 */
async function generateReports(results) {
  const duration = ((Date.now() - results.startTime) / 1000).toFixed(2);
  const total = results.passed + results.failed;
  const passRate = total > 0 ? ((results.passed / total) * 100).toFixed(1) + '%' : '0%';
  
  // Create report data
  const now = new Date();
  const datePrefix = now.toISOString().split('T')[0];
  const timeStamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -1) + 'Z';
  
  const reportData = {
    timestamp: now.toISOString(),
    summary: {
      total,
      passed: results.passed,
      failed: results.failed,
      passRate,
      duration: `${duration}s`,
    },
    statistics: generateStatistics(results),
    tests: results.tests,
    vulnerabilities: results.tests.filter(t => !t.passed && t.expectBlocked),
  };
  
  // Ensure reports directory exists
  await fs.mkdir(CONFIG.reportDir, { recursive: true });
  
  // File names
  const jsonFileName = `${datePrefix}_security-report_${timeStamp}.json`;
  const htmlFileName = `${datePrefix}_security-report_${timeStamp}.html`;
  const hebrewHtmlFileName = `${datePrefix}_security-report_${timeStamp}_he.html`;
  
  // Save JSON
  await fs.writeFile(
    path.join(CONFIG.reportDir, jsonFileName),
    JSON.stringify(reportData, null, 2)
  );
  
  // Save English HTML
  const htmlReport = generateEnglishReport(reportData);
  await fs.writeFile(
    path.join(CONFIG.reportDir, htmlFileName),
    htmlReport
  );
  
  // Save Hebrew HTML
  const hebrewReport = generateHebrewReport(reportData);
  await fs.writeFile(
    path.join(CONFIG.reportDir, hebrewHtmlFileName),
    hebrewReport
  );
  
  // Save latest versions for easy access
  await fs.writeFile(
    path.join(CONFIG.reportDir, 'security-report-latest.json'),
    JSON.stringify(reportData, null, 2)
  );
  await fs.writeFile(
    path.join(CONFIG.reportDir, 'security-report-latest.html'),
    htmlReport
  );
  await fs.writeFile(
    path.join(CONFIG.reportDir, 'security-report-latest-he.html'),
    hebrewReport
  );
  
  log(colors.green, `\n📄 Reports saved:`);
  log(colors.dim, `   ${jsonFileName}`);
  log(colors.dim, `   ${htmlFileName}`);
  log(colors.dim, `   ${hebrewHtmlFileName} (עברית)`);
  
  return { jsonFileName, htmlFileName, hebrewHtmlFileName };
}

/**
 * Main function
 */
async function main() {
  const results = createResultsTracker();
  
  try {
    // Run all tests
    await runAllTests(results);
    
    // Print summary
    printSummary(results);
    
    // Generate reports
    await generateReports(results);
    
    // Exit with appropriate code
    process.exit(results.failed > 0 ? 1 : 0);
    
  } catch (error) {
    log(colors.red, `\n❌ Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run
main();
