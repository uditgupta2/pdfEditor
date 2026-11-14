import { createContext, useContext, type ReactNode } from 'react';
import type { SaveInfo } from '../hooks/usePdfEditor';

/** Items of the main toolbar, in display order. */
export const MAIN_TOOLBAR_OPTIONS = ['sidebar', 'open', 'fileName', 'pageNav', 'zoom', 'edit', 'download', 'save'] as const;

/** Text-editing tools in the formatting bar (shown in Edit mode), in display order. */
export const FORMAT_TOOL_OPTIONS = [
  'undo',
  'redo',
  'fontSelection',
  'fontSize',
  'bold',
  'italic',
  'underline',
  'textColor',
  'alignment',
  'deleteText',
] as const;

export const TOOLBAR_OPTIONS = [...MAIN_TOOLBAR_OPTIONS, ...FORMAT_TOOL_OPTIONS] as const;

export type MainToolbarOption = (typeof MAIN_TOOLBAR_OPTIONS)[number];
export type FormatToolOption = (typeof FORMAT_TOOL_OPTIONS)[number];
export type ToolbarOption = MainToolbarOption | FormatToolOption;

/** A button you add to the toolbar. */
export interface CustomTool {
  /** Unique key. */
  id: string;
  /** Accessible name and tooltip; also shown as text next to the icon on wide layouts. */
  label: string;
  /** Any React node, e.g. an <svg> or an icon component. ~20px works best. */
  icon: ReactNode;
  /**
   * Receives the current PDF as bytes, with all edits applied (an open text
   * box is committed first). Return a promise to show a spinner on the button
   * until it settles; throw to show an error banner.
   */
  onClick(bytes: Uint8Array, info: SaveInfo): void | Promise<void>;
  /** Show the label text next to the icon (hidden on narrow layouts anyway). Default false. */
  showLabel?: boolean;
  disabled?: boolean;
}

export interface ToolbarConfig {
  options: ReadonlySet<ToolbarOption>;
  has(option: ToolbarOption): boolean;
}

export function makeToolbarConfig(options: readonly string[] | undefined): ToolbarConfig {
  // Unknown names are ignored, so a typo can't crash the editor.
  const set = new Set((options ?? TOOLBAR_OPTIONS).filter((o): o is ToolbarOption => (TOOLBAR_OPTIONS as readonly string[]).includes(o)));
  return { options: set, has: (o) => set.has(o) };
}

const ToolbarConfigContext = createContext<ToolbarConfig>(makeToolbarConfig(undefined));
export const ToolbarConfigProvider = ToolbarConfigContext.Provider;
export const useToolbarConfig = () => useContext(ToolbarConfigContext);
