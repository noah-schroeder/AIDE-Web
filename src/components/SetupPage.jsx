import React, { useState, useEffect } from 'react';
import { Upload, AlertCircle, CheckCircle, Download, Eye } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

function SetupPage() {
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [contextWindow, setContextWindow] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [availableModels, setAvailableModels] = useState([]);
  const [modelLoadingStatus, setModelLoadingStatus] = useState('');
  const [codingFormFile, setCodingFormFile] = useState(null);
  const [codingFormData, setCodingFormData] = useState(null);
  const [formStatus, setFormStatus] = useState('');
  const [openRouterNote, setOpenRouterNote] = useState('⚠️ OpenRouter Note: \n\nIt is highly recommended that you go into your Open Router settings and configure your account for the features you want available, particulary with respect to privacy. For example, you can choose to use only providers with zero data retention, exclude specific providers, or only include specific providers. At the present time, the model list will still show all models available, but the API request should respect your settings.');


  useEffect(() => {
    const savedEndpoint = sessionStorage.getItem('aide_api_endpoint');
    const savedKey = sessionStorage.getItem('aide_api_key');
    const savedContext = sessionStorage.getItem('aide_context_window');
    const savedModel = sessionStorage.getItem('aide_model');
    const savedFormData = sessionStorage.getItem('aide_coding_form_data');

    if (savedEndpoint) setApiEndpoint(savedEndpoint);
    if (savedKey) setApiKey(savedKey);
    if (savedContext) setContextWindow(savedContext);
    if (savedModel) setSelectedModel(savedModel);
    if (savedFormData) {
      try {
        setCodingFormData(JSON.parse(savedFormData));
      } catch (e) {
        console.error('Error parsing saved form data:', e);
      }
    }
  }, []);

  useEffect(() => {
    if (!apiKey.trim() || !apiEndpoint.trim()) {
      setAvailableModels([]);
      setModelLoadingStatus('');
      return;
    }

    const fetchModels = async () => {
      setModelLoadingStatus('loading');
      try {
        // Clean up any stale :free suffix from previous version
        const staleModel = sessionStorage.getItem('aide_model');
        if (staleModel?.endsWith(':free')) {
          const cleaned = staleModel.replace(/:free$/, '');
          sessionStorage.setItem('aide_model', cleaned);
          setSelectedModel(cleaned);
        }

        const baseUrl = apiEndpoint.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
        const modelsUrl = `${baseUrl}/models`;

        const response = await fetch(modelsUrl, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const isOpenRouter = apiEndpoint.includes('openrouter.ai');

        // Build capabilities map: modelId -> input_modalities[]
        const capabilitiesMap = {};
        (data.data || []).forEach(m => {
          const modalities = m.architecture?.input_modalities || [];
          capabilitiesMap[m.id] = modalities;
        });

        sessionStorage.setItem('aide_model_capabilities', JSON.stringify(capabilitiesMap));

        // Build model list with pricing info
        const models = (data.data || []).map(m => {
          const promptPrice = parseFloat(m.pricing?.prompt || '0');
          const completionPrice = parseFloat(m.pricing?.completion || '0');
          const isFree = isOpenRouter && promptPrice === 0 && completionPrice === 0;

          // Format price per million tokens for readability
          const formatPrice = (p) => {
            if (p === 0) return '$0';
            const perM = p * 1_000_000;
            return perM < 0.01
              ? `$${(perM).toFixed(4)}/M`
              : `$${perM.toFixed(2)}/M`;
          };

          return {
            id: m.id,
            label: m.name || m.id,
            isFree,
            promptPrice,
            completionPrice,
            promptLabel: formatPrice(promptPrice),
            completionLabel: formatPrice(completionPrice),
          };
        });

        // Sort: free models first (alpha), then paid (alpha)
        const freeModels = models
          .filter(m => m.isFree)
          .sort((a, b) => a.id.localeCompare(b.id));
        const paidModels = models
          .filter(m => !m.isFree)
          .sort((a, b) => a.id.localeCompare(b.id));

        setAvailableModels({ free: freeModels, paid: paidModels });
        setModelLoadingStatus('success');

        const savedModel = sessionStorage.getItem('aide_model');
        const allModels = [...freeModels, ...paidModels];
        if (savedModel && allModels.find(m => m.id === savedModel)) {
          setSelectedModel(savedModel);
        } else {
          setSelectedModel('');
        }
      } catch (err) {
        console.error('Error fetching models:', err);
        setAvailableModels([]);
        setModelLoadingStatus('error');
      }
    };

    const timer = setTimeout(fetchModels, 800);
    return () => clearTimeout(timer);
  }, [apiKey, apiEndpoint]);

  const handleEndpointChange = (e) => {
    setApiEndpoint(e.target.value);
    sessionStorage.setItem('aide_api_endpoint', e.target.value);
  };

  const handleApiKeyChange = (e) => {
    setApiKey(e.target.value);
    sessionStorage.setItem('aide_api_key', e.target.value);
  };

  const handleContextWindowChange = (e) => {
    setContextWindow(e.target.value);
    sessionStorage.setItem('aide_context_window', e.target.value);
  };

  const handleModelChange = (e) => {
    setSelectedModel(e.target.value);
    sessionStorage.setItem('aide_model', e.target.value);
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const fileExtension = file.name.split('.').pop().toLowerCase();

    try {
      if (fileExtension === 'csv') {
        Papa.parse(file, {
          header: true,
          complete: (results) => {
            const formData = {
              headers: results.meta.fields,
              rows: results.data,
              fileName: file.name
            };
            setCodingFormData(formData);
            sessionStorage.setItem('aide_coding_form_data', JSON.stringify(formData));
            setCodingFormFile(file);
            setFormStatus('success');
            setTimeout(() => setFormStatus(''), 3000);
          },
          error: (error) => {
            console.error('CSV parsing error:', error);
            setFormStatus('error');
            setTimeout(() => setFormStatus(''), 3000);
          }
        });
      } else if (fileExtension === 'xls' || fileExtension === 'xlsx') {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            if (jsonData.length > 0) {
              const headers = jsonData[0];
              const rows = jsonData.slice(1).map(row => {
                const obj = {};
                headers.forEach((header, index) => {
                  obj[header] = row[index] || '';
                });
                return obj;
              });

              const formData = { headers, rows, fileName: file.name };
              setCodingFormData(formData);
              sessionStorage.setItem('aide_coding_form_data', JSON.stringify(formData));
              setCodingFormFile(file);
              setFormStatus('success');
              setTimeout(() => setFormStatus(''), 3000);
            }
          } catch (error) {
            console.error('Excel parsing error:', error);
            setFormStatus('error');
            setTimeout(() => setFormStatus(''), 3000);
          }
        };
        reader.readAsArrayBuffer(file);
      }
    } catch (error) {
      console.error('File upload error:', error);
      setFormStatus('error');
      setTimeout(() => setFormStatus(''), 3000);
    }
  };

  const handleDownloadForm = () => {
    if (!codingFormData) return;
    const ws_data = [codingFormData.headers, ...codingFormData.rows.map(row =>
      codingFormData.headers.map(header => row[header] || '')
    )];
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Coding Form');
    const timestamp = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `aide_coding_form_${timestamp}.xlsx`);
  };

  const handleViewForm = () => {
    if (!codingFormData) return;
    const newWindow = window.open('', '_blank');
    if (!newWindow) {
      alert('Please allow popups for this site to view the coding form');
      return;
    }
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>AIDE Coding Form - ${codingFormData.fileName}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; background-color: #f8f9fa; }
          h1 { color: #2c3e50; }
          table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          th, td { border: 1px solid #dee2e6; padding: 12px; text-align: left; }
          th { background-color: #007bff; color: white; font-weight: 600; }
          tr:nth-child(even) { background-color: #f8f9fa; }
          tr:hover { background-color: #e9ecef; }
          .download-btn { margin: 20px 0; padding: 10px 20px; background-color: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
          .download-btn:hover { background-color: #218838; }
        </style>
      </head>
      <body>
        <h1>AIDE Coding Form</h1>
        <p><strong>File:</strong> ${codingFormData.fileName}</p>
        <p><strong>Total Entries:</strong> ${codingFormData.rows.length}</p>
        <button class="download-btn" onclick="downloadExcel()">Download as Excel</button>
        <table>
          <thead><tr>${codingFormData.headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>
            ${codingFormData.rows.map(row => `
              <tr>${codingFormData.headers.map(h => `<td>${row[h] || ''}</td>`).join('')}</tr>
            `).join('')}
          </tbody>
        </table>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
        <script>
          function downloadExcel() {
            const data = ${JSON.stringify([codingFormData.headers, ...codingFormData.rows.map(row =>
              codingFormData.headers.map(header => row[header] || '')
            )])};
            const ws = XLSX.utils.aoa_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Coding Form');
            XLSX.writeFile(wb, 'aide_coding_form_' + new Date().toISOString().split('T')[0] + '.xlsx');
          }
        </script>
      </body>
      </html>
    `;
    newWindow.document.write(html);
    newWindow.document.close();
  };

  // Determine if models are grouped (OpenRouter) or flat array
  const isGrouped = availableModels && !Array.isArray(availableModels);
  const totalModelCount = isGrouped
    ? (availableModels.free?.length || 0) + (availableModels.paid?.length || 0)
    : (availableModels?.length || 0);

  const renderModelOption = (m) => (
    <option key={m.id} value={m.id}>
      {m.isFree !== undefined
        ? m.isFree
          ? `${m.id}`
          : `${m.id}  ·  in: ${m.promptLabel}  out: ${m.completionLabel}`
        : m.id}
    </option>
  );

  return (
    <div className="page-container">
      {/* API Configuration */}
      <div className="box">
        <h2 className="box-title">API Configuration</h2>
        <p style={{ marginBottom: '1.5rem', color: '#6c757d' }}>
          Configure your OpenAI-compatible API endpoint. All credentials are stored in sessionStorage
          and will be cleared when you close your browser.
        </p>

        <div className="form-group">
          <label className="form-label">API Chat Completions Endpoint URL *</label>
          <input
            type="text"
            className="form-input"
            value={apiEndpoint}
            onChange={handleEndpointChange}
            placeholder="https://api.mistral.ai/v1/chat/completions"
          />
          <small className="text-muted" style={{ display: 'block', marginTop: '0.25rem' }}>
            Examples: OpenAI, Anthropic (via OpenRouter), Mistral, llama.cpp, LMStudio
          </small>
        </div>
         
          <div className="alert alert-info" style={{ marginTop: '0.5rem' }}>
            <strong>Endpoints Notes:</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '0.5rem' }}>
              <div>
                <h6 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.95rem' }}>Tested by Build Team Feb. 2026</h6>
                <ul style={{ marginTop: 0, marginBottom: 0, paddingLeft: '1.25rem' }}>
                  <li>Mistral: https://api.mistral.ai/v1/chat/completions</li>
                  <li>OpenRouter: https://openrouter.ai/api/v1/chat/completions</li>
                  <li>Personal custom openAI style endpoint</li>
                </ul>
              </div>
              <div>
                <h6 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.95rem' }}>Important Notes</h6>
                <ul style={{ marginTop: 0, marginBottom: 0, paddingLeft: '1.25rem' }}>
                  <li>Direct Gemini endpoint did not work as of February 2025</li>
                  <li>OpenAI and Anthropic direct endpoints not tested</li>
                  <li>Many openAI style endpoints should work</li>
                </ul>
              </div>
            </div>
          </div>

        <div className="form-group">
          <label className="form-label">API Key *</label>
          <input
            type="password"
            className="form-input"
            value={apiKey}
            onChange={handleApiKeyChange}
            placeholder="Enter API Key"
          />
        </div>

        {/* Model Dropdown */}
        <div className="form-group">
          <label className="form-label">
            Model
            {modelLoadingStatus === 'loading' && (
              <span style={{ marginLeft: '0.5rem', color: '#6c757d', fontWeight: 'normal', fontSize: '0.875rem' }}>
                ⏳ Fetching models...
              </span>
            )}
            {modelLoadingStatus === 'success' && totalModelCount > 0 && (
              <span style={{ marginLeft: '0.5rem', color: '#28a745', fontWeight: 'normal', fontSize: '0.875rem' }}>
                ✓ {totalModelCount} models found
              </span>
            )}
            {modelLoadingStatus === 'error' && (
              <span style={{ marginLeft: '0.5rem', color: '#dc3545', fontWeight: 'normal', fontSize: '0.875rem' }}>
                ✗ Could not fetch models
              </span>
            )}
          </label>

          {apiEndpoint.includes('openrouter.ai') && (
            <div style={{
              marginTop: '0.5rem',
              marginBottom: '0.5rem',
              padding: '0.75rem 1rem',
              backgroundColor: '#fff5f5',
              border: '1px solid #f5c6cb',
              borderLeft: '4px solid #dc3545',
              borderRadius: '4px',
              color: '#721c24',
              whiteSpace: 'pre-line',
            }}>
              {openRouterNote}
            </div>
          )}

          {totalModelCount > 0 ? (
            <select
              className="form-input"
              value={selectedModel}
              onChange={handleModelChange}
            >
              <option value="">-- Select a model --</option>

              {isGrouped ? (
                <>
                  {availableModels.free?.length > 0 && (
                    <optgroup label={`⚡ Free (${availableModels.free.length})`}>
                      {availableModels.free.map(renderModelOption)}
                    </optgroup>
                  )}
                  {availableModels.paid?.length > 0 && (
                    <optgroup label={`💳 Paid (${availableModels.paid.length})`}>
                      {availableModels.paid.map(renderModelOption)}
                    </optgroup>
                  )}
                </>
              ) : (
                availableModels.map(renderModelOption)
              )}
            </select>
          ) : (
            <input
              type="text"
              className="form-input"
              value={selectedModel}
              onChange={handleModelChange}
              placeholder="Model choices load after endpoint and API key are entered"
              disabled={modelLoadingStatus === 'loading'}
            />
          )}
        
        </div>
      </div>

      {/* Coding Form Upload */}
      <div className="box">
        <h2 className="box-title">Coding Form</h2>
        <p style={{ marginBottom: '1.5rem', color: '#6c757d' }}>
          Upload your coding form here. <strong>Important:</strong> The first row will be used as LLM prompts.
          Make sure they are written clearly for best results!
        </p>

        <div className="form-group">
          <label className="form-label">Upload Coding Form (.csv, .xls, .xlsx)</label>
          <div className="file-input-wrapper">
            <input
              type="file"
              id="codingFormInput"
              accept=".csv,.xls,.xlsx"
              onChange={handleFileUpload}
            />
            <label htmlFor="codingFormInput" className="file-input-label">
              <Upload size={18} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
              {codingFormFile ? codingFormFile.name : 'Choose File...'}
            </label>
          </div>
        </div>

        {formStatus === 'success' && (
          <div className="alert alert-success">
            <CheckCircle size={18} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
            Coding form uploaded successfully!
          </div>
        )}

        {formStatus === 'error' && (
          <div className="alert alert-danger">
            <AlertCircle size={18} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
            Error uploading file. Please try again.
          </div>
        )}

        {codingFormData && (
          <div style={{ marginTop: '1.5rem' }}>
            <div className="alert alert-info">
              <strong>Form Loaded:</strong> {codingFormData.fileName}<br />
              <strong>Prompts Found:</strong> {codingFormData.headers.length}<br />
              <strong>Existing Entries:</strong> {codingFormData.rows.length}
            </div>

            <div className="d-flex gap-2" style={{ marginTop: '1rem' }}>
              <button className="btn btn-info" onClick={handleViewForm}>
                <Eye size={18} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
                View Form
              </button>
              <button className="btn btn-success" onClick={handleDownloadForm}>
                <Download size={18} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
                Download Form
              </button>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <strong>Prompts:</strong>
              <ol style={{ marginTop: '0.5rem' }}>
                {codingFormData.headers.map((header, idx) => (
                  <li key={idx} style={{ marginBottom: '0.25rem' }}>{header}</li>
                ))}
              </ol>
            </div>
          </div>
        )}

        <div className="alert alert-warning" style={{ marginTop: '1.5rem' }}>
          <strong>Tip:</strong> Make sure to download your updated coding form before closing the browser. You can do that on this page or on the dedicated Coding Form page.
          All data is stored locally and <strong>will be lost</strong> if you clear your browser's sessionStorage.
        </div>
      </div>
    </div>
  );
}

export default SetupPage;