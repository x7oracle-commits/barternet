export function genId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function shortId(id) {
  return id ? id.slice(0, 8).toUpperCase() : "??????";
}
