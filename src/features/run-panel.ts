// @ts-nocheck
import { runtime } from '../app/runtime';
import { parseFunctions, extractDefinitionsOnly } from '../components/code-analysis';
import { setOutput, setStatus } from '../components/output';
import { runBtn } from '../components/dom';

// ===== FUNCTION PARSER & RUN PANEL =====
const functionListEl = document.getElementById('function-list')!;
const runAllCodeEl = document.getElementById('run-all-code')!;
const btnRefreshFunctions = document.getElementById('btn-refresh-functions')!;

function getEditor() {
  if (!runtime.editor) throw new Error('Run panel: editor is not initialized');
  return runtime.editor;
}

function getTabManager() {
  if (!runtime.tabManager) throw new Error('Run panel: tab manager is not initialized');
  return runtime.tabManager;
}


export function renderFunctionList() {
  const editor = getEditor();
  const tabManager = getTabManager();
  const activeTab = tabManager.getActiveTab();
  if (!activeTab) {
    functionListEl.innerHTML = '<div class="tree-empty">No file open</div>';
    return;
  }

  const code = editor.getValue();
  const language = activeTab.file.language;
  const functions = parseFunctions(code, language);

  if (functions.length === 0) {
    functionListEl.innerHTML = '<div class="tree-empty">No functions detected</div>';
    return;
  }

  const icons: Record<string, string> = {
    function: '𝑓',
    arrow: '→',
    method: '𝑚',
    class: '𝐶',
  };

  // Helper to escape HTML
  const escapeHtml = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  functionListEl.innerHTML = functions.map(fn => {
    const hasParams = fn.params && fn.params.trim().length > 0;
    const isClass = fn.type === 'class';
    const placeholder = isClass 
      ? 'constructor args (e.g., "value", 42)' 
      : `args: ${fn.params || 'none'}`;
    
    return `
      <div class="run-item-container">
        <div class="run-item" data-function="${escapeHtml(fn.name)}" data-line="${fn.line}" data-type="${fn.type}" data-params="${escapeHtml(fn.params)}">
          <span class="run-item-icon">${icons[fn.type] || '𝑓'}</span>
          <span class="run-item-name">${escapeHtml(fn.name)}(${hasParams || isClass ? '...' : ''})</span>
          <span class="run-item-type">${fn.type}</span>
          <button class="run-btn" title="Run ${escapeHtml(fn.name)}">▶</button>
        </div>
        ${hasParams || isClass ? `
          <div class="run-item-args">
            <span class="run-item-args-label">Args:</span>
            <input type="text" class="run-item-args-input" placeholder="${escapeHtml(placeholder)}" data-fn="${escapeHtml(fn.name)}" />
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  // Attach handlers
  functionListEl.querySelectorAll('.run-item-container').forEach(container => {
    const itemEl = container.querySelector('.run-item') as HTMLElement;
    const argsInput = container.querySelector('.run-item-args-input') as HTMLInputElement | null;
    
    const fnName = itemEl.dataset.function!;
    const fnLine = parseInt(itemEl.dataset.line!);
    const fnType = itemEl.dataset.type!;

    // Click on name to go to line
    itemEl.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('run-btn')) return;
      editor.revealLineInCenter(fnLine);
      editor.setPosition({ lineNumber: fnLine, column: 1 });
      editor.focus();
    });

    // Click run button
    itemEl.querySelector('.run-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const args = argsInput ? argsInput.value.trim() : '';
      runFunction(fnName, fnType, args);
    });

    // Press Enter in args input to run
    argsInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runFunction(fnName, fnType, argsInput.value.trim());
      }
    });
  });
}

async function runFunction(fnName: string, fnType: string, args: string = '') {
  const editor = getEditor();
  const tabManager = getTabManager();
  const activeTab = tabManager.getActiveTab();
  if (!activeTab) return;

  const code = editor.getValue();
  const language = activeTab.file.language;
  const version = activeTab.file.version;

  // Format args for display
  const argsDisplay = args ? `(${args})` : '()';
  
  // Extract only function/class definitions for JS/TS to prevent top-level execution
  let runCode = '';

  switch (language) {
    case 'javascript':
    case 'typescript': {
      const defsOnly = extractDefinitionsOnly(code, language);
      if (fnType === 'class') {
        runCode = `${defsOnly}\n\n// Run specific class\nconsole.log('--- Running new ${fnName}${argsDisplay} ---');\nconst __instance = new ${fnName}(${args});\nconsole.log('Created instance:', __instance);`;
      } else {
        runCode = `${defsOnly}\n\n// Run specific function\nconsole.log('--- Running ${fnName}${argsDisplay} ---');\nconst __result = ${fnName}(${args});\nif (__result !== undefined) console.log('Returned:', __result);`;
      }
      break;
    }

    case 'python': {
      // Extract only function/class definitions, not top-level execution code
      const defsOnly = extractDefinitionsOnly(code, 'python');
      if (fnType === 'class') {
        runCode = `${defsOnly}\n\n# Run specific class\nprint('--- Running ${fnName}${argsDisplay} ---')\n__instance = ${fnName}(${args})\nprint('Created instance:', __instance)`;
      } else {
        runCode = `${defsOnly}\n\n# Run specific function\nprint('--- Running ${fnName}${argsDisplay} ---')\n__result = ${fnName}(${args})\nif __result is not None:\n    print('Returned:', __result)`;
      }
      break;
    }

    case 'java':
      // Java: replace main method body to only call the target function
      if (fnType === 'class') {
        runCode = code;
      } else {
        runCode = code.replace(
          /public\s+static\s+void\s+main\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/,
          `public static void main(String[] args) {\n        System.out.println("--- Running ${fnName}${argsDisplay} ---");\n        ${fnName}(${args});\n    }`
        );
      }
      break;

    case 'csharp':
      // C#: best-effort replacement of the Main method body, falling back to top-level statements
      if (fnType === 'class') {
        runCode = code;
      } else if (/static\s+(?:async\s+)?(?:void|int|Task|Task<int>)\s+Main\s*\(/.test(code)) {
        runCode = code.replace(
          /static\s+(?:async\s+)?(?:void|int|Task|Task<int>)\s+Main\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/,
          `static void Main(string[] args) {\n        System.Console.WriteLine("--- Running ${fnName}${argsDisplay} ---");\n        ${fnName}(${args});\n    }`
        );
      } else {
        // Top-level statements: append a call at the end of the file
        runCode = `${code}\n\nSystem.Console.WriteLine("--- Running ${fnName}${argsDisplay} ---");\n${fnName}(${args});\n`;
      }
      break;

    case 'php': {
      // Extract only function/class definitions, not top-level execution code
      const defsOnly = extractDefinitionsOnly(code, 'php');
      
      if (fnType === 'class') {
        runCode = `${defsOnly}\n\n// Run specific class\necho "--- Running new ${fnName}${argsDisplay} ---\\n";\n$__instance = new ${fnName}(${args});\nvar_dump($__instance);`;
      } else {
        runCode = `${defsOnly}\n\n// Run specific function\necho "--- Running ${fnName}${argsDisplay} ---\\n";\n$__result = ${fnName}(${args});\nif ($__result !== null) { var_dump($__result); }`;
      }
      break;
    }

    default:
      runCode = code;
  }

  // Show running state
  setOutput(`Running ${fnName}${argsDisplay}...`);
  setStatus(`Running ${fnName}...`);

  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: runCode, language, version }),
    });

    const data = await res.json();

    if (!res.ok) {
      setOutput(`Error: ${data.error || "Unknown error"}`);
      setStatus("Error ❌");
      return;
    }

    let output = "";
    if (data.stdout) output += data.stdout;
    if (data.stderr) output += (output ? "\n" : "") + data.stderr;
    if (!output && data.exitCode === 0) output = `${fnName}${argsDisplay} completed successfully (no output)`;
    
    setOutput(output);
    setStatus(`${fnName}${argsDisplay} ✅`);
  } catch (e) {
    setOutput(`Network error: ${e}`);
    setStatus("Error ❌");
  }
}

let initialized = false;
let functionListDebounce: ReturnType<typeof setTimeout> | null = null;
let editorContentSubscription: { dispose(): void } | null = null;

/** Register run-panel listeners only after the editor and TabManager exist. */
export function initializeRunPanel(): void {
  if (initialized) return;

  const editor = getEditor();
  const tabManager = getTabManager();
  initialized = true;

  runAllCodeEl.addEventListener('click', () => {
    runBtn.click();
  });

  btnRefreshFunctions.addEventListener('click', renderFunctionList);

  editorContentSubscription = editor.onDidChangeModelContent(() => {
    if (functionListDebounce) clearTimeout(functionListDebounce);
    functionListDebounce = setTimeout(renderFunctionList, 500);
  });

  // Refresh through normal TabManager events instead of replacing methods.
  tabManager.addEventListener?.('tabSwitch', () => setTimeout(renderFunctionList, 100));

  // Current TabManager does not expose addEventListener. The editor model-change
  // event is emitted whenever a different tab model is selected, so this covers
  // both content edits and tab switches safely.
  editor.onDidChangeModel(() => setTimeout(renderFunctionList, 0));

  renderFunctionList();
}
