import '@fontsource/bungee/latin-400.css';
import '@fontsource/rubik/latin-400.css';
import '@fontsource/rubik/latin-700.css';
import './ui/style.css';

const params = new URLSearchParams(location.search);

async function boot() {
  if (params.has('poster')) {
    const { renderPoster } = await import('./poster.js');
    await renderPoster(params.get('poster'));
    return;
  }
  const { startApp } = await import('./app/app.js');
  await startApp(params);
}

boot().catch((err) => {
  console.error(err);
});
