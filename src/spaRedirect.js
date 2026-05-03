// GitHub Pages SPA redirect handler. Restores routes encoded by public/404.html.
const { location, history } = window;

if (location.search[1] === '/') {
  const decoded = location.search
    .slice(1)
    .split('&')
    .map((part) => part.replace(/~and~/g, '&'))
    .join('?');

  history.replaceState(
    null,
    null,
    location.pathname.slice(0, -1) + decoded + location.hash
  );
}
