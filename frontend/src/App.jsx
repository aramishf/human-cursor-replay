import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, 
  Square, 
  Activity, 
  Download, 
  Layers, 
  Link,
  Link2Off,
  Sparkles
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';

const BACKEND_URL = 'http://localhost:8000';

const calculateHumanLikenessScore = (telemetry) => {
  if (!telemetry || telemetry.length < 5) return 0;
  const velocities = telemetry.map(t => t.velocity);
  const n = velocities.length;
  const mean = velocities.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;
  
  const variance = velocities.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean;
  
  let score = 95;
  if (cv < 0.1) {
    score -= 80 * (1 - (cv / 0.1));
  } else if (cv < 0.25) {
    score -= 30 * (1 - ((cv - 0.1) / 0.15));
  }
  
  let abruptChanges = 0;
  for (let i = 1; i < telemetry.length; i++) {
    const dv = Math.abs(telemetry[i].velocity - telemetry[i - 1].velocity);
    if (dv > mean * 1.5) {
      abruptChanges++;
    }
  }
  
  const abruptRatio = abruptChanges / (n - 1);
  if (abruptRatio > 0.1) {
    score -= Math.min(40, abruptRatio * 150);
  }
  
  return Math.max(5, Math.min(100, Math.round(score)));
};

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('idle'); // 'idle' | 'recording' | 'recorded'
  const [telemetryLog, setTelemetryLog] = useState([]);
  const [humanScore, setHumanScore] = useState(null);
  
  // Replay Library & Playback Mode States
  const [profileName, setProfileName] = useState('');
  const [savedProfiles, setSavedProfiles] = useState([]);
  const [replayMode, setReplayMode] = useState('loop'); // 'loop' | 'once'
  
  // Video Recording State
  const [videoUrl, setVideoUrl] = useState(null);
  const [recordDuration, setRecordDuration] = useState(0);
  const [targetDuration, setTargetDuration] = useState(15);
  const [useTimer, setUseTimer] = useState(false);
  
  // Tracking Data
  const [mouseLog, setMouseLog] = useState([]);
  const [stats, setStats] = useState({
    distance: 0,
    clicks: 0,
    avgSpeed: 0,
    maxSpeed: 0,
  });

  const [backendConnected, setBackendConnected] = useState(false);
  const [isReplayingGlobal, setIsReplayingGlobal] = useState(false);

  // References
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const mousePosRef = useRef(null);
  const lastMousePosRef = useRef(null);
  const telemetryIntervalRef = useRef(null);
  
  const startTimeRef = useRef(null);

  // Poll backend status
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/status`);
        if (res.ok) {
          const data = await res.json();
          setBackendConnected(true);
          setIsReplayingGlobal(data.is_replaying);
        } else {
          setBackendConnected(false);
        }
      } catch (err) {
        setBackendConnected(false);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 1500);
    return () => clearInterval(interval);
  }, []);

  // Load saved profiles from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('screenSync_profiles');
    if (stored) {
      try {
        setSavedProfiles(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse saved profiles:", e);
      }
    }
  }, []);

  const saveProfile = () => {
    if (!profileName.trim()) {
      alert("Please enter a profile name.");
      return;
    }
    const newProfile = {
      id: Date.now().toString(),
      name: profileName,
      mouseLog: mouseLog,
      telemetryLog: telemetryLog,
      stats: stats,
      duration: recordDuration
    };
    const updated = [...savedProfiles, newProfile];
    setSavedProfiles(updated);
    localStorage.setItem('screenSync_profiles', JSON.stringify(updated));
    setProfileName('');
    alert(`Profile "${profileName}" saved!`);
  };

  const deleteProfile = (id) => {
    const updated = savedProfiles.filter(p => p.id !== id);
    setSavedProfiles(updated);
    localStorage.setItem('screenSync_profiles', JSON.stringify(updated));
  };

  const loadProfile = (profile) => {
    setMouseLog(profile.mouseLog || []);
    setTelemetryLog(profile.telemetryLog || []);
    setStats(profile.stats || { distance: 0, clicks: 0, avgSpeed: 0, maxSpeed: 0 });
    setRecordDuration(profile.duration || 0);
    setStatus('recorded');
    alert(`Profile "${profile.name}" loaded!`);
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  // Update timer while recording
  useEffect(() => {
    if (isRecording) {
      startTimeRef.current = Date.now();
      timerIntervalRef.current = setInterval(() => {
        setRecordDuration((prev) => {
          const next = prev + 0.1;
          if (useTimer && next >= targetDuration) {
            stopRecording();
          }
          return next;
        });
      }, 100);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    }
  }, [isRecording, useTimer, targetDuration]);

  // Telemetry collection loop during recording
  useEffect(() => {
    if (isRecording) {
      setTelemetryLog([]);
      setHumanScore(null);
      mousePosRef.current = null;
      lastMousePosRef.current = null;

      const handleMouseMove = (e) => {
        mousePosRef.current = { x: e.clientX, y: e.clientY };
      };
      window.addEventListener('mousemove', handleMouseMove);

      const recordStartTime = Date.now();
      telemetryIntervalRef.current = setInterval(() => {
        const elapsed = (Date.now() - recordStartTime) / 1000;
        let velocity = 0;
        if (mousePosRef.current && lastMousePosRef.current) {
          const dx = mousePosRef.current.x - lastMousePosRef.current.x;
          const dy = mousePosRef.current.y - lastMousePosRef.current.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          velocity = dist / 0.1; // px per second
        }
        setTelemetryLog(prev => [...prev, { time: Math.round(elapsed * 10) / 10, velocity: Math.round(velocity) }]);
        lastMousePosRef.current = mousePosRef.current;
      }, 100);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        if (telemetryIntervalRef.current) clearInterval(telemetryIntervalRef.current);
      };
    }
  }, [isRecording]);

  const startRecording = async () => {
    try {
      recordedChunksRef.current = [];
      setMouseLog([]);
      setTelemetryLog([]);
      setHumanScore(null);
      setRecordDuration(0);
      setStats({ distance: 0, clicks: 0, avgSpeed: 0, maxSpeed: 0 });
      
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false
      });

      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'video/webm' });
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        setVideoUrl(url);
        setStatus('recorded');
        stream.getTracks().forEach(track => track.stop());
      };

      if (backendConnected) {
        await fetch(`${BACKEND_URL}/record/start`, { method: 'POST' });
      }

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setStatus('recording');
      startTimeRef.current = Date.now();
    } catch (err) {
      console.error("Error obtaining screen capture:", err);
      alert("Failed to start recording. Please allow screen sharing permissions.");
    }
  };

  const stopRecording = async () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (backendConnected) {
        try {
          const res = await fetch(`${BACKEND_URL}/record/stop`, { method: 'POST' });
          if (res.ok) {
            const data = await res.json();
            const pathData = (data.path || []).map((pt, idx) => ({
              nx: pt.nx,
              ny: pt.ny,
              rx: pt.rx,
              ry: pt.ry,
              x: pt.nx * (window.screen.width || 1920),
              y: pt.ny * (window.screen.height || 1080),
              time: pt.time !== undefined ? pt.time * 1000 : idx * (1000 / 20),
              type: pt.type || 'move',
              button: pt.button,
              pressed: pt.pressed,
              key: pt.key
            }));
            setMouseLog(pathData);
            
            calculateStatsFromPath(pathData);

            const backendTelemetry = [];
            for (let i = 2; i < pathData.length; i += 2) {
              const p1 = pathData[i - 2];
              const p2 = pathData[i];
              const dt = (p2.time - p1.time) / 1000;
              if (dt > 0) {
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const velocity = dist / dt;
                backendTelemetry.push({
                  time: Math.round((p2.time / 1000) * 10) / 10,
                  velocity: Math.round(velocity)
                });
              }
            }
            if (backendTelemetry.length > 0) {
              setTelemetryLog(backendTelemetry);
              setHumanScore(calculateHumanLikenessScore(backendTelemetry));
            } else {
              setHumanScore(calculateHumanLikenessScore(telemetryLog));
            }
          }
        } catch (e) {
          console.error("Failed to stop backend recording:", e);
          setHumanScore(calculateHumanLikenessScore(telemetryLog));
        }
      } else {
        setHumanScore(calculateHumanLikenessScore(telemetryLog));
      }
    }
  };

  const startGlobalReplay = async () => {
    if (!backendConnected) {
      alert("Python backend is not connected.");
      return;
    }
    const rawPath = mouseLog.map(p => ({
      type: p.type || 'move',
      time: p.time !== undefined ? p.time / 1000 : 0.0,
      nx: p.nx,
      ny: p.ny,
      rx: p.rx,
      ry: p.ry,
      button: p.button,
      pressed: p.pressed,
      key: p.key
    }));
    try {
      await fetch(`${BACKEND_URL}/replay/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: rawPath, mode: replayMode })
      });
      setIsReplayingGlobal(true);
    } catch (e) {
      console.error("Failed to start global replay:", e);
    }
  };

  const stopGlobalReplay = async () => {
    if (!backendConnected) return;
    try {
      await fetch(`${BACKEND_URL}/replay/stop`, { method: 'POST' });
      setIsReplayingGlobal(false);
    } catch (e) {
      console.error("Failed to stop global replay:", e);
    }
  };

  const calculateStatsFromPath = (path) => {
    const mouseEvents = path.filter(p => p.type === 'move' || p.type === 'click');
    let clickCount = path.filter(p => p.type === 'click' && p.pressed).length;
    let totalDist = 0;
    let maxSpeed = 0;
    let speeds = [];

    for (let i = 1; i < mouseEvents.length; i++) {
      const p1 = mouseEvents[i - 1];
      const p2 = mouseEvents[i];
      const dx = (p2.x || 0) - (p1.x || 0);
      const dy = (p2.y || 0) - (p1.y || 0);
      const dist = Math.sqrt(dx * dx + dy * dy);
      totalDist += dist;

      const dt = p2.time - p1.time;
      if (dt > 0) {
        const speed = dist / dt;
        speeds.push(speed);
        if (speed > maxSpeed) maxSpeed = speed;
      }
    }

    const avgSpeed = speeds.length > 0 ? (speeds.reduce((a, b) => a + b, 0) / speeds.length) * 1000 : 0;
    setStats({
      distance: Math.round(totalDist),
      clicks: clickCount,
      avgSpeed: Math.round(avgSpeed),
      maxSpeed: Math.round(maxSpeed * 1000)
    });
  };

  const downloadJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(mouseLog, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `mouse-movement-log-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const resetTracker = () => {
    setMouseLog([]);
    setTelemetryLog([]);
    setHumanScore(null);
    setRecordDuration(0);
    setStats({ distance: 0, clicks: 0, avgSpeed: 0, maxSpeed: 0 });
    setStatus('idle');
    setVideoUrl(null);
  };

  return (
    <>
      {/* BIOS Header Utility */}
      <header className="bios-header">
        <div>AMIBIOS (C) 2026 SCREEN-SYNC UTILITY, INC.</div>
        <div>STATUS: {backendConnected ? "NATIVE HELPER ONLINE" : "NATIVE HELPER OFFLINE"}</div>
        <div>VITE VERSION 4.0.0. BIOS DATE: 06/01/26</div>
      </header>

      {/* Main Single Page Setup */}
      <div className="bios-grid">
        
        {/* Left Pane: System Settings & Recording Controls */}
        <section className="bios-panel active-panel">
          <h2 className="bios-title">System Settings</h2>
          
          <div className="bios-setting-row">
            <span className="bios-setting-label">Auto-Stop Timer</span>
            <span className="bios-setting-dots"></span>
            <span 
              className="bios-setting-value interactive" 
              onClick={() => setUseTimer(!useTimer)}
            >
              [ {useTimer ? "ENABLED" : "DISABLED"} ]
            </span>
          </div>

          <div className="bios-setting-row">
            <span className="bios-setting-label">Target Duration</span>
            <span className="bios-setting-dots"></span>
            <span 
              className="bios-setting-value interactive" 
              onClick={() => setTargetDuration(prev => prev === 15 ? 30 : prev === 30 ? 60 : 15)}
            >
              [ {targetDuration} SECONDS ]
            </span>
          </div>

          <div className="bios-setting-row">
            <span className="bios-setting-label">Playback Mode</span>
            <span className="bios-setting-dots"></span>
            <span 
              className="bios-setting-value interactive" 
              onClick={() => setReplayMode(replayMode === 'loop' ? 'once' : 'loop')}
            >
              {replayMode === 'loop' ? '[ INFINITE LOOP ]' : '[ RUN ONCE ]'}
            </span>
          </div>

          <div className="bios-setting-row" style={{ marginTop: '0.5rem' }}>
            <span className="bios-setting-label">Engine Connection</span>
            <span className="bios-setting-dots"></span>
            <span className="bios-setting-value" style={{ color: backendConnected ? 'var(--text-cyan)' : 'var(--text-highlight)' }}>
              {backendConnected ? '[ LINKED ]' : '[ DISCONNECTED ]'}
            </span>
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <h3 className="bios-metric-label" style={{ marginBottom: '0.25rem' }}>Recorder Actions</h3>
            
            {!isRecording ? (
              <button onClick={startRecording} className="bios-btn">
                <Play size={14} style={{ marginRight: '0.5rem', display: 'inline' }} /> Start Recording
              </button>
            ) : (
              <button onClick={stopRecording} className="bios-btn btn-active">
                <Square size={14} style={{ marginRight: '0.5rem', display: 'inline' }} /> Stop Recording
              </button>
            )}

            {isReplayingGlobal ? (
              <button onClick={stopGlobalReplay} className="bios-btn btn-active">
                Stop Replay
              </button>
            ) : (
              <button onClick={startGlobalReplay} disabled={mouseLog.length === 0} className="bios-btn">
                Start Replay
              </button>
            )}

            <button onClick={resetTracker} disabled={mouseLog.length === 0 && !isRecording} className="bios-btn">
              Reset Tracker
            </button>
          </div>
        </section>

        {/* Center Pane: Replay Library & Storage */}
        <section className="bios-panel">
          <h2 className="bios-title">Profiles & Storage</h2>

          {status === 'recorded' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
              <span className="bios-setting-label">Profile Name</span>
              <input 
                type="text" 
                placeholder="Enter profile name..." 
                value={profileName} 
                onChange={(e) => setProfileName(e.target.value)} 
                className="bios-input"
              />
              <button onClick={saveProfile} className="bios-btn" style={{ alignSelf: 'flex-start' }}>
                Save Profile
              </button>
            </div>
          )}

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span className="bios-metric-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Saved Replay Profiles</span>
              <span>[ {savedProfiles.length} ]</span>
            </span>

            {savedProfiles.length === 0 ? (
              <div style={{ padding: '2rem', border: '1px dashed var(--border-color)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                NO PROFILES STORED
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
                {savedProfiles.map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem', border: '1px solid var(--border-color)', background: 'var(--bg-primary)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem' }}>
                      <span style={{ color: 'white', fontWeight: 'bold' }}>{p.name}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{p.duration?.toFixed(1)}s • {p.stats?.distance}px</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button onClick={() => loadProfile(p)} className="bios-btn" style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }}>
                        Load
                      </button>
                      <button onClick={() => deleteProfile(p.id)} className="bios-btn" style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem', color: 'var(--text-highlight)' }}>
                        Del
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span className="bios-metric-label">Data Export</span>
            
            <button onClick={downloadJSON} disabled={mouseLog.length === 0} className="bios-btn" style={{ fontSize: '0.8rem' }}>
              Export Coordinate JSON
            </button>

            {videoUrl && (
              <a 
                href={videoUrl} 
                download={`screen-recording-${Date.now()}.webm`}
                className="bios-btn"
                style={{ fontSize: '0.8rem', textDecoration: 'none', textAlign: 'center', display: 'block' }}
              >
                Download Video WebM
              </a>
            )}
          </div>
        </section>

        {/* Right Pane: High-Contrast Diagnostics & Recharts Graph */}
        <section className="bios-panel">
          <h2 className="bios-title">Diagnostics & Metrics</h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="bios-metric-box">
              <span className="bios-metric-label">Total Distance</span>
              <span className="bios-metric-value">{stats.distance} px</span>
            </div>

            <div className="bios-metric-box">
              <span className="bios-metric-label">Action Clicks</span>
              <span className="bios-metric-value">{stats.clicks}</span>
            </div>

            <div className="bios-metric-box">
              <span className="bios-metric-label">Avg Velocity</span>
              <span className="bios-metric-value">{stats.avgSpeed} px/s</span>
            </div>

            <div className="bios-metric-box">
              <span className="bios-metric-label">Peak Velocity</span>
              <span className="bios-metric-value">{stats.maxSpeed} px/s</span>
            </div>
          </div>

          {humanScore !== null && (
            <div className="bios-metric-box" style={{ borderLeft: '3px solid var(--text-cyan)', marginTop: '0.25rem' }}>
              <span className="bios-metric-label">Human-Likeness Rating</span>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="bios-metric-value" style={{ color: 'var(--text-cyan)' }}>{humanScore}%</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {humanScore > 75 ? "EXCELLENT NATURAL CURVES" : "ROBOTIC/HIGH REGULARITY"}
                </span>
              </div>
            </div>
          )}

          {/* Velocity Profile area graph */}
          <div style={{ flex: 1, minHeight: '130px', marginTop: '0.5rem', display: 'flex', flexDirection: 'column' }}>
            <span className="bios-metric-label" style={{ marginBottom: '0.5rem' }}>Velocity Distribution Graph</span>
            {telemetryLog.length > 0 ? (
              <div style={{ width: '100%', height: 130 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={telemetryLog} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="biosGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--text-highlight)" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="var(--text-highlight)" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={9} tickLine={false} />
                    <YAxis stroke="var(--text-muted)" fontSize={9} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'white', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}
                      labelFormatter={(label) => `${label}s`}
                    />
                    <Area type="monotone" dataKey="velocity" stroke="var(--text-highlight)" strokeWidth={1.5} fillOpacity={1} fill="url(#biosGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ flex: 1, border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                WAITING FOR METRICS...
              </div>
            )}
          </div>
        </section>

      </div>

      {/* Legend Footer */}
      <footer className="bios-footer">
        <span>CMD+OPT+R: RUN REPLAY</span>
        <span>CMD+OPT+S: HALT REPLAY</span>
        <span>ESC/CTRL+C: PHYSICAL STOP</span>
      </footer>
    </>
  );
}

export default App;
