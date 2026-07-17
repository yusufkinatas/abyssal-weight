import { AbyssalWeightGame } from "./src/game.js?v=20260717-3";

window.addEventListener("DOMContentLoaded", async () => {
  const game = new AbyssalWeightGame();
  window.__ABYSSAL_GAME__ = game;
  await game.init();
});
