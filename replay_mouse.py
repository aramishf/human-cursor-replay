import ctypes
import time
import sys
import json
import threading
import random
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

# Define CGPoint structure for macOS CoreGraphics
class CGPoint(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

def move_mouse(x, y):
    cg = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
    cg.CGEventCreateMouseEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint32, CGPoint, ctypes.c_uint32]
    cg.CGEventCreateMouseEvent.restype = ctypes.c_void_p
    
    # Type 5 is MouseMoved
    event = cg.CGEventCreateMouseEvent(None, 5, CGPoint(x, y), 0)
    
    cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
    cg.CGEventPost(0, event)
    
    cg.CFRelease.argtypes = [ctypes.c_void_p]
    cg.CFRelease(event)

def get_mouse_position():
    cg = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
    cg.CGEventCreate.argtypes = [ctypes.c_void_p]
    cg.CGEventCreate.restype = ctypes.c_void_p
    event = cg.CGEventCreate(None)
    
    cg.CGEventGetLocation.argtypes = [ctypes.c_void_p]
    cg.CGEventGetLocation.restype = CGPoint
    loc = cg.CGEventGetLocation(event)
    
    cg.CFRelease.argtypes = [ctypes.c_void_p]
    cg.CFRelease(event)
    return loc.x, loc.y

def is_kill_switch_pressed():
    """Check if Escape (keycode 53) or Control+C / Command+C (keycode 8 with modifier keys) is pressed globally on macOS."""
    try:
        cg = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
        cg.CGEventSourceKeyState.argtypes = [ctypes.c_int, ctypes.c_int]
        cg.CGEventSourceKeyState.restype = ctypes.c_bool
        
        # Check Escape (keycode 53)
        if cg.CGEventSourceKeyState(0, 53):
            return True
            
        # Check modifier keys: Left Control (59), Right Control (62), Left Command (55), Right Command (54)
        modifier_pressed = (
            cg.CGEventSourceKeyState(0, 59) or 
            cg.CGEventSourceKeyState(0, 62) or 
            cg.CGEventSourceKeyState(0, 55) or 
            cg.CGEventSourceKeyState(0, 54)
        )
        # Check C key (keycode 8)
        c_pressed = cg.CGEventSourceKeyState(0, 8)
        
        return modifier_pressed and c_pressed
    except Exception:
        return False

def get_screen_resolution():
    """Get the current screen resolution dynamically using CoreGraphics."""
    try:
        cg = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
        cg.CGMainDisplayID.restype = ctypes.c_uint32
        display_id = cg.CGMainDisplayID()
        
        cg.CGDisplayPixelsWide.argtypes = [ctypes.c_uint32]
        cg.CGDisplayPixelsWide.restype = ctypes.c_size_t
        cg.CGDisplayPixelsHigh.argtypes = [ctypes.c_uint32]
        cg.CGDisplayPixelsHigh.restype = ctypes.c_size_t
        
        width = cg.CGDisplayPixelsWide(display_id)
        height = cg.CGDisplayPixelsHigh(display_id)
        return width, height
    except Exception as e:
        print(f"Error getting resolution: {e}")
        return 1920, 1080 # fallback

def get_active_window_bounds():
    """Fetch the active application window name and boundaries on macOS via AppleScript."""
    script = '''
    tell application "System Events"
        set frontApp to name of first application process whose frontmost is true
        tell process frontApp
            try
                set frontWindow to first window
                set pos to position of frontWindow
                set sz to size of frontWindow
                return (item 1 of pos as text) & "," & (item 2 of pos as text) & "," & (item 1 of sz as text) & "," & (item 2 of sz as text) & "," & frontApp
            on error
                return "0,0,0,0,unknown"
            end try
        end tell
    end tell
    '''
    try:
        proc = subprocess.run(['osascript', '-e', script], capture_output=True, text=True, timeout=1.0)
        output = proc.stdout.strip()
        parts = output.split(',')
        if len(parts) >= 5 and parts[4] != "unknown":
            return {
                "x": float(parts[0]),
                "y": float(parts[1]),
                "width": float(parts[2]),
                "height": float(parts[3]),
                "app": parts[4]
            }
    except Exception:
        pass
    return None

# Global state management for HTTP Server
state = {
    "recorded_path": [],      # List of {"nx": nx, "ny": ny, "rx": rx, "ry": ry}
    "target_window": None,    # Start window boundaries
    "is_recording": False,
    "is_replaying": False,
    "sample_rate": 20,
    "replay_mode": "loop"     # "loop" or "once"
}

state_lock = threading.Lock()

def record_background_loop():
    global state
    delay = 1.0 / state["sample_rate"]
    path = []
    
    print("\n>>> Global Mouse Recording Started (Via Web UI)...")
    
    # Capture active window bounds at the start
    start_window = get_active_window_bounds()
    if start_window:
        print(f"Targeting active window: {start_window['app']} at ({start_window['x']}, {start_window['y']})")
    else:
        print("No active target window identified. Falling back to screen-normalized coordinates.")
        
    while True:
        with state_lock:
            if not state["is_recording"]:
                break
        
        if is_kill_switch_pressed():
            print("\n✓ Recording stopped by physical kill switch.")
            with state_lock:
                state["is_recording"] = False
            break
            
        raw_x, raw_y = get_mouse_position()
        sw, sh = get_screen_resolution()
        
        nx = raw_x / sw if sw > 0 else 0
        ny = raw_y / sh if sh > 0 else 0
        
        pt = {"nx": nx, "ny": ny}
        if start_window:
            pt["rx"] = raw_x - start_window["x"]
            pt["ry"] = raw_y - start_window["y"]
        else:
            pt["rx"] = None
            pt["ry"] = None
            
        path.append(pt)
        time.sleep(delay)
        
    with state_lock:
        state["recorded_path"] = path
        state["target_window"] = start_window
        state["is_recording"] = False
    print(f"✓ Recording finished! Captured {len(path)} positions.")

def generate_bezier_path(start, end, steps=30):
    """Generate a smooth cubic Bezier curve between two points with randomized natural curvature."""
    x0, y0 = start
    x3, y3 = end
    
    dx = x3 - x0
    dy = y3 - y0
    distance = (dx**2 + dy**2)**0.5
    if distance < 10:
        return [end]
        
    # Generate deviation perpendicular to the path to simulate human-like arcs
    deviation = distance * random.uniform(0.12, 0.22)
    
    # Calculate perpendicular vector
    px = -dy / distance if distance > 0 else 0
    py = dx / distance if distance > 0 else 0
    
    # Randomly curve left or right
    direction = random.choice([-1, 1])
    
    # Create displaced control points
    x1 = x0 + dx * 0.33 + px * deviation * direction + random.gauss(0, 3)
    y1 = y0 + dy * 0.33 + py * deviation * direction + random.gauss(0, 3)
    x2 = x0 + dx * 0.66 + px * deviation * direction + random.gauss(0, 3)
    y2 = y0 + dy * 0.66 + py * deviation * direction + random.gauss(0, 3)
    
    path = []
    for i in range(steps):
        t = i / (steps - 1)
        # Cubic Bezier formula
        xt = (1-t)**3 * x0 + 3*(1-t)**2 * t * x1 + 3*(1-t) * t**2 * x2 + t**3 * x3
        yt = (1-t)**3 * y0 + 3*(1-t)**2 * t * y1 + 3*(1-t) * t**2 * y2 + t**3 * y3
        path.append((xt, yt))
    return path

def replay_background_loop():
    global state
    delay = 1.0 / state["sample_rate"]
    
    with state_lock:
        path = list(state["recorded_path"])
        target_window = state["target_window"]
        replay_mode = state["replay_mode"]
        
    if not path:
        print("No movements to replay.")
        with state_lock:
            state["is_replaying"] = False
        return
        
    print("\n>>> Playback Replay Loop Started...")
    
    current_window = get_active_window_bounds()
    
    def get_offset_coords(pt, win):
        sw, sh = get_screen_resolution()
        fallback_x = pt["nx"] * sw
        fallback_y = pt["ny"] * sh
        
        rx = pt.get("rx")
        ry = pt.get("ry")
        
        if win and rx is not None and ry is not None:
            # Replay relative to the current active window offset
            return win["x"] + rx, win["y"] + ry
        return fallback_x, fallback_y

    # Calculate starting point coordinates
    first_pt = path[0]
    start_x, start_y = get_offset_coords(first_pt, current_window)
    
    # 1. Slide smoothly from current physical cursor position to the starting point
    current_pos = get_mouse_position()
    glide_steps = 25
    
    print(f"Gliding cursor smoothly to start position ({start_x:.1f}, {start_y:.1f})...")
    glide_path = generate_bezier_path(current_pos, (start_x, start_y), steps=glide_steps)
    
    for pos in glide_path:
        with state_lock:
            if not state["is_replaying"]:
                return
        if is_kill_switch_pressed():
            print("\n🛑 Stopped: Kill switch detected during glide. Exiting replayer.")
            with state_lock:
                state["is_replaying"] = False
            return
        move_mouse(pos[0], pos[1])
        time.sleep(delay * random.uniform(0.8, 1.2))
        
    print("Replaying path...")
    loop_count = 0
    while True:
        # Periodically refresh the target window location at the start of loop cycles
        if target_window and loop_count % 2 == 0:
            current_window = get_active_window_bounds()
            
        for pt in path:
            with state_lock:
                if not state["is_replaying"]:
                    print("\n🛑 Stopped: Playback stopped by Web UI request.")
                    return
            
            if is_kill_switch_pressed():
                print("\n🛑 Stopped: Kill switch detected (Escape/Ctrl+C). Exiting replayer.")
                with state_lock:
                    state["is_replaying"] = False
                return
                
            base_x, base_y = get_offset_coords(pt, current_window)
            
            # 2. Mathematical Jitter: add tiny Gaussian noise (1-2 px micro-tremor)
            jitter_x = random.gauss(0, 0.6)
            jitter_y = random.gauss(0, 0.6)
            target_x = base_x + jitter_x
            target_y = base_y + jitter_y
            
            move_mouse(target_x, target_y)
            
            # 3. Timing Variance: slight randomized sleep intervals
            variance_factor = random.gauss(1.0, 0.08)
            variance_factor = max(0.6, min(1.4, variance_factor))
            time.sleep(delay * variance_factor)
            
        loop_count += 1
        if replay_mode == "once":
            print("\n✓ Run Once playback complete.")
            with state_lock:
                state["is_replaying"] = False
            break

class MouseReplayerAPI(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == "/status":
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            with state_lock:
                response = {
                    "is_recording": state["is_recording"],
                    "is_replaying": state["is_replaying"],
                    "has_dataset": len(state["recorded_path"]) > 0,
                    "dataset_size": len(state["recorded_path"])
                }
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        global state
        
        if self.path == "/record/start":
            with state_lock:
                if state["is_replaying"]:
                    state["is_replaying"] = False
                state["is_recording"] = True
                state["recorded_path"] = []
                state["target_window"] = None
                
            thread = threading.Thread(target=record_background_loop)
            thread.daemon = True
            thread.start()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "started_recording"}).encode())
            
        elif self.path == "/record/stop":
            with state_lock:
                state["is_recording"] = False
                
            time.sleep(0.2)
            
            with state_lock:
                path_data = state["recorded_path"]
                
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "stopped_recording",
                "count": len(path_data),
                "path": path_data
            }).encode())
        elif self.path == "/replay/start":
            body = None
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 0:
                try:
                    body = json.loads(self.rfile.read(content_length))
                    if "path" in body and body["path"]:
                        parsed_path = []
                        for pt in body["path"]:
                            if isinstance(pt, dict):
                                parsed_path.append({
                                    "nx": pt.get("nx", 0.0),
                                    "ny": pt.get("ny", 0.0),
                                    "rx": pt.get("rx"),
                                    "ry": pt.get("ry")
                                })
                            elif isinstance(pt, list) and len(pt) >= 2:
                                sw, sh = get_screen_resolution()
                                parsed_path.append({
                                    "nx": pt[0] / sw if sw > 0 else 0,
                                    "ny": pt[1] / sh if sh > 0 else 0,
                                    "rx": None,
                                    "ry": None
                                })
                        with state_lock:
                            state["recorded_path"] = parsed_path
                except Exception as e:
                    print(f"Error parsing replay path: {e}")
                    
            with state_lock:
                if state["is_recording"]:
                    state["is_recording"] = False
                state["is_replaying"] = True
                if content_length > 0 and "body" in locals() and isinstance(body, dict) and "mode" in body:
                    state["replay_mode"] = body["mode"]
                else:
                    state["replay_mode"] = "loop"
                
            thread = threading.Thread(target=replay_background_loop)
            thread.daemon = True
            thread.start()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "started_replaying"}).encode())
            
        elif self.path == "/replay/stop":
            with state_lock:
                state["is_replaying"] = False
                
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "stopped_replaying"}).encode())
            
        else:
            self.send_response(404)
            self.end_headers()

def run_server(port=8000):
    server_address = ('', port)
    httpd = HTTPServer(server_address, MouseReplayerAPI)
    print(f"\n=======================================================")
    print(f"  ScreenSync Native Helper API Server running on port {port}")
    print(f"  Integrates with the ScreenSync web dashboard")
    print(f"=======================================================\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping API Server...")
        sys.exit(0)

if __name__ == "__main__":
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    run_server(port)
