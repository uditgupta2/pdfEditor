import { useEffect, useRef, useState, type RefObject } from 'react';

export interface UseDropTargetOptions {
  onFiles(files: File[]): void;
  disabled?: boolean;
}

function hasFiles(e: DragEvent) {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/**
 * Makes an element accept dropped files. Returns `true` while files are
 * being dragged over it, so you can show an overlay.
 */
export function useDropTarget(ref: RefObject<HTMLElement | null>, options: UseDropTargetOptions) {
  const [isOver, setIsOver] = useState(false);
  const optsRef = useRef(options);
  optsRef.current = options;
  const disabled = options.disabled ?? false;

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    // dragenter/dragleave fire for every child; count them to know when the
    // pointer really leaves the element.
    let depth = 0;

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setIsOver(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setIsOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) optsRef.current.onFiles(files);
    };

    el.addEventListener('dragenter', onEnter);
    el.addEventListener('dragover', onOver);
    el.addEventListener('dragleave', onLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragenter', onEnter);
      el.removeEventListener('dragover', onOver);
      el.removeEventListener('dragleave', onLeave);
      el.removeEventListener('drop', onDrop);
      setIsOver(false);
    };
  }, [ref, disabled]);

  return isOver;
}
