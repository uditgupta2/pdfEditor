import { createContext, useContext, type ReactNode } from 'react';
import type { PdfEditorController } from '../hooks/usePdfEditor';

const EditorContext = createContext<PdfEditorController | null>(null);

export function EditorProvider({ editor, children }: { editor: PdfEditorController; children: ReactNode }) {
  return <EditorContext.Provider value={editor}>{children}</EditorContext.Provider>;
}

export function useEditor(): PdfEditorController {
  const editor = useContext(EditorContext);
  if (!editor) {
    throw new Error('useEditor() must be used inside <EditorProvider> or <PdfEditor>.');
  }
  return editor;
}
