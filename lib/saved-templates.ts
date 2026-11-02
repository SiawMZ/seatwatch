// A convenience list of this browser's templates. The edit link remains the real key.
const KEY = "seatwatch.templates";

export type SavedTemplate = { token: string; name: string };

export function savedTemplates(): SavedTemplate[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function rememberTemplate(token: string, name: string) {
  try {
    const others = savedTemplates().filter((t) => t.token !== token);
    localStorage.setItem(KEY, JSON.stringify([{ token, name }, ...others].slice(0, 20)));
  } catch {
    // Storage can be blocked, and the app works without this list.
  }
}
