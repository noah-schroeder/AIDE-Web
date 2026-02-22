import React, { useState, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ZoomIn, ZoomOut, ExternalLink } from 'lucide-react';

// Set up the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// Render once at a high resolution; zoom is handled purely via CSS width
const BASE_SCALE = 2.0;
const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.5;
const ZOOM_DEFAULT = 1.0; // 1.0 = 100% of the container width

function PDFViewer({ pdfUrl, highlightPage }) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);

  useEffect(() => {
    if (!pdfUrl) return;

    setLoading(true);
    setError(null);
    setPages([]);
    setZoom(ZOOM_DEFAULT);

    const loadPDF = async () => {
      try {
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        const numPages = pdf.numPages;
        const pagePromises = [];

        for (let i = 1; i <= numPages; i++) {
          pagePromises.push(
            pdf.getPage(i).then(page => {
              const viewport = page.getViewport({ scale: BASE_SCALE });
              const canvas = document.createElement('canvas');
              const context = canvas.getContext('2d');
              canvas.height = viewport.height;
              canvas.width = viewport.width;

              return page.render({
                canvasContext: context,
                viewport: viewport
              }).promise.then(() => ({
                pageNumber: i,
                dataUrl: canvas.toDataURL()
              }));
            })
          );
        }

        const renderedPages = await Promise.all(pagePromises);
        setPages(renderedPages);
        setLoading(false);
      } catch (err) {
        console.error('Error loading PDF:', err);
        setError('Failed to load PDF');
        setLoading(false);
      }
    };

    loadPDF();
  }, [pdfUrl]);

  const handleZoomIn = () => setZoom(prev => Math.min(parseFloat((prev + ZOOM_STEP).toFixed(2)), ZOOM_MAX));
  const handleZoomOut = () => setZoom(prev => Math.max(parseFloat((prev - ZOOM_STEP).toFixed(2)), ZOOM_MIN));

  const handleOpenInNewWindow = () => {
    if (pdfUrl) {
      window.open(pdfUrl, '_blank', 'noopener,noreferrer');
    }
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

      {/* Scrollable viewer — overflow-x allows panning when zoomed in */}
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
              /* zoom is applied as a percentage of the container width */
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