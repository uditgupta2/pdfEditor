import { useCallback, useRef } from 'react';

export interface PickFilesOptions {
  /** e.g. `'application/pdf,.pdf'` */
  accept?: string;
  multiple?: boolean;
}

/**
 * Open the operating system's file chooser. Must be called from a user
 * gesture (click/keypress). Resolves with `[]` if the user cancels.
 *
 * The input is briefly attached to the DOM because some mobile browsers
 * (older iOS Safari) ignore `click()` on detached inputs.
 */
export function pickFiles({ accept, multiple = false }: PickFilesOptions = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.multiple = multiple;
    input.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;opacity:0';
    let done = false;
    const finish = (files: File[]) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

export interface UseFilePickerOptions extends PickFilesOptions {
  onFiles(files: File[]): void;
}

/** `const { open } = useFilePicker({ accept: '.pdf', onFiles })` */
export function useFilePicker(options: UseFilePickerOptions) {
  const ref = useRef(options);
  ref.current = options;
  const open = useCallback(() => {
    const { onFiles, ...pick } = ref.current;
    void pickFiles(pick).then((files) => {
      if (files.length) ref.current.onFiles(files);
    });
  }, []);
  return { open };
}

export const PDF_ACCEPT = 'application/pdf,.pdf';
