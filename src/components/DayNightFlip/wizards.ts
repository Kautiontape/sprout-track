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
        title: 'Rescue this nap: give up on the crib for now',
        actions: [
          'Use whatever works fastest: a contact nap, motion (carrier or stroller), rocking, or feeding her down',
          'White noise and contact napping are fair game for one rescued nap',
          'Just don’t let the rescue become the habit. The daytime feeds and the nap cap matter more than where she sleeps.',
        ],
        why: 'An overtired baby sleeps worse at night, so a rescued nap beats doing it by the book. One held nap doesn’t break the protocol.',
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
        title: 'Put the pacifier away for this attempt',
        actions: [
          'Switch to motion or holding her. Neither asks anything of her.',
          'Try the pacifier again another time, when she’s less tired',
        ],
        why: 'Keeping a pacifier in takes active sucking, and an overtired baby can’t keep it up. It turns into a wake-up loop instead of a soother.',
        ruleIds: ['R-17'],
        links: [{ label: 'Back to the rescue guide', to: '@rescue' }],
      },
      keepIt: {
        kind: 'outcome',
        title: 'The pacifier is doing its job',
        actions: [
          'Carry on',
          'One warning: never use it to stall a hungry baby. She’ll work herself up and then feed poorly.',
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
        title: 'Work the gas out',
        actions: [
          'Bicycle her legs, then massage her tummy clockwise',
          'Carry her belly-down across your forearm during awake time',
          'Burp her mid-feed for the next several feeds. Gas you catch during the feed is gas she won’t fight at naptime.',
        ],
        why: 'Lying flat makes trapped gas hurt more, which is why she’s calm on your chest and furious in the crib. Fast, frantic bottle feeds are the biggest source of swallowed air.',
        ruleIds: ['R-18'],
        links: [{ label: 'Bottle feeds emptying too fast?', to: '@bottle' }],
      },
      noGas: {
        kind: 'outcome',
        title: 'Probably not gas',
        actions: ['Head back to settling her, and rescue the nap if it keeps failing'],
        why: 'Without the upright-versus-flat pattern or visible signs, gas probably isn’t what’s in the way.',
        ruleIds: ['R-18'],
        links: [{ label: 'Back to the rescue guide', to: '@rescue' }],
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
        title: 'She’s actually hungry. Offer more.',
        actions: [
          'Offer about an ounce at a time until she settles',
          'Keep the pace slow: slow-flow nipple, bottle held flat, a pause every ounce, 15–20 minutes per feed',
          'Burp her partway through',
          'If she drains every bottle for days in a row, bring it up with your pediatrician. The usual answer is to size up.',
        ],
        why: 'Babies don’t read the charts. Catch-up gainers routinely out-eat the rule-of-thumb math, and the daily total matters more than any single feed.',
        ruleIds: ['R-31', 'R-30'],
      },
      comfort: {
        kind: 'outcome',
        title: 'She wants to suck, not eat. Don’t add milk.',
        actions: [
          'A pacifier or a pinky finger is fine here, since she isn’t hungry',
          'Overfilling her causes spit-up and gas',
          'Next feed, go slow-flow and paced so fullness has time to register',
        ],
        why: 'The suck reflex outlasts hunger, and “still hungry” is sometimes a gas bubble taking up room.',
        ruleIds: ['R-31'],
        links: [{ label: 'Work the gas out', to: '@gas' }],
      },
    },
  },
};
