export const PREVIEW_BRANCH: 'preview';
export const PREVIEW_URL: 'https://preview.gtasf.pages.dev';
export interface PreviewCommand { tool: string; args: string[]; cwd: string }
export function parsePreviewArgs(args: string[]): { revision: string; dryRun: boolean; flags: string[] };
export function previewFlags(flagsSource: string, prepareSource: string, extra: string[]): Record<string, boolean>;
export function previewCommands(commit: string, dryRun?: boolean): PreviewCommand[];
export function assertPreviewCommand(command: PreviewCommand, commit: string): void;
export function assertPreviewProject(project: { name?: string; production_branch?: string }): void;
export function executePreviewCommand(command: PreviewCommand, commit: string, run: (command: PreviewCommand) => Promise<void>): Promise<void>;
export function runPreview(args: string[], root: string): Promise<void>;
