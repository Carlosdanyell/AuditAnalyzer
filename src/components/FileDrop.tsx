import { useId, useState, type DragEvent } from 'react';
import { Icon } from './Icon';
import styles from './FileDrop.module.css';

interface FileDropProps {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  /** Title of the drop area (from the module of the analysis). */
  title?: string;
  /** Accepted file extensions, lower case (from the module). */
  extensions?: readonly string[];
  multiple?: boolean;
}

const XLSX = ['.xlsx'] as const;

/** Drop area plus file picker for the files of the selected analysis (one or more .xlsx by default). */
export function FileDrop({ disabled = false, onFiles, title = 'Arraste os arquivos aqui', extensions = XLSX, multiple = true }: FileDropProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const accepted = (file: File) => extensions.some((ext) => file.name.toLowerCase().endsWith(ext));

  function accept(list: FileList | null) {
    const files = Array.from(list ?? []);
    setRejected(files.filter((f) => !accepted(f)).map((f) => f.name));
    const valid = files.filter(accepted);
    if (valid.length > 0) onFiles(multiple ? valid : valid.slice(0, 1));
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
        <span className={styles.title}>{dragging ? 'Solte para adicionar' : title}</span>
        <span className={styles.hint}>
          ou <span className={styles.link}>selecione no computador</span> — {multiple ? 'um ou mais arquivos' : 'um arquivo'} {extensions.join(', ')}
        </span>
        <span className={styles.formats} aria-hidden="true">
          {extensions.map((ext) => (
            <span key={ext}>{ext}</span>
          ))}
          <span>até ~1 milhão de linhas por arquivo</span>
        </span>
        <input
          id={inputId}
          className={styles.input}
          type="file"
          accept={extensions.join(',')}
          multiple={multiple}
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
          Ignorado(s) por não ser(em) {extensions.join(' ou ')}: {rejected.join(', ')}
        </p>
      )}
    </div>
  );
}
