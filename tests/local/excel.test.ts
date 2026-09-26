/**
 * Opens the exported workpaper in the real Excel (COM automation, Windows only, opt-in: EXCEL_CHECK=1), recalculates
 * it for every preset and a custom period and compares every Resumo cell with the test evaluator (which the other
 * tests compare with the tool). Also counts formula errors in every sheet. Nothing leaves the machine: the workbook
 * is written to the temporary folder and deleted at the end. Output: cell references and counts only.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scopeBounds } from '../../src/worker/engine/panel';
import { LABELS } from '../../src/worker/export/labels';
import { Workbook, type Value } from '../support/xlsxEval';
import { loadPreviousJustifications, realInputs, realSession } from './realFiles';

const enabled = process.platform === 'win32' && process.env.EXCEL_CHECK === '1' && realInputs.length > 0;

const BOM = String.fromCharCode(0xfeff);

interface Scenario {
  label: string;
  start?: number;
  end?: number;
}

const SCRIPT = String.raw`
param([string]$xlsx, [string]$scenarios, [string]$out, [string]$sheet)
$ErrorActionPreference = 'Stop'
$list = Get-Content $scenarios -Raw -Encoding UTF8 | ConvertFrom-Json
$x = New-Object -ComObject Excel.Application
$x.Visible = $false; $x.DisplayAlerts = $false; $x.ScreenUpdating = $false
try {
  $wb = $x.Workbooks.Open($xlsx, 0, $false)
  # A workbook repaired on open has "[Repaired]" ("[Reparado]") in the window caption.
  $caption = $wb.Windows.Item(1).Caption
  $errors = @{}
  foreach ($ws in $wb.Worksheets) {
    $n = 0
    try { $n = $ws.UsedRange.SpecialCells(-4123, 16).Count } catch { $n = 0 }
    $errors[$ws.Name] = $n
  }
  $ws = $wb.Worksheets.Item($sheet)
  $rows = $ws.UsedRange.Row + $ws.UsedRange.Rows.Count - 1
  $results = @()
  foreach ($s in $list) {
    $ws.Range('A8').Value2 = $s.label
    if ($s.start) { $ws.Range('B8').Value2 = [double]$s.start; $ws.Range('C8').Value2 = [double]$s.end }
    $x.CalculateFull()
    $vals = $ws.Range('A1:J' + $rows).Value2
    $grid = @{}
    for ($r = 1; $r -le $rows; $r++) {
      for ($c = 1; $c -le 10; $c++) {
        $v = $vals[$r, $c]
        if ($null -ne $v) { $grid[[string][char](64 + $c) + $r] = $v }
      }
    }
    $results += , @{ label = $s.label; cells = $grid }
  }
  @{ caption = $caption; errors = $errors; results = $results } | ConvertTo-Json -Depth 6 -Compress | Out-File $out -Encoding utf8
  $wb.Close($false)
} finally {
  $x.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($x)
}
`;

describe.skipIf(!enabled)('the exported workpaper in Excel', () => {
  it('opens, recalculates without errors and gives the same Resumo as the evaluator', async () => {
    const session = await realSession();
    const result = session.result;
    await loadPreviousJustifications(session);
    const scopeIndex = result.analyses.length - 1;
    const bounds = scopeBounds(result.analyses[scopeIndex]!)!;
    const dir = mkdtempSync(join(tmpdir(), 'auditanalyzer-'));
    try {
      for (const language of ['pt', 'en'] as const) {
        const L = LABELS[language];
        const out = await session.export({ scope: scopeIndex, language, confirmFailures: false, generatedAt: '26/09/2026 10:00:00' });
        if ('blocked' in out) throw new Error('exportação bloqueada');
        const xlsx = join(dir, `papel-${language}.xlsx`);
        writeFileSync(xlsx, new Uint8Array(await out.blob.arrayBuffer()));

        const book = await Workbook.read(out.blob, [L.sheets.summary, L.sheets.deletionJust, L.sheets.changeJust, L.sheets.documents, L.sheets.lines, L.sheets.helper]);
        const H = L.sheets.helper;
        const presetLabels = [...book.sheets.get(H)!]
          .filter(([ref, c]) => /^A\d+$/.test(ref) && Number(ref.slice(1)) > 12 && typeof c.v === 'string' && book.raw(H, `B${ref.slice(1)}`) !== undefined)
          .map(([, c]) => c.v as string)
          .filter((l) => l !== L.values.custom);
        const scenarios: Scenario[] = [
          ...presetLabels.map((label) => ({ label })),
          { label: L.values.custom, start: bounds.startDay + 36526 + 7, end: bounds.startDay + 36526 + 13 },
        ];
        const scenariosPath = join(dir, 'cenarios.json');
        writeFileSync(scenariosPath, JSON.stringify(scenarios), 'utf8');
        const scriptPath = join(dir, 'excel.ps1');
        // Windows PowerShell 5.1 reads a script without BOM as ANSI.
        writeFileSync(scriptPath, BOM + SCRIPT, 'utf8');
        const outPath = join(dir, `excel-${language}.json`);
        execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, xlsx, scenariosPath, outPath, L.sheets.summary], {
          stdio: 'pipe',
          timeout: 540_000,
        });
        const excel = JSON.parse(readFileSync(outPath, 'utf8').replace(BOM, '')) as {
          caption: string;
          errors: Record<string, number>;
          results: { label: string; cells: Record<string, Value> }[];
        };
        expect(excel.caption, 'Excel reparou a planilha ao abrir').not.toMatch(/repar/i);
        const withErrors = Object.entries(excel.errors).filter(([, n]) => n > 0);
        console.log(`[excel] ${language}: ${scenarios.length} períodos recalculados; abas com erro de fórmula: ${withErrors.map(([s, n]) => `${s} (${n})`).join(', ') || 'nenhuma'}`);
        expect(withErrors).toEqual([]);

        const S = L.sheets.summary;
        const mismatches: string[] = [];
        excel.results.forEach((res, i) => {
          const s = scenarios[i]!;
          book.set(S, 'A8', s.label);
          if (s.start !== undefined) {
            book.set(S, 'B8', s.start);
            book.set(S, 'C8', s.end!);
          }
          for (const [ref, cell] of book.sheets.get(S)!) {
            if (cell.f === undefined) continue;
            const mine = book.value(S, ref);
            const theirs = res.cells[ref] ?? null;
            const same =
              typeof mine === 'number' && typeof theirs === 'number'
                ? Math.abs(mine - theirs) < 1e-6
                : (mine === '' || mine === null ? null : mine) === (theirs === '' ? null : theirs);
            if (!same) mismatches.push(`${i}:${ref}`);
          }
        });
        console.log(`[excel] ${language}: ${mismatches.length} célula(s) do Resumo diferente(s) do avaliador`);
        expect(mismatches).toEqual([]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
