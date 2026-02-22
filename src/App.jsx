import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { FileText, Home, Settings, Search, BookOpen, ClipboardList, ChevronLeft, ChevronRight } from 'lucide-react';
import StartPage from './components/StartPage';
import SetupPage from './components/SetupPage';
import AnalyzePage from './components/AnalyzePage';
import CitePage from './components/CitePage';
import './styles/App.css';
import FinalFormPage from './components/FinalFormPage';

const NAV_ITEMS = [
  { path: '/',           label: 'Start Here',        match: 'start',      icon: Home },
  { path: '/setup',      label: 'Setup',              match: 'setup',      icon: Settings },
  { path: '/analyze',    label: 'Analyze',            match: 'analyze',    icon: Search },
  { path: '/final-form', label: 'Final Coding Form',  match: 'final-form', icon: ClipboardList },
  { path: '/cite',       label: 'Cite',               match: 'cite',       icon: BookOpen },
];

function Navigation({ collapsed, setCollapsed }) {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('start');

  useEffect(() => {
    const path = location.pathname.split('/')[1] || 'start';
    setActiveTab(path);
  }, [location]);

  return (
    <nav className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}`}>
      <div className="sidebar-header">
        <img src="./bird.png" alt="AIDE logo" className="logo-icon" style={{ width: 64, height: 64, objectFit: 'contain', flexShrink: 0 }}></img>        {!collapsed && <h1>AIDE</h1>}
      </div>

      <ul className="nav-menu">
        {NAV_ITEMS.map(({ path, label, match, icon: Icon }) => {
          const isActive = activeTab === '' ? match === 'start' : activeTab === match;
          return (
            <li key={path} className={isActive ? 'active' : ''} title={collapsed ? label : undefined}>
              <Link to={path} onClick={() => setActiveTab(match)}>
                <Icon size={18} className="nav-icon" />
                {!collapsed && <span>{label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Floating edge toggle tab */}
      <button
        className="sidebar-toggle"
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </nav>
  );
}

function App() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Router basename ="/AIDE-Web">
      <div className={`app${collapsed ? ' sidebar-is-collapsed' : ''}`}>
        <Navigation collapsed={collapsed} setCollapsed={setCollapsed} />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<StartPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/analyze" element={<AnalyzePage />} />
            <Route path="/final-form" element={<FinalFormPage />} />
            <Route path="/cite" element={<CitePage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;