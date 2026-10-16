"""PTY layout regression checks. Run with Python 3 and pyte installed, after npm ci."""
import os, pty, subprocess, fcntl, termios, struct, time, select, codecs, tempfile
from pathlib import Path
import pyte

root = Path(__file__).resolve().parents[2]
bundle_dir = tempfile.TemporaryDirectory(prefix="rote-tui-check-")
bundle = Path(bundle_dir.name) / "tui.mjs"
subprocess.run([str(root / "node_modules/.bin/esbuild"), "packages/cli/src/tui.ts", "--bundle", "--platform=node", "--format=esm", "--outfile=" + str(bundle)], cwd=root, check=True)
master, slave = pty.openpty()
screen = None
stream = None
decoder = codecs.getincrementaldecoder('utf-8')()
def resize(cols, rows):
    global screen, stream
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    screen = pyte.Screen(cols, rows)
    stream = pyte.Stream(screen)

def drain():
    until = time.time() + .5
    while time.time() < until:
        if select.select([master], [], [], .05)[0]:
            stream.feed(decoder.decode(os.read(master, 65536)))

def send(text):
    os.write(master, text.encode())
    drain()

resize(100, 32)
code = 'import {startTui} from "/tmp/rote-tui-qa-bundle.mjs"; await startTui(async a => {if(a[1]==="fail") throw new Error("verification failed"); await new Promise(r=>setTimeout(r,600)); return "success: verified\\nsteps: 1\\ntokens: 12 input + 2 output\\n"+"Long summary ".repeat(80);});'
code = code.replace("/tmp/rote-tui-qa-bundle.mjs", str(bundle))
proc = subprocess.Popen(["node", "--input-type=module", "-e", code], cwd=root, stdin=slave, stdout=slave, stderr=slave)
drain()
for cols, rows in [(120,40),(80,24),(40,16),(32,16),(28,10),(100,32)]:
    resize(cols,rows)
    os.kill(proc.pid, 28)
    drain()
    if cols < 32:
        assert "Resize terminal" in screen.display[0]
    else:
        assert "rote" in screen.display[1]
        assert "─" in screen.display[rows-7]
        assert "›" in screen.display[rows-5]
        assert "─" in screen.display[rows-3]
        assert "Enter send" in screen.display[-1]
        assert screen.cursor.y == rows-5
    print("layout", cols, rows, "PASS")
send("界"*50)
drain()
assert screen.cursor.y == 27 and screen.cursor.x < 94
assert "─" in screen.display[29]
send("\x15")
send("x"*230)
assert "›" in screen.display[27] and screen.cursor.y == 27
send("\x15/help\r")
assert "commands" in "\n".join(screen.display)
send("/steps 2abc\r")
assert "positive whole number" in "\n".join(screen.display), '\n'.join(screen.display)
send("/url bad\r")
assert "complete URL" in "\n".join(screen.display)
send("/demo\r")
send("Confirm the page is ready\r")
drain()
assert "rote · verified" in "\n".join(screen.display)
send("fail\r")
assert "rote · failed" in "\n".join(screen.display)
send("\x1b[5~")
send("\x1b[6~")
send("/quit\r")
proc.wait(timeout=3)
assert proc.returncode == 0
assert not termios.tcgetattr(slave)[3] & termios.ICANON == 0
print("input, scrolling, validation, verified/failed output, exit restoration PASS")

os.close(master)
os.close(slave)
bundle_dir.cleanup()

