import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PdfEditor } from '../src/components/PdfEditor';

afterEach(cleanup);

function mockPicker(file: File) {
  return vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    Object.defineProperty(this, 'files', { value: [file] });
    this.dispatchEvent(new Event('change'));
  });
}

describe('PdfEditor props', () => {
  it('toolbarOptions controls which toolbar items render', () => {
    render(<PdfEditor toolbarOptions={['zoom']} onSave={() => {}} />);
    expect(screen.queryByRole('button', { name: /Open/ })).toBeNull();
    expect(screen.queryByLabelText('Page number')).toBeNull();
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
    expect(screen.getByLabelText('Zoom in')).toBeTruthy();
  });

  it('toolbarOptions=[] hides the toolbar', () => {
    render(<PdfEditor toolbarOptions={[]} />);
    expect(screen.queryByRole('toolbar', { name: 'PDF editor' })).toBeNull();
  });

  it('onSave adds a Save button; without it there is none', () => {
    const { unmount } = render(<PdfEditor onSave={() => {}} />);
    expect(screen.getByRole('button', { name: /Save/ })).toBeTruthy();
    unmount();
    render(<PdfEditor />);
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
  });

  it('enableEditMode=false hides the Edit button', () => {
    const { unmount } = render(<PdfEditor />);
    expect(screen.getByRole('button', { name: /Edit/ })).toBeTruthy();
    unmount();
    render(<PdfEditor enableEditMode={false} />);
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
  });

  it('loadingState shows the default loader over the editor', () => {
    const { rerender } = render(<PdfEditor loadingState />);
    expect(screen.getByRole('status').textContent).toContain('Loading');
    expect(document.querySelector('.rpe-loader-ring')).toBeTruthy();
    rerender(<PdfEditor loadingState={false} />);
    expect(document.querySelector('.rpe-loading')).toBeNull();
  });

  it('loadingComponent replaces the default spinner', () => {
    render(<PdfEditor loadingState loadingComponent={<p>Please wait</p>} />);
    expect(screen.getByText('Please wait')).toBeTruthy();
    expect(document.querySelector('.rpe-loader')).toBeNull();
  });

  it('onOpen receives the chosen file and can cancel opening it', async () => {
    const onOpen = vi.fn(() => false);
    const onError = vi.fn();
    const click = mockPicker(new File(['not a pdf'], 'x.pdf'));
    render(<PdfEditor onOpen={onOpen} onError={onError} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose PDF' }));
    });
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalled());
    expect((onOpen.mock.calls[0] as unknown as [File])[0].name).toBe('x.pdf');
    // Not loaded, so the invalid file never produced an error.
    await new Promise((r) => setTimeout(r, 50));
    expect(onError).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('onOpen that returns nothing lets the editor open the file', async () => {
    const onOpen = vi.fn();
    const onError = vi.fn();
    const click = mockPicker(new File(['not a pdf'], 'y.pdf'));
    render(<PdfEditor onOpen={onOpen} onError={onError} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose PDF' }));
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0].code).toBe('INVALID_PDF');
    click.mockRestore();
  });
});
