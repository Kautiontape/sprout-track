# BreastMilkBagForm

Logs frozen breast milk bags into and out of the freezer. One form serves both
directions: a toggle flips the sign of `bagCount` on submit.

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `isOpen` | `boolean` | Yes | Whether the form page is open |
| `onClose` | `() => void` | Yes | Called when the form is dismissed |
| `babyId` | `string \| undefined` | Yes | Baby the entry belongs to |
| `initialTime` | `string` | Yes | ISO time to prefill for new entries |
| `activity` | `BreastMilkBagLogResponse` | No | Present when editing an existing entry |
| `onSuccess` | `() => void` | No | Called after a successful save |

## Implementation notes

- **Sign lives in `bagCount`, not in a separate column.** The UI shows a positive
  count with a Froze/Used toggle; `handleSubmit` negates on removal. Editing reads
  the sign back off `activity.bagCount`.
- **The per-bag amount is remembered, not stored.** On open (for new entries only)
  the form fetches `/api/breast-milk-bag-balance` and prefills `lastAmountPerBag`,
  the most recent *freeze* amount. Nothing is persisted in settings, so editing or
  deleting a log corrects the default automatically.
- **Removal reasons only appear on removals.** Switching direction clears the
  reason, so a "Discarded" reason can't survive a flip back to Froze.
- Dark mode lives in `breast-milk-bag-form.css` using `html.dark` selectors.
  Tailwind `dark:` classes are not used anywhere in this project — they follow
  the OS preference and bypass the in-app theme toggle.
