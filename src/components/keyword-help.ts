import { t } from "../i18n";

// ===== Keyword help popup ("Explain this keyword") =====
let keywordPopupEl: HTMLDivElement | null = null;

function closeKeywordHelpPopup() {
  if (keywordPopupEl) {
    keywordPopupEl.remove();
    keywordPopupEl = null;
    document.removeEventListener("mousedown", onKeywordPopupOutsideClick, true);
    document.removeEventListener("keydown", onKeywordPopupEscape, true);
  }
}

function onKeywordPopupOutsideClick(e: MouseEvent) {
  if (keywordPopupEl && !keywordPopupEl.contains(e.target as Node)) {
    closeKeywordHelpPopup();
  }
}

function onKeywordPopupEscape(e: KeyboardEvent) {
  if (e.key === "Escape") closeKeywordHelpPopup();
}

// Formats a snake_case/underscore type tag (e.g. "control_flow") into a
// friendlier display label (e.g. "Control Flow") for the popup badge.
function formatKeywordTypeTag(type: string): string {
  return type
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function showKeywordHelpPopup(keyword: string, type: string | undefined, explanation: string, example: string, rtl: boolean, x: number, y: number) {
  closeKeywordHelpPopup();

  const popup = document.createElement("div");
  popup.className = "keyword-help-popup";

  const header = document.createElement("div");
  header.className = "kw-help-header";
  const titleGroup = document.createElement("span");
  titleGroup.className = "kw-help-title-group";
  const title = document.createElement("span");
  title.className = "kw-help-title";
  title.textContent = keyword;
  titleGroup.appendChild(title);
  if (type) {
    const tag = document.createElement("span");
    tag.className = "kw-help-tag";
    tag.textContent = formatKeywordTypeTag(type);
    titleGroup.appendChild(tag);
  }
  const closeBtn = document.createElement("button");
  closeBtn.className = "kw-help-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", closeKeywordHelpPopup);
  header.appendChild(titleGroup);
  header.appendChild(closeBtn);
  popup.appendChild(header);

  // Only the explanation text is ever translated (Hebrew), so only it gets
  // dir="rtl" - the keyword name, type tag, and example code always stay LTR.
  const desc = document.createElement("div");
  desc.className = "kw-help-desc";
  desc.textContent = explanation;
  if (rtl) {
    desc.dir = "rtl";
    desc.classList.add("kw-help-desc-rtl");
  }
  popup.appendChild(desc);

  const exampleLabel = document.createElement("div");
  exampleLabel.className = "kw-help-example-label";
  exampleLabel.textContent = t("editor.example") || "Example:";
  popup.appendChild(exampleLabel);

  const code = document.createElement("pre");
  code.className = "kw-help-code";
  code.textContent = example;
  popup.appendChild(code);

  document.body.appendChild(popup);

  // Position near the clicked word, then clamp so it never renders off-screen
  const rect = popup.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 12;
  const maxY = window.innerHeight - rect.height - 12;
  popup.style.left = `${Math.max(8, Math.min(x, Math.max(8, maxX)))}px`;
  popup.style.top = `${Math.max(8, Math.min(y, Math.max(8, maxY)))}px`;

  keywordPopupEl = popup;

  // Defer listener attachment so the same click/context-menu selection that
  // opened the popup doesn't immediately close it again.
  setTimeout(() => {
    document.addEventListener("mousedown", onKeywordPopupOutsideClick, true);
    document.addEventListener("keydown", onKeywordPopupEscape, true);
  }, 0);
}

