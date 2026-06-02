import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, 
  Square, 
  Activity, 
  Video, 
  MousePointer, 
  Download, 
  RefreshCw, 
  Eye, 
  Flame, 
  Layers, 
  TrendingUp, 
  Award,
  Sparkles,
  MousePointerClick,
  Link,
  Link2Off,
  Power
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
  // App States
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('idle'); // 'idle' | 'recording' | 'recorded'
  const [activeTab, setActiveTab] = useState('analytics'); // 'analytics' | 'heatmap' | 'path'
  const [telemetryLog, setTelemetryLog] = useState([]);
  const [humanScore, setHumanScore] = useState(null);
  
  // Replay Library & Playback Mode States
  const [profileName, setProfileName] = useState('');
  const [savedProfiles, setSavedProfiles] = useState([]);
  const [replayMode, setReplayMode] = useState('loop'); // 'loop' | 'once'
  
  // Video Recording State
  const [videoUrl, setVideoUrl] = useState(null);
  const [recordDuration, setRecordDuration] = useState(0);
  const [targetDuration, setTargetDuration] = useState(15); // Default 15 seconds
  const [useTimer, setUseTimer] = useState(false); // Enable auto-stop
  
  // Tracking Data
  const [mouseLog, setMouseLog] = useState([]); // Array of { x, y, time, type: 'move' | 'click' }
  const [stats, setStats] = useState({
    distance: 0,
    clicks: 0,
    avgSpeed: 0,
    maxSpeed: 0,
  });

  // Playback Control
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  
  // Backend Helper Connection State
  const [backendConnected, setBackendConnected] = useState(false);
  const [isReplayingGlobal, setIsReplayingGlobal] = useState(false);

  // References
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const sandboxRef = useRef(null);
  const videoPlayerRef = useRef(null);
  const canvasRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const mousePosRef = useRef(null);
  const lastMousePosRef = useRef(null);
  const telemetryIntervalRef = useRef(null);
  
  // Track start time to calculate relative timestamp
  const startTimeRef = useRef(null);
  // Last tracked position for distance calculation
  const lastPosRef = useRef(null);

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
          // Auto-stop if target duration reached
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

  // Start Screen Recording & Mouse Tracking
  const startRecording = async () => {
    try {
      recordedChunksRef.current = [];
      setMouseLog([]);
      setTelemetryLog([]);
      setHumanScore(null);
      setRecordDuration(0);
      setStats({ distance: 0, clicks: 0, avgSpeed: 0, maxSpeed: 0 });
      lastPosRef.current = null;
      
      // Request screen capture stream
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
        
        // Stop all stream tracks to release camera/screen capture
        stream.getTracks().forEach(track => track.stop());
      };

      // Notify Python backend to start global recording
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

  // Stop Recording
  const stopRecording = async () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (backendConnected) {
        try {
          const res = await fetch(`${BACKEND_URL}/record/stop`, { method: 'POST' });
          if (res.ok) {
            const data = await res.json();
            // Transform python coordinate maps into log format
            const pathData = (data.path || []).map((pt, idx) => ({
              nx: pt.nx,
              ny: pt.ny,
              rx: pt.rx,
              ry: pt.ry,
              x: pt.nx * (window.screen.width || 1920),
              y: pt.ny * (window.screen.height || 1080),
              time: idx * (1000 / 20),
              type: 'move'
            }));
            setMouseLog(pathData);
            
            // Calculate mock velocity/stats for display based on the path
            calculateStatsFromPath(pathData);

            // Build telemetry from global path data (sampled at 100ms, i.e., every 2 points since recording is 20Hz)
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

  // Replay mouse globally via Backend
  const startGlobalReplay = async () => {
    if (!backendConnected) {
      alert("Python backend is not connected.");
      return;
    }
    // Extract full coordinate maps
    const rawPath = mouseLog.map(p => ({
      nx: p.nx,
      ny: p.ny,
      rx: p.rx,
      ry: p.ry
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

  // Calculate final statistics based on collected mouse coordinates
  const calculateStatsFromPath = (path) => {
    if (path.length < 2) return;
    
    let totalDist = 0;
    let clickCount = 0;
    let maxSpeed = 0;
    let speeds = [];

    for (let i = 1; i < path.length; i++) {
      const p1 = path[i - 1];
      const p2 = path[i];
      
      if (p2.type === 'click') {
        clickCount++;
      }

      // Distance between adjacent points
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      totalDist += dist;

      // Speed (pixels per millisecond)
      const dt = p2.time - p1.time;
      if (dt > 0) {
        const speed = dist / dt; // pixels per ms
        speeds.push(speed);
        if (speed > maxSpeed) maxSpeed = speed;
      }
    }

    const avgSpeed = speeds.length > 0 ? (speeds.reduce((a, b) => a + b, 0) / speeds.length) * 1000 : 0; // scale to px/sec
    setStats({
      distance: Math.round(totalDist),
      clicks: clickCount,
      avgSpeed: Math.round(avgSpeed),
      maxSpeed: Math.round(maxSpeed * 1000)
    });
  };

  // Download logs as JSON
  const downloadJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(mouseLog, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `mouse-movement-log-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Handle Playback Loop for Canvas Overlay
  useEffect(() => {
    let animFrame;
    
    const drawOverlay = () => {
      if (!canvasRef.current || !videoPlayerRef.current) return;
      const video = videoPlayerRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      const currentTimeMs = video.currentTime * 1000;
      setPlaybackTime(video.currentTime);
      setIsPlaying(!video.paused);

      // Clear previous frames
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Filter logs up to current video timestamp
      const currentLogs = mouseLog.filter(log => log.time <= currentTimeMs);

      if (activeTab === 'path') {
        // RENDER CURSOR TRACE PATH
        if (currentLogs.length > 0) {
          ctx.beginPath();
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          // Solid color trace for active movement
          ctx.strokeStyle = 'var(--accent-cyan)';

          // Normalize path coordinate display relative to canvas size
          const screenWidth = window.screen.width || 1920;
          const screenHeight = window.screen.height || 1080;

          const getCanvasCoords = (pt) => {
            const cx = (pt.x / screenWidth) * canvas.width;
            const cy = (pt.y / screenHeight) * canvas.height;
            return { x: cx, y: cy };
          };

          const startPt = getCanvasCoords(currentLogs[0]);
          ctx.moveTo(startPt.x, startPt.y);
          for (let i = 1; i < currentLogs.length; i++) {
            const nextPt = getCanvasCoords(currentLogs[i]);
            ctx.lineTo(nextPt.x, nextPt.y);
          }
          ctx.stroke();

          // Draw active cursor head
          const lastPoint = getCanvasCoords(currentLogs[currentLogs.length - 1]);
          ctx.beginPath();
          ctx.arc(lastPoint.x, lastPoint.y, 6, 0, 2 * Math.PI);
          ctx.fillStyle = 'var(--accent-cyan)';
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      } else if (activeTab === 'heatmap') {
        const screenWidth = window.screen.width || 1920;
        const screenHeight = window.screen.height || 1080;

        currentLogs.forEach(point => {
          const cx = (point.x / screenWidth) * canvas.width;
          const cy = (point.y / screenHeight) * canvas.height;

          const radialGrad = ctx.createRadialGradient(
            cx, cy, 1, 
            cx, cy, 15
          );
          radialGrad.addColorStop(0, 'rgba(88, 166, 255, 0.25)');
          radialGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          
          ctx.fillStyle = radialGrad;
          ctx.beginPath();
          ctx.arc(cx, cy, 15, 0, 2 * Math.PI);
          ctx.fill();
        });
      }

      // Loop drawing
      animFrame = requestAnimationFrame(drawOverlay);
    };

    if (status === 'recorded' && (activeTab === 'path' || activeTab === 'heatmap')) {
      animFrame = requestAnimationFrame(drawOverlay);
    }

    return () => {
      cancelAnimationFrame(animFrame);
    };
  }, [status, mouseLog, activeTab, isPlaying]);

  // Generate SVG graph data for velocity over time
  const getVelocityPoints = () => {
    if (mouseLog.length < 5) return "";
    const points = [];
    const width = 500;
    const height = 150;
    
    // Group mouse points to compute localized speed/velocity
    const speeds = [];
    const totalTime = mouseLog[mouseLog.length - 1].time || 1;

    for (let i = 1; i < mouseLog.length; i++) {
      const dt = mouseLog[i].time - mouseLog[i - 1].time;
      if (dt > 0) {
        const dx = mouseLog[i].x - mouseLog[i - 1].x;
        const dy = mouseLog[i].y - mouseLog[i - 1].y;
        const speed = Math.sqrt(dx * dx + dy * dy) / dt; // px per ms
        speeds.push({
          time: mouseLog[i].time,
          speed: speed * 1000 // scale to px/sec
        });
      }
    }

    if (speeds.length === 0) return "";
    const maxVal = Math.max(...speeds.map(s => s.speed), 100);

    speeds.forEach((s) => {
      const px = (s.time / totalTime) * width;
      const py = height - (s.speed / maxVal) * (height - 20);
      points.push(`${px},${py}`);
    });

    return points.join(" ");
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', flex: 1, paddingBottom: '3rem' }}>
      {/* Header section */}
      <header className="glass-panel" style={{ padding: '1.25rem 1.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: '700', margin: '0', display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'white' }}>
            <Activity size={28} style={{ stroke: 'var(--accent-cyan)' }} /> ScreenSync
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Record your screen and track mouse movements.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {/* Connection Status Badge */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem', 
            background: backendConnected ? 'rgba(35, 134, 54, 0.15)' : 'rgba(218, 54, 51, 0.15)', 
            padding: '0.35rem 0.75rem', 
            borderRadius: '6px', 
            border: backendConnected ? '1px solid rgba(46, 160, 67, 0.3)' : '1px solid rgba(248, 81, 73, 0.3)'
          }}>
            {backendConnected ? <Link size={14} style={{ color: 'var(--accent-cyan)' }} /> : <Link2Off size={14} style={{ color: 'var(--accent-pink)' }} />}
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: backendConnected ? 'var(--accent-cyan)' : 'var(--accent-pink)' }}>
              {backendConnected ? "Native Helper Online" : "Native Helper Offline"}
            </span>
          </div>

          {status === 'recording' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(218, 54, 51, 0.15)', padding: '0.35rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(248, 81, 73, 0.3)' }}>
              <span className="record-pulse" style={{ width: '8px', height: '8px', backgroundColor: 'var(--accent-pink)', borderRadius: '50%', display: 'inline-block' }}></span>
              <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--accent-pink)', fontFamily: 'var(--font-mono)' }}>
                {recordDuration.toFixed(1)}s
              </span>
            </div>
          )}
          {status === 'recorded' && (
            <button className="btn-secondary" onClick={() => { setStatus('idle'); setVideoUrl(null); setMouseLog([]); setTelemetryLog([]); setHumanScore(null); }} style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <RefreshCw size={14} /> Reset Tracker
            </button>
          )}
        </div>
      </header>

      {/* Main Layout grid */}
      <div className="grid-cols-layout">
        
        {/* Left Side: Recording Sandbox or Player Overlay */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {status !== 'recorded' ? (
            <div className="glass-panel" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Video size={18} style={{ color: 'var(--accent-cyan)' }} />
                  <span style={{ fontWeight: '600' }}>Active Movement Recording Window</span>
                </div>
                
                {/* Duration Limit Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <input 
                      type="checkbox" 
                      checked={useTimer} 
                      onChange={(e) => setUseTimer(e.target.checked)} 
                    />
                    Stop after:
                  </label>
                  <input 
                    type="number" 
                    value={targetDuration} 
                    onChange={(e) => setTargetDuration(Math.max(1, parseInt(e.target.value) || 15))}
                    disabled={!useTimer}
                    style={{ 
                      width: '50px', 
                      background: 'var(--bg-secondary)', 
                      border: '1px solid var(--glass-border)', 
                      color: 'white', 
                      borderRadius: '4px', 
                      padding: '0.2rem', 
                      textAlign: 'center',
                      fontSize: '0.85rem' 
                    }} 
                  />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>s</span>
                </div>

                {!isRecording ? (
                  <button className="btn-primary" onClick={startRecording} style={{ padding: '0.5rem 1rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Play size={14} /> Share Screen & Start
                  </button>
                ) : (
                  <button className="btn-danger" onClick={stopRecording} style={{ padding: '0.5rem 1rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Square size={14} /> Done (Stop Recording)
                  </button>
                )}
              </div>

              {/* Interaction Sandbox zone */}
              <div 
                ref={sandboxRef}
                style={{ 
                  height: '420px', 
                  backgroundColor: 'var(--bg-secondary)', 
                  position: 'relative', 
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '2rem',
                  userSelect: 'none'
                }}
              >
                {!isRecording ? (
                  <div style={{ textAlign: 'center', maxWidth: '380px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'rgba(88, 166, 255, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
                      <MousePointer size={24} style={{ color: 'var(--accent-cyan)' }} />
                    </div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '0.5rem' }}>Ready to Record</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: '1.5' }}>
                      Click **Share Screen & Start** above, choose the specific tab or window you want to display, and move your mouse naturally.
                    </p>
                  </div>
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)', background: 'rgba(88, 166, 255, 0.1)', padding: '0.25rem 0.6rem', borderRadius: '4px', border: '1px solid rgba(88, 166, 255, 0.2)' }}>
                        Tracking Active System Mouse...
                      </span>
                    </div>

                    <div style={{ textAlign: 'center' }}>
                      <div className="record-pulse" style={{ width: '16px', height: '16px', backgroundColor: 'var(--accent-pink)', borderRadius: '50%', display: 'inline-block', marginBottom: '1rem' }}></div>
                      <h4 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '0.25rem' }}>Move your Mouse Naturally</h4>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: '300px', margin: '0 auto' }}>
                        Your movements are being globally recorded. Switch to Multimango or any other window now.
                      </p>
                    </div>

                    <div style={{ textAlign: 'center', color: 'var(--text-dark)', fontSize: '0.85rem' }}>
                      Click "Done" or press the global key combination (Ctrl+C / Escape) to complete the recording.
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Analysis & Video Player Mode */
            <div className="glass-panel" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Eye size={20} style={{ color: 'var(--accent-cyan)' }} />
                  <span style={{ fontWeight: '600' }}>Recording & Movement Replay</span>
                </div>
                <div style={{ display: 'flex', background: 'var(--bg-tertiary)', borderRadius: '8px', padding: '2px' }}>
                  <button 
                    onClick={() => setActiveTab('path')} 
                    style={{ 
                      padding: '0.4rem 0.8rem', 
                      borderRadius: '6px', 
                      fontSize: '0.85rem', 
                      border: 'none', 
                      background: activeTab === 'path' ? 'var(--accent-blue)' : 'transparent',
                      color: 'white',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}
                  >
                    <Layers size={14} /> Path Trace
                  </button>
                  <button 
                    onClick={() => setActiveTab('heatmap')} 
                    style={{ 
                      padding: '0.4rem 0.8rem', 
                      borderRadius: '6px', 
                      fontSize: '0.85rem', 
                      border: 'none', 
                      background: activeTab === 'heatmap' ? 'var(--accent-blue)' : 'transparent',
                      color: 'white',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}
                  >
                    <Flame size={14} /> Heatmap
                  </button>
                  <button 
                    onClick={() => setActiveTab('analytics')} 
                    style={{ 
                      padding: '0.4rem 0.8rem', 
                      borderRadius: '6px', 
                      fontSize: '0.85rem', 
                      border: 'none', 
                      background: activeTab === 'analytics' ? 'var(--accent-blue)' : 'transparent',
                      color: 'white',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}
                  >
                    <TrendingUp size={14} /> Metrics
                  </button>
                </div>
              </div>

              {/* Video and Overlay Replay Workspace */}
              <div style={{ position: 'relative', width: '100%', height: '420px', backgroundColor: 'black' }}>
                {activeTab !== 'analytics' ? (
                  <>
                    <video 
                      ref={videoPlayerRef}
                      src={videoUrl}
                      controls
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                    {/* Synchronized Overlay Canvas */}
                    <canvas 
                      ref={canvasRef}
                      width={sandboxRef.current ? sandboxRef.current.clientWidth : 600}
                      height={420}
                      style={{ 
                        position: 'absolute', 
                        top: 0, 
                        left: 0, 
                        width: '100%', 
                        height: '100%', 
                        pointerEvents: 'none',
                        zIndex: 10
                      }}
                    />
                  </>
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '2rem', background: 'var(--bg-secondary)' }}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <TrendingUp size={20} style={{ color: 'var(--accent-cyan)' }} /> Velocity Distribution Over Time
                    </h3>
                    
                    {mouseLog.length >= 5 ? (
                      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <svg viewBox="0 0 500 180" style={{ width: '100%', maxHeight: '180px', overflow: 'visible' }}>
                          <defs>
                            <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--accent-purple)" stopOpacity="0.4"/>
                              <stop offset="100%" stopColor="var(--accent-purple)" stopOpacity="0"/>
                            </linearGradient>
                          </defs>
                          <polyline
                            fill="none"
                            stroke="var(--accent-cyan)"
                            strokeWidth="2.5"
                            points={getVelocityPoints()}
                          />
                          <path
                            d={`M 0,150 L ${getVelocityPoints()} L 500,150 Z`}
                            fill="url(#chartGrad)"
                          />
                          {/* Baseline */}
                          <line x1="0" y1="150" x2="500" y2="150" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                        </svg>
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.5rem', fontFamily: 'var(--font-mono)' }}>
                          <span>0.0s (Start)</span>
                          <span>Time Timeline</span>
                          <span>{recordDuration.toFixed(1)}s (End)</span>
                        </div>
                      </div>
                    ) : (
                      <p style={{ color: 'var(--text-muted)' }}>Not enough movement data logged to plot analytics.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Right Side: Analytics, Metrics and Exports */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Global Simulation Control Panel */}
          <div className="glass-panel" style={{ padding: '1.5rem', background: 'var(--bg-secondary)' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '700', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Power size={20} style={{ color: 'var(--accent-cyan)' }} /> Mouse Replayer
            </h3>
            
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.4', marginBottom: '1.25rem' }}>
              Turn this on to loop your recorded mouse path globally and stay active.
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: '600' }}>Playback Mode:</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                <input 
                  type="radio" 
                  name="replayMode" 
                  value="loop" 
                  checked={replayMode === 'loop'} 
                  onChange={() => setReplayMode('loop')} 
                />
                Infinite Loop
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                <input 
                  type="radio" 
                  name="replayMode" 
                  value="once" 
                  checked={replayMode === 'once'} 
                  onChange={() => setReplayMode('once')} 
                />
                Run Once
              </label>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              {!isReplayingGlobal ? (
                <button 
                  onClick={startGlobalReplay} 
                  disabled={mouseLog.length === 0 || !backendConnected}
                  className="btn-primary" 
                  style={{ flex: 1, padding: '0.75rem', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  <Play size={18} /> Start Replay
                </button>
              ) : (
                <button 
                  onClick={stopGlobalReplay} 
                  className="btn-danger" 
                  style={{ flex: 1, padding: '0.75rem', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  <Square size={18} /> Done (Stop Replay)
                </button>
              )}
              
              <button 
                onClick={stopGlobalReplay} 
                className="btn-secondary" 
                style={{ padding: '0.75rem 1.2rem', borderRadius: '6px' }}
              >
                Exit Replay
              </button>
            </div>
            
            {isReplayingGlobal && (
              <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--accent-pink)', textAlign: 'center', fontWeight: '600' }}>
                👉 Press Ctrl+C or Escape globally to instantly exit replay!
              </div>
            )}
          </div>

          {/* Main Performance / Movement Metrics */}
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '700', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)' }}>
              <Award size={20} style={{ color: 'var(--accent-cyan)' }} /> Activity Dashboard
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* Metric 1 */}
              <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-muted)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <MousePointer size={14} /> Total Distance
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: '800', marginTop: '0.25rem', fontFamily: 'var(--font-mono)' }}>
                  {stats.distance} <span style={{ fontSize: '0.85rem', fontWeight: '400', color: 'var(--text-dark)' }}>px</span>
                </div>
              </div>

              {/* Metric 2 */}
              <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-muted)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <MousePointerClick size={14} /> Action Clicks
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: '800', marginTop: '0.25rem', fontFamily: 'var(--font-mono)' }}>
                  {stats.clicks} <span style={{ fontSize: '0.85rem', fontWeight: '400', color: 'var(--text-dark)' }}>clicks</span>
                </div>
              </div>

              {/* Metric 3 */}
              <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-muted)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <TrendingUp size={14} /> Average Velocity
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: '800', marginTop: '0.25rem', fontFamily: 'var(--font-mono)' }}>
                  {stats.avgSpeed} <span style={{ fontSize: '0.85rem', fontWeight: '400', color: 'var(--text-dark)' }}>px/s</span>
                </div>
              </div>

              {/* Metric 4 */}
              <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-muted)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Sparkles size={14} /> Peak Velocity
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: '800', marginTop: '0.25rem', fontFamily: 'var(--font-mono)' }}>
                  {stats.maxSpeed} <span style={{ fontSize: '0.85rem', fontWeight: '400', color: 'var(--text-dark)' }}>px/s</span>
                </div>
              </div>
            </div>

            {/* Human-Likeness Score Section */}
            {humanScore !== null && (
              <div style={{ marginTop: '1rem', background: 'var(--bg-tertiary)', padding: '1rem 1.25rem', borderRadius: '8px', border: '1px solid var(--border-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <Activity size={14} style={{ color: 'var(--accent-cyan)' }} /> Human-Likeness Score
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-dark)', marginTop: '0.25rem' }}>
                    {humanScore > 70 ? "Natural variation detected." : "High uniformity detected (robotic)."}
                  </div>
                </div>
                <div style={{ fontSize: '2rem', fontWeight: '900', color: humanScore > 70 ? 'var(--accent-cyan)' : 'var(--accent-pink)', fontFamily: 'var(--font-mono)' }}>
                  {humanScore}%
                </div>
              </div>
            )}

            {/* Velocity Profile Area Chart */}
            {telemetryLog.length > 0 && (
              <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--glass-border)' }}>
                <h4 style={{ fontSize: '0.9rem', fontWeight: '700', marginBottom: '1rem', color: 'var(--text-muted)' }}>Velocity Profile (px/s)</h4>
                <div style={{ width: '100%', height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={telemetryLog} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="velocityGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--accent-cyan)" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="var(--accent-cyan)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="time" stroke="var(--text-dark)" fontSize={10} tickLine={false} />
                      <YAxis stroke="var(--text-dark)" fontSize={10} tickLine={false} />
                      <Tooltip 
                        contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-muted)', borderRadius: '6px', color: 'white' }}
                        labelFormatter={(label) => `${label}s`}
                      />
                      <Area type="monotone" dataKey="velocity" stroke="var(--accent-cyan)" strokeWidth={2} fillOpacity={1} fill="url(#velocityGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* Export / Data logs */}
          <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '700', marginBottom: '1rem' }}>Downloads</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: '1.4', marginBottom: '1.25rem' }}>
              Save your screen recording video and mouse coordinates as JSON.
            </p>

            {status === 'recorded' && (
              <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-muted)', marginBottom: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '600' }}>Save to Library</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input 
                    type="text" 
                    placeholder="Profile Name" 
                    value={profileName} 
                    onChange={(e) => setProfileName(e.target.value)} 
                    style={{ flex: 1, padding: '0.4rem 0.6rem', background: 'var(--bg-primary)', border: '1px solid var(--border-muted)', color: 'white', borderRadius: '6px', fontSize: '0.85rem' }}
                  />
                  <button onClick={saveProfile} className="btn-primary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', borderRadius: '6px' }}>
                    Save
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {status === 'recorded' ? (
                <>
                  <button 
                    onClick={downloadJSON}
                    className="btn-primary" 
                    style={{ padding: '0.75rem 1rem', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', width: '100%' }}
                  >
                    <Download size={18} /> Export Coordinate Dataset (.json)
                  </button>

                  <a 
                    href={videoUrl} 
                    download={`screen-recording-${Date.now()}.webm`}
                    className="btn-secondary"
                    style={{ padding: '0.75rem 1rem', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', textDecoration: 'none', fontSize: '0.9rem' }}
                  >
                    <Download size={18} /> Download Video Capture (.webm)
                  </a>
                </>
              ) : (
                <div style={{ padding: '1.5rem', background: 'var(--bg-secondary)', borderRadius: '10px', textAlign: 'center', border: '1px dashed var(--glass-border)' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-dark)' }}>
                    No data to export yet. Record a session to get started.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Saved Profiles Library Panel */}
          <div className="glass-panel" style={{ padding: '1.5rem', background: 'var(--bg-secondary)' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '700', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Layers size={20} style={{ color: 'var(--accent-cyan)' }} /> Saved Profiles ({savedProfiles.length})
            </h3>
            
            {savedProfiles.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>
                No profiles saved yet.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '200px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                {savedProfiles.map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-muted)', borderRadius: '6px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                       <span style={{ fontSize: '0.9rem', fontWeight: '600', color: 'white' }}>{p.name}</span>
                       <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                         {p.duration?.toFixed(1)}s • {p.stats?.distance}px • {p.stats?.clicks} clicks
                       </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={() => loadProfile(p)} className="btn-secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px' }}>
                        Load
                      </button>
                      <button onClick={() => deleteProfile(p.id)} className="btn-secondary" style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', borderRadius: '4px', borderColor: 'rgba(218, 54, 51, 0.4)', color: 'var(--accent-pink)' }}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </section>
      </div>

      {/* Footer */}
      <footer style={{ marginTop: 'auto', paddingTop: '2rem', borderTop: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-dark)', fontSize: '0.85rem' }}>
        <span>ScreenSync Tracker by Aramish</span>
      </footer>
    </div>
  );
}

export default App;
