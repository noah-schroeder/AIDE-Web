import React, { useState, useEffect } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';

function FinalFormPage() {
  const [codingFormData, setCodingFormData] = useState(null);

  useEffect(() => {
    const saved = sessionStorage.getItem('aide_coding_form_data');
    if (saved) {
      try {
        setCodingFormData(JSON.parse(saved));
      } catch (e) {
        console.error('Error parsing coding form data:', e);
      }
    }
  }, []);

  const handleDownloadExcel = () => {
    if (!codingFormData) return;
    const ws_data = [
      codingFormData.headers,
      ...codingFormData.rows.map(row =>
        codingFormData.headers.map(header => row[header] || '')
      )
    ];
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Final Coding Form');
    const timestamp = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `aide_final_coding_form_${timestamp}.xlsx`);
  };

  const handleDownloadCSV = () => {
    if (!codingFormData) return;
    const rows = [
      codingFormData.headers,
      ...codingFormData.rows.map(row =>
        codingFormData.headers.map(header => {
          const val = String(row[header] || '');
          return val.includes(',') || val.includes('"') || val.includes('\n')
            ? `"${val.replace(/"/g, '""')}"`
            : val;
        })
      )
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aide_final_coding_form_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-container">
      {/* Header Box */}
      <div className="box">
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          flexWrap: 'wrap', 
          gap: '1rem' 
        }}>
          <div>
            <h2 className="box-title" style={{ marginBottom: '0.25rem' }}>Final Coding Form</h2>
            {codingFormData && (
              <p style={{ color: '#6c757d', margin: 0, fontSize: '0.9rem' }}>
                {codingFormData.rows.length} rows · {codingFormData.headers.length} columns
                {codingFormData.fileName && ` · ${codingFormData.fileName}`}
              </p>
            )}
          </div>

          {codingFormData && (
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button className="btn btn-success" onClick={handleDownloadExcel}>
                <Download size={18} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
                Download Excel
              </button>
              <button className="btn btn-secondary" onClick={handleDownloadCSV}>
                <Download size={18} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
                Download CSV
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table Box */}
      {!codingFormData ? (
        <div className="box" style={{ textAlign: 'center', padding: '3rem' }}>
          <FileSpreadsheet size={48} style={{ color: '#adb5bd', marginBottom: '1rem' }} />
          <h3 style={{ color: '#6c757d', marginBottom: '0.5rem' }}>No coding form loaded</h3>
          <p style={{ color: '#adb5bd' }}>
            Upload a coding form in the <strong>Setup</strong> tab to see results here.
          </p>
        </div>
      ) : (
        <div className="box" style={{ 
          padding: '0', 
          overflow: 'hidden', // Keeps the box itself from expanding
          border: '1px solid #dee2e6',
          borderRadius: '8px'
        }}>
          <div style={{
            overflowX: 'auto', // Enables horizontal scroll
            overflowY: 'auto', // Enables vertical scroll
            maxHeight: '70vh',
            width: '100%',
            WebkitOverflowScrolling: 'touch'
          }}>
            <table style={{
              width: 'max-content', // Crucial: allows table to exceed container width
              minWidth: '100%',
              borderCollapse: 'separate', // Required for sticky borders to work correctly
              borderSpacing: 0,
              fontSize: '0.875rem',
              tableLayout: 'fixed' 
            }}>
              <thead>
                <tr>
                  <th style={{
                    position: 'sticky',
                    top: 0,
                    left: 0,
                    zIndex: 10,
                    background: '#2c3e50',
                    color: 'white',
                    padding: '0.75rem 1rem',
                    borderRight: '2px solid #4a6278',
                    borderBottom: '2px solid #4a6278',
                    width: '60px'
                  }}>#</th>
                  {codingFormData.headers.map((header, idx) => (
                    <th key={idx} style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 5,
                      background: '#2c3e50',
                      color: 'white',
                      padding: '0.75rem 1rem',
                      textAlign: 'left',
                      borderRight: '1px solid #4a6278',
                      borderBottom: '2px solid #4a6278',
                      width: '200px', // Fixed width for horizontal consistency
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      <span title={header}>{header}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {codingFormData.rows.map((row, rowIdx) => (
                  <tr 
                    key={rowIdx} 
                    style={{ backgroundColor: rowIdx % 2 === 0 ? 'white' : '#f8f9fa' }}
                  >
                    <td style={{
                      position: 'sticky',
                      left: 0,
                      zIndex: 2,
                      background: rowIdx % 2 === 0 ? 'white' : '#f8f9fa',
                      padding: '0.6rem 1rem',
                      borderRight: '2px solid #dee2e6',
                      borderBottom: '1px solid #dee2e6',
                      color: '#6c757d',
                      textAlign: 'center'
                    }}>{rowIdx + 1}</td>
                    {codingFormData.headers.map((header, colIdx) => (
                      <td key={colIdx} style={{
                        padding: '0.6rem 1rem',
                        borderRight: '1px solid #dee2e6',
                        borderBottom: '1px solid #dee2e6',
                        width: '200px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        <span title={row[header] || ''}>{row[header] || ''}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default FinalFormPage;