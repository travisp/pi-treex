const THEME_KEY = Symbol.for("@mariozechner/pi-coding-agent:theme");

export const theme = new Proxy(
  {},
  {
    get(_target, prop) {
      const currentTheme = globalThis[THEME_KEY];
      if (!currentTheme) {
        throw new Error("Theme not initialized. Call initTheme() first.");
      }
      return currentTheme[prop];
    },
  },
);
