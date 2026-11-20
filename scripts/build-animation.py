"""Build the private animation runtime before packaging Studio for Windows."""
import os
from pathlib import Path
import subprocess
import venv

root = Path(__file__).resolve().parent.parent
os.chdir(root)
build = root / 'build'
env = build / 'animation-venv'
python = env / 'Scripts' / 'python.exe'
if not python.is_file():
    venv.create(env, with_pip=True)
subprocess.run([python, '-m', 'pip', 'install', '-r', 'animation/requirements.txt', 'pyinstaller>=6,<7'], check=True)
subprocess.run([python, '-m', 'PyInstaller', '--noconfirm', '--onedir', '--name', 'records-animation',
                '--distpath', 'build/animation', '--workpath', 'build/freeze', '--specpath', 'build',
                'animation/worker.py'], check=True)
engine = build / 'animation' / 'records-animation' / 'records-animation.exe'
ffmpeg = subprocess.check_output(['node', '-p', "require('ffmpeg-static')"], text=True).strip()
subprocess.run([engine, 'assets/logo-11-records.png', build / 'animation-smoke.mp4',
                'lapiz', '3', ffmpeg], check=True)
# Los movimientos nuevos también deben ir dentro del motor empaquetado.
for style in ('impacto', 'profundidad', 'in'):
    subprocess.run([engine, 'assets/logo-11-records.png', build / f'animation-smoke-{style}.mp4',
                    style, '2', ffmpeg, '{"focus": [0.5, 0.5]}'], check=True)
