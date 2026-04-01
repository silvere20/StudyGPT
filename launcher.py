#!/usr/bin/env python3
"""
StudyFlow AI Launcher
Moderne GUI om de app te starten en stoppen.
"""
from collections import deque
import glob
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import tkinter as tk
import urllib.request
import webbrowser

# ── PATH uitbreiden (voor als dit vanuit een beperkte omgeving draait) ──
_EXTRA_PATH_DIRS = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
]
_NVM_VERSIONS = glob.glob(os.path.expanduser("~/.nvm/versions/node/*/bin"))
_EXTRA_PATH_DIRS.extend(sorted(_NVM_VERSIONS, reverse=True))

_current_path = os.environ.get("PATH", "")
for d in _EXTRA_PATH_DIRS:
    if os.path.isdir(d) and d not in _current_path:
        os.environ["PATH"] = d + ":" + os.environ["PATH"]

BASE_DIR = os.environ.get("STUDYFLOW_BASE_DIR",
                          os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
VENV_PYTHON = os.path.join(BACKEND_DIR, ".venv", "bin", "python")
FRONTEND_URL = "http://127.0.0.1:3000"

# Kleuren
C_BG       = "#FFFFFF"
C_SURFACE  = "#F8F9FA"
C_ORANGE   = "#FF6B35"
C_GREEN    = "#22C55E"
C_RED      = "#EF4444"
C_GRAY     = "#D1D5DB"
C_TEXT     = "#1A1A1A"
C_MUTED    = "#6B7280"
C_DISABLED_BG = "#F3F4F6"
C_DISABLED_FG = "#9CA3AF"

backend_proc = None
frontend_proc = None


def _darken(hex_color: str, amount: int = 20) -> str:
    r = max(0, int(hex_color[1:3], 16) - amount)
    g = max(0, int(hex_color[3:5], 16) - amount)
    b = max(0, int(hex_color[5:7], 16) - amount)
    return f"#{r:02x}{g:02x}{b:02x}"


def _check_prerequisites():
    issues = []
    if not os.path.exists(VENV_PYTHON):
        issues.append(("Python venv",
            f"Virtuele omgeving ontbreekt:\n{VENV_PYTHON}"))
    if not shutil.which("npm"):
        issues.append(("npm",
            "npm niet gevonden. Installeer Node.js:\n  brew install node"))
    if not shutil.which("tesseract"):
        issues.append(("Tesseract",
            "Tesseract niet gevonden:\n  brew install tesseract"))
    return issues


# ── Custom widgets ──

class FlatButton(tk.Frame):
    def __init__(self, parent, text, command=None,
                 bg=C_ORANGE, fg="white",
                 pady=14, font_size=14, font_bold=True, **kwargs):
        super().__init__(parent, bg=bg, cursor="hand2",
                         height=pady * 2 + 20, **kwargs)
        self.pack_propagate(False)
        self._bg = bg
        self._fg = fg
        self._disabled = False
        self._command = command
        self._hover_bg = _darken(bg, 25)

        weight = "bold" if font_bold else "normal"
        self._lbl = tk.Label(
            self, text=text, bg=bg, fg=fg,
            font=("Helvetica Neue", font_size, weight), cursor="hand2",
        )
        self._lbl.place(relx=0.5, rely=0.5, anchor="center")

        for w in (self, self._lbl):
            w.bind("<Button-1>", self._click)
            w.bind("<Enter>", self._enter)
            w.bind("<Leave>", self._leave)

    def _click(self, _=None):
        if not self._disabled and self._command:
            self._command()

    def _enter(self, _=None):
        if not self._disabled:
            self.config(bg=self._hover_bg)
            self._lbl.config(bg=self._hover_bg)

    def _leave(self, _=None):
        if not self._disabled:
            self.config(bg=self._bg)
            self._lbl.config(bg=self._bg)

    def set_enabled(self, enabled: bool, text: str | None = None):
        self._disabled = not enabled
        if enabled:
            self.config(bg=self._bg, cursor="hand2")
            self._lbl.config(bg=self._bg, fg=self._fg, cursor="hand2")
        else:
            self.config(bg=C_DISABLED_BG, cursor="")
            self._lbl.config(bg=C_DISABLED_BG, fg=C_DISABLED_FG, cursor="")
        if text is not None:
            self._lbl.config(text=text)

    def restyle(self, bg: str, fg: str):
        self._bg = bg
        self._fg = fg
        self._hover_bg = _darken(bg, 25)
        self.config(bg=bg)
        self._lbl.config(bg=bg, fg=fg)


class StatusDot(tk.Canvas):
    SIZE = 12

    def __init__(self, parent, **kwargs):
        super().__init__(parent, width=self.SIZE, height=self.SIZE,
                         bg=C_BG, highlightthickness=0, **kwargs)
        self._dot = self.create_oval(1, 1, self.SIZE - 1, self.SIZE - 1,
                                     fill=C_GRAY, outline="")

    def set_color(self, color: str):
        self.itemconfig(self._dot, fill=color)


# ── Main App ──

def _load_window_icon(root: tk.Tk):
    """Zet het app-icoon als tkinter window icon (indien beschikbaar)."""
    icon_path = os.path.join(BASE_DIR, "icon_512.png")
    if not os.path.exists(icon_path):
        return
    try:
        img = tk.PhotoImage(file=icon_path)
        root.iconphoto(True, img)
        # Bewaar referentie zodat garbage collector het niet opruimt
        root._icon_ref = img  # type: ignore[attr-defined]
    except Exception:
        pass


class LauncherApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.logs = {"backend": deque(maxlen=60), "frontend": deque(maxlen=60)}
        self.root.title("StudyFlow AI")
        self.root.resizable(False, False)
        self.root.configure(bg=C_BG)
        _load_window_icon(self.root)

        W, H = 400, 460
        self.root.update_idletasks()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        self.root.geometry(f"{W}x{H}+{(sw - W) // 2}+{(sh - H) // 2}")

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        self.root.lift()
        self.root.attributes("-topmost", True)
        self.root.after(400, lambda: self.root.attributes("-topmost", False))
        self.root.focus_force()

        self.root.after(300, self._check_prereqs_on_startup)

    def _build_ui(self):
        # Header
        header = tk.Frame(self.root, bg=C_ORANGE, height=110)
        header.pack(fill="x")
        header.pack_propagate(False)
        tk.Label(header, text="StudyFlow AI",
                 font=("Helvetica Neue", 22, "bold"),
                 bg=C_ORANGE, fg="white").place(relx=0.5, rely=0.42, anchor="center")
        tk.Label(header, text="Jouw interactieve studiehulp",
                 font=("Helvetica Neue", 12),
                 bg=C_ORANGE, fg="#FFE0D3").place(relx=0.5, rely=0.72, anchor="center")

        # Status
        sf = tk.Frame(self.root, bg=C_BG)
        sf.pack(fill="x", padx=32, pady=(22, 0))
        self._backend_dot = self._status_row(sf, "Backend (AI verwerking)")
        self._frontend_dot = self._status_row(sf, "Frontend (website)")

        tk.Frame(self.root, bg="#F3F4F6", height=1).pack(fill="x", padx=32, pady=18)

        # Buttons
        bf = tk.Frame(self.root, bg=C_BG)
        bf.pack(fill="x", padx=32)
        self.start_btn = FlatButton(bf, "Start App", command=self._start,
                                    bg=C_ORANGE, fg="white", font_size=15)
        self.start_btn.pack(fill="x", pady=(0, 10))
        self.stop_btn = FlatButton(bf, "Stop App", command=self._stop,
                                   bg=C_SURFACE, fg=C_TEXT, font_size=13, font_bold=False)
        self.stop_btn.pack(fill="x", pady=(0, 8))
        self.stop_btn.set_enabled(False)
        self.browser_btn = FlatButton(bf, "Open in Browser", command=self._open_browser,
                                      bg=C_SURFACE, fg=C_TEXT, font_size=13, font_bold=False)
        self.browser_btn.pack(fill="x")
        self.browser_btn.set_enabled(False)

        # Status text
        self.status_lbl = tk.Label(self.root, text="Klik op 'Start App' om te beginnen",
                                   font=("Helvetica Neue", 11), bg=C_BG, fg=C_MUTED,
                                   wraplength=340, justify="center")
        self.status_lbl.pack(pady=(16, 4), padx=24)
        self.details_lbl = tk.Label(self.root, text="",
                                    font=("Helvetica Neue", 9), bg=C_BG, fg=C_MUTED,
                                    wraplength=340, justify="center")
        self.details_lbl.pack(padx=24, pady=(0, 12))

    def _status_row(self, parent, label):
        row = tk.Frame(parent, bg=C_BG)
        row.pack(fill="x", pady=5)
        dot = StatusDot(row)
        dot.pack(side="left", padx=(0, 10))
        tk.Label(row, text=label, font=("Helvetica Neue", 13),
                 bg=C_BG, fg=C_TEXT).pack(side="left")
        return dot

    def _set_status(self, text, color=C_MUTED):
        self.status_lbl.config(text=text, fg=color)

    def _set_details(self, text=""):
        self.details_lbl.config(text=text)

    def _tail_log(self, key):
        lines = list(self.logs[key])
        return "\n".join(lines[-6:]) if lines else ""

    def _capture_output(self, process, key):
        if not process or not process.stdout:
            return
        try:
            for line in process.stdout:
                cleaned = line.strip()
                if cleaned:
                    self.logs[key].append(cleaned)
        except Exception:
            pass

    def _terminate(self, process):
        if not process or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()

    def _check_prereqs_on_startup(self):
        issues = _check_prerequisites()
        if issues:
            names = ", ".join(n for n, _ in issues)
            self._set_status(f"Ontbrekend: {names}", C_RED)
            self._set_details(" | ".join(n for n, _ in issues))

    # ── Start / Stop ──

    def _start(self):
        issues = _check_prerequisites()
        if issues:
            names = ", ".join(n for n, _ in issues)
            self._set_status(f"Kan niet starten: {names}", C_RED)
            return

        self.start_btn.set_enabled(False, "Starten…")
        self._set_status("Servers starten…", "#F59E0B")
        self._set_details("")
        self.logs["backend"].clear()
        self.logs["frontend"].clear()
        threading.Thread(target=self._start_servers, daemon=True).start()

    def _poll_backend(self, proc, max_seconds=90) -> bool:
        """Poll /api/health until it responds or the process crashes."""
        url = "http://127.0.0.1:8000/api/health"
        start = time.time()
        while time.time() - start < max_seconds:
            if proc.poll() is not None:
                return False
            try:
                with urllib.request.urlopen(url, timeout=1) as resp:
                    if resp.status == 200:
                        return True
            except Exception:
                pass
            elapsed = int(time.time() - start)
            self.root.after(0, lambda e=elapsed: self._set_status(
                f"Backend laden ({e}s)…", "#F59E0B"))
            time.sleep(0.5)
        return False

    def _poll_frontend(self, proc, max_seconds=60) -> bool:
        """Poll port 3000 until it accepts connections or the process crashes."""
        start = time.time()
        while time.time() - start < max_seconds:
            if proc.poll() is not None:
                return False
            try:
                with socket.create_connection(("127.0.0.1", 3000), timeout=1):
                    return True
            except OSError:
                pass
            elapsed = int(time.time() - start)
            self.root.after(0, lambda e=elapsed: self._set_status(
                f"Frontend laden ({e}s)…", "#F59E0B"))
            time.sleep(0.5)
        return False

    def _start_servers(self):
        global backend_proc, frontend_proc

        # Free ports
        for port in (8000, 3000):
            self._free_port(port)

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"

        # ── Backend ──
        self.root.after(0, lambda: self._set_status("Backend starten…", "#F59E0B"))
        try:
            backend_proc = subprocess.Popen(
                [VENV_PYTHON, "-m", "uvicorn", "main:app", "--port", "8000"],
                cwd=BACKEND_DIR,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, env=env,
            )
            threading.Thread(target=self._capture_output,
                             args=(backend_proc, "backend"), daemon=True).start()
        except Exception as exc:
            self._fail(f"Backend: {exc}")
            return

        if not self._poll_backend(backend_proc):
            log = self._tail_log("backend")
            self._fail(f"Backend fout:\n{log}" if log else "Backend crashte of startte niet op tijd.")
            self._terminate(backend_proc)
            backend_proc = None
            return
        self.root.after(0, lambda: self._backend_dot.set_color(C_GREEN))

        # ── Frontend ──
        npm = shutil.which("npm") or "npm"
        self.root.after(0, lambda: self._set_status("Frontend starten…", "#F59E0B"))
        try:
            frontend_proc = subprocess.Popen(
                [npm, "run", "dev:frontend"],
                cwd=BASE_DIR,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, env=env,
            )
            threading.Thread(target=self._capture_output,
                             args=(frontend_proc, "frontend"), daemon=True).start()
        except Exception as exc:
            self._terminate(backend_proc)
            backend_proc = None
            self.root.after(0, lambda: self._backend_dot.set_color(C_GRAY))
            self._fail(f"Frontend: {exc}")
            return

        if not self._poll_frontend(frontend_proc):
            log = self._tail_log("frontend")
            self._terminate(backend_proc)
            backend_proc = None
            self.root.after(0, lambda: self._backend_dot.set_color(C_GRAY))
            self._fail(f"Frontend fout:\n{log}" if log else "Frontend crashte of startte niet op tijd.")
            self._terminate(frontend_proc)
            frontend_proc = None
            return
        self.root.after(0, lambda: self._frontend_dot.set_color(C_GREEN))

        self.root.after(0, self._on_started)

    def _fail(self, detail):
        self.root.after(0, lambda: self._set_status("Kon niet starten.", C_RED))
        self.root.after(0, lambda: self._set_details(detail))
        self.root.after(0, lambda: self.start_btn.set_enabled(True, "Start App"))
        self.root.after(0, lambda: self.stop_btn.set_enabled(False))
        self.root.after(0, lambda: self.browser_btn.set_enabled(False))

    def _on_started(self):
        self._set_status("App is klaar!", C_GREEN)
        self._set_details("Backend en frontend draaien.")
        self.stop_btn.set_enabled(True)
        self.browser_btn.set_enabled(True)
        self.browser_btn.restyle(C_ORANGE, "white")
        self._open_browser()

    def _stop(self):
        global backend_proc, frontend_proc
        self._terminate(backend_proc)
        self._terminate(frontend_proc)
        backend_proc = None
        frontend_proc = None
        for port in (8000, 3000):
            self._free_port(port)
        self._backend_dot.set_color(C_GRAY)
        self._frontend_dot.set_color(C_GRAY)
        self._set_status("App gestopt.", C_MUTED)
        self._set_details("")
        self.start_btn.set_enabled(True, "Start App")
        self.stop_btn.set_enabled(False)
        self.browser_btn.set_enabled(False)
        self.browser_btn.restyle(C_SURFACE, C_MUTED)

    def _open_browser(self):
        webbrowser.open(FRONTEND_URL)

    def _on_close(self):
        self._stop()
        self.root.destroy()

    def _free_port(self, port):
        try:
            result = subprocess.run(["lsof", "-ti", f":{port}"],
                                    capture_output=True, text=True)
            pids = [p.strip() for p in result.stdout.strip().split("\n") if p.strip()]
            for pid in pids:
                subprocess.run(["kill", "-9", pid], capture_output=True)
            if pids:
                for _ in range(12):
                    time.sleep(0.25)
                    check = subprocess.run(["lsof", "-ti", f":{port}"],
                                           capture_output=True, text=True)
                    if not check.stdout.strip():
                        break
        except Exception:
            pass


if __name__ == "__main__":
    root = tk.Tk()
    LauncherApp(root)
    root.mainloop()
