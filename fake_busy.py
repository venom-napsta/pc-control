#!/usr/bin/env python3
"""Fake busy screen — convincing VS Code lookalike with live typing animation.
Terminated via SIGTERM from the server's /fake-busy/dismiss endpoint."""
import signal, sys, random, time

signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
signal.signal(signal.SIGINT, lambda *_: sys.exit(0))

try:
    import tkinter as tk
except ImportError:
    import subprocess
    subprocess.run([
        "zenity", "--info", "--title=Visual Studio Code",
        "--text=Working...", "--width=9999", "--height=9999",
    ])
    sys.exit(0)

# ── VS Code Dark+ Theme ──────────────────────────────────────────────────────
C = {
    "bg":         "#1E1E1E",
    "sidebar":    "#252526",
    "activity":   "#333333",
    "titlebar":   "#323233",
    "statusbar":  "#007ACC",
    "tab_active":  "#1E1E1E",
    "tab_inactive":"#2D2D2D",
    "border":     "#3C3C3C",
    "text":       "#D4D4D4",
    "dim":        "#858585",
    "line_nr":    "#858585",
    "comment":    "#6A9955",
    "string":     "#CE9178",
    "keyword":    "#569CD6",
    "function":   "#DCDCAA",
    "number":     "#B5CEA8",
    "type":       "#4EC9B0",
    "variable":   "#9CDCFE",
    "decorator":  "#DCDCAA",
    "operator":   "#D4D4D4",
    "selected":   "#37373D",
    "green":      "#4EC9B0",
    "yellow":     "#DCDCAA",
    "red":        "#F44747",
}

# ── Fonts (Linux-friendly) ───────────────────────────────────────────────────
MONO = "Ubuntu Mono"
UI   = "Ubuntu"
MONO_SZ = 14
UI_SZ   = 10

# ── Fake code to type ────────────────────────────────────────────────────────
CODE = '''import asyncio
from dataclasses import dataclass
from typing import Optional
import httpx

from config import settings
from models import Pipeline, DataSource


@dataclass
class TransformResult:
    """Result of a data transformation step."""
    rows_processed: int
    rows_failed: int
    duration_ms: float
    output_path: str


class DataPipeline:
    """Main ETL pipeline for data ingestion."""

    def __init__(self, source: DataSource):
        self.source = source
        self.client = httpx.AsyncClient(timeout=30)
        self._buffer: list[dict] = []
        self._stats = {"processed": 0, "errors": 0}

    async def extract(self) -> list[dict]:
        """Pull raw data from the configured source."""
        url = f"{settings.API_BASE}/v2/data/{self.source.id}"
        resp = await self.client.get(
            url, headers=self._auth_headers()
        )
        if resp.status_code != 200:
            raise ConnectionError(
                f"Source returned {resp.status_code}"
            )
        raw = resp.json()["results"]
        self._buffer = [
            self._normalize(r) for r in raw
        ]
        return self._buffer

    def _normalize(self, record: dict) -> dict:
        """Clean and normalize a single record."""
        return {
            "id": record["id"],
            "timestamp": record.get("ts"),
            "value": float(record["value"]),
            "tags": record.get("tags", []),
            "source": self.source.name,
        }

    async def transform(self) -> TransformResult:
        """Apply transformation rules to buffered data."""
        start = asyncio.get_event_loop().time()
        ok, fail = 0, 0

        for record in self._buffer:
            try:
                record["value"] = self._apply_rules(record)
                ok += 1
            except ValueError:
                fail += 1

        elapsed = (asyncio.get_event_loop().time() - start) * 1000
        return TransformResult(
            rows_processed=ok,
            rows_failed=fail,
            duration_ms=round(elapsed, 2),
            output_path=f"/tmp/pipeline_{self.source.id}",
        )

    async def load(self, target: str = "warehouse") -> dict:
        """Push transformed data to the target system."""
        payload = {
            "records": self._buffer,
            "source_id": self.source.id,
            "batch_size": settings.BATCH_SIZE,
        }
        resp = await self.client.post(
            f"{settings.API_BASE}/v2/ingest/{target}",
            json=payload,
        )
        return resp.json()


async def run_pipeline(source_id: int):
    """Execute the full ETL pipeline."""
    source = await DataSource.fetch(source_id)
    pipe = DataPipeline(source)

    print(f"[*] Starting pipeline for {source.name}")
    data = await pipe.extract()
    print(f"[+] Extracted {len(data)} records")

    result = await pipe.transform()
    print(f"[+] Transformed: {result.rows_processed} ok, "
          f"{result.rows_failed} failed ({result.duration_ms}ms)")

    output = await pipe.load()
    print(f"[+] Loaded to warehouse: {output['status']}")

    return result


if __name__ == "__main__":
    asyncio.run(run_pipeline(source_id=42))
'''

# ── Terminal output ──────────────────────────────────────────────────────────
# (text, color_tag) tuples per line
TERM_LINES = [
    [("$ ", "green"), ("python -m pytest tests/ -v --tb=short", "text")],
    [],
    [("============================= test session starts ==============================", "text")],
    [("platform linux -- Python 3.12.3, pytest-8.1.1, pluggy-1.4.0", "dim")],
    [("rootdir: /home/dev/project", "dim")],
    [("configfile: pyproject.toml", "dim")],
    [("collected 18 items", "text")],
    [],
    [("tests/test_pipeline.py::test_extract_valid ", "text"), ("PASSED", "green")],
    [("tests/test_pipeline.py::test_extract_auth_fail ", "text"), ("PASSED", "green")],
    [("tests/test_pipeline.py::test_normalize_basic ", "text"), ("PASSED", "green")],
    [("tests/test_pipeline.py::test_normalize_missing_ts ", "text"), ("PASSED", "green")],
    [("tests/test_pipeline.py::test_transform_ok ", "text"), ("PASSED", "green")],
    [("tests/test_pipeline.py::test_transform_value_err ", "text"), ("PASSED", "green")],
    [("tests/test_pipeline.py::test_load_warehouse ", "text"), ("PASSED", "green")],
    [("tests/test_pipeline.py::test_load_datalake ", "text"), ("PASSED", "green")],
    [("tests/test_pipeline.py::test_run_pipeline_e2e ", "text"), ("PASSED", "green")],
    [],
    [("============================== ", "text"), ("9 passed", "green"), (" in 2.84s ", "text"),
     ("==============================", "text")],
    [],
    [("$ ", "green"), ("python src/data_pipeline.py", "text")],
    [("[*] Starting pipeline for sensor_feed_prod", "yellow")],
    [("[+] Extracted 2,847 records", "green")],
    [("[+] Transformed: 2,841 ok, 6 failed (14.2ms)", "green")],
    [("[+] Loaded to warehouse: ok", "green")],
    [],
    [("$ ", "green"), ("", "text")],
]

# ── File tree ────────────────────────────────────────────────────────────────
FILE_TREE = [
    ("EXPLORER",             0, "header"),
    ("\u25BE PROJECT",       0, "section"),
    ("  \u25BE src",         1, "folder"),
    ("    \u25B8 api",       2, "folder"),
    ("    \u25B8 models",    2, "folder"),
    ("      config.py",      2, "file"),
    ("      data_pipeline.py", 2, "active"),
    ("      utils.py",       2, "file"),
    ("  \u25BE tests",       1, "folder"),
    ("      test_pipeline.py", 2, "file"),
    ("      conftest.py",    2, "file"),
    ("  .env",               1, "file_dim"),
    ("  .gitignore",         1, "file_dim"),
    ("  pyproject.toml",     1, "file"),
    ("  README.md",          1, "file"),
]


# ── Simple Python tokenizer ──────────────────────────────────────────────────
KEYWORDS = {
    "import", "from", "class", "def", "async", "await", "return",
    "for", "in", "try", "except", "if", "raise", "self", "None",
    "True", "False", "as", "with", "not", "and", "or", "is",
}
BUILTINS = {
    "int", "float", "str", "list", "dict", "print", "len",
    "min", "max", "round", "Optional",
}


def tokenize(code):
    """Tokenize Python code into (char, tag) pairs for syntax highlighting."""
    tokens = []
    i, n = 0, len(code)

    while i < n:
        ch = code[i]

        # Triple-quoted strings
        if code[i:i+3] in ('"""', "'''"):
            q = code[i:i+3]
            end = code.find(q, i + 3)
            end = (end + 3) if end != -1 else n
            for c in code[i:end]:
                tokens.append((c, "string"))
            i = end
            continue

        # Comments
        if ch == '#':
            end = code.find('\n', i)
            if end == -1: end = n
            for c in code[i:end]:
                tokens.append((c, "comment"))
            i = end
            continue

        # Single-line strings
        if ch in ('"', "'"):
            q, j = ch, i + 1
            tokens.append((ch, "string"))
            while j < n and code[j] != q and code[j] != '\n':
                if code[j] == '\\' and j + 1 < n:
                    tokens.append((code[j], "string"))
                    j += 1
                tokens.append((code[j], "string"))
                j += 1
            if j < n and code[j] == q:
                tokens.append((code[j], "string"))
                j += 1
            i = j
            continue

        # Decorators
        if ch == '@':
            j = i + 1
            while j < n and (code[j].isalnum() or code[j] == '_'):
                j += 1
            for c in code[i:j]:
                tokens.append((c, "decorator"))
            i = j
            continue

        # Words (identifiers, keywords, types)
        if ch.isalpha() or ch == '_':
            j = i + 1
            while j < n and (code[j].isalnum() or code[j] == '_'):
                j += 1
            word = code[i:j]

            if word in KEYWORDS:
                tag = "keyword"
            elif word in BUILTINS:
                tag = "type"
            elif j < n and code[j] == '(':
                tag = "function"
            elif word[0].isupper():
                tag = "type"
            elif word == 'f' and j < n and code[j] in ('"', "'"):
                tag = "string"
            else:
                tag = "variable"

            for c in word:
                tokens.append((c, tag))
            i = j
            continue

        # Numbers
        if ch.isdigit():
            j = i + 1
            while j < n and (code[j].isdigit() or code[j] == '.'):
                j += 1
            for c in code[i:j]:
                tokens.append((c, "number"))
            i = j
            continue

        # Everything else (operators, whitespace, punctuation)
        tokens.append((ch, "text"))
        i += 1

    return tokens


# ── Main Application ─────────────────────────────────────────────────────────
class FakeVSCode:
    def __init__(self):
        self.root = tk.Tk()
        self._configure_window()
        self._build_titlebar()
        self._build_statusbar()
        self._build_main()
        self._init_editor_tags()
        self._init_terminal_tags()
        self._start_animations()

    # ── Window setup ──────────────────────────────────────────────────────────
    def _configure_window(self):
        self.root.title("")
        self.root.attributes("-fullscreen", True)
        self.root.configure(bg=C["bg"])
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.protocol("WM_DELETE_WINDOW", lambda: None)
        self.root.bind("<Escape>", lambda e: None)
        self.root.bind("<Alt-F4>", lambda e: "break")

    # ── Title bar ─────────────────────────────────────────────────────────────
    def _build_titlebar(self):
        bar = tk.Frame(self.root, bg=C["titlebar"], height=30)
        bar.pack(fill="x")
        bar.pack_propagate(False)

        # Menu items
        menus = ["File", "Edit", "Selection", "View", "Go", "Run", "Terminal", "Help"]
        for m in menus:
            tk.Label(bar, text=m, font=(UI, 9), bg=C["titlebar"], fg=C["dim"],
                     padx=6).pack(side="left")

        # Center title
        tk.Label(bar, text="data_pipeline.py \u2014 project \u2014 Visual Studio Code",
                 font=(UI, 9), bg=C["titlebar"], fg=C["dim"]).pack(expand=True)

        # Window controls
        for sym in ["\u2500", "\u25A1", "\u2715"]:
            tk.Label(bar, text=sym, font=(UI, 10), bg=C["titlebar"], fg=C["dim"],
                     padx=10).pack(side="right")

    # ── Status bar ────────────────────────────────────────────────────────────
    def _build_statusbar(self):
        bar = tk.Frame(self.root, bg=C["statusbar"], height=24)
        bar.pack(fill="x", side="bottom")
        bar.pack_propagate(False)

        # Left items
        for txt in ["\u26A1 main", "\u21BB 0", "\u26A0 0  \u24E7 0"]:
            tk.Label(bar, text=txt, font=(UI, 9), bg=C["statusbar"], fg="white",
                     padx=6).pack(side="left")

        # Right items
        self.pos_label = tk.Label(bar, text="Ln 1, Col 1", font=(UI, 9),
                                  bg=C["statusbar"], fg="white", padx=6)
        self.pos_label.pack(side="right")
        for txt in ["Python", "UTF-8", "LF", "Spaces: 4"]:
            tk.Label(bar, text=txt, font=(UI, 9), bg=C["statusbar"], fg="white",
                     padx=6).pack(side="right")

    # ── Main area ─────────────────────────────────────────────────────────────
    def _build_main(self):
        main = tk.Frame(self.root, bg=C["bg"])
        main.pack(fill="both", expand=True)

        # Activity bar
        activity = tk.Frame(main, bg=C["activity"], width=48)
        activity.pack(side="left", fill="y")
        activity.pack_propagate(False)

        icons = [
            ("\u2630", True),   # files (active)
            ("\u2315", False),  # search
            ("\u2387", False),  # git
            ("\u25B7", False),  # debug
            ("\u229E", False),  # extensions
        ]
        for sym, active in icons:
            fg = "white" if active else C["dim"]
            side_mark = C["statusbar"] if active else C["activity"]
            row = tk.Frame(activity, bg=C["activity"])
            row.pack(fill="x")
            tk.Frame(row, bg=side_mark, width=2).pack(side="left", fill="y")
            tk.Label(row, text=sym, font=(MONO, 16), bg=C["activity"], fg=fg,
                     pady=10, padx=12).pack()

        # Border
        tk.Frame(main, bg=C["border"], width=1).pack(side="left", fill="y")

        # Sidebar
        sidebar = tk.Frame(main, bg=C["sidebar"], width=220)
        sidebar.pack(side="left", fill="y")
        sidebar.pack_propagate(False)
        self._build_file_tree(sidebar)

        # Border
        tk.Frame(main, bg=C["border"], width=1).pack(side="left", fill="y")

        # Right panel (editor + terminal)
        right = tk.Frame(main, bg=C["bg"])
        right.pack(side="left", fill="both", expand=True)

        self._build_tabs(right)

        # Horizontal split: editor top, terminal bottom
        pane = tk.Frame(right, bg=C["bg"])
        pane.pack(fill="both", expand=True)

        # Terminal (pack first with side=bottom so editor fills rest)
        self._build_terminal(pane)

        # Editor
        self._build_editor(pane)

    def _build_file_tree(self, parent):
        for name, indent, kind in FILE_TREE:
            if kind == "header":
                tk.Label(parent, text=name, font=(UI, 9, "bold"), bg=C["sidebar"],
                         fg=C["dim"], anchor="w", padx=10, pady=(8, 4)).pack(fill="x")
            elif kind == "section":
                tk.Label(parent, text=name, font=(UI, 9, "bold"), bg=C["sidebar"],
                         fg=C["text"], anchor="w", padx=10, pady=2).pack(fill="x")
            elif kind == "active":
                tk.Label(parent, text=name, font=(MONO, 10), bg=C["selected"],
                         fg="white", anchor="w", padx=10 + indent * 6, pady=1).pack(fill="x")
            elif kind == "folder":
                tk.Label(parent, text=name, font=(MONO, 10), bg=C["sidebar"],
                         fg=C["text"], anchor="w", padx=10 + indent * 6, pady=1).pack(fill="x")
            elif kind == "file_dim":
                tk.Label(parent, text=name, font=(MONO, 10), bg=C["sidebar"],
                         fg=C["dim"], anchor="w", padx=10 + indent * 6, pady=1).pack(fill="x")
            else:
                tk.Label(parent, text=name, font=(MONO, 10), bg=C["sidebar"],
                         fg=C["dim"], anchor="w", padx=10 + indent * 6, pady=1).pack(fill="x")

    def _build_tabs(self, parent):
        tabs_frame = tk.Frame(parent, bg=C["tab_inactive"], height=36)
        tabs_frame.pack(fill="x")
        tabs_frame.pack_propagate(False)

        tab_data = [
            ("data_pipeline.py", True),
            ("config.py",        False),
            ("models.py",        False),
        ]
        for name, active in tab_data:
            bg = C["tab_active"] if active else C["tab_inactive"]
            fg = "white" if active else C["dim"]
            tab = tk.Frame(tabs_frame, bg=bg)
            tab.pack(side="left", fill="y")
            if active:
                tk.Frame(tab, bg=C["statusbar"], height=1).pack(fill="x", side="top")
            tk.Label(tab, text=f"   {name}   \u00D7   ", font=(UI, 9), bg=bg, fg=fg).pack(
                pady=(4 if active else 5, 0))

        # Breadcrumb bar
        bread = tk.Frame(parent, bg=C["bg"], height=22)
        bread.pack(fill="x")
        bread.pack_propagate(False)
        crumbs = "  src  \u203A  data_pipeline.py  \u203A  DataPipeline"
        tk.Label(bread, text=crumbs, font=(UI, 9), bg=C["bg"], fg=C["dim"],
                 padx=8).pack(side="left")

    def _build_editor(self, parent):
        editor_area = tk.Frame(parent, bg=C["bg"])
        editor_area.pack(fill="both", expand=True)

        # Line numbers
        self.line_nums = tk.Text(
            editor_area, width=5, bg="#1E1E1E", fg=C["line_nr"],
            font=(MONO, MONO_SZ), state="disabled", borderwidth=0,
            highlightthickness=0, padx=(16, 4), pady=4, wrap="none",
            cursor="arrow", selectbackground=C["bg"],
        )
        self.line_nums.pack(side="left", fill="y")

        # Code area
        self.editor = tk.Text(
            editor_area, bg=C["bg"], fg=C["text"], font=(MONO, MONO_SZ),
            insertbackground=C["text"], insertwidth=2, borderwidth=0,
            highlightthickness=0, padx=0, pady=4, wrap="none",
            cursor="xterm", selectbackground="#264F78",
        )
        self.editor.pack(side="left", fill="both", expand=True)

        # Minimap (Canvas)
        self.minimap = tk.Canvas(
            editor_area, width=50, bg="#1E1E1E", highlightthickness=0, borderwidth=0,
        )
        self.minimap.pack(side="right", fill="y")

        # Scrollbar (fake — just visual)
        self.scrollbar = tk.Canvas(
            editor_area, width=14, bg=C["bg"], highlightthickness=0, borderwidth=0,
        )
        self.scrollbar.pack(side="right", fill="y")

    def _build_terminal(self, parent):
        # Terminal border
        tk.Frame(parent, bg=C["border"], height=1).pack(fill="x", side="bottom")

        term_outer = tk.Frame(parent, bg=C["bg"], height=180)
        term_outer.pack(fill="x", side="bottom")
        term_outer.pack_propagate(False)

        # Terminal tabs
        term_tabs = tk.Frame(term_outer, bg=C["border"], height=28)
        term_tabs.pack(fill="x")
        term_tabs.pack_propagate(False)
        for name, active in [("PROBLEMS", False), ("OUTPUT", False),
                              ("DEBUG CONSOLE", False), ("TERMINAL", True)]:
            fg = "white" if active else C["dim"]
            lbl = tk.Label(term_tabs, text=name, font=(UI, 9), bg=C["border"], fg=fg, padx=10)
            lbl.pack(side="left")
            if active:
                # Underline for active tab
                ul = tk.Frame(term_tabs, bg="white", height=1)
                ul.place(x=lbl.winfo_x(), rely=1.0, relwidth=0, anchor="sw")

        # Terminal text area
        self.terminal = tk.Text(
            term_outer, bg=C["bg"], fg=C["text"], font=(MONO, 12),
            borderwidth=0, highlightthickness=0, padx=12, pady=6,
            wrap="word", cursor="xterm",
        )
        self.terminal.pack(fill="both", expand=True)

    # ── Tag setup ─────────────────────────────────────────────────────────────
    def _init_editor_tags(self):
        tags = {
            "keyword":   C["keyword"],
            "string":    C["string"],
            "comment":   C["comment"],
            "function":  C["function"],
            "number":    C["number"],
            "type":      C["type"],
            "variable":  C["variable"],
            "decorator": C["decorator"],
            "operator":  C["operator"],
            "text":      C["text"],
        }
        for tag, fg in tags.items():
            self.editor.tag_configure(tag, foreground=fg)

    def _init_terminal_tags(self):
        self.terminal.tag_configure("text",   foreground=C["text"])
        self.terminal.tag_configure("dim",    foreground=C["dim"])
        self.terminal.tag_configure("green",  foreground=C["green"])
        self.terminal.tag_configure("yellow", foreground=C["yellow"])
        self.terminal.tag_configure("red",    foreground=C["red"])

    # ── Animations ────────────────────────────────────────────────────────────
    def _start_animations(self):
        self._tokens = tokenize(CODE.lstrip('\n'))
        self._tok_idx = 0
        self._line = 1
        self._col = 1
        self._term_idx = 0

        # Set initial line number
        self._update_line_numbers()

        # Start typing after brief pause
        self.root.after(1500, self._type_next)
        # Start terminal after some typing has happened
        self.root.after(8000, self._term_next)
        # Keep focus
        self._grab_focus()

    def _type_next(self):
        if self._tok_idx >= len(self._tokens):
            return  # Done typing, cursor just blinks

        char, tag = self._tokens[self._tok_idx]
        self.editor.insert("end", char, tag)
        self._tok_idx += 1

        if char == '\n':
            self._line += 1
            self._col = 1
            self._update_line_numbers()
            self._update_minimap()
        else:
            self._col += 1

        self.pos_label.configure(text=f"Ln {self._line}, Col {self._col}")
        self.editor.see("end")

        # Realistic typing delays
        if char == '\n':
            # Pause between lines — occasional "thinking" pauses
            delay = random.choice([80, 100, 120, 150, 200, 300, 500, 800])
        elif char == ' ':
            delay = random.randint(15, 40)
        elif char in ('(', ')', '{', '}', '[', ']', ':', ',', '.'):
            delay = random.randint(25, 60)
        else:
            delay = random.randint(25, 75)

        self.root.after(delay, self._type_next)

    def _term_next(self):
        if self._term_idx >= len(TERM_LINES):
            return

        line = TERM_LINES[self._term_idx]
        self._term_idx += 1

        if not line:
            self.terminal.insert("end", "\n")
        else:
            for text, tag in line:
                self.terminal.insert("end", text, tag)
            self.terminal.insert("end", "\n")

        self.terminal.see("end")

        # Delay between terminal lines
        if self._term_idx < len(TERM_LINES):
            is_test = any("PASSED" in t for t, _ in (TERM_LINES[self._term_idx] or [("", "")]))
            delay = random.randint(150, 400) if is_test else random.randint(300, 800)
            self.root.after(delay, self._term_next)

    def _update_line_numbers(self):
        self.line_nums.configure(state="normal")
        self.line_nums.delete("1.0", "end")
        for i in range(1, self._line + 1):
            self.line_nums.insert("end", f"{i:>4}\n")
        self.line_nums.configure(state="disabled")

    def _update_minimap(self):
        """Draw tiny colored blocks on the minimap to simulate code overview."""
        y = self._line * 2
        if y > 400:
            return
        # Draw a small line on the minimap
        colors = [C["keyword"], C["string"], C["text"], C["comment"], C["function"]]
        w = random.randint(8, 35)
        col = random.choice(colors)
        self.minimap.create_rectangle(4, y, 4 + w, y + 1, fill=col, outline="")

    def _grab_focus(self):
        try:
            self.root.lift()
            self.root.focus_force()
        except tk.TclError:
            return
        self.root.after(2000, self._grab_focus)

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    FakeVSCode().run()
