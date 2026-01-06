/**
 * HTML Report Template Styles
 * Shared CSS for all report templates
 */

export function getStyles(statusColor) {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
      min-height: 100vh;
      color: #e2e8f0; 
      line-height: 1.6; 
    }
    .container { max-width: 1600px; margin: 0 auto; padding: 2rem; }
    
    /* RTL Support - Hebrew text only, code stays LTR */
    [dir="rtl"] { direction: rtl; text-align: right; }
    
    /* Layout adjustments for RTL */
    [dir="rtl"] .intro-card { flex-direction: row-reverse; }
    [dir="rtl"] .intro-mini-card { flex-direction: row-reverse; }
    [dir="rtl"] .test-header { flex-direction: row-reverse; }
    [dir="rtl"] .test-meta { flex-direction: row-reverse; }
    [dir="rtl"] .test-result { flex-direction: row-reverse; }
    [dir="rtl"] .lang-header, [dir="rtl"] .cat-header { flex-direction: row-reverse; }
    [dir="rtl"] .lang-title, [dir="rtl"] .cat-title { flex-direction: row-reverse; }
    [dir="rtl"] .category-header { flex-direction: row-reverse; }
    [dir="rtl"] .educational-hero { flex-direction: row-reverse; }
    [dir="rtl"] .fact { flex-direction: row-reverse; }
    
    /* CRITICAL: Keep ALL code/programming content LTR */
    [dir="rtl"] pre,
    [dir="rtl"] code,
    [dir="rtl"] .code-details,
    [dir="rtl"] .code-details pre,
    [dir="rtl"] .code-details code,
    [dir="rtl"] .cheat-bad,
    [dir="rtl"] .cheat-good,
    [dir="rtl"] .cheat-item,
    [dir="rtl"] .cheat-grid {
      direction: ltr;
      text-align: left;
      unicode-bidi: isolate;
    }
    
    /* Keep inline code LTR but allow it to flow in RTL text */
    [dir="rtl"] .tip-content code,
    [dir="rtl"] .explanation-content code,
    [dir="rtl"] .fact-content code,
    [dir="rtl"] p code,
    [dir="rtl"] li code {
      direction: ltr;
      display: inline-block;
      unicode-bidi: embed;
    }
    
    /* Pro tips with code should be LTR */
    [dir="rtl"] .cheat-pro-tips li {
      direction: ltr;
      text-align: left;
      padding-left: 1.25rem;
      padding-right: 0;
    }
    [dir="rtl"] .cheat-pro-tips li::before {
      left: 0;
      right: auto;
      content: '→';
    }
    
    /* Keep cheatsheet boxes LTR - they contain code */
    [dir="rtl"] .cheatsheet-box {
      direction: ltr;
      text-align: left;
    }
    [dir="rtl"] .cheatsheet-box h3,
    [dir="rtl"] .cheatsheet-box h4 {
      direction: rtl;
      text-align: right;
    }
    
    /* Test cards - code should be LTR, descriptions RTL */
    [dir="rtl"] .test-card .test-name { direction: rtl; }
    [dir="rtl"] .test-card code { direction: ltr; unicode-bidi: embed; }
    
    /* Borders for RTL cards */
    [dir="rtl"] .test-card.pass { border-left: none; border-right: 4px solid #4ade80; }
    [dir="rtl"] .test-card.fail { border-left: none; border-right: 4px solid #f87171; }
    [dir="rtl"] .intro-highlight { border-left: none; border-right: 3px solid #6366f1; }
    
    /* Cheat cards in general section stay RTL (no code) */
    [dir="rtl"] .cheatsheet-section .cheat-card {
      direction: rtl;
      text-align: right;
    }
    [dir="rtl"] .cheatsheet-section .cheat-card li {
      padding-left: 0;
      padding-right: 1.5rem;
    }
    [dir="rtl"] .cheatsheet-section .cheat-card li::before {
      left: auto;
      right: 0.5rem;
    }

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
    .hero h1 { 
      font-size: 3rem; 
      margin-bottom: 0.75rem; 
      background: linear-gradient(135deg, #f8fafc 0%, #a5b4fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .hero .subtitle { color: #a5b4fc; font-size: 1.25rem; margin-bottom: 0.5rem; }
    .hero .tagline { color: #94a3b8; font-size: 1rem; font-style: italic; }
    .timestamp { color: #64748b; font-size: 0.875rem; margin-top: 1rem; }
    
    /* Intro Section */
    .intro-section {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.95));
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 1rem;
      padding: 2rem;
      margin-bottom: 2rem;
    }
    .intro-card { display: flex; gap: 1.5rem; margin-bottom: 1.5rem; }
    .intro-icon { font-size: 3rem; flex-shrink: 0; }
    .intro-content h2 { color: #e2e8f0; font-size: 1.5rem; margin: 0 0 1rem 0; }
    .intro-content p { color: #94a3b8; font-size: 1rem; line-height: 1.8; margin: 0 0 0.75rem 0; }
    .intro-content strong { color: #e2e8f0; }
    .intro-content em { color: #f87171; font-style: normal; }
    .intro-highlight {
      background: rgba(99, 102, 241, 0.15);
      border-left: 3px solid #6366f1;
      padding: 0.75rem 1rem;
      border-radius: 0.25rem;
      margin-top: 1rem !important;
    }
    .intro-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
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
    .intro-mini-text { color: #94a3b8; font-size: 0.9rem; line-height: 1.6; }
    .intro-mini-text strong { color: #a5b4fc; display: block; margin-bottom: 0.25rem; }
    .intro-cta {
      background: linear-gradient(135deg, rgba(74, 222, 128, 0.1), rgba(52, 211, 153, 0.05));
      border: 1px solid rgba(74, 222, 128, 0.3);
      border-radius: 0.75rem;
      padding: 1rem 1.25rem;
      text-align: center;
    }
    .intro-cta p { color: #6ee7b7; font-size: 1rem; margin: 0; }
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
      padding: 1.5rem; 
      border-radius: 1rem; 
      text-align: center; 
      border: 1px solid rgba(99, 102, 241, 0.2);
      transition: all 0.3s ease;
    }
    .stat-card:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(99, 102, 241, 0.2); }
    .stat-value { font-size: 2.5rem; font-weight: 700; }
    .stat-label { color: #94a3b8; font-size: 0.85rem; margin-top: 0.25rem; text-transform: uppercase; }
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
    .main-tabs { display: flex; background: rgba(15, 23, 42, 0.8); border-bottom: 1px solid rgba(99, 102, 241, 0.2); }
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
    .main-tab.active { background: rgba(99, 102, 241, 0.2); color: #a5b4fc; border-bottom: 2px solid #818cf8; }
    
    /* Language Tabs */
    .lang-tabs { display: flex; padding: 0.75rem; gap: 0.5rem; background: rgba(15, 23, 42, 0.5); border-bottom: 1px solid rgba(99, 102, 241, 0.1); flex-wrap: wrap; }
    .lang-tab { padding: 0.5rem 1rem; background: rgba(99, 102, 241, 0.1); border: none; border-radius: 0.5rem; color: #94a3b8; cursor: pointer; font-size: 0.9rem; transition: all 0.2s; display: flex; align-items: center; gap: 0.5rem; }
    .lang-tab:hover { background: rgba(99, 102, 241, 0.2); color: #e2e8f0; }
    .lang-tab.active { background: #6366f1; color: white; }
    
    /* Language Sections */
    .lang-section { display: none; padding: 1.5rem; }
    .lang-section.active { display: block; }
    .lang-header { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid rgba(99, 102, 241, 0.2); }
    .lang-title { display: flex; align-items: center; gap: 0.75rem; }
    .lang-icon { font-size: 2rem; }
    .lang-title h2 { font-size: 1.5rem; color: #e2e8f0; }
    .lang-stats { color: #94a3b8; font-size: 0.9rem; }
    .lang-bar { height: 6px; background: rgba(99, 102, 241, 0.2); border-radius: 3px; overflow: hidden; }
    .lang-bar-fill { height: 100%; border-radius: 3px; transition: width 0.5s ease; }
    
    /* Category Sections */
    .cat-section { display: none; padding: 1.5rem; }
    .cat-section.active { display: block; }
    .cat-header { margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid rgba(99, 102, 241, 0.2); }
    .cat-title { display: flex; align-items: center; gap: 0.75rem; }
    .cat-icon { font-size: 2rem; }
    .cat-title h2 { font-size: 1.5rem; color: #e2e8f0; }
    .cat-stats-badge { color: #94a3b8; font-size: 0.9rem; background: rgba(99, 102, 241, 0.2); padding: 0.25rem 0.75rem; border-radius: 1rem; }
    
    /* Category Tabs */
    .cat-tabs { display: flex; padding: 0.75rem; gap: 0.5rem; background: rgba(15, 23, 42, 0.5); border-bottom: 1px solid rgba(99, 102, 241, 0.1); flex-wrap: wrap; }
    .cat-tab { padding: 0.5rem 1rem; background: rgba(99, 102, 241, 0.1); border: none; border-radius: 0.5rem; color: #94a3b8; cursor: pointer; font-size: 0.9rem; transition: all 0.2s; display: flex; align-items: center; gap: 0.5rem; }
    .cat-tab:hover { background: rgba(99, 102, 241, 0.2); color: #e2e8f0; }
    .cat-tab.active { background: #8b5cf6; color: white; }
    
    /* Accordion */
    .categories-accordion { display: flex; flex-direction: column; gap: 0.75rem; }
    .category-section { background: rgba(15, 23, 42, 0.5); border-radius: 0.75rem; overflow: hidden; }
    .category-header { padding: 1rem 1.25rem; cursor: pointer; display: flex; justify-content: space-between; align-items: center; color: #e2e8f0; font-weight: 500; transition: background 0.2s; }
    .category-header:hover { background: rgba(99, 102, 241, 0.1); }
    .category-stats { color: #94a3b8; font-size: 0.85rem; background: rgba(99, 102, 241, 0.2); padding: 0.25rem 0.75rem; border-radius: 1rem; }
    
    /* Lang Groups */
    .lang-groups { display: flex; flex-direction: column; gap: 0.75rem; }
    .lang-group { background: rgba(15, 23, 42, 0.5); border-radius: 0.75rem; overflow: hidden; }
    .lang-group summary { padding: 1rem 1.25rem; cursor: pointer; color: #e2e8f0; font-weight: 500; }
    .lang-group summary:hover { background: rgba(99, 102, 241, 0.1); }
    
    /* Test Grid */
    .tests-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 1rem; padding: 1rem; }
    @media (max-width: 768px) { .tests-grid { grid-template-columns: 1fr; } }
    
    /* Test Card */
    .test-card { background: rgba(30, 41, 59, 0.8); border-radius: 0.75rem; padding: 1.25rem; border: 1px solid rgba(99, 102, 241, 0.2); transition: all 0.2s; }
    .test-card:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3); }
    .test-card.pass { border-left: 4px solid #4ade80; }
    .test-card.fail { border-left: 4px solid #f87171; }
    .test-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
    .test-status { font-size: 1.25rem; font-weight: 700; }
    .test-card.pass .test-status { color: #4ade80; }
    .test-card.fail .test-status { color: #f87171; }
    .test-name { flex: 1; font-weight: 500; color: #e2e8f0; }
    .test-duration { color: #64748b; font-size: 0.8rem; }
    .test-meta { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
    .test-badge { padding: 0.2rem 0.6rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: 500; }
    .lang-badge { background: rgba(99, 102, 241, 0.2); color: #a5b4fc; }
    .cat-badge { background: rgba(139, 92, 246, 0.2); color: #c4b5fd; }
    .test-result { display: flex; gap: 1rem; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.75rem; }
    
    /* Explanation */
    .explanation { margin-top: 0.75rem; }
    .explanation summary { cursor: pointer; color: #a5b4fc; font-size: 0.9rem; padding: 0.5rem 0; }
    .explanation summary:hover { color: #c7d2fe; }
    .explanation-content { padding: 1rem; background: rgba(99, 102, 241, 0.1); border-radius: 0.5rem; margin-top: 0.5rem; font-size: 0.9rem; color: #cbd5e1; line-height: 1.7; }
    .explanation-content strong { color: #e2e8f0; }
    .explanation-content em { color: #fbbf24; font-style: normal; }
    .explanation-content code { background: rgba(0, 0, 0, 0.3); padding: 0.15rem 0.4rem; border-radius: 0.25rem; font-family: 'Monaco', 'Menlo', monospace; font-size: 0.85em; color: #f472b6; }
    
    /* Code Details */
    .code-details { margin-top: 0.75rem; }
    .code-details summary { cursor: pointer; color: #94a3b8; font-size: 0.85rem; padding: 0.5rem 0; }
    .code-details summary:hover { color: #e2e8f0; }
    .code-details pre { margin-top: 0.5rem; background: #0f172a; border-radius: 0.5rem; padding: 1rem; overflow-x: auto; border: 1px solid rgba(99, 102, 241, 0.2); }
    .code-details code { font-family: 'Monaco', 'Menlo', 'Fira Code', monospace; font-size: 0.8rem; color: #e2e8f0; line-height: 1.5; }
    
    /* Tips Box */
    .tips-box { background: linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(16, 185, 129, 0.05)); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 1rem; padding: 1.5rem; margin-bottom: 1.5rem; }
    .tips-box h3 { color: #4ade80; font-size: 1.25rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; }
    .tip { background: rgba(0, 0, 0, 0.2); border-radius: 0.75rem; padding: 1rem; margin-bottom: 0.75rem; }
    .tip:last-child { margin-bottom: 0; }
    .tip-title { color: #e2e8f0; font-weight: 600; margin-bottom: 0.5rem; font-size: 1rem; }
    .tip-content { color: #94a3b8; font-size: 0.9rem; line-height: 1.6; }
    .tip-content code { background: rgba(99, 102, 241, 0.2); padding: 0.15rem 0.4rem; border-radius: 0.25rem; font-family: monospace; font-size: 0.85em; color: #a5b4fc; }
    .tip-content strong { color: #fbbf24; }
    
    /* Mind-blown Box */
    .mindblown-box { background: linear-gradient(135deg, rgba(168, 85, 247, 0.1), rgba(139, 92, 246, 0.05)); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 1rem; padding: 1.5rem; margin-bottom: 1.5rem; }
    .mindblown-box h3 { color: #c084fc; font-size: 1.25rem; margin-bottom: 1rem; }
    .fact { display: flex; gap: 1rem; padding: 0.75rem; background: rgba(0, 0, 0, 0.2); border-radius: 0.5rem; margin-bottom: 0.5rem; }
    .fact:last-child { margin-bottom: 0; }
    .fact-emoji { font-size: 1.5rem; flex-shrink: 0; }
    .fact-content { color: #cbd5e1; font-size: 0.9rem; line-height: 1.6; }
    .fact-content strong { color: #e2e8f0; }
    
    /* Cheat Sheet */
    .cheatsheet-box { background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(37, 99, 235, 0.05)); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 1rem; padding: 1.5rem; margin-bottom: 1.5rem; }
    .cheatsheet-box h3 { color: #60a5fa; font-size: 1.25rem; margin-bottom: 1rem; }
    .cheat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem; margin-bottom: 1rem; }
    .cheat-item { background: rgba(0, 0, 0, 0.2); border-radius: 0.5rem; padding: 0.75rem; }
    .cheat-bad { color: #f87171; font-family: monospace; font-size: 0.8rem; margin-bottom: 0.25rem; }
    .cheat-good { color: #4ade80; font-family: monospace; font-size: 0.8rem; margin-bottom: 0.25rem; }
    .cheat-why { color: #94a3b8; font-size: 0.8rem; font-style: italic; }
    .cheat-pro-tips { background: rgba(0, 0, 0, 0.2); border-radius: 0.75rem; padding: 1rem; margin-top: 1rem; }
    .cheat-pro-tips h4, .cheat-pro-tips h5 { color: #fbbf24; margin-bottom: 0.75rem; }
    .cheat-pro-tips ul { list-style: none; }
    .cheat-pro-tips li { color: #94a3b8; font-size: 0.9rem; margin-bottom: 0.5rem; padding-left: 1.25rem; position: relative; }
    .cheat-pro-tips li::before { content: '→'; position: absolute; left: 0; color: #60a5fa; }
    .cheat-pro-tips code { background: rgba(99, 102, 241, 0.2); padding: 0.1rem 0.3rem; border-radius: 0.2rem; font-size: 0.85em; color: #a5b4fc; }
    
    /* Educational "Use For Good" Section */
    .educational-intro { margin-bottom: 2rem; }
    .educational-hero {
      display: flex;
      gap: 1.5rem;
      padding: 2rem;
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(99, 102, 241, 0.1));
      border-radius: 1rem;
      border: 1px solid rgba(139, 92, 246, 0.3);
      align-items: center;
    }
    .edu-icon { font-size: 4rem; }
    .edu-content h2 { color: #c4b5fd; font-size: 1.75rem; margin-bottom: 0.75rem; }
    .edu-content p { color: #94a3b8; font-size: 1.1rem; line-height: 1.7; }
    .edu-sections { display: flex; flex-direction: column; gap: 1.5rem; }
    .edu-lang-section {
      background: rgba(30, 41, 59, 0.6);
      border-radius: 1rem;
      padding: 1.5rem;
      border: 1px solid rgba(99, 102, 241, 0.2);
    }
    .edu-lang-title {
      color: #e2e8f0;
      font-size: 1.25rem;
      margin-bottom: 1.25rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid rgba(99, 102, 241, 0.3);
    }
    .edu-lang-section .mindblown-box h4 { color: #c084fc; font-size: 1.1rem; margin-bottom: 0.75rem; }
    
    /* Cheatsheet Section (Use For Good tab) */
    .cheatsheet-section {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(37, 99, 235, 0.05));
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: 1rem;
      padding: 1.5rem;
    }
    .cheatsheet-section h3 { color: #60a5fa; font-size: 1.5rem; margin-bottom: 1.25rem; }
    .cheatsheet-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1rem;
    }
    .cheat-card {
      background: rgba(0, 0, 0, 0.3);
      border-radius: 0.75rem;
      padding: 1.25rem;
      border: 1px solid rgba(99, 102, 241, 0.2);
    }
    .cheat-card h4 { color: #e2e8f0; font-size: 1.1rem; margin-bottom: 1rem; }
    .cheat-card ul { list-style: none; }
    .cheat-card li {
      color: #94a3b8;
      font-size: 0.9rem;
      margin-bottom: 0.5rem;
      padding-left: 1.5rem;
      position: relative;
      line-height: 1.5;
    }
    .cheat-card li::before {
      content: '•';
      position: absolute;
      left: 0.5rem;
      color: #6366f1;
    }
    
    /* Category Tips Section */
    .category-tips-section {
      margin-top: 2rem;
    }
    .category-tips-section > h3 {
      color: #c4b5fd;
      font-size: 1.5rem;
      margin-bottom: 1.5rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid rgba(139, 92, 246, 0.3);
    }
    .category-tip-card {
      background: rgba(30, 41, 59, 0.6);
      border-radius: 1rem;
      padding: 1.5rem;
      border: 1px solid rgba(99, 102, 241, 0.2);
      margin-bottom: 1.5rem;
    }
    
    /* Explain Box */
    .explain-box {
      background: linear-gradient(135deg, rgba(251, 191, 36, 0.1), rgba(245, 158, 11, 0.05));
      border: 1px solid rgba(251, 191, 36, 0.3);
      border-radius: 1rem;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .explain-box h4 { color: #fbbf24; font-size: 1.25rem; margin-bottom: 1rem; }
    .explain-simple p { color: #94a3b8; font-size: 1rem; line-height: 1.7; margin-bottom: 0.75rem; }
    .explain-simple strong { color: #e2e8f0; }
    .explain-example {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 0.75rem;
      padding: 1rem;
      margin-top: 1rem;
      color: #cbd5e1;
      font-size: 0.95rem;
      line-height: 1.6;
    }
    .explain-example strong { color: #fbbf24; display: block; margin-bottom: 0.5rem; }
    
    /* Nested headers in edu sections */
    .edu-lang-section .tips-box h4,
    .edu-lang-section .cheatsheet-box h4 { 
      color: #4ade80; 
      font-size: 1.1rem; 
      margin-bottom: 1rem; 
    }
    .category-tip-card .tips-box h5,
    .category-tip-card .mindblown-box h5 {
      color: #c084fc;
      font-size: 1rem;
      margin-bottom: 0.75rem;
    }
    .cheat-pro-tips h5 {
      color: #fbbf24;
      font-size: 1rem;
      margin-bottom: 0.75rem;
    }
    
    /* Footer */
    .footer { text-align: center; padding: 2rem; margin-top: 2rem; border-top: 1px solid rgba(99, 102, 241, 0.2); color: #64748b; }
    .footer a { color: #6366f1; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
  `;
}
