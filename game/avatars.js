// Players' avatar heads: asked for once per player, loaded into an Image, and drawn once they've arrived (until then the
// character has a default face). `get` never throws and never blocks.

export function createAvatars(ow) {
  const cache = new Map();

  function load(id, entry) {
    try {
      Promise.resolve(ow.player.avatarUrl(id, 'head'))
        .then((url) => {
          if (!url || typeof url !== 'string') return;
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            entry.img = img;
          };
          img.src = url;
        })
        .catch(() => {});
    } catch {
      // no avatar: the default face stays
    }
  }

  return {
    /** The loaded head for a player id, or null. */
    get(id) {
      if (typeof id !== 'string' || id.length === 0) return null;
      let entry = cache.get(id);
      if (!entry) {
        entry = { img: null };
        cache.set(id, entry);
        load(id, entry);
      }
      return entry.img;
    },
  };
}
