import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { findConflicts, justificationKey, mergeImport, sameText } from '../../shared/justifications';
import type {
  Cell,
  Justification,
  JustificationCoverage,
  JustificationImportPreview,
  JustificationKind,
  JustificationStatus,
  TableId,
} from '../../shared/protocol';
import { formatCents, formatDateTime, formatInteger } from '../../shared/format';
import type { JustificationMeta } from '../justificationStore';
import type { WorkerClient } from '../workerClient';
import { TablesView, type TableRequest } from './TablesView';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/cx';
import ui from '../../components/ui.module.css';
import styles from './JustificationsView.module.css';

const LISTS: { id: TableId; label: string }[] = [
  { id: 'deletionJustifications', label: 'Exclusões' },
  { id: 'changeJustifications', label: 'Alterações' },
];
const STATUS: { id: JustificationStatus; label: string }[] = [
  { id: 'pending', label: 'Pendentes' },
  { id: 'justified', label: 'Justificados' },
  { id: 'moved', label: 'Movimentados após a justificativa' },
];

const kindOf = (table: TableId): JustificationKind => (table === 'changeJustifications' ? 'change' : 'deletion');
const msFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

interface JustificationsViewProps {
  client: WorkerClient;
  scope: number;
  request: TableRequest;
  onRequest: (request: TableRequest) => void;
  justifications: ReadonlyMap<string, Justification>;
  meta: JustificationMeta;
  unknownCount: number;
  refreshKey: number;
  onSave: (items: Justification[]) => Promise<boolean>;
  onReplaceAll: (items: Justification[]) => Promise<boolean>;
  /** Downloads the JSON copy; returns the file name and how many justifications it has, or null when there is none. */
  onExport: () => { fileName: string; count: number } | null;
}

export function JustificationsView(props: JustificationsViewProps) {
  const { client, scope, request, onRequest, justifications, meta, unknownCount, refreshKey } = props;
  const [selected, setSelected] = useState<Record<string, Cell> | null>(null);
  const [preview, setPreview] = useState<JustificationImportPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const kind = kindOf(request.table);

  useEffect(() => setSelected(null), [request.table]);

  const unsaved = meta.lastChangeAt !== null && (meta.lastExportAt === null || meta.lastChangeAt > meta.lastExportAt);

  return (
    <div className={styles.view}>
      <section className={ui.card}>
        <div className={ui.cardHead}>
          <div className={styles.titleBlock}>
            <span className={ui.cardIcon}>
              <Icon name="justify" />
            </span>
            <div>
              <h2 className={ui.cardTitle}>Guardadas neste computador</h2>
              <p className={ui.sub}>
                Clique numa linha da lista para escrever ou editar. Importe de um papel de trabalho anterior e exporte uma cópia para não
                perder o trabalho.
              </p>
            </div>
          </div>
          <div className={styles.actions}>
            <label className={cx(ui.btn, ui.secondary, styles.fileButton)}>
              <Icon name="upload" size={16} />
              Importar planilha ou JSON
              <input
                type="file"
                accept=".xlsx,.json"
                className={styles.hiddenInput}
                onChange={async (e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = '';
                  if (!file) return;
                  setMessage(null);
                  try {
                    setPreview((await client.query({ type: 'importJustifications', file })).preview);
                  } catch (err) {
                    setMessage((err as Error).message);
                  }
                }}
              />
            </label>
            <button
              type="button"
              className={cx(ui.btn, ui.secondary)}
              onClick={() => {
                const result = props.onExport();
                setMessage(
                  result
                    ? `Cópia exportada: ${result.fileName} (${formatInteger(result.count)} justificativa(s)). O arquivo foi para a pasta de downloads do navegador.`
                    : 'Ainda não há justificativas para exportar. Escreva uma (clique numa linha da lista) ou importe uma planilha ou JSON; depois exporte a cópia.',
                );
              }}
            >
              <Icon name="download" size={16} />
              Exportar cópia em JSON
            </button>
          </div>
        </div>

        <div className={styles.meta}>
          <span className={cx(ui.pill, meta.lastExportAt === null ? ui.neutral : ui.ok)}>
            <Icon name={meta.lastExportAt === null ? 'clock' : 'check'} size={13} />
            {meta.lastExportAt === null ? 'Nenhuma cópia em JSON foi feita ainda.' : `Última cópia em JSON: ${msFormat.format(meta.lastExportAt)}.`}
          </span>
          <span className={cx(ui.pill, ui.info)}>{formatInteger(justifications.size)} justificativa(s) guardada(s)</span>
        </div>
        {unsaved && (
          <p className={cx(ui.alert, ui.warn)} role="note">
            <Icon name="alert" size={17} />
            <span>
              Há justificativas alteradas depois da última cópia em JSON. Os dados do navegador podem ser apagados (limpeza do navegador,
              política da empresa): exporte uma cópia.
            </span>
          </p>
        )}
        {unknownCount > 0 && (
          <p className={ui.note}>
            {formatInteger(unknownCount)} justificativa(s) guardada(s) sem documento no log atual. Voltam a valer quando os arquivos
            correspondentes forem carregados.
          </p>
        )}
        {message && (
          <p className={cx(ui.alert, ui.info)} role="status">
            <Icon name="info" size={17} />
            <span>{message}</span>
          </p>
        )}
        <details className={styles.help}>
          <summary>
            <Icon name="help" size={15} />
            Como funciona
          </summary>
          <ul>
            <li>
              <strong>Justificar:</strong> clique num documento da lista (Exclusões ou Alterações), escreva o motivo e clique em Salvar. Um
              documento com exclusão e alteração tem uma justificativa em cada lista.
            </li>
            <li>
              <strong>Onde ficam:</strong> neste computador, dentro do navegador. Não são enviadas a nenhum servidor e valem para as próximas
              análises, mesmo com outros arquivos.
            </li>
            <li>
              <strong>Exportar cópia em JSON:</strong> baixa um arquivo com todas as justificativas. Serve de backup (limpar os dados do
              navegador apaga as justificativas) e para levá-las a outro computador.
            </li>
            <li>
              <strong>Importar planilha ou JSON:</strong> traz justificativas já escritas, sem redigitar — de um papel de trabalho entregue
              antes (a planilha .xlsx com as abas “Justificativa da Exclusao” e “Justificativa da Alteração”) ou de um JSON exportado aqui.
              Antes de aplicar, a tela mostra o que será importado e os conflitos.
            </li>
            <li>
              <strong>Movimentado após a justificativa:</strong> o documento teve nova exclusão ou alteração num arquivo que a justificativa
              não cobria. Abra, confira e clique em “Abrange o novo evento” ou reescreva.
            </li>
          </ul>
        </details>
      </section>

      {preview && (
        <Modal label="Importar justificativas" onClose={() => setPreview(null)}>
          <ImportPreview
            preview={preview}
            existing={[...justifications.values()]}
            onCancel={() => setPreview(null)}
            onApply={async (items, summary) => {
              const saved = await props.onReplaceAll(items);
              setPreview(null);
              setMessage(
                `Importação aplicada: ${summary.added} nova(s), ${summary.replaced} substituída(s), ${summary.kept} mantida(s) por conflito, ` +
                  `${summary.unchanged} igual(is), ${summary.confirmed} com cobertura confirmada, ${summary.empty} vazia(s) ignorada(s).` +
                  (saved ? '' : ' Não foi possível salvar neste computador; vale apenas nesta sessão.'),
              );
            }}
          />
        </Modal>
      )}

      <div className={cx(styles.workspace, selected && styles.withEditor)}>
        <div className={styles.list}>
          <TablesView
            client={client}
            scope={scope}
            request={request}
            onRequest={onRequest}
            tabs={LISTS}
            refreshKey={refreshKey}
            selectedKey={selected ? String(selected.documento) : null}
            onRowClick={setSelected}
            toolbar={
              <select
                className={ui.input}
                aria-label="Situação"
                value={request.filter.status ?? ''}
                onChange={(e) => {
                  const { status: _s, ...rest } = request.filter;
                  void _s;
                  onRequest({ ...request, filter: e.target.value ? { ...rest, status: e.target.value as JustificationStatus } : rest });
                }}
              >
                <option value="">Todas as situações</option>
                {STATUS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            }
          />
        </div>

        {selected && (
          <Editor
            key={`${kind}|${String(selected.documento)}`}
            kind={kind}
            row={selected}
            justifications={justifications}
            onClose={() => setSelected(null)}
            onSave={async (j, situacao) => {
              const saved = await props.onSave([j]);
              // Reflect the new status in the editor at once (the list reloads from the worker).
              setSelected((row) => row && { ...row, situacao, justificativa: j.text, responsavel: j.responsible, cobertura: coverageText(j) });
              setMessage(saved ? 'Justificativa salva neste computador.' : 'Não foi possível salvar neste computador; vale apenas nesta sessão.');
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Dialog over the page: Escape or a click on the backdrop closes it; focus moves into it. */
function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className={styles.modal} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

/** Same text as the "Cobertura da justificativa" column. */
function coverageText(j: Justification): string {
  if (!j.text.trim()) return '';
  const files = j.coverage.files.join(', ') || 'nenhum arquivo';
  return j.coverage.lastEvent === null ? files : `${files} · até ${formatDateTime(j.coverage.lastEvent)}`;
}

function coverageFromRow(row: Record<string, Cell>): JustificationCoverage {
  const files = String(row.arquivosMovimento ?? '')
    .split(', ')
    .filter(Boolean);
  return { files, lastEvent: typeof row.ultimoEvento === 'number' ? row.ultimoEvento : null };
}

function Editor({
  kind,
  row,
  justifications,
  onSave,
  onClose,
}: {
  kind: JustificationKind;
  row: Record<string, Cell>;
  justifications: ReadonlyMap<string, Justification>;
  onSave: (j: Justification, situacao: string) => Promise<void>;
  onClose: () => void;
}) {
  const documentKey = String(row.documento);
  const current = justifications.get(justificationKey(kind, documentKey));
  const otherKind: JustificationKind = kind === 'deletion' ? 'change' : 'deletion';
  const other = justifications.get(justificationKey(otherKind, documentKey));
  const [text, setText] = useState(current?.text ?? '');
  const [responsible, setResponsible] = useState(current?.responsible ?? '');
  const moved = row.situacao === 'Movimentado após a justificativa';
  const dirty = text !== (current?.text ?? '') || responsible !== (current?.responsible ?? '');

  const build = (coverage: JustificationCoverage): Justification => ({
    documentKey,
    kind,
    text: text.trim(),
    responsible: responsible.trim(),
    coverage,
    updatedAt: Date.now(),
  });
  // A new justification covers the document's current movement; editing keeps the coverage until confirmed.
  const coverage = current && current.text.trim() ? current.coverage : coverageFromRow(row);

  const statusTone = row.situacao === 'Justificado' ? ui.ok : moved ? ui.warn : ui.neutral;

  return (
    <section className={cx(ui.card, styles.editor)} aria-label="Editar justificativa">
      <div className={styles.editorHead}>
        <div className={styles.editorTitle}>
          <span className={styles.eyebrow}>{kind === 'deletion' ? 'Exclusão' : 'Alteração'}</span>
          <h3>{kind === 'deletion' ? 'Justificativa da exclusão' : 'Justificativa da alteração'}</h3>
          <p className={styles.key}>{documentKey}</p>
        </div>
        <button type="button" className={cx(ui.btn, ui.ghost, ui.iconBtn)} onClick={onClose} aria-label="Fechar" title="Fechar">
          <Icon name="x" size={18} />
        </button>
      </div>

      <span className={cx(ui.pill, statusTone, styles.status)}>{String(row.situacao)}</span>

      <dl className={styles.details}>
        <div>
          <dt>Valor do documento</dt>
          <dd>{typeof row.valorDocumento === 'number' ? formatCents(row.valorDocumento) : '—'}</dd>
        </div>
        {typeof row.valorExcluido === 'number' && (
          <div>
            <dt>Valor excluído</dt>
            <dd>{formatCents(row.valorExcluido)}</dd>
          </div>
        )}
        <div>
          <dt>{kind === 'deletion' ? 'Exclusões em' : 'Alterações em'}</dt>
          <dd>{String(row.arquivosMovimento || '—')}</dd>
        </div>
        {typeof row.ultimoEvento === 'number' && (
          <div>
            <dt>Último evento</dt>
            <dd>{formatDateTime(row.ultimoEvento)}</dd>
          </div>
        )}
        {row.historico ? (
          <div className={styles.wide}>
            <dt>Histórico</dt>
            <dd>{String(row.historico)}</dd>
          </div>
        ) : null}
        {row.cobertura ? (
          <div className={styles.wide}>
            <dt>Cobertura atual</dt>
            <dd>{String(row.cobertura)}</dd>
          </div>
        ) : null}
      </dl>

      {moved && (
        <p className={cx(ui.alert, ui.warn)}>
          <Icon name="alert" size={17} />
          <span>O documento voltou a ser movimentado num arquivo não coberto por esta justificativa. Confirme se ela abrange o novo evento.</span>
        </p>
      )}
      <textarea
        className={cx(ui.input, styles.text)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Texto da justificativa"
        aria-label="Texto da justificativa"
      />
      <label className={ui.field}>
        Responsável (opcional)
        <input className={ui.input} value={responsible} onChange={(e) => setResponsible(e.target.value)} />
      </label>
      <div className={styles.editorActions}>
        {other && other.text.trim() && !sameText(other.text, text) && (
          <button
            type="button"
            className={cx(ui.btn, ui.secondary, ui.sm)}
            onClick={() => {
              setText(other.text);
              if (!responsible.trim()) setResponsible(other.responsible);
            }}
          >
            <Icon name="copy" size={15} />
            Copiar da lista de {otherKind === 'deletion' ? 'exclusões' : 'alterações'}
          </button>
        )}
        {moved && (
          <button type="button" className={cx(ui.btn, ui.secondary, ui.sm)} onClick={() => void onSave(build(coverageFromRow(row)), 'Justificado')}>
            <Icon name="checkCircle" size={15} />
            Abrange o novo evento
          </button>
        )}
        <button
          type="button"
          className={cx(ui.btn, ui.primary, styles.save)}
          disabled={!dirty}
          onClick={() => {
            const j = build(coverage);
            const situacao = !j.text ? 'Pendente' : moved && coverage === current?.coverage ? 'Movimentado após a justificativa' : 'Justificado';
            void onSave(j, situacao);
          }}
        >
          Salvar
        </button>
      </div>
    </section>
  );
}

function ImportPreview({
  preview,
  existing,
  onApply,
  onCancel,
}: {
  preview: JustificationImportPreview;
  existing: Justification[];
  onApply: (items: Justification[], summary: ReturnType<typeof mergeImport>['summary']) => Promise<void>;
  onCancel: () => void;
}) {
  const [files, setFiles] = useState<string[]>(preview.coverage.files);
  const [replace, setReplace] = useState<Set<string>>(new Set());
  const conflicts = useMemo(() => findConflicts(existing, preview.items), [existing, preview.items]);
  const changedChoice = files.join('|') !== preview.coverage.files.join('|');
  const lastOf = (names: string[]) => {
    const lasts = preview.loadedFiles.filter((f) => names.includes(f.name)).map((f) => f.lastEvent).filter((t): t is number => t !== null);
    return lasts.length ? Math.max(...lasts) : null;
  };
  const withText = preview.items.filter((i) => i.text.trim()).length;
  const confirmed = preview.items.filter((i) => i.confirmed).length;
  const method = {
    rastreabilidade: 'deduzida da aba Rastreabilidade da planilha importada.',
    eventos:
      preview.coverage.lastEvent !== null
        ? `deduzida pela data do último evento encontrada em Documentos/Base_Linhas (${formatDateTime(preview.coverage.lastEvent)}).`
        : 'deduzida pelos eventos da planilha.',
    json: 'cada justificativa do JSON traz a sua; a escolha abaixo vale só para as que não trazem.',
    ferramenta:
      'cada justificativa exportada pela ferramenta traz a sua; a escolha abaixo vale só para as que não trazem (textos novos escritos no Excel).',
    nenhum: 'não foi possível deduzir (a planilha não tem Rastreabilidade nem datas de evento). Escolha os arquivos abaixo.',
  }[preview.coverage.method];

  return (
    <section className={styles.importPanel}>
      <div className={styles.importHead}>
        <span className={ui.cardIcon}>
          <Icon name="upload" />
        </span>
        <div>
          <h3>Importar justificativas</h3>
          <p className={ui.sub}>Revise a cobertura e os conflitos antes de aplicar.</p>
        </div>
        <button type="button" className={cx(ui.btn, ui.ghost, ui.iconBtn, styles.importClose)} onClick={onCancel} aria-label="Fechar a importação" title="Fechar">
          <Icon name="x" size={18} />
        </button>
      </div>
      <p className={styles.importStats}>
        {formatInteger(preview.items.length)} lida(s): {formatInteger(withText)} com texto, {formatInteger(preview.items.length - withText)} vazia(s),{' '}
        {formatInteger(confirmed)} com a observação “abrange o novo evento”, {formatInteger(preview.unknownKeys)} sem documento no log atual
        (guardadas mesmo assim).
      </p>
      <fieldset className={styles.fieldset}>
        <legend>Arquivos cobertos pelas justificativas importadas — {method}</legend>
        {preview.loadedFiles.map((f) => (
          <label key={f.name} className={styles.check}>
            <input
              type="checkbox"
              checked={files.includes(f.name)}
              onChange={(e) =>
                setFiles((cur) =>
                  e.target.checked
                    ? preview.loadedFiles.map((x) => x.name).filter((n) => n === f.name || cur.includes(n))
                    : cur.filter((n) => n !== f.name),
                )
              }
            />
            {f.name}
            {f.firstEvent !== null && f.lastEvent !== null && (
              <span className={styles.muted}>
                {' '}
                ({formatDateTime(f.firstEvent)} a {formatDateTime(f.lastEvent)})
              </span>
            )}
          </label>
        ))}
        <p className={ui.note}>As justificativas com a observação “abrange o novo evento” cobrem todos os arquivos carregados.</p>
      </fieldset>

      {conflicts.length > 0 && (
        <div className={styles.conflicts}>
          <div className={styles.conflictHead}>
            <h4>
              <Icon name="alert" size={16} />
              {formatInteger(conflicts.length)} conflito(s): o documento já tem outro texto
            </h4>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={replace.size === conflicts.length}
                onChange={(e) =>
                  setReplace(e.target.checked ? new Set(conflicts.map((c) => justificationKey(c.kind, c.documentKey))) : new Set())
                }
              />
              Substituir todos pelo texto importado
            </label>
          </div>
          <table className={styles.conflictTable}>
            <thead>
              <tr>
                <th>Documento</th>
                <th>Texto atual</th>
                <th>Texto importado</th>
                <th>Substituir</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => {
                const key = justificationKey(c.kind, c.documentKey);
                return (
                  <tr key={key}>
                    <td className={styles.key}>
                      {c.documentKey}
                      <br />
                      <span className={styles.muted}>{c.kind === 'deletion' ? 'exclusão' : 'alteração'}</span>
                    </td>
                    <td>{c.existing}</td>
                    <td>{c.imported}</td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Substituir a justificativa de ${c.documentKey}`}
                        checked={replace.has(key)}
                        onChange={(e) =>
                          setReplace((cur) => {
                            const next = new Set(cur);
                            if (e.target.checked) next.add(key);
                            else next.delete(key);
                            return next;
                          })
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={ui.note}>Diferenças só de espaços ou quebras de linha não contam como conflito.</p>
        </div>
      )}

      <div className={styles.importActions}>
        <button type="button" className={cx(ui.btn, ui.secondary)} onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          className={cx(ui.btn, ui.primary)}
          onClick={() => {
            const all = preview.loadedFiles.map((f) => f.name);
            const result = mergeImport(existing, preview.items, {
              coverage: { files, lastEvent: changedChoice ? lastOf(files) : preview.coverage.lastEvent },
              confirmedCoverage: { files: all, lastEvent: lastOf(all) },
              replace,
              now: Date.now(),
            });
            void onApply(result.items, result.summary);
          }}
        >
          Aplicar importação
        </button>
      </div>
    </section>
  );
}
