import './style.css';
import { Game } from './game/game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.tabIndex = 0;
const ui = document.getElementById('ui') as HTMLElement;

function fatal(title: string, detail: string) {
  ui.innerHTML = `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#05070d;color:#c9d6ee;font:18px Inter,sans-serif;text-align:center;padding:40px">
    <div style="max-width:640px"><h1 style="font:700 40px Rajdhani,sans-serif;color:#6fe9ff;margin:0 0 16px">${title}</h1><p style="line-height:1.6">${detail}</p></div></div>`;
}

function hasWebGL2(): boolean {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

if (!hasWebGL2()) {
  fatal('WebGL is not available', 'Silicon Dawn needs WebGL 2 for its 3D graphics. Turn on <b>hardware acceleration</b> in your browser settings, update your graphics driver, or try a current version of Chrome, Edge or Firefox on a desktop computer.');
} else {
  try {
    const game = new Game(canvas, ui);
    game.start();
  } catch (e) {
    console.error(e);
    fatal('Silicon Dawn could not start', `Your browser or graphics driver failed to set up the game (${String((e as Error)?.message ?? e).replace(/[<>&]/g, '')}). Updating the browser or graphics driver usually helps.`);
  }
}
