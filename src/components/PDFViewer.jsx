import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import * as pdfjsLib from 'pdfjs-dist';
import { ZoomIn, ZoomOut, ExternalLink } from 'lucide-react';
import { locateQuoteRects, parseTargetPage } from '../utils/pdfUtils';

// Worker is configured in pdfUtils.js (imported by AnalyzePage before this component renders)

// Render once at a high resolution; zoom is handled purely via CSS width
const BASE_SCALE = 2.0;
const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.5;
const ZOOM_DEFAULT = 1.0; // 1.0 = 100% of the container width

function PDFViewer({ pdfUrl, sourceTarget, isPopup = false }) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [numPages, setNumPages] = useState(0);
  const [overlay, setOverlay] = useState(null); // { pageNumber, rects, nonce }
  const [pendingScroll, setPendingScroll] = useState(null); // { page, nonce }
  const pdfDocRef = useRef(null);
  const viewerScrollRef = useRef(null);
  // Refs for the detached "open in new window" viewer (only used when !isPopup)
  const popupWindowRef = useRef(null);
  const popupRootRef = useRef(null);

  useEffect(() => {
    if (!pdfUrl) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPages([]);
    setZoom(ZOOM_DEFAULT);
    setOverlay(null);
    setPendingScroll(null);

    let loadingTask = null;

    const loadPDF = async () => {
      try {
        // isEvalSupported: false keeps pdf.js within a strict CSP (no 'unsafe-eval').
        loadingTask = pdfjsLib.getDocument({ url: pdfUrl, isEvalSupported: false });
        const pdf = await loadingTask.promise;
        if (cancelled) {
          pdf.destroy();
          return;
        }
        // Destroy previous document
        if (pdfDocRef.current) {
          pdfDocRef.current.destroy();
        }
        pdfDocRef.current = pdf;
        setNumPages(pdf.numPages);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading PDF:', err);
        setError('Failed to load PDF');
        setLoading(false);
      }
    };

    loadPDF();

    return () => {
      cancelled = true;
      if (loadingTask) {
        loadingTask.destroy();
      }
    };
  }, [pdfUrl]);

  // Render the entire document. Pages are rendered sequentially and appended as
  // they finish, so the viewer fills in progressively rather than blocking.
  useEffect(() => {
    const pdf = pdfDocRef.current;
    if (!pdf || numPages === 0) return;

    let cancelled = false;
    setPages([]);

    const renderAllPages = async () => {
      for (let i = 1; i <= numPages; i++) {
        if (cancelled) return;
        try {
          const page = await pdf.getPage(i);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: BASE_SCALE });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({
            canvasContext: context,
            viewport: viewport
          }).promise;

          if (cancelled) return;
          const dataUrl = canvas.toDataURL();
          setPages(prev => [...prev, { pageNumber: i, dataUrl }]);
        } catch (err) {
          if (cancelled) return;
          console.error(`Error rendering page ${i}:`, err);
        }
      }
    };

    renderAllPages();

    return () => {
      cancelled = true;
    };
  }, [numPages]);

  // Cleanup pdf document on unmount
  useEffect(() => {
    return () => {
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, []);

  // Jump to the referenced page and compute the source bounding boxes when a
  // Source button is clicked. The nonce on sourceTarget makes re-clicks re-fire.
  useEffect(() => {
    const pdf = pdfDocRef.current;
    if (!sourceTarget || numPages === 0 || !pdf) return;

    const { page: pageStr, quote, nonce } = sourceTarget;
    const targetPage = parseTargetPage(pageStr, numPages);
    if (!targetPage) {
      setOverlay(null);
      return;
    }

    // Every page is rendered, so just request a scroll to the target page (it may
    // still be rendering if it's near the end — the scroll effect waits for it).
    setPendingScroll({ page: targetPage, nonce });

    // Locate the quote independently of what's currently rendered.
    let cancelled = false;
    (async () => {
      try {
        const page = await pdf.getPage(targetPage);
        const rects = await locateQuoteRects(page, quote);
        if (!cancelled) setOverlay({ pageNumber: targetPage, rects, nonce });
      } catch (err) {
        console.error('Error locating source on page:', err);
        if (!cancelled) setOverlay({ pageNumber: targetPage, rects: [], nonce });
      }
    })();

    return () => { cancelled = true; };
  }, [sourceTarget, numPages]);

  // Scroll the pending target page into view once its element has rendered.
  // Scoped to this viewer's container (via ref, not document.getElementById) so it
  // works correctly when a second instance is rendered into a popup window.
  useEffect(() => {
    if (!pendingScroll) return;
    const el = viewerScrollRef.current?.querySelector(`#pdf-page-${pendingScroll.page}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setPendingScroll(null);
    }
  }, [pages, pendingScroll]);

  // Keep the detached "open in new window" viewer in sync with the current
  // source/PDF, so clicking a different Source also re-highlights it there.
  useEffect(() => {
    if (isPopup) return;
    const win = popupWindowRef.current;
    if (win && !win.closed && popupRootRef.current) {
      popupRootRef.current.render(
        <PDFViewer pdfUrl={pdfUrl} sourceTarget={sourceTarget} isPopup />
      );
    }
  }, [pdfUrl, sourceTarget, isPopup]);

  // Tear down the popup viewer when this component unmounts.
  useEffect(() => {
    return () => {
      const root = popupRootRef.current;
      const win = popupWindowRef.current;
      popupRootRef.current = null;
      popupWindowRef.current = null;
      // Defer unmount so we don't unmount one root during another's render.
      if (root) setTimeout(() => { try { root.unmount(); } catch (e) { /* window gone */ } }, 0);
      if (win && !win.closed) win.close();
    };
  }, []);

  const handleZoomIn = () => setZoom(prev => Math.min(parseFloat((prev + ZOOM_STEP).toFixed(2)), ZOOM_MAX));
  const handleZoomOut = () => setZoom(prev => Math.max(parseFloat((prev - ZOOM_STEP).toFixed(2)), ZOOM_MIN));

  // Open (or reuse) a popup window and render a full PDFViewer into it, so the
  // bounding-box highlight is available in the detached window too. All JS runs
  // in this (opener) realm; only the DOM lives in the popup.
  const handleOpenInNewWindow = () => {
    if (!pdfUrl) return;
    let win = popupWindowRef.current;
    if (!win || win.closed) {
      win = window.open('', 'aide-pdf-popup', 'width=900,height=1000,scrollbars=yes,resizable=yes');
      if (!win) return; // blocked by popup blocker
      popupWindowRef.current = win;
      win.document.title = 'AIDE — PDF Preview';
      win.document.body.style.margin = '0';
      win.document.body.style.background = '#f8f9fa';
      // Base href so relative stylesheet/asset URLs resolve against the app origin.
      const base = win.document.createElement('base');
      base.href = window.location.href;
      win.document.head.appendChild(base);
      // Clone the app's stylesheets so the viewer looks the same in the popup.
      document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
        win.document.head.appendChild(node.cloneNode(true));
      });
      const container = win.document.createElement('div');
      container.style.padding = '0.75rem';
      win.document.body.appendChild(container);
      popupRootRef.current = createRoot(container);
    }
    popupRootRef.current.render(
      <PDFViewer pdfUrl={pdfUrl} sourceTarget={sourceTarget} isPopup />
    );
    win.focus();
  };

  // When the source quote couldn't be located, fall back to highlighting the whole page.
  const fallbackHighlightPage = overlay && overlay.rects.length === 0 ? overlay.pageNumber : null;

  if (loading) {
    return (
      <div className="box">
        <h3 className="box-title">PDF Preview</h3>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="spinner spinner-lg"></div>
          <p style={{ marginTop: '1rem' }}>Loading PDF...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="box">
        <h3 className="box-title">PDF Preview</h3>
        <div className="alert alert-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="box" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header with title and zoom controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h3 className="box-title" style={{ margin: 0 }}>PDF Preview</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            className="btn btn-secondary"
            onClick={handleZoomOut}
            disabled={zoom <= ZOOM_MIN}
            title="Zoom Out"
            style={{ padding: '0.25rem 0.5rem' }}
          >
            <ZoomOut size={16} />
          </button>
          <span style={{ fontSize: '0.875rem', minWidth: '3.5rem', textAlign: 'center', color: '#495057' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            className="btn btn-secondary"
            onClick={handleZoomIn}
            disabled={zoom >= ZOOM_MAX}
            title="Zoom In"
            style={{ padding: '0.25rem 0.5rem' }}
          >
            <ZoomIn size={16} />
          </button>
          {!isPopup && (
            <button
              className="btn btn-secondary"
              onClick={handleOpenInNewWindow}
              title="Open PDF in new window"
              style={{ padding: '0.25rem 0.5rem', marginLeft: '0.25rem' }}
            >
              <ExternalLink size={16} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
              Open
            </button>
          )}
        </div>
      </div>

      {/* Page count */}
      {numPages > 0 && (
        <div style={{ textAlign: 'center', marginBottom: '0.75rem', fontSize: '0.875rem', color: '#495057' }}>
          {pages.length < numPages
            ? `Rendering page ${pages.length} of ${numPages}…`
            : `${numPages} page${numPages === 1 ? '' : 's'}`}
        </div>
      )}

      {/* Scrollable viewer — fixed height so you see ~a page at a time and scroll the whole document */}
      <div ref={viewerScrollRef} style={{
        height: isPopup ? '95vh' : '80vh',
        overflowY: 'auto',
        overflowX: 'auto',
        border: '1px solid #dee2e6',
        borderRadius: '0.375rem',
        padding: '1rem',
        backgroundColor: '#f8f9fa'
      }}>
        {pages.map((page) => (
          <div
            key={page.pageNumber}
            id={`pdf-page-${page.pageNumber}`}
            style={{
              marginBottom: '1rem',
              border: fallbackHighlightPage === page.pageNumber ? '3px solid #ffc107' : 'none',
              borderRadius: '4px',
              overflow: 'hidden',
              width: `${zoom * 100}%`
            }}
          >
            <div style={{ position: 'relative', lineHeight: 0 }}>
              <img
                src={page.dataUrl}
                alt={`Page ${page.pageNumber}`}
                style={{ width: '100%', display: 'block' }}
              />
              {overlay?.pageNumber === page.pageNumber && overlay.rects.map((r, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: `${r.left}%`,
                    top: `${r.top}%`,
                    width: `${r.width}%`,
                    height: `${r.height}%`,
                    backgroundColor: 'rgba(255, 193, 7, 0.35)',
                    border: '1px solid rgba(255, 153, 0, 0.9)',
                    borderRadius: '2px',
                    pointerEvents: 'none'
                  }}
                />
              ))}
            </div>
            <div style={{
              textAlign: 'center',
              padding: '0.5rem',
              backgroundColor: 'white',
              borderTop: '1px solid #dee2e6',
              fontSize: '0.875rem',
              color: '#6c757d'
            }}>
              Page {page.pageNumber}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default PDFViewer;
