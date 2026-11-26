import { useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { buildLabCsvTemplate, readLabSpreadsheetRows } from '../../lib/labsCatalog.js';
import {
  LAB_DATASET_SCHEMAS,
  autoDetectColumnMapping,
  parsePastedTableText,
  transformMappedRowsToDataset,
} from '../../lib/labMilestone7Engine.js';
import { downloadText } from '../../lib/sheets.js';

export function DatasetMapperPanel({
  labId,
  customDataset,
  onApplyDataset,
  onClearDataset,
  savedDatasets = [],
  onSaveToLibrary,
  onDeleteFromLibrary,
  options = {},
  toast,
}) {
  const schema = LAB_DATASET_SCHEMAS[labId] || null;
  const fileRef = useRef(null);

  const [mode, setMode] = useState('closed'); // 'closed' | 'mapper' | 'paste'
  const [pasteText, setPasteText] = useState('');
  const [rawHeaders, setRawHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [datasetName, setDatasetName] = useState('');
  const [saveToLib, setSaveToLib] = useState(true);

  const labLibrary = useMemo(
    () => (Array.isArray(savedDatasets) ? savedDatasets.filter((d) => d.labId === labId) : []),
    [savedDatasets, labId],
  );

  function loadRawTable(rows, defaultName) {
    if (!rows || rows.length < 2) {
      toast?.('Need a header row plus at least 1 data row.', 'error');
      return;
    }
    const headers = rows[0].map((h, i) => String(h || '').trim() || `Column ${i + 1}`);
    const body = rows.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
    if (!body.length) {
      toast?.('No data rows detected below the header row.', 'error');
      return;
    }
    setRawHeaders(headers);
    setRawRows(body);
    setMapping(autoDetectColumnMapping(labId, headers));
    setDatasetName(defaultName || 'Custom Course Dataset');
    setMode('mapper');
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readLabSpreadsheetRows(file);
      loadRawTable(rows, file.name.replace(/\.(csv|xlsx)$/i, ''));
    } catch (err) {
      toast?.(err?.message || 'Could not read spreadsheet file.', 'error');
    } finally {
      e.target.value = '';
    }
  }

  function handleParsePaste() {
    const rows = parsePastedTableText(pasteText);
    if (rows.length < 2) {
      toast?.('Paste a header row plus at least 1 data row from Excel, Google Sheets, or CSV.', 'error');
      return;
    }
    loadRawTable(rows, `${schema?.label || 'Pasted Dataset'} (${rows.length - 1} rows)`);
  }

  function applyMapped() {
    try {
      const { dataset, rowCount, warnings } = transformMappedRowsToDataset(labId, rawRows, mapping, {
        ...options,
        name: datasetName.trim() || 'Custom Course Dataset',
      });
      onApplyDataset?.(dataset, `${rowCount} rows mapped`);
      if (saveToLib && onSaveToLibrary) {
        onSaveToLibrary({
          id: `ds_${labId}_${Date.now()}`,
          labId,
          name: dataset.name,
          rowCount,
          savedAt: new Date().toISOString(),
          dataset,
        });
      }
      if (warnings?.length) toast?.(warnings[0]);
      else toast?.(`Loaded "${dataset.name}" (${rowCount} rows).`);
      setMode('closed');
      setPasteText('');
    } catch (err) {
      toast?.(err?.message || 'Could not apply column mapping.', 'error');
    }
  }

  return (
    <div className="stack-xs">
      <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <strong className="small">Universal Dataset Loader (Any CSV / Excel / Paste)</strong>
        <div className="row-wrap" style={{ gap: 6 }}>
          <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleFileSelect} />
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const tpl = buildLabCsvTemplate(labId, options.chartType || '');
              downloadText(tpl.filename, tpl.content);
            }}
          >
            <Icon name="download" size={13} /> Sample CSV Template
          </button>
          <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={13} /> Upload CSV / Excel
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'paste' ? 'btn-primary' : ''}`}
            onClick={() => setMode((m) => (m === 'paste' ? 'closed' : 'paste'))}
          >
            Paste Rows from Excel
          </button>
          {customDataset && (
            <button type="button" className="btn btn-sm" onClick={onClearDataset}>
              Use Starter Preset
            </button>
          )}
        </div>
      </div>

      {/* Paste-from-Excel / CSV quick box */}
      {mode === 'paste' && (
        <div className="card stack-xs" style={{ padding: 12, border: '1.5px solid var(--teal)' }}>
          <div className="between">
            <span className="tiny strong">Paste rows directly from Excel, Google Sheets, or CSV (include header row)</span>
            <button type="button" className="btn btn-sm" onClick={() => setMode('closed')}>Cancel</button>
          </div>
          <textarea
            className="input mono"
            rows={5}
            style={{ fontSize: 12 }}
            placeholder="SKU_Code, Description, Stock_On_Hand&#10;SKU-101, A4 Paper 80gsm Ream, 120&#10;SKU-102, A4 Copier Paper 80g, 45"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="between">
            <span className="tiny muted">Auto-detects tabs, commas, or semicolons — then opens the visual Column Mapper.</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleParsePaste}>
              Parse &amp; Map Columns →
            </button>
          </div>
        </div>
      )}

      {/* Visual Column Mapper + Preview */}
      {mode === 'mapper' && schema && (
        <div className="card stack-sm" style={{ padding: 14, border: '1.5px solid var(--teal)' }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <strong className="small">Map Spreadsheet Columns ({rawRows.length} rows detected)</strong>
              <div className="tiny muted">Auto-matched columns are pre-selected. Adjust any dropdown if your headers use custom names.</div>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => setMode('closed')}>Cancel</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 10, alignItems: 'end' }}>
            <label className="stack-xs tiny muted">
              Dataset Label (shown to students &amp; saved in Course Library)
              <input className="input" value={datasetName} onChange={(e) => setDatasetName(e.target.value)} />
            </label>
            <label className="check" style={{ paddingBottom: 8 }}>
              <input type="checkbox" checked={saveToLib} onChange={(e) => setSaveToLib(e.target.checked)} />
              <span className="tiny">Save to Course Dataset Library for reuse</span>
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            {schema.fields.map((field) => (
              <label key={field.key} className="stack-xs tiny">
                <span>
                  <strong>{field.label}</strong>
                  {field.required && <span style={{ color: 'var(--red)', marginLeft: 4 }}>*</span>}
                </span>
                <select
                  className="input"
                  value={mapping[field.key] ?? -1}
                  onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: Number(e.target.value) }))}
                >
                  <option value={-1}>— Not mapped —</option>
                  {rawHeaders.map((h, i) => (
                    <option key={i} value={i}>{h} (Col {i + 1})</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {/* Live 4-Row Preview */}
          <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)' }}>
                  {rawHeaders.slice(0, 8).map((h, i) => (
                    <th key={i} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rawRows.slice(0, 4).map((row, rIdx) => (
                  <tr key={rIdx}>
                    {rawHeaders.slice(0, 8).map((_, cIdx) => (
                      <td key={cIdx} style={{ padding: '5px 8px', borderBottom: '1px solid var(--line-2)' }}>
                        {String(row[cIdx] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="between">
            <span className="tiny muted">Showing first {Math.min(4, rawRows.length)} of {rawRows.length} data rows.</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={applyMapped}>
              Apply Mapped Dataset ({rawRows.length} rows)
            </button>
          </div>
        </div>
      )}

      {/* Reusable Course Dataset Library */}
      {labLibrary.length > 0 && (
        <div className="card-soft stack-xs" style={{ padding: 10 }}>
          <div className="tiny strong muted">SAVED COURSE DATASET LIBRARY FOR THIS LAB ({labLibrary.length})</div>
          <div className="stack-xs">
            {labLibrary.map((entry) => {
              const isActive = customDataset?.name === entry.dataset?.name;
              return (
                <div
                  key={entry.id}
                  className="between"
                  style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    background: isActive ? 'var(--teal-50)' : 'var(--surface)',
                    border: `1px solid ${isActive ? 'var(--teal)' : 'var(--line)'}`,
                    gap: 8,
                  }}
                >
                  <div className="tiny">
                    <strong>{entry.name}</strong>
                    <span className="muted"> · {entry.rowCount || '?'} rows</span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        onApplyDataset?.(entry.dataset, `${entry.rowCount || ''} rows from Course Library`);
                        toast?.(`Loaded "${entry.name}" from Course Library.`);
                      }}
                    >
                      {isActive ? '● Active' : 'Load'}
                    </button>
                    {onDeleteFromLibrary && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ color: 'var(--red)' }}
                        onClick={() => onDeleteFromLibrary(entry.id)}
                        title="Remove from Course Library"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
