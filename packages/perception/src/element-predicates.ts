import type { CapturedElement } from '@rote/browser';

/**
 * The two predicates every layer must agree on: whether a captured element is
 * visible, and whether a selector names it.
 *
 * They were implemented three and two times respectively — in the observation
 * distiller, the browser tool caller, and the browser Expect evaluator — and
 * had drifted, always in the same direction: the copy furthest from dispatch
 * was the most permissive. An element the dispatcher refuses to click because
 * it reads as invisible could still satisfy a `text_visible` verification, and
 * verification is what decides whether a run succeeded (CLAUDE.md sacred
 * invariant 1). One rule, in the package that owns observation.
 */

/**
 * Whether a captured element is visible to a user.
 *
 * Deliberately conservative in both directions: it must not hide a control the
 * agent could really click (that would strand a run), and it must not show one
 * the page does not display (that would let hidden text certify a task).
 */
export function isElementVisible(element: CapturedElement): boolean {
  // The fixtures' explicit escape hatch, honoured before anything inferred.
  if (element.attributes['data-rote-visible'] === 'false') return false;
  if ('hidden' in element.attributes || element.attributes['aria-hidden'] === 'true') return false;
  if (element.tag === 'input' && element.attributes['type'] === 'hidden') return false;
  const style = normalizedStyle(element);
  if (style.includes('display:none') || style.includes('visibility:hidden')) return false;
  // Opacity must be parsed, not substring-matched: "opacity:0.5" contains
  // "opacity:0", so a merely translucent control (mid-fade, cosmetic restyle)
  // would silently vanish from the observation and surface as a spurious
  // removal in the diff.
  const opacity = /(?:^|;)opacity:([^;]+)/.exec(style);
  return opacity === null || Number.parseFloat(opacity[1]!) !== 0;
}

/**
 * Whether a captured element matches a selector from the supported subset:
 * `#id`, `.class`, `tag`, and `tag[attr="value"]` (tag optional).
 *
 * Not a CSS engine — the subset is what playbooks and the Expect DSL may use,
 * and anything outside it must fail to match rather than match approximately.
 * `data-rote-selector` is honoured first so a fixture can name an element
 * unambiguously.
 */
export function matchesElementSelector(element: CapturedElement, selector: string): boolean {
  if (element.attributes['data-rote-selector'] === selector) return true;
  if (selector.startsWith('#')) return element.attributes['id'] === selector.slice(1);
  if (selector.startsWith('.')) return (element.attributes['class'] ?? '').split(/\s+/).includes(selector.slice(1));
  const attribute = /^(?:([a-zA-Z][\w-]*))?\[([\w-]+)=["']([^"']+)["']\]$/.exec(selector);
  if (attribute) {
    const [, tag, name, value] = attribute;
    return (!tag || element.tag === tag.toLowerCase()) && element.attributes[name!] === value;
  }
  return element.tag === selector.toLowerCase();
}

function normalizedStyle(element: CapturedElement): string {
  return element.attributes['style']?.replaceAll(' ', '').toLowerCase() ?? '';
}
