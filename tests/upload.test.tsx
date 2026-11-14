import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PdfDropzone } from '../src/components/PdfDropzone';
import { PdfEditor } from '../src/components/PdfEditor';
import { pickFiles } from '../src/hooks/useFilePicker';

afterEach(cleanup);

function pdfFile(name = 'a.pdf') {
  return new File(['%PDF-1.4\n'], name, { type: 'application/pdf' });
}

describe('pickFiles', () => {
  it('opens a temporary file input and resolves with the chosen file', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { value: [pdfFile()] });
      this.dispatchEvent(new Event('change'));
    });
    const files = await pickFiles({ accept: 'application/pdf' });
    expect(files.map((f) => f.name)).toEqual(['a.pdf']);
    expect(document.querySelector('input[type=file]')).toBeNull(); // cleaned up
    click.mockRestore();
  });

  it('resolves [] when the user cancels', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      this.dispatchEvent(new Event('cancel'));
    });
    await expect(pickFiles()).resolves.toEqual([]);
    click.mockRestore();
  });
});

describe('PdfDropzone', () => {
  it('accepts a dropped file', () => {
    const onFile = vi.fn();
    const { container } = render(<PdfDropzone onFile={onFile} />);
    const zone = container.querySelector('.rpe-dropzone')!;
    const file = pdfFile('dropped.pdf');
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: 'none' };
    fireEvent.dragEnter(zone, { dataTransfer });
    expect(zone.classList.contains('is-over')).toBe(true);
    fireEvent.drop(zone, { dataTransfer });
    expect(onFile).toHaveBeenCalledWith(file);
    expect(zone.classList.contains('is-over')).toBe(false);
  });

  it('opens the picker from the button', async () => {
    const onFile = vi.fn();
    const file = pdfFile('picked.pdf');
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { value: [file] });
      this.dispatchEvent(new Event('change'));
    });
    render(<PdfDropzone onFile={onFile} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose PDF' }));
    });
    expect(onFile).toHaveBeenCalledWith(file);
    click.mockRestore();
  });
});

describe('PdfEditor', () => {
  it('shows the upload screen when no file is given', () => {
    render(<PdfEditor />);
    expect(screen.getByRole('button', { name: 'Choose PDF' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open/ })).toBeTruthy();
  });

  it('hides upload controls when allowUpload is false', () => {
    render(<PdfEditor allowUpload={false} />);
    expect(screen.queryByRole('button', { name: 'Choose PDF' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Open/ })).toBeNull();
  });

  it('reports an error for a non-PDF upload', async () => {
    const onError = vi.fn();
    const bad = new File(['not a pdf'], 'notes.pdf');
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { value: [bad] });
      this.dispatchEvent(new Event('change'));
    });
    render(<PdfEditor onError={onError} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose PDF' }));
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0].code).toBe('INVALID_PDF');
    expect((await screen.findByRole('alert')).textContent).toContain('not a PDF');
    click.mockRestore();
  });
});
