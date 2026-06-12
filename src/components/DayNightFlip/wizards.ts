// "When it goes sideways" decision trees (ruleset R-13/15/16/17/18/20/21/30/31).
// Data only — WizardPanel.tsx walks these. Strings double as en.json keys.

export type WizardId = 'rescue' | 'pacifier' | 'gas' | 'bottle';

export type WizardNode =
  | { kind: 'question'; prompt: string; help?: string;
      options: { label: string; to: string }[] }   // to: node key or '@wizardId'
  | { kind: 'outcome'; title: string; actions: string[]; why: string;
      ruleIds: string[]; dynamic?: 'rescue-timing';
      links?: { label: string; to: string }[] };

export type Wizard = {
  id: WizardId; title: string; entry: string;
  nodes: Record<string, WizardNode>;
};

export const FLIP_WIZARDS: Record<WizardId, Wizard> = {
  rescue: {
    id: 'rescue',
    title: 'Putdown isn’t working',
    entry: 'duration',
    nodes: {
      duration: {
        kind: 'question',
        prompt: 'How long has this putdown attempt been going?',
        options: [
          { label: 'Under 10 minutes — she’s fussing in the crib', to: 'fussType' },
          { label: '20+ minutes, or this is the second failed attempt', to: 'gasCheck' },
          { label: 'She’s been awake past the 75-minute ceiling', to: 'gasCheck' },
        ],
      },
      fussType: {
        kind: 'question',
        prompt: 'What does the fussing look like?',
        help: 'Newborn active sleep looks alarmingly like waking.',
        options: [
          { label: 'Grunting, squirming, intermittent — eyes closed or half-closed', to: 'wait' },
          { label: 'Sustained, escalating, genuine crying', to: 'gasCheck' },
        ],
      },
      wait: {
        kind: 'outcome',
        title: 'Wait 5–10 minutes — this is often active sleep',
        actions: [
          'Stay out of the room; watch, don’t touch',
          'Set a 10-minute timer before you intervene',
          'If it escalates into real crying, come back here',
        ],
        why: 'Intervening interrupts a baby who is mid-descent into sleep. And you cannot spoil a baby this young — if it becomes real crying, helping costs nothing.',
        ruleIds: ['R-13'],
        links: [{ label: 'It became real crying', to: 'gasCheck' }],
      },
      gasCheck: {
        kind: 'question',
        prompt: 'Any gas signs? Arching her back, farting, calm upright on your chest but raging when laid flat?',
        options: [
          { label: 'Yes — that sounds like her right now', to: '@gas' },
          { label: 'No gas signs', to: 'pacifierCheck' },
        ],
      },
      pacifierCheck: {
        kind: 'question',
        prompt: 'Is the pacifier looping? In → spit out → cry → replace → repeat?',
        options: [
          { label: 'Yes, that exact loop', to: '@pacifier' },
          { label: 'No pacifier involved', to: 'rescueNow' },
        ],
      },
      rescueNow: {
        kind: 'outcome',
        title: 'Rescue this nap — abandon the crib for this cycle',
        actions: [
          'Fastest means wins: contact nap, motion (carrier, stroller), rocking, or feeding down',
          'White noise and contact napping are legal rescue tools for one nap',
          'Don’t let the rescue become the default — the daytime feeds and the nap cap are what matter',
        ],
        why: 'An overtired baby sleeps worse at night, so a rescued nap beats ideological purity. One held nap doesn’t break the protocol.',
        ruleIds: ['R-15', 'R-16'],
        dynamic: 'rescue-timing',
      },
    },
  },
  pacifier: {
    id: 'pacifier',
    title: 'Pacifier keeps failing',
    entry: 'confirm',
    nodes: {
      confirm: {
        kind: 'question',
        prompt: 'What’s the pattern?',
        options: [
          { label: 'In → spit out → cry → replace → repeat', to: 'dropIt' },
          { label: 'She takes it and settles', to: 'keepIt' },
        ],
      },
      dropIt: {
        kind: 'outcome',
        title: 'Abandon the pacifier for this settling attempt',
        actions: [
          'Switch to motion or contact — they demand nothing from her',
          'Try the pacifier again another time, when she’s less tired',
        ],
        why: 'A pacifier requires active sucking to retain; an overtired baby can’t sustain it, so it becomes a wake-up loop rather than a soother.',
        ruleIds: ['R-17'],
        links: [{ label: 'Back to the rescue flow', to: '@rescue' }],
      },
      keepIt: {
        kind: 'outcome',
        title: 'The pacifier is doing its job',
        actions: [
          'Carry on — it’s a soothing tool',
          'Never use it to stall a hungry baby; a pacifier stall produces a worked-up baby who then feeds poorly',
        ],
        why: 'The pacifier only fails when the baby is too tired to suck. Settled means it’s working.',
        ruleIds: ['R-17', 'R-10'],
      },
    },
  },
  gas: {
    id: 'gas',
    title: 'Gas check',
    entry: 'signs',
    nodes: {
      signs: {
        kind: 'question',
        prompt: 'Which of these fits?',
        options: [
          { label: 'Sleepy but screams when laid flat; calm upright on a chest', to: 'protocol' },
          { label: 'Arching, farting, nap resistance running past 30–45 minutes', to: 'protocol' },
          { label: 'None of these, actually', to: 'noGas' },
        ],
      },
      protocol: {
        kind: 'outcome',
        title: 'Run the gas protocol',
        actions: [
          'Bicycle her legs, then clockwise tummy massage',
          'Belly-down across your forearm during awake time',
          'Make mid-feed burps mandatory for the next several feeds — a burp captured mid-feed is a fart she doesn’t fight at naptime',
        ],
        why: 'Lying flat worsens trapped-gas discomfort — which is why chest = calm, crib = rage. Fast, frantic bottle feeds are the #1 source of swallowed air.',
        ruleIds: ['R-18'],
        links: [{ label: 'Bottle feeds emptying too fast?', to: '@bottle' }],
      },
      noGas: {
        kind: 'outcome',
        title: 'Probably not gas',
        actions: ['Go back to settling — classify the fussing and rescue if needed'],
        why: 'Without the upright-vs-flat pattern or visible signs, gas is unlikely to be the blocker.',
        ruleIds: ['R-18'],
        links: [{ label: 'Back to the rescue flow', to: '@rescue' }],
      },
    },
  },
  bottle: {
    id: 'bottle',
    title: 'Finished the bottle, still hungry?',
    entry: 'cues',
    nodes: {
      cues: {
        kind: 'question',
        prompt: 'The bottle’s empty and she still seems hungry. What is she doing?',
        options: [
          { label: 'Rooting, lip-smacking, agitated — and gulps eagerly if offered more', to: 'realHunger' },
          { label: 'Turns away, comfort-sucks without swallowing, settles when held', to: 'comfort' },
        ],
      },
      realHunger: {
        kind: 'outcome',
        title: 'Real hunger — offer more',
        actions: [
          'Offer about 1 oz at a time until she settles',
          'Keep it paced: slow-flow nipple, bottle horizontal, pause every ounce, 15–20 minute feeds',
          'Burp mid-feed',
          'Draining bottles feed after feed for days → pediatrician conversation (usually “size up”); the growth curve confirms it',
        ],
        why: 'Babies don’t read charts — catch-up gainers routinely exceed rule-of-thumb math. Daily total beats per-feed numbers.',
        ruleIds: ['R-31', 'R-30'],
      },
      comfort: {
        kind: 'outcome',
        title: 'Non-nutritive sucking — don’t add milk',
        actions: [
          'She wants sucking, not calories — a pacifier or pinky is fine here (she isn’t hungry)',
          'Overfilling causes spit-up and gas',
          'Next feed: slow-flow + paced, so fullness registers before the bottle empties',
        ],
        why: 'The suck reflex outlasts hunger, and “still hungry” is sometimes a gas bubble taking up room.',
        ruleIds: ['R-31'],
        links: [{ label: 'Gas protocol', to: '@gas' }],
      },
    },
  },
};
