import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { EditorProvider } from '../src/components/context';
import { FormatBar } from '../src/components/FormatBar';
import { Toolbar } from '../src/components/Toolbar';
import { ToolbarConfigProvider, makeToolbarConfig, type ToolbarOption } from '../src/components/toolbarConfig';
import type { PdfEditorController } from '../src/hooks/usePdfEditor';

afterEach(cleanup);

const frame = {
  id: 'f', x: 0, baseline: 0, width: 100, size: 12, lineHeight: 14, family: 'sans' as const,
  color: [0, 0, 0] as [number, number, number], align: 'left' as const, paragraphs: [],
};

function fakeEditor(over: Partial<PdfEditorController> = {}): PdfEditorController {
  return {
    status: 'ready', pageCount: 3, currentPage: 0, zoom: 'auto', scale: 1, mode: 'edit', saving: false,
    isDirty: false, canUndo: true, canRedo: false, fileName: 'contract.pdf', fileSize: 1000, edits: {},
    activeEdit: { pageIndex: 0, frame, sourceRunIds: [], initialSignature: '' },
    inlineEditorRef: { current: { exec: vi.fn(), read: () => [], focus: vi.fn() } },
    exportPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
    reportError: vi.fn(), undo: vi.fn(), redo: vi.fn(), updateActiveFrame: vi.fn(), deleteActive: vi.fn(),
    endEdit: vi.fn(), goToPage: vi.fn(), setZoom: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), download: vi.fn(),
    ...over,
  } as unknown as PdfEditorController;
}

function setup(ui: ReactNode, options?: ToolbarOption[], editor = fakeEditor()) {
  render(
    <EditorProvider editor={editor}>
      <ToolbarConfigProvider value={makeToolbarConfig(options)}>{ui}</ToolbarConfigProvider>
    </EditorProvider>,
  );
  return editor;
}

describe('formatting tools in toolbarOptions', () => {
  it('shows every formatting tool by default', () => {
    setup(<FormatBar />);
    for (const name of ['Undo (Ctrl+Z)', 'Bold (Ctrl+B)', 'Italic (Ctrl+I)', 'Underline (Ctrl+U)', 'Text colour', 'Align left', 'Delete text'])
      expect(screen.getByLabelText(name)).toBeTruthy();
    expect(screen.getByLabelText('Font size in points')).toBeTruthy();
    // The font picker is not part of the first release.
    expect(screen.queryByLabelText('Font')).toBeNull();
  });

  it('shows only the listed tools', () => {
    setup(<FormatBar />, ['fontSize', 'bold', 'alignment']);
    expect(screen.getByLabelText('Font size in points')).toBeTruthy();
    expect(screen.getByLabelText('Bold (Ctrl+B)')).toBeTruthy();
    expect(screen.getByLabelText('Align center')).toBeTruthy();
    for (const name of ['Undo (Ctrl+Z)', 'Italic (Ctrl+I)', 'Underline (Ctrl+U)', 'Text colour', 'Delete text'])
      expect(screen.queryByLabelText(name)).toBeNull();
    // dividers only between the three visible groups
    expect(document.querySelectorAll('.rpe-formatbar .rpe-divider').length).toBe(2);
  });

  it('keeps the Done button even when no formatting tools are listed', () => {
    setup(<FormatBar />, ['zoom']);
    expect(screen.getByText('Done')).toBeTruthy();
    expect(document.querySelectorAll('.rpe-formatbar .rpe-divider').length).toBe(0);
  });

  it('ignores unknown names instead of crashing', () => {
    setup(<FormatBar />, ['bold', 'sparkles' as ToolbarOption]);
    expect(screen.getByLabelText('Bold (Ctrl+B)')).toBeTruthy();
  });

  it('main toolbar and formatting options share one list', () => {
    setup(
      <>
        <Toolbar onSave={() => {}} />
        <FormatBar />
      </>,
      ['zoom', 'save', 'bold'],
    );
    expect(screen.getByLabelText('Zoom in')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Save/ })).toBeTruthy();
    expect(screen.queryByLabelText('Page number')).toBeNull();
    expect(screen.getByLabelText('Bold (Ctrl+B)')).toBeTruthy();
    expect(screen.queryByLabelText('Italic (Ctrl+I)')).toBeNull();
  });
});

describe('customTools', () => {
  it('renders the icon and passes the edited PDF bytes to onClick', async () => {
    const onClick = vi.fn();
    const editor = setup(
      <Toolbar customTools={[{ id: 'email', label: 'Email PDF', icon: <svg data-testid="mail" />, onClick }]} />,
    );
    expect(screen.getByTestId('mail')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Email PDF' }));
    });
    expect(editor.exportPdf).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
    const [bytes, info] = onClick.mock.calls[0]!;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes as Uint8Array)).toEqual([37, 80, 68, 70]);
    expect(info).toEqual({ fileName: 'contract.pdf', edited: false });
  });

  it('shows a spinner while an async onClick runs', async () => {
    let finish!: () => void;
    const onClick = vi.fn(() => new Promise<void>((r) => (finish = r)));
    setup(<Toolbar customTools={[{ id: 'up', label: 'Upload', icon: <svg />, onClick }]} />);
    const btn = screen.getByRole('button', { name: 'Upload' });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.querySelector('.rpe-spinner')).toBeTruthy();
    await act(async () => finish());
    expect(btn.getAttribute('aria-busy')).toBe('false');
  });

  it('reports a thrown error through the editor', async () => {
    const editor = setup(
      <Toolbar customTools={[{ id: 'x', label: 'Sign', icon: <svg />, onClick: () => { throw new Error('no key'); } }]} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    });
    expect(editor.reportError).toHaveBeenCalledWith(expect.any(Error), 'Sign');
  });

  it('custom tools still show when toolbarOptions is []', () => {
    setup(<Toolbar customTools={[{ id: 'a', label: 'Archive', icon: <svg />, onClick: () => {} }]} />, []);
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
    expect(screen.queryByLabelText('Zoom in')).toBeNull();
  });
});
