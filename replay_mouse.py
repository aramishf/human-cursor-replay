import ctypes
import time
import sys
import json
import threading
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

# Global state management for HTTP Server
state = {
    "recorded_path": [],
    "is_recording": False,
    "is_replaying": False,
    "sample_rate": 20
}

state_lock = threading.Lock()

def record_background_loop():
    global state
    delay = 1.0 / state["sample_rate"]
    path = []
    
    print("\n>>> Global Mouse Recording Started (Via Web UI)...")
    
    while True:
        with state_lock:
            if not state["is_recording"]:
                break
        
        if is_kill_switch_pressed():
            print("\n✓ Recording stopped by physical kill switch.")
            with state_lock:
                state["is_recording"] = False
            break
            
        pos = get_mouse_position()
        path.append(pos)
        time.sleep(delay)
        
    with state_lock:
        state["recorded_path"] = path
        state["is_recording"] = False
    print(f"✓ Recording finished! Captured {len(path)} positions.")

def replay_background_loop():
    global state
    delay = 1.0 / state["sample_rate"]
    
    with state_lock:
        path = list(state["recorded_path"])
        
    if not path:
        print("No movements to replay.")
        with state_lock:
            state["is_replaying"] = False
        return
        
    print("\n>>> Playback Replay Loop Started...")
    
    while True:
        for pos in path:
            with state_lock:
                if not state["is_replaying"]:
                    print("\n🛑 Stopped: Playback stopped by Web UI request.")
                    return
            
            if is_kill_switch_pressed():
                print("\n🛑 Stopped: Kill switch detected (Escape/Ctrl+C). Exiting replayer.")
                with state_lock:
                    state["is_replaying"] = False
                return
                
            move_mouse(pos[0], pos[1])
            time.sleep(delay)

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
                    state["is_replaying"] = False # stop replay first
                state["is_recording"] = True
                state["recorded_path"] = []
                
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
                
            # Allow thread to exit
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
            # Get request body for path if sent by UI
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 0:
                try:
                    body = json.loads(self.rfile.read(content_length))
                    if "path" in body and body["path"]:
                        with state_lock:
                            state["recorded_path"] = body["path"]
                except Exception as e:
                    print(f"Error parsing replay path: {e}")
                    
            with state_lock:
                if state["is_recording"]:
                    state["is_recording"] = False
                state["is_replaying"] = True
                
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
    # Allow running on custom port if supplied
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    run_server(port)
