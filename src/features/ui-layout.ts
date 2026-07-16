import { appConfig } from '../app/config';
import { sidebarEl } from '../components/dom';

export function updateGridForRTL(): void {
  if (appConfig.isEmbedded) return;
  const appEl = document.getElementById('app')!;
  const sidebarWidth = sidebarEl.offsetWidth || 220;
  appEl.style.gridTemplateColumns = `48px ${sidebarWidth}px 1fr`;
}
