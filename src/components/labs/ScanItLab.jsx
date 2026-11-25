import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { useToast } from '../ui.jsx';
import {
  buildLabCsvTemplate,
  getLabPreset,
  readLabSpreadsheetRows,
  SCAN_IT_PRESETS,
} from '../../lib/labsCatalog.js';
import {
  parseAndValidateGtin,
  transposeAdjacentDigits,
} from '../../lib/psisLabEngine.js';
import { decodeBarcodeFromVideoCanvas } from '../../lib/barcodeCanvasDecoder.js';
import { downloadText } from '../../lib/sheets.js';

export default function ScanItLab({
  config,
  dataMode = 'both',
  draftState,
  onDraftChange,
  onRegisterReportBuilder,
}) {
  const toast = useToast();
  const defaultPreset = useMemo(
    () => getLabPreset('psis_scan_it', config?.presetId) || SCAN_IT_PRESETS[0],
    [config?.presetId],
  );
  const lecturerCustom = config?.customDataset || null;
  const allowStudentEdit = dataMode !== 'lecturer_only';

  const [barcodeInput, setBarcodeInput] = useState(draftState?.barcodeInput || '6031204001016');
  const [productName, setProductName] = useState('');
  const [productCategory, setProductCategory] = useState('Beverage');
  const [collection, setCollection] = useState(
    draftState?.collection
      || (dataMode === 'student_only'
        ? []
        : (lecturerCustom?.samples || defaultPreset.samples || []).slice(0, 5).map((s, idx) => ({
            id: `s_${idx}`,
            ...s,
            parsed: parseAndValidateGtin(s.barcode),
          }))),
  );
  const [transpositionTested, setTranspositionTested] = useState(Boolean(draftState?.transpositionTested));
  const [transpositionDemo, setTranspositionDemo] = useState(draftState?.transpositionDemo || null);
  const [judgement, setJudgement] = useState(draftState?.judgement || '');

  // Camera barcode scanner state
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [scannerMode, setScannerMode] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const lastCanvasScanRef = useRef(0);
  const streamRef = useRef(null);
  const scanLoopRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    onDraftChange?.({
      barcodeInput,
      collection,
      transpositionTested,
      transpositionDemo,
      judgement,
    });
  }, [barcodeInput, collection, transpositionTested, transpositionDemo, judgement]);

  // Stop camera on unmount
  useEffect(() => () => stopCamera(), []);

  const liveParsed = useMemo(() => parseAndValidateGtin(barcodeInput), [barcodeInput]);

  const geographyStats = useMemo(() => {
    const counts = new Map();
    collection.forEach((row) => {
      const org = row.parsed?.memberOrg || parseAndValidateGtin(row.barcode).memberOrg || 'Unknown';
      counts.set(org, (counts.get(org) || 0) + 1);
    });
    return [...counts.entries()]
      .map(([org, count]) => ({
        org,
        count,
        pct: collection.length ? Math.round((count / collection.length) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [collection]);

  useEffect(() => {
    onRegisterReportBuilder?.(() => {
      const lines = [
        `LABORATORY: PSIS Lab 3 — Barcode & GTIN Capture (Scan It)`,
        `COLLECTION SIZE: ${collection.length} product barcode(s)`,
        `TRANSPOSITION ERROR TRAP TESTED: ${transpositionTested ? 'YES — Verified Mod-10 check digit rejection' : 'Not yet tested'}`,
        ...(transpositionDemo
          ? [
              `  * Valid Original: ${transpositionDemo.original} (Valid)`,
              `  * Transposed Entry: ${transpositionDemo.corrupted} -> REJECTED (${transpositionDemo.error})`,
            ]
          : []),
        ``,
        `1. GS1 MEMBER ORGANIZATION LICENSING DISTRIBUTION`,
        ...(geographyStats.length
          ? geographyStats.map((g) => `- ${g.org}: ${g.count} item(s) (${g.pct}%)`)
          : ['- No products logged yet.']),
        ``,
        `2. COLLECTED BARCODE INVENTORY`,
        ...collection.map((row, idx) => {
          const p = row.parsed || parseAndValidateGtin(row.barcode);
          return `${idx + 1}. ${row.barcode} | ${row.product} (${row.category}) | ${p.format || 'Invalid'} | Prefix ${p.gs1Prefix || '-'} (${p.memberOrg || '-'}) | Check Digit: ${p.valid ? 'VALID' : 'REJECTED'}`;
        }),
        ``,
        `3. STUDENT WRITTEN AIDC & LICENSING JUDGEMENT`,
        judgement.trim() || '(No written judgement provided yet.)',
      ];
      return {
        title: 'GS1 GTIN & Barcode Capture Lab Report',
        body: lines.join('\n'),
        hasJudgement: judgement.trim().length >= 25,
      };
    });
  }, [onRegisterReportBuilder, collection, transpositionTested, transpositionDemo, geographyStats, judgement]);

  function stopCamera() {
    if (scanLoopRef.current) {
      cancelAnimationFrame(scanLoopRef.current);
      scanLoopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOn(false);
    setScannerMode('');
  }

  async function startCamera() {
    setCameraError('');
    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError('Browser camera API is not available on this device. You can still type any product barcode below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);

      setTimeout(async () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        const startCanvasFallback = () => {
          setScannerMode('canvas');
          const tickCanvas = (now) => {
            if (!videoRef.current || !streamRef.current) return;
            if (now - lastCanvasScanRef.current >= 110) {
              lastCanvasScanRef.current = now;
              try {
                const decoded = decodeBarcodeFromVideoCanvas(videoRef.current, canvasRef.current);
                if (decoded) {
                  setBarcodeInput(decoded);
                  toast(`Scanned EAN-13/UPC-A barcode: ${decoded}`);
                  stopCamera();
                  return;
                }
              } catch {
                // ignore transient frame errors
              }
            }
            scanLoopRef.current = requestAnimationFrame(tickCanvas);
          };
          scanLoopRef.current = requestAnimationFrame(tickCanvas);
        };

        if ('BarcodeDetector' in window) {
          try {
            const detector = new window.BarcodeDetector({
              formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_128'],
            });
            setScannerMode('native');
            const tick = async () => {
              if (!videoRef.current || !streamRef.current) return;
              try {
                const found = await detector.detect(videoRef.current);
                if (found?.length && found[0].rawValue) {
                  setBarcodeInput(found[0].rawValue);
                  toast(`Scanned barcode: ${found[0].rawValue}`);
                  stopCamera();
                  return;
                }
              } catch {
                // ignore frame decode glitches
              }
              scanLoopRef.current = requestAnimationFrame(tick);
            };
            scanLoopRef.current = requestAnimationFrame(tick);
          } catch {
            startCanvasFallback();
          }
        } else {
          startCanvasFallback();
        }
      }, 150);
    } catch (err) {
      setCameraError(err?.message || 'Camera permission denied or unavailable. Type any printed GTIN barcode below.');
      stopCamera();
    }
  }

  function handleTriggerTransposition() {
    if (!liveParsed.valid) {
      toast('Enter or select a valid GTIN barcode first before running the transposition error trap.', 'error');
      return;
    }
    const corrupted = transposeAdjacentDigits(liveParsed.digits);
    const badResult = parseAndValidateGtin(corrupted);
    setTranspositionTested(true);
    setTranspositionDemo({
      original: liveParsed.digits,
      corrupted,
      expectedCheck: badResult.expectedCheck,
      actualCheck: badResult.actualCheck,
      error: badResult.error,
    });
    setBarcodeInput(corrupted);
    toast('Transposed 2 adjacent digits — watch the Mod-10 check digit reject the entry!', 'error');
  }

  function handleAddToCollection(e) {
    e.preventDefault();
    if (!liveParsed.valid) {
      toast('Entry refused: GTIN check digit failed! Fix the barcode before logging it into inventory.', 'error');
      return;
    }
    const prod = productName.trim() || `Scanned Item (${liveParsed.memberOrg})`;
    setCollection((prev) => [
      {
        id: `log_${Date.now()}`,
        barcode: liveParsed.digits,
        product: prod,
        category: productCategory.trim() || 'General',
        parsed: liveParsed,
      },
      ...prev,
    ]);
    setProductName('');
    toast(`Logged "${prod}" (${liveParsed.gs1Prefix} · ${liveParsed.memberOrg}).`);
  }

  async function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readLabSpreadsheetRows(file);
      const imported = [];
      rows.forEach((r, idx) => {
        const digits = String(r[0] || '').replace(/\D+/g, '');
        if (idx === 0 && !digits) return;
        if (!digits) return;
        imported.push({
          id: `imp_${idx}_${Date.now()}`,
          barcode: digits,
          product: String(r[1] || `Product ${idx + 1}`).trim(),
          category: String(r[2] || 'General').trim(),
          parsed: parseAndValidateGtin(digits),
        });
      });
      if (!imported.length) throw new Error('Use columns: Barcode, ProductName, Category.');
      setCollection(imported);
      toast(`Imported ${imported.length} barcodes from "${file.name}".`);
    } catch (err) {
      toast(err.message || 'Could not import barcode CSV.', 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function exportCollectionCsv() {
    const header = 'Barcode,ProductName,Category,Format,GS1Prefix,MemberOrg,ValidCheckDigit';
    const rows = collection.map((row) => {
      const p = row.parsed || parseAndValidateGtin(row.barcode);
      return [
        row.barcode,
        `"${String(row.product).replace(/"/g, '""')}"`,
        `"${String(row.category).replace(/"/g, '""')}"`,
        p.format || 'Invalid',
        p.gs1Prefix || '',
        `"${String(p.memberOrg || '').replace(/"/g, '""')}"`,
        p.valid ? 'VALID' : 'INVALID',
      ].join(',');
    });
    downloadText('gtin-collection-audit.csv', [header, ...rows].join('\n'));
  }

  return (
    <div className="stack">
      {/* Top Toolbar */}
      <div className="card stack-sm" style={{ padding: 14 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="tiny muted">AUTOMATIC IDENTIFICATION &amp; DATA CAPTURE (AIDC) · GS1 GTIN LAB</div>
            <div className="small" style={{ marginTop: 2 }}>
              Scan any real product barcode in the room or dissect GTIN-8/12/13/14 digits live, then transpose two digits to watch the Mod-10 check digit reject human keying errors.
            </div>
          </div>
          <div className="row-wrap" style={{ gap: 6 }}>
            {cameraOn ? (
              <button type="button" className="btn btn-sm" onClick={stopCamera}>
                <Icon name="close" size={13} /> Stop Camera
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={startCamera}>
                <Icon name="camera" size={13} /> Scan Barcode with Camera
              </button>
            )}
            {allowStudentEdit && (
              <>
                <input ref={fileRef} type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={handleCsvUpload} />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const tpl = buildLabCsvTemplate('psis_scan_it');
                    downloadText(tpl.filename, tpl.content);
                  }}
                >
                  <Icon name="download" size={13} /> CSV Template
                </button>
                <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={13} /> Import Barcodes
                </button>
              </>
            )}
            <button type="button" className="btn btn-sm" onClick={exportCollectionCsv}>
              <Icon name="download" size={13} /> Export Log CSV
            </button>
          </div>
        </div>

        {cameraError && <div className="notice-warn small">{cameraError}</div>}

        {cameraOn && (
          <div className="card-soft stack-xs" style={{ padding: 10, alignItems: 'center' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: 440, borderRadius: 8, overflow: 'hidden', background: '#111' }}>
              <video
                ref={videoRef}
                playsInline
                muted
                style={{ width: '100%', maxHeight: 240, display: 'block', objectFit: 'cover' }}
              />
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: '8%',
                  right: '8%',
                  top: '50%',
                  height: 2,
                  background: 'rgba(220, 38, 38, 0.85)',
                  boxShadow: '0 0 8px rgba(220, 38, 38, 0.9)',
                  pointerEvents: 'none',
                }}
              />
            </div>
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div className="row-wrap" style={{ gap: 8, justifyContent: 'center' }}>
              <span className="tiny mono" style={{ fontWeight: 700, color: 'var(--teal-700)' }}>
                {scannerMode === 'native'
                  ? '● CAMERA ACTIVE — NATIVE BARCODE DETECTOR'
                  : '● CAMERA ACTIVE — UNIVERSAL CANVAS EAN-13/UPC-A SCANNER (iOS / SAFARI / FIREFOX)'}
              </span>
            </div>
            <span className="tiny muted">
              Align the horizontal red scanline cleanly across the vertical bars in good light, or key the printed digits below.
            </span>
          </div>
        )}
      </div>

      {/* Main Split: Live GTIN Dissector + Check-Digit Proof | Field Product Collection */}
      <div className="lab-split-grid">
        {/* Left: Live GTIN Dissector & Transposition Trap */}
        <div className="card stack-sm" style={{ padding: 16 }}>
          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <strong>Live GTIN Dissector &amp; Mod-10 Proof</strong>
            <button type="button" className="btn btn-sm" onClick={handleTriggerTransposition}>
              Transpose 2 Digits (Error Trap)
            </button>
          </div>

          <form onSubmit={handleAddToCollection} className="stack-sm">
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.2fr 1fr', gap: 8 }}>
              <label className="stack-xs tiny muted">
                GTIN Digits (8 / 12 / 13 / 14)
                <input
                  className="input mono"
                  style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.06em' }}
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder="6031204001016"
                />
              </label>
              <label className="stack-xs tiny muted">
                Product Name
                <input
                  className="input"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g., Bottled Water 500ml"
                />
              </label>
              <label className="stack-xs tiny muted">
                Category
                <input
                  className="input"
                  value={productCategory}
                  onChange={(e) => setProductCategory(e.target.value)}
                  placeholder="Beverage"
                />
              </label>
            </div>

            <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="row-wrap" style={{ gap: 6 }}>
                {(defaultPreset.samples || []).slice(0, 4).map((s) => (
                  <button
                    key={s.barcode}
                    type="button"
                    className="btn btn-sm mono"
                    style={{ fontSize: 11, padding: '4px 8px' }}
                    onClick={() => {
                      setBarcodeInput(s.barcode);
                      setProductName(s.product);
                      setProductCategory(s.category);
                    }}
                  >
                    {s.barcode.slice(0, 3)}…
                  </button>
                ))}
              </div>
              <button type="submit" className="btn btn-primary btn-sm">
                <Icon name="plus" size={13} /> Validate &amp; Log Product
              </button>
            </div>
          </form>

          {/* Status Banner */}
          {liveParsed.valid ? (
            <div className="notice small">
              <strong className="mono">● VALID {liveParsed.format} — CHECK DIGIT VERIFIED ({liveParsed.actualCheck})</strong>
              <div style={{ marginTop: 4 }}>
                Prefix <strong className="mono">{liveParsed.gs1Prefix}</strong> is licensed through <strong>{liveParsed.memberOrg}</strong>. Note: the GS1 prefix identifies where the barcode number was licensed, not necessarily the country of manufacture.
              </div>
            </div>
          ) : (
            <div className="notice-err small">
              <strong className="mono">▲ ENTRY REJECTED — INVALID BARCODE</strong>
              <div style={{ marginTop: 4 }}>{liveParsed.error}</div>
            </div>
          )}

          {/* Visual GTIN Structure Blocks */}
          {liveParsed.format && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
              {liveParsed.indicator !== null && (
                <div className="card-soft" style={{ padding: 10 }}>
                  <div className="tiny muted">PACKAGING</div>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{liveParsed.indicator}</div>
                </div>
              )}
              <div className="card-soft" style={{ padding: 10 }}>
                <div className="tiny muted">GS1 PREFIX</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: 'var(--teal-700)' }}>{liveParsed.gs1Prefix}</div>
                <div className="tiny muted">{liveParsed.memberOrg}</div>
              </div>
              <div className="card-soft" style={{ padding: 10 }}>
                <div className="tiny muted">COMPANY PREFIX</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{liveParsed.companyPrefix}</div>
                <div className="tiny muted">Brand owner block</div>
              </div>
              <div className="card-soft" style={{ padding: 10 }}>
                <div className="tiny muted">ITEM REF</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{liveParsed.itemRef}</div>
                <div className="tiny muted">SKU serial</div>
              </div>
              <div className="card-soft" style={{ padding: 10 }}>
                <div className="tiny muted">CHECK DIGIT</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: liveParsed.valid ? 'var(--teal-700)' : 'var(--red)' }}>
                  {liveParsed.actualCheck}
                </div>
                <div className="tiny muted">Expected: {liveParsed.expectedCheck}</div>
              </div>
            </div>
          )}

          {/* Mod-10 Step-by-Step Arithmetic Proof */}
          {liveParsed.steps?.length > 0 && (
            <div className="stack-xs">
              <div className="tiny muted" style={{ fontWeight: 600 }}>
                GS1 MOD-10 ARITHMETIC PROOF (WEIGHTED SUM = {liveParsed.weightedSum} · MOD 10 = {liveParsed.mod10} · CHECK = {liveParsed.expectedCheck})
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="table mono tiny">
                  <thead>
                    <tr>
                      <th>Pos</th>
                      {liveParsed.steps.map((s) => <th key={s.index} style={{ textAlign: 'center' }}>{s.index}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Digit</td>
                      {liveParsed.steps.map((s) => <td key={s.index} style={{ textAlign: 'center', fontWeight: 700 }}>{s.digit}</td>)}
                    </tr>
                    <tr>
                      <td>Weight</td>
                      {liveParsed.steps.map((s) => <td key={s.index} style={{ textAlign: 'center' }} className="muted">×{s.weight}</td>)}
                    </tr>
                    <tr>
                      <td>Prod</td>
                      {liveParsed.steps.map((s) => <td key={s.index} style={{ textAlign: 'center' }}>{s.product}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {transpositionDemo && (
            <div className="card-soft small stack-xs" style={{ padding: 10 }}>
              <strong className="mono tiny" style={{ color: 'var(--red)' }}>✓ TRANSPOSITION ERROR TRAP RECORDED</strong>
              <div className="tiny">
                Valid <span className="mono">{transpositionDemo.original}</span> → Swapped to <span className="mono">{transpositionDemo.corrupted}</span> → Expected check digit became <strong className="mono">{transpositionDemo.expectedCheck}</strong> instead of <strong className="mono">{transpositionDemo.actualCheck}</strong>, so the system immediately refused the manual entry.
              </div>
            </div>
          )}
        </div>

        {/* Right: Field Product Collection & Licensing Geography */}
        <div className="card stack-sm" style={{ padding: 16 }}>
          <div className="between">
            <div>
              <strong>Field Product Collection ({collection.length} items)</strong>
              <div className="tiny muted">Collect real products in the room to analyze where goods are licensed.</div>
            </div>
            {allowStudentEdit && collection.length > 0 && (
              <button type="button" className="btn btn-sm" onClick={() => setCollection([])}>
                Clear Log
              </button>
            )}
          </div>

          {/* Licensing Geography Bar Breakdown */}
          {geographyStats.length > 0 && (
            <div className="card-soft stack-xs" style={{ padding: 12 }}>
              <div className="tiny muted" style={{ fontWeight: 600 }}>GS1 LICENSING GEOGRAPHY</div>
              {geographyStats.map((g) => (
                <div key={g.org} className="stack-xs">
                  <div className="between tiny">
                    <span>{g.org}</span>
                    <span className="mono">{g.count} ({g.pct}%)</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--track)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${g.pct}%`, height: '100%', background: 'var(--teal)' }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>GTIN</th>
                  <th>Product</th>
                  <th>GS1 Licensing Org</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {collection.map((row) => {
                  const p = row.parsed || parseAndValidateGtin(row.barcode);
                  return (
                    <tr key={row.id}>
                      <td className="mono tiny" style={{ fontWeight: 600 }}>
                        <button
                          type="button"
                          style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--teal-700)', fontFamily: 'inherit', fontWeight: 700 }}
                          onClick={() => setBarcodeInput(row.barcode)}
                          title="Inspect in dissector"
                        >
                          {row.barcode}
                        </button>
                      </td>
                      <td className="small">
                        <div>{row.product}</div>
                        <div className="tiny muted">{row.category}</div>
                      </td>
                      <td className="tiny">
                        <div style={{ fontWeight: 600 }}>{p.memberOrg || 'Invalid'}</div>
                        <div className="mono muted">Prefix {p.gs1Prefix || '-'} · {p.valid ? '● OK' : '▲ ERR'}</div>
                      </td>
                      <td>
                        {allowStudentEdit && (
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label="Remove item"
                            onClick={() => setCollection((prev) => prev.filter((x) => x.id !== row.id))}
                          >
                            <Icon name="close" size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {collection.length === 0 && (
                  <tr>
                    <td colSpan={4} className="small muted" style={{ textAlign: 'center', padding: 18 }}>
                      No products logged yet. Scan a barcode or validate a GTIN on the left to build your collection.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* WRITTEN JUDGEMENT */}
      <div className="card stack-sm" style={{ padding: 16 }}>
        <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div>
            <strong>Written AIDC &amp; GS1 Licensing Judgement (Required Deliverable)</strong>
            <div className="tiny muted">
              Interpret what your collected GS1 prefixes reveal about product licensing vs. manufacturing origin, and explain why check digits + optical scanning outperform manual keying at receiving docks.
            </div>
          </div>
          <span className="tiny mono muted">{judgement.trim().length} chars</span>
        </div>
        <textarea
          className="input"
          rows={5}
          value={judgement}
          onChange={(e) => setJudgement(e.target.value)}
          placeholder="Example: Among the products we scanned, 603 prefixes were licensed through GS1 Ghana while 615 and 600 prefixes originated from GS1 Nigeria and South Africa. When I transposed two digits of 6031204001016, the Mod-10 check digit immediately rejected the entry..."
        />
      </div>
    </div>
  );
}
