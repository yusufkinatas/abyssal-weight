import { AbyssalWeightGame } from "./src/game.js?v=20260718-2";

window.addEventListener("DOMContentLoaded", async () => {
  const game = new AbyssalWeightGame();
  window.__ABYSSAL_GAME__ = game;
  await game.init();
});
