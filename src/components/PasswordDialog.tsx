import { useEffect, useId, useRef, useState } from 'react';
import type { PasswordRequest } from '../hooks/usePdfEditor';
import { IconLock } from './icons';

export function PasswordDialog({ request }: { request: PasswordRequest }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    setValue('');
    inputRef.current?.focus();
  }, [request]);

  return (
    <div className="rpe-modal-backdrop">
      <form
        className="rpe-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onSubmit={(e) => {
          e.preventDefault();
          if (value) request.submit(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') request.cancel();
        }}
      >
        <span className="rpe-modal-icon">
          <IconLock />
        </span>
        <h2 id={titleId} className="rpe-modal-title">
          Password required
        </h2>
        <p id={descId} className="rpe-modal-text">
          <strong>{request.fileName}</strong> is protected. Enter its password to open it.
        </p>
        <input
          ref={inputRef}
          type="password"
          className="rpe-input rpe-input--block"
          aria-label="Password"
          aria-invalid={request.reason === 'incorrect'}
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {request.reason === 'incorrect' && (
          <p className="rpe-field-error" role="alert">
            That password is incorrect. Try again.
          </p>
        )}
        <div className="rpe-modal-actions">
          <button type="button" className="rpe-btn" onClick={request.cancel}>
            Cancel
          </button>
          <button type="submit" className="rpe-btn rpe-btn--primary" disabled={!value}>
            Open
          </button>
        </div>
      </form>
    </div>
  );
}
