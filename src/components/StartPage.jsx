import React from 'react';
import { Link } from 'react-router-dom';
import { FileText, Upload, Settings, CheckCircle } from 'lucide-react';

function StartPage() {
  return (
    <div className="page-container">
      <div className="box">
        <h2 className="box-title">Welcome to AI-Assisted Data Extraction (AIDE)</h2>
        <p style={{ lineHeight: '1.8' }}>
          AIDE was developed to greatly accelerate the data extraction process for systematic review and meta-analysis. 
          It relies on you having an API key for an OpenAI-compatible LLM service (Claude, ChatGPT, Mistral, etc.) 
          or using local models via an OpenAI style endpoint (LMStudio, llama.cpp, etc.). 
        </p>
      </div>

      <div className="box">
        <h3 className="box-title">How to Use This App</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        <div className="alert alert-info" style={{ marginTop: '1.5rem' }}>
          <strong>Important Notes:</strong>
          <li>AIDE is intentionally designed to require human validation of every single data point extracted.</li>
          <li> Do not rely on LLM-extracted data without human validation!</li> 
          <li>Make sure to download your coding form before closing the browser, 
          as all data is stored locally in your browser's session storage.</li> 
        </div>

          <div className="feature-section">
            <div className="d-flex align-items-center gap-2" style={{ marginBottom: '0.75rem' }}>
              <Settings size={24} color="#007bff" />
              <h4 style={{ margin: 0 }}>Step 1: Configure API Settings</h4>
            </div>
            <ul style={{ marginLeft: '2rem', lineHeight: '1.8' }}>
              <li>Enter your OpenAI-compatible API endpoint URL</li>
              <li>Provide your API key</li>
              <li>Choose the LLM you want to use</li>
              <li>All credentials are stored in sessionStorage (cleared when you close the browser)</li>
            </ul>
          </div>

          <div className="feature-section">
            <div className="d-flex align-items-center gap-2" style={{ marginBottom: '0.75rem' }}>
              <Upload size={24} color="#28a745" />
              <h4 style={{ margin: 0 }}>Step 2: Upload Your Coding Form</h4>
            </div>
            <ul style={{ marginLeft: '2rem', lineHeight: '1.8' }}>
              <li>Upload your coding form (.csv, .xls, or .xlsx)</li>
              <li><strong>Important:</strong> The first row should contain your LLM prompts</li>
              <li>Better prompts = better results from the LLM</li>
              <li>You can view and download the form at any time</li>
            </ul>
          </div>

          <div className="feature-section">
            <div className="d-flex align-items-center gap-2" style={{ marginBottom: '0.75rem' }}>
              <FileText size={24} color="#17a2b8" />
              <h4 style={{ margin: 0 }}>Step 3: Analyze PDFs</h4>
            </div>
            <ul style={{ marginLeft: '2rem', lineHeight: '1.8' }}>
              <li>Upload a PDF file you want to analyze</li>
              <li>Choose whether to send the full PDF or text only</li>
              <li>Click "Analyze" - it sends one API request with all prompts</li>
              <li>Review each response with source information</li>
              <li>Press Record to add human-validated responses to your coding form</li>
              <li>Click "Next PDF" to move to your next study</li>
            </ul>
          </div>

          <div className="feature-section">
            <div className="d-flex align-items-center gap-2" style={{ marginBottom: '0.75rem' }}>
              <CheckCircle size={24} color="#28a745" />
              <h4 style={{ margin: 0 }}>Step 4: Download Your Results</h4>
            </div>
            <ul style={{ marginLeft: '2rem', lineHeight: '1.8' }}>
              <li>All recorded responses are saved to your coding form</li>
              <li>Download your completed coding form as an Excel or CSV file</li>
              <li>Open in a new tab to view your data anytime</li>
            </ul>
          </div>
        </div>

        <div style={{ marginTop: '2rem', textAlign: 'center' }}>
          <Link to="/setup" className="btn btn-primary" style={{ fontSize: '1.1rem', padding: '0.75rem 2rem' }}>
            Get Started →
          </Link>
        </div>
      </div>

      <div className="box">
        <h3 className="box-title">Common Questions</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          
          <div>
            <strong>Do I really need to validate every data point extracted?</strong>
            <p style={{ marginTop: '0.5rem', lineHeight: '1.8' }}>
              Current evidence (February, 2026) shows that LLMs should not be relied on for data extraction, therefore a human should validate every data point extracted to ensure accuracy. AIDE is intentionally structured to ensure and facilitate this workflow, providing source information for LLM decisions and requiring the user to select 'record' for each individual data point.
              For the most comprehensive evidence we (Schroeder) has found, see <a href="https://doi.org/10.1037/bul0000501">Jansen et al. (2025)</a> 
            </p>
          </div>

          <div>
            <strong>How is my data secured?</strong>
            <p style={{ marginTop: '0.5rem', lineHeight: '1.8' }}>
              Your API key and coding form are stored in sessionStorage on your browser, so when you close the tab, it is erased. The only time data leaves your browser is when you make a request to an external LLM.  
            </p>
          </div>

          <div>
            <strong>How do I protect my API key?</strong>
            <p style={{ marginTop: '0.5rem', lineHeight: '1.8' }}>
              We recommend following best practices with API keys, such as never sharing your API key with other people, setting maximum spend amounts (if provider allows), and setting an expiration date for your API key. When using this app, your API key is stored on your local browser using sessionStorage, so you should close your browser when you're done using the app or if others will use your computer.
            </p>
          </div>

          <div>
            <strong>What file formats are supported?</strong>
            <p style={{ marginTop: '0.5rem', lineHeight: '1.8' }}>
              The app supports .csv, .xls, and .xlsx files for coding forms. Studies to be analyzed should be PDFs.
            </p>
          </div>

          <div>
            <strong>How many API calls does each analysis make?</strong>
            <p style={{ marginTop: '0.5rem', lineHeight: '1.8' }}>
              Each time you click "Analyze", the app makes <strong>one API request</strong> that includes 
              all your prompts and the PDF content. The LLM returns structured JSON with all responses, which are parsed into an easy to read format.
            </p>
          </div>
          <div>
            <strong>Did humans or AI create this app?</strong>
            <p style={{ marginTop: '0.5rem', lineHeight: '1.8' }}>
              This app was coded using a variety of different LLMs. A human worked with AI to refine the functionality. Use at own risk. Source code is open source and available on github for review https://github.com/noah-schroeder/AIDE
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StartPage;
