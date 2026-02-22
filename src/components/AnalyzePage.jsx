import React, { useState, useEffect, useRef } from 'react';
import { Upload, Play, FileText, AlertCircle, SkipForward, Cpu, CheckCircle, Info } from 'lucide-react';
import PDFViewer from './PDFViewer';
import CodingPrompts from './CodingPrompts';
import { extractTextFromPDF } from '../utils/pdfUtils';
import { callLLMAPI } from '../utils/apiUtils';

function AnalyzePage() {
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfText, setPdfText] = useState('');
  const [pdfMode, setPdfMode] = useState('send-pdf');
  const [pdfModeAutoSet, setPdfModeAutoSet] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [codingFormData, setCodingFormData] = useState(null);
  const [responses, setResponses] = useState([]);
  const [error, setError] = useState('');
  const [apiConfig, setApiConfig] = useState(null);
  const [analysisProgress, setAnalysisProgress] = useState('');
  
  const codingPromptsRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const endpoint = sessionStorage.getItem('aide_api_endpoint');
    const key = sessionStorage.getItem('aide_api_key');
    const context = sessionStorage.getItem('aide_context_window');
    const model = sessionStorage.getItem('aide_model');
    const formData = sessionStorage.getItem('aide_coding_form_data');
    const capabilitiesRaw = sessionStorage.getItem('aide_model_capabilities');

    if (endpoint && key) {
      setApiConfig({
        endpoint,
        apiKey: key,
        contextWindow: context ? parseInt(context) : null,
        model: model || ''
      });
    }

    if (formData) {
      try {
        const parsed = JSON.parse(formData);
        setCodingFormData(parsed);
        setResponses(parsed.headers.map(() => ({ response: '', source: '', page: '' })));
      } catch (e) {
        console.error('Error parsing form data:', e);
      }
    }

    if (model && capabilitiesRaw) {
      try {
        const caps = JSON.parse(capabilitiesRaw);
        const modalities = caps[model] || [];
        const supportsPDF = modalities.includes('file');
        setPdfMode(supportsPDF ? 'send-pdf' : 'text-only');
        setPdfModeAutoSet(true);
      } catch (e) {
        // fallback
      }
    }
  }, []);

  const handlePDFUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setPdfFile(file);
    setPdfUrl(URL.createObjectURL(file));
    setError('');
    setResponses(codingFormData?.headers.map(() => ({ response: '', source: '', page: '' })) || []);
    try {
      const text = await extractTextFromPDF(file);
      setPdfText(text);
    } catch (err) {
      console.error('Error extracting text from PDF:', err);
      setError('Could not extract text from PDF');
    }
  };

  const handleRecordResponse = (index, response) => {
    if (!codingFormData) return;
    if (codingFormData.rows.length === 0) {
      const newRow = {};
      codingFormData.headers.forEach((header, idx) => {
        newRow[header] = idx === index ? response : '';
      });
      const updatedFormData = { ...codingFormData, rows: [newRow] };
      setCodingFormData(updatedFormData);
      sessionStorage.setItem('aide_coding_form_data', JSON.stringify(updatedFormData));
      return;
    }
    const currentRowIndex = codingFormData.rows.length - 1;
    const updatedRows = [...codingFormData.rows];
    updatedRows[currentRowIndex] = {
      ...updatedRows[currentRowIndex],
      [codingFormData.headers[index]]: response
    };
    const updatedFormData = { ...codingFormData, rows: updatedRows };
    setCodingFormData(updatedFormData);
    sessionStorage.setItem('aide_coding_form_data', JSON.stringify(updatedFormData));
  };

  const handleNextPDF = () => {
    setPdfFile(null);
    setPdfUrl(null);
    setPdfText('');
    setResponses(codingFormData?.headers.map(() => ({ response: '', source: '', page: '' })) || []);
    setError('');
    setAnalysisProgress('');
    if (codingPromptsRef.current) {
      codingPromptsRef.current.resetRecordedIndices();
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (codingFormData) {
      const newRow = {};
      codingFormData.headers.forEach(header => {
        newRow[header] = '';
      });
      const updatedFormData = {
        ...codingFormData,
        rows: [...codingFormData.rows, newRow]
      };
      setCodingFormData(updatedFormData);
      sessionStorage.setItem('aide_coding_form_data', JSON.stringify(updatedFormData));
    }
  };

  const handleAnalyze = async () => {
    if (!pdfFile || !codingFormData || !apiConfig) {
      setError('Please upload a PDF, configure API settings, and upload a coding form first');
      return;
    }
    setIsAnalyzing(true);
    setError('');
    setAnalysisProgress('Preparing request...');
    try {
      const prompts = codingFormData.headers;
      let content;
      if (pdfMode === 'send-pdf') {
        setAnalysisProgress('Converting PDF to base64...');
        const base64PDF = await fileToBase64(pdfFile);
        content = { type: 'pdf', data: base64PDF, fileName: pdfFile.name };
      } else {
        setAnalysisProgress('Extracting text from PDF...');
        content = { type: 'text', data: pdfText };
      }
      setAnalysisProgress('Sending request to LLM...');
      const result = await callLLMAPI(
        apiConfig.endpoint,
        apiConfig.apiKey,
        apiConfig.model,
        prompts,
        content,
        apiConfig.contextWindow
      );
      setAnalysisProgress('Processing results...');
      setResponses(result.responses);
      setAnalysisProgress('');
    } catch (err) {
      setError(err.message || 'An error occurred during analysis');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const canAnalyze = pdfFile && codingFormData && apiConfig && !isAnalyzing;

  const pdfCapabilityBadge = pdfModeAutoSet
    ? pdfMode === 'send-pdf'
      ? { color: '#d1fae5', border: '#6ee7b7', text: '#065f46', icon: <CheckCircle size={13} />, label: 'PDF supported' }
      : { color: '#fef3c7', border: '#fcd34d', text: '#92400e', icon: <Info size={13} />, label: 'Text only (no PDF)' }
    : null;

  return (
    <div className="page-container">
      {/* ── Top control bar ── */}
      <div className="box" style={{ marginBottom: '1.5rem' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(180px,2fr) minmax(160px,1.2fr) minmax(160px,1.5fr) auto',
          gap: '1.25rem',
          alignItems: 'end'
        }}>
          {/* PDF File picker */}
          <div>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.4rem' }}>
              <Upload size={14} style={{ flexShrink: 0 }} />
              PDF File
            </label>
            <div className="file-input-wrapper">
              <input 
                type="file" 
                id="pdfInput" 
                ref={fileInputRef}
                accept="application/pdf" 
                onChange={handlePDFUpload} 
              />
              <label htmlFor="pdfInput" className="file-input-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', overflow: 'hidden' }}>
                <Upload size={14} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pdfFile ? pdfFile.name : 'Choose PDF...'}
                </span>
              </label>
            </div>
          </div>

          {/* Processing mode */}
          <div>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.4rem' }}>
              <FileText size={14} style={{ flexShrink: 0 }} />
              Processing Mode
              {pdfCapabilityBadge && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                  marginLeft: '0.4rem', padding: '1px 7px',
                  background: pdfCapabilityBadge.color,
                  border: `1px solid ${pdfCapabilityBadge.border}`,
                  borderRadius: '999px',
                  color: pdfCapabilityBadge.text,
                  fontSize: '0.7rem', fontWeight: 600
                }}>
                  {pdfCapabilityBadge.icon}
                  {pdfCapabilityBadge.label}
                </span>
              )}
            </label>
            <select
              className="form-select"
              value={pdfMode}
              onChange={(e) => { setPdfMode(e.target.value); setPdfModeAutoSet(false); }}
            >
              <option value="send-pdf">Send PDF file</option>
              <option value="text-only">Send text only</option>
            </select>
          </div>

          {/* Active model */}
          <div>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.4rem' }}>
              <Cpu size={14} style={{ flexShrink: 0 }} />
              Active Model
            </label>
            <div style={{
              height: '38px',
              display: 'flex', alignItems: 'center',
              padding: '0 0.75rem',
              background: apiConfig?.model ? '#f0f4ff' : '#f8f9fa',
              border: `1px solid ${apiConfig?.model ? '#c7d4f5' : '#dee2e6'}`,
              borderRadius: '6px',
              fontSize: '0.82rem',
              color: apiConfig?.model ? '#3a5bd9' : '#adb5bd',
              fontWeight: apiConfig?.model ? 500 : 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {apiConfig?.model || 'No model selected'}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end' }}>
            <button
              className={`btn ${canAnalyze ? 'btn-primary' : 'btn-secondary'}`}
              onClick={handleAnalyze}
              disabled={!canAnalyze}
              style={{ whiteSpace: 'nowrap' }}
            >
              <Play size={14} style={{ marginRight: '0.35rem', verticalAlign: 'middle' }} />
              {isAnalyzing ? 'Analyzing…' : 'Analyze PDF'}
            </button>
            {pdfFile && (
              <button
                className="btn btn-secondary"
                onClick={handleNextPDF}
                disabled={isAnalyzing}
                style={{ whiteSpace: 'nowrap' }}
              >
                <SkipForward size={14} style={{ marginRight: '0.35rem', verticalAlign: 'middle' }} />
                Next PDF
              </button>
            )}
          </div>
        </div>

        {/* Row 2: status / alerts */}
        <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {!apiConfig && (
            <div className="alert alert-warning" style={{ marginBottom: 0 }}>
              <AlertCircle size={14} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
              Please configure your API settings on the Setup page
            </div>
          )}
          {apiConfig && !apiConfig.model && (
            <div className="alert alert-warning" style={{ marginBottom: 0 }}>
              <AlertCircle size={14} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
              No model selected — go to Setup and pick a model
            </div>
          )}
          {!codingFormData && (
            <div className="alert alert-warning" style={{ marginBottom: 0 }}>
              <AlertCircle size={14} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
              Please upload a coding form on the Setup page
            </div>
          )}
          {isAnalyzing && (
            <div className="alert alert-info" style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div className="spinner" />
                {analysisProgress}
              </div>
            </div>
          )}
          {error && (
            <div className="alert alert-danger" style={{ marginBottom: 0 }}>
              <AlertCircle size={14} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
              {error}
            </div>
          )}
        </div>
      </div>

      {/* ── PDF viewer + Coding form side by side ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <div>
          {pdfUrl ? (
            <PDFViewer pdfUrl={pdfUrl} highlightPage={null} />
          ) : (
            <div className="box" style={{ textAlign: 'center', color: '#adb5bd', padding: '4rem 1rem' }}>
              <FileText size={52} style={{ marginBottom: '0.75rem', opacity: 0.25 }} />
              <p style={{ margin: 0 }}>Upload a PDF to preview it here</p>
            </div>
          )}
        </div>
        <div>
          <div className="box">
            <h2 className="box-title">Coding Form</h2>
            {codingFormData ? (
              <CodingPrompts
                ref={codingPromptsRef}
                prompts={codingFormData.headers}
                responses={responses}
                onResponseChange={(index, value) => {
                  const newResponses = [...responses];
                  newResponses[index] = { ...newResponses[index], response: value };
                  setResponses(newResponses);
                }}
                onRecord={handleRecordResponse}
              />
            ) : (
              <p className="text-muted">Please upload a coding form on the Setup page</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AnalyzePage;