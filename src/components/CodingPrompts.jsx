import React, { useState, useImperativeHandle } from 'react';
import { Info, Save, CheckCircle, RefreshCw } from 'lucide-react';

function CodingPrompts({ prompts, responses, onResponseChange, onRecord }, ref) {
  const [recordedIndices, setRecordedIndices] = useState(new Set());
  const [showSource, setShowSource] = useState(new Set());

  const handleRecord = (index) => {
    onRecord(index, responses[index].response);
    setRecordedIndices(prev => new Set([...prev, index]));
  };

  const handleReRecord = (index) => {
    setRecordedIndices(prev => {
      const newSet = new Set(prev);
      newSet.delete(index);
      return newSet;
    });
  };

  const toggleSource = (index) => {
    setShowSource(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) newSet.delete(index);
      else newSet.add(index);
      return newSet;
    });
  };

  const resetRecordedIndices = () => {
    setRecordedIndices(new Set());
  };

  // Expose the resetRecordedIndices method to the parent component
  useImperativeHandle(ref, () => ({
    resetRecordedIndices
  }));

  return (
    <div style={{ maxHeight: '75vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
      {prompts.map((prompt, index) => {
        const isRecorded = recordedIndices.has(index);
        return (
          <div key={index} style={{
            marginBottom: '1.5rem',
            paddingBottom: '1.5rem',
            paddingLeft: '0.75rem',
            borderBottom: '1px solid #dee2e6',
            borderLeft: isRecorded ? '4px solid #28a745' : '4px solid transparent',
            backgroundColor: isRecorded ? '#f0fff4' : 'transparent',
            borderRadius: '0 0.375rem 0.375rem 0',
            transition: 'all 0.3s ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <h4 style={{
                fontSize: '1rem',
                fontWeight: 600,
                margin: 0,
                color: isRecorded ? '#1a6b30' : '#2c3e50',
                flex: 1,
              }}>
                Prompt {index + 1}: {prompt}
              </h4>
              {isRecorded && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#28a745',
                  backgroundColor: '#d4edda',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '999px',
                  whiteSpace: 'nowrap',
                }}>
                  <CheckCircle size={12} />
                  Recorded
                </span>
              )}
            </div>

            <textarea
              className="form-textarea"
              value={responses[index]?.response || ''}
              onChange={(e) => onResponseChange(index, e.target.value)}
              placeholder="Response will appear here after analysis..."
              style={{
                minHeight: '100px',
                borderColor: isRecorded ? '#28a745' : undefined,
                backgroundColor: isRecorded ? '#f8fff9' : undefined,
              }}
            />

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                className="btn btn-info"
                onClick={() => toggleSource(index)}
                disabled={!responses[index]?.source}
              >
                <Info size={16} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
                Source
              </button>

              {isRecorded ? (
                <>
                  <button
                    className="btn btn-success"
                    disabled
                    style={{ opacity: 1, cursor: 'default' }}
                  >
                    <CheckCircle size={16} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
                    Recorded ✓
                  </button>
                  <button
                    className="btn"
                    onClick={() => handleReRecord(index)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#6c757d',
                      fontSize: '0.8rem',
                      padding: '0.25rem 0.5rem',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                    }}
                  >
                    <RefreshCw size={12} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
                    Re-record
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => handleRecord(index)}
                  disabled={!responses[index]?.response}
                >
                  <Save size={16} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
                  Record
                </button>
              )}
            </div>

            {showSource.has(index) && responses[index]?.source && (
              <div style={{
                marginTop: '0.75rem',
                padding: '0.75rem',
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '0.375rem',
                fontSize: '0.875rem'
              }}>
                <strong>Source:</strong>
                <p style={{ marginTop: '0.5rem', marginBottom: '0.5rem', whiteSpace: 'pre-wrap' }}>
                  {responses[index].source}
                </p>
                {responses[index].page && (
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    <strong>Page:</strong> {responses[index].page}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default React.forwardRef(CodingPrompts);