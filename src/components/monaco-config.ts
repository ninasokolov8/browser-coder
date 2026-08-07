import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { getAllLanguages } from "../languages";
import { ASSET_LANGUAGE_ID } from "../workspace/assets.ts";
import type { LoadedLanguage, VersionConfig } from "../languages";
import { langSel, versionSel } from "./dom";

/**
 * One worker per language service.
 *
 * Monaco bundles full language services for css, html and json - validation,
 * completion, hover, formatting - but each runs in its OWN web worker and asks for
 * it by label. This function used to answer every label except typescript and
 * javascript with the generic editor worker, which does not implement any of those
 * protocols. The services were therefore present, registered, and completely inert:
 * no CSS property validation, no JSON syntax errors, no HTML completion, and a
 * format command that returned nothing.
 *
 * Nothing fails loudly in that state - the request goes to a worker that never
 * answers - so the only way to know is to assert that a broken file produces a
 * marker, which `tests/browser/app-boot.ts` now does.
 */
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case "typescript":
      case "javascript":
        return new tsWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "json":
        return new jsonWorker();
      default:
        return new editorWorker();
    }
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

// The other three services, configured explicitly rather than left on their
// defaults - so what the student is told about their file is a decision recorded
// here, not whatever a Monaco upgrade happens to ship.
monaco.languages.css.cssDefaults.setDiagnosticsOptions({
  validate: true,
  lint: {
    // Genuine mistakes, reported as warnings so they never block anything.
    emptyRules: 'warning',
    duplicateProperties: 'warning',
    unknownProperties: 'warning',
    // Silent: these fire on correct, deliberate CSS and would train a beginner to
    // ignore the squiggle.
    zeroUnits: 'ignore',
    universalSelector: 'ignore',
    important: 'ignore',
  },
});

monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
  validate: true,
  // Strict JSON. A .json file with comments or a trailing comma is rejected by
  // every parser the student will meet, including `json.load` in the exercise they
  // are about to write, so the editor says so too.
  allowComments: false,
  trailingCommas: 'error',
  schemaValidation: 'error',
});

monaco.languages.html.htmlDefaults.setOptions({
  format: {
    tabSize: 2,
    insertSpaces: true,
    wrapLineLength: 120,
    unformatted: 'code,pre',
    contentUnformatted: 'pre,textarea',
    indentInnerHtml: false,
    preserveNewLines: true,
    maxPreserveNewLines: 2,
    indentHandlebars: false,
    endWithNewline: true,
    extraLiners: 'head,body,/html',
    wrapAttributes: 'auto',
  },
  suggest: { html5: true },
});

// Populate language dropdown from loaded configs
export function populateLanguageDropdown() {
  langSel.innerHTML = "";
  for (const lang of getAllLanguages()) {
    // "Asset" is a registered language so imported images have somewhere to live,
    // but a binary asset is imported, never created from a starter. Choosing it in
    // this dropdown created an empty `main.png` and then threw out of
    // `getOrCreateModel` - the registry refuses a model for an asset - leaving a file
    // in storage that could not be opened.
    if (lang.id === ASSET_LANGUAGE_ID) continue;

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
/**
 * Apply a theme to the whole IDE - Monaco and the surrounding chrome.
 *
 * Three now, not two. The old version added `dark-theme` for exactly the string
 * "vs-dark" and removed it for anything else, so adding a third option would have
 * silently applied the LIGHT variable set to it - the audit called this out as the
 * reason a high-contrast theme could not simply be added to the dropdown.
 *
 * The mapping is explicit and total, so a value that is not one of the three falls back
 * to dark rather than to whatever the else-branch happened to be.
 */
export function applyTheme(theme: string) {
  const body = document.body.classList;
  body.remove("dark-theme", "hc-theme");

  if (theme === "hc-black") {
    // Both: the high-contrast set is defined as an override on top of dark, so a
    // variable it does not restate still has a dark value rather than a light one.
    body.add("dark-theme", "hc-theme");
  } else if (theme !== "vs") {
    body.add("dark-theme");
  }

  monaco.editor.setTheme(theme === "hc-black" || theme === "vs" ? theme : "vs-dark");
}

