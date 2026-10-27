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

/**
 * What pasting `pasted` over `selected` (at text `before` the cursor) should insert: a web address becomes an org link,
 * described by the selected text if any; undefined to paste it as it is (not an address, or inside a link already).
 */
export function pastedLink(pasted: string, selected: string, before: string): string | undefined {
  const url = pasted.trim()
  if (!/^https?:\/\/\S+$/i.test(url) || /\[\[[^\]]*$/.test(before)) return undefined
  return orgLink(url, selected.trim() || undefined)
}

/** Where to load a local image or attached file linked from file `from` (e.g. `[[file:.images/x.png]]`). */
export function imageSrc(from: string, target: string) {
  return '/api/raw/' + resolvePath(from, target.replace(/^file:/, '')).split('/').map(encodeURIComponent).join('/')
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i

/**
 * Whether a link points at a file attached to a note (`[[file:plano_Artifacts/orçamento.pdf][orçamento.pdf]]`): in the
 * note's artifacts folder (or an older `_attachments` / `_images` one), and not an image shown in the text (those have no description).
 */
export const isAttachment = (target: string, desc?: string) =>
  /^(file:)?[^:]*_(Artifacts|attachments|images)\/[^/]+$/.test(target) && (!!desc || !IMAGE_EXT.test(target))

/** The links to the attachments in a text, as [target, name]. */
export const attachmentsIn = (text: string) =>
  [...text.matchAll(/\[\[([^\]]+)\](?:\[([^\]]*)\])?\]/g)].filter((m) => isAttachment(m[1], m[2])).map((m) => [m[1], m[2] ?? m[1].split('/').pop()!] as const)
