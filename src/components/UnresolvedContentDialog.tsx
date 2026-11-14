import { useEffect, useId, useRef } from 'react';
import type { UnresolvedContentRequest } from '../hooks/usePdfEditor';
import { IconAlert } from './icons';

function pageList(pages: number[]) {
  const label = pages.length === 1 ? 'page' : 'pages';
  const list = pages.length < 2 ? String(pages[0] ?? '') : `${pages.slice(0, -1).join(', ')} and ${pages[pages.length - 1]}`;
  return `${label} ${list}`;
}

/**
 * Shown on save, download or export when an edited page contains content the
 * editor could not read. The user keeps it, removes it, or cancels the save.
 */
export function UnresolvedContentDialog({ request }: { request: UnresolvedContentRequest }) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => keepRef.current?.focus(), [request]);

  return (
    <div className="rpe-modal-backdrop">
      <div
        className="rpe-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') request.cancel();
        }}
      >
        <span className="rpe-modal-icon">
          <IconAlert />
        </span>
        <h2 id={titleId} className="rpe-modal-title">
          Some content couldn't be read
        </h2>
        <div id={descId}>
          <p className="rpe-modal-text">
            You edited {pageList(request.pages)}, which also{' '}
            {request.pages.length === 1 ? 'contains' : 'contain'} content the editor can't read. It may be
            damaged or stored in a format the editor doesn't support.
          </p>
          <p className="rpe-modal-text">
            <strong>Keep</strong> saves that content exactly as it was. <strong>Remove</strong> leaves it out of
            the saved file, so anything it draws on the page will disappear.
          </p>
        </div>
        <div className="rpe-modal-actions">
          <button type="button" className="rpe-btn" onClick={request.cancel}>
            Cancel
          </button>
          <button type="button" className="rpe-btn" onClick={() => request.choose('remove')}>
            Remove
          </button>
          <button ref={keepRef} type="button" className="rpe-btn rpe-btn--primary" onClick={() => request.choose('keep')}>
            Keep
          </button>
        </div>
      </div>
    </div>
  );
}
