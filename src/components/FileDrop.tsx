import { useId, useState, type DragEvent } from 'react';
import { Icon } from './Icon';
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
        <span className={styles.icon} aria-hidden="true">
          <Icon name="upload" size={26} />
        </span>
        <span className={styles.title}>{dragging ? 'Solte para adicionar' : 'Arraste os arquivos do CFGR700 aqui'}</span>
        <span className={styles.hint}>
          ou <span className={styles.link}>selecione no computador</span> — um ou mais arquivos .xlsx
        </span>
        <span className={styles.formats} aria-hidden="true">
          <span>.xlsx</span>
          <span>até ~1 milhão de linhas por arquivo</span>
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
          <Icon name="alert" size={16} />
          Ignorado(s) por não ser(em) .xlsx: {rejected.join(', ')}
        </p>
      )}
    </div>
  );
}
