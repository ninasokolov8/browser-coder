import { t } from "../i18n";
import { runBtn, panelContentEl } from "./dom";
import { setOutput } from "./output";

// ===== Run loader (VSCode-style "busy" feedback) =====
let runLoaderTimer: number | null = null;
// Captured fresh in startRunLoader() (not once at page load) so it always
// reflects the button's current label - including after a UI language
// switch, which rewrites this HTML via translatePage().
let runBtnRestoreHTML = runBtn.innerHTML;

export function startRunLoader() {
  runBtnRestoreHTML = runBtn.innerHTML;
  runBtn.disabled = true;
  runBtn.innerHTML = `<span class="btn-spinner"></span>${t("titlebar.running") || "Running"}`;

  let dots = 0;
  setOutput("Running");
  runLoaderTimer = window.setInterval(() => {
    dots = (dots + 1) % 4; // 0 -> 1 -> 2 -> 3 -> 0 (dots gone) -> ...
    panelContentEl.textContent = "Running" + ".".repeat(dots);
  }, 400);
}

export function stopRunLoader() {
  if (runLoaderTimer !== null) {
    window.clearInterval(runLoaderTimer);
    runLoaderTimer = null;
  }
  runBtn.disabled = false;
  runBtn.innerHTML = runBtnRestoreHTML;
}

