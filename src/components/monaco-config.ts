import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { getAllLanguages } from "../languages";
import type { LoadedLanguage, VersionConfig } from "../languages";
import { langSel, versionSel } from "./dom";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "typescript" || label === "javascript") {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

/**
 * ScriptTarget for a profile target string.
 *
 * Monaco's `ScriptTarget` enum genuinely stops at `ES2020 = 7` and then jumps to
 * `ESNext = 99`; it has no ES2021 or ES2022 member. So the previous table's
 * `ES2022 -> ESNext` fallback was correct, and mapping the newer targets onto
 * ESNext remains the only option.
 *
 * Looked up on the enum rather than hardcoded so that a future Monaco which adds
 * the missing members starts using them without this table having to be noticed and
 * updated. An unknown name falls back to ESNext, never to `undefined` - Monaco
 * treats an undefined target as ES3, which would report modern syntax as invalid.
 *
 * The target is only half the story: because ES2021 and ES2022 collapse onto
 * ESNext, `lib` is what actually restricts the available API, which is why it is
 * derived from the profile target below rather than left to Monaco's default.
 */
function scriptTarget(target: string): monaco.languages.typescript.ScriptTarget {
  const targets = monaco.languages.typescript.ScriptTarget as unknown as Record<string, number>;
  const resolved = targets[target];
  return (resolved ?? monaco.languages.typescript.ScriptTarget.ESNext) as monaco.languages.typescript.ScriptTarget;
}

/**
 * The lib set for a target - deliberately the same rule the server applies in
 * `server/languages/adapters/typescript.mjs`.
 *
 * The previous configuration hardcoded `["ES2020", "DOM", "DOM.Iterable"]` for every
 * target, so a project on `ts-es2015` was offered the whole ES2020 API in
 * completion and reported no error for using it - and then the server, which does
 * derive lib from target, refused to compile it. Editor diagnostics that disagree
 * with the compiler are worse than no diagnostics, because the student trusts them.
 *
 * DOM is included at every target to match the server, and because that is where
 * `console` is declared.
 */
function libsFor(target: string): string[] {
  const esLib =
    {
      ES5: 'es5',
      ES2015: 'es2015',
      ES2016: 'es2016',
      ES2017: 'es2017',
      ES2018: 'es2018',
      ES2019: 'es2019',
      ES2020: 'es2020',
      ES2021: 'es2021',
      ES2022: 'es2022',
      ESNext: 'esnext',
    }[target] || 'es2022';

  return [esLib, 'dom', 'dom.iterable'];
}

/**
 * What is currently applied to each language service, so identical configuration
 * is not re-applied.
 *
 * Monaco has exactly ONE TypeScript language service, and its compiler options are
 * global - there is no per-model configuration to move to, so the options must
 * follow the active document. What was wrong before (V-19) was doing it
 * unconditionally on every tab activation: each `setCompilerOptions` call
 * invalidates the worker and re-runs diagnostics for every open model, so simply
 * clicking between two tabs of the same language threw away and recomputed the
 * whole project's diagnostics. Keyed per service, so switching TypeScript -> PHP ->
 * TypeScript does not re-apply either.
 */
const appliedOptions = new Map<'typescript' | 'javascript', string>();

export function configureMonacoForVersion(lang: LoadedLanguage, version: VersionConfig) {
  if (lang.id !== 'typescript' && lang.id !== 'javascript') return;

  const target = version.monacoTarget || 'ES2022';
  const strict = version.strict ?? lang.id === 'typescript';
  const service = lang.id as 'typescript' | 'javascript';

  const signature = `${target}|${strict}`;
  if (appliedOptions.get(service) === signature) return;
  appliedOptions.set(service, signature);

  const shared = {
    target: scriptTarget(target),
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    // Required for models whose URI has a workspace extension Monaco does not
    // recognise as TypeScript by itself.
    allowNonTsExtensions: true,
    noEmit: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    skipLibCheck: true,
    lib: libsFor(target),
  };

  if (service === 'typescript') {
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({ ...shared, strict });
  } else {
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      ...shared,
      allowJs: true,
      checkJs: true,
      // `strict` on a JavaScript file reports an error for every unannotated
      // parameter, which for a beginner's script is every parameter. Left off
      // regardless of profile, matching how the server treats plain JS.
      strict: false,
    });
  }
}

// Enable diagnostics
monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
});

monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
});

// Populate language dropdown from loaded configs
export function populateLanguageDropdown() {
  langSel.innerHTML = "";
  for (const lang of getAllLanguages()) {
    const opt = document.createElement("option");
    opt.value = lang.id;
    opt.textContent = lang.name;
    langSel.appendChild(opt);
  }
}

// Populate version dropdown for a language
export function populateVersionDropdown(lang: LoadedLanguage, selectedVersionId?: string): VersionConfig {
  versionSel.innerHTML = "";
  let defaultVersion = lang.versions[0];

  for (const v of lang.versions) {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.name;
    
    if (selectedVersionId && v.id === selectedVersionId) {
      opt.selected = true;
      defaultVersion = v;
    } else if (!selectedVersionId && v.default) {
      opt.selected = true;
      defaultVersion = v;
    }
    versionSel.appendChild(opt);
  }

  return defaultVersion;
}

// Apply theme to body class
export function applyTheme(theme: string) {
  if (theme === "vs-dark") {
    document.body.classList.add("dark-theme");
  } else {
    document.body.classList.remove("dark-theme");
  }
  monaco.editor.setTheme(theme);
}

