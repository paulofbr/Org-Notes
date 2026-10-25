// Paths in links are relative to the file that contains them, as in Emacs; the server's paths are relative to the root.

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1)

/** The root-relative path that `rel`, written in file `from`, points to. */
export function resolvePath(from: string, rel: string) {
  const out: string[] = []
  for (const part of (dirOf(from) + rel).split('/')) {
    if (part === '..') out.pop()
    else if (part && part !== '.') out.push(part)
  }
  return out.join('/')
}

/** The path to write in file `from` to point at the root-relative path `to`. */
export function relativePath(from: string, to: string) {
  const fromDirs = dirOf(from).split('/').filter(Boolean)
  const toParts = to.split('/')
  let common = 0
  while (common < fromDirs.length && common < toParts.length - 1 && fromDirs[common] === toParts[common]) common++
  return [...Array(fromDirs.length - common).fill('..'), ...toParts.slice(common)].join('/')
}

/** An org link; brackets in the description would end the link early, so they become parentheses. */
export function orgLink(target: string, description?: string) {
  const desc = description?.trim().replace(/\[/g, '(').replace(/\]/g, ')')
  return desc && desc !== target ? `[[${target}][${desc}]]` : `[[${target}]]`
}

/** Where to load a local image linked from file `from` (e.g. `[[file:.images/x.png]]`). */
export function imageSrc(from: string, target: string) {
  return '/api/raw/' + resolvePath(from, target.replace(/^file:/, '')).split('/').map(encodeURIComponent).join('/')
}
