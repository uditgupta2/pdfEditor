import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UnresolvedContentDialog } from '../src';

afterEach(cleanup);

function setup(pages = [2]) {
  const request = { fileName: 'a.pdf', pages, streams: pages.length, choose: vi.fn(), cancel: vi.fn() };
  render(<UnresolvedContentDialog request={request} />);
  return request;
}

describe('UnresolvedContentDialog', () => {
  it('names the affected pages', () => {
    setup([2, 5, 7]);
    expect(screen.getByRole('alertdialog').textContent).toContain('pages 2, 5 and 7');
  });

  it('focuses Keep, the safe choice', () => {
    setup();
    expect(document.activeElement?.textContent).toBe('Keep');
  });

  it('reports Keep, Remove and Cancel', () => {
    const r = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(r.choose).toHaveBeenLastCalledWith('keep');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(r.choose).toHaveBeenLastCalledWith('remove');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(r.cancel).toHaveBeenCalledTimes(1);
  });

  it('Escape cancels', () => {
    const r = setup();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(r.cancel).toHaveBeenCalledTimes(1);
  });
});
