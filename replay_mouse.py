import ctypes
import time
import sys
import json
import threading
import random
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from pynput import keyboard, mouse

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

def click_mouse(x, y, button="left", pressed=True):
    cg = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
    cg.CGEventCreateMouseEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint32, CGPoint, ctypes.c_uint32]
    cg.CGEventCreateMouseEvent.restype = ctypes.c_void_p
    
    if button == "left":
        mouse_type = 1 if pressed else 2
        mouse_button = 0
    elif button == "right":
        mouse_type = 3 if pressed else 4
        mouse_button = 1
    elif button == "middle":
        mouse_type = 25 if pressed else 26
        mouse_button = 2
    else:
        mouse_type = 1 if pressed else 2
        mouse_button = 0
        
    event = cg.CGEventCreateMouseEvent(None, mouse_type, CGPoint(x, y), mouse_button)
    
    cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
    cg.CGEventPost(0, event)
    
    cg.CFRelease.argtypes = [ctypes.c_void_p]
    cg.CFRelease(event)

def key_event(vk_code, pressed=True):
    try:
        cg = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
        cg.CGEventCreateKeyboardEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint16, ctypes.c_bool]
        cg.CGEventCreateKeyboardEvent.restype = ctypes.c_void_p
        
        event = cg.CGEventCreateKeyboardEvent(None, vk_code, pressed)
        
        cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
        cg.CGEventPost(0, event)
        
        cg.CFRelease.argtypes = [ctypes.c_void_p]
        cg.CFRelease(event)
    except Exception as e:
        print(f"Error posting keyboard event: {e}")

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
            x = float(parts[0])
            y = float(parts[1])
            w = float(parts[2])
            h = float(parts[3])
            app_name = parts[4]
            
            # Exclude known background/system processes, menu bars (height < 30), or tiny windows (dialogs)
            ignored_apps = ["System Events", "ControlCenter", "NotificationCenter", "loginwindow", "Dock", "Window Server", "Screen Sharing"]
            if app_name not in ignored_apps and w > 200 and h > 200 and y > 23:
                return {
                    "x": x,
                    "y": y,
                    "width": w,
                    "height": h,
                    "app": app_name
                }
    except Exception:
        pass
    return None

def get_window_bounds_by_app(app_name):
    """Get the window boundaries of a specific application on macOS via AppleScript."""
    script = f'''
    tell application "System Events"
        if exists application process "{app_name}" then
            tell process "{app_name}"
                try
                    set frontWindow to first window
                    set pos to position of frontWindow
                    set sz to size of frontWindow
                    return (item 1 of pos as text) & "," & (item 2 of pos as text) & "," & (item 1 of sz as text) & "," & (item 2 of sz as text)
                on error
                    return "0,0,0,0"
                end try
            end tell
        else
            return "0,0,0,0"
        end if
    end tell
    '''
    try:
        proc = subprocess.run(['osascript', '-e', script], capture_output=True, text=True, timeout=1.0)
        output = proc.stdout.strip()
        parts = output.split(',')
        if len(parts) >= 4:
            x = float(parts[0])
            y = float(parts[1])
            w = float(parts[2])
            h = float(parts[3])
            if w > 100 and h > 100:
                return {
                    "x": x,
                    "y": y,
                    "width": w,
                    "height": h,
                    "app": app_name
                }
    except Exception:
        pass
    return None

def focus_app(app_name):
    """Bring the target application to the frontmost focus on macOS."""
    script = f'''
    tell application "System Events"
        if exists application process "{app_name}" then
            set frontmost of application process "{app_name}" to true
        end if
    end tell
    '''
    try:
        subprocess.run(['osascript', '-e', script], timeout=1.0)
    except Exception:
        pass

# Global state management for HTTP Server
state = {
    "recorded_path": [],      # List of {"nx": nx, "ny": ny, "rx": rx, "ry": ry}
    "target_window": None,    # Start window boundaries
    "is_recording": False,
    "is_replaying": False,
    "sample_rate": 20,
    "replay_mode": "loop"     # "loop" or "once"/"one-shot"
}

state_lock = threading.Lock()

def get_key_vk(key):
    vk = None
    if hasattr(key, 'vk'):
        vk = key.vk
    elif hasattr(key, 'value') and hasattr(key.value, 'vk'):
        vk = key.value.vk
        
    if vk is None and hasattr(key, 'char') and key.char is not None:
        char_keycodes = {
            'a': 0, 's': 1, 'd': 2, 'f': 3, 'h': 4, 'g': 5, 'z': 6, 'x': 7, 'c': 8, 'v': 9,
            'b': 11, 'q': 12, 'w': 13, 'e': 14, 'r': 15, 'y': 16, 't': 17, '1': 18, '2': 19,
            '3': 20, '4': 21, '6': 22, '5': 23, '=': 24, '9': 25, '7': 26, '-': 27, '8': 28,
            '0': 29, ']': 30, 'o': 31, 'u': 32, '[': 33, 'i': 34, 'p': 35, 'l': 37, 'j': 38,
            "'": 39, 'k': 40, ';': 41, '\\': 42, ',': 43, '/': 44, 'n': 45, 'm': 46, '.': 47,
            '`': 50, ' ': 49
        }
        vk = char_keycodes.get(key.char.lower())
        
    if vk is None and hasattr(key, 'name'):
        special_keycodes = {
            'enter': 36,
            'space': 49,
            'backspace': 51,
            'tab': 48,
            'esc': 53,
            'shift': 56,
            'shift_r': 60,
            'ctrl': 59,
            'ctrl_r': 62,
            'alt': 58,
            'alt_r': 61,
            'cmd': 55,
            'cmd_r': 54,
            'up': 126,
            'down': 125,
            'left': 123,
            'right': 124
        }
        vk = special_keycodes.get(key.name)
    return vk

def record_background_loop():
    global state
    path = []
    start_time = time.time()
    
    print("\n>>> Global Mouse/Keyboard Recording Started (Via Web UI)...")
    
    # Capture active window bounds at the start
    start_window = get_active_window_bounds()
    if start_window:
        print(f"Targeting active window: {start_window['app']} at ({start_window['x']}, {start_window['y']})")
    else:
        print("No active target window identified. Falling back to screen-normalized coordinates.")
        
    sw, sh = get_screen_resolution()
    
    def on_move(x, y):
        # Limit movement capture frequency slightly if needed, but let's record everything to capture smooth curves
        t = time.time() - start_time
        nx = x / sw if sw > 0 else 0
        ny = y / sh if sh > 0 else 0
        pt = {
            "type": "move",
            "time": t,
            "nx": nx,
            "ny": ny
        }
        if start_window:
            pt["rx"] = x - start_window["x"]
            pt["ry"] = y - start_window["y"]
        else:
            pt["rx"] = None
            pt["ry"] = None
        path.append(pt)
        
    def on_click(x, y, button, pressed):
        t = time.time() - start_time
        nx = x / sw if sw > 0 else 0
        ny = y / sh if sh > 0 else 0
        pt = {
            "type": "click",
            "time": t,
            "nx": nx,
            "ny": ny,
            "button": button.name,
            "pressed": pressed
        }
        if start_window:
            pt["rx"] = x - start_window["x"]
            pt["ry"] = y - start_window["y"]
        else:
            pt["rx"] = None
            pt["ry"] = None
        path.append(pt)
        
    def on_press(key):
        t = time.time() - start_time
        try:
            key_str = key.char if hasattr(key, 'char') and key.char is not None else str(key)
        except Exception:
            key_str = str(key)
        
        vk = get_key_vk(key)
        path.append({
            "type": "key",
            "time": t,
            "key": key_str,
            "vk": vk,
            "pressed": True
        })
        
    def on_release(key):
        t = time.time() - start_time
        try:
            key_str = key.char if hasattr(key, 'char') and key.char is not None else str(key)
        except Exception:
            key_str = str(key)
            
        vk = get_key_vk(key)
        path.append({
            "type": "key",
            "time": t,
            "key": key_str,
            "vk": vk,
            "pressed": False
        })

    # Start the listeners asynchronously
    mouse_listener = mouse.Listener(on_move=on_move, on_click=on_click)
    keyboard_listener = keyboard.Listener(on_press=on_press, on_release=on_release)
    
    mouse_listener.start()
    keyboard_listener.start()
    
    while True:
        with state_lock:
            if not state["is_recording"]:
                break
        
        if is_kill_switch_pressed():
            print("\n✓ Recording stopped by physical kill switch.")
            with state_lock:
                state["is_recording"] = False
            break
            
        time.sleep(0.1)
        
    mouse_listener.stop()
    keyboard_listener.stop()
    
    with state_lock:
        # Sort all recorded actions by timestamp to preserve chronological ordering
        path.sort(key=lambda event: event["time"])
        state["recorded_path"] = path
        state["target_window"] = start_window
        state["is_recording"] = False
    print(f"✓ Recording finished! Captured {len(path)} events.")

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
    
    with state_lock:
        path = list(state["recorded_path"])
        target_window = state["target_window"]
        replay_mode = state["replay_mode"]
        
    if not path:
        print("No movements/events to replay.")
        with state_lock:
            state["is_replaying"] = False
        return
        
    print("\n>>> Playback Replay Loop Started...")
    
    # Controllers for replaying clicks/keys
    mouse_ctrl = mouse.Controller()
    keyboard_ctrl = keyboard.Controller()
    
    current_window = None
    if target_window and "app" in target_window:
        print(f"Bringing original app '{target_window['app']}' to focus...")
        focus_app(target_window["app"])
        time.sleep(0.5)  # Wait for focus transition
        current_window = get_window_bounds_by_app(target_window["app"])
        
    if not current_window:
        current_window = get_active_window_bounds()
    
    def get_offset_coords(pt, win):
        sw, sh = get_screen_resolution()
        fallback_x = pt.get("nx", 0.0) * sw
        fallback_y = pt.get("ny", 0.0) * sh
        
        rx = pt.get("rx")
        ry = pt.get("ry")
        
        if win and rx is not None and ry is not None:
            tx = win["x"] + rx
            ty = win["y"] + ry
            if 0 <= tx <= sw and 23 <= ty <= sh:
                return tx, ty
        return fallback_x, fallback_y

    # Find the first coordinate event to glide smoothly to
    first_coord_pt = next((pt for pt in path if pt.get("type", "move") in ["move", "click"]), None)
    if first_coord_pt:
        start_x, start_y = get_offset_coords(first_coord_pt, current_window)
        current_pos = get_mouse_position()
        print(f"Gliding cursor smoothly to start position ({start_x:.1f}, {start_y:.1f})...")
        glide_path = generate_bezier_path(current_pos, (start_x, start_y), steps=25)
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
            time.sleep(0.01 * random.uniform(0.8, 1.2))
            
    print("Replaying events...")
    loop_count = 0
    while True:
        if target_window and "app" in target_window and loop_count % 2 == 0:
            current_window = get_window_bounds_by_app(target_window["app"])
        elif loop_count % 2 == 0:
            current_window = get_active_window_bounds()
            
        last_time = 0.0
        for i, pt in enumerate(path):
            with state_lock:
                if not state["is_replaying"]:
                    print("\n🛑 Stopped: Playback stopped by Web UI request.")
                    return
            
            if is_kill_switch_pressed():
                print("\n🛑 Stopped: Kill switch detected (Escape/Ctrl+C). Exiting replayer.")
                with state_lock:
                    state["is_replaying"] = False
                return
                
            event_time = pt.get("time", 0.0)
            if i > 0:
                delay = event_time - last_time
                if delay > 0:
                    variance_factor = random.gauss(1.0, 0.08)
                    variance_factor = max(0.6, min(1.4, variance_factor))
                    time.sleep(delay * variance_factor)
            last_time = event_time
            
            event_type = pt.get("type", "move")
            
            if event_type == "move":
                base_x, base_y = get_offset_coords(pt, current_window)
                jitter_x = random.gauss(0, 0.6)
                jitter_y = random.gauss(0, 0.6)
                move_mouse(base_x + jitter_x, base_y + jitter_y)
                
            elif event_type == "click":
                base_x, base_y = get_offset_coords(pt, current_window)
                btn_name = pt.get("button", "left")
                pressed = pt.get("pressed", True)
                click_mouse(base_x, base_y, btn_name, pressed)
                
            elif event_type == "key":
                pressed = pt.get("pressed", True)
                vk = pt.get("vk")
                
                if vk is None:
                    key_str = pt.get("key")
                    if key_str:
                        if key_str.startswith("Key."):
                            key_name = key_str.split(".")[1]
                            special_keycodes = {
                                'enter': 36, 'space': 49, 'backspace': 51, 'tab': 48,
                                'esc': 53, 'shift': 56, 'shift_r': 60, 'ctrl': 59,
                                'ctrl_r': 62, 'alt': 58, 'alt_r': 61, 'cmd': 55,
                                'cmd_r': 54, 'up': 126, 'down': 125, 'left': 123, 'right': 124
                            }
                            vk = special_keycodes.get(key_name.lower())
                        elif len(key_str) == 3 and key_str.startswith("'") and key_str.endswith("'"):
                            char = key_str[1].lower()
                            char_keycodes = {
                                'a': 0, 's': 1, 'd': 2, 'f': 3, 'h': 4, 'g': 5, 'z': 6, 'x': 7, 'c': 8, 'v': 9,
                                'b': 11, 'q': 12, 'w': 13, 'e': 14, 'r': 15, 'y': 16, 't': 17, '1': 18, '2': 19,
                                '3': 20, '4': 21, '6': 22, '5': 23, '=': 24, '9': 25, '7': 26, '-': 27, '8': 28,
                                '0': 29, ']': 30, 'o': 31, 'u': 32, '[': 33, 'i': 34, 'p': 35, 'l': 37, 'j': 38,
                                "'": 39, 'k': 40, ';': 41, '\\': 42, ',': 43, '/': 44, 'n': 45, 'm': 46, '.': 47,
                                '`': 50, ' ': 49
                            }
                            vk = char_keycodes.get(char)
                        elif len(key_str) == 1:
                            char = key_str.lower()
                            char_keycodes = {
                                'a': 0, 's': 1, 'd': 2, 'f': 3, 'h': 4, 'g': 5, 'z': 6, 'x': 7, 'c': 8, 'v': 9,
                                'b': 11, 'q': 12, 'w': 13, 'e': 14, 'r': 15, 'y': 16, 't': 17, '1': 18, '2': 19,
                                '3': 20, '4': 21, '6': 22, '5': 23, '=': 24, '9': 25, '7': 26, '-': 27, '8': 28,
                                '0': 29, ']': 30, 'o': 31, 'u': 32, '[': 33, 'i': 34, 'p': 35, 'l': 37, 'j': 38,
                                "'": 39, 'k': 40, ';': 41, '\\': 42, ',': 43, '/': 44, 'n': 45, 'm': 46, '.': 47,
                                '`': 50, ' ': 49
                            }
                            vk = char_keycodes.get(char)
                            
                if vk is not None:
                    try:
                        key_event(int(vk), pressed)
                    except Exception as e:
                        print(f"Error replaying key event {vk}: {e}")
                        
        loop_count += 1
        if replay_mode in ["once", "one-shot"]:
            print(f"\n✓ {replay_mode.title()} playback complete.")
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
                                    "type": pt.get("type", "move"),
                                    "time": pt.get("time", 0.0),
                                    "nx": pt.get("nx", 0.0),
                                    "ny": pt.get("ny", 0.0),
                                    "rx": pt.get("rx"),
                                    "ry": pt.get("ry"),
                                    "button": pt.get("button"),
                                    "pressed": pt.get("pressed"),
                                    "key": pt.get("key")
                                })
                            elif isinstance(pt, list) and len(pt) >= 2:
                                sw, sh = get_screen_resolution()
                                parsed_path.append({
                                    "type": "move",
                                    "time": 0.0,
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
                if content_length > 0 and body is not None and isinstance(body, dict) and "mode" in body:
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

def on_start_replay():
    print("Hotkey triggered: Cmd+Opt+R (Start Replay)")
    global state
    with state_lock:
        if state["is_recording"]:
            state["is_recording"] = False
        if not state["is_replaying"] and state["recorded_path"]:
            state["is_replaying"] = True
            thread = threading.Thread(target=replay_background_loop)
            thread.daemon = True
            thread.start()
            print("✓ Playback started via hotkey.")
        elif not state["recorded_path"]:
            print("⚠ Hotkey warning: No recorded pathway loaded to replay.")

def on_stop_all():
    print("Hotkey triggered: Cmd+Opt+S (Stop Recording/Replay)")
    global state
    with state_lock:
        state["is_recording"] = False
        state["is_replaying"] = False
    print("✓ Stopped all tasks via hotkey.")

def start_hotkey_listener():
    try:
        hotkeys = keyboard.GlobalHotKeys({
            '<cmd>+<alt>+r': on_start_replay,
            '<cmd>+<alt>+s': on_stop_all
        })
        thread = threading.Thread(target=hotkeys.run)
        thread.daemon = True
        thread.start()
        print("✓ Global Hotkey Listener active: Cmd+Opt+R (Start), Cmd+Opt+S (Stop)")
    except Exception as e:
        print(f"Error starting global hotkey listener: {e}")

def run_server(port=8000):
    start_hotkey_listener()
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
