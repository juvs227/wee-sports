const KEY = 'wee:home-view:v1';
let remembered = 'classic';
export const validHomeView = value => value === 'classic' || value === 'island' ? value : null;
export function readHomeView() {
  try {remembered = validHomeView(window.localStorage.getItem(KEY)) ?? remembered;} catch { /* Private browsing still supports switching. */ }
  return remembered;
}
export function saveHomeView(view) {
  if (!validHomeView(view)) return;
  remembered = view;
  try {window.localStorage.setItem(KEY, view);} catch { /* Keep this tab's choice. */ }
}
