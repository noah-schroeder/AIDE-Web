import React from 'react';

function CitePage() {
  return (
    <div className="page-container">
      <div className="box">
        <h2 className="box-title">Please cite AIDE if you use it in your research</h2>
        
        <div style={{ marginTop: '1.5rem' }}>
          <h3>BibTeX</h3>
          <div style={{
            backgroundColor: '#f8f9fa',
            padding: '1rem',
            borderRadius: '0.375rem',
            border: '1px solid #dee2e6',
            fontFamily: 'monospace',
            fontSize: '0.9rem',
            lineHeight: '1.6',
            whiteSpace: 'pre-wrap',
            marginTop: '0.75rem'
          }}>
{`@misc{schroeder2025largelanguagemodelshumanintheloop,
    title={Large Language Models with Human-In-The-Loop Validation for Systematic Review Data Extraction},
    author={Noah L. Schroeder and Chris Davis Jaldi and Shan Zhang},
    year={2025},
    eprint={2501.11840},
    archivePrefix={arXiv},
    primaryClass={cs.HC},
    url={https://arxiv.org/abs/2501.11840},
}`}
          </div>
        </div>

        <div style={{ marginTop: '2rem' }}>
          <h3>APA</h3>
          <p style={{
            backgroundColor: '#f8f9fa',
            padding: '1rem',
            borderRadius: '0.375rem',
            border: '1px solid #dee2e6',
            marginTop: '0.75rem',
            lineHeight: '1.8'
          }}>
            Schroeder, N. L., Jaldi, C. D., & Zhang, S. (2025). Large Language Models with Human-In-The-Loop 
            Validation for Systematic Review Data Extraction. https://doi.org/10.48550/arXiv.2501.11840
          </p>
        </div>

        <div className="alert alert-info" style={{ marginTop: '2rem' }}>
          <strong>Note:</strong> This React version of AIDE was created to provide a more accessible alternative to the original R Shiny application. The core functionality and workflow 
          remain faithful to the original design, but some features have been improved for better functionality.
        </div>
      </div>
    </div>
  );
}

export default CitePage;
