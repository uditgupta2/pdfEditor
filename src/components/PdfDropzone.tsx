import { useRef } from 'react';
import { formatBytes } from '../core/load';
import { useDropTarget } from '../hooks/useDropTarget';
import { PDF_ACCEPT, useFilePicker } from '../hooks/useFilePicker';
import { IconFile } from './icons';

export interface PdfDropzoneProps {
  /** Receives the first chosen or dropped file. */
  onFile(file: File): void;
  maxFileSize?: number;
  title?: string;
  className?: string;
}

/**
 * Lets users open a PDF from their computer, by clicking (file chooser) or by
 * dragging a file onto it. On touch devices the copy switches to "Tap".
 */
export function PdfDropzone({ onFile, maxFileSize, title = 'Open a PDF', className }: PdfDropzoneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { open } = useFilePicker({ accept: PDF_ACCEPT, onFiles: (f) => f[0] && onFile(f[0]) });
  const isOver = useDropTarget(ref, { onFiles: (f) => f[0] && onFile(f[0]) });

  return (
    <div ref={ref} className={`rpe-dropzone${isOver ? ' is-over' : ''}${className ? ` ${className}` : ''}`}>
      <div className="rpe-dropzone-card">
        <span className="rpe-dropzone-icon">
          <IconFile width={32} height={32} strokeWidth={1.5} />
        </span>
        <h2 className="rpe-dropzone-title">{title}</h2>
        <p className="rpe-dropzone-hint">
          <span className="rpe-when-fine">Drag a PDF here, or</span>
          <span className="rpe-when-coarse">Choose a PDF from your device</span>
        </p>
        <button type="button" className="rpe-btn rpe-btn--primary rpe-btn--lg" onClick={open}>
          Choose PDF
        </button>
        <p className="rpe-dropzone-note">
          Files stay on your device{maxFileSize ? ` · up to ${formatBytes(maxFileSize)}` : ''}
        </p>
      </div>
    </div>
  );
}
