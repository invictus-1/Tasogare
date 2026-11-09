/** The text box the keyboard is in right now, if it's in one. */
const typingIn = (): HTMLElement | null => {
  const at = document.activeElement
  return at instanceof HTMLElement && (at.tagName === 'INPUT' || at.tagName === 'TEXTAREA' || at.isContentEditable) ? at : null
}

/**
 * Focus for a button that answers a question (allow this tool call, run this command), unless
 * you're typing: a Space or Enter meant for your message mustn't land on it.
 */
export const focusUnlessTyping = (el: HTMLElement | null): void => {
  if (el && !typingIn()) el.focus()
}

/**
 * Leaves the text box you're in, so a box that saves when left (a settings field, a rename) saves
 * before a shortcut takes its page away: a box that is simply removed gets no blur. The composer
 * and the manuscript keep their own drafts and are left alone. Returns the box, to go back to.
 */
export function leaveField(): HTMLElement | null {
  const at = typingIn()
  if (!at || at.isContentEditable || at.closest('.tw-composer')) return null
  at.blur()
  return at
}
