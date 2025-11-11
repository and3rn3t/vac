import React, { useState, useEffect } from 'react';
import './App.css';

/**
 * Mobile App Shell for Roomba Control
 * This is a basic React component that can be adapted for React Native
 */

function App() {
  const [serverUrl, setServerUrl] = useState('http://localhost:3000');
  const [connected, setConnected] = useState(false);
  const [robotState, setRobotState] = useState({});

  useEffect(() => {
    // Check server connection
    checkConnection();
  }, [serverUrl]);

  const checkConnection = async () => {
    try {
      const response = await fetch(`${serverUrl}/api/health`);
      if (response.ok) {
        setConnected(true);
      }
    } catch (error) {
      setConnected(false);
    }
  };

  const sendCommand = async (command) => {
    try {
      const response = await fetch(`${serverUrl}/api/${command}`, {
        method: 'POST',
      });
      const data = await response.json();
      alert(data.message || 'Command sent');
    } catch (error) {
      alert('Failed to send command: ' + error.message);
    }
  };

  return (
    <div className="mobile-app">
      <header className="mobile-header">
        <h1>🤖 Roomba Control</h1>
        <div className={`status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '● Connected' : '○ Disconnected'}
        </div>
      </header>

      <div className="mobile-content">
        <div className="config-section">
          <label>Server URL:</label>
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://192.168.1.100:3000"
          />
          <button onClick={checkConnection}>Connect</button>
        </div>

        <div className="control-section">
          <h2>Quick Controls</h2>
          <div className="button-grid">
            <button 
              className="control-btn start"
              onClick={() => sendCommand('start')}
              disabled={!connected}
            >
              ▶️ Start
            </button>
            <button 
              className="control-btn pause"
              onClick={() => sendCommand('pause')}
              disabled={!connected}
            >
              ⏸️ Pause
            </button>
            <button 
              className="control-btn stop"
              onClick={() => sendCommand('stop')}
              disabled={!connected}
            >
              ⏹️ Stop
            </button>
            <button 
              className="control-btn dock"
              onClick={() => sendCommand('dock')}
              disabled={!connected}
            >
              🏠 Dock
            </button>
          </div>
        </div>

        <div className="info-section">
          <h3>Mobile App Shell</h3>
          <p>This is a basic shell for the mobile application.</p>
          <p>For full functionality, use the web interface or develop this further for React Native.</p>
        </div>
      </div>
    </div>
  );
}

export default App;
