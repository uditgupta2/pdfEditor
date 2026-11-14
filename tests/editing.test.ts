import { describe, expect, it } from 'vitest';
import { paragraphsToHtml, readParagraphs, sampleBackground } from '../src/edit/dom';
import { commitEdit, frameSignature, type ActiveEdit } from '../src/hooks/usePdfEditor';
import type { TextFrame } from '../src/edit/model';

const frame = (over: Partial<TextFrame> = {}): TextFrame => ({
  id: 'f1', x: 72, baseline: 700, width: 200, size: 12, lineHeight: 14, family: 'sans',
  color: [0, 0, 0], align: 'left', paragraphs: [{ spans: [{ text: 'Hello world' }] }], ...over,
});

function el(html: string) {
  const d = document.createElement('div');
  d.innerHTML = html;
  document.body.appendChild(d);
  return d;
}

describe('editor DOM <-> model', () => {
  it('round-trips paragraphs with styles', () => {
    const paragraphs = [
      { spans: [{ text: 'Plain ' }, { text: 'bold', bold: true }, { text: ' and ' }, { text: 'red', color: [1, 0, 0] as [number, number, number] }] },
      { spans: [] },
      { spans: [{ text: 'Under', underline: true }] },
    ];
    const out = readParagraphs(el(paragraphsToHtml(paragraphs)), [0, 0, 0]);
    expect(out).toEqual(paragraphs);
  });

  it('reads Firefox-style <br> line breaks and <b>/<i> tags', () => {
    const out = readParagraphs(el('one <b>two</b><br><i>three</i>'), [0, 0, 0]);
    expect(out).toEqual([{ spans: [{ text: 'one ' }, { text: 'two', bold: true }] }, { spans: [{ text: 'three', italic: true }] }]);
  });

  it('reads Chrome-style first line as text then <div>s', () => {
    const out = readParagraphs(el('first<div>second</div><div><br></div><div>fourth</div>'), [0, 0, 0]);
    expect(out.map((p) => p.spans.map((s) => s.text).join(''))).toEqual(['first', 'second', '', 'fourth']);
  });

  it('escapes HTML in text', () => {
    expect(paragraphsToHtml([{ spans: [{ text: '<b>&' }] }])).toBe('<div>&lt;b&gt;&amp;</div>');
  });

  it('falls back to white when the page pixels are unavailable', () => {
    expect(sampleBackground(null, { left: 0, top: 0, width: 10, height: 10 }, 100)).toEqual([1, 1, 1]);
  });
});

describe('commitEdit', () => {
  const active = (f: TextFrame, extra: Partial<ActiveEdit> = {}): ActiveEdit => ({
    pageIndex: 0, frame: f, sourceRunIds: [], initialSignature: frameSignature(f), ...extra,
  });

  it('records nothing when text was not changed', () => {
    const f = frame();
    expect(commitEdit({}, active(f, { sourceRunIds: ['0:1:0'] }), f.paragraphs)).toEqual({});
  });

  it('replaces original text: removes its runs and adds the frame', () => {
    const f = frame();
    const out = commitEdit({}, active(f, { sourceRunIds: ['0:1:0', '0:2:0'] }), [{ spans: [{ text: 'Changed' }] }]);
    expect(out[0]!.removedRuns).toEqual(['0:1:0', '0:2:0']);
    expect(out[0]!.frames[0]!.paragraphs[0]!.spans[0]!.text).toBe('Changed');
  });

  it('emptying replaced text deletes it (runs removed, no frame)', () => {
    const f = frame();
    const out = commitEdit({}, active(f, { sourceRunIds: ['0:1:0'] }), [{ spans: [] }]);
    expect(out[0]).toEqual({ removedRuns: ['0:1:0'], frames: [] });
  });

  it('re-editing an existing frame replaces it in place', () => {
    const f = frame();
    const start = { 0: { removedRuns: [], frames: [f, frame({ id: 'f2' })] } };
    const out = commitEdit(start, active(f, { existingFrameId: 'f1' }), [{ spans: [{ text: 'New' }] }]);
    expect(out[0]!.frames.map((x) => x.id)).toEqual(['f1', 'f2']);
    expect(out[0]!.frames[0]!.paragraphs[0]!.spans[0]!.text).toBe('New');
  });

  it('a new empty text box leaves no trace', () => {
    const f = frame({ paragraphs: [{ spans: [] }] });
    expect(commitEdit({}, active(f), [{ spans: [{ text: '   ' }] }])).toEqual({});
  });
});
