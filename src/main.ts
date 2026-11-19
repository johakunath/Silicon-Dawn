import './style.css';
import { Game } from './game/game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.tabIndex = 0;
const ui = document.getElementById('ui') as HTMLElement;
const game = new Game(canvas, ui);
game.start();
