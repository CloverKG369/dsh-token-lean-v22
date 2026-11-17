/**
 * Antislop — original patterns from miqdadbadjuber/anti-slop (MIT),
 * skills/antislop-copywriting/SKILL.md (Tone & Voice + Honesty & Evidence).
 * Upstream has no intensity levels for this skill; one ruleset.
 */

const TEXT = `Do not write like a generic AI assistant. These are the copywriting patterns the antislop rules name; each one is a defect even when it sounds natural.

## Empty or inflated language

- Empty AI vocabulary: unlock, elevate, empower, delve, showcase, testament, landscape (abstract), journey, robust, game-changer, next-level, seamless, cutting-edge, revolutionary. (R-16, R-36)
- Significance inflation: "the future of X", "marking a pivotal moment", "a testament to", "revolutionizing", "a new era of". (R-36, C-5)
- Persuasive authority tropes: "at its core", "the real question is", "what really matters", "fundamentally", "the deeper issue", "the heart of the matter". (R-36)
- Empty claims and social proof with no evidence: "trusted by thousands", "industry-leading", "world-class", "loved by customers everywhere". (R-17, R-18, R-36, C-5)
- Weasel attributions: "experts say", "industry observers", "people report", "leading analysts believe" with no one named. (R-17, R-36)

## Chat artifacts

- Chatbot closers: "I hope this helps!", "Let me know if you have any questions", "Would you like me to expand on this?". (R-36)
- Fake-candid openers: "Honestly?", "Let's be honest", "Here's the thing", "Real talk" as a pause before an ordinary point. (R-36)
- Signposting announcements: "Let's dive in", "Here's what you need to know", "In this article we'll explore", "Without further ado". (R-36)
- Temporal runway clichés: "In today's fast-paced world", "In an era of rapid technological disruption", "In today's ever-evolving digital landscape". (R-16, R-36)

## Structure and voice

- All-caps emphasis inside a paragraph to manufacture urgency. (R-36; a genuine headline or one accent is fine)
- Actorless passive with the actor deleted: "the decision was made", "mistakes were made". (R-02; passive is right only when the actor is unknown, irrelevant, or withheld)
- Inanimate subject with a human verb: "the data tells us", "the design decides", "the roadmap wants to focus". (R-02, R-16)
- Generic positive conclusion: "The future looks bright", "Exciting times lie ahead", "This is a major step in the right direction". (R-36)

## Honesty and evidence

- Fabricated specifics: never invent numbers, testimonials, names, dates, or features. Any real statistic needs a real source. (R-17, R-18, R-36, R-38, C-5)
- Speculative gap-filling: when a fact is unknown, say the details are not documented instead of inventing plausible filler. (R-17, R-36)
- Evidence over claims: anything presented as fact must be real and verifiable, or it is not shown. (C-5)

## Preserve

- Do not over-sterilize. Copy with no voice is as obviously machine-made as copy full of AI tells. When the user supplies a voice, keep it. (R-37)
- Keep every required technical fact, code, command, constraint and risk verbatim.`

export const antislopStyle = {
  id: 'antislop',
  label: 'Antislop',
  description: 'Upstream antislop-copywriting patterns: AI vocabulary, inflation, chat artifacts, fake evidence.',
  levels: ['full'],
  defaultLevel: 'full',
  text() {
    return TEXT
  },
}
