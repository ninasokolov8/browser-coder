import {
  statusEl,
  panelContentEl,
} from "./dom";

// Utility functions
export function setStatus(s: string) {
  statusEl.textContent = s;
}

export function setOutput(text: string) {
  // Output is always raw program stdout/stderr/exit-code text - never
  // translated - so it must stay LTR even if the element previously held a
  // translated (and possibly RTL) placeholder via data-i18n.
  panelContentEl.dir = "ltr";
  panelContentEl.textContent = text || "";
  panelContentEl.scrollTop = panelContentEl.scrollHeight;
}

export function appendOutput(text: string) {
  panelContentEl.dir = "ltr";
  panelContentEl.textContent += (panelContentEl.textContent ? "\n" : "") + text;
  panelContentEl.scrollTop = panelContentEl.scrollHeight;
}

