import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ZoomIn, ZoomOut, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';

// Worker is configured in pdfUtils.js (imported by AnalyzePage before this component renders)

// Render once at a high resolution; zoom is handled purely via CSS width
const BASE_SCALE = 2.0;
const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.5;
const ZOOM_DEFAULT = 1.0; // 1.0 = 100% of the container width
const PAGES_PER_VIEW = 3; // Render only a few pages at a time

function PDFViewer({ pdfUrl, highlightPage }) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [numPages, setNumPages] = useState(0);
  const [currentStartPage, setCurrentStartPage] = useState(1);
  const pdfDocRef = useRef(null);

  useEffect(() => {
    if (!pdfUrl) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPages([]);
    setZoom(ZOOM_DEFAULT);
    setCurrentStartPage(1);

    let loadingTask = null;

    const loadPDF = async () => {
      try {
        loadingTask = pdfjsLib.getDocument(pdfUrl);
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

  // Render visible pages when currentStartPage or pdf changes
  useEffect(() => {
    const pdf = pdfDocRef.current;
    if (!pdf || numPages === 0) return;

    let cancelled = false;
    const endPage = Math.min(currentStartPage + PAGES_PER_VIEW - 1, numPages);

    const renderPages = async () => {
      const renderedPages = [];
      for (let i = currentStartPage; i <= endPage; i++) {
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
          renderedPages.push({
            pageNumber: i,
            dataUrl: canvas.toDataURL()
          });
        } catch (err) {
          if (cancelled) return;
          console.error(`Error rendering page ${i}:`, err);
        }
      }
      if (!cancelled) {
        setPages(renderedPages);
      }
    };

    renderPages();

    return () => {
      cancelled = true;
    };
  }, [currentStartPage, numPages]);

  // Cleanup pdf document on unmount
  useEffect(() => {
    return () => {
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, []);

  const handleZoomIn = () => setZoom(prev => Math.min(parseFloat((prev + ZOOM_STEP).toFixed(2)), ZOOM_MAX));
  const handleZoomOut = () => setZoom(prev => Math.max(parseFloat((prev - ZOOM_STEP).toFixed(2)), ZOOM_MIN));

  const handleOpenInNewWindow = () => {
    if (pdfUrl) {
      window.open(pdfUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const endPage = Math.min(currentStartPage + PAGES_PER_VIEW - 1, numPages);
  const canGoPrev = currentStartPage > 1;
  const canGoNext = endPage < numPages;

  const handlePrevPages = () => {
    setCurrentStartPage(prev => Math.max(1, prev - PAGES_PER_VIEW));
  };

  const handleNextPages = () => {
    setCurrentStartPage(prev => Math.min(prev + PAGES_PER_VIEW, numPages));
  };

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
          <button
            className="btn btn-secondary"
            onClick={handleOpenInNewWindow}
            title="Open PDF in new window"
            style={{ padding: '0.25rem 0.5rem', marginLeft: '0.25rem' }}
          >
            <ExternalLink size={16} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
            Open
          </button>
        </div>
      </div>

      {/* Page navigation */}
      {numPages > PAGES_PER_VIEW && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <button
            className="btn btn-secondary"
            onClick={handlePrevPages}
            disabled={!canGoPrev}
            style={{ padding: '0.25rem 0.5rem' }}
          >
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: '0.875rem', color: '#495057' }}>
            Pages {currentStartPage}–{endPage} of {numPages}
          </span>
          <button
            className="btn btn-secondary"
            onClick={handleNextPages}
            disabled={!canGoNext}
            style={{ padding: '0.25rem 0.5rem' }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* Scrollable viewer */}
      <div style={{
        maxHeight: '75vh',
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
              border: highlightPage === page.pageNumber ? '3px solid #ffc107' : 'none',
              borderRadius: '4px',
              overflow: 'hidden',
              width: `${zoom * 100}%`
            }}
          >
            <img
              src={page.dataUrl}
              alt={`Page ${page.pageNumber}`}
              style={{ width: '100%', display: 'block' }}
            />
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