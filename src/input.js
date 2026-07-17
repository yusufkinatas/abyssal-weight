const DEFAULT_BUFFER = 0.11;

const KEY_ACTIONS = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyJ: "primary",
  KeyK: "secondary",
  Space: "dodge",
  ShiftLeft: "deflect",
  ShiftRight: "deflect",
  KeyQ: "swap",
  KeyR: "reload",
  KeyE: "interact",
  Enter: "interact",
  Escape: "pause",
  KeyP: "pause",
  KeyM: "mute",
};

const PREVENT_DEFAULT = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

export class ActionInput {
  constructor(canvas, worldWidth, worldHeight) {
    this.canvas = canvas;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.downCodes = new Set();
    this.buffers = new Map();
    this.rawPressed = new Set();
    this.releasedActions = new Set();
    this.virtualHeld = new Set();
    this.pointer = {
      x: worldWidth * 0.5,
      y: worldHeight * 0.5,
      active: false,
      left: false,
      right: false,
    };
    this.bind();
  }

  bind() {
    addEventListener("keydown", (event) => {
      const target = event.target;
      const tag = target?.tagName;
      if (["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(tag) && target !== this.canvas) return;
      if (PREVENT_DEFAULT.has(event.code)) event.preventDefault();
      if (!this.downCodes.has(event.code)) {
        this.rawPressed.add(event.code);
        const action = KEY_ACTIONS[event.code];
        if (action) this.press(action);
      }
      this.downCodes.add(event.code);
    });

    addEventListener("keyup", (event) => {
      this.downCodes.delete(event.code);
      const action = KEY_ACTIONS[event.code];
      if (action) this.releasedActions.add(action);
    });

    addEventListener("blur", () => this.resetHeld());

    const mapPointer = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this.pointer.x = (event.clientX - rect.left) * this.worldWidth / rect.width;
      this.pointer.y = (event.clientY - rect.top) * this.worldHeight / rect.height;
      this.pointer.active = true;
    };

    this.canvas.addEventListener("pointermove", mapPointer);
    this.canvas.addEventListener("pointerdown", (event) => {
      mapPointer(event);
      this.canvas.focus({ preventScroll: true });
      if (event.button === 0) {
        this.pointer.left = true;
        this.press("primary");
      } else if (event.button === 2) {
        this.pointer.right = true;
        this.press("secondary");
      }
      this.canvas.setPointerCapture?.(event.pointerId);
    });
    this.canvas.addEventListener("pointerup", (event) => {
      mapPointer(event);
      if (event.button === 0) {
        this.pointer.left = false;
        this.releasedActions.add("primary");
      } else if (event.button === 2) {
        this.pointer.right = false;
        this.releasedActions.add("secondary");
      }
    });
    this.canvas.addEventListener("pointercancel", () => {
      this.pointer.left = false;
      this.pointer.right = false;
    });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    document.querySelectorAll("[data-action]").forEach((button) => {
      const action = button.dataset.action;
      const start = (event) => {
        event.preventDefault();
        this.pointer.active = false;
        if (!this.virtualHeld.has(action)) this.press(action);
        this.virtualHeld.add(action);
        button.classList.add("is-active");
      };
      const end = (event) => {
        event.preventDefault();
        this.virtualHeld.delete(action);
        this.releasedActions.add(action);
        button.classList.remove("is-active");
      };
      button.addEventListener("pointerdown", start);
      button.addEventListener("pointerup", end);
      button.addEventListener("pointercancel", end);
      button.addEventListener("pointerleave", (event) => {
        if (event.buttons) return;
        end(event);
      });
    });
  }

  press(action, seconds = DEFAULT_BUFFER) {
    this.buffers.set(action, Math.max(this.buffers.get(action) || 0, seconds));
  }

  consume(action) {
    if ((this.buffers.get(action) || 0) <= 0) return false;
    this.buffers.delete(action);
    return true;
  }

  buffered(action) {
    return (this.buffers.get(action) || 0) > 0;
  }

  held(action) {
    if (this.virtualHeld.has(action)) return true;
    if (action === "primary" && this.pointer.left) return true;
    if (action === "secondary" && this.pointer.right) return true;
    for (const [code, mapped] of Object.entries(KEY_ACTIONS)) {
      if (mapped === action && this.downCodes.has(code)) return true;
    }
    return false;
  }

  released(action) {
    return this.releasedActions.has(action);
  }

  raw(code) {
    return this.rawPressed.has(code);
  }

  setVirtualHeld(actions) {
    this.virtualHeld.clear();
    for (const action of actions) this.virtualHeld.add(action);
  }

  setVirtualAim(x, y) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = true;
  }

  tick(dt) {
    for (const [action, remaining] of this.buffers) {
      const next = remaining - dt;
      if (next <= 0) this.buffers.delete(action);
      else this.buffers.set(action, next);
    }
  }

  endStep() {
    this.rawPressed.clear();
    this.releasedActions.clear();
  }

  resetHeld() {
    this.downCodes.clear();
    this.virtualHeld.clear();
    this.pointer.left = false;
    this.pointer.right = false;
  }
}
