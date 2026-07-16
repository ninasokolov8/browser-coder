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

// Monaco target mapping
const MONACO_TARGETS: Record<string, monaco.languages.typescript.ScriptTarget> = {
  ES5: monaco.languages.typescript.ScriptTarget.ES5,
  ES2015: monaco.languages.typescript.ScriptTarget.ES2015,
  ES2016: monaco.languages.typescript.ScriptTarget.ES2016,
  ES2017: monaco.languages.typescript.ScriptTarget.ES2017,
  ES2018: monaco.languages.typescript.ScriptTarget.ES2018,
  ES2019: monaco.languages.typescript.ScriptTarget.ES2019,
  ES2020: monaco.languages.typescript.ScriptTarget.ES2020,
  ES2021: monaco.languages.typescript.ScriptTarget.ES2020, // Fallback
  ES2022: monaco.languages.typescript.ScriptTarget.ESNext,
  ESNext: monaco.languages.typescript.ScriptTarget.ESNext,
};

// Configure Monaco for a specific language version
export function configureMonacoForVersion(lang: LoadedLanguage, version: VersionConfig) {
  if (lang.id === "typescript" || lang.id === "javascript") {
    const targetStr = version.monacoTarget || "ES2022";
    const target = MONACO_TARGETS[targetStr] ?? monaco.languages.typescript.ScriptTarget.ESNext;
    const strict = version.strict ?? (lang.id === "typescript");

    if (lang.id === "typescript") {
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        target,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        allowNonTsExtensions: true,
        strict,
        noEmit: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        skipLibCheck: true,
        lib: ["ES2020", "DOM", "DOM.Iterable"],
      });
    } else {
      monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        allowNonTsExtensions: true,
        allowJs: true,
        checkJs: true,
        noEmit: true,
      });
    }
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

