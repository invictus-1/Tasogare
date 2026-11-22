// When Claude's server-side fallback answers in place of the model that was asked for. A model's
// safety classifiers can decline a message; with fallbacks on (Tasogare turns them on for the
// models that take them), the API then runs the same request on another model in the same call,
// and that model's reply comes back. The reply says so in a `fallback` block (who declined, who
// carried on, and the category that was flagged) and in its usage's iterations; a later message in
// the same chat can then go straight to the fallback model for about an hour (sticky routing),
// which shows only in the iterations.

/** A reply that came from another model than the one asked for, and why. */
export interface ModelFallback {
  /** The model that was asked for. */
  from: string
  /** The model that answered. */
  to: string
  /** What the asked-for model's check flagged (cyber, bio, ...), or null when it named nothing. */
  category: string | null
  /** Nothing in this message was declined: the chat went straight to the fallback, as an earlier message in it was. */
  sticky?: boolean
  /** Another model answered and the provider said nothing about why. */
  unexplained?: boolean
}

/** A `fallback` block as the API sends it. */
export interface FallbackBlock {
  type: string
  from?: { model?: string }
  to?: { model?: string }
  trigger?: { type?: string; category?: string | null }
}

/** One attempt in a response's `usage.iterations`. */
export interface UsageIteration {
  type?: string
  model?: string
}

/** Model ids compared without a dated snapshot suffix. */
const sameModel = (a: string, b: string): boolean => a.replace(/-\d{8}$/, '') === b.replace(/-\d{8}$/, '')

/**
 * What one response says about who answered it. `blocks` is its content, `iterations` its
 * usage's attempts, `served` its top-level model. Undefined when the model asked for answered.
 */
export function fallbackOf(requested: string, served: string, blocks: readonly FallbackBlock[], iterations: readonly UsageIteration[] | null | undefined): ModelFallback | undefined {
  const hops = blocks.filter((b) => b.type === 'fallback')
  const first = hops[0]
  const last = hops.at(-1)
  if (first && last) return { from: first.from?.model ?? requested, to: last.to?.model ?? served, category: first.trigger?.category ?? null }
  const tries = iterations ?? []
  if (tries.some((t) => t.type === 'fallback_message')) {
    // No block: no model declined this time. With no attempt by the model asked for, the chat was
    // routed straight to the fallback.
    const asked = tries.some((t) => t.type === 'message' && !!t.model && sameModel(t.model, requested))
    return { from: requested, to: served, category: null, ...(asked ? {} : { sticky: true }) }
  }
  if (served && requested && !sameModel(served, requested)) return { from: requested, to: served, category: null, unexplained: true }
  return undefined
}

/** What a refusal category means, in a sentence, for a writer. */
export const CATEGORY_TEXT: Record<string, string> = {
  cyber: 'Its safety check read it as possible cyber harm, such as malware or an exploit. Ordinary security work, and fiction about it, can trip this too.',
  bio: 'Its safety check read it as possible biological harm, such as dangerous lab methods. Ordinary life-sciences work, and fiction about it, can trip this too.',
  frontier_llm: 'Its safety check read it as help building a competing AI model. Ordinary machine-learning work can trip this too.',
  reasoning_extraction:
    'Its safety check read it as asking the model to write out its hidden reasoning, such as a thinking or scratchpad section in the reply. A system prompt or earlier reply that does this can trip it.',
  general_harms: 'Its safety check flagged it under another part of the usage policy. Harmless writing can trip this too.'
}

/** Why a reply came from another model, in a sentence or two, with each model's own name. */
export function fallbackText(f: ModelFallback, name: (id: string) => string): string {
  const from = name(f.from)
  const to = name(f.to)
  if (f.unexplained) return `${to} answered instead of ${from}, and Anthropic didn't say why.`
  if (f.sticky)
    return `${from} declined an earlier message in this chat, so Anthropic sends the chat straight to ${to} for about an hour. Nothing in this message was flagged.`
  const why = f.category ? (CATEGORY_TEXT[f.category] ?? `Its safety check flagged it as "${f.category}".`) : 'Anthropic didn\'t name a reason.'
  return `${from} declined this message, so Anthropic's fallback, ${to}, answered it. ${why} Later messages in this chat may go straight to ${to} for about an hour.`
}

/** A refusal's reason as the reply's error, from its stop details. */
export function refusalText(details: { category?: string | null; explanation?: string | null } | null | undefined): string {
  const category = details?.category ?? null
  const why = category ? (CATEGORY_TEXT[category] ?? `It was flagged as "${category}".`) : details?.explanation ? details.explanation : ''
  return `The model declined this request.${why ? ` ${why}` : ''}`
}
