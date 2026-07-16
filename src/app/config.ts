export type IdePanel = 'explorer' | 'search' | 'run';

const urlParams = new URLSearchParams(window.location.search);

export const appConfig = {
  isEmbedded: urlParams.get('embed') === '1',
  ideMode: ((urlParams.get('mode') || 'snippet').toLowerCase() === 'full' ||
            (urlParams.get('mode') || 'snippet').toLowerCase() === 'project') ? 'full' as const : 'snippet' as const,
  noOutput: urlParams.get('nooutput') === '1',
  hackLabEnabled: urlParams.get('hacklab') === '1',
  urlLanguage: urlParams.get('lang') || 'javascript',
  urlVersion: urlParams.get('version') || '',
  urlUiLang: urlParams.get('uilang') || 'en',
};

export const policyState: {
  readonly: boolean;
  lockStructure: boolean;
  allowRun: boolean;
  allowSearchReplace: boolean;
  visiblePanels: IdePanel[];
} = {
  readonly: urlParams.get('readonly') === '1',
  lockStructure: urlParams.get('readonly') === '1',
  allowRun: urlParams.get('readonly') !== '1' && urlParams.get('nooutput') !== '1',
  allowSearchReplace: urlParams.get('readonly') !== '1',
  visiblePanels: (((urlParams.get('mode') || 'snippet').toLowerCase() === 'full' ||
                   (urlParams.get('mode') || 'snippet').toLowerCase() === 'project')
    ? ['explorer', 'search', 'run']
    : []) as IdePanel[],
};

export function normalizePanels(rawPanels: unknown, fallback: IdePanel[]): IdePanel[] {
  if (!Array.isArray(rawPanels)) return [...fallback];
  const allowed: IdePanel[] = ['explorer', 'search', 'run'];
  const unique = new Set<IdePanel>();
  for (const panel of rawPanels) {
    if (typeof panel === 'string' && allowed.includes(panel as IdePanel)) {
      unique.add(panel as IdePanel);
    }
  }
  return unique.size > 0 ? Array.from(unique) : [...fallback];
}

export function applyModeClasses(): void {
  document.body.classList.remove('mode-snippet', 'mode-project', 'mode-full', 'embedded', 'readonly', 'nooutput');
  document.body.classList.add(`mode-${appConfig.ideMode}`);
  if (appConfig.isEmbedded) document.body.classList.add('embedded');
  if (policyState.readonly) document.body.classList.add('readonly');
  if (appConfig.noOutput) document.body.classList.add('nooutput');
  if (appConfig.hackLabEnabled) document.body.classList.add('hacklab-enabled');
}
