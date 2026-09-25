import { useId, useState, type DragEvent } from 'react';
import styles from './FileDrop.module.css';

interface FileDropProps {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

const ACCEPT = '.xlsx';

function isXlsx(file: File): boolean {
  return file.name.toLowerCase().endsWith(ACCEPT);
}

/** Drop area plus file picker for one or more CFGR700 .xlsx files. */
export function FileDrop({ disabled = false, onFiles }: FileDropProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);

  function accept(list: FileList | null) {
    const files = Array.from(list ?? []);
    setRejected(files.filter((f) => !isXlsx(f)).map((f) => f.name));
    const valid = files.filter(isXlsx);
    if (valid.length > 0) onFiles(valid);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    if (!disabled) setDragging(true);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!disabled) accept(e.dataTransfer.files);
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        className={[styles.zone, dragging && styles.dragging, disabled && styles.disabled].filter(Boolean).join(' ')}
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 16V4m0 0l-4.5 4.5M12 4l4.5 4.5" />
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
        </svg>
        <span className={styles.title}>Arraste os arquivos do CFGR700 aqui</span>
        <span className={styles.hint}>
          ou <span className={styles.link}>selecione no computador</span> — um ou mais arquivos .xlsx
        </span>
        <input
          id={inputId}
          className={styles.input}
          type="file"
          accept={ACCEPT}
          multiple
          disabled={disabled}
          onChange={(e) => {
            accept(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
      </label>
      {rejected.length > 0 && (
        <p className={styles.rejected} role="alert">
          Ignorado(s) por não ser(em) .xlsx: {rejected.join(', ')}
        </p>
      )}
    </div>
  );
}
