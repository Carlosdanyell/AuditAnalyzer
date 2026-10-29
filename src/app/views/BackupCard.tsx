/**
 * Backup of what the tool keeps on this computer (src/shared/backup.ts): the configuration of every module, the
 * platform holidays and the justifications, in one JSON file. Shown on the Configuração screen of every module.
 */
import { useRef, useState } from 'react';
import { readBackup, type BackupRead, type ModuleConfigReaders } from '../../shared/backup';
import { configDiff } from '../../shared/configTools';
import { formatInteger } from '../../shared/format';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/cx';
import ui from '../../components/ui.module.css';
import { BUTTON, PRIMARY } from './configParts';
import styles from './ConfigView.module.css';

export type RestoredBackup = Extract<BackupRead, { ok: true }>;

interface Props {
  /** The other modules whose configuration a backup restores. */
  readers: ModuleConfigReaders;
  /** Downloads one file with the configurations and the justifications; returns how many justifications. */
  onCreate: () => number;
  /** Replaces the configurations in the backup and every justification; resolves with whether all was saved. */
  onRestore: (backup: RestoredBackup) => Promise<boolean>;
}

export function BackupCard({ readers, onCreate, onRestore }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState<{ name: string; backup: RestoredBackup } | null>(null);

  async function choose(file: File) {
    const result = readBackup(await file.text(), readers);
    if (!result.ok) {
      setPending(null);
      setMessage({ kind: 'error', text: `"${file.name}" não pode ser restaurado: ${result.errors.join('; ')}` });
      return;
    }
    setMessage(null);
    setPending({ name: file.name, backup: result });
  }

  async function confirm() {
    if (!pending) return;
    const saved = await onRestore(pending.backup);
    const n = formatInteger(pending.backup.justifications.length);
    setMessage(
      saved
        ? { kind: 'ok', text: `Cópia restaurada: configuração e ${n} justificativa(s).` }
        : { kind: 'error', text: 'A cópia foi aplicada nesta sessão, mas não foi possível salvar neste computador.' },
    );
    setPending(null);
  }

  const others = pending ? Object.keys(pending.backup.modules).map((id) => readers[id]?.label ?? id) : [];
  return (
    <section className={cx(ui.card, styles.card)} aria-labelledby="backup-title">
      <div className={styles.head}>
        <span className={ui.cardIcon}>
          <Icon name="database" />
        </span>
        <h3 id="backup-title">Cópia de segurança</h3>
      </div>
      <p className={styles.muted}>
        Um arquivo com a configuração de cada análise, os feriados e as justificativas guardadas neste computador — para trocar de computador ou
        recuperar se os dados do navegador forem apagados. Não contém dados das extrações.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={BUTTON}
          onClick={() => {
            const n = onCreate();
            setMessage({ kind: 'ok', text: `Cópia de segurança baixada: configuração e ${formatInteger(n)} justificativa(s).` });
          }}
        >
          <Icon name="download" size={15} />
          Baixar cópia de segurança
        </button>
        <button type="button" className={BUTTON} onClick={() => input.current?.click()}>
          <Icon name="upload" size={15} />
          Restaurar cópia de segurança
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className={styles.hidden}
          aria-label="Arquivo da cópia de segurança"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void choose(file);
          }}
        />
      </div>
      {message && (
        <p className={cx(ui.alert, styles[message.kind])} role={message.kind === 'error' ? 'alert' : 'status'}>
          <Icon name={message.kind === 'ok' ? 'checkCircle' : 'xCircle'} size={17} />
          <span>{message.text}</span>
        </p>
      )}
      {pending && (
        <div className={cx(ui.alert, styles.reprocess)} role="alertdialog" aria-label="Confirmar restauração">
          <Icon name="alert" size={17} />
          <span>
            Cópia "{pending.name}"{pending.backup.createdAt ? ` de ${pending.backup.createdAt}` : ''}: configuração com{' '}
            {formatInteger(configDiff(pending.backup.config).length)} diferença(s) do padrão
            {others.length > 0 ? `, configuração de ${others.join(', ')}` : ''} e {formatInteger(pending.backup.justifications.length)} justificativa(s).
            Restaurar substitui {others.length > 0 ? 'essas configurações' : 'a configuração'} e todas as justificativas salvas neste computador.
          </span>
          <div className={styles.actions}>
            <button type="button" className={PRIMARY} onClick={() => void confirm()}>
              Restaurar
            </button>
            <button type="button" className={BUTTON} onClick={() => setPending(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
