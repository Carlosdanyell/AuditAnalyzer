import { useEffect, useMemo, useState } from 'react';
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
import { formatDateTime, formatInteger } from '../../shared/format';
import type { JustificationMeta } from '../justificationStore';
import type { WorkerClient } from '../workerClient';
import { TablesView, type TableRequest } from './TablesView';
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
  onExport: () => void;
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
      <section className={styles.card}>
        <div className={styles.head}>
          <div>
            <h2>Justificativas</h2>
            <p className={styles.muted}>
              Uma justificativa por documento e por tipo. Ficam guardadas neste computador, inclusive as de documentos que não estão no
              log atual.
            </p>
          </div>
          <div className={styles.actions}>
            <label className={styles.button}>
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
            <button type="button" className={styles.button} onClick={props.onExport} disabled={justifications.size === 0}>
              Exportar cópia em JSON
            </button>
          </div>
        </div>
        <p className={styles.muted}>
          {meta.lastExportAt === null ? 'Nenhuma cópia em JSON foi feita ainda.' : `Última cópia em JSON: ${msFormat.format(meta.lastExportAt)}.`}
        </p>
        {unsaved && (
          <p className={styles.warning} role="note">
            Há justificativas alteradas depois da última cópia em JSON. Os dados do navegador podem ser apagados (limpeza do navegador,
            política da empresa): exporte uma cópia.
          </p>
        )}
        {unknownCount > 0 && (
          <p className={styles.muted}>
            {formatInteger(unknownCount)} justificativa(s) guardada(s) sem documento no log atual. Voltam a valer quando os arquivos
            correspondentes forem carregados.
          </p>
        )}
        {message && <p className={styles.info}>{message}</p>}
      </section>

      {preview && (
        <ImportPreview
          preview={preview}
          existing={[...justifications.values()]}
          onCancel={() => setPreview(null)}
          onApply={async (items, summary) => {
            const saved = await props.onReplaceAll(items);
            setPreview(null);
            setMessage(
              `Importação aplicada: ${summary.added} nova(s), ${summary.replaced} substituída(s), ${summary.kept} mantida(s) por conflito, ` +
                `${summary.unchanged} igual(is), ${summary.empty} vazia(s) ignorada(s).` +
                (saved ? '' : ' Não foi possível salvar neste computador; vale apenas nesta sessão.'),
            );
          }}
        />
      )}

      {selected && (
        <Editor
          key={`${kind}|${String(selected.documento)}`}
          kind={kind}
          row={selected}
          justifications={justifications}
          onClose={() => setSelected(null)}
          onSave={async (j) => {
            const saved = await props.onSave([j]);
            setMessage(saved ? 'Justificativa salva neste computador.' : 'Não foi possível salvar neste computador; vale apenas nesta sessão.');
          }}
        />
      )}

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
  );
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
  onSave: (j: Justification) => Promise<void>;
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

  return (
    <section className={styles.card} aria-label="Editar justificativa">
      <div className={styles.head}>
        <div>
          <h3>{kind === 'deletion' ? 'Justificativa da exclusão' : 'Justificativa da alteração'}</h3>
          <p className={styles.key}>{documentKey}</p>
          <p className={styles.muted}>
            Situação: <strong>{String(row.situacao)}</strong> · {kind === 'deletion' ? 'Exclusões' : 'Alterações'} em{' '}
            {String(row.arquivosMovimento || '—')}
            {typeof row.ultimoEvento === 'number' && ` · último evento ${formatDateTime(row.ultimoEvento)}`}
          </p>
          {row.cobertura && <p className={styles.muted}>Cobertura atual: {String(row.cobertura)}</p>}
        </div>
        <button type="button" className={styles.link} onClick={onClose}>
          Fechar
        </button>
      </div>
      {moved && (
        <p className={styles.warning}>
          O documento voltou a ser movimentado num arquivo não coberto por esta justificativa. Confirme se ela abrange o novo evento.
        </p>
      )}
      <textarea
        className={styles.text}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Texto da justificativa"
        aria-label="Texto da justificativa"
      />
      <div className={styles.row}>
        <label className={styles.inline}>
          Responsável (opcional)
          <input value={responsible} onChange={(e) => setResponsible(e.target.value)} />
        </label>
        <div className={styles.actions}>
          {other && other.text.trim() && !sameText(other.text, text) && (
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setText(other.text);
                if (!responsible.trim()) setResponsible(other.responsible);
              }}
            >
              Copiar da lista de {otherKind === 'deletion' ? 'exclusões' : 'alterações'}
            </button>
          )}
          {moved && (
            <button type="button" className={styles.button} onClick={() => void onSave(build(coverageFromRow(row)))}>
              Abrange o novo evento
            </button>
          )}
          <button type="button" className={styles.primary} disabled={!dirty} onClick={() => void onSave(build(coverage))}>
            Salvar
          </button>
        </div>
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
    nenhum: 'não foi possível deduzir (a planilha não tem Rastreabilidade nem datas de evento). Escolha os arquivos abaixo.',
  }[preview.coverage.method];

  return (
    <section className={styles.card} aria-label="Importar justificativas">
      <h3>Importar justificativas</h3>
      <p className={styles.muted}>
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
        <p className={styles.muted}>As justificativas com a observação “abrange o novo evento” cobrem todos os arquivos carregados.</p>
      </fieldset>

      {conflicts.length > 0 && (
        <div className={styles.conflicts}>
          <div className={styles.head}>
            <h4>{formatInteger(conflicts.length)} conflito(s): o documento já tem outro texto</h4>
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
          <p className={styles.muted}>Diferenças só de espaços ou quebras de linha não contam como conflito.</p>
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          className={styles.primary}
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
