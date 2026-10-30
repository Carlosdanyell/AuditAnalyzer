/**
 * Opens the CT2 integrity workpaper in the real Excel (COM automation, Windows only, opt-in: EXCEL_CHECK=1) with the
 * synthetic extraction of the engine tests (no real data needed): the workbook must open without repair, recalculate
 * without formula errors, show the matrix all OK and the board all "Confere", and change the statuses of B1 as the
 * engine when the tolerance (P_TOL) changes (docs/REGRAS_CT2_INTEGRIDADE.md, section 7; docs/ROTEIRO.md, Phase 11).
 * The workbook is written to the temporary folder and deleted at the end.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { parseDate } from '../../src/shared/dates';
import { analyzeCt2, hasMark } from '../../src/worker/modules/ct2Integrity/analysis';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { buildCt2Workpaper } from '../../src/worker/modules/ct2Integrity/workpaper';
import { CT2_LABELS } from '../../src/worker/modules/ct2Integrity/workpaperLabels';
import { ct2Blob } from '../synthetic/ct2Extraction';
import { ENGINE_HOLIDAYS, ENGINE_ROWS } from '../synthetic/ct2EngineFixture';

const enabled = process.platform === 'win32' && process.env.EXCEL_CHECK === '1';
const BOM = String.fromCharCode(0xfeff);

/** Opens, lists formula errors by sheet, recalculates with each tolerance and returns the Resumo and the B1 column. */
const SCRIPT = String.raw`
param([string]$xlsx, [string]$out, [string]$summary, [string]$documents, [string]$tolerances)
$ErrorActionPreference = 'Stop'
$x = New-Object -ComObject Excel.Application
$x.Visible = $false; $x.DisplayAlerts = $false; $x.ScreenUpdating = $false
try {
  $wb = $x.Workbooks.Open($xlsx, 0, $false)
  $caption = $wb.Windows.Item(1).Caption
  $x.CalculateFull()
  $errors = @{}
  foreach ($ws in $wb.Worksheets) {
    $n = 0
    try { $n = $ws.UsedRange.SpecialCells(-4123, 16).Count } catch { $n = 0 }
    $errors[$ws.Name] = $n
  }
  $results = @()
  foreach ($t in ($tolerances -split ',')) {
    $wb.Names.Item('P_TOL').RefersToRange.Value2 = [double]$t
    $x.CalculateFull()
    $ws = $wb.Worksheets.Item($summary)
    $rows = $ws.UsedRange.Row + $ws.UsedRange.Rows.Count - 1
    $vals = $ws.Range('A1:J' + $rows).Value2
    $grid = @{}
    for ($r = 1; $r -le $rows; $r++) { for ($c = 1; $c -le 10; $c++) { $v = $vals[$r, $c]; if ($null -ne $v) { $grid[[string][char](64 + $c) + $r] = $v } } }
    $docs = $wb.Worksheets.Item($documents)
    $header = $docs.Range('A1:AZ1').Value2
    $b1 = @()
    for ($c = 1; $c -le 52; $c++) {
      if ($header[1, $c] -like 'B1 *') {
        $n = $docs.UsedRange.Rows.Count
        $col = $docs.Range($docs.Cells(2, $c), $docs.Cells($n, $c)).Value2
        for ($r = 1; $r -le $n - 1; $r++) { $b1 += [string]$col[$r, 1] }
      }
    }
    $results += , @{ tolerance = $t; cells = $grid; b1 = $b1 }
  }
  @{ caption = $caption; errors = $errors; results = $results } | ConvertTo-Json -Depth 6 -Compress | Out-File $out -Encoding utf8
  $wb.Close($false)
} finally {
  $x.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($x)
}
`;

describe.skipIf(!enabled)('the CT2 workpaper in Excel', () => {
  it('opens without repair, recalculates without errors, ties out and follows P_TOL as the engine', async () => {
    const holidays = ENGINE_HOLIDAYS.map(parseDate);
    const dir = mkdtempSync(join(tmpdir(), 'auditanalyzer-ct2-'));
    try {
      for (const language of ['pt', 'en'] as const) {
        const L = CT2_LABELS[language];
        const config = ct2DefaultConfig();
        const ingested = await ingestCt2([{ name: 'sintetico.xlsx', blob: ct2Blob({ rows: ENGINE_ROWS }) }], config, () => {});
        const analysis = analyzeCt2(ingested, config, new Set(holidays));
        const out = await buildCt2Workpaper(
          { base: ingested, analysis, config, holidays, language, generatedAt: '29/10/2026 10:30:00', appVersion: 'excel', configHash: '-', configDifferences: [], confirmedFailures: [] },
          () => {},
        );
        const xlsx = join(dir, `ct2-${language}.xlsx`);
        writeFileSync(xlsx, new Uint8Array(await out.blob.arrayBuffer()));
        const scriptPath = join(dir, 'excel.ps1');
        writeFileSync(scriptPath, BOM + SCRIPT, 'utf8');
        const outPath = join(dir, `excel-${language}.json`);
        execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, xlsx, outPath, L.sheets.summary, L.sheets.documents, '0,10'], {
          stdio: 'pipe',
          timeout: 540_000,
        });
        const excel = JSON.parse(readFileSync(outPath, 'utf8').replace(BOM, '')) as {
          caption: string;
          errors: Record<string, number>;
          results: { tolerance: string; cells: Record<string, unknown>; b1: string[] }[];
        };
        expect(excel.caption, 'Excel reparou a planilha ao abrir').not.toMatch(/repar/i);
        expect(Object.entries(excel.errors).filter(([, n]) => n > 0)).toEqual([]);
        // Matrix (column G) all OK and board (column I) all "Confere", with the default tolerance.
        const cells = excel.results[0]!.cells;
        const statuses = Object.entries(cells).filter(([ref, v]) => (/^G\d+$/.test(ref) && (v === L.ok || v === L.check)) || (/^I\d+$/.test(ref) && (v === L.matches || v === L.check)));
        expect(statuses.length).toBeGreaterThan(10);
        expect(statuses.filter(([, v]) => v === L.check)).toEqual([]);
        // R$ 10,00 balances what the engine balances with the same tolerance.
        const engine = analyzeCt2(ingested, { ...config, parameters: { ...config.parameters, toleranceCents: 1000 } }, new Set(holidays));
        const expected = Array.from({ length: engine.blocks.documents }, (_, d) => (hasMark(engine.marks.document, d, 'B1') ? L.yes : L.no));
        expect(excel.results[1]!.b1).toEqual(expected);
        console.log(`[excel] CT2 ${language}: abriu sem reparo, sem erros de fórmula; ${statuses.length} status conferidos`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 600_000);
});
